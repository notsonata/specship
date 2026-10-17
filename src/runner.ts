import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Brief, type ActivityKind, type MaterialEvent, type Profile, type Report } from './contracts.js';
import { resolveProfile } from './config.js';
import { materializeArtifacts, MAX_ARTIFACT_BYTES, verifyArtifact } from './artifacts.js';
import { Store, type RunState } from './state.js';
import { CallbackHub } from './callbacks.js';
import type { AdapterEvent, ShipAdapter } from './adapters/types.js';
import type { RunnerConfig } from './contracts.js';
import { checkpoint, changedPaths } from './workspace.js';

export class Runner {
  private active = new Map<string, { hub: CallbackHub; session: string; aborter: AbortController; eventAbort: AbortController; state: RunState; waiting: boolean; timer?: NodeJS.Timeout; stopping?: Promise<boolean> }>();
  constructor(private store: Store, private config: RunnerConfig, private adapter: ShipAdapter) {}
  profiles(){return this.config.ship;}
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
    const release=await this.store.lock();let state:RunState|undefined;let hub:CallbackHub|undefined;let started=false;const aborter=new AbortController();
    const cancel=()=>aborter.abort();signal?.addEventListener('abort',cancel,{once:true});
    try{
      if(input.workspace&&resolve(input.workspace)!==resolve(this.store.workspace))throw new Error('Dispatch workspace must match the configured MCP workspace');
       const fingerprint=JSON.stringify({workspace:resolve(input.workspace??this.store.workspace),kind:input.kind,profile:input.ship_profile,assignment:input.assignment,brief:input.brief,artifacts:input.artifacts,corrections:input.corrections,expected_brief_version:input.expected_brief_version});
       if(!input.run_id){const prior=await this.store.findOperation(input.operation_id);if(prior){const record=prior.result as any;if(record?.fingerprint&&record.fingerprint!==fingerprint)throw new Error('Operation ID was reused with different dispatch input');const event=record?.result??record;if(event?.event_id)return event as MaterialEvent;throw new Error('Operation was already prepared/submitted; reconcile its exact saved adapter message instead of replaying');}}
       if(!input.run_id&&this.active.size)throw new Error('Workspace writer is owned by an attached Ship context; accept or cancel it before starting another run');
       const attached = input.run_id ? this.active.get(input.run_id) : undefined;
        state = attached?.state ?? (input.run_id ? await this.store.load(input.run_id) : await this.store.create());
       if(attached){if(input.supervisor_handle!==state.supervisor?.handle)throw new Error('Exact supervisor_handle is required');this.bindCaller(state,meta);}
       if(state.operation_ids[input.operation_id]){const recorded=state.operation_ids[input.operation_id] as any;if(recorded.fingerprint&&recorded.fingerprint!==fingerprint)throw new Error('Operation ID was reused with different dispatch input');const event=recorded.result??recorded;if(event.event_id)return event as MaterialEvent;throw new Error('Operation was already prepared/submitted; reconcile its exact saved adapter message instead of replaying');}
      if(state.writer)throw new Error('A Ship writer is already active');if(input.expected_brief_version!==undefined&&input.expected_brief_version!==state.brief_version)throw new Error('Stale brief version');
       let nextBrief=state.brief;
       if(input.kind!=='explore'){const parsed=Brief.parse(input.brief??state.brief);const artifacts=await materializeArtifacts(this.store.workspace,parsed.artifacts??[]);nextBrief={...parsed,artifacts};}
       else nextBrief={artifacts:await materializeArtifacts(this.store.workspace,input.artifacts??[])};
       const selected=resolveProfile(this.config,input.ship_profile);const media=await this.media(this.store.workspace,(nextBrief as any)?.artifacts??[]);await this.adapter.validate(selected.profile,media.map(m=>m.mime));
       if (attached && JSON.stringify(state.profile) !== JSON.stringify({ name: selected.name, ...selected.profile })) throw new Error('A correction must keep the active run profile unchanged');
       await this.store.claimWriter(state.run_id);
       started=true;state.brief=nextBrief;if(input.kind!=='explore')state.brief_version++;
        state.profile={name:selected.name,...selected.profile};state.activity_id=randomUUID();state.activity_kind=input.kind;state.writer=true;state.lifecycle='running';state.deadline=Date.now()+this.config.limits.max_dispatch_seconds*1000;
        state.supervisor={handle:state.supervisor?.handle??randomUUID(),thread:meta?.thread??state.supervisor?.thread,turn:meta?.turn??state.supervisor?.turn,waiting:true};
        state.report = undefined;
        state.report_id = undefined;
       state.pending = undefined;
        state.operation_ids[input.operation_id]={fingerprint,status:'prepared',activity_id:state.activity_id,operation_id:input.operation_id};
        state.current_operation_id=input.operation_id;
        state.workspace_checkpoint=await checkpoint(this.store.workspace);
       await this.store.save(state);
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
          native = await this.adapter.start(this.store.workspace,selected.profile,input.kind,{url:hub.url,capability:hub.token,descriptorPath:this.store.callbackDescriptorPath(state.run_id),timeoutMs:Math.max(1,state.deadline!-Date.now()+this.config.limits.delivery_margin_seconds*1000)});
          session = native.session; sessionId = session;
          state.adapter={adapter:this.adapter.name,session:native.session,version:native.version,message_id:null,operation_id:input.operation_id};
         eventAbort = new AbortController();
         await this.adapter.subscribe(session,eventAbort.signal);
         const pump=this.consume(session,eventAbort.signal,hub,state).catch(e=>{void this.store.emit(state!,'execution_failed',{message:String(e)});});
           this.active.set(state.run_id,{hub,session,aborter,eventAbort,state,waiting:true});
           await this.publishDescriptor(state,hub);
           this.scheduleDeadline(state.run_id);
         void pump;
        }
        if(this.adapter.snapshot)await this.store.writePrivate(state.run_id,'adapter.json',await this.adapter.snapshot(session));
        const prompt=JSON.stringify({kind:input.kind,assignment:input.assignment,brief:state.brief,corrections:input.corrections,activity_id:state.activity_id});
        state.operation_ids[input.operation_id]={fingerprint,status:'submission_pending',activity_id:state.activity_id,session,operation_id:input.operation_id};
        await this.store.save(state);
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
         await this.adapter.close?.(session);eventAbort.abort();await hub.close();this.active.delete(state.run_id);
       }
       return event;
    } catch (error) {
      if (state && started) {
        const active = this.active.get(state.run_id);
        if (active) {
          const stopped = this.adapter.close
            ? await this.adapter.close(active.session).catch(() => false)
            : await this.adapter.abort(active.session).catch(() => false);
          if (stopped) {
            state.writer = false;
            state.lifecycle = 'paused';
            await this.store.releaseWriter(state.run_id).catch(() => {});
            await this.store.emit(state, 'paused', { reason: 'runner error; adapter stop confirmed' }).catch(() => {});
            active.eventAbort.abort();
            await active.hub.close();
            this.active.delete(state.run_id);
          }
        } else {state.lifecycle='failed';state.writer=false;await this.store.releaseWriter(state.run_id).catch(()=>{});}
        await this.store.save(state).catch(() => {});
      }
      throw error;
    }
    finally {
      signal?.removeEventListener('abort', cancel);
      if (state?.lifecycle === 'failed' || state?.lifecycle === 'paused' || state?.lifecycle === 'awaiting_review' && !this.active.has(state.run_id)) this.active.delete(state.run_id);
      if (!state||!this.active.has(state.run_id)) await hub?.close();
      await release();
    }
  }
  private async consume(session:string,signal:AbortSignal,_hub:CallbackHub,state:RunState):Promise<void>{
    for await(const e of this.adapter.events(session,signal)){
      if(e.type==='permission'){
        const data=e.data as any;const id=data.permissionID??data.id??data.requestID;
        if(!id||(state.pending as any)?.id===id)continue;
        state.pending={kind:'permission',id,body:data};await this.store.emit(state,'user_input_required',data);
      }
      if(e.type==='error'){
        const expectedAbort=(e.data as any)?.error?.name==='MessageAbortedError'&&((state.stop_request as any)?.status==='requested'||this.active.get(state.run_id)?.stopping);
        if(!expectedAbort)await this.store.emit(state,'execution_failed',e.data);
      }
    }
  }
  private async publishDescriptor(state:RunState,hub:CallbackHub):Promise<void>{const {thread,turn}=state.supervisor??{};if(thread&&turn)await this.store.publishInterruptDescriptor({run_id:state.run_id,session_id:thread,turn_id:turn,url:hub.url,capability:hub.token});await hub.refreshDescriptor();}
  private scheduleDeadline(runId:string):void{const active=this.active.get(runId);if(!active||active.timer)return;const delay=Math.max(0,active.state.deadline!-Date.now());active.timer=setTimeout(()=>{active.timer=undefined;void this.expire(runId);},delay);}
  private async stop(active:{hub:CallbackHub;session:string;state:RunState;stopping?:Promise<boolean>}):Promise<boolean>{if(!active.stopping)active.stopping=this.adapter.abort(active.session).catch(()=>false);const confirmed=await active.stopping;if(confirmed)active.hub.detachPending();return confirmed;}
  private async expire(runId:string):Promise<void>{const active=this.active.get(runId);if(!active)return;const state=active.state;if(state.events.some((event:any)=>event.kind==='limit_reached'&&event.activity_id===state.activity_id))return;const stopped=await this.stop(active);if(stopped){state.writer=false;state.lifecycle='paused';if(active.timer)clearTimeout(active.timer);await this.store.releaseWriter(runId);await this.store.removeInterruptDescriptor(runId);await this.store.emit(state,'limit_reached',{max_dispatch_seconds:this.config.limits.max_dispatch_seconds,stop_confirmed:true});}else{await this.store.emit(state,'limit_reached',{max_dispatch_seconds:this.config.limits.max_dispatch_seconds,stop_confirmed:false,writer_retained:true});}}
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
      if((snapshot as any)?.workspace&&(snapshot as any).workspace!==this.store.workspace)throw new Error('Saved adapter workspace does not match this run');
      try{await this.store.reclaimWriter(runId);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'&&!state.writer)await this.store.claimWriter(runId);else throw error;}
      hub=new CallbackHub(this.store,state,async()=>{if(!restored)return false;return this.adapter.abort(restored.session);},this.config.limits.delivery_margin_seconds*1000);
      await hub.start();
      if(!this.adapter.restore)throw new Error('Selected adapter does not implement authenticated session restoration');
      restored=await this.adapter.restore(snapshot,{url:hub.url,capability:hub.token,descriptorPath:this.store.callbackDescriptorPath(runId),timeoutMs:Math.max(1,state.deadline!-Date.now()+this.config.limits.delivery_margin_seconds*1000)});
      if(this.adapter.snapshot)await this.store.writePrivate(runId,'adapter.json',await this.adapter.snapshot(restored.session));
      const eventAbort=new AbortController();await this.adapter.subscribe(restored.session,eventAbort.signal);
      const active={hub,session:restored.session,aborter:new AbortController(),eventAbort,state,waiting:false as boolean,timer:undefined as NodeJS.Timeout|undefined,stopping:undefined as Promise<boolean>|undefined};
      this.active.set(runId,active);
      if(state.lifecycle!=='awaiting_review')this.scheduleDeadline(runId);
      const pump=this.consume(restored.session,eventAbort.signal,hub,state).catch(error=>{void this.store.emit(state!,'execution_failed',{message:String(error)});});void pump;
      state.adapter={...(state.adapter as any),session:restored.session,version:restored.version};
      const currentCheckpoint=await checkpoint(this.store.workspace);
      const drift=state.workspace_checkpoint&&currentCheckpoint?changedPaths(state.workspace_checkpoint,currentCheckpoint):[];
      if(drift.length){
        if(!await this.stop(active)){await this.store.emit(state,'execution_failed',{reason:'Workspace changed and stop is unconfirmed; writer retained'});return state.events.at(-1) as MaterialEvent;}
        state.report=undefined;state.report_id=undefined;state.lifecycle='awaiting_spec';state.writer=false;
        state.pending={kind:'recovery_review',id:randomUUID(),body:{blocker:'Workspace files changed since the saved material event. Saved validation is no longer current.',evidence:drift.slice(0,100),attempts:['Compared local content hashes after reconnecting and confirming native stop'],decision:'Review the changed files and specify the authorized continuation and validation before Ship resumes.'}};
        return await this.store.emit(state,'decision_required',state.pending) as MaterialEvent;
      }
      if(state.lifecycle!=='awaiting_review'&&Date.now()>=state.deadline!){await this.expire(runId);return state.events.at(-1) as MaterialEvent;}
      const opEntry=state.current_operation_id?[state.current_operation_id,state.operation_ids[state.current_operation_id]] as [string,any]:Object.entries(state.operation_ids).filter(([,value]:any)=>value?.activity_id===state!.activity_id).at(-1) as [string,any]|undefined;
      if(!opEntry)throw new Error('Current activity has no durable operation intent');
      const [operationKey,intent]=opEntry;const operationId=intent.operation_id??operationKey;
      let messageId=(state.adapter as any).message_id as string|undefined;
      if(!messageId){
        if(!this.adapter.reconcileOperation)throw new Error('Adapter cannot reconcile ambiguous submission; prompt will not be replayed');
        const matched=await this.adapter.reconcileOperation(restored.session,operationId);
        if(matched.status==='unknown'){
          const stopped=await this.stop(active);
          if(stopped){state.writer=false;state.lifecycle='paused';await this.store.releaseWriter(runId);await this.store.emit(state,'execution_failed',{reason:'submission outcome is ambiguous; confirmed stopped; do not retry original prompt'});}
          else await this.store.emit(state,'execution_failed',{reason:'submission outcome is ambiguous and stop is unconfirmed; writer retained'});
          return state.events.at(-1) as MaterialEvent;
        }
        messageId=matched.messageId;(state.adapter as any).message_id=messageId;await this.store.save(state);
      }
      if(state.pending&&['question','permission','deferred','recovery_review'].includes((state.pending as any).kind)){
        const stopped=await this.stop(active);
        if(!stopped){await this.store.emit(state,'execution_failed',{reason:'recovery could not confirm quiescence of the old callback turn; writer retained'});return state.events.at(-1) as MaterialEvent;}
        const isDecision=['question','recovery_review'].includes((state.pending as any).kind);
        state.lifecycle=isDecision?'awaiting_spec':'awaiting_user';state.writer=false;state.supervisor!.waiting=false;await this.store.save(state);
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
      if(state.report){
        const status=await this.adapter.reconcile(restored.session,messageId!);
        if(status==='complete'){
          const existing=state.events.filter((item:any)=>item.activity_id===state!.activity_id&&['implementation_ready','exploration_completed','decision_required','execution_failed'].includes(item.kind)).at(-1) as MaterialEvent|undefined;
          if(existing)return existing;
          return await this.blockUntilEvent(state,signal,active.aborter,hub,restored.session,eventAbort);
        }
      }
      state.lifecycle='running';state.writer=true;state.supervisor!.waiting=true;active.stopping=undefined;await this.store.save(state);
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
    const end = state.deadline!;
    while (true) {
      if (signal?.aborted) {
        aborter.abort();
        const stopped = await this.stop(this.active.get(state.run_id)!);
        if (!stopped) throw new Error('Stop could not be verified; writer remains unsafe');
        state.writer = false;
        state.lifecycle = 'paused';
        await this.store.releaseWriter(state.run_id);
        await this.store.removeInterruptDescriptor(state.run_id);
        const paused = await this.store.emit(state, 'paused', { reason: 'supervisor cancellation' }) as MaterialEvent;
        return paused;
      }

      const unresolved = state.pending as { kind?: string; id?: string } | undefined;
      const material = state.events.find((event: any) =>
        event.activity_id===state.activity_id&&event.event_id !== skipEventId && !(state.handled_event_ids??[]).includes(event.event_id) && (
        ['user_input_required', 'execution_failed', 'paused', 'cancelled', 'limit_reached'].includes(event.kind) ||
        (event.kind === 'decision_required' && ['question','recovery_review'].includes(unresolved?.kind??'') && event.payload?.id === unresolved?.id)),
      ) as MaterialEvent | undefined;
      if (material) {
        if(material.kind==='decision_required')state.lifecycle='awaiting_spec';else if(material.kind==='user_input_required')state.lifecycle='awaiting_user';
        await this.store.save(state);
        return material;
      }

      if(Date.now()>=end){await this.expire(state.run_id);const limit=state.events.find((event:any)=>event.activity_id===state.activity_id&&['limit_reached','execution_failed'].includes(event.kind));if(limit)return limit as MaterialEvent;}

      if (state.report) {
        const report = state.report as Report;
        const messageId = (state.adapter as any)?.message_id;
        const quiescence = await this.adapter.reconcile(session, messageId);
        if (quiescence === 'complete') {
          state.writer = false;
          const isExploration = state.activity_kind === 'explore';
          const status = 'status' in report ? report.status : undefined;
          state.lifecycle = !isExploration && status === 'ready_for_review' ? 'awaiting_review' : !isExploration&&status==='needs_decision'?'awaiting_spec':'idle';
          if (state.lifecycle !== 'awaiting_review') await this.store.releaseWriter(state.run_id);
          const kind = isExploration ? 'exploration_completed' : status === 'ready_for_review' ? 'implementation_ready' : status === 'needs_decision' ? 'decision_required' : 'execution_failed';
          return await this.store.emit(state, kind, { report,...(status==='needs_decision'?{request_id:state.report_id}:{}) }) as MaterialEvent;
        }
      }
      await new Promise(resolve => setTimeout(resolve, 40));
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
    if (state.brief_version !== input.expected_brief_version) throw new Error('Stale reply');
    const question = state.pending as any;
    if (question?.id !== input.request_id) throw new Error('Stale request ID');
    if(question.kind==='report'){
      if((state.report as any)?.status!=='needs_decision')throw new Error('The current report has no pending decision; review, correct, or accept it');
      state.report=undefined;state.report_id=undefined;
    }
    if(active.waiting)throw new Error('Another supervisor wait is active for this run');
    if(input.defer_to_user){state.pending={...question,kind:'deferred'};state.lifecycle='awaiting_user';state.supervisor!.waiting=false;const event=await this.store.emit(state,'user_input_required',{request_id:input.request_id,reason:'decision deferred to user'} ) as MaterialEvent;state.operation_ids[input.operation_id]={fingerprint,result:event};await this.store.save(state);return event;}
    if (input.brief) { const parsed=Brief.parse(input.brief);state.brief={...parsed,artifacts:await materializeArtifacts(this.store.workspace,parsed.artifacts??[])};state.brief_version++; }
    if(!state.writer)await this.store.claimWriter(state.run_id);
    if(question.kind==='permission'){
      if(!['once','always','reject'].includes(input.answer))throw new Error('Permission answer must be once, always, or reject');
      state.handled_event_ids=[...new Set([...(state.handled_event_ids??[]),...state.events.filter((event:any)=>event.activity_id===state.activity_id).map((event:any)=>event.event_id)])];
      state.operation_ids[input.operation_id]={fingerprint,answer:input.answer};state.pending={...question,kind:'permission_answer',answer:input.answer};state.lifecycle='running';await this.store.save(state);
       await this.adapter.resolvePermission?.(active.session,question.id,input.answer as 'once'|'always'|'reject');
    } else {
    const requested = new Set<string>(question.body?.image_artifact_ids ?? []);
    const refs = ((state.brief as any)?.artifacts ?? []).filter((artifact: any) => requested.has(artifact.id));
    if (refs.length !== requested.size) throw new Error('Callback references an unknown or stale image artifact');
    const images = await this.media(this.store.workspace, refs);
    state.handled_event_ids=[...new Set([...(state.handled_event_ids??[]),...state.events.filter((event:any)=>event.activity_id===state!.activity_id).map((event:any)=>event.event_id)])];
    state.operation_ids[input.operation_id] = { fingerprint, activity_id:state.activity_id, operation_id:input.operation_id, status:'answer_durable', answer: input.answer };
    state.current_operation_id=input.operation_id;
    state.pending = { kind: 'answer', id:input.request_id, request_id: input.request_id, answer: input.answer, question };
    state.lifecycle = 'running';state.writer=true;
    if (Date.now() >= state.deadline!) throw new Error('Activity deadline expired; Ship stop is being reconciled');
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
    const unresolved=state.pending as any;
    const relevant=state.events.filter((event:any)=>event.activity_id===state.activity_id&&!(state.handled_event_ids??[]).includes(event.event_id)&&(
      ['question','recovery_review'].includes(unresolved?.kind??'')&&event.kind==='decision_required'&&event.payload?.id===unresolved.id||
      unresolved?.kind==='permission'&&event.kind==='user_input_required'&&(event.payload?.permissionID??event.payload?.id??event.payload?.requestID)===unresolved.id||
      unresolved?.kind==='deferred'&&event.kind==='user_input_required'&&event.payload?.request_id===unresolved.id||
      state.lifecycle==='awaiting_review'&&event.kind==='implementation_ready'||
      ['paused','cancelled','limit_reached','execution_failed'].includes(event.kind)
    ));
    const current=relevant.at(-1) as MaterialEvent|undefined;
    if(current&&current.event_id!==lastEventId)return current;
    if(active.waiting)throw new Error('A blocking supervisor wait is already active');
    active.waiting=true;state.supervisor!.waiting=true;
    try{const event=await this.blockUntilEvent(state,signal,active.aborter,active.hub,active.session,active.eventAbort,lastEventId);if(active.timer&&['paused','cancelled','completed','awaiting_review','idle'].includes(state.lifecycle)){clearTimeout(active.timer);active.timer=undefined;}return event;}
    finally{active.waiting=false;state.supervisor!.waiting=false;await this.store.save(state);}
  }
  async accept(runId:string,activityId:string,reportId:string,briefVersion:number,evidence:string):Promise<void>{
    const active=this.active.get(runId);const state=active?.state??await this.store.load(runId);
    if(state.lifecycle!=='awaiting_review'||state.writer||state.pending&&['question','permission','deferred','recovery_review'].includes((state.pending as any).kind)||state.activity_id!==activityId||state.report_id!==reportId||state.brief_version!==briefVersion||!state.report||!evidence.trim())throw new Error('Acceptance is stale, blocked, or has no independent review evidence');
    const current=await checkpoint(this.store.workspace);
    if(state.workspace_checkpoint&&current&&changedPaths(state.workspace_checkpoint,current).length)throw new Error('Workspace changed since this report; review the changes and obtain fresh validation before accepting');
    if(active){
      if(active.timer)clearTimeout(active.timer);
      const stopped=await this.adapter.close?.(active.session);
      if(stopped===false)throw new Error('OpenCode server could not be closed after confirmed idle');
      active.eventAbort.abort();await active.hub.close();this.active.delete(runId);
    }
    state.lifecycle='completed';state.accepted={evidence,at:new Date().toISOString()};
    await this.store.save(state);await this.store.releaseWriter(runId);await this.store.removeInterruptDescriptor(runId);
  }
  async control(input: { run_id: string; operation_id: string; action: 'pause' | 'resume' | 'cancel'; reason: string; supervisor_handle?: string },meta?:{thread?:string;turn?:string},signal?:AbortSignal): Promise<unknown> {
    if(signal?.aborted)throw new Error('Control request was cancelled before applying the operation');
    const active = this.active.get(input.run_id);
    const state = active?.state ?? await this.store.load(input.run_id);
    const fingerprint=JSON.stringify({action:input.action,reason:input.reason});const old=state.operation_ids[input.operation_id] as any;
    if(old){if(old.fingerprint!==fingerprint)throw new Error('Operation ID was reused with different control input');return old.result??old;}
    if (state.supervisor?.handle !== input.supervisor_handle) throw new Error('Supervisor handle mismatch');
    this.bindCaller(state,meta);
    if (input.action === 'resume') {
      if(!active)throw new Error('Explicit specship_wait recovery is required before resume');
      if(active.waiting)throw new Error('Another supervisor wait is active for this run');
      if(Date.now()>=state.deadline!){await this.expire(input.run_id);return state.events.filter((e:any)=>e.activity_id===state.activity_id&&e.kind==='limit_reached').at(-1);}
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
      state.writer=true;state.lifecycle='running';state.report=undefined;state.report_id=undefined;
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
    state.lifecycle = input.action === 'cancel' ? 'cancelled' : 'paused';
    const event = await this.store.emit(state, input.action === 'cancel' ? 'cancelled' : 'paused', { reason: input.reason });
    state.operation_ids[input.operation_id] = {fingerprint,result:event};
    await this.store.save(state);
    await this.store.releaseWriter(state.run_id);
    await this.store.removeInterruptDescriptor(state.run_id);
    if(input.action==='cancel'){if(await this.adapter.close?.(active.session)===false)throw new Error('Ship is idle but its owned server could not be closed');active.eventAbort.abort();await active.hub.close();this.active.delete(input.run_id);}
    return event;
  }
  async close(): Promise<void> {
    for (const active of this.active.values()) {
      if(active.timer)clearTimeout(active.timer);
      const state = active.state;
      if(active.timer)clearTimeout(active.timer);
      const stopped = this.adapter.close
        ? await this.adapter.close(active.session).catch(() => false)
        : await this.adapter.abort(active.session).catch(() => false);
      if (stopped && state.lifecycle !== 'awaiting_review' && state.lifecycle !== 'completed') {
        state.writer = false;
        state.lifecycle = 'paused';
        await this.store.releaseWriter(state.run_id);
        await this.store.emit(state, 'paused', { reason: 'runner closed; Ship stop confirmed' });
        await this.store.removeInterruptDescriptor(state.run_id);
      }
      active.eventAbort.abort();
      await active.hub.close();
    }
    this.active.clear();
  }
}
