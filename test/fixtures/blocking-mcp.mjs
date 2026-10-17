// A dependency-free MCP transport fixture, not the production runner.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';

const delay = Number(process.env.SPECSHIP_GATE_DELAY_MS ?? 130_000);
const auditPath = process.env.SPECSHIP_GATE_AUDIT;
const releaseFile = process.env.SPECSHIP_GATE_RELEASE_FILE;
const interruptFile = process.env.SPECSHIP_GATE_INTERRUPT_FILE;
const imageFile = process.env.SPECSHIP_GATE_IMAGE_FILE;
if (!Number.isSafeInteger(delay) || delay < 1 || delay > 3_600_000 || !auditPath) {
  process.stderr.write('Set SPECSHIP_GATE_AUDIT and a delay between 1 and 3600000 ms.\n');
  process.exit(1);
}

const pending = new Map();
const serverId = randomUUID();
const audit = (kind, detail = {}) => appendFileSync(auditPath,
  `${JSON.stringify({ at: new Date().toISOString(), server_id: serverId, kind, ...detail })}\n`);
const send = (value) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...value })}\n`);
const result = (id, value) => send({ id, result: value });
const error = (id, code, message) => send({ id, error: { code, message } });

function receive(message) {
  const { id, method, params = {} } = message;
  audit('request', { method, request_id: id });
  if (method === 'notifications/cancelled') {
    const request = pending.get(params.requestId);
    if (request) {
      clearTimeout(request.timer);
      clearInterval(request.releaseTimer);
      pending.delete(params.requestId);
      audit('wait_cancelled', { request_id: params.requestId, probe_id: request.probeId });
    }
    return;
  }
  if (id === undefined) return;
  if (method === 'initialize') {
    return result(id, {
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'specship-compatibility', version: '0.1.0' },
    });
  }
  if (method === 'ping') return result(id, {});
  if (method === 'resources/list') return result(id, { resources: [] });
  if (method === 'prompts/list') return result(id, { prompts: [] });
  if (method === 'tools/list') {
    return result(id, { tools: [{
      name: 'gate_wait',
      description: releaseFile
        ? 'Ask the compatibility supervisor for its decision and wait silently for the answer. Call once.'
        : 'Wait silently for the compatibility event. Call once; do not poll or run other work while it is pending.',
      inputSchema: {
        type: 'object',
        properties: { probe_id: { type: 'string', minLength: 1 } },
        required: ['probe_id'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    }] });
  }
  if (method !== 'tools/call') return error(id, -32601, 'Unknown method');
  if (params.name !== 'gate_wait') return error(id, -32602, 'Unknown tool');
  const probeId = params.arguments?.probe_id;
  if (typeof probeId !== 'string' || !probeId || Object.keys(params.arguments).some((key) => key !== 'probe_id')) {
    return error(id, -32602, 'Expected only a nonempty probe_id');
  }
  if (pending.size) return error(id, -32602, 'A wait is already active; do not poll');
  const started = Date.now();
  // Capture only known identity metadata, never arbitrary request metadata.
  let turnMetadata = {};
  try {
    const raw = params._meta?.['x-codex-turn-metadata'];
    turnMetadata = typeof raw === 'string' ? JSON.parse(raw) : raw ?? {};
  } catch { /* Unknown host metadata cannot supply a verified caller. */ }
  const callerThread = params._meta?.thread_id ?? params._meta?.threadId ?? null;
  const callerTurn = params._meta?.turn_id ?? params._meta?.turnId ?? turnMetadata?.turn_id ?? turnMetadata?.turnId ?? null;
  audit('wait_started', { request_id: id, probe_id: probeId, delay_ms: delay, caller_thread: callerThread, caller_turn: callerTurn, identity_meta_keys: Object.keys(params._meta ?? {}).filter((key) => /thread|turn/i.test(key)) });
  function finish(decision) {
    const request = pending.get(id);
    if (!request) return;
    clearTimeout(request.timer);
    clearInterval(request.releaseTimer);
    pending.delete(id);
    const elapsed = Date.now() - started;
    const image = imageFile ? readFileSync(imageFile) : null;
    audit('wait_completed', { request_id: id, probe_id: probeId, elapsed_ms: elapsed,
      ...(image ? { image_sha256: createHash('sha256').update(image).digest('hex') } : {}),
    });
    result(id, {
      content: [
        { type: 'text', text: JSON.stringify({ event: 'gate_released', probe_id: probeId, elapsed_ms: elapsed, ...(decision === undefined ? {} : { decision }) }) },
        ...(image ? [{ type: 'image', mimeType: 'image/png', data: image.toString('base64') }] : []),
      ],
      isError: false,
    });
  }
  const timer = setTimeout(() => {
    if (!releaseFile) return finish();
    const request = pending.get(id);
    clearInterval(request.releaseTimer);
    pending.delete(id);
    audit('wait_expired', { request_id: id, probe_id: probeId });
    result(id, { content: [{ type: 'text', text: 'Supervisor decision deadline expired' }], isError: true });
  }, delay);
  const request = { timer, probeId };
  pending.set(id, request);
  if (releaseFile || interruptFile) {
    request.releaseTimer = setInterval(() => {
      try {
        if (interruptFile && existsSync(interruptFile)) {
          const interrupt = JSON.parse(readFileSync(interruptFile, 'utf8'));
          if (callerThread && callerTurn && interrupt.session_id === callerThread && interrupt.turn_id === callerTurn) {
            clearTimeout(timer); clearInterval(request.releaseTimer); pending.delete(id);
            audit('wait_interrupted', { request_id: id, probe_id: probeId, caller_thread: callerThread, caller_turn: callerTurn });
            result(id, { content: [{ type: 'text', text: 'Interrupted through the test hook' }], isError: true });
            return;
          }
        }
        if (releaseFile && existsSync(releaseFile)) {
          const decision = JSON.parse(readFileSync(releaseFile, 'utf8'));
          if (decision.probe_id === probeId) finish(decision.answer);
        }
      } catch (cause) {
        // A partially written test marker is not an MCP parse error.
        if (!(cause instanceof SyntaxError) && cause.code !== 'ENOENT') throw cause;
      }
    }, 25);
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  for (let index; (index = buffer.indexOf('\n')) !== -1;) {
    const line = buffer.slice(0, index).replace(/\r$/, '');
    buffer = buffer.slice(index + 1);
    if (!line.trim()) continue;
    try {
      const message = JSON.parse(line);
      if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
        error(message?.id ?? null, -32600, 'Invalid request');
      } else {
        receive(message);
      }
    } catch (cause) {
      if (!(cause instanceof SyntaxError)) throw cause;
      error(null, -32700, 'Invalid JSON');
    }
  }
});
process.stdin.on('end', () => {
  for (const [id, request] of pending) {
    clearTimeout(request.timer);
    clearInterval(request.releaseTimer);
    audit('wait_disconnected', { request_id: id, probe_id: request.probeId });
  }
  pending.clear();
});
audit('server_started', { pid: process.pid, delay_ms: delay });
