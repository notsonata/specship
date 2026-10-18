import { createServer, type Server, type ServerResponse } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Store, RunState } from './state.js';
import { Report } from './contracts.js';
import { materializeArtifacts, verifyArtifact, MAX_ARTIFACT_BYTES } from './artifacts.js';
import { z } from 'zod';
import { callbackTimeoutMs } from './timeouts.js';

const DecisionRequest = z.object({ request_id: z.string().min(1), blocker: z.string().min(1), decision: z.string().min(1), evidence: z.array(z.string()), attempts: z.array(z.string()), image_artifact_ids: z.array(z.string()).optional() }).strict();
type Answer = { text: string; images: Array<{ mime: string; name: string; data: Buffer }> };

export class CallbackHub {
  private server?: Server;
  private capability = randomBytes(32).toString('hex');
  private base = '';
  private answer?: { id: string; promise: Promise<Answer>; resolve: (value: Answer) => void; reject: (error: Error) => void };
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
          const question = DecisionRequest.parse(body);
          const key = JSON.stringify(question.request_id);
          const fingerprint = JSON.stringify(question);
          const records = this.state.decision_callbacks ??= {};
          const recorded = records[key];
          if (recorded && (recorded.activity_id !== this.state.activity_id || recorded.fingerprint !== fingerprint)) throw new Error('Decision request ID was reused with changed input or a different activity');
          if (recorded?.answer) {
            await this.store.save(this.state);
            this.sendAnswer(res, await this.replayAnswer(recorded.answer));
            return;
          }
          if (this.answer && this.answer.id !== question.request_id) throw new Error('A decision callback is already pending');
          this.waiting.add(res);
          res.once('close', () => this.waiting.delete(res));
          let response = this.answer?.promise;
          if (!this.answer) {
            const pending = this.state.pending as any;
            if (recorded && (pending?.id !== question.request_id || !['question', 'deferred'].includes(pending.kind))) throw new Error('Decision request is no longer pending');
            if (!recorded && (pending && ['question', 'permission', 'deferred', 'report', 'recovery_review'].includes(pending.kind) || ['paused', 'cancelled', 'completed', 'failed', 'awaiting_review'].includes(this.state.lifecycle))) throw new Error('This activity cannot accept a new decision callback');
            let resolve!: (value: Answer) => void;
            let reject!: (error: Error) => void;
            const promise = new Promise<Answer>((yes, no) => { resolve = yes; reject = no; });
            void promise.catch(() => {});
            this.answer = { id: question.request_id, promise, resolve, reject };
            response = promise;
            if (!recorded) {
              records[key] = { activity_id: this.state.activity_id!, brief_version: this.state.brief_version, fingerprint };
              this.state.pending = { kind: 'question', id: question.request_id, body: question };
              try { await this.store.emit(this.state, 'decision_required', this.state.pending); }
              catch (error) { this.answer?.reject(error as Error); this.answer = undefined; throw error; }
            }
          }
          try { this.sendAnswer(res, await response!); }
          finally { this.waiting.delete(res); }
        } else if (req.url === '/report_result') {
          if (this.answer || ['question', 'permission', 'deferred', 'recovery_review'].includes((this.state.pending as any)?.kind)) throw new Error('Resolve the pending decision before reporting a result');
          const parsed = Report.safeParse(body);
          if (!parsed.success) throw new Error('Invalid report schema');
          if(this.state.activity_kind==='explore'&&'status'in parsed.data||this.state.activity_kind!=='explore'&&!('status' in parsed.data))throw new Error('Report does not match the current activity kind');
          const report='artifacts'in parsed.data&&parsed.data.artifacts?{...parsed.data,artifacts:await materializeArtifacts(this.store.workspace,parsed.data.artifacts)}:parsed.data;
          if(this.state.report){if(JSON.stringify(this.state.report)!==JSON.stringify(report))throw new Error('A report is already submitted for this activity');await this.store.save(this.state);if(!res.destroyed)res.writeHead(200).end('{}');return;}
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
        if (!res.destroyed && !res.writableEnded) res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: error instanceof Error ? error.message : 'invalid request' }));
      }
    });
    await new Promise<void>((resolve, reject) => this.server!.once('error', reject).listen(0, '127.0.0.1', resolve));
    const port = (this.server.address() as any).port;
    this.base = `http://127.0.0.1:${port}`;
    await this.refreshDescriptor();
  }
  async refreshDescriptor():Promise<void>{await this.store.writeCallbackDescriptor(this.state.run_id,{url:this.base,capability:this.capability,deadline:this.state.deadline??null,delivery_margin_ms:this.deliveryMarginMs,callback_timeout_ms:callbackTimeoutMs(this.state.deadline,this.deliveryMarginMs)??null});}
  private sendAnswer(res: ServerResponse, answer: Answer): void {
    if (!res.destroyed && !res.writableEnded) res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ text: answer.text, images: answer.images.map(image => ({ mime: image.mime, name: image.name, data: image.data.toString('base64') })) }));
  }
  private async replayAnswer(answer: { text: string; artifacts: unknown[] }): Promise<Answer> {
    const images = [];
    for (const ref of answer.artifacts) {
      const verified = await verifyArtifact(this.store.workspace, ref);
      images.push({ mime: verified.reference.mime, name: verified.reference.id, data: verified.bytes });
    }
    if (images.reduce((sum, image) => sum + image.data.length, 0) > MAX_ARTIFACT_BYTES) throw new Error('Saved decision images exceed callback limit');
    return { text: answer.text, images };
  }
  recordAnswer(requestId: string, text: string, artifacts: unknown[], originalQuestion: unknown): void {
    const question = DecisionRequest.parse(originalQuestion);
    if (question.request_id !== requestId) throw new Error('Decision answer does not match its original request');
    const records = this.state.decision_callbacks ??= {};
    const key = JSON.stringify(requestId);
    const record = records[key] ??= { activity_id: this.state.activity_id!, brief_version: this.state.brief_version, fingerprint: JSON.stringify(question) };
    if (record.activity_id !== this.state.activity_id || record.fingerprint !== JSON.stringify(question)) throw new Error('Decision answer belongs to a different request');
    const answer = { text, artifacts };
    if (record.answer && JSON.stringify(record.answer) !== JSON.stringify(answer)) throw new Error('Decision request already has a different durable answer');
    record.answer = answer;
  }
  async release(answer: string, images: Array<{ mime: string; name: string; data: Buffer }>): Promise<void> {
    if (!this.answer) throw new Error('No active callback is waiting');
    const { resolve } = this.answer; this.answer = undefined;
    resolve({ text: answer, images });
  }
  async stop(reason: string): Promise<boolean> {const confirmed=await this.stopExecution(reason);if(confirmed)this.detachPending();return confirmed;}
  detachPending():void{
    for (const response of this.waiting) {
      if (!response.destroyed) response.writeHead(503, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'runner stopped; decision remains unresolved' }));
    }
    this.waiting.clear(); this.answer?.reject(new Error('Runner stopped; retry the exact decision request after recovery')); this.answer = undefined;
  }
  async close(): Promise<void> {
    this.detachPending();
    if (this.server) await new Promise<void>(resolve => this.server!.close(() => resolve()));
  }
}
