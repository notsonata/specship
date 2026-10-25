// Runs only inside a disposable benchmark container. No controller files are mounted.
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile, readFile, readdir, cp, rm, open } from 'node:fs/promises';
import { codexUsage, shipUsage, trialEstimate, treeContents, usesSpec, usesShip, usesOpenCodeShip, usesDshShip } from './accounting.mjs';
import { subscriptionCredential, subscriptionEnvironment } from './auth.mjs';
import { checkShipProfile, checkDshProfile } from './profile.mjs';
import { readShipUsage, applyShipUsage } from './usage.mjs';

const root = '/testbed', output = '/benchmark-output';
if (process.platform !== 'linux' || process.cwd() !== root) throw Error('Benchmark agent runs only inside its Linux /testbed container');
function command(executable, args, options = {}) {
  const result = spawnSync(executable, args, { cwd: root, encoding: 'utf8', maxBuffer: 64_000_000, ...options });
  if (result.error || result.status !== 0) throw Error(`${executable} failed: ${result.error?.message ?? result.stderr}`);
  return result.stdout;
}
function jsonLines(text) { return text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)); }
function verifyBase(baseCommit) {
  const head = command('git', ['rev-parse', 'HEAD']).trim();
  const expected = treeContents(command('git', ['ls-tree', '-rz', baseCommit]));
  const actual = treeContents(command('git', ['ls-tree', '-rz', 'HEAD']));
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw Error(`Image content differs from the declared base commit: ${baseCommit}`);
  command('git', ['-c', 'core.fileMode=false', 'diff', '--quiet']);
  return head;
}
await mkdir(output, { recursive: true });
let input = ''; for await (const chunk of process.stdin) input += chunk;
const task = JSON.parse(input);
if (task.preflight === true) {
  const head = verifyBase(task.base_commit);
  console.log(JSON.stringify({ preflight: true, base_commit: task.base_commit, image_head: head, base_contents_verified: true, node: process.version, codex: command('codex', ['--version']).trim(), opencode: command('opencode', ['--version']).trim(), dsh: command('dsh', ['--version']).trim(), model_calls: 0 }));
  process.exit(0);
}
const started = Date.now();
const result = { arm: task.arm, auth_mode: task.auth_mode ?? 'api', instance_id: task.instance_id, status: 'infrastructure_failure', resolved: null, accepted: null, spec_usage: null, ship_usage: null, api_equivalent_usd: null, actual_billed_usd: null, subscription_limit_delta: null };
let benchmarkBaseReady = false;
const sessions = new Set();
try {
  if (task.auth_mode === 'subscription') {
    const clean = subscriptionEnvironment(process.env);
    for (const key of Object.keys(process.env)) if (!(key in clean)) delete process.env[key];
    for (const [role, path] of [['codex', '/root/.codex/auth.json'], ['opencode', '/root/.local/share/opencode/auth.json']]) {
      if (role === 'codex' ? !usesSpec(task.arm) : !usesOpenCodeShip(task.arm)) continue;
      const data = subscriptionCredential(role, JSON.parse(await readFile(path, 'utf8')));
      await writeFile(path, JSON.stringify(data), { mode: 0o600 });
    }
  }
  result.image_head = verifyBase(task.base_commit);result.base_commit = task.base_commit;
  const tracked = command('git', ['ls-files', '-z']);
  // Retain the supplied worktree but remove history that could expose the reference fix.
  await rm('/testbed/.git', { recursive: true, force: true });
  command('git', ['init', '-q']);command('git', ['config', 'user.email', 'benchmark@localhost']);command('git', ['config', 'user.name', 'Benchmark']);
  command('git', ['add', '-A']);
  // Preserve originally tracked files even when their paths match .gitignore.
  command('git', ['add', '--force', '--pathspec-from-file=-', '--pathspec-file-nul'], { input: tracked });
  command('git', ['commit', '-qm', 'Benchmark base']);
  benchmarkBaseReady = true;
  await writeFile('/testbed/.git/info/exclude', '.specship/\n.codex/\n.agents/\n');
  result.versions = { node: process.version, codex: command('codex', ['--version']).trim(), opencode: command('opencode', ['--version']).trim(), dsh: command('dsh', ['--version']).trim() };
  if (usesOpenCodeShip(task.arm)) {
    // Fresh images must refresh public model metadata before Spec spends allowance
    // discovering a missing or stale Ship model/variant during dispatch.
    const catalog = command('opencode', ['models', task.ship.model.split('/')[0], '--refresh']);
    await writeFile(`${output}/ship-models.txt`, catalog);
    if (!catalog.includes(task.ship.model)) throw Error(`Ship model unavailable after catalog refresh: ${task.ship.model}`);
    result.ship_profile_preflight = await checkShipProfile(root, { harness: 'opencode', model: task.ship.model, executable: '/usr/local/bin/opencode', options: { ...(task.ship.effort ? { variant: task.ship.effort } : {}), shell: '/bin/bash' } });
  }
  if (usesDshShip(task.arm)) {
    if (!process.env.DEEPSEEK_API_KEY) throw Error('DEEPSEEK_API_KEY is required for the DSH benchmark arm');
    // Codex can sanitize provider variables for its MCP children. Put the key in
    // DSH's own private credential store as well as the launch environment.
    const dshHome = process.env.DSH_HOME ?? '/root/.dsh';
    await mkdir(dshHome, { recursive: true, mode: 0o700 });
    await writeFile(`${dshHome}/.credentials.yaml`, `version: 1\nrefs:\n  DEEPSEEK_API_KEY: ${JSON.stringify(process.env.DEEPSEEK_API_KEY)}\n`, { mode: 0o600 });
    result.ship_profile_preflight = await checkDshProfile(root, { harness: 'deepseek', model: task.ship.model, executable: '/usr/local/bin/dsh', options: { ...(task.ship.effort ? { reasoning_effort: task.ship.effort } : {}), sandbox: 'workspace-write' } });
  }
  // The standard SWE-bench Python instance images use this conda environment.
  process.env.PATH = `/opt/miniconda3/envs/testbed/bin:${process.env.PATH}`;
  if (task.auth_mode !== 'subscription' && !process.env.CODEX_API_KEY && process.env.OPENAI_API_KEY) process.env.CODEX_API_KEY = process.env.OPENAI_API_KEY;
  process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ permission: { '*': 'allow', task: 'deny', webfetch: 'deny' } });
  let executable, args;
  const prompt = `${task.problem_statement}\n\nImplement the requested fix in this repository and run relevant existing tests. Do not search for upstream fixes or access benchmark solutions. Do not delegate to subagents. Do not ask for human input; report unresolved ambiguity. Do not commit your changes.`;
  if (task.arm === 'ship') {
    executable = 'opencode';args = ['run', '--format', 'json', '--model', task.ship.model, ...(task.ship.effort ? ['--variant', task.ship.effort] : []), prompt];
  } else {
    executable = 'codex';args = ['exec', '--ignore-user-config', '--json', '--sandbox', 'danger-full-access', '-m', task.spec.model, '-c', 'features.multi_agent=false', ...(task.spec.effort ? ['-c', `model_reasoning_effort=${JSON.stringify(task.spec.effort)}`] : [])];
    if (task.auth_mode === 'subscription') args.push('-c', 'forced_login_method="chatgpt"', '-c', 'cli_auth_credentials_store="file"');
    if (task.arm === 'specship' || task.arm === 'specship-dsh') {
      await mkdir('/testbed/.specship', { recursive: true });
      const dsh = usesDshShip(task.arm);
      const profile = dsh
        ? { harness: 'deepseek', model: task.ship.model, executable: '/usr/local/bin/dsh', options: { ...(task.ship.effort ? { reasoning_effort: task.ship.effort } : {}), sandbox: 'workspace-write' } }
        : { harness: 'opencode', model: task.ship.model, executable: '/usr/local/bin/opencode', options: { ...(task.ship.effort ? { variant: task.ship.effort } : {}), shell: '/bin/bash', permission: { external_directory: 'allow', webfetch: 'deny' } } };
      // The benchmark is unattended, so it answers path prompts by configuration instead of
      // waiting for a human; the dispatch cap turns any other stall into a recorded failure
      // well before the container timeout.
      await writeFile('/testbed/.specship/config.json', JSON.stringify({ ship: { default_profile: 'benchmark', profiles: { benchmark: profile } }, limits: { max_dispatch_seconds: Math.max(600, (task.timeout_seconds ?? 1800) - 300) } }));
      await cp('/opt/specship/.agents/skills', '/testbed/.agents/skills', { recursive: true, force: false, errorOnExist: true });
      const config = { 'features.code_mode.direct_only_tool_namespaces': ['mcp__specship'], 'mcp_servers.specship.command': process.execPath, 'mcp_servers.specship.args': ['/opt/specship/dist/cli.js', 'serve', root], 'mcp_servers.specship.required': true, 'mcp_servers.specship.tool_timeout_sec': task.timeout_seconds + 120 };
      for (const [key, value] of Object.entries(config)) args.push('-c', `${key}=${JSON.stringify(value)}`);
    }
    args.push(task.arm === 'specship' || task.arm === 'specship-dsh' ? `$spec\n${prompt}\nUse lean supervision: send the task to the configured Ship agent promptly with a compact brief; Ship owns repository investigation, coding, debugging, and test execution. Do not perform implementation reconnaissance first or repeat Ship's tests. Wait silently during dispatch. Review the returned report and one targeted diff against the original request; rely on runner checks and criterion evidence. Request further Ship work only for a concrete defect or missing evidence. Accept the exact report when satisfied. If blocked, stop and explain; do not implement the fix yourself.` : prompt);
  }
  const events = [], stderr = [];
  const child = spawn(executable, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', chunk => events.push(chunk));child.stderr.on('data', chunk => stderr.push(chunk));
  const exit = await new Promise((resolve, reject) => { child.once('error', reject);child.once('close', resolve); });
  const text = Buffer.concat(events).toString();
  await writeFile(`${output}/events.jsonl`, text);await writeFile(`${output}/stderr.log`, Buffer.concat(stderr));
  const parsed = jsonLines(text);
  result.agent_exit_code = exit;
  if (task.arm !== 'ship') result.spec_usage = codexUsage(parsed);
  if (task.arm === 'ship') for (const event of parsed) if (event.sessionID) sessions.add(event.sessionID);
  if (task.arm === 'specship' || task.arm === 'specship-dsh') {
    const states = [];
    for (const id of await readdir('/testbed/.specship/runs').catch(() => [])) {
      const state = JSON.parse(await readFile(`/testbed/.specship/runs/${id}/state.json`, 'utf8'));states.push(state);
      if (state.adapter?.session) sessions.add(state.adapter.session);
    }
    result.accepted = states.some(state => state.lifecycle === 'completed' && state.accepted);
    result.correction_rounds = states.reduce((sum, state) => sum + state.events.filter(e => e.kind === 'implementation_ready').length, 0) - Number(result.accepted);
    // Save non-secret protocol evidence, never adapter credentials or callback descriptors.
    await writeFile(`${output}/protocol.json`, JSON.stringify(states.map(s => ({ run_id: s.run_id, lifecycle: s.lifecycle, accepted: s.accepted, activity_kind: s.activity_kind, events: s.events.map(e => ({ kind: e.kind, event_id: e.event_id })) })), null, 2));
  }
  if (usesOpenCodeShip(task.arm)) {
    const exports = [];
    const exportErrors = [];
    for (const [index, session] of [...sessions].entries()) {
      // Write directly to a regular file: CLI exit can truncate a large piped
      // stdout export. Retain raw evidence even if JSON decoding fails.
      const path = `${output}/ship-session-${index}.json`;
      const handle = await open(path, 'w', 0o600);
      try {
        try { command('opencode', ['export', session], { stdio: ['ignore', handle.fd, 'pipe'] }); }
        finally { await handle.close(); }
        exports.push(JSON.parse(await readFile(path, 'utf8')));
      } catch (error) { exportErrors.push({ session, error: error.message }); }
    }
    await writeFile(`${output}/ship-sessions.json`, JSON.stringify(exports));
    result.ship_export_errors = exportErrors;
    result.ship_usage_observed = shipUsage(exports, { reasoningIsSeparate: task.ship.rates?.reasoning_is_separate });
    result.ship_usage_complete = sessions.size > 0 && !exportErrors.length && result.ship_usage_observed !== null && exports.every(data => data.messages.filter(message => message.info?.role === 'assistant').every(message => typeof message.info.time?.completed === 'number' && !message.info.error));
    result.ship_usage = result.ship_usage_complete ? result.ship_usage_observed : null;
    result.ship_usage_source = 'opencode_export';
    result.ship_usage_model_matches = exports.every(data => data.messages.filter(message => message.info?.role === 'assistant').every(message => `${message.info.providerID}/${message.info.modelID}` === task.ship.model));
  }
  if (usesDshShip(task.arm)) {
    // DSH does not expose a durable per-message usage database in this harness;
    // keep quality evidence and leave cost explicitly unknown.
    result.ship_usage_observed = null;
    result.ship_usage_complete = false;
    result.ship_usage = null;
    result.ship_usage_source = 'dsh_unavailable';
    result.ship_usage_model_matches = null;
  }
  const finished = exit === 0 && !parsed.some(e => ['turn.failed', 'error'].includes(e.type)) && (task.arm === 'ship' || result.spec_usage !== null) && (!result.arm.startsWith('specship') || result.accepted === true);
  result.status = finished ? 'completed' : 'agent_failure';
} catch (error) { result.error = error.message; }
if (usesOpenCodeShip(task.arm)) {
  try {
    const evidence = await readShipUsage('/root/.local/share/opencode/opencode.db', { since: started, model: task.ship.model, reasoningIsSeparate: task.ship.rates?.reasoning_is_separate });
    await writeFile(`${output}/ship-usage.json`, JSON.stringify(evidence, null, 2));
    applyShipUsage(result, evidence);
  } catch (error) { result.ship_usage_database_error = error.message; }
}
Object.assign(result, trialEstimate(result, task));
// Usage/export failures must never discard the implementation needed for grading.
if (benchmarkBaseReady) {
  try {
    command('git', ['add', '-A']);
    await writeFile(`${output}/patch.diff`, command('git', ['diff', '--cached', '--binary', 'HEAD']));
  } catch (error) { result.patch_error = error.message;result.status = 'infrastructure_failure'; }
}
result.elapsed_seconds = (Date.now() - started) / 1000;
await writeFile(`${output}/result.json`, JSON.stringify(result, null, 2));
process.exitCode = result.status === 'completed' ? 0 : 1;
