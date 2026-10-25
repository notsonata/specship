import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Store } from '../../dist/state.js';
import { Runner } from '../../dist/runner.js';
import { readConfig } from '../../dist/config.js';

const brief = { outcome: 'checked', acceptance: ['works'], acceptance_criteria: [{ id: 'A1', text: 'works' }], boundaries: [], decisions: [], verified_context: [], validation: [], required_checks: ['pass'] };
const report = { status: 'ready_for_review', changes: ['checked'], acceptance_evidence: ['A1 works'], validation: ['runner check'], deviations: [], remaining_issues: [], acceptance_results: [{ criterion_id: 'A1', evidence: 'criterion observed' }] };

class ReportAdapter {
  name = 'report'; callback; workspace; submitted = false; covered = false;
  async validate() {}
  async start(workspace, _p, _k, callback) { this.workspace = workspace; this.callback = callback; return { session: 'report-session', version: '1' }; }
  async subscribe() {}
  async submit() {
    const response = await fetch(`${this.callback.url}/report_result`, { method: 'POST', headers: { authorization: `Bearer ${this.callback.capability}`, 'content-type': 'application/json' }, body: JSON.stringify(report) });
    if (!response.ok) throw new Error(await response.text());
    this.submitted = true;
    return { messageId: 'report-message' };
  }
  async *events() { yield { type: 'idle' }; }
  async reconcile() { return this.submitted ? 'complete' : 'active'; }
  async abort() { return true; }
  async close() { this.covered = true; return true; }
  async reconcileOperation() { return { messageId: 'report-message', status: this.submitted ? 'complete' : 'active' }; }
}

async function fixture(t, checks) {
  const root = await mkdtemp(join(tmpdir(), 'specship-checks-'));
  const config = { ship: { default_profile: 'report', profiles: { report: { harness: 'opencode', model: 'openai/gpt-6-luna', options: {} } } }, limits: { max_dispatch_seconds: 30, delivery_margin_seconds: 2 }, checks };
  await writeFile(join(root, 'config.json'), JSON.stringify(config));
  const parsed = await readConfig(join(root, 'config.json'));
  const store = new Store(root); await store.initialize();
  const adapter = new ReportAdapter();
  const runner = new Runner(store, parsed, adapter);
  t.after(async () => { await runner.close().catch(() => {}); await rm(root, { recursive: true, force: true }); });
  return { root, store, runner, adapter };
}

test('configured acceptance checks run in the workspace and gate acceptance', async t => {
  const f = await fixture(t, { pass: { command: `${process.execPath} -e process.exit(0)`, cwd: '.', timeout_ms: 5_000 } });
  const event = await f.runner.dispatch({ operation_id: 'checks-pass', kind: 'implement', brief });
  assert.equal(event.kind, 'implementation_ready');
  assert.equal(event.payload.checks_passed, true);
  assert.equal(event.payload.checks[0].status, 'passed');
  await f.runner.accept(event.run_id, event.activity_id, event.report_id, event.brief_version, 'independent review');
  assert.equal((await f.store.load(event.run_id)).lifecycle, 'completed');
});

test('a failing configured check is retained as evidence and blocks acceptance', async t => {
  const f = await fixture(t, { pass: { command: `${process.execPath} -e process.exit(3)`, cwd: '.', timeout_ms: 5_000 } });
  const event = await f.runner.dispatch({ operation_id: 'checks-fail', kind: 'implement', brief });
  assert.equal(event.kind, 'implementation_ready');
  assert.equal(event.payload.checks_passed, false);
  assert.equal(event.payload.checks[0].status, 'failed');
  await assert.rejects(f.runner.accept(event.run_id, event.activity_id, event.report_id, event.brief_version, 'independent review'), /acceptance checks did not pass/);
});

class DriftAdapter extends ReportAdapter {
  ready = false;
  async submit() {
    const result = await super.submit();
    await writeFile(join(this.workspace, 'drift.txt'), 'changed');
    this.ready = true;
    return result;
  }
  async *events() { while (!this.ready) await new Promise(resolve => setTimeout(resolve, 10)); yield { type: 'idle' }; }
  async reconcile() { return this.ready ? 'complete' : 'active'; }
}

test('a workspace change after reporting becomes a recovery decision, not implementation_ready', async t => {
  const root = await mkdtemp(join(tmpdir(), 'specship-drift-'));
  execFileSync('git', ['init', '--quiet', root]);
  const config = { ship: { default_profile: 'report', profiles: { report: { harness: 'opencode', model: 'openai/gpt-6-luna', options: {} } } }, limits: { max_dispatch_seconds: 30, delivery_margin_seconds: 2 } };
  await writeFile(join(root, 'config.json'), JSON.stringify(config));
  const store = new Store(root); await store.initialize();
  const adapter = new DriftAdapter();
  const runner = new Runner(store, await readConfig(join(root, 'config.json')), adapter);
  t.after(async () => { await runner.close().catch(() => {}); await rm(root, { recursive: true, force: true }); });
  const event = await runner.dispatch({ operation_id: 'drift-after-report', kind: 'implement', brief: { ...brief, required_checks: [] } });
  assert.equal(event.kind, 'decision_required');
  assert.equal(event.payload.kind, 'recovery_review');
  assert.ok(event.payload.body.evidence.includes('drift.txt'));
});

test('missing acceptance criterion coverage blocks acceptance', async t => {
  const f = await fixture(t, {});
  const event = await f.runner.dispatch({ operation_id: 'checks-coverage', kind: 'implement', brief: { ...brief, required_checks: [] } });
  assert.equal(event.kind, 'implementation_ready');
  assert.deepEqual(event.payload.uncovered_criteria, []);
  f.runner.active.get(event.run_id).state.report.acceptance_results = [];
  await assert.rejects(f.runner.accept(event.run_id, event.activity_id, event.report_id, event.brief_version, 'independent review'), /Acceptance evidence is missing/);
});
