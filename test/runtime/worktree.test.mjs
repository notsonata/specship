import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../dist/state.js';
import { Runner } from '../../dist/runner.js';
import { readConfig } from '../../dist/config.js';

const brief = { outcome: 'produce the worktree file', acceptance: ['ship-output.txt exists'], boundaries: [], decisions: [], verified_context: [], validation: [] };
const report = { status: 'ready_for_review', changes: ['ship-output.txt'], acceptance_evidence: ['file created'], validation: ['created in worktree'], deviations: [], remaining_issues: [] };

class WorktreeAdapter {
  name = 'worktree'; workspace; callback; submitted = false; profile;
  async validate() {}
  async start(workspace, profile, _kind, callback) { this.workspace = workspace; this.profile = profile; this.callback = callback; return { session: 'worktree-session', version: '1' }; }
  async subscribe() {}
  async submit() {
    await writeFile(join(this.workspace, 'ship-output.txt'), 'from worktree\n');
    const response = await fetch(`${this.callback.url}/report_result`, { method: 'POST', headers: { authorization: `Bearer ${this.callback.capability}`, 'content-type': 'application/json' }, body: JSON.stringify(report) });
    assert.equal(response.status, 200);
    this.submitted = true;
    return { messageId: 'worktree-message' };
  }
  async *events() { yield { type: 'idle' }; }
  async reconcile() { return this.submitted ? 'complete' : 'active'; }
  async abort() { return true; }
  async close() { return true; }
  async reconcileOperation() { return { messageId: 'worktree-message', status: this.submitted ? 'complete' : 'active' }; }
  async snapshot() { return { workspace: this.workspace, session: 'worktree-session', version: '1', profile: this.profile }; }
  async restore(snapshot) { this.workspace = snapshot.workspace; this.submitted = true; return { session: snapshot.session, version: snapshot.version }; }
}

test('worktree isolation keeps Ship edits out of the project until acceptance applies the patch', async t => {
  const root = await mkdtemp(join(tmpdir(), 'specship-worktree-'));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  execFileSync('git', ['init', '--quiet', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'test@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'Specship Test']);
  await writeFile(join(root, 'base.txt'), 'base\n');
  execFileSync('git', ['-C', root, 'add', 'base.txt']);
  execFileSync('git', ['-C', root, 'commit', '--quiet', '-m', 'base']);
  const config = { ship: { default_profile: 'worktree', isolation: 'worktree', profiles: { worktree: { harness: 'opencode', model: 'openai/gpt-6-luna', options: {} } } }, limits: { max_dispatch_seconds: 30, delivery_margin_seconds: 2 } };
  await writeFile(join(root, 'config.json'), JSON.stringify(config));
  const store = new Store(root); await store.initialize();
  const adapter = new WorktreeAdapter();
  const runner = new Runner(store, await readConfig(join(root, 'config.json')), adapter);
  t.after(async () => { await runner.close().catch(() => {}); });
  const event = await runner.dispatch({ operation_id: 'worktree-first', kind: 'implement', brief });
  assert.equal(event.kind, 'implementation_ready');
  const state = await store.load(event.run_id);
  assert.equal(state.isolation, 'worktree');
  assert.ok(state.ship_workspace);
  assert.notEqual(state.ship_workspace, root);
  assert.equal(existsSync(join(root, 'ship-output.txt')), false);
  assert.equal(existsSync(join(state.ship_workspace, 'ship-output.txt')), true);
  await runner.accept(event.run_id, event.activity_id, event.report_id, event.brief_version, 'verified in the worktree');
  assert.equal(existsSync(join(root, 'ship-output.txt')), true);
  assert.equal(existsSync(state.ship_workspace), false);
  assert.equal((await store.load(event.run_id)).lifecycle, 'completed');
});

test('worktree recovery reconnects the saved worktree and applies the patch on acceptance', async t => {
  const root = await mkdtemp(join(tmpdir(), 'specship-worktree-recovery-'));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  execFileSync('git', ['init', '--quiet', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'test@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'Specship Test']);
  await writeFile(join(root, 'base.txt'), 'base\n');
  execFileSync('git', ['-C', root, 'add', 'base.txt']);
  execFileSync('git', ['-C', root, 'commit', '--quiet', '-m', 'base']);
  const config = { ship: { default_profile: 'worktree', isolation: 'worktree', profiles: { worktree: { harness: 'opencode', model: 'openai/gpt-6-luna', options: {} } } }, limits: { max_dispatch_seconds: 30, delivery_margin_seconds: 2 } };
  await writeFile(join(root, 'config.json'), JSON.stringify(config));
  const store = new Store(root); await store.initialize();
  const first = new Runner(store, await readConfig(join(root, 'config.json')), new WorktreeAdapter());
  const event = await first.dispatch({ operation_id: 'worktree-recovery', kind: 'implement', brief });
  assert.equal(event.kind, 'implementation_ready');
  await first.close();
  const leasePath = join(root, '.specship', 'active-writer.json');
  const lease = JSON.parse(await readFile(leasePath, 'utf8'));
  lease.pid = 2_000_000_000;
  await writeFile(leasePath, JSON.stringify(lease));
  const adapter = new WorktreeAdapter();
  const second = new Runner(new Store(root), await readConfig(join(root, 'config.json')), adapter);
  t.after(async () => { await second.close().catch(() => {}); });
  const recovered = await second.recover(event.run_id, event.supervisor_handle);
  assert.equal(recovered.report_id, event.report_id);
  await second.accept(event.run_id, event.activity_id, recovered.report_id, recovered.brief_version, 'recovered worktree review');
  assert.equal(existsSync(join(root, 'ship-output.txt')), true);
});
