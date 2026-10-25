import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const logPath = process.env.FAKE_ACP_LOG;
const log = value => { if (logPath) appendFileSync(logPath, `${JSON.stringify({ at: new Date().toISOString(), ...value })}\n`); };
const configOptions = () => [
  {
    id: 'model', name: 'Model', category: 'model', type: 'select',
    currentValue: '["deepseek-official","deepseek-v4-flash"]',
    options: [
      { group: 'deepseek-official', name: 'DeepSeek', options: [{ value: '["deepseek-official","deepseek-v4-flash"]', name: 'deepseek-v4-flash' }] },
      { group: 'deepseek-account', name: 'DeepSeek Account', options: [{ value: '["deepseek-account","deepseek-flash"]', name: 'DeepSeek-V4.1-Flash' }] },
    ],
  },
  {
    id: 'reasoning_effort', name: 'Reasoning effort', category: 'thought_level', type: 'select', currentValue: 'low',
    options: ['off', 'low', 'high', 'max'].map(value => ({ value, name: value })),
  },
];
const sessions = new Map();
let sequence = 0;
let nextPermission = 1000;
const send = value => process.stdout.write(`${JSON.stringify(value)}\n`);

function sessionFor(id) {
  let session = sessions.get(id);
  if (!session) { session = { id, options: configOptions(), prompts: new Map() }; sessions.set(id, session); }
  return session;
}
function updateCurrent(session, configId, value) {
  const option = session.options.find(item => item.id === configId);
  if (!option) return false;
  option.currentValue = value;
  return true;
}
function completePrompt(session, id, stopReason = 'end_turn') {
  if (!session.prompts.has(id)) return;
  session.prompts.delete(id);
  send({ jsonrpc: '2.0', id, result: { stopReason } });
}

const input = createInterface({ input: process.stdin });
input.on('line', line => {
  if (!line.trim()) return;
  let message;
  try { message = JSON.parse(line); } catch { return; }
  log({ event: 'receive', message });
  if (message.method === undefined && message.id !== undefined) {
    const session = [...sessions.values()].find(item => item.permission?.id === message.id);
    if (!session) return;
    const outcome = message.result?.outcome;
    log({ event: 'permission-result', id: message.id, outcome });
    const permission = session.permission;
    session.permission = undefined;
    completePrompt(session, permission.promptId, outcome?.outcome === 'cancelled' ? 'cancelled' : 'end_turn');
    return;
  }
  if (message.method === 'initialize') {
    send({
      jsonrpc: '2.0', id: message.id,
      result: {
        protocolVersion: 1,
        agentInfo: { name: 'fake-deepseek-acp', version: 'fake-acp-1' },
        agentCapabilities: { mcpCapabilities: { http: true }, promptCapabilities: { image: false, audio: false, embeddedContext: false }, sessionCapabilities: { close: {}, list: {}, resume: {} } },
        authMethods: [],
      },
    });
    return;
  }
  if (message.method === 'session/new') {
    const id = `fake-session-${++sequence}`;
    sessionFor(id);
    send({ jsonrpc: '2.0', id: message.id, result: { sessionId: id, configOptions: sessionFor(id).options } });
    return;
  }
  if (message.method === 'session/resume') {
    const session = sessionFor(message.params.sessionId);
    send({ jsonrpc: '2.0', id: message.id, result: { configOptions: session.options } });
    return;
  }
  if (message.method === 'session/set_config_option') {
    const session = sessionFor(message.params.sessionId);
    if (!updateCurrent(session, message.params.configId, message.params.value)) {
      send({ jsonrpc: '2.0', id: message.id, error: { code: -32602, message: 'unknown config' } });
      return;
    }
    send({ jsonrpc: '2.0', id: message.id, result: { configOptions: session.options } });
    return;
  }
  if (message.method === 'session/prompt') {
    const session = sessionFor(message.params.sessionId);
    const text = message.params.prompt?.map(part => part.text ?? '').join('\n') ?? '';
    const mode = /MODE:([a-z]+)/.exec(text)?.[1] ?? 'complete';
    log({ event: 'prompt', mode, id: message.id, text });
    session.prompts.set(message.id, { mode });
    if (mode === 'permission') {
      const permissionId = nextPermission++;
      session.permission = { id: permissionId, promptId: message.id };
      send({
        jsonrpc: '2.0', id: permissionId, method: 'session/request_permission',
        params: { sessionId: session.id, toolCall: { toolCallId: `call-${permissionId}` }, options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }, { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' }] },
      });
      return;
    }
    if (mode === 'hang') return;
    if (mode === 'error') {
      send({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'scripted prompt failure' } });
      return;
    }
    send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: session.id, update: { sessionUpdate: 'tool_call', toolCallId: 'call-test', title: 'fake tool', status: 'completed' } } });
    completePrompt(session, message.id);
    return;
  }
  if (message.method === 'session/cancel') {
    const session = sessions.get(message.params?.sessionId);
    if (session) {
      if (session.permission) {
        const permission = session.permission;
        session.permission = undefined;
        send({ jsonrpc: '2.0', id: permission.id, result: { outcome: { outcome: 'cancelled' } } });
        completePrompt(session, permission.promptId, 'cancelled');
      } else {
        for (const promptId of [...session.prompts.keys()]) completePrompt(session, promptId, 'cancelled');
      }
    }
    return;
  }
  if (message.method === 'session/close') {
    send({ jsonrpc: '2.0', id: message.id, result: {} });
    setTimeout(() => process.exit(0), 20);
    return;
  }
  if (message.id !== undefined) send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `unknown method ${message.method}` } });
});
