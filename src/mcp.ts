import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { resolve } from 'node:path';
import type { Runner } from './runner.js';
import type { Store } from './state.js';
import { ArtifactInput, Brief } from './contracts.js';
import { toToolError } from './errors.js';

const output = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });
const guarded = <A, R>(fn: (args: A, extra: any) => Promise<R>) => async (args: A, extra: any) => {
  try { return await fn(args, extra); }
  catch (error) { return toToolError(error); }
};
function caller(extra: any): { thread?: string; turn?: string } {
  const meta = extra?._meta ?? {};
  let turn: string | undefined;
  try { const native = meta['x-codex-turn-metadata']; turn = typeof native === 'string' ? JSON.parse(native).turn_id : native?.turn_id; } catch { /* invalid optional host metadata is ignored */ }
  return { ...(typeof meta.threadId === 'string' ? { thread: meta.threadId } : {}), ...(typeof turn === 'string' ? { turn } : {}) };
}
function workspaceMatches(actual: string, expected: string): void {
  if (resolve(actual) !== resolve(expected)) throw new Error('Tool workspace does not match this Specship server workspace');
}
function requiredCaller(extra:any){const value=caller(extra);if(!value.thread||!value.turn)throw new Error('This Codex host did not supply native thread/turn metadata; automatic interruption cannot be correlated safely');return value;}
async function owned(runner: Runner, runId: string, handle: string, extra: any): Promise<void> {
  await runner.assertSupervisor(runId, handle, requiredCaller(extra));
}

export async function serveSpec(runner: Runner, store: Store): Promise<void> {
  const server = new McpServer({ name: 'specship', version: '1.0.0' });
  server.registerTool('specship_dispatch', {
    description: 'Dispatch one bounded Ship activity and block for one material event.',
    inputSchema: {
      workspace: z.string(), operation_id: z.string().min(1), run_id: z.string().optional(),
      kind: z.enum(['explore', 'implement', 'correct']), ship_profile: z.string().optional(),
      assignment: z.string().optional(), brief: Brief.optional(), artifacts:z.array(ArtifactInput).optional(), corrections: z.array(z.string()).optional(),
      expected_brief_version: z.number().int().optional(), supervisor_handle: z.string().optional(),
    },
  }, guarded(async (args, extra) => {
    workspaceMatches(args.workspace, store.workspace);
    requiredCaller(extra);
    if (args.run_id) await owned(runner, args.run_id, args.supervisor_handle ?? '', extra);
    return output(await runner.dispatch(args as any, caller(extra), extra.signal));
  }));
  server.registerTool('specship_reply', {
    description: 'Persist one exact decision answer and block until the next material event. Native permission requests accept reject only; human grants cannot be supplied through this tool.',
    inputSchema: { run_id: z.string(), request_id: z.string(), operation_id: z.string(), answer: z.string(), expected_brief_version: z.number().int(), supervisor_handle: z.string(), brief: Brief.optional(), defer_to_user: z.boolean().optional() },
  }, guarded(async (args, extra) => { await owned(runner, args.run_id, args.supervisor_handle, extra); return output(await runner.reply(args as any, caller(extra), extra.signal)); }));
  server.registerTool('specship_wait', {
    description: 'Attach to an exact run and block for a material event; never submits work.',
    inputSchema: { run_id: z.string(), last_event_id: z.string().optional(), recover: z.boolean().optional(), supervisor_handle: z.string() },
  }, guarded(async (args, extra) => {
    if(args.recover)return output(await runner.recover(args.run_id,args.supervisor_handle,requiredCaller(extra),extra.signal));
    await owned(runner,args.run_id,args.supervisor_handle,extra);
    return output(await runner.wait(args.run_id,args.supervisor_handle,caller(extra),extra.signal,args.last_event_id,false));
  }));
  server.registerTool('specship_inspect', {
    description: 'Inspect a bounded explicit section or list recovery candidates; not status polling.',
    inputSchema: { workspace: z.string(), run_id: z.string().optional(), section: z.enum(['brief', 'evidence', 'artifacts', 'profiles', 'logs', 'transitions', 'recovery']), purpose: z.enum(['review', 'recovery', 'decision']).optional(), offset: z.number().int().nonnegative().optional(), limit: z.number().int().positive().max(100).optional() },
  }, guarded(async args => {
    workspaceMatches(args.workspace, store.workspace);
    await runner.noteInspection(args.run_id, args.purpose, args.section);
    const offset = args.offset ?? 0, limit = args.limit ?? 20;
    if (!args.run_id) {
      if(args.section==='profiles')return output(runner.profiles());
      if(args.section!=='recovery')throw new Error('This inspection section requires an exact run_id');
      return output({ candidates: await store.listRuns(offset, limit) });
    }
    const state = await store.load(args.run_id);
    let value: unknown;
    if (args.section === 'brief') value = state.brief;
    else if (args.section === 'evidence') value = state.report;
    else if (args.section === 'artifacts') value = (state.brief as any)?.artifacts ?? [];
    else if (args.section === 'profiles') value = state.profile;
    else if (args.section === 'logs') { const archived = await store.readEvents(args.run_id, offset, limit); return output({ events: archived.length ? archived : state.events.slice(offset, offset + limit), files: await store.logFiles(args.run_id) }); }
    else if (args.section === 'transitions') return output(await store.transitionAudit(args.run_id, offset, limit));
    else value = { run_id: state.run_id, phase: state.phase, lifecycle: state.lifecycle, isolation: state.isolation, ship_workspace: state.ship_workspace, activity_id: state.activity_id, activity_kind: state.activity_kind, brief_version: state.brief_version, report_id: state.report_id, writer: state.writer, operations: Object.keys(state.operation_ids), pending_kind: (state.pending as any)?.kind, event_ids: state.events.map((event: any) => event.event_id) };
    const array = Array.isArray(value) ? value.slice(offset, offset + limit) : value;
    return output(array);
  }));
  server.registerTool('specship_control', {
    description: 'Pause, resume, or cancel one exact attached run.',
    inputSchema: { run_id: z.string(), operation_id: z.string(), action: z.enum(['pause', 'resume', 'cancel']), reason: z.string(), supervisor_handle: z.string() },
  }, guarded(async (args, extra) => { await owned(runner, args.run_id, args.supervisor_handle, extra); return output(await runner.control(args as any, caller(extra), extra.signal)); }));
  server.registerTool('specship_accept', {
    description: 'Accept the exact idle report after checking the original requirements, semantic assumptions, and independent validation. Passing implementation-coupled tests alone is insufficient.',
    inputSchema: { run_id: z.string(), activity_id: z.string(), report_id: z.string(), brief_version: z.number().int(), evidence: z.string().min(1), supervisor_handle: z.string() },
  }, guarded(async (args, extra) => { await owned(runner, args.run_id, args.supervisor_handle, extra); await runner.accept(args.run_id, args.activity_id, args.report_id, args.brief_version, args.evidence); return output({ accepted: true }); }));
  const transport=new StdioServerTransport();
  server.server.onclose=()=>{void runner.close();};
  await server.connect(transport);
}
