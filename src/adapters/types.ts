import type { Profile } from '../contracts.js';
export interface AdapterEvent { type: 'message'|'permission'|'idle'|'error'; session?: string; message?: string; data?: unknown }
export interface ShipAdapter {
  readonly name: string;
  validate(profile: Profile, media: string[]): Promise<void>;
  start(workspace: string, profile: Profile, kind: 'explore'|'implement'|'correct', callback: { url: string; capability: string; descriptorPath?: string; timeoutMs?:number }): Promise<{ session: string; version: string }>;
  subscribe(session: string, signal: AbortSignal): Promise<void>;
  submit(session: string, operationId: string, prompt: string, artifacts: Array<{ mime: string; name: string; data: Buffer }>): Promise<{ messageId: string }>;
  events(session: string, signal: AbortSignal): AsyncIterable<AdapterEvent>;
  reconcile(session: string, messageId: string): Promise<'active'|'complete'|'unknown'>;
  abort(session: string): Promise<boolean>;
  reply(session: string, operationId:string, answer: string, artifacts: Array<{ mime: string; name: string; data: Buffer }>): Promise<void>;
  resolvePermission?(session: string, requestId: string, decision: 'once' | 'always' | 'reject'): Promise<void>;
  close?(session: string): Promise<boolean>;
  snapshot?(session:string):Promise<unknown>;
  restore?(snapshot:unknown,callback:{url:string;capability:string;descriptorPath?:string;timeoutMs?:number}):Promise<{session:string;version:string}>;
  reconcileOperation?(session:string,operationId:string):Promise<{messageId:string;status:'active'|'complete'|'unknown'}>;
}
