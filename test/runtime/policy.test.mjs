import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../dist/state.js';
import { assertInvariants, phaseFromLegacy, setPhase, transition } from '../../dist/policy.js';
import { SpecshipError, toToolError } from '../../dist/errors.js';

const base = () => ({
  schema: 2, phase: 'idle', state_version: 0, run_id: 'run-1', workspace: 'C:/workspace', lifecycle: 'idle', writer: false,
  brief_version: 0, operation_ids: {}, events: [],
});

test('policy transitions reject invalid and terminal actions with typed errors', () => {
  const state = base();
  transition(state, 'dispatch');
  assert.equal(state.phase, 'running');
  assert.equal(state.lifecycle, 'running');
  transition(state, 'ship_question');
  assert.equal(state.phase, 'awaiting_decision');
  assert.equal(state.lifecycle, 'awaiting_spec');
  transition(state, 'reply');
  assert.equal(state.phase, 'running');
  setPhase(state, 'completed');
  assert.throws(() => transition(state, 'dispatch'), error => error instanceof SpecshipError && error.code === 'TERMINAL_RUN');
  assert.equal(phaseFromLegacy('awaiting_spec'), 'awaiting_decision');
  assert.equal(phaseFromLegacy('limit_reached'), 'limit_reached');
});

test('state invariants reject inconsistent report and pending states', () => {
  const state = base();
  setPhase(state, 'awaiting_review');
  assert.throws(() => assertInvariants(state), /report and report_id/);
  state.report = { status: 'ready_for_review' };
  state.report_id = 'report-1';
  assert.doesNotThrow(() => assertInvariants(state));
  const pending = { ...base(), phase: 'awaiting_decision', lifecycle: 'awaiting_spec' };
  assert.throws(() => assertInvariants(pending), /pending interaction/);
});

test('v1 run state migrates to v2 and keeps a private backup', async t => {
  const root = await mkdtemp(join(tmpdir(), 'specship-policy-'));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  const store = new Store(root);
  await store.initialize();
  const created = await store.create();
  const runDir = store.runDir(created.run_id);
  const v1 = { schema: 1, run_id: created.run_id, workspace: root, lifecycle: 'idle', writer: false, brief_version: 0, operation_ids: {}, events: [] };
  await writeFile(join(runDir, 'state.json'), JSON.stringify(v1));
  const loaded = await store.load(created.run_id);
  assert.equal(loaded.schema, 2);
  assert.equal(loaded.phase, 'idle');
  assert.equal(loaded.state_version, 0);
  assert.deepEqual(JSON.parse(await readFile(join(runDir, 'state.v1.backup.json'), 'utf8')), v1);
  await store.save(loaded);
  const saved = JSON.parse(await readFile(join(runDir, 'state.json'), 'utf8'));
  assert.equal(saved.schema, 2);
  assert.equal(saved.phase, 'idle');
  assert.equal(saved.state_version, 1);
  setPhase(loaded, 'running');
  await store.save(loaded);
  const transitions = await store.readTransitions(created.run_id);
  assert.equal(transitions.at(-1).from, 'idle');
  assert.equal(transitions.at(-1).to, 'running');
  assert.equal((await store.transitionAudit(created.run_id)).ok, true);
  const journalPath = join(runDir, 'transitions.jsonl');
  await writeFile(journalPath, (await readFile(journalPath, 'utf8')).replace('"to":"running"', '"to":"paused"'));
  assert.equal((await store.transitionAudit(created.run_id)).ok, false);
});

test('operation lookup uses and refreshes a durable index', async t => {
  const root = await mkdtemp(join(tmpdir(), 'specship-operation-index-'));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  const store = new Store(root); await store.initialize();
  const state = await store.create();
  state.operation_ids['indexed-operation'] = { operation_id: 'indexed-operation', marker: true };
  await store.save(state);
  const found = await store.findOperation('indexed-operation');
  assert.equal(found.state.run_id, state.run_id);
  assert.equal(found.result.marker, true);
  const index = JSON.parse(await readFile(join(root, '.specship', 'operations.json'), 'utf8'));
  assert.equal(index['indexed-operation'], state.run_id);
});

test('structured tool errors keep a stable code and message', () => {
  const result = toToolError(new SpecshipError('WAIT_WITHOUT_PROGRESS', 'no new event', { details: { run_id: 'r' } }));
  assert.equal(result.isError, true);
  const value = JSON.parse(result.content[0].text);
  assert.equal(value.error.code, 'WAIT_WITHOUT_PROGRESS');
  assert.equal(value.error.message, 'no new event');
  assert.equal(value.error.retryable, false);
  assert.deepEqual(value.error.details, { run_id: 'r' });
});
