import { createHash } from 'node:crypto';

export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const arms = ['codex', 'ship', 'specship'];
export const defaultArms = ['codex', 'specship'];
const count = value => Number.isSafeInteger(value) && value >= 0;

export const treeContents = listing => listing.split('\0').filter(Boolean).map(entry => entry.replace(/^[0-7]+ /, '')).sort();

export function selectCases(rows, seed, limit) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > rows.length) throw Error('Invalid sample size');
  const seen = new Set();
  for (const row of rows) {
    if (!/^[A-Za-z0-9_.-]+$/.test(row.instance_id) || seen.has(row.instance_id) || !/^[a-f0-9]{40}$/.test(row.base_commit) || !/^[\w.-]+\/[\w.-]+$/.test(row.repo) || typeof row.problem_statement !== 'string') throw Error('Invalid or duplicate SWE-bench case');
    seen.add(row.instance_id);
  }
  return [...rows].sort((a, b) => digest(`${seed}:${a.instance_id}`).localeCompare(digest(`${seed}:${b.instance_id}`))).slice(0, limit);
}

export function codexUsage(events) {
  const turns = events.filter(e => e.type === 'turn.completed');
  if (!turns.length) return null;
  const usage = { input: 0, cached_input: 0, cache_write: 0, output: 0, completed_turns: turns.length, api_requests: null };
  for (const { usage: u } of turns) {
    if (!u || ![u.input_tokens, u.cached_input_tokens, u.output_tokens].every(count) || u.cached_input_tokens > u.input_tokens) return null;
    usage.input += u.input_tokens;
    usage.cached_input += u.cached_input_tokens;
    usage.output += u.output_tokens;
    if (u.cache_write_input_tokens !== undefined && !count(u.cache_write_input_tokens)) return null;
    usage.cache_write += u.cache_write_input_tokens ?? 0;
  }
  return { ...usage, input_total: usage.input, output_total: usage.output };
}

export function shipUsage(exports, { reasoningIsSeparate } = {}) {
  const messages = new Map();
  for (const data of exports) for (const message of data.messages ?? []) {
    const info = message.info;
    if (info?.role === 'assistant') {
      if (!info.id || !info.sessionID) return null;
      messages.set(`${info.sessionID}:${info.id}`, info);
    }
  }
  if (!messages.size) return null;
  const usage = { input: 0, cached_input: 0, cache_write: 0, output: 0, reasoning: 0, assistant_messages: messages.size, api_requests: null, harness_cost_usd: 0 };
  for (const info of messages.values()) {
    const t = info.tokens;
    if (!t || ![t.input, t.output, t.reasoning, t.cache?.read, t.cache?.write].every(count)) return null;
    usage.input += t.input; // OpenCode reports input and cache categories separately.
    usage.cached_input += t.cache.read;
    usage.cache_write += t.cache.write;
    usage.output += t.output;
    usage.reasoning += t.reasoning;
    if (typeof info.cost !== 'number' || !Number.isFinite(info.cost) || info.cost < 0) usage.harness_cost_usd = null;
    else if (usage.harness_cost_usd !== null) usage.harness_cost_usd += info.cost;
  }
  return { ...usage, input_total: usage.input + usage.cached_input + usage.cache_write, output_total: reasoningIsSeparate === true ? usage.output + usage.reasoning : reasoningIsSeparate === false ? usage.output : null };
}

export function apiEstimate(usage, rates, kind) {
  if (!usage || !rates || !['input', 'cached_input', 'cache_write', 'output'].every(k => typeof rates[k] === 'number' && Number.isFinite(rates[k]) && rates[k] >= 0)) return null;
  if (kind === 'ship') {
    // Providers/harness versions differ: require an explicit output accounting rule.
    if (typeof rates.reasoning_is_separate !== 'boolean') return null;
    return (usage.input * rates.input + usage.cached_input * rates.cached_input + usage.cache_write * rates.cache_write + (usage.output + (rates.reasoning_is_separate ? usage.reasoning : 0)) * rates.output) / 1_000_000;
  }
  if (usage.cached_input + usage.cache_write > usage.input) return null;
  return ((usage.input - usage.cached_input - usage.cache_write) * rates.input + usage.cached_input * rates.cached_input + usage.cache_write * rates.cache_write + usage.output * rates.output) / 1_000_000;
}

export function quotaDelta(snapshot) {
  if (!snapshot || snapshot.exclusive !== true || !snapshot.source || !snapshot.bucket) return null;
  const { before, after } = snapshot;
  if (!before || !after || before.resets_at !== after.resets_at || !before.resets_at || ![before.used_percent, after.used_percent].every(x => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 100) || after.used_percent < before.used_percent) return null;
  return after.used_percent - before.used_percent;
}

export function trialEstimate(trial, config) {
  const spec = trial.arm === 'ship' ? 0 : apiEstimate(trial.spec_usage, config.spec?.rates, 'spec');
  const ship = trial.arm === 'codex' ? 0 : trial.ship_usage_model_matches === false ? null : apiEstimate(trial.ship_usage, config.ship?.rates, 'ship');
  const knownShip = trial.arm === 'codex' ? 0 : trial.ship_usage_model_matches === false ? null : apiEstimate(trial.ship_usage ?? trial.ship_usage_observed, config.ship?.rates, 'ship');
  const applicable = [...(trial.arm === 'ship' ? [] : [spec]), ...(trial.arm === 'codex' ? [] : [knownShip])];
  const known = applicable.filter(value => value !== null);
  return {
    spec_api_equivalent_usd: trial.arm === 'ship' ? null : spec,
    ship_api_equivalent_usd: trial.arm === 'codex' ? null : ship,
    known_ship_api_equivalent_usd: trial.arm === 'codex' ? null : knownShip,
    known_api_equivalent_usd: known.length ? known.reduce((sum, value) => sum + value, 0) : null,
    api_equivalent_usd: spec !== null && ship !== null ? spec + ship : null,
  };
}

export function summarize(trials, selectedArms = arms) {
  return selectedArms.map(arm => {
    const items = trials.filter(t => t.arm === arm);
    const graded = items.filter(t => typeof t.resolved === 'boolean');
    const successes = graded.filter(t => t.resolved).length;
    const completeCost = items.length > 0 && items.every(t => typeof t.api_equivalent_usd === 'number');
    const cost = completeCost ? items.reduce((sum, t) => sum + t.api_equivalent_usd, 0) : null;
    const knownCosts = items.map(t => t.known_api_equivalent_usd ?? t.api_equivalent_usd).filter(value => typeof value === 'number');
    const completeBilling = items.length > 0 && items.every(t => typeof t.actual_billed_usd === 'number');
    const tokens = (role, observed = false) => {
      const values = items.map(t => t[`${role}_usage`] ?? (observed ? t[`${role}_usage_observed`] : null)).filter(Boolean);
      if (!values.length || !observed && values.length !== items.length) return null;
      return Object.fromEntries(['input', 'cached_input', 'cache_write', 'output', 'input_total', 'output_total', ...(role === 'ship' ? ['reasoning', 'assistant_messages'] : [])].map(key => [key, values.every(value => typeof value[key] === 'number') ? values.reduce((sum, value) => sum + value[key], 0) : null]));
    };
    const roleCost = role => items.length && items.every(t => typeof t[`${role}_api_equivalent_usd`] === 'number') ? items.reduce((sum, t) => sum + t[`${role}_api_equivalent_usd`], 0) : null;
    const shipMeasurement = arm === 'codex' ? {} : { ship_tokens_observed: tokens('ship', true), ship_usage_complete: items.length > 0 && items.every(t => t.ship_usage !== null && t.ship_usage !== undefined), ship_api_equivalent_usd: roleCost('ship') };
    return { arm, attempts: items.length, graded: graded.length, resolved: successes, success_rate: items.length && graded.length === items.length ? successes / items.length : null, verified_success_fraction: items.length ? successes / items.length : null, infrastructure_failures: items.filter(t => t.status === 'infrastructure_failure').length, agent_failures: items.filter(t => t.status === 'agent_failure').length, spec_tokens: arm === 'ship' ? null : tokens('spec'), ship_tokens: arm === 'codex' ? null : tokens('ship'), ...shipMeasurement, api_requests: items.length && items.every(t => Number.isSafeInteger(t.api_requests)) ? items.reduce((sum, t) => sum + t.api_requests, 0) : null, api_equivalent_usd: cost, known_api_equivalent_usd: knownCosts.length ? knownCosts.reduce((sum, value) => sum + value, 0) : null, actual_billed_usd: completeBilling ? items.reduce((sum, t) => sum + t.actual_billed_usd, 0) : null, cost_per_success_usd: cost !== null && successes && graded.length === items.length ? cost / successes : null, elapsed_seconds: items.reduce((sum, t) => sum + (t.elapsed_seconds ?? 0), 0), false_acceptances: items.filter(t => t.accepted === true && t.resolved === false).length };
  });
}
