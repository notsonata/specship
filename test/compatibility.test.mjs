import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { analyzeEvidence, analyzeInterruptedEvidence } from '../scripts/compatibility-evidence.mjs';
import { makeImageProbe } from './fixtures/image-probe.mjs';

async function fixture(t, waitMs = 150, markers = false, image = null) {
  const folder = mkdtempSync(join(tmpdir(), 'specship-gate-'));
  const auditFile = join(folder, 'audit.jsonl');
  const releaseFile = join(folder, 'decision.json');
  const interruptFile = join(folder, 'interrupt.json');
  const imageFile = join(folder, 'reference.png');
  if (image) writeFileSync(imageFile, image);
  const child = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/blocking-mcp.mjs', import.meta.url))], {
    env: { ...process.env, SPECSHIP_GATE_AUDIT: auditFile, SPECSHIP_GATE_DELAY_MS: String(waitMs),
      ...(markers ? { SPECSHIP_GATE_RELEASE_FILE: releaseFile, SPECSHIP_GATE_INTERRUPT_FILE: interruptFile } : {}),
      ...(image ? { SPECSHIP_GATE_IMAGE_FILE: imageFile } : {}),
    },
    windowsHide: true,
  });
  const messages = [];
  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    for (let index; (index = buffer.indexOf('\n')) !== -1;) {
      messages.push(JSON.parse(buffer.slice(0, index)));
      buffer = buffer.slice(index + 1);
    }
  });
  const closed = new Promise((done) => child.on('close', done));
  t.after(async () => {
    child.stdin.end(); await closed;
    assert.ok(resolve(folder).startsWith(`${resolve(tmpdir())}${sep}specship-gate-`));
    rmSync(folder, { recursive: true, force: true });
  });
  const send = (id, method, params) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...(id == null ? {} : { id }), method, params })}\n`);
  const until = async (condition) => {
    const expires = Date.now() + 3000;
    while (!condition()) { if (Date.now() > expires) throw new Error('Fixture deadline'); await delay(5); }
  };
  send(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  await until(() => messages.some((message) => message.id === 1));
  return { messages, send, until, releaseFile, interruptFile, audit: () => readFileSync(auditFile, 'utf8').trim().split('\n').map(JSON.parse) };
}

test('callback releases only the requested decision and preserves its answer', async (t) => {
  const server = await fixture(t, 3000, true);
  server.send(2, 'tools/call', { name: 'gate_wait', arguments: { probe_id: 'decision' } });
  await server.until(() => server.audit().some((event) => event.kind === 'wait_started'));
  writeFileSync(server.releaseFile, JSON.stringify({ probe_id: 'wrong', answer: 'ignore' }));
  await delay(50);
  assert.equal(server.messages.some((message) => message.id === 2), false);
  writeFileSync(server.releaseFile, JSON.stringify({ probe_id: 'decision', answer: 'actual decision' }));
  await server.until(() => server.messages.some((message) => message.id === 2));
  assert.equal(JSON.parse(server.messages.find((message) => message.id === 2).result.content[0].text).decision, 'actual decision');
});

test('callback image content preserves the original bytes and text answer', async (t) => {
  const original = makeImageProbe().png;
  const server = await fixture(t, 3000, true, original);
  server.send(2, 'tools/call', { name: 'gate_wait', arguments: { probe_id: 'media' } });
  await server.until(() => server.audit().some((event) => event.kind === 'wait_started'));
  writeFileSync(server.releaseFile, JSON.stringify({ probe_id: 'media', answer: 'keep the original' }));
  await server.until(() => server.messages.some((message) => message.id === 2));
  const content = server.messages.find((message) => message.id === 2).result.content;
  assert.equal(JSON.parse(content[0].text).decision, 'keep the original');
  assert.equal(content[1].type, 'image');
  assert.equal(content[1].mimeType, 'image/png');
  assert.deepEqual(Buffer.from(content[1].data, 'base64'), original);
});

test('missing supervisor answer expires as an error, never as successful completion', async (t) => {
  const server = await fixture(t, 80, true);
  server.send(2, 'tools/call', { name: 'gate_wait', arguments: { probe_id: 'unanswered' } });
  await server.until(() => server.messages.some((message) => message.id === 2));
  assert.equal(server.messages.find((message) => message.id === 2).result.isError, true);
  assert.equal(server.audit().some((event) => event.kind === 'wait_expired'), true);
  assert.equal(server.audit().some((event) => event.kind === 'wait_completed'), false);
});

test('Interrupt fixture matches the exact caller and never manufactures success', async (t) => {
  const server = await fixture(t, 3000, true);
  const session = '01a147e1-7307-79e2-b903-4b7a2c0afb78';
  const turn = '01a147e0-7adc-7740-bf40-95a0ed0caa59';
  server.send(2, 'tools/call', { name: 'gate_wait', arguments: { probe_id: 'interrupt' }, _meta: { threadId: session, 'x-codex-turn-metadata': JSON.stringify({ turn_id: turn }) } });
  await server.until(() => server.audit().some((event) => event.kind === 'wait_started'));
  writeFileSync(server.interruptFile, JSON.stringify({ session_id: 'other', turn_id: turn }));
  await delay(50);
  assert.equal(server.messages.some((message) => message.id === 2), false);
  writeFileSync(server.interruptFile, JSON.stringify({ session_id: session, turn_id: 'older-turn' }));
  await delay(50);
  assert.equal(server.messages.some((message) => message.id === 2), false);
  const child = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/interrupt-hook.mjs', import.meta.url)), server.interruptFile], { windowsHide: true });
  let stdout = '', stderr = '';
  child.stdout.on('data', (data) => { stdout += data; });
  child.stderr.on('data', (data) => { stderr += data; });
  const closed = new Promise((done) => child.on('close', done));
  child.stdin.end(JSON.stringify({ hook_event_name: 'Interrupt', session_id: session, turn_id: turn }));
  assert.equal(await closed, 0, stderr);
  assert.equal(stdout, '');
  await server.until(() => server.messages.some((message) => message.id === 2));
  assert.equal(server.messages.find((message) => message.id === 2).result.isError, true);
  assert.equal(server.audit().some((event) => event.kind === 'wait_completed'), false);
  assert.equal(server.audit().some((event) => event.kind === 'wait_interrupted'), true);
  assert.equal(existsSync(server.interruptFile), true);
});

test('MCP stays silent until one event, while transport ping remains responsive', async (t) => {
  const server = await fixture(t);
  server.send(2, 'tools/call', { name: 'gate_wait', arguments: { probe_id: 'one' } });
  await server.until(() => server.audit().some((event) => event.kind === 'wait_started'));
  await delay(35);
  assert.equal(server.messages.some((message) => message.id === 2), false);
  server.send(3, 'ping', {});
  await server.until(() => server.messages.some((message) => message.id === 3));
  assert.equal(server.messages.some((message) => message.id === 2), false);
  await server.until(() => server.messages.some((message) => message.id === 2));
  assert.equal(server.messages.filter((message) => message.id === 2).length, 1);
  assert.ok(server.audit().find((event) => event.kind === 'wait_completed').elapsed_ms >= 150);
});

test('cancellation stops the pending timer without manufacturing a result', async (t) => {
  const server = await fixture(t, 80);
  server.send(2, 'tools/call', { name: 'gate_wait', arguments: { probe_id: 'cancel' } });
  await server.until(() => server.audit().some((event) => event.kind === 'wait_started'));
  server.send(null, 'notifications/cancelled', { requestId: 2 });
  await server.until(() => server.audit().some((event) => event.kind === 'wait_cancelled'));
  await delay(100);
  assert.equal(server.messages.some((message) => message.id === 2), false);
  assert.equal(server.audit().some((event) => event.kind === 'wait_completed'), false);
});

test('rejects concurrent polling and invalid tool arguments', async (t) => {
  const server = await fixture(t);
  server.send(2, 'tools/call', { name: 'gate_wait', arguments: { probe_id: 'first' } });
  server.send(3, 'tools/call', { name: 'gate_wait', arguments: { probe_id: 'poll' } });
  server.send(4, 'tools/call', { name: 'gate_wait', arguments: { probe_id: '', delay_ms: 1 } });
  await server.until(() => server.messages.some((message) => message.id === 4));
  assert.ok(server.messages.find((message) => message.id === 3).error);
  assert.ok(server.messages.find((message) => message.id === 4).error);
});

function evidence() {
  return {
    delayMs: 130_000, exitCode: 0,
    audit: [
      { at: '2026-10-16T00:00:00.000Z', kind: 'request', method: 'tools/call' },
      { at: '2026-10-16T00:00:00.000Z', kind: 'wait_started', request_id: 2 },
      { at: '2026-10-16T00:02:10.000Z', kind: 'wait_completed', request_id: 2, elapsed_ms: 130_000 },
    ],
    events: [
      { at: '2026-10-16T00:02:11.000Z', event: { type: 'item.completed', item: { type: 'agent_message', text: 'GATE_OK' } } },
      { at: '2026-10-16T00:02:11.000Z', event: { type: 'turn.completed', usage: { output_tokens: 20 } } },
    ],
    telemetry: [
      { at: '2026-10-15T23:59:59.000Z', type: 'token_count', total_tokens: 100 },
      { at: '2026-10-15T23:59:59.500Z', type: 'function_call', call_id: 'probe' },
      { at: '2026-10-16T00:02:10.500Z', type: 'function_call_output', call_id: 'probe' },
    ],
  };
}

test('analyzer accepts quiet measured execution and rejects missing usage telemetry', () => {
  const data = evidence();
  assert.equal(analyzeEvidence(data).status, 'passed');
  data.telemetry = [];
  assert.equal(analyzeEvidence(data).status, 'inconclusive');
});

test('analyzer fails model activity, increased usage, early return, or a failed turn', () => {
  for (const mutate of [
    (data) => data.events.push({ at: '2026-10-16T00:01:00.000Z', event: { type: 'item.completed', item: { type: 'command_execution' } } }),
    (data) => data.telemetry.push({ at: '2026-10-16T00:01:00.000Z', type: 'token_count', total_tokens: 101 }),
    (data) => data.telemetry.push({ at: '2026-10-16T00:01:00.000Z', type: 'reasoning' }),
    (data) => { data.audit[2].elapsed_ms = 60_000; },
    (data) => { data.exitCode = 1; },
  ]) {
    const data = evidence(); mutate(data);
    assert.equal(analyzeEvidence(data).status, 'failed');
  }
});

test('requires complete session evidence when usage is deferred until tool return', () => {
  const data = evidence();
  data.telemetry[0].at = '2026-10-16T00:02:11.000Z';
  assert.equal(analyzeEvidence(data).status, 'passed');
  data.telemetry.pop();
  assert.equal(analyzeEvidence(data).status, 'inconclusive');
});

test('short smoke waits and hidden wrapper polling cannot pass the gate', () => {
  const short = evidence();
  short.delayMs = 100;
  assert.equal(analyzeEvidence(short).status, 'inconclusive');
  const hidden = evidence();
  hidden.telemetry.push({ at: '2026-10-16T00:00:31.000Z', type: 'function_call', name: 'wait', call_id: 'poll' });
  // No corresponding high-level CLI item: this reproduces the live false-silent stream.
  assert.equal(analyzeEvidence(hidden).status, 'failed');
});

test('desktop evidence requires the actual matching returned event, not a synthetic CLI turn', () => {
  const data = evidence();
  data.host = 'desktop';
  data.events = [];
  data.audit[1].probe_id = 'desktop';
  assert.equal(analyzeEvidence(data).status, 'failed');
  data.telemetry[2].gate_event = { event: 'gate_released', probe_id: 'desktop', elapsed_ms: 130_000 };
  assert.equal(analyzeEvidence(data).status, 'passed');
  data.telemetry.push({ at: '2026-10-16T00:01:00.000Z', type: 'function_call', name: 'wait' });
  assert.equal(analyzeEvidence(data).status, 'failed');
});

test('desktop interruption requires the exact native caller, a direct tool trace, and no false success', () => {
  const threadId = 'native-thread', probeId = 'stop';
  const start = { kind: 'wait_started', server_id: 'server', request_id: 2, probe_id: probeId, caller_thread: threadId, caller_turn: 'native-turn', at: '2026-10-17T00:00:01.000Z' };
  const stop = { ...start, kind: 'wait_interrupted', at: '2026-10-17T00:00:02.000Z' };
  const audit = [start, stop];
  const telemetry = [{ type: 'function_call', name: 'gate_wait', namespace: 'mcp__specship_gate', at: '2026-10-17T00:00:00.900Z' }];
  assert.equal(analyzeInterruptedEvidence({ audit, telemetry, threadId, probeId }).status, 'passed');
  assert.equal(analyzeInterruptedEvidence({ audit, telemetry: [], threadId, probeId }).status, 'inconclusive');
  assert.equal(analyzeInterruptedEvidence({ audit, telemetry, threadId: 'other-chat', probeId }).status, 'failed');
  assert.equal(analyzeInterruptedEvidence({ audit: [start, { ...stop, caller_turn: 'older-turn' }], telemetry, threadId, probeId }).status, 'failed');
  assert.equal(analyzeInterruptedEvidence({ audit: [...audit, { ...stop, kind: 'wait_completed' }], telemetry, threadId, probeId }).status, 'failed');
});
