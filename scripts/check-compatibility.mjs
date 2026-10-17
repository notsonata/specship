import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeEvidence, readSessionTelemetry } from './compatibility-evidence.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const options = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, args) => {
  if (index % 2 === 0) pairs.push([value.replace(/^--/, ''), args[index + 1]]);
  return pairs;
}, []));
if (options.analyze) {
  const folder = resolve(options.analyze);
  const invocation = JSON.parse(readFileSync(join(folder, 'invocation.json'), 'utf8'));
  const readLines = (file) => readFileSync(join(folder, file), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const recordedEvents = readLines('codex-events.jsonl');
  const recordedThread = recordedEvents.find((record) => record.event.type === 'thread.started')?.event.thread_id;
  if (!recordedThread) throw new Error('Missing probe thread');
  const freshTelemetry = readSessionTelemetry(recordedThread);
  const previous = JSON.parse(readFileSync(join(folder, 'summary.json'), 'utf8'));
  const summary = analyzeEvidence({ audit: readLines('mcp-audit.jsonl'), events: recordedEvents, telemetry: freshTelemetry, delayMs: invocation.delay_ms, exitCode: previous.exit_code ?? (previous.failures.some((failure) => failure.startsWith('Codex exited with')) ? 1 : 0) });
  summary.thread_id = recordedThread;
  writeFileSync(join(folder, 'telemetry.json'), `${JSON.stringify(freshTelemetry, null, 2)}\n`);
  writeFileSync(join(folder, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.status === 'passed' ? 0 : 1);
}
const delayMs = Number(options['delay-ms'] ?? 130_000);
if (!Number.isSafeInteger(delayMs) || delayMs < 1 || delayMs > 3_600_000) throw new Error('Invalid --delay-ms');
const codex = options.codex ?? 'codex';
const model = options.model;
if (!model) throw new Error('Live CLI probes require an explicit --model. Spec itself uses the model on which its skill is invoked.');
const exposure = options.exposure ?? 'default';
if (!['default', 'direct'].includes(exposure)) throw new Error('Expected --exposure default or direct');
const output = resolve(options.output ?? join(root, '.specship', 'compatibility', `${new Date().toISOString().replace(/[:.]/g, '-')}-cli`));
const workspace = join(output, 'workspace');
mkdirSync(workspace, { recursive: true });
const auditFile = join(output, 'mcp-audit.jsonl');
const eventFile = join(output, 'codex-events.jsonl');
const telemetryFile = join(output, 'telemetry.json');
for (const file of [auditFile, eventFile, join(output, 'stderr.log')]) {
  if (existsSync(file)) throw new Error(`Refusing to overwrite evidence: ${file}`);
}
const config = {
  'project_doc_max_bytes': 0,
  'mcp_servers.specship_gate.command': process.execPath,
  'mcp_servers.specship_gate.args': [resolve(root, 'test/fixtures/blocking-mcp.mjs')],
  'mcp_servers.specship_gate.required': true,
  'mcp_servers.specship_gate.tool_timeout_sec': Math.ceil(delayMs / 1000) + 120,
  'mcp_servers.specship_gate.env.SPECSHIP_GATE_AUDIT': auditFile,
  'mcp_servers.specship_gate.env.SPECSHIP_GATE_DELAY_MS': String(delayMs),
};
if (exposure === 'direct') config['features.code_mode.direct_only_tool_namespaces'] = ['mcp__specship_gate'];
const args = ['exec', '--ignore-user-config', '--skip-git-repo-check', '--sandbox', 'read-only', '--json', '--color', 'never', '-C', workspace, '-m', model];
for (const [key, value] of Object.entries(config)) args.push('-c', `${key}=${JSON.stringify(value)}`);
args.push('-');
const version = spawnSync(codex, ['--version'], { encoding: 'utf8', windowsHide: true });
if (version.error || version.status !== 0) throw version.error ?? new Error(version.stderr);
writeFileSync(join(output, 'invocation.json'), JSON.stringify({
  host: 'codex-cli', node: process.version, platform: process.platform,
  codex_version: version.stdout.trim(), model, exposure, delay_ms: delayMs,
  tool_timeout_sec: config['mcp_servers.specship_gate.tool_timeout_sec'],
  started_at: new Date().toISOString(),
}, null, 2));
const events = [];
let parseErrors = 0;
let buffer = '';
console.log(`Starting ${model} CLI probe; wait=${delayMs}ms; evidence=${output}`);
const child = spawn(codex, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
child.on('error', (cause) => { console.error(cause.message); });
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  for (let index; (index = buffer.indexOf('\n')) !== -1;) {
    const line = buffer.slice(0, index).replace(/\r$/, '');
    buffer = buffer.slice(index + 1);
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      const record = { at: new Date().toISOString(), event };
      events.push(record);
      appendFileSync(eventFile, `${JSON.stringify(record)}\n`);
      if (event.type === 'item.started' && event.item?.type === 'mcp_tool_call') console.log('MCP tool call started; collecting evidence without model polling.');
      if (event.type === 'turn.completed') console.log('Codex turn completed.');
    } catch {
      parseErrors++;
      appendFileSync(join(output, 'stderr.log'), `Unparseable stdout: ${line}\n`);
    }
  }
});
child.stderr.on('data', (chunk) => appendFileSync(join(output, 'stderr.log'), chunk));
child.stdin.end('This is a narrow MCP compatibility probe. Call the specship_gate gate_wait tool exactly once with probe_id "cli-gate". Wait for its result. Do not call any other tools, poll, perform side work, or produce commentary while waiting. After receiving gate_released, output exactly GATE_OK. Do not inspect or edit repository files.');
const deadline = setTimeout(() => {
  console.error('Probe exceeded its wall-clock deadline; stopping Codex.');
  child.kill();
}, delayMs + 180_000);
const exitCode = await new Promise((done) => child.on('close', done));
clearTimeout(deadline);
const threadId = events.find((record) => record.event.type === 'thread.started')?.event.thread_id;
// Inspect only this probe's persisted session, never auth or unrelated transcripts.
const telemetry = threadId ? readSessionTelemetry(threadId) : [];
writeFileSync(telemetryFile, JSON.stringify(telemetry, null, 2));
const audit = existsSync(auditFile) ? readFileSync(auditFile, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const summary = analyzeEvidence({ audit, events, telemetry, delayMs, exitCode });
if (parseErrors) { summary.failures.push(`${parseErrors} invalid JSONL stdout records`); summary.status = 'failed'; }
summary.thread_id = threadId ?? null;
summary.exit_code = exitCode;
writeFileSync(join(output, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
process.exitCode = summary.status === 'passed' ? 0 : 1;
