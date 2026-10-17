// Isolated live compatibility probe; not the production Ship adapter.
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { makeImageProbe } from '../test/fixtures/image-probe.mjs';

const [opencode, model = 'openai/gpt-6-luna', variant = 'high', scenario = 'combined', blockPixels = '64'] = process.argv.slice(2);
if (!opencode) throw new Error('Usage: node scripts/check-opencode-compatibility.mjs <opencode-executable> [model] [variant]');
if (!['combined', 'reattach', 'image', 'explore', 'implement'].includes(scenario)) throw new Error('Expected combined, reattach, image, explore, or implement scenario');
const usesImage = ['combined', 'reattach', 'image'].includes(scenario);
const usesCallback = ['combined', 'reattach', 'explore'].includes(scenario);
const split = model.indexOf('/');
if (split < 1) throw new Error('Expected provider/model');
const providerID = model.slice(0, split), modelID = model.slice(split + 1);
const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, '.specship', 'compatibility', `${new Date().toISOString().replace(/[:.]/g, '-')}-opencode`);
const workspace = join(output, 'workspace');
mkdirSync(workspace, { recursive: true });
const git = spawnSync('git', ['init', '--quiet', workspace], { encoding: 'utf8', windowsHide: true });
if (git.status !== 0) throw new Error(`Cannot isolate the fixture repository: ${git.stderr}`);
const auditFile = join(output, 'mcp-audit.jsonl');
const releaseFile = join(output, 'decision.json');
const image = makeImageProbe(Number(blockPixels));
if (usesImage) writeFileSync(join(output, 'reference.png'), image.png);
const token = randomUUID();
const fixtureInput = `${JSON.stringify({ token })}\n`;
const initialSource = 'export function uniqueSorted(values) { throw new Error("not implemented"); }\n';
const fixtureTests = `import test from 'node:test';
import assert from 'node:assert/strict';
import { uniqueSorted } from './numbers.mjs';
test('numeric ordering, duplicates, negatives, and no input mutation', () => {
  const input = [10, -1, 2, 10, 0, -1];
  assert.deepEqual(uniqueSorted(input), [-1, 0, 2, 10]);
  assert.deepEqual(input, [10, -1, 2, 10, 0, -1]);
});
test('empty and repeated input', () => {
  assert.deepEqual(uniqueSorted([]), []);
  assert.deepEqual(uniqueSorted([7, 7]), [7]);
});\n`;
if (scenario === 'explore') writeFileSync(join(workspace, 'input.json'), fixtureInput);
if (scenario === 'implement') {
  writeFileSync(join(workspace, 'numbers.mjs'), initialSource);
  writeFileSync(join(workspace, 'numbers.test.mjs'), fixtureTests);
}
const permission = { '*': 'deny',
  ...(usesCallback ? { gate_gate_wait: 'allow' } : {}),
  ...(['explore', 'implement'].includes(scenario) ? { read: 'allow', glob: 'allow', grep: 'allow' } : {}),
  ...(scenario === 'implement' ? {
    edit: { '*': 'deny', 'numbers.mjs': 'allow' },
    bash: { '*': 'deny', 'node --test numbers.test.mjs': 'allow' },
  } : {}),
};
const config = {
  model,
  permission,
  agent: { compatibility: {
    description: 'Isolated compatibility check', mode: 'primary', model,
    permission,
    prompt: 'Perform only the explicit compatibility probe within this fixture repository and the configured permissions. Return exactly the JSON object requested by the user without commentary.',
  } },
  provider: { [providerID]: { models: { [modelID]: { options: { reasoningEffort: variant } } } } },
  mcp: { gate: {
    type: 'local', enabled: usesCallback, timeout: 90_000,
    command: [process.execPath, resolve(root, 'test/fixtures/blocking-mcp.mjs')],
    environment: { SPECSHIP_GATE_AUDIT: auditFile, SPECSHIP_GATE_DELAY_MS: '80000', SPECSHIP_GATE_RELEASE_FILE: releaseFile,
      ...(scenario === 'reattach' ? { SPECSHIP_GATE_IMAGE_FILE: join(output, 'reference.png') } : {}),
    },
  } },
};
writeFileSync(join(output, 'invocation.json'), JSON.stringify({ model, variant, scenario, permission, image_block_pixels: Number(blockPixels), expected_colors: image.colors, started_at: new Date().toISOString() }, null, 2));
console.log(`OpenCode gate: ${model} / ${variant}; evidence=${output}`);
// OpenCode's --port 0 selects its preferred port on this version, not an OS
// assigned port. Choose a free port explicitly so isolated probes can coexist.
const listener = createServer();
await new Promise((done, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', done); });
const port = listener.address().port;
await new Promise((done) => listener.close(done));
const child = spawn(opencode, ['serve', '--hostname', '127.0.0.1', '--port', String(port)], {
  cwd: workspace, windowsHide: true,
  env: { ...process.env, PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}`, OPENCODE_CONFIG_CONTENT: JSON.stringify(config) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stdout = '', exited = false;
child.stdout.on('data', (data) => { stdout += data; appendFileSync(join(output, 'stdout.log'), data); });
child.stderr.on('data', (data) => appendFileSync(join(output, 'stderr.log'), data));
child.on('error', (cause) => { stdout += cause.message; exited = true; });
const closed = new Promise((done) => child.on('close', (code) => { exited = true; done(code); }));
const until = async (condition, timeout = 30_000) => {
  const end = Date.now() + timeout;
  while (!condition()) {
    if (exited) throw new Error('OpenCode server exited during probe');
    if (Date.now() > end) throw new Error('Probe condition deadline');
    await delay(50);
  }
};
const summary = { status: 'failed', model, variant, scenario, failures: [] };
let api;
try {
  await until(() => /http:\/\/127\.0\.0\.1:\d+/.test(stdout));
  const address = stdout.match(/http:\/\/127\.0\.0\.1:\d+/)[0];
  api = async (path, body, timeoutMs = 10_000) => {
    const response = await fetch(`${address}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${path}: ${response.status} ${text.slice(0, 1500)}`);
    return text ? JSON.parse(text) : null;
  };
  const health = await api('/global/health');
  summary.opencode_version = health.version;
  const providers = await api('/provider');
  const provider = providers.all?.find((entry) => entry.id === providerID);
  const selected = provider?.models?.[modelID];
  writeFileSync(join(output, 'selected-model.json'), JSON.stringify(selected ?? null, null, 2));
  if (!selected) throw new Error('Requested model is not available in the live server catalog');
  if (usesImage && !selected.capabilities?.input?.image) throw new Error('Selected model does not advertise image input');
  if (selected.variants?.[variant]?.reasoningEffort !== variant) throw new Error('Requested reasoning variant is not available');
  const resolvedConfig = await api('/config');
  if (resolvedConfig.provider?.[providerID]?.models?.[modelID]?.options?.reasoningEffort !== variant) throw new Error('High reasoning configuration was not applied');
  summary.model_catalog_confirmed = true;
  summary.reasoning_options_confirmed = true;
  const agents = await api('/agent');
  const agent = agents.find((entry) => entry.name === 'compatibility');
  writeFileSync(join(output, 'agent.json'), JSON.stringify(agent, null, 2));
  if (!agent) throw new Error('Compatibility agent was not registered');
  if (scenario === 'explore') {
    for (const name of ['edit', 'write', 'apply_patch', 'bash', 'task', 'skill']) {
      const action = agent.permission.filter((rule) => [name, '*'].includes(rule.permission) && rule.pattern === '*').at(-1)?.action;
      if (action !== 'deny') throw new Error(`Exploration does not deny ${name}`);
    }
    summary.exploration_write_permissions_denied = true;
  }
  const mcp = await api('/mcp');
  if (usesCallback && mcp.gate?.status !== 'connected') throw new Error(`MCP fixture did not connect: ${JSON.stringify(mcp.gate)}`);
  const session = await api('/session', { title: `Specship compatibility: ${scenario}` });
  summary.session_id = session.id;
  const answer = randomUUID();
  const instructions = {
    image: 'Inspect the attached image. Return only JSON with colors (the four color block names from left to right, lowercase). Use no tools.',
    combined: 'Call gate_gate_wait exactly once with probe_id "ship-callback" and wait for the supervisor decision. Then inspect the attached image. Return only JSON with decision (the exact answer returned by the tool) and colors (the four color block names from left to right, lowercase). Use no other tools and do not modify files.',
    reattach: 'Call gate_gate_wait exactly once with probe_id "ship-callback" and wait for the supervisor decision. Its result will include the original image again. Inspect that returned image after the wait. Return only JSON with decision (the string value of the decision field in the tool result) and colors (the four color block names from left to right, lowercase). Use no other tools and do not modify files.',
    explore: 'Read input.json to obtain its token. Do not modify any files. Call gate_gate_wait exactly once with probe_id "ship-callback" and wait for the supervisor answer. Return only JSON with token (the string from the file) and decision (the string value of the decision field in the tool result, not the entire tool result object).',
    implement: 'Implement uniqueSorted(values) in numbers.mjs: numeric ascending order, duplicates removed, empty input allowed, without mutating the input. Change only numbers.mjs. Read the existing source and tests, run exactly node --test numbers.test.mjs, then return only JSON with status "ready_for_review" and changes (a short string). Do not change the tests or use other shell commands.',
  };
  const prompt = api(`/session/${session.id}/message`, {
    agent: 'compatibility', model: { providerID, modelID }, variant,
    parts: [
      { type: 'text', text: instructions[scenario] },
      ...(usesImage ? [{ type: 'file', mime: 'image/png', filename: 'reference.png', url: `data:image/png;base64,${image.png.toString('base64')}` }] : []),
    ],
  }, 300_000);
  // Handle the rejection immediately while independently observing the callback.
  const promptOutcome = prompt.then((value) => ({ value }), (error) => ({ error }));
  const readAudit = () => existsSync(auditFile) ? readFileSync(auditFile, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  let completedEarly = false;
  void promptOutcome.then(() => { completedEarly = true; });
  if (usesCallback) {
    await until(() => readAudit().some((event) => event.kind === 'wait_started' && event.probe_id === 'ship-callback') || completedEarly, 60_000);
    if (completedEarly) {
      const outcome = await promptOutcome;
      throw outcome.error ?? new Error(`Model completed without calling the callback: ${JSON.stringify(outcome.value).slice(0, 800)}`);
    }
    console.log('OpenCode callback is pending; releasing a simulated supervisor decision after 3 seconds.');
    await delay(3000);
    if (completedEarly) throw new Error('Callback did not actually block');
    writeFileSync(releaseFile, JSON.stringify({ probe_id: 'ship-callback', answer }));
  }
  const outcome = await promptOutcome;
  if (outcome.error) throw outcome.error;
  const response = outcome.value;
  writeFileSync(join(output, 'response.json'), JSON.stringify(response, null, 2));
  if (response.info?.error) throw new Error(`Model request failed: ${JSON.stringify(response.info.error)}`);
  const text = response.parts.filter((part) => part.type === 'text').map((part) => part.text).join('\n').replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  const report = JSON.parse(text);
  if (!report || Array.isArray(report) || typeof report !== 'object') throw new Error('Model did not return the requested report object');
  if (usesCallback) {
    if (report.decision !== answer) throw new Error('Model did not receive the supervisor answer');
    summary.callback_answer_confirmed = true;
    summary.callback_wait_ms = readAudit().filter((event) => event.kind === 'wait_completed').at(-1)?.elapsed_ms;
    if (scenario === 'reattach') {
      const hash = readAudit().filter((event) => event.kind === 'wait_completed').at(-1)?.image_sha256;
      if (hash !== createHash('sha256').update(image.png).digest('hex')) throw new Error('Callback did not return the exact original image');
      summary.original_image_reattached = true;
    }
  }
  if (response.info.modelID !== modelID || response.info.providerID !== providerID) throw new Error('Response came from a different model/provider');
  const messages = await api(`/session/${session.id}/message`);
  const toolCalls = messages.flatMap((message) => message.parts.filter((part) => part.type === 'tool'));
  summary.tools_used = toolCalls.map((part) => part.tool);
  writeFileSync(join(output, 'messages.json'), JSON.stringify(messages, null, 2));
  const allowed = usesImage ? (usesCallback ? ['gate_gate_wait'] : [])
    : scenario === 'explore' ? ['read', 'glob', 'grep', 'gate_gate_wait'] : ['read', 'glob', 'grep', 'edit', 'write', 'apply_patch', 'bash'];
  if (summary.tools_used.some((name) => !allowed.includes(name))) throw new Error('Unexpected tool execution');
  if (usesCallback && summary.tools_used.filter((name) => name === 'gate_gate_wait').length !== 1) throw new Error('Expected exactly one callback');
  summary.model_confirmed = true;
  if (scenario === 'explore') {
    if (report.token !== token || !summary.tools_used.includes('read')) throw new Error('Exploration did not read the real fixture');
    if (readFileSync(join(workspace, 'input.json'), 'utf8') !== fixtureInput) throw new Error('Exploration modified its input');
    summary.read_only_exploration_confirmed = true;
  }
  if (scenario === 'implement') {
    if (report.status !== 'ready_for_review') throw new Error('Missing implementation report');
    if (readFileSync(join(workspace, 'numbers.test.mjs'), 'utf8') !== fixtureTests) throw new Error('Ship modified the tests');
    if (!toolCalls.some((part) => part.tool === 'bash' && part.state.status === 'completed' && part.state.input.command === 'node --test numbers.test.mjs')) throw new Error('Ship did not run the required test command');
    const check = spawnSync(process.execPath, ['--test', 'numbers.test.mjs'], { cwd: workspace, encoding: 'utf8', windowsHide: true, timeout: 10_000 });
    writeFileSync(join(output, 'independent-tests.log'), `${check.stdout ?? ''}${check.stderr ?? ''}`);
    if (check.status !== 0) throw new Error('Independent implementation tests failed');
    summary.implementation_confirmed = true;
  }
  if (usesImage) {
    summary.returned_image_order = report.colors;
    if (JSON.stringify(report.colors) !== JSON.stringify(image.colors)) throw new Error(`Image mismatch: ${JSON.stringify(report.colors)}`);
    summary.image_confirmed = true;
  }
  summary.status = 'passed';
} catch (cause) {
  summary.failures.push(cause.message);
  if (api && summary.session_id) {
    try {
      const messages = await api(`/session/${summary.session_id}/message`);
      writeFileSync(join(output, 'failed-session.json'), JSON.stringify(messages, null, 2));
    } catch { /* Preserve the primary failure. */ }
  }
} finally {
  if (api && summary.session_id) {
    try { await api(`/session/${summary.session_id}/abort`, {}); } catch { /* Preserve primary evidence. */ }
  }
  child.kill();
  await closed;
}
writeFileSync(join(output, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
process.exitCode = summary.status === 'passed' ? 0 : 1;
