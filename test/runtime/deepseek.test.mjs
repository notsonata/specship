import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DeepSeekAdapter } from '../../dist/adapters/deepseek.js';
import { HarnessRegistry } from '../../dist/adapters/registry.js';
import { readConfig } from '../../dist/config.js';

const fake = fileURLToPath(new URL('../fixtures/fake-acp.mjs', import.meta.url));
const profile = { harness: 'deepseek', model: 'deepseek-account/deepseek-flash', executable: process.execPath, options: { cli: fake, reasoning_effort: 'high' } };
const callback = { url: 'http://127.0.0.1:1', capability: 'fixture-capability', descriptorPath: '' };

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'specship-deepseek-'));
  const descriptor = join(root, 'callback.json');
  await writeFile(descriptor, JSON.stringify({ url: callback.url, capability: callback.capability, deadline: null, delivery_margin_ms: 120000, callback_timeout_ms: null }));
  const log = join(root, 'acp.log');
  process.env.FAKE_ACP_LOG = log;
  const adapter = new DeepSeekAdapter(2_000);
  t.after(async () => {
    await adapter.close(adapter.session).catch(() => {});
    delete process.env.FAKE_ACP_LOG;
    const resolved = await realpath(root);
    assert.equal(dirname(resolved), await realpath(tmpdir()));
    assert.ok(basename(resolved).startsWith('specship-deepseek-'));
    await rm(resolved, { recursive: true, force: true });
  });
  await adapter.validate(profile, []);
  const started = await adapter.start(root, profile, 'implement', { ...callback, descriptorPath: descriptor });
  const controller = new AbortController();
  await adapter.subscribe(started.session, controller.signal);
  t.after(() => controller.abort());
  return { root, descriptor, log, adapter, session: started.session, controller };
}

async function waitFor(check, timeout = 3_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('condition did not settle');
}

test('DeepSeek ACP starts, selects the configured model and effort, and registers the callback server', async t => {
  const f = await fixture(t);
  const snapshot = await f.adapter.snapshot(f.session);
  assert.equal(snapshot.harness, 'deepseek');
  assert.equal(snapshot.profile.model, profile.model);
  const messages = (await readFile(f.log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const created = messages.find(message => message.event === 'receive' && message.message?.method === 'session/new');
  assert.ok(created, 'session/new was not sent');
  const server = created.message.params.mcpServers[0];
  assert.equal(server.command, process.execPath);
  assert.equal(server.env[0].name, 'SPECSHIP_CALLBACK_DESCRIPTOR');
  assert.equal(server.env[0].value, f.descriptor);
  const model = messages.find(message => message.event === 'receive' && message.message?.method === 'session/set_config_option' && message.message.params.configId === 'model');
  assert.equal(model.message.params.value, '["deepseek-account","deepseek-flash"]');
  const effort = messages.find(message => message.event === 'receive' && message.message?.method === 'session/set_config_option' && message.message.params.configId === 'reasoning_effort');
  assert.equal(effort.message.params.value, 'high');
  assert.equal(await f.adapter.close(f.session), true);
  assert.equal(f.adapter.child, undefined);
});

test('DeepSeek ACP routes a native permission request and rejects it without granting it', async t => {
  const f = await fixture(t);
  const iterator = f.adapter.events(f.session, f.controller.signal)[Symbol.asyncIterator]();
  const submitted = await f.adapter.submit(f.session, 'operation-permission', 'MODE:permission', []);
  assert.equal(submitted.messageId, 'operation-permission');
  const permission = await iterator.next();
  assert.equal(permission.value.type, 'permission');
  assert.equal(permission.value.data.permissionID, '1000');
  assert.equal(permission.value.data.toolCall.toolCallId, 'call-1000');
  await f.adapter.resolvePermission(f.session, '1000', 'reject');
  await waitFor(async () => (await f.adapter.reconcile(f.session, 'operation-permission')) === 'complete');
  assert.equal(await f.adapter.reconcile(f.session, 'operation-permission'), 'complete');
  const messages = (await readFile(f.log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const result = messages.find(message => message.event === 'permission-result');
  assert.equal(result.outcome.outcome, 'selected');
  assert.equal(result.outcome.optionId, 'reject-once');
  assert.equal(await f.adapter.close(f.session), true);
});

test('DeepSeek ACP cancellation resolves the exact active prompt', async t => {
  const f = await fixture(t);
  await f.adapter.submit(f.session, 'operation-hang', 'MODE:hang', []);
  assert.equal(await f.adapter.reconcile(f.session, 'operation-hang'), 'active');
  assert.equal(await f.adapter.abort(f.session), true);
  assert.equal(await f.adapter.reconcile(f.session, 'operation-hang'), 'complete');
  assert.equal(await f.adapter.close(f.session), true);
});

test('DeepSeek ACP replies as a new prompt in the same native session', async t => {
  const f = await fixture(t);
  await f.adapter.submit(f.session, 'operation-first', 'MODE:complete', []);
  await waitFor(async () => (await f.adapter.reconcile(f.session, 'operation-first')) === 'complete');
  await f.adapter.reply(f.session, 'operation-answer', 'Continue with the approved answer.', []);
  await waitFor(async () => (await f.adapter.reconcile(f.session, 'operation-answer')) === 'complete');
  const messages = (await readFile(f.log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const prompts = messages.filter(message => message.event === 'prompt');
  assert.equal(prompts.length, 2);
  assert.match(prompts[0].text, /\[specship-operation:operation-first\]/);
  assert.match(prompts[1].text, /Continue with the approved answer\./);
  assert.match(prompts[1].text, /\[specship-operation:operation-answer\]/);
  assert.doesNotMatch(prompts[1].text, /This is a runner-associated assignment/);
  assert.equal(await f.adapter.close(f.session), true);
});

test('DeepSeek ACP snapshot and resume reconnect the exact persisted session', async t => {
  const f = await fixture(t);
  const snapshot = await f.adapter.snapshot(f.session);
  assert.equal(await f.adapter.close(f.session), true);
  const restored = new DeepSeekAdapter(2_000);
  t.after(async () => { await restored.close(restored.session).catch(() => {}); });
  const resumed = await restored.restore(snapshot, { ...callback, descriptorPath: f.descriptor });
  assert.equal(resumed.session, f.session);
  assert.equal(resumed.version, 'fake-acp-1');
  assert.equal(await restored.close(resumed.session), true);
});

test('DeepSeek writes a prompt journal and restores a completed operation', async t => {
  const f = await fixture(t);
  await f.adapter.submit(f.session, 'journal-operation', 'MODE:complete', []);
  await waitFor(async () => (await f.adapter.reconcile(f.session, 'journal-operation')) === 'complete');
  const journalPath = join(f.root, 'deepseek-prompt.json');
  let journal;
  await waitFor(async () => { try { journal = JSON.parse(await readFile(journalPath, 'utf8')); return journal.status === 'complete'; } catch { return false; } });
  assert.equal(journal.operationId, 'journal-operation');
  const snapshot = await f.adapter.snapshot(f.session);
  assert.equal(await f.adapter.close(f.session), true);
  const restored = new DeepSeekAdapter(2_000);
  t.after(async () => { await restored.close(restored.session).catch(() => {}); });
  const resumed = await restored.restore(snapshot, { ...callback, descriptorPath: f.descriptor });
  assert.equal((await restored.reconcileOperation(resumed.session, 'journal-operation')).status, 'complete');
  assert.equal(await restored.close(resumed.session), true);
});

test('DeepSeek recovery refuses to take over a saved process that is still alive', async t => {
  const f = await fixture(t);
  const snapshot = await f.adapter.snapshot(f.session);
  const other = new DeepSeekAdapter(2_000);
  await assert.rejects(other.restore(snapshot, { ...callback, descriptorPath: f.descriptor }), /still alive/);
  assert.equal(await f.adapter.close(f.session), true);
});

test('DeepSeek ACP surfaces a native prompt failure and refuses to manufacture completion', async t => {
  const f = await fixture(t);
  const iterator = f.adapter.events(f.session, f.controller.signal)[Symbol.asyncIterator]();
  await f.adapter.submit(f.session, 'operation-error', 'MODE:error', []);
  const event = await iterator.next();
  assert.equal(event.value.type, 'error');
  assert.match(event.value.data.error.message, /scripted prompt failure/);
  assert.equal(await f.adapter.reconcile(f.session, 'operation-error'), 'unknown');
  assert.equal(await f.adapter.close(f.session), true);
});

test('DeepSeek rejects image input before starting a native process', async t => {
  const adapter = new DeepSeekAdapter(2_000);
  await assert.rejects(adapter.validate(profile, ['image/png']), /no image input/);
  assert.equal(adapter.child, undefined);
});

test('DeepSeek profiles parse as a discriminated harness mode and reject foreign options', async t => {
  const root = await mkdtemp(join(tmpdir(), 'specship-deepseek-config-'));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  const path = join(root, 'config.json');
  await writeFile(path, JSON.stringify({ ship: { default_profile: 'dsh', profiles: { dsh: profile } }, limits: { max_dispatch_seconds: null, delivery_margin_seconds: 120 } }));
  const parsed = await readConfig(path);
  assert.equal(parsed.ship.profiles.dsh.harness, 'deepseek');
  await writeFile(path, JSON.stringify({ ship: { default_profile: 'dsh', profiles: { dsh: { ...profile, options: { variant: 'high' } } } }, limits: { max_dispatch_seconds: null, delivery_margin_seconds: 120 } }));
  await assert.rejects(readConfig(path));
  await writeFile(path, JSON.stringify({ ship: { default_profile: 'dsh', profiles: { dsh: { ...profile, executable: 'relative/dsh' } } }, limits: { max_dispatch_seconds: null, delivery_margin_seconds: 120 } }));
  await assert.rejects(readConfig(path), /absolute path/);
});

test('HarnessRegistry routes profiles and restores through the owning adapter', async t => {
  class Stub {
    starts = 0; validates = 0; closes = 0; restores = 0;
    constructor(name) { this.name = name; }
    async validate(p) { this.validates++; assert.equal(p.harness, this.name); }
    async start() { this.starts++; return { session: `${this.name}-session`, version: '1' }; }
    async subscribe() {}
    async submit() { return { messageId: 'message' }; }
    async *events() {}
    async reconcile() { return 'complete'; }
    async abort() { return true; }
    async reply() {}
    async snapshot(session) { return { profile: { harness: this.name }, session }; }
    async restore(snapshot) { this.restores++; return { session: snapshot.session, version: '1' }; }
    async close() { this.closes++; return true; }
    async reconcileOperation() { return { messageId: 'message', status: 'complete' }; }
  }
  const opencode = new Stub('opencode');
  const deepseek = new Stub('deepseek');
  const registry = new HarnessRegistry({ opencode, deepseek });
  const selected = { harness: 'deepseek', model: 'deepseek-account/deepseek-flash', executable: process.execPath, options: {} };
  await registry.validate(selected, []);
  const started = await registry.start('/workspace', selected, 'implement', callback);
  assert.equal(deepseek.validates, 1);
  assert.equal(deepseek.starts, 1);
  assert.equal(opencode.starts, 0);
  const snapshot = await registry.snapshot(started.session);
  assert.equal(snapshot.harness, 'deepseek');
  assert.equal(await registry.close(started.session), true);
  assert.equal(deepseek.closes, 1);
  const restored = await registry.restore(snapshot, callback);
  assert.equal(restored.session, 'deepseek-session');
  assert.equal(deepseek.restores, 1);
  assert.equal(await registry.close(restored.session), true);
});
