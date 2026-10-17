// Test-only client for Codex's real app-server protocol. Not a product supervisor.
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const [codex, model, mode = 'plain'] = process.argv.slice(2);
if (!codex || !model) throw new Error('Usage: node scripts/check-codex-interruption.mjs <codex-executable> <test-model>');
if (!['plain', 'hook', 'steer', 'timeout'].includes(mode)) throw new Error('Expected plain, hook, steer, or timeout mode');
const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, '.specship/compatibility', `${new Date().toISOString().replace(/[:.]/g, '-')}-interrupt`);
const workspace = join(output, 'workspace');
mkdirSync(workspace, { recursive: true });
const auditFile = join(output, 'mcp-audit.jsonl');
const config = {
  'project_doc_max_bytes': 0,
  'features.code_mode.direct_only_tool_namespaces': ['mcp__specship_gate'],
  'mcp_servers.specship_gate.command': process.execPath,
  'mcp_servers.specship_gate.args': [resolve(root, 'test/fixtures/blocking-mcp.mjs')],
  'mcp_servers.specship_gate.tool_timeout_sec': 90,
  'mcp_servers.specship_gate.env.SPECSHIP_GATE_DELAY_MS': '60000',
  'mcp_servers.specship_gate.env.SPECSHIP_GATE_AUDIT': auditFile,
};
if (mode === 'timeout') config['mcp_servers.specship_gate.tool_timeout_sec'] = 2;
if (mode === 'steer') config['mcp_servers.specship_gate.env.SPECSHIP_GATE_RELEASE_FILE'] = join(output, 'decision.json');
if (mode === 'hook') {
  const marker = join(root, '.specship/compatibility/desktop/interrupt.json');
  mkdirSync(join(root, '.specship/compatibility/desktop'), { recursive: true });
  config['mcp_servers.specship_gate.env.SPECSHIP_GATE_INTERRUPT_FILE'] = marker;
}
const args = ['app-server', '--listen', 'stdio://'];
const toml = (value) => Array.isArray(value) ? `[${value.map(toml).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.entries(value).map(([key, field]) => `${key}=${toml(field)}`).join(',')}}`
    : JSON.stringify(value);
for (const [key, value] of Object.entries(config)) args.push('-c', `${key}=${toml(value)}`);
console.log(`Codex interruption gate: ${model}; evidence=${output}`);
const child = spawn(codex, args, { cwd: workspace, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
const pending = new Map(), events = [];
let nextId = 1, buffer = '', exited = false;
const closed = new Promise((done) => child.on('close', (code) => {
  exited = true;
  for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error(`Codex exited ${code}`)); }
  pending.clear(); done();
}));
child.stderr.on('data', (chunk) => appendFileSync(join(output, 'stderr.log'), chunk));
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  for (let index; (index = buffer.indexOf('\n')) !== -1;) {
    const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
    if (!line.trim()) continue;
    const event = JSON.parse(line);
    appendFileSync(join(output, 'protocol.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), event })}\n`);
    if (event.id !== undefined && pending.has(event.id)) {
      const request = pending.get(event.id); pending.delete(event.id); clearTimeout(request.timer);
      if (event.error) request.reject(new Error(JSON.stringify(event.error))); else request.resolve(event.result);
    } else if (event.id !== undefined && event.method) {
      // A narrow probe cannot authorize permissions or interactive approvals.
      child.stdin.write(`${JSON.stringify({ id: event.id, error: { code: -32601, message: 'Unsupported probe request' } })}\n`);
    } else events.push(event);
  }
});
function request(method, params) {
  return new Promise((resolveRequest, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} deadline`)); }, 90_000);
    pending.set(id, { resolve: resolveRequest, reject, timer });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
}
async function until(condition, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  while (!condition()) {
    if (exited || Date.now() > deadline) throw new Error('Probe event deadline');
    await delay(25);
  }
}
const audit = () => existsSync(auditFile) ? readFileSync(auditFile, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const summary = { status: 'failed', host: 'codex-app-server-protocol', model, mode, failures: [] };
try {
  await request('initialize', { clientInfo: { name: 'specship_gate', version: '0.1.0' }, capabilities: { experimentalApi: true } });
  child.stdin.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`);
  if (mode === 'hook') {
    const hooks = await request('hooks/list', { cwds: [workspace] });
    const ours = hooks.data.flatMap((entry) => entry.hooks).filter((hook) => hook.command?.includes('/test/fixtures/interrupt-hook.mjs'));
    writeFileSync(join(output, 'hook-review.json'), JSON.stringify(ours, null, 2));
    if (!ours.some((hook) => hook.enabled && ['trusted', 'managed'].includes(hook.trustStatus))) throw new Error('Interrupt hook is not trusted by this host; review the generated hook using Codex /hooks before testing');
  }
  const { thread } = await request('thread/start', { cwd: workspace, model, approvalPolicy: 'never', sandbox: 'read-only' });
  summary.thread_id = thread.id;
  const { turn } = await request('turn/start', {
    threadId: thread.id,
    input: [{ type: 'text', text: 'Compatibility probe only. Call specship_gate gate_wait exactly once with probe_id "interrupt-gate". Wait silently for its result without side work or further tools. After an interruption or tool error, do not retry that tool. Do not inspect or edit files.'
      + (mode === 'timeout' ? ' If the tool fails, output exactly TOOL_TIMEOUT.' : '') }],
  });
  await until(() => audit().some((entry) => entry.kind === 'wait_started'));
  const caller = audit().find((entry) => entry.kind === 'wait_started');
  summary.native_thread_identity_matches = caller.caller_thread === thread.id;
  summary.native_turn_identity_matches = caller.caller_turn === turn.id;
  if (mode === 'hook' && (!summary.native_thread_identity_matches || !summary.native_turn_identity_matches)) throw new Error('Host did not supply matching native caller identities for safe Interrupt routing');
  if (mode === 'timeout' || mode === 'steer') {
    if (mode === 'steer') {
      await delay(500);
      await request('turn/steer', { threadId: thread.id, expectedTurnId: turn.id, input: [{ type: 'text', text: 'After receiving the tool result, use no more tools and output exactly STEERING_OK.' }] });
      await delay(500);
      summary.input_queued_while_wait_pending = !events.some((event) => event.method === 'turn/completed' && event.params.turn.id === turn.id);
      if (!summary.input_queued_while_wait_pending) throw new Error('Turn finished before the pending tool was released');
      writeFileSync(join(output, 'decision.json'), JSON.stringify({ probe_id: 'interrupt-gate', answer: 'released by the test controller' }));
    }
    await until(() => events.some((event) => event.method === 'turn/completed' && event.params.turn.id === turn.id), 30_000);
    const reply = events.filter((event) => event.method === 'item/completed' && event.params.turnId === turn.id && event.params.item.type === 'agentMessage').map((event) => event.params.item.text).join('\n').trim();
    const expected = mode === 'timeout' ? 'TOOL_TIMEOUT' : 'STEERING_OK';
    summary.reply = reply;
    if (reply !== expected) throw new Error(`Missing ${expected} response`);
    if (audit().filter((entry) => entry.kind === 'wait_started').length !== 1) throw new Error('Host/model retried the pending tool');
    if (mode === 'timeout') {
      const failed = events.find((event) => event.method === 'item/completed' && event.params.item.type === 'mcpToolCall' && event.params.item.status === 'failed');
      if (!failed || !/timed out|deadline/i.test(JSON.stringify(failed.params.item.error))) throw new Error('Missing actual MCP deadline failure');
      summary.tool_deadline_reported = true;
      summary.transport_cancel_observed = audit().some((entry) => entry.kind === 'wait_cancelled');
    }
    summary.status = 'passed';
  } else {
  await delay(1500);
  const started = Date.now();
  await request('turn/interrupt', { threadId: thread.id, turnId: turn.id });
  await until(() => events.some((event) => event.method === 'turn/completed' && event.params.turn.id === turn.id), 15_000);
  const interrupted = events.find((event) => event.method === 'turn/completed' && event.params.turn.id === turn.id);
  summary.turn_status = interrupted.params.turn.status;
  if (summary.turn_status !== 'interrupted') throw new Error(`Unexpected turn status ${summary.turn_status}`);
  await delay(5000);
  summary.transport_cancel_observed = audit().some((entry) => entry.kind === 'wait_cancelled' || entry.kind === 'wait_disconnected');
  summary.hook_interrupt_observed = audit().some((entry) => entry.kind === 'wait_interrupted');
  const stop = audit().find((entry) => ['wait_cancelled', 'wait_disconnected', 'wait_interrupted'].includes(entry.kind));
  summary.stop_observation_window_ms = Date.now() - started;
  summary.stop_delivery_ms = stop ? Date.parse(stop.at) - started : null;
  if (audit().some((entry) => entry.kind === 'wait_completed')) throw new Error('Interrupted wait manufactured a completion');
  // Reuse the exact thread, testing both its availability and retained user context.
  const { turn: resumed } = await request('turn/start', {
    threadId: thread.id, input: [{ type: 'text', text: 'The probe was intentionally interrupted. Without using tools, return only the probe_id from my previous message.' }],
  });
  await until(() => events.some((event) => event.method === 'turn/completed' && event.params.turn.id === resumed.id));
  const result = events.filter((event) => event.method === 'item/completed' && event.params.turnId === resumed.id && event.params.item.type === 'agentMessage').map((event) => event.params.item.text).join('\n').trim();
  summary.same_thread_reply = result;
  if (result !== 'interrupt-gate') throw new Error('Original user context was not recovered in the same thread');
  if (audit().filter((entry) => entry.kind === 'wait_started').length !== 1) throw new Error('Recovery submitted another callback');
  summary.same_thread_context_preserved = true;
  if (!summary.transport_cancel_observed && !summary.hook_interrupt_observed) summary.failures.push('Codex interrupted the turn without stopping the pending MCP request within five seconds');
  summary.status = summary.failures.length ? 'failed' : 'passed';
  }
} catch (cause) { summary.failures.push(cause.message); }
finally {
  child.stdin.end();
  const shutdown = setTimeout(() => child.kill(), 3000);
  await closed; clearTimeout(shutdown);
}
writeFileSync(join(output, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
process.exitCode = summary.status === 'passed' ? 0 : 1;
