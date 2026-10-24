import { randomUUID } from 'node:crypto';
import { open, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkpoint, type WorkspaceCheckpoint } from './workspace.js';
import { preparePrivateStorage, privateDirectory } from './private-storage.js';

export interface DecisionCallback { activity_id: string; brief_version: number; fingerprint: string; answer?: { text: string; artifacts: unknown[] } }

export interface RunState { schema: 1; run_id: string; workspace: string; workspace_checkpoint?:WorkspaceCheckpoint; report_checkpoint?:WorkspaceCheckpoint; lifecycle: string; writer: boolean; supervisor?: { handle: string; thread?: string; turn?: string; waiting: boolean }; brief?: unknown; brief_version: number; operation_ids: Record<string, unknown>; decision_callbacks?: Record<string, DecisionCallback>; current_operation_id?:string; events: unknown[]; handled_event_ids?: string[]; profile?: unknown; activity_id?: string; activity_kind?: string; pending?: unknown; stop_request?: unknown; report?: unknown; report_id?: string; accepted?: unknown; adapter?: unknown; deadline?: number | null; remaining_ms?: number; cleanup_pending?: boolean; }
export class Store {
  readonly dir: string;
  private writes=new Map<string,Promise<void>>();
  constructor(readonly workspace: string) { this.dir = join(workspace, '.specship'); }
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
  async releaseWriter(runId:string):Promise<void>{const path=join(this.dir,'active-writer.json');try{const current=JSON.parse(await readFile(path,'utf8'));if(current.run_id===runId){const {unlink}=await import('node:fs/promises');await unlink(path);}}catch(e:any){if(e.code!=='ENOENT')throw e;}}
  async publishInterruptDescriptor(value: unknown): Promise<void> { const temp=join(this.dir,`active-run.${randomUUID()}.tmp`);await writeFile(temp,JSON.stringify(value),{flag:'wx',mode:0o600});await rename(temp,join(this.dir,'active-run.json')); }
  async removeInterruptDescriptor(runId:string):Promise<void>{const path=join(this.dir,'active-run.json');try{const value=JSON.parse(await readFile(path,'utf8'));if(value.run_id===runId){const {unlink}=await import('node:fs/promises');await unlink(path);}}catch(e:any){if(e.code!=='ENOENT')throw e;}}
  runDir(id: string): string { if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error('Invalid run ID'); return join(this.dir, 'runs', id); }
  async create(): Promise<RunState> { const state: RunState = { schema: 1, run_id: randomUUID(), workspace: this.workspace, lifecycle: 'idle', writer: false, brief_version: 0, operation_ids: {}, events: [] }; await this.save(state); return state; }
  async save(state: RunState): Promise<void> {
    const snapshot = JSON.stringify(state);
    const dir = this.runDir(state.run_id);
    await this.initialize();
    await privateDirectory(dir);
    const path = join(dir, 'state.json');
    const previous = this.writes.get(path) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(async () => {
      const temp = join(dir, `state.${randomUUID()}.tmp`);
      await writeFile(temp, snapshot, { flag: 'wx', mode: 0o600 });
      await rename(temp, path);
    });
    this.writes.set(path, current);
    try {
      await current;
    } finally {
      if (this.writes.get(path) === current) this.writes.delete(path);
    }
  }
  async load(id: string): Promise<RunState> {
    const value=JSON.parse(await readFile(join(this.runDir(id),'state.json'),'utf8')) as any;
    const lifecycle=['idle','running','awaiting_spec','awaiting_user','awaiting_review','paused','completed','failed','cancelled'];
    if(!value||value.schema!==1||value.run_id!==id||value.workspace!==this.workspace||!lifecycle.includes(value.lifecycle)||typeof value.writer!=='boolean'||!Number.isInteger(value.brief_version)||value.brief_version<0||!value.operation_ids||typeof value.operation_ids!=='object'||!Array.isArray(value.events))throw new Error('Corrupt or mismatched authoritative run state');
    for(const event of value.events)if(!event||typeof event.event_id!=='string'||typeof event.kind!=='string'||event.run_id!==id)throw new Error('Corrupt durable event in authoritative run state');
    return value as RunState;
  }
  async findOperation(id:string):Promise<{state:RunState;result:unknown}|undefined>{for(const run of await readdir(join(this.dir,'runs'))){const state=await this.load(run);if(Object.hasOwn(state.operation_ids,id))return {state,result:state.operation_ids[id]};}return undefined;}
  async listRuns(offset=0,limit=20){const ids=await readdir(join(this.dir,'runs'));const rows=[];for(const id of ids){const state=await this.load(id);rows.push({run_id:state.run_id,lifecycle:state.lifecycle,activity_id:state.activity_id,brief_version:state.brief_version,writer:state.writer,operation_ids:Object.keys(state.operation_ids),supervisor_handle:state.supervisor?.handle});}return rows.sort((a,b)=>a.run_id.localeCompare(b.run_id)).slice(offset,offset+limit);}
   async emit(state: RunState, kind: string, payload: unknown): Promise<unknown> { state.workspace_checkpoint=await checkpoint(this.workspace);const event = { run_id: state.run_id, activity_id: state.activity_id ?? '', event_id: randomUUID(), brief_version: state.brief_version, profile: (state.profile as { name?: string } | undefined)?.name ?? '', supervisor_handle: state.supervisor?.handle ?? '', ...(state.report_id?{report_id:state.report_id}:{}), kind, payload }; state.events.push(event); await this.save(state); return event; }
}
