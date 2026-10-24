import { createHash, randomUUID } from 'node:crypto';
import { appendFile, open, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkpoint, type WorkspaceCheckpoint } from './workspace.js';
import { preparePrivateStorage, privateDirectory } from './private-storage.js';
import { assertInvariants, legacyPhase, phaseFromLegacy, setPhase, type Phase } from './policy.js';

export interface DecisionCallback { activity_id: string; brief_version: number; fingerprint: string; answer?: { text: string; artifacts: unknown[] } }

export interface RunState { schema: 1 | 2; phase?: Phase; last_phase?: Phase; last_transition_hash?: string; state_version?: number; run_id: string; workspace: string; workspace_checkpoint?:WorkspaceCheckpoint; report_checkpoint?:WorkspaceCheckpoint; accept_checkpoint?:WorkspaceCheckpoint; check_results?: unknown[]; lifecycle: string; writer: boolean; supervisor?: { handle: string; thread?: string; turn?: string; waiting: boolean }; brief?: unknown; brief_version: number; operation_ids: Record<string, unknown>; decision_callbacks?: Record<string, DecisionCallback>; current_operation_id?:string; events: unknown[]; handled_event_ids?: string[]; profile?: unknown; activity_id?: string; activity_kind?: string; pending?: unknown; stop_request?: unknown; report?: unknown; report_id?: string; accepted?: unknown; adapter?: unknown; capabilities?: unknown; isolation?: 'shared'|'worktree'; ship_workspace?: string; checkpoint_root?: string; deadline?: number | null; remaining_ms?: number; cleanup_pending?: boolean; wait_policy?: { last_event_id?: string; no_progress: number; inspect_count: number; inspect_window_start: number }; }
export class Store {
  readonly dir: string;
  private writes=new Map<string,Promise<void>>();
  private listeners=new Map<string,Set<() => void>>();
  constructor(readonly workspace: string) { this.dir = join(workspace, '.specship'); }
  onChange(runId:string,listener:() => void):() => void {
    let set=this.listeners.get(runId);
    if(!set){set=new Set();this.listeners.set(runId,set);}
    set.add(listener);
    return () => {const current=this.listeners.get(runId);if(!current)return;current.delete(listener);if(!current.size)this.listeners.delete(runId);};
  }
  notify(runId:string):void { for(const listener of [...(this.listeners.get(runId)??[])]) listener(); }
  async initialize(): Promise<void> { await preparePrivateStorage(this.workspace); await privateDirectory(join(this.dir, 'runs')); await privateDirectory(join(this.dir, 'artifacts')); }
  async lock(recovery=false): Promise<() => Promise<void>> {
    await this.initialize();const path=join(this.dir,'writer.lock');let lock;
    const {unlink}=await import('node:fs/promises');let guard;
    if(recovery){try{guard=await open(join(this.dir,'recovery.lock'),'wx',0o600);await guard.writeFile(JSON.stringify({pid:process.pid,started_at:new Date().toISOString()}));}catch{throw new Error('Recovery guard exists: inspect .specship/recovery.lock and verify its owner has exited before removing a stale guard');}}
    try{
    try{lock=await open(path,'wx',0o600);}catch(error:any){
      if(error.code!=='EEXIST'||!recovery)throw new Error('Workspace has an active or unreconciled state writer');
      const old=JSON.parse(await readFile(path,'utf8'));if(!Number.isInteger(old.pid)||this.pidAlive(old.pid))throw new Error('State writer may still be alive; refusing to reclaim lock');
      const current=JSON.parse(await readFile(path,'utf8'));if(current.pid!==old.pid||current.started_at!==old.started_at)throw new Error('Writer lock changed during recovery');
      const {unlink}=await import('node:fs/promises');await unlink(path);lock=await open(path,'wx',0o600);
    }
    await lock.writeFile(JSON.stringify({pid:process.pid,started_at:new Date().toISOString()}));
    return async()=>{await lock!.close();const {unlink}=await import('node:fs/promises');await unlink(path).catch(()=>{});};
    }finally{if(guard){await guard.close();await unlink(join(this.dir,'recovery.lock')).catch(()=>{});}}
  }
  async claimWriter(runId:string):Promise<void>{const path=join(this.dir,'active-writer.json');try{await writeFile(path,JSON.stringify({run_id:runId,pid:process.pid,claimed_at:new Date().toISOString()}),{flag:'wx',mode:0o600});}catch(e:any){if(e.code!=='EEXIST')throw e;const current=JSON.parse(await readFile(path,'utf8'));if(current.run_id!==runId||current.pid!==process.pid)throw new Error(`Workspace writer is owned by run ${current.run_id}; reconcile or stop it before dispatch`);}}
  async reclaimWriter(runId:string):Promise<void>{const path=join(this.dir,'active-writer.json');const current=JSON.parse(await readFile(path,'utf8'));if(current.run_id!==runId)throw new Error('Writer lease belongs to a different run');if(!Number.isInteger(current.pid)||this.pidAlive(current.pid))throw new Error('Saved writer process may still be alive; refusing lease theft');const {unlink}=await import('node:fs/promises');await unlink(path);await writeFile(path,JSON.stringify({run_id:runId,pid:process.pid,claimed_at:new Date().toISOString(),recovered:true}),{flag:'wx',mode:0o600});}
  private pidAlive(pid:number):boolean{try{process.kill(pid,0);return true;}catch(e:any){return e.code==='EPERM';}}
  callbackDescriptorPath(runId:string):string{return join(this.runDir(runId),'callback.json');}
  async writeCallbackDescriptor(runId:string,value:unknown):Promise<void>{const dir=this.runDir(runId);await privateDirectory(dir);const temp=join(dir,`callback.${randomUUID()}.tmp`);await writeFile(temp,JSON.stringify(value),{flag:'wx',mode:0o600});await rename(temp,this.callbackDescriptorPath(runId));}
  async readPrivate(runId:string,name:string):Promise<unknown>{if(!['adapter.json'].includes(name))throw new Error('Invalid private state name');return JSON.parse(await readFile(join(this.runDir(runId),name),'utf8'));}
  async writePrivate(runId:string,name:string,value:unknown):Promise<void>{if(!['adapter.json'].includes(name))throw new Error('Invalid private state name');const dir=this.runDir(runId);await privateDirectory(dir);const path=join(dir,name),temp=join(dir,`${name}.${randomUUID()}.tmp`);await writeFile(temp,JSON.stringify(value),{flag:'wx',mode:0o600});await rename(temp,path);}
  async releaseWriter(runId:string):Promise<void>{const path=join(this.dir,'active-writer.json');for(let attempt=0;attempt<5;attempt++){try{const current=JSON.parse(await readFile(path,'utf8'));if(current.run_id===runId){const {unlink}=await import('node:fs/promises');await unlink(path);}return;}catch(e:any){if(e.code==='ENOENT')return;if(e.code!=='EPERM'||attempt===4)throw e;await new Promise(resolve=>setTimeout(resolve,20*(attempt+1)));}}}
  async publishInterruptDescriptor(value: unknown): Promise<void> { const temp=join(this.dir,`active-run.${randomUUID()}.tmp`);await writeFile(temp,JSON.stringify(value),{flag:'wx',mode:0o600});await rename(temp,join(this.dir,'active-run.json')); }
  async removeInterruptDescriptor(runId:string):Promise<void>{const path=join(this.dir,'active-run.json');try{const value=JSON.parse(await readFile(path,'utf8'));if(value.run_id===runId){const {unlink}=await import('node:fs/promises');await unlink(path);}}catch(e:any){if(e.code!=='ENOENT')throw e;}}
  runDir(id: string): string { if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error('Invalid run ID'); return join(this.dir, 'runs', id); }
  async create(): Promise<RunState> { const state: RunState = { schema: 2, phase: 'idle', last_phase: 'idle', state_version: 0, run_id: randomUUID(), workspace: this.workspace, lifecycle: 'idle', writer: false, brief_version: 0, operation_ids: {}, events: [] }; await this.save(state); return state; }
  private async renameWithRetry(temp:string,target:string):Promise<void>{
    let delay=20;
    for(let attempt=0;;attempt++){
      try{await rename(temp,target);return;}
      catch(error:any){
        const transient=process.platform==='win32'&&['EPERM','EBUSY','EACCES'].includes(error?.code);
        if(!transient||attempt>=8)throw error;
        await new Promise(resolve=>setTimeout(resolve,delay));
        delay=Math.min(delay*2,200);
      }
    }
  }
  async save(state: RunState): Promise<void> {
    state.schema = 2;
    if (!state.phase) state.phase = phaseFromLegacy(state.lifecycle);
    // Keep the compatibility projection consistent while older call sites still
    // assign lifecycle directly. New policy transitions call setPhase explicitly.
    if (legacyPhase(state.phase) !== state.lifecycle) setPhase(state, phaseFromLegacy(state.lifecycle));
    assertInvariants(state);
    state.state_version = (state.state_version ?? 0) + 1;
    const dir = this.runDir(state.run_id);
    await this.initialize();
    await privateDirectory(dir);
    if (!state.last_phase) state.last_phase = state.phase;
    if (state.last_phase !== state.phase) {
      const record = { from: state.last_phase, to: state.phase, at: new Date().toISOString(), state_version: state.state_version, prev_hash: state.last_transition_hash ?? null };
      const hash = createHash('sha256').update(JSON.stringify(record)).digest('hex');
      await appendFile(join(dir, 'transitions.jsonl'), `${JSON.stringify({ ...record, hash })}\n`, { mode: 0o600 }).catch(() => {});
      state.last_transition_hash = hash;
      state.last_phase = state.phase;
    }
    const snapshot = JSON.stringify(state);
    const path = join(dir, 'state.json');
    const previous = this.writes.get(path) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(async () => {
      const temp = join(dir, `state.${randomUUID()}.tmp`);
      await writeFile(temp, snapshot, { flag: 'wx', mode: 0o600 });
      await this.renameWithRetry(temp, path);
    });
    this.writes.set(path, current);
    try {
      await current;
    } finally {
      if (this.writes.get(path) === current) this.writes.delete(path);
    }
  }
  async load(id: string): Promise<RunState> {
    const raw = await readFile(join(this.runDir(id),'state.json'),'utf8');
    const value=JSON.parse(raw) as any;
    const lifecycle=['idle','running','awaiting_spec','awaiting_user','awaiting_review','paused','completed','failed','cancelled','limit_reached'];
    if(!value||![1,2].includes(value.schema)||value.run_id!==id||value.workspace!==this.workspace||!lifecycle.includes(value.lifecycle)||typeof value.writer!=='boolean'||!Number.isInteger(value.brief_version)||value.brief_version<0||!value.operation_ids||typeof value.operation_ids!=='object'||!Array.isArray(value.events))throw new Error('Corrupt or mismatched authoritative run state');
    for(const event of value.events)if(!event||typeof event.event_id!=='string'||typeof event.kind!=='string'||event.run_id!==id)throw new Error('Corrupt durable event in authoritative run state');
    if(value.schema===1){
      const dir=this.runDir(id);await privateDirectory(dir);
      await writeFile(join(dir,'state.v1.backup.json'),raw,{flag:'wx',mode:0o600}).catch((error:any)=>{if(error.code!=='EEXIST')throw error;});
      value.schema=2;value.phase=phaseFromLegacy(value.lifecycle);value.state_version=Number.isInteger(value.state_version)?value.state_version:0;
    }
    if(!value.phase)value.phase=phaseFromLegacy(value.lifecycle);
    if(!value.last_phase)value.last_phase=value.phase;
    assertInvariants(value as RunState);
    return value as RunState;
  }
  async readTransitions(id:string,offset=0,limit=100):Promise<unknown[]>{const lines=(await readFile(join(this.runDir(id),'transitions.jsonl'),'utf8').catch((error:any)=>{if(error.code==='ENOENT')return '';throw error;})).trim().split('\n').filter(Boolean);return lines.slice(offset,offset+limit).map(line=>{try{return JSON.parse(line);}catch{return {corrupt:true};}});}
  async appendLog(id:string,name:string,text:string):Promise<void>{
    if(!/^[a-z0-9-]{1,32}$/.test(name))throw new Error('Invalid log name');
    const dir=join(this.runDir(id),'logs');await privateDirectory(dir);
    await appendFile(join(dir,`${name}.log`),String(text).slice(0,64_000),{mode:0o600});
  }
  async logFiles(id:string):Promise<Array<{name:string;size:number;updated_at:string}>>{
    const dir=join(this.runDir(id),'logs');
    const names=await readdir(dir).catch((error:any)=>{if(error.code==='ENOENT')return [] as string[];throw error;});
    const files=[];
    for(const name of names){if(!name.endsWith('.log'))continue;const info=await stat(join(dir,name));files.push({name,size:info.size,updated_at:info.mtime.toISOString()});}
    return files.sort((a,b)=>a.name.localeCompare(b.name));
  }
  async transitionAudit(id:string,offset=0,limit=100):Promise<{ok:boolean;count:number;last_hash:string|null;error?:string;records:unknown[]}>{
    const lines=(await readFile(join(this.runDir(id),'transitions.jsonl'),'utf8').catch((error:any)=>{if(error.code==='ENOENT')return '';throw error;})).trim().split('\n').filter(Boolean);
    let previous:string|null=null;
    for(const line of lines){
      let record:any;try{record=JSON.parse(line);}catch{return {ok:false,count:lines.length,last_hash:previous,error:'Unparseable transition record',records:[]};}
      if(record.prev_hash!==previous)return {ok:false,count:lines.length,last_hash:previous,error:'Transition hash chain is broken',records:[]};
      const expected=createHash('sha256').update(JSON.stringify({from:record.from,to:record.to,at:record.at,state_version:record.state_version,prev_hash:record.prev_hash??null})).digest('hex');
      if(record.hash!==expected)return {ok:false,count:lines.length,last_hash:previous,error:'Transition hash does not match its record',records:[]};
      previous=record.hash;
    }
    return {ok:true,count:lines.length,last_hash:previous,records:lines.slice(offset,offset+limit).map(line=>JSON.parse(line))};
  }
  async findOperation(id:string):Promise<{state:RunState;result:unknown}|undefined>{for(const run of await readdir(join(this.dir,'runs'))){const state=await this.load(run);if(Object.hasOwn(state.operation_ids,id))return {state,result:state.operation_ids[id]};}return undefined;}
  async listRuns(offset=0,limit=20){const ids=await readdir(join(this.dir,'runs'));const rows=[];for(const id of ids){const state=await this.load(id);rows.push({run_id:state.run_id,phase:state.phase,lifecycle:state.lifecycle,activity_id:state.activity_id,brief_version:state.brief_version,writer:state.writer,operation_ids:Object.keys(state.operation_ids),supervisor_handle:state.supervisor?.handle});}return rows.sort((a,b)=>a.run_id.localeCompare(b.run_id)).slice(offset,offset+limit);}
   async emit(state: RunState, kind: string, payload: unknown): Promise<unknown> { state.workspace_checkpoint=await checkpoint(state.checkpoint_root??this.workspace);const event = { run_id: state.run_id, activity_id: state.activity_id ?? '', event_id: randomUUID(), brief_version: state.brief_version, profile: (state.profile as { name?: string } | undefined)?.name ?? '', supervisor_handle: state.supervisor?.handle ?? '', ...(state.report_id?{report_id:state.report_id}:{}), kind, payload }; state.events.push(event); await this.save(state); this.notify(state.run_id); return event; }
}
