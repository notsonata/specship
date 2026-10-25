import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { Brief, type ActivityKind, type CheckDefinition, type MaterialEvent, type Profile, type Report } from './contracts.js';
import { resolveProfile } from './config.js';
import { materializeArtifacts, MAX_ARTIFACT_BYTES, verifyArtifact } from './artifacts.js';
import { Store, type RunState } from './state.js';
import { CallbackHub } from './callbacks.js';
import type { AdapterEvent, ShipAdapter } from './adapters/types.js';
import type { RunnerConfig } from './contracts.js';
import { checkpoint, changedPaths } from './workspace.js';
import { LONG_TOOL_TIMEOUT_MS } from './timeouts.js';
import { authorize, setPhase, transition } from './policy.js';
import { SpecshipError } from './errors.js';

type ActiveExecution = { hub: CallbackHub; session: string; aborter: AbortController; eventAbort: AbortController; state: RunState; waiting: boolean; timer?: NodeJS.Timeout; stopping?: Promise<boolean>; pump?: Promise<void>; closing?: boolean; disposed?: boolean };

export class Runner {
  private active = new Map<string, ActiveExecution>();
  private expiring = new Map<string, Promise<void>>();
  constructor(private store: Store, private config: RunnerConfig, private adapter: ShipAdapter) {}
  profiles(){return this.config.ship;}
  private log(state:RunState,event:string,data:Record<string,unknown>={}):void{
    void this.store.appendLog(state.run_id,'runner',`${JSON.stringify({at:new Date().toISOString(),event,...data})}\n`).catch(()=>{});
  }
  private async git(cwd:string,args:string[],input?:string):Promise<string>{
    return await new Promise<string>((resolvePromise,rejectPromise)=>{
      const child=spawn('git',args,{cwd,env:{...process.env},stdio:['pipe','pipe','pipe'],windowsHide:true});
      let stdout='',stderr='';const limit=8_000_000;
      child.stdout.on('data',chunk=>{if(stdout.length<limit)stdout+=chunk.toString().slice(0,limit-stdout.length);});
      child.stderr.on('data',chunk=>{if(stderr.length<limit)stderr+=chunk.toString().slice(0,limit-stderr.length);});
      child.once('error',rejectPromise);
      child.once('close',code=>{if(code===0)resolvePromise(stdout);else rejectPromise(new SpecshipError('CAPABILITY_UNSUPPORTED',`git ${args.join(' ')} failed: ${stderr.slice(-2_000)}`));});
      child.stdin.end(input??'');
    });
  }
  private shipRoot(state:RunState):string{return state.checkpoint_root??this.store.workspace;}
  private async createWorktree(runId:string):Promise<string>{
    await this.git(this.store.workspace,['rev-parse','--is-inside-work-tree']);
    const path=join(tmpdir(),`specship-worktree-${runId}`);
    await this.git(this.store.workspace,['worktree','add','--detach',path,'HEAD']);
    return await realpath(path);
  }
  private async removeWorktree(state:RunState):Promise<void>{
    if(!state.ship_workspace)return;
    await this.git(this.store.workspace,['worktree','remove','--force',state.ship_workspace]).catch(()=>{});
    state.ship_workspace=undefined;state.checkpoint_root=undefined;
  }
  private async applyWorktree(state:RunState):Promise<void>{
    const worktree=state.ship_workspace;if(!worktree)return;
    await this.git(worktree,['add','-A']);
    const patch=await this.git(worktree,['diff','--cached','--binary','HEAD']);
    if(patch.trim())await this.git(this.store.workspace,['apply','--binary','--whitespace=nowarn','-'],patch);
    await this.removeWorktree(state);
  }
  private async media(workspace: string, refs: unknown[] = []) {
    const verified = [];
    for (const ref of refs) {
      const artifact = await verifyArtifact(workspace, ref);
      verified.push({ mime: artifact.reference.mime, name: artifact.reference.id, data: artifact.bytes });
    }
    if(verified.reduce((sum,item)=>sum+item.data.length,0)>MAX_ARTIFACT_BYTES)throw new Error(`Combined activity images exceed supported ${MAX_ARTIFACT_BYTES}-byte limit`);
    return verified;
  }
  async dispatch(input:{workspace?:string;operation_id:string;run_id?:string;kind:ActivityKind;ship_profile?:string;assignment?:string;brief?:unknown;artifacts?:unknown[];corrections?:string[];expected_brief_version?:number;supervisor_handle?:string},meta?:{thread?:string;turn?:string},signal?:AbortSignal):Promise<MaterialEvent>{
    const release=await this.store.lock();let state:RunState|undefined;let hub:CallbackHub|undefined;let started=false;let returned:MaterialEvent|undefined;let submitAttempted=false;let previousReview:any;const aborter=new AbortController();
    const cancel=()=>aborter.abort();signal?.addEventListener('abort',cancel,{once:true});
    try{
      if(input.workspace&&resolve(input.workspace)!==resolve(this.store.workspace))throw new Error('Dispatch workspace must match the configured MCP workspace');
       const fingerprint=JSON.stringify({workspace:resolve(input.workspace??this.store.workspace),kind:input.kind,profile:input.ship_profile,assignment:input.assignment,brief:input.brief,artifacts:input.artifacts,corrections:input.corrections,expected_brief_version:input.expected_brief_version});
       if(!input.run_id){const prior=await this.store.findOperation(input.operation_id);if(prior){const record=prior.result as any;if(record?.fingerprint&&record.fingerprint!==fingerprint)throw new Error('Operation ID was reused with different dispatch input');const event=record?.result??record;if(event?.event_id)return event as MaterialEvent;throw new Error('Operation was already prepared/submitted; reconcile its exact saved adapter message instead of replaying');}}
       if(!input.run_id&&this.active.size)throw new Error('Workspace writer is owned by an attached Ship context; accept or cancel it before starting another run');
       const attached = input.run_id ? this.active.get(input.run_id) : undefined;
        state = attached?.state ?? (input.run_id ? await this.store.load(input.run_id) : await this.store.create());
       if(input.kind==='correct'&&!input.run_id)throw new SpecshipError('INVALID_TRANSITION','A correction requires the exact existing run_id');
       authorize(state,'dispatch');
       const requestedIsolation=this.config.ship.isolation??'shared';
       if(state.ship_workspace){state.isolation='worktree';state.checkpoint_root=state.ship_workspace;}
       else if(input.kind!=='explore'&&requestedIsolation==='worktree'){
         try{const worktree=await this.createWorktree(state.run_id);state.isolation='worktree';state.ship_workspace=worktree;state.checkpoint_root=worktree;}
         catch(error){if(state.ship_workspace)await this.removeWorktree(state).catch(()=>{});throw error;}
       }else{state.isolation='shared';state.checkpoint_root=this.store.workspace;}
       if(attached){if(input.supervisor_handle!==state.supervisor?.handle)throw new Error('Exact supervisor_handle is required');this.bindCaller(state,meta);}
       if(state.operation_ids[input.operation_id]){const recorded=state.operation_ids[input.operation_id] as any;if(recorded.fingerprint&&recorded.fingerprint!==fingerprint)throw new Error('Operation ID was reused with different dispatch input');const event=recorded.result??recorded;if(event.event_id)return event as MaterialEvent;throw new Error('Operation was already prepared/submitted; reconcile its exact saved adapter message instead of replaying');}
      if(state.writer)throw new Error('A Ship writer is already active');if(input.expected_brief_version!==undefined&&input.expected_brief_version!==state.brief_version)throw new Error('Stale brief version');
      if(state.lifecycle==='awaiting_review')previousReview={report:state.report,report_id:state.report_id,pending:state.pending,brief:state.brief,brief_version:state.brief_version,lifecycle:state.lifecycle,activity_id:state.activity_id,activity_kind:state.activity_kind,profile:state.profile,deadline:state.deadline,current_operation_id:state.current_operation_id,workspace_checkpoint:state.workspace_checkpoint,adapter:state.adapter};
       let nextBrief=state.brief;
       if(input.kind!=='explore'){
         const parsed=Brief.parse(input.brief??state.brief);const artifacts=await materializeArtifacts(this.store.workspace,parsed.artifacts??[]);nextBrief={...parsed,artifacts};
         for(const id of parsed.required_checks??[])if(!this.config.checks?.[id])throw new SpecshipError('CAPABILITY_UNSUPPORTED',`Acceptance check '${id}' is not configured in .specship/config.json`);
         const criteria=parsed.acceptance_criteria??[];if(new Set(criteria.map(item=>item.id)).size!==criteria.length)throw new SpecshipError('CAPABILITY_UNSUPPORTED','Acceptance criterion IDs must be unique');
       }
       else nextBrief={artifacts:await materializeArtifacts(this.store.workspace,input.artifacts??[])};
       const selected=resolveProfile(this.config,input.ship_profile);const media=await this.media(this.store.workspace,(nextBrief as any)?.artifacts??[]);
       const capabilities=await this.adapter.capabilities?.(selected.profile).catch(()=>undefined);
       if(capabilities){const accepted=new Set(capabilities.media);for(const item of media)if(!accepted.has(item.mime))throw new SpecshipError('CAPABILITY_UNSUPPORTED',`Harness '${selected.profile.harness}' does not accept ${item.mime}`);state.capabilities=capabilities;}
       await this.adapter.validate(selected.profile,media.map(m=>m.mime));
       if (attached && JSON.stringify(state.profile) !== JSON.stringify({ name: selected.name, ...selected.profile })) throw new Error('A correction must keep the active run profile unchanged');
       await this.store.claimWriter(state.run_id);
       started=true;state.brief=nextBrief;if(input.kind!=='explore')state.brief_version++;
        state.profile={name:selected.name,...selected.profile};state.activity_id=randomUUID();state.activity_kind=input.kind;state.writer=true;transition(state,'dispatch');state.deadline=this.config.limits.max_dispatch_seconds==null?null:Date.now()+this.config.limits.max_dispatch_seconds*1000;
        state.supervisor={handle:state.supervisor?.handle??randomUUID(),thread:meta?.thread??state.supervisor?.thread,turn:meta?.turn??state.supervisor?.turn,waiting:true};
        state.report = undefined;
        state.report_id = undefined;
        state.report_checkpoint = undefined;
        state.accept_checkpoint = undefined;
        state.check_results = undefined;
       state.pending = undefined;
        state.operation_ids[input.operation_id]={fingerprint,status:'prepared',activity_id:state.activity_id,operation_id:input.operation_id};
        state.current_operation_id=input.operation_id;
        state.workspace_checkpoint=await checkpoint(this.shipRoot(state));
       await this.store.save(state);
       this.log(state,'dispatch_start',{kind:input.kind,profile:selected.name,isolation:state.isolation??'shared'});
       let session: string;
       let native: { session: string; version: string };
       let eventAbort: AbortController;
        if (attached) {
          hub = attached.hub; session = attached.session; eventAbort = attached.eventAbort;
          native = { session, version: String((state.adapter as any)?.version ?? 'restored') };
        } else {
         let sessionId = '';
          hub = new CallbackHub(this.store,state,async()=>{if(!sessionId)return false;const stopped=await this.adapter.abort(sessionId);const controller=this.active.get(state!.run_id);if(stopped&&controller?.timer){clearTimeout(controller.timer);controller.timer=undefined;}return stopped;},this.config.limits.delivery_margin_seconds*1000);
         await hub.start();
          native = await this.adapter.start(this.shipRoot(state),selected.profile,input.kind,{url:hub.url,capability:hub.token,descriptorPath:this.store.callbackDescriptorPath(state.run_id),timeoutMs:LONG_TOOL_TIMEOUT_MS});
          session = native.session; sessionId = session;
          state.adapter={adapter:this.adapter.name,session:native.session,version:native.version,message_id:null,operation_id:input.operation_id};
         eventAbort = new AbortController();
         await this.adapter.subscribe(session,eventAbort.signal);
         const controller: ActiveExecution = {hub,session,aborter,eventAbort,state,waiting:true};
         this.active.set(state.run_id,controller);
         controller.pump=this.consume(session,eventAbort.signal,hub,state,controller);
           await this.publishDescriptor(state,hub);
           this.scheduleDeadline(state.run_id);
        }
        await this.publishDescriptor(state,hub);
        if(this.adapter.snapshot)await this.store.writePrivate(state.run_id,'adapter.json',await this.adapter.snapshot(session));
        const prompt=JSON.stringify({kind:input.kind,assignment:input.assignment,brief:state.brief,corrections:input.corrections,activity_id:state.activity_id});
        state.operation_ids[input.operation_id]={fingerprint,status:'submission_pending',activity_id:state.activity_id,session,operation_id:input.operation_id};
        await this.store.save(state);
       submitAttempted=true;
       const submitted=await this.adapter.submit(session,input.operation_id,prompt,media);
        state.adapter={adapter:this.adapter.name,session:native.session,version:native.version,message_id:submitted.messageId,operation_id:input.operation_id};
       await this.store.save(state);
        const activeController=this.active.get(state.run_id)!;if(activeController.waiting&&attached)throw new Error('Another supervisor wait is active for this run');activeController.waiting=true;if(state.supervisor)state.supervisor.waiting=true;await this.publishDescriptor(state,hub);
        activeController.stopping=undefined;this.scheduleDeadline(state.run_id);
        const event=await this.blockUntilEvent(state,signal,aborter,hub,session,eventAbort);
        activeController.waiting=false;if(state.supervisor)state.supervisor.waiting=false;
         if(activeController.timer&&['paused','cancelled','completed','awaiting_review'].includes(state.lifecycle)){clearTimeout(activeController.timer);activeController.timer=undefined;}
        state.operation_ids[input.operation_id]={fingerprint,activity_id:state.activity_id,operation_id:input.operation_id,result:event};
       await this.store.save(state);
       if(input.kind==='explore'&&event.kind==='exploration_completed'){
         if(activeController.timer)clearTimeout(activeController.timer);
         await this.disposeActive(state.run_id,true);
       }
       this.log(state,'event',{kind:event.kind,event_id:event.event_id});
       returned=event;
       return event;
    } catch (error) {
      if (state) this.log(state,'dispatch_error',{message:String(error)});
      if (state && started) {
        const active = this.active.get(state.run_id);
        if (previousReview && !submitAttempted) {
          Object.assign(state, previousReview);
          delete state.operation_ids[input.operation_id];
          state.writer = false;
          state.cleanup_pending = false;
          if (state.supervisor) state.supervisor.waiting = false;
          await this.store.releaseWriter(state.run_id).catch(() => {});
          await this.store.removeInterruptDescriptor(state.run_id).catch(() => {});
          if (active) await this.disposeActive(state.run_id, true).catch(() => {});
          await this.store.save(state).catch(() => {});
          throw error;
        }
        if (active) {
          const stopped = await this.stop(active);
          if (stopped) {
            state.writer = false;
            setPhase(state, 'paused');
            await this.store.releaseWriter(state.run_id).catch(() => {});
            await this.store.emit(state, 'paused', { reason: 'runner error; adapter stop confirmed' }).catch(() => {});
            if (!await this.disposeActive(state.run_id, true)) state.cleanup_pending = true;
          } else state.cleanup_pending = true;
        } else {setPhase(state,'failed');state.writer=false;await this.store.releaseWriter(state.run_id).catch(()=>{});}
        await this.store.save(state).catch(() => {});
      }
      throw error;
    }
    finally {
      signal?.removeEventListener('abort', cancel);
      const active = state ? this.active.get(state.run_id) : undefined;
      if (active && (state!.lifecycle === 'paused' || state!.lifecycle === 'limit_reached' || state!.lifecycle === 'cancelled' || state!.lifecycle === 'failed')) {
        if (!await this.disposeActive(state!.run_id, true)) { state!.cleanup_pending = true; await this.store.save(state!).catch(() => {}); }
      }
      if (!state || !this.active.has(state.run_id)) await hub?.close();
      await release();
    }
  }
  private async disposeActive(runId:string, closeAdapter:boolean):Promise<boolean>{
    const active=this.active.get(runId);
    if(!active)return true;
    if(active.disposed)return true;
    active.closing=true;
    if(active.timer){clearTimeout(active.timer);active.timer=undefined;}
    active.eventAbort.abort();
    if(active.pump)await active.pump.catch(()=>{});
    await active.hub.close().catch(()=>{});
    if(closeAdapter){
      const closed=this.adapter.close
        ? await this.adapter.close(active.session).catch(()=>false)
        : await this.adapter.abort(active.session).catch(()=>false);
      if(!closed){active.closing=false;return false;}
    }
    active.disposed=true;
    this.log(active.state,'disposed',{close_adapter:closeAdapter});
    this.active.delete(runId);
    return true;
  }
  private async disposeAfterTerminalEvent(state:RunState):Promise<void>{
    if(!this.active.has(state.run_id))return;
    if(!await this.disposeActive(state.run_id,true)){state.cleanup_pending=true;await this.store.save(state).catch(()=>{});}
  }
  private wakeCell(runId:string):{promise:Promise<void>;dispose:() => void}{
    let resolve!:() => void;const promise=new Promise<void>(done=>{resolve=done;});const dispose=this.store.onChange(runId,()=>resolve());
    return {promise,dispose};
  }
  private waitForWake(cell:{promise:Promise<void>},deadline:number|null|undefined,signal?:AbortSignal):Promise<void>{
    return new Promise<void>(resolve=>{
      let settled=false;let timer:NodeJS.Timeout|undefined;
      const finish=()=>{if(settled)return;settled=true;if(timer)clearTimeout(timer);signal?.removeEventListener('abort',finish);resolve();};
      if(signal?.aborted){finish();return;}
      signal?.addEventListener('abort',finish,{once:true});
      if(deadline!=null){const delay=Math.max(0,Math.min(LONG_TOOL_TIMEOUT_MS,deadline-Date.now()));timer=setTimeout(finish,delay);}
      cell.promise.then(finish);
    });
  }
  private async consume(session:string,signal:AbortSignal,_hub:CallbackHub,state:RunState,active?:ActiveExecution):Promise<void>{
    try{
      for await(const e of this.adapter.events(session,signal)){
        if(e.type==='permission'){
          const data=e.data as any;const id=data.permissionID??data.id??data.requestID;
          if(!id||(state.pending as any)?.id===id)continue;
          await this.store.exclusive(state.run_id,async()=>{state.pending={kind:'permission',id,body:data};await this.store.emit(state,'user_input_required',data);});
        }
        if(e.type==='idle')this.store.notify(state.run_id);
        if(e.type==='error'){
          const expectedAbort=(e.data as any)?.error?.name==='MessageAbortedError'&&((state.stop_request as any)?.status==='requested'||active?.stopping);
          if(!expectedAbort)await this.store.emit(state,'execution_failed',e.data);
        }
      }
    }catch(error){
      if(!active?.closing&&!signal.aborted)await this.store.emit(state,'execution_failed',{message:String(error)}).catch(()=>{});
    }
  }
  private async publishDescriptor(state:RunState,hub:CallbackHub):Promise<void>{const {thread,turn}=state.supervisor??{};if(thread&&turn)await this.store.publishInterruptDescriptor({run_id:state.run_id,session_id:thread,turn_id:turn,url:hub.url,capability:hub.token});await hub.refreshDescriptor();}
  private scheduleDeadline(runId:string):void{const active=this.active.get(runId);if(!active||active.timer||active.state.deadline==null)return;const delay=Math.max(0,Math.min(LONG_TOOL_TIMEOUT_MS,active.state.deadline-Date.now()));active.timer=setTimeout(()=>{active.timer=undefined;if(active.state.deadline!=null&&Date.now()>=active.state.deadline)void this.expire(runId);else this.scheduleDeadline(runId);},delay);}
  private async stop(active:ActiveExecution):Promise<boolean>{if(!active.stopping)active.stopping=this.adapter.abort(active.session).catch(()=>false);const confirmed=await active.stopping;if(confirmed)active.hub.detachPending();return confirmed;}
  private async expire(runId:string):Promise<void>{
    const existing=this.expiring.get(runId);
    if(existing)return await existing;
    const task=this.expireNow(runId);
    this.expiring.set(runId,task);
    try{await task;}finally{if(this.expiring.get(runId)===task)this.expiring.delete(runId);}
  }
  private async expireNow(runId:string):Promise<void>{
    const active=this.active.get(runId);if(!active||active.state.deadline==null)return;
    const state=active.state;if(state.events.some((event:any)=>event.kind==='limit_reached'&&event.activity_id===state.activity_id))return;
    const stopped=await this.stop(active);
    if(stopped){state.writer=false;setPhase(state,'limit_reached');if(active.timer)clearTimeout(active.timer);await this.store.releaseWriter(runId);await this.store.removeInterruptDescriptor(runId);await this.store.emit(state,'limit_reached',{max_dispatch_seconds:this.config.limits.max_dispatch_seconds,stop_confirmed:true});}
    else{await this.store.emit(state,'limit_reached',{max_dispatch_seconds:this.config.limits.max_dispatch_seconds,stop_confirmed:false,writer_retained:true});}
  }
  private bindCaller(state:RunState,meta?:{thread?:string;turn?:string}):void{if(!meta?.thread&&!meta?.turn)return;if(meta.thread&&state.supervisor?.thread&&meta.thread!==state.supervisor.thread)throw new Error('Run belongs to a different native Codex chat');if(meta.thread)state.supervisor!.thread=meta.thread;if(meta.turn)state.supervisor!.turn=meta.turn;}
  async assertSupervisor(runId:string,handle:string|undefined,meta?:{thread?:string;turn?:string}):Promise<void>{const active=this.active.get(runId);if(!active)throw new Error('Run is not attached in this process; use specship_wait with recover=true and the saved supervisor_handle');if(!handle||handle!==active.state.supervisor?.handle)throw new Error('Exact supervisor_handle is required');this.bindCaller(active.state,meta);await this.store.save(active.state);await this.publishDescriptor(active.state,active.hub);}
  async recover(runId:string,handle:string,meta?:{thread?:string;turn?:string},signal?:AbortSignal):Promise<MaterialEvent>{
    const attached=this.active.get(runId);if(attached)return this.wait(runId,handle,meta,signal);
    const release=await this.store.lock(true);
    let state:RunState|undefined;let hub:CallbackHub|undefined;let restored:{session:string;version:string}|undefined;
    try{
      state=await this.store.load(runId);
      if(!handle||state.supervisor?.handle!==handle)throw new Error('Recovery requires the exact saved supervisor_handle');
      this.bindCaller(state,meta);
      if(['completed','cancelled','failed'].includes(state.lifecycle))throw new Error(`Run is terminal (${state.lifecycle}); no recovery work created`);
      const snapshot=await this.store.readPrivate(runId,'adapter.json');
      const savedProfile=(snapshot as any)?.profile;
      const recorded=state.profile as any;
      if(!savedProfile||savedProfile.model!==recorded?.model||savedProfile.harness!==recorded?.harness||JSON.stringify(savedProfile.options)!==JSON.stringify(recorded?.options)||savedProfile.executable!==recorded?.executable)throw new Error('Saved private adapter profile does not match the authoritative run profile');
      await this.media(this.store.workspace,(state.brief as any)?.artifacts??[]);
      if((snapshot as any)?.workspace&&(snapshot as any).workspace!==(state.ship_workspace??this.store.workspace))throw new Error('Saved adapter workspace does not match this run');
      try{await this.store.reclaimWriter(runId);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'&&!state.writer)await this.store.claimWriter(runId);else throw error;}
      hub=new CallbackHub(this.store,state,async()=>{if(!restored)return false;return this.adapter.abort(restored.session);},this.config.limits.delivery_margin_seconds*1000);
      await hub.start();
      if(!this.adapter.restore)throw new Error('Selected adapter does not implement authenticated session restoration');
      restored=await this.adapter.restore(snapshot,{url:hub.url,capability:hub.token,descriptorPath:this.store.callbackDescriptorPath(runId),timeoutMs:LONG_TOOL_TIMEOUT_MS});
      if(this.adapter.snapshot)await this.store.writePrivate(runId,'adapter.json',await this.adapter.snapshot(restored.session));
      const eventAbort=new AbortController();await this.adapter.subscribe(restored.session,eventAbort.signal);
      const active={hub,session:restored.session,aborter:new AbortController(),eventAbort,state,waiting:false as boolean,timer:undefined as NodeJS.Timeout|undefined,stopping:undefined as Promise<boolean>|undefined};
      this.active.set(runId,active);
      if(state.lifecycle!=='awaiting_review')this.scheduleDeadline(runId);
      const pump=this.consume(restored.session,eventAbort.signal,hub,state).catch(error=>{void this.store.emit(state!,'execution_failed',{message:String(error)});});void pump;
      state.adapter={...(state.adapter as any),session:restored.session,version:restored.version};
      const currentCheckpoint=await checkpoint(this.shipRoot(state));
      const drift=state.workspace_checkpoint&&currentCheckpoint?changedPaths(state.workspace_checkpoint,currentCheckpoint):[];
      if(drift.length){
        if(!await this.stop(active)){await this.store.emit(state,'execution_failed',{reason:'Workspace changed and stop is unconfirmed; writer retained'});return state.events.at(-1) as MaterialEvent;}
        state.report=undefined;state.report_id=undefined;setPhase(state,'awaiting_decision');state.writer=false;
        state.pending={kind:'recovery_review',id:randomUUID(),body:{blocker:'Workspace files changed since the saved material event. Saved validation is no longer current.',evidence:drift.slice(0,100),attempts:['Compared local content hashes after reconnecting and confirming native stop'],decision:'Review the changed files and specify the authorized continuation and validation before Ship resumes.'}};
        return await this.store.emit(state,'decision_required',state.pending) as MaterialEvent;
      }
      if(state.lifecycle!=='awaiting_review'&&state.deadline!=null&&Date.now()>=state.deadline){await this.expire(runId);return state.events.at(-1) as MaterialEvent;}
      const opEntry=state.current_operation_id?[state.current_operation_id,state.operation_ids[state.current_operation_id]] as [string,any]:Object.entries(state.operation_ids).filter(([,value]:any)=>value?.activity_id===state!.activity_id).at(-1) as [string,any]|undefined;
      if(!opEntry)throw new Error('Current activity has no durable operation intent');
      const [operationKey,intent]=opEntry;const operationId=intent.operation_id??operationKey;
      let messageId=(state.adapter as any).message_id as string|undefined;
      if(!messageId){
        if(!this.adapter.reconcileOperation)throw new Error('Adapter cannot reconcile ambiguous submission; prompt will not be replayed');
        const matched=await this.adapter.reconcileOperation(restored.session,operationId);
        if(matched.status==='unknown'){
          const stopped=await this.stop(active);
          if(stopped){state.writer=false;setPhase(state,'paused');await this.store.releaseWriter(runId);await this.store.emit(state,'execution_failed',{reason:'submission outcome is ambiguous; confirmed stopped; do not retry original prompt'});}
          else await this.store.emit(state,'execution_failed',{reason:'submission outcome is ambiguous and stop is unconfirmed; writer retained'});
          return state.events.at(-1) as MaterialEvent;
        }
        messageId=matched.messageId;(state.adapter as any).message_id=messageId;await this.store.save(state);
      }
      if(state.pending&&['question','permission','deferred','recovery_review'].includes((state.pending as any).kind)){
        const stopped=await this.stop(active);
        if(!stopped){await this.store.emit(state,'execution_failed',{reason:'recovery could not confirm quiescence of the old callback turn; writer retained'});return state.events.at(-1) as MaterialEvent;}
        const isDecision=['question','recovery_review'].includes((state.pending as any).kind);
        setPhase(state,isDecision?'awaiting_decision':'awaiting_user');state.writer=false;state.supervisor!.waiting=false;await this.store.save(state);
        const event=state.events.filter((item:any)=>item.activity_id===state!.activity_id&&(isDecision?item.kind==='decision_required':item.kind==='user_input_required')).at(-1) as MaterialEvent|undefined;
        if(event){state.handled_event_ids=[...new Set([...(state.handled_event_ids??[]),...state.events.filter((item:any)=>item.activity_id===state!.activity_id&&item.event_id!==event.event_id).map((item:any)=>item.event_id)])];await this.store.save(state);return event;}
      }
      if((state.pending as any)?.kind==='answer'&&intent.status==='answer_durable'){
        const stopped=await this.stop(active);if(!stopped){await this.store.emit(state,'execution_failed',{reason:'Could not confirm idle before recovering the durable decision continuation; writer retained'});return state.events.at(-1) as MaterialEvent;}
        const pending=state.pending as any;const asked=pending.question as any;const ids=new Set<string>(asked?.body?.image_artifact_ids??[]);const refs=((state.brief as any)?.artifacts??[]).filter((item:any)=>ids.has(item.id));if(refs.length!==ids.size)throw new Error('Recovered decision references missing artifacts');const images=await this.media(this.store.workspace,refs);
        const found=await this.adapter.reconcileOperation?.(restored.session,operationId);
        if(found?.status==='unknown'){await this.adapter.reply(restored.session,operationId,pending.answer,images);const adopted=await this.adapter.reconcileOperation?.(restored.session,operationId);if(adopted?.messageId){messageId=adopted.messageId;(state.adapter as any).message_id=messageId;}}
        else if(found?.messageId){messageId=found.messageId;(state.adapter as any).message_id=messageId;}
        await this.store.save(state);
      }
      if(messageId){
        const native=await this.adapter.reconcile(restored.session,messageId);
        if(native==='unknown'||(native==='complete'&&!state.report)){
          const reason=native==='unknown'?'native execution could not be reconciled after restart; the prompt outcome is ambiguous and was not replayed':'native activity completed without a validated report';
          const stopped=await this.stop(active);
          if(stopped){state.writer=false;setPhase(state,'paused');await this.store.releaseWriter(runId);await this.store.removeInterruptDescriptor(runId);await this.store.emit(state,'execution_failed',{reason,stop_confirmed:true});}
          else await this.store.emit(state,'execution_failed',{reason:`${reason}; stop unconfirmed`,stop_confirmed:false});
          return state.events.at(-1) as MaterialEvent;
        }
      }
      if(state.report){
        const status=await this.adapter.reconcile(restored.session,messageId!);
        if(status==='complete'){
          const existing=state.events.filter((item:any)=>item.activity_id===state!.activity_id&&['implementation_ready','exploration_completed','decision_required','execution_failed'].includes(item.kind)).at(-1) as MaterialEvent|undefined;
          if(existing)return existing;
          return await this.blockUntilEvent(state,signal,active.aborter,hub,restored.session,eventAbort);
        }
      }
      setPhase(state,'running');state.writer=true;state.supervisor!.waiting=true;active.stopping=undefined;await this.store.save(state);
      this.scheduleDeadline(runId);
      return await this.blockUntilEvent(state,signal,active.aborter,hub,restored.session,eventAbort);
    }catch(error){
      if(state){await this.store.save(state).catch(()=>{});}
      if(hub&&!this.active.has(runId))await hub.close();
      throw error;
    }finally{await release();}
  }
  private async blockUntilEvent(
    state: RunState,
    signal: AbortSignal | undefined,
    aborter: AbortController,
    hub: CallbackHub,
    session: string,
    eventAbort: AbortController,
    skipEventId?: string,
  ): Promise<MaterialEvent> {
    const end = state.deadline;
    while (true) {
      const cell=this.wakeCell(state.run_id);
      try {
      if (signal?.aborted) {
        aborter.abort();
        const stopped = await this.stop(this.active.get(state.run_id)!);
        if (!stopped) throw new Error('Stop could not be verified; writer remains unsafe');
        state.writer = false;
        setPhase(state, 'paused');
        await this.store.releaseWriter(state.run_id);
        await this.store.removeInterruptDescriptor(state.run_id);
        const paused = await this.store.emit(state, 'paused', { reason: 'supervisor cancellation' }) as MaterialEvent;
        await this.disposeAfterTerminalEvent(state);
        return paused;
      }

      const unresolved = state.pending as { kind?: string; id?: string } | undefined;
      const material = state.events.find((event: any) =>
        event.activity_id===state.activity_id&&event.event_id !== skipEventId && !(state.handled_event_ids??[]).includes(event.event_id) && (
        ['user_input_required', 'execution_failed', 'paused', 'cancelled', 'limit_reached'].includes(event.kind) ||
        (event.kind === 'decision_required' && ['question','recovery_review'].includes(unresolved?.kind??'') && event.payload?.id === unresolved?.id)),
      ) as MaterialEvent | undefined;
      if (material) {
        if(material.kind==='decision_required')setPhase(state,'awaiting_decision');else if(material.kind==='user_input_required')setPhase(state,'awaiting_user');
        await this.store.save(state);
        if(material.kind==='paused'||material.kind==='limit_reached')await this.disposeAfterTerminalEvent(state);
        return material;
      }

      if(end!=null&&Date.now()>=end){await this.expire(state.run_id);const limit=state.events.find((event:any)=>event.activity_id===state.activity_id&&['limit_reached','execution_failed'].includes(event.kind));if(limit){if((limit as any).kind==='limit_reached')await this.disposeAfterTerminalEvent(state);return limit as MaterialEvent;}}

      if (state.report) {
        const report = state.report as Report;
        const messageId = (state.adapter as any)?.message_id;
        const quiescence = await this.adapter.reconcile(session, messageId);
        if (quiescence === 'complete') {
          state.writer = false;
          const currentCheckpoint = await checkpoint(this.shipRoot(state));
          const drift = state.report_checkpoint && currentCheckpoint ? changedPaths(state.report_checkpoint, currentCheckpoint) : [];
          if (drift.length) {
            const active = this.active.get(state.run_id);
            const stopped = active ? await this.stop(active) : true;
            if (!stopped) {
              await this.store.emit(state, 'execution_failed', { reason: 'Workspace changed after the implementation report and Ship stop is unconfirmed', evidence: drift.slice(0, 100) });
              return state.events.at(-1) as MaterialEvent;
            }
            setPhase(state, 'awaiting_decision');
            state.pending = { kind: 'recovery_review', id: randomUUID(), body: { blocker: 'Workspace files changed after the implementation report; the saved validation is no longer current.', evidence: drift.slice(0, 100), attempts: ['Compared the report checkpoint with the current workspace'], decision: 'Review the changed files and specify the authorized continuation and validation.' } };
            await this.store.releaseWriter(state.run_id);
            return await this.store.emit(state, 'decision_required', { report, ...(state.pending as any) }) as MaterialEvent;
          }
          const isExploration = state.activity_kind === 'explore';
          const status = 'status' in report ? report.status : undefined;
          const checks = !isExploration && status === 'ready_for_review' ? await this.runConfiguredChecks(state) : [];
          const brief = state.brief as Brief|undefined;
          const criteria = brief?.acceptance_criteria ?? [];
          const results = ('status' in report ? (report as any).acceptance_results : undefined) ?? [];
          const uncovered = criteria.filter(criterion => !results.some((result: any) => result.criterion_id === criterion.id && result.evidence.trim()));
          const checksPassed = checks.every(check => check.status === 'passed');
          state.accept_checkpoint = await checkpoint(this.shipRoot(state));
          setPhase(state, !isExploration && status === 'ready_for_review' ? 'awaiting_review' : !isExploration&&status==='needs_decision'?'awaiting_decision':'idle');
          if (state.lifecycle !== 'awaiting_review') await this.store.releaseWriter(state.run_id);
          const kind = isExploration ? 'exploration_completed' : status === 'ready_for_review' ? 'implementation_ready' : status === 'needs_decision' ? 'decision_required' : 'execution_failed';
          return await this.store.emit(state, kind, { report, checks, checks_passed: checksPassed, uncovered_criteria: uncovered.map(item => item.id), ...(state.ship_workspace?{worktree:state.ship_workspace}:{}), ...(status==='needs_decision'?{request_id:state.report_id}:{}) }) as MaterialEvent;
        }
      }
      await this.waitForWake(cell,end,signal);
      } finally { cell.dispose(); }
    }
  }
  async reply(input: { run_id: string; request_id: string; operation_id: string; answer: string; expected_brief_version: number; brief?: unknown; defer_to_user?: boolean }, meta?:{thread?:string;turn?:string}, signal?:AbortSignal): Promise<MaterialEvent> {
    const active = this.active.get(input.run_id);
    if (!active) throw new Error('Ship callback is not attached; recovery is required and prompt replay is forbidden');
    const state = active.state;
    this.bindCaller(state,meta);
    const fingerprint=JSON.stringify({request_id:input.request_id,answer:input.answer,brief:input.brief,defer:input.defer_to_user});
    const previous=state.operation_ids[input.operation_id] as any;
    if(previous){if(previous.fingerprint!==fingerprint)throw new Error('Operation ID was reused with different reply input');if(previous.result?.event_id)return previous.result as MaterialEvent;throw new Error('Identical reply operation is already pending');}
    authorize(state,'reply');
    if (state.brief_version !== input.expected_brief_version) throw new Error('Stale reply');
    const question = state.pending as any;
    if (question?.id !== input.request_id) throw new Error('Stale request ID');
    // Native thread IDs identify the supervisor, not a human approval. No model-facing
    // path can grant permissions, including a permission previously deferred to the user.
    const permission = question.kind === 'permission' || state.events.some((event: any) => event.activity_id === state.activity_id && event.kind === 'user_input_required' && (event.payload?.permissionID ?? event.payload?.id ?? event.payload?.requestID) === question.id);
    if (permission && !input.defer_to_user && input.answer !== 'reject') throw new Error('Native permission grants are disabled through Specship. The user must configure permissions directly in OpenCode; Spec may only reject, pause, or cancel.');
    if(question.kind==='report'){
      if((state.report as any)?.status!=='needs_decision')throw new Error('The current report has no pending decision; review, correct, or accept it');
      state.report=undefined;state.report_id=undefined;state.report_checkpoint=undefined;state.accept_checkpoint=undefined;state.check_results=undefined;
    }
    if(question.kind==='recovery_review'){state.report=undefined;state.report_id=undefined;state.report_checkpoint=undefined;state.accept_checkpoint=undefined;state.check_results=undefined;}
    if(active.waiting)throw new Error('Another supervisor wait is active for this run');
    if(input.defer_to_user){state.pending={...question,kind:permission?'permission':'deferred'};setPhase(state,'awaiting_user');state.supervisor!.waiting=false;const event=await this.store.emit(state,'user_input_required',{request_id:input.request_id,...(permission?{id:input.request_id}:{}),reason:'decision deferred to user'} ) as MaterialEvent;state.operation_ids[input.operation_id]={fingerprint,result:event};await this.store.save(state);return event;}
    if (input.brief) { const parsed=Brief.parse(input.brief);state.brief={...parsed,artifacts:await materializeArtifacts(this.store.workspace,parsed.artifacts??[])};state.brief_version++; }
    if(!state.writer)await this.store.claimWriter(state.run_id);
    if(permission){
      state.handled_event_ids=[...new Set([...(state.handled_event_ids??[]),...state.events.filter((event:any)=>event.activity_id===state.activity_id).map((event:any)=>event.event_id)])];
      state.operation_ids[input.operation_id]={fingerprint,answer:input.answer};state.pending={...question,kind:'permission_answer',answer:input.answer};transition(state,'reply');await this.store.save(state);
       await this.adapter.resolvePermission?.(active.session,question.id,'reject');
    } else {
    const requested = new Set<string>(question.body?.image_artifact_ids ?? []);
    const refs = ((state.brief as any)?.artifacts ?? []).filter((artifact: any) => requested.has(artifact.id));
    if (refs.length !== requested.size) throw new Error('Callback references an unknown or stale image artifact');
    const images = await this.media(this.store.workspace, refs);
    if (question.body?.request_id === input.request_id) active.hub.recordAnswer(input.request_id, input.answer, refs, question.body);
    state.handled_event_ids=[...new Set([...(state.handled_event_ids??[]),...state.events.filter((event:any)=>event.activity_id===state!.activity_id).map((event:any)=>event.event_id)])];
    state.operation_ids[input.operation_id] = { fingerprint, activity_id:state.activity_id, operation_id:input.operation_id, status:'answer_durable', answer: input.answer };
    state.current_operation_id=input.operation_id;
    state.pending = { kind: 'answer', id:input.request_id, request_id: input.request_id, answer: input.answer, question };
    transition(state,'reply');state.writer=true;
    if (state.deadline != null && Date.now() >= state.deadline) throw new Error('Activity deadline expired; Ship stop is being reconciled');
    await this.store.save(state);
    if(active.hub.waitingForAnswer)await active.hub.release(input.answer,images);
    else{
      (state.adapter as any).operation_id=input.operation_id;(state.adapter as any).message_id=null;await this.store.save(state);
      await this.adapter.reply(active.session,input.operation_id,input.answer,images);
      const matched=await this.adapter.reconcileOperation?.(active.session,input.operation_id);
      if(matched?.messageId){(state.adapter as any).message_id=matched.messageId;await this.store.save(state);}
    }
    }
    active.waiting=true;state.supervisor!.waiting=true;active.stopping=undefined;
    const release = await this.store.lock();
    try {
      const event = await this.blockUntilEvent(state, signal, active.aborter, active.hub, active.session, active.eventAbort);
      active.waiting=false;state.supervisor!.waiting=false;
      if(active.timer&&['paused','cancelled','completed','awaiting_review','idle'].includes(state.lifecycle)){clearTimeout(active.timer);active.timer=undefined;}
      state.operation_ids[input.operation_id] = { fingerprint, activity_id:state.activity_id, result:event };
      await this.store.save(state);
      return event;
    } finally { active.waiting=false;state.supervisor!.waiting=false;await release(); }
  }
  async wait(runId:string,supervisorHandle?:string,meta?:{thread?:string;turn?:string},signal?:AbortSignal,lastEventId?:string,recover=false):Promise<MaterialEvent>{
    const active=this.active.get(runId);if(!active){if(recover)return this.recover(runId,supervisorHandle??'',meta,signal);throw new Error('Run is not attached in this process; explicit recovery is required');}
    await this.assertSupervisor(runId,supervisorHandle,meta);const state=active.state;
    authorize(state,'wait');
    const unresolved=state.pending as any;
    const relevant=state.events.filter((event:any)=>event.activity_id===state.activity_id&&!(state.handled_event_ids??[]).includes(event.event_id)&&(
      ['question','recovery_review'].includes(unresolved?.kind??'')&&event.kind==='decision_required'&&event.payload?.id===unresolved.id||
      unresolved?.kind==='permission'&&event.kind==='user_input_required'&&(event.payload?.permissionID??event.payload?.id??event.payload?.requestID)===unresolved.id||
      unresolved?.kind==='deferred'&&event.kind==='user_input_required'&&event.payload?.request_id===unresolved.id||
      state.lifecycle==='awaiting_review'&&event.kind==='implementation_ready'||
      ['paused','cancelled','limit_reached','execution_failed'].includes(event.kind)
    ));
    const current=relevant.at(-1) as MaterialEvent|undefined;
    const policy=state.wait_policy??={no_progress:0,inspect_count:0,inspect_window_start:0};
    if(current){
      policy.last_event_id=current.event_id;
      if(current.event_id!==lastEventId){policy.no_progress=0;return current;}
    }
    if(recover)policy.no_progress=0;
    if(lastEventId){
      policy.no_progress++;
      if(policy.no_progress>2){await this.store.save(state);throw new SpecshipError('WAIT_WITHOUT_PROGRESS','No new material event followed the supplied last_event_id; stop polling and wait for the delivered event');}
      await this.store.save(state);
    }
    if(active.waiting)throw new Error('A blocking supervisor wait is already active');
    active.waiting=true;state.supervisor!.waiting=true;
    try{const event=await this.blockUntilEvent(state,signal,active.aborter,active.hub,active.session,active.eventAbort,lastEventId);if(active.timer&&['paused','cancelled','completed','awaiting_review','idle'].includes(state.lifecycle)){clearTimeout(active.timer);active.timer=undefined;}policy.no_progress=0;return event;}
    finally{active.waiting=false;state.supervisor!.waiting=false;await this.store.save(state);}
  }
  private async runOneCheck(id:string, check:CheckDefinition):Promise<Record<string, unknown>>{
    const started=Date.now();
    let cwd:string;
    try{
      const workspace=await realpath(this.store.workspace);
      const requested=resolve(workspace,check.cwd??'.');
      cwd=await realpath(requested);
      const rel=relative(workspace,cwd);
      if(rel==='..'||rel.startsWith(`..${sep}`)||resolve(workspace,rel)!==cwd)throw new Error('Check cwd escapes the workspace');
    }catch(error){return {id,status:'error',message:String(error),duration_ms:Date.now()-started};}
    return await new Promise(resolvePromise=>{
      let stdout='',stderr='',timedOut=false;
      const stdoutHash=createHash('sha256'),stderrHash=createHash('sha256');
      const limit=64_000;
      const command=process.platform==='win32'?process.env.ComSpec??'cmd.exe':'/bin/sh';
      const args=process.platform==='win32'?['/d','/s','/c',check.command]:['-lc',check.command];
      let child;
      try{child=spawn(command,args,{cwd,env:{...process.env},stdio:['ignore','pipe','pipe'],windowsHide:true,detached:process.platform!=='win32'});}
      catch(error){resolvePromise({id,status:'error',message:String(error),duration_ms:Date.now()-started});return;}
      child.stdout?.on('data',chunk=>{stdoutHash.update(chunk);if(stdout.length<limit)stdout+=chunk.toString().slice(0,limit-stdout.length);});
      child.stderr?.on('data',chunk=>{stderrHash.update(chunk);if(stderr.length<limit)stderr+=chunk.toString().slice(0,limit-stderr.length);});
      const timeout=Math.max(1,Math.min(check.timeout_ms??120_000,600_000));
      const timer=setTimeout(()=>{
        timedOut=true;
        try{
          if(process.platform==='win32'&&child!.pid)spawn('taskkill',['/PID',String(child!.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});
          else if(child!.pid)process.kill(-child!.pid,'SIGTERM');
          else child!.kill();
        }catch{try{child!.kill();}catch{}}
      },timeout);
      child.once('error',error=>{clearTimeout(timer);resolvePromise({id,status:'error',message:String(error),duration_ms:Date.now()-started});});
      child.once('close',(code,signal)=>{clearTimeout(timer);const expected=check.expected_exit??0;const passed=!timedOut&&code===expected;resolvePromise({id,status:passed?'passed':'failed',exit_code:code,signal,expected_exit:expected,timed_out:timedOut,duration_ms:Date.now()-started,stdout_sha256:stdoutHash.digest('hex'),stderr_sha256:stderrHash.digest('hex'),output_summary:`${stdout}\n${stderr}`.trim().slice(-2_000)});});
    });
  }
  private async runConfiguredChecks(state:RunState):Promise<Array<Record<string, unknown>>>{
    const brief=state.brief as Brief|undefined;const ids=brief?.required_checks??[];
    if(!ids.length){state.check_results=[];return [];}
    const results=[];
    for(const id of ids){const check=this.config.checks?.[id];results.push(check?await this.runOneCheck(id,check):{id,status:'error',message:'check is not configured'});}
    state.check_results=results;await this.store.save(state);
    return results;
  }
  async noteInspection(runId:string|undefined,purpose:string|undefined,section:string):Promise<void>{
    if(!runId)return;
    if((section==='logs'||section==='transitions')&&!purpose)throw new SpecshipError('INSPECT_PURPOSE_REQUIRED','Inspecting logs or transitions requires purpose=review or purpose=recovery');
    if(purpose&&!['review','recovery','decision'].includes(purpose))throw new SpecshipError('INSPECT_PURPOSE_REQUIRED','Inspection purpose must be review, recovery, or decision');
    const state=await this.store.load(runId);
    authorize(state,'inspect');
    const policy=state.wait_policy??={no_progress:0,inspect_count:0,inspect_window_start:0};
    const now=Date.now();
    if(!policy.inspect_window_start||now-policy.inspect_window_start>=60_000){policy.inspect_window_start=now;policy.inspect_count=0;}
    if(policy.inspect_count>=30)throw new SpecshipError('INSPECT_RATE_LIMITED','Inspection rate limit reached; use the delivered event or a recovery inspection',{retryable:true});
    policy.inspect_count++;
    await this.store.save(state);
  }
  async accept(runId:string,activityId:string,reportId:string,briefVersion:number,evidence:string):Promise<void>{
    const active=this.active.get(runId);const state=active?.state??await this.store.load(runId);
    authorize(state,'accept');
    if(state.lifecycle!=='awaiting_review'||state.writer||state.pending&&['question','permission','deferred','recovery_review'].includes((state.pending as any).kind)||state.activity_id!==activityId||state.report_id!==reportId||state.brief_version!==briefVersion||!state.report||!evidence.trim())throw new Error('Acceptance is stale, blocked, or has no independent review evidence');
    if(evidence.length>4_000)throw new SpecshipError('ACCEPTANCE_EVIDENCE_INCOMPLETE','Acceptance evidence must be at most 4000 characters');
    const brief=state.brief as Brief|undefined;const report=state.report as any;
    const requiredChecks=brief?.required_checks??[];
    const checks=(state.check_results??[]) as Array<Record<string, unknown>>;
    if(requiredChecks.length&&(checks.length!==requiredChecks.length||checks.some(check=>check.status!=='passed')))throw new SpecshipError('ACCEPTANCE_CHECKS_FAILED','One or more required acceptance checks did not pass; review the check evidence before accepting');
    const criteria=brief?.acceptance_criteria??[];const results=report.acceptance_results??[];
    const uncovered=criteria.filter(criterion=>!results.some((result:any)=>result.criterion_id===criterion.id&&result.evidence.trim()));
    if(uncovered.length)throw new SpecshipError('ACCEPTANCE_EVIDENCE_INCOMPLETE',`Acceptance evidence is missing for: ${uncovered.map(item=>item.id).join(', ')}`);
    const current=await checkpoint(this.shipRoot(state));
    if(state.workspace_checkpoint&&current&&changedPaths(state.workspace_checkpoint,current).length)throw new Error('Workspace changed since this report; review the changes and obtain fresh validation before accepting');
    const acceptedAt=state.accept_checkpoint??state.report_checkpoint;
    if(acceptedAt&&current&&changedPaths(acceptedAt,current).length)throw new Error('Workspace changed after this report; review the changes and obtain fresh validation before accepting');
    if(state.ship_workspace)await this.applyWorktree(state);
    if(active){
      if(active.timer)clearTimeout(active.timer);
      const stopped=await this.adapter.close?.(active.session);
      if(stopped===false)throw new Error('OpenCode server could not be closed after confirmed idle');
      active.eventAbort.abort();await active.hub.close();this.active.delete(runId);
    }
    transition(state,'accept');state.accepted={evidence,at:new Date().toISOString()};
    await this.store.save(state);await this.store.releaseWriter(runId);await this.store.removeInterruptDescriptor(runId);
  }
  async control(input: { run_id: string; operation_id: string; action: 'pause' | 'resume' | 'cancel'; reason: string; supervisor_handle?: string },meta?:{thread?:string;turn?:string},signal?:AbortSignal): Promise<unknown> {
    if(signal?.aborted)throw new Error('Control request was cancelled before applying the operation');
    const active = this.active.get(input.run_id);
    const state = active?.state ?? await this.store.load(input.run_id);
    authorize(state,input.action);
    const fingerprint=JSON.stringify({action:input.action,reason:input.reason});const old=state.operation_ids[input.operation_id] as any;
    if(old){if(old.fingerprint!==fingerprint)throw new Error('Operation ID was reused with different control input');return old.result??old;}
    if (state.supervisor?.handle !== input.supervisor_handle) throw new Error('Supervisor handle mismatch');
    this.bindCaller(state,meta);
    if (input.action === 'resume') {
      if(!active)throw new Error('Explicit specship_wait recovery is required before resume');
      if(active.waiting)throw new Error('Another supervisor wait is active for this run');
      if(state.deadline!=null&&Date.now()>=state.deadline){await this.expire(input.run_id);return state.events.filter((e:any)=>e.activity_id===state.activity_id&&e.kind==='limit_reached').at(-1);}
      const pending=state.pending as any;
      if(pending&&['question','permission','deferred','recovery_review'].includes(pending.kind)){
        const event=state.events.filter((e:any)=>e.activity_id===state.activity_id&&(e.kind==='decision_required'||e.kind==='user_input_required')).at(-1);
        if(event)return event;
        throw new Error('Paused run has an unresolved blocker; answer it before resuming');
      }
      const opId=(state.adapter as any)?.operation_id;let messageId=(state.adapter as any)?.message_id;
      if(!messageId){const match=await this.adapter.reconcileOperation?.(active.session,opId);if(!match||match.status==='unknown')throw new Error('Paused operation cannot be reconciled; no prompt was replayed');messageId=match.messageId;(state.adapter as any).message_id=messageId;}
      const reconciled=await this.adapter.reconcile(active.session,messageId);
      if(reconciled==='unknown')throw new Error('Paused OpenCode session identity cannot be reconciled');
      await this.store.claimWriter(state.run_id);
      state.writer=true;transition(state,'resume');state.report=undefined;state.report_id=undefined;
      state.handled_event_ids=[...new Set([...(state.handled_event_ids??[]),...state.events.map((event:any)=>event.event_id)])];active.stopping=undefined;
      const continuationId=`resume-${input.operation_id}`;
      const prompt=JSON.stringify({kind:'continue',instruction:'Continue the already-authorized activity from current repository and native session state. Do not replay completed work or restart the original prompt. Follow the current brief and report through report_result.',brief:state.brief,activity_id:state.activity_id});
      state.operation_ids[input.operation_id]={fingerprint,activity_id:state.activity_id,status:'continuation_pending',operation_id:continuationId};
      state.current_operation_id=input.operation_id;
      (state.adapter as any).operation_id=continuationId;(state.adapter as any).message_id=null;
      await this.store.save(state);
      if(reconciled==='complete')await this.adapter.reply(active.session,continuationId,prompt,await this.media(this.store.workspace,(state.brief as any)?.artifacts??[]));
      const submitted=await this.adapter.reconcileOperation?.(active.session,continuationId);
      if(submitted?.messageId){(state.adapter as any).message_id=submitted.messageId;(state.adapter as any).operation_id=continuationId;await this.store.save(state);}
      active.waiting=true;state.supervisor!.waiting=true;
      this.scheduleDeadline(state.run_id);await this.publishDescriptor(state,active.hub);
      try{const result=await this.blockUntilEvent(state,signal,active.aborter,active.hub,active.session,active.eventAbort);active.waiting=false;state.supervisor!.waiting=false;state.operation_ids[input.operation_id]={fingerprint,result};await this.store.save(state);return result;}
      finally{active.waiting=false;state.supervisor!.waiting=false;}
    }
    if (!active) throw new Error('No attached execution to stop; recovery must reconcile before another writer');
    if(active.waiting)throw new Error('Cannot control a run while another blocking supervisor call owns it');
    const confirmed = await active.hub.stop(input.reason);
    if (!confirmed) throw new Error('Stop request recorded but execution quiescence is unconfirmed');
    state.writer = false;
    transition(state,input.action === 'cancel' ? 'cancel' : 'pause');
    const event = await this.store.emit(state, input.action === 'cancel' ? 'cancelled' : 'paused', { reason: input.reason });
    state.operation_ids[input.operation_id] = {fingerprint,result:event};
    await this.store.save(state);
    await this.store.releaseWriter(state.run_id);
    await this.store.removeInterruptDescriptor(state.run_id);
    if(input.action==='cancel'){if(!await this.disposeActive(input.run_id,true))throw new Error('Ship is idle but its owned server could not be closed');}
    return event;
  }
  async close(): Promise<void> {
    for (const runId of [...this.active.keys()]) {
      const active = this.active.get(runId);
      if (!active) continue;
      const state = active.state;
      const stopped = await this.disposeActive(runId, true);
      if (stopped && state.lifecycle !== 'awaiting_review' && state.lifecycle !== 'completed') {
        state.writer = false;
        setPhase(state, 'paused');
        await this.store.releaseWriter(state.run_id);
        await this.store.emit(state, 'paused', { reason: 'runner closed; Ship stop confirmed' });
        await this.store.removeInterruptDescriptor(state.run_id);
      } else if (!stopped) {
        state.cleanup_pending = true;
        await this.store.save(state).catch(() => {});
      }
    }
  }
}
