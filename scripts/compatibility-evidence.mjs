import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function gateEvent(output) {
  if (typeof output === 'string') {
    try { return gateEvent(JSON.parse(output)); } catch { return null; }
  }
  if (Array.isArray(output)) return output.map(gateEvent).find(Boolean) ?? null;
  if (!output || typeof output !== 'object') return null;
  if (output.event === 'gate_released') return output;
  return gateEvent(output.text ?? output.content ?? null);
}

export function readSessionTelemetry(threadId, codexHome = process.env.CODEX_HOME ?? join(homedir(), '.codex')) {
  if (!/^[0-9a-f-]{36}$/i.test(threadId)) throw new Error('Expected an exact Codex thread ID');
  const sessionRoot = join(codexHome, 'sessions');
  const candidates = [];
  for (const offset of [-1, 0, 1]) {
    const day = new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10).split('-');
    const folder = join(sessionRoot, ...day);
    if (existsSync(folder)) candidates.push(...readdirSync(folder).filter((name) => name.includes(threadId) && name.endsWith('.jsonl')).map((name) => join(folder, name)));
  }
  if (candidates.length > 1) throw new Error('Ambiguous session evidence');
  const telemetry = [];
  for (const file of candidates) {
    for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
      const record = JSON.parse(line);
      const payload = record.payload ?? {};
      if (record.type === 'event_msg' && payload.type === 'token_count') {
        telemetry.push({ at: record.timestamp, type: 'token_count', total_tokens: payload.info?.total_token_usage?.total_tokens ?? null });
      } else if (record.type === 'token_usage_record') {
        telemetry.push({ at: record.timestamp, type: 'usage_ledger', response_id: payload.response_id, usage: payload.usage });
      } else if (record.type === 'response_item') {
        telemetry.push({ at: record.timestamp, type: payload.type, name: payload.name ?? null, namespace: payload.namespace ?? null, call_id: payload.call_id ?? null, role: payload.role ?? null, gate_event: gateEvent(payload.output) });
      }
    }
  }
  return telemetry;
}

export function analyzeInterruptedEvidence({ audit, telemetry, threadId, probeId }) {
  const start = audit.findLast((entry) => entry.kind === 'wait_started' && entry.probe_id === probeId);
  const matching = (entry) => start && entry.server_id === start.server_id && entry.request_id === start.request_id && entry.probe_id === probeId;
  const stop = audit.find((entry) => matching(entry) && entry.kind === 'wait_interrupted');
  const failures = [];
  if (!start || !stop) failures.push('Missing a started wait and matching Interrupt hook delivery');
  if (start?.caller_thread !== threadId || !start?.caller_turn || stop?.caller_thread !== threadId || stop?.caller_turn !== start?.caller_turn) failures.push('Interrupt identities do not match the native calling chat and turn');
  if (audit.some((entry) => matching(entry) && entry.kind === 'wait_completed')) failures.push('Interrupted request also reported success');
  const from = Date.parse(start?.at), to = Date.parse(stop?.at);
  if (!(to >= from)) failures.push('Invalid interruption timeline');
  const calls = telemetry.filter((entry) => entry.type === 'function_call' && Date.parse(entry.at) <= from);
  const initial = calls.at(-1);
  const directCall = initial?.name === 'gate_wait' && initial?.namespace === 'mcp__specship_gate';
  const intervening = telemetry.filter((entry) => Date.parse(entry.at) > from && Date.parse(entry.at) < to && (
    ['function_call', 'custom_tool_call', 'reasoning'].includes(entry.type) || (entry.type === 'message' && entry.role === 'assistant')
  ));
  if (intervening.length) failures.push('Model activity occurred before Interrupt delivery');
  return {
    host: 'desktop', status: failures.length ? 'failed' : directCall ? 'passed' : 'inconclusive', failures,
    thread_id: threadId, turn_id: start?.caller_turn ?? null, probe_id: probeId, server_id: start?.server_id ?? null,
    native_identities_match: Boolean(start && stop && start.caller_thread === threadId && stop.caller_thread === threadId && start.caller_turn === stop.caller_turn),
    direct_tool_call_recorded: directCall, model_generations_before_interrupt: intervening.length,
    wait_ms_before_interrupt: stop && start ? to - from : null,
    limitation: 'Measures host hook delivery to a test wait, not production Ship process quiescence or provider billing.',
  };
}

export function analyzeEvidence({ audit, events = [], telemetry, delayMs, exitCode, host = 'cli' }) {
  if (!['cli', 'desktop'].includes(host)) throw new Error('Unknown evidence host');
  const starts = audit.filter((event) => event.kind === 'wait_started');
  const completions = audit.filter((event) => event.kind === 'wait_completed');
  const failures = [];
  if (host === 'cli' && exitCode !== 0) failures.push(`Codex exited with ${exitCode}`);
  if (starts.length !== 1 || completions.length !== 1) failures.push('Expected exactly one started/completed wait');
  const start = starts[0];
  const end = completions[0];
  if (end && (end.elapsed_ms < delayMs || start?.request_id !== end.request_id)) failures.push('Wait returned early or completed the wrong request');
  if (audit.filter((event) => event.kind === 'request' && event.method === 'tools/call').length !== 1) {
    failures.push('Expected exactly one MCP tool invocation');
  }
  const from = start ? Date.parse(start.at) : NaN;
  const until = end ? Date.parse(end.at) : NaN;
  const during = (event) => Date.parse(event.at) > from && Date.parse(event.at) < until;
  const unexpected = events.filter((record) => during(record) && (
    record.event.type === 'turn.completed' || record.event.type === 'turn.failed' ||
    (record.event.type?.startsWith('item.') && record.event.item?.type !== 'mcp_tool_call')
  ));
  if (unexpected.length) failures.push('Codex generated assistant/tool activity while the MCP call was pending');
  const usageDuringWait = telemetry.filter((record) => during(record) && record.type === 'token_count' && record.total_tokens != null);
  const baseline = telemetry.filter((record) => Date.parse(record.at) <= from && record.type === 'token_count' && record.total_tokens != null).at(-1);
  let previousTokens = baseline?.total_tokens;
  const increases = usageDuringWait.filter((record) => {
    const increased = previousTokens != null && record.total_tokens > previousTokens;
    previousTokens = record.total_tokens;
    return increased;
  });
  if (increases.length) failures.push('Recorded cumulative token usage increased during the wait');
  const toolCallsDuringWait = telemetry.filter((record) => during(record) && ['function_call', 'custom_tool_call'].includes(record.type));
  if (toolCallsDuringWait.length) failures.push('Session recorded another tool call during the wait');
  const generationsDuringWait = telemetry.filter((record) => during(record) && (
    ['reasoning', 'function_call', 'custom_tool_call'].includes(record.type) ||
    (record.type === 'message' && record.role === 'assistant')
  ));
  if (generationsDuringWait.length) failures.push('Session recorded model generations during the wait');
  const completed = events.find((record) => record.event.type === 'turn.completed');
  const final = events.filter((record) => record.event.type === 'item.completed' && record.event.item?.type === 'agent_message').at(-1)?.event.item?.text;
  if (host === 'cli' && (!completed || final?.trim() !== 'GATE_OK')) failures.push('Missing successful completion marker/turn');
  // Some Codex builds persist the initial model usage only after the tool returns.
  // Require an actual session usage record and a bracketing tool call/output, not
  // just an empty high-level CLI activity stream.
  const usageRecorded = telemetry.some((record) => record.type === 'token_count' && record.total_tokens != null);
  const callsBeforeWait = telemetry.filter((record) => Date.parse(record.at) <= from && ['function_call', 'custom_tool_call'].includes(record.type));
  const initialCall = callsBeforeWait.at(-1);
  const outputAfterWait = telemetry.some((record) => Date.parse(record.at) >= until &&
    ['function_call_output', 'custom_tool_call_output'].includes(record.type) && record.call_id === initialCall?.call_id);
  if (host === 'desktop' && !telemetry.some((record) => record.call_id === initialCall?.call_id &&
    Date.parse(record.at) >= until && record.gate_event?.probe_id === start?.probe_id && record.gate_event?.elapsed_ms >= delayMs)) {
    failures.push('Missing matching desktop tool result');
  }
  const usageObservable = usageRecorded && Boolean(initialCall?.call_id) && outputAfterWait;
  const representativeWait = delayMs >= 120_000;
  return {
    host,
    status: failures.length ? 'failed' : usageObservable && representativeWait ? 'passed' : 'inconclusive',
    failures,
    measured_wait_ms: end?.elapsed_ms ?? null,
    mcp_tool_calls: audit.filter((event) => event.kind === 'request' && event.method === 'tools/call').length,
    activity_events_during_wait: unexpected.length,
    token_baseline: baseline?.total_tokens ?? null,
    token_updates_during_wait: usageDuringWait.length,
    token_increases_during_wait: increases.length,
    model_generations_during_wait: generationsDuringWait.length,
    telemetry_available: usageObservable,
    usage_observation: baseline ? 'baseline_before_wait' : usageRecorded ? 'usage_deferred_until_tool_return' : 'unavailable',
    representative_wait: representativeWait,
    observed_tool_calls: [initialCall, ...toolCallsDuringWait].filter(Boolean).map(({ at, name, namespace }) => ({ at, name, namespace })),
    usage_ledger_records_during_wait: telemetry.filter((record) => during(record) && record.type === 'usage_ledger').length,
    total_turn_usage: completed?.event.usage ?? null,
    limitation: 'Local runtime/session telemetry measures observed inference and usage; it is not a provider billing audit. Initial-call usage may be recorded asynchronously after waiting begins.',
  };
}
