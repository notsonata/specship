import { createServer, type Server, type ServerResponse } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Store, RunState } from './state.js';
import { Report } from './contracts.js';
import { materializeArtifacts } from './artifacts.js';

export class CallbackHub {
  private server?: Server;
  private capability = randomBytes(32).toString('hex');
  private base = '';
  private answer?: (value: { text: string; images: Array<{ mime: string; name: string; data: Buffer }> }) => void;
  private waiting = new Set<ServerResponse>();
  constructor(private store: Store, private state: RunState, private stopExecution: (reason: string) => Promise<boolean> = async () => false, private deliveryMarginMs=120_000) {}
  get token(){return this.capability;}
  get url(){return this.base;}
  get waitingForAnswer():boolean{return Boolean(this.answer);}
  async start(): Promise<void> {
    this.server = createServer(async (req, res) => {
      try {
        const auth = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
        const a = Buffer.from(auth), b = Buffer.from(this.capability);
        if (a.length !== b.length || !timingSafeEqual(a, b)) { res.writeHead(401).end(); return; }
        const chunks: Buffer[] = [];let size=0;
        for await (const chunk of req) {size+=chunk.length;if(size>1_000_000)throw new Error('Callback request exceeds 1 MB');chunks.push(Buffer.from(chunk));}
        const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
        if (req.url === '/ask_spec') {
          if(this.answer)throw new Error('A decision callback is already pending');
          if(typeof body.request_id!=='string'||!body.request_id||typeof body.blocker!=='string'||typeof body.decision!=='string'||!Array.isArray(body.evidence)||!Array.isArray(body.attempts))throw new Error('Invalid decision request');
          this.waiting.add(res);
          const response = new Promise<{ text: string; images: Array<{ mime: string; name: string; data: Buffer }> }>(resolve => { this.answer = resolve; });
          this.state.pending = { kind: 'question', id: body.request_id ?? cryptoId(), body };
          await this.store.emit(this.state, 'decision_required', this.state.pending);
          const answer = await response;
          if (!res.destroyed) res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
            text: answer.text,
            images: answer.images.map(image => ({ mime: image.mime, name: image.name, data: image.data.toString('base64') })),
          }));
          this.waiting.delete(res);
        } else if (req.url === '/report_result') {
          const parsed = Report.safeParse(body);
          if (!parsed.success) throw new Error('Invalid report schema');
          if(this.state.activity_kind==='explore'&&'status'in parsed.data||this.state.activity_kind!=='explore'&&!('status' in parsed.data))throw new Error('Report does not match the current activity kind');
          const report='artifacts'in parsed.data&&parsed.data.artifacts?{...parsed.data,artifacts:await materializeArtifacts(this.store.workspace,parsed.data.artifacts)}:parsed.data;
          if(this.state.report){if(JSON.stringify(this.state.report)!==JSON.stringify(report))throw new Error('A report is already submitted for this activity');if(!res.destroyed)res.writeHead(200).end('{}');return;}
          this.state.report = report;
          this.state.report_id = randomUUID();
          this.state.pending = { kind: 'report', id: this.state.report_id };
          await this.store.save(this.state);
          if (!res.destroyed) res.writeHead(200).end('{}');
        } else if (req.url === '/interrupt') {
          const native = this.state.supervisor;
          if (!native?.thread || !native.turn || body.session_id !== native.thread || body.turn_id !== native.turn) throw new Error('Interrupt does not match the active native Codex turn');
          if (this.state.lifecycle === 'paused') { if (!res.destroyed) res.writeHead(202).end('{}'); return; }
          this.state.stop_request = { at: new Date().toISOString(), thread: body.session_id, turn: body.turn_id, status: 'requested' };
          await this.store.save(this.state);
          if (!res.destroyed) res.writeHead(202).end('{}');
          void (async () => {
            const confirmed = await this.stop('trusted Codex Interrupt hook');
            if (confirmed) {
              this.state.lifecycle = 'paused'; this.state.writer = false;
              this.state.stop_request = { ...(this.state.stop_request as object), status: 'confirmed' };
              await this.store.releaseWriter(this.state.run_id);
              await this.store.removeInterruptDescriptor(this.state.run_id);
              await this.store.emit(this.state, 'paused', { reason: 'trusted Interrupt', stop_confirmed: true });
            } else {
              this.state.stop_request = { ...(this.state.stop_request as object), status: 'unconfirmed' };
              await this.store.emit(this.state, 'execution_failed', { reason: 'Interrupt stop was not confirmed; writer retained' });
            }
          })().catch(() => {});
        } else res.writeHead(404).end();
      } catch (error) {
        if (!res.destroyed) res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: error instanceof Error ? error.message : 'invalid request' }));
      }
    });
    await new Promise<void>((resolve, reject) => this.server!.once('error', reject).listen(0, '127.0.0.1', resolve));
    const port = (this.server.address() as any).port;
    this.base = `http://127.0.0.1:${port}`;
    await this.refreshDescriptor();
  }
  async refreshDescriptor():Promise<void>{await this.store.writeCallbackDescriptor(this.state.run_id,{url:this.base,capability:this.capability,deadline:this.state.deadline,delivery_margin_ms:this.deliveryMarginMs,callback_timeout_ms:Math.max(1,(this.state.deadline??Date.now())-Date.now()+this.deliveryMarginMs)});}
  waitQuestion():Promise<unknown>{return new Promise(resolve=>{this.answer=(v)=>resolve(v);});}
  async release(answer: string, images: Array<{ mime: string; name: string; data: Buffer }>): Promise<void> {
    this.state.pending = { ...(this.state.pending as object), kind: 'answer', answer };
    await this.store.save(this.state);
    if (!this.answer) throw new Error('No active callback is waiting');
    const resolve = this.answer; this.answer = undefined;
    resolve({ text: answer, images });
  }
  async stop(reason: string): Promise<boolean> {const confirmed=await this.stopExecution(reason);if(confirmed)this.detachPending();return confirmed;}
  detachPending():void{
    for (const response of this.waiting) {
      if (!response.destroyed) response.writeHead(503, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'runner stopped; decision remains unresolved' }));
    }
    this.waiting.clear(); this.answer = undefined;
  }
  async close(): Promise<void> {
    this.detachPending();
    if (this.server) await new Promise<void>(resolve => this.server!.close(() => resolve()));
  }
}
function cryptoId():string{return randomUUID();}
