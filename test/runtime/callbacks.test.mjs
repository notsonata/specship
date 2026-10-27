import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { Store } from '../../dist/state.js';
import { CallbackHub } from '../../dist/callbacks.js';
import { materializeArtifacts } from '../../dist/artifacts.js';
import { apply as registerNativeCallbacks } from '../../dist/dsh-plugin/index.js';

const question = { request_id: '__proto__', blocker: 'Ordering is unspecified', decision: 'Ascending or descending?', evidence: ['Existing sort is ambiguous'], attempts: ['Checked callers'] };
const report = { status: 'ready_for_review', changes: [], acceptance_evidence: ['done'], validation: [], deviations: [], remaining_issues: [] };
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'specship-callbacks-'));
  const store = new Store(root);
  await store.initialize();
  const state = await store.create();
  Object.assign(state, { activity_id: 'activity-1', activity_kind: 'implement', lifecycle: 'running', brief_version: 1 });
  await store.save(state);
  const hubs = [];
  async function start(value = state, storage = store) {
    const hub = new CallbackHub(storage, value);
    await hub.start(); hubs.push(hub); return hub;
  }
  const hub = await start();
  t.after(async () => {
    for (const hub of hubs) await hub.close();
    const path = await realpath(root);
    assert.equal(dirname(path), await realpath(tmpdir()));
    assert.ok(basename(path).startsWith('specship-callbacks-'));
    await rm(path, { recursive: true, force: true });
  });
  return { root, store, state, hub, start };
}
function post(hub, path, body, signal) {
  return fetch(hub.url + path, { method: 'POST', headers: { authorization: `Bearer ${hub.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: signal ?? AbortSignal.timeout(5_000) });
}

test('ready reports reject missing, duplicate, unknown or blank criterion evidence before saving and permit same-session repair', async t => {
  const f = await fixture(t);
  f.state.brief = { acceptance_criteria: [{ id: 'A1', text: 'behavior' }, { id: 'A2', text: 'validation' }] };
  await f.store.save(f.state);
  const evidence = [{ criterion_id: 'A1', evidence: 'independent behavior observed' }, { criterion_id: 'A2', evidence: 'existing tests passed' }];
  for (const acceptance_results of [undefined, [evidence[0]], [...evidence, evidence[0]], [...evidence, { criterion_id: 'typo', evidence: 'observed' }], [evidence[0], { ...evidence[1], evidence: '  ' }]]) {
    const rejected = await post(f.hub, '/report_result', { ...report, acceptance_evidence: ['A1 and A2 covered in prose'], ...(acceptance_results ? { acceptance_results } : {}) });
    assert.equal(rejected.status, 400);
    const saved = await f.store.load(f.state.run_id);
    assert.equal(saved.report, undefined);assert.equal(saved.report_id, undefined);assert.equal(saved.pending, undefined);
    assert.equal(saved.lifecycle, 'running');
  }
  const repaired = { ...report, acceptance_results: evidence };
  assert.equal((await post(f.hub, '/report_result', repaired)).status, 200);
  const id = f.state.report_id;
  assert.deepEqual((await f.store.load(f.state.run_id)).report.acceptance_results, evidence);
  assert.equal((await post(f.hub, '/report_result', repaired)).status, 200);
  assert.equal(f.state.report_id, id);
});

test('a decision report can disclose unverified criteria without claiming ready_for_review', async t => {
  const f = await fixture(t);
  f.state.brief = { acceptance_criteria: [{ id: 'A1', text: 'not yet verified' }] };
  const response = await post(f.hub, '/report_result', { ...report, status: 'needs_decision', remaining_issues: ['Need the behavior contract'] });
  assert.equal(response.status, 200);
  assert.equal((await f.store.load(f.state.run_id)).report.status, 'needs_decision');
});

test('native callback reports expose structured evidence and can repair a rejected report', async t => {
  const f = await fixture(t);
  f.state.brief = { acceptance_criteria: [{ id: 'A1', text: 'behavior' }] };
  const previousDescriptor = process.env.SPECSHIP_CALLBACK_DESCRIPTOR;
  process.env.SPECSHIP_CALLBACK_DESCRIPTOR = f.store.callbackDescriptorPath(f.state.run_id);
  t.after(() => { if (previousDescriptor === undefined) delete process.env.SPECSHIP_CALLBACK_DESCRIPTOR; else process.env.SPECSHIP_CALLBACK_DESCRIPTOR = previousDescriptor; });
  const tools = new Map();
  registerNativeCallbacks({ tools: { register(tool) { tools.set(tool.name, tool); } } });
  const tool = tools.get('report_result');
  assert.ok(tool.parameters.properties.acceptance_results, 'native schema must allow the evidence it forwards');
  await assert.rejects(tool.execute({ kind: 'implementation', ...report }), /missing criterion IDs: A1/);
  assert.equal(f.state.report, undefined);
  const acceptance_results = [{ criterion_id: 'A1', evidence: 'unchanged caller establishes the contract' }];
  assert.deepEqual(await tool.execute({ kind: 'implementation', ...report, acceptance_results }), { accepted: true });
  assert.deepEqual((await f.store.load(f.state.run_id)).report.acceptance_results, acceptance_results);
});
async function pending(state) {
  for (let count = 0; count < 200; count++) {
    if (state.events.some(event => event.kind === 'decision_required')) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('Decision event was not emitted');
}
async function answer(f, text = 'Ascending', artifacts = [], body = question) {
  f.hub.recordAnswer(body.request_id, text, artifacts, body);
  f.state.pending = { kind: 'answer', id: body.request_id, answer: text };
  await f.store.save(f.state);
  const images = await Promise.all(artifacts.map(async ref => ({ mime: ref.mime, name: ref.id, data: await (await import('node:fs/promises')).readFile(join(f.root, ref.path)) })));
  await f.hub.release(text, images);
}

test('simultaneous identical questions share one event and one durable answer', async t => {
  const f = await fixture(t);
  const first = post(f.hub, '/ask_spec', question);
  const second = post(f.hub, '/ask_spec', { ...question });
  await pending(f.state);
  const changed = await post(f.hub, '/ask_spec', { ...question, decision: 'Changed decision' });
  assert.equal(changed.status, 400);
  await answer(f);
  assert.deepEqual(await (await first).json(), { text: 'Ascending', images: [] });
  assert.deepEqual(await (await second).json(), { text: 'Ascending', images: [] });
  assert.equal(f.state.events.filter(event => event.kind === 'decision_required').length, 1);
  assert.equal((await f.store.load(f.state.run_id)).decision_callbacks[JSON.stringify(question.request_id)].answer.text, 'Ascending');
});

test('a lost HTTP response replays the saved answer after restart without reopening a question', async t => {
  const f = await fixture(t);
  const abort = new AbortController();
  const lost = post(f.hub, '/ask_spec', question, abort.signal).catch(() => undefined);
  await pending(f.state); abort.abort(); await lost;
  await answer(f);
  await f.hub.close();
  const restored = await f.store.load(f.state.run_id);
  restored.pending = { kind: 'question', id: 'new-question', body: { ...question, request_id: 'new-question' } };
  const hub = await f.start(restored, new Store(f.root));
  const replay = await post(hub, '/ask_spec', question);
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), { text: 'Ascending', images: [] });
  assert.equal(restored.pending.id, 'new-question');
  assert.equal(restored.events.length, 1);
  assert.equal((await post(hub, '/ask_spec', { ...question, evidence: ['different'] })).status, 400);
  restored.activity_id = 'activity-2';
  assert.equal((await post(hub, '/ask_spec', question)).status, 400);
});

test('a disconnected callback is detached and a later retry replays the durable answer', async t => {
  const f = await fixture(t);
  const abort = new AbortController();
  const lost = post(f.hub, '/ask_spec', question, abort.signal).catch(() => undefined);
  await pending(f.state);
  abort.abort();
  await lost;
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(f.hub.waitingForAnswer, false);
  await answer(f);
  const replay = await post(f.hub, '/ask_spec', question);
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), { text: 'Ascending', images: [] });
});

test('an unanswered retry reattaches after restart without another event', async t => {
  const f = await fixture(t);
  const old = post(f.hub, '/ask_spec', question);
  await pending(f.state);
  await f.hub.close(); assert.equal((await old).status, 503);
  f.state = await f.store.load(f.state.run_id);
  f.hub = await f.start(f.state);
  const retry = post(f.hub, '/ask_spec', question);
  for (let count = 0; count < 200 && !f.hub.waitingForAnswer; count++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(f.hub.waitingForAnswer, true);
  await answer(f);
  assert.equal((await retry).status, 200);
  assert.equal(f.state.events.length, 1);
});

test('answer replay preserves original images and rejects corrupted retained bytes', async t => {
  const f = await fixture(t);
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 7]);
  await writeFile(join(f.root, 'input.png'), bytes);
  const refs = await materializeArtifacts(f.root, [{ id: 'image', path: 'input.png', mime: 'image/png', purpose: 'test evidence' }]);
  const body = { ...question, image_artifact_ids: ['image'] };
  const first = post(f.hub, '/ask_spec', body);
  await pending(f.state); await answer(f, 'Keep original', refs, body);
  const expected = await (await first).json();
  await f.hub.close();
  const hub = await f.start(await f.store.load(f.state.run_id));
  assert.deepEqual(await (await post(hub, '/ask_spec', body)).json(), expected);
  assert.equal(expected.images[0].data, bytes.toString('base64'));
  await writeFile(join(f.root, refs[0].path), 'corrupted');
  assert.equal((await post(hub, '/ask_spec', body)).status, 400);
});

test('report retries retain their ID and cannot overwrite a pending decision', async t => {
  const f = await fixture(t);
  const waiting = post(f.hub, '/ask_spec', question);
  await pending(f.state);
  assert.equal((await post(f.hub, '/report_result', report)).status, 400);
  await answer(f); await waiting;
  assert.equal((await post(f.hub, '/report_result', report)).status, 200);
  const id = f.state.report_id;
  assert.equal((await post(f.hub, '/report_result', report)).status, 200);
  assert.equal(f.state.report_id, id);
  assert.equal((await post(f.hub, '/report_result', { ...report, changes: ['different'] })).status, 400);
});
