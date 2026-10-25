import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, realpath, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { apiEstimate, codexUsage, digest, quotaDelta, selectCases, shipUsage, summarize, treeContents, trialEstimate } from '../scripts/benchmark/accounting.mjs';
import { checkSubscriptions, subscriptionCredential, subscriptionEnvironment } from '../scripts/benchmark/auth.mjs';
import { checkShipProfile, checkDshProfile } from '../scripts/benchmark/profile.mjs';

const rows = Array.from({ length: 12 }, (_, i) => ({ instance_id: `repo__project-${i}`, repo: 'repo/project', base_commit: 'a'.repeat(40), problem_statement: `Fix ${i}`, patch: 'gold must remain outside agent' }));

test('Ship catalog preflight validates the exact profile and cleanup without submitting a model prompt', async () => {
  const profile={harness:'opencode',model:'openai/gpt-6-luna',options:{variant:'high'}};
  const calls=[];
  const adapter={
    async validate(p,media){assert.equal(p,profile);assert.deepEqual(media,[]);calls.push('validate');},
    async start(workspace,p){assert.equal(p,profile);assert.equal(workspace,'fixture');calls.push('start');return {session:'unused',version:'1.18.30'};},
    async close(session){assert.equal(session,'unused');calls.push('close');return true;},
    async submit(){assert.fail('Preflight must never submit inference');},
  };
  assert.deepEqual(await checkShipProfile('fixture',profile,adapter),{model:profile.model,effort:'high',version:'1.18.30',model_calls:0});
  assert.deepEqual(calls,['validate','start','close']);
  await assert.rejects(checkShipProfile('fixture',profile,{...adapter,async start(){throw Error('variant unavailable');}}),/variant unavailable/);
  await assert.rejects(checkShipProfile('fixture',profile,{...adapter,async close(){return false;}}),/cleanup/);
});

test('DSH preflight starts a real session shape and writes only a disposable descriptor', async t => {
  const profile={harness:'deepseek',model:'deepseek-official/deepseek-flash',executable:'/usr/local/bin/dsh',options:{reasoning_effort:'high',sandbox:'workspace-write'}};
  let descriptorPath;
  const adapter={
    async validate(p,media){assert.equal(p,profile);assert.deepEqual(media,[]);},
    async start(workspace,p,kind,callback){assert.equal(workspace,'fixture');assert.equal(p,profile);assert.equal(kind,'implement');descriptorPath=callback.descriptorPath;assert.ok(descriptorPath);assert.deepEqual(JSON.parse(await readFile(descriptorPath,'utf8')).capability,'unused-preflight');return {session:'dsh-session',version:'0.2.1-rc.2'};},
    async close(session){assert.equal(session,'dsh-session');return true;},
    async submit(){assert.fail('DSH preflight must not submit a prompt');},
  };
  assert.deepEqual(await checkDshProfile('fixture',profile,adapter),{model:profile.model,effort:'high',version:'0.2.1-rc.2',model_calls:0});
  t.after(async()=>{if(descriptorPath)await rm(descriptorPath,{force:true});});
});

test('failed attempts retain known role costs while incomplete usage leaves the total unknown', () => {
  const rates={input:2,cached_input:0.1,cache_write:2.5,output:10,reasoning_is_separate:true};
  const usage=codexUsage([{type:'turn.completed',usage:{input_tokens:100,cached_input_tokens:80,output_tokens:20}}]);
  const config={spec:{rates},ship:{rates}};
  const partial=trialEstimate({arm:'specship',status:'infrastructure_failure',spec_usage:usage,ship_usage:null},config);
  assert.equal(partial.spec_api_equivalent_usd,apiEstimate(usage,rates,'spec'));
  assert.equal(partial.known_api_equivalent_usd,partial.spec_api_equivalent_usd);
  assert.equal(partial.api_equivalent_usd,null);assert.equal(partial.ship_api_equivalent_usd,null);
  const aggregate=summarize([{arm:'specship',...partial}],['specship'])[0];
  assert.equal(aggregate.known_api_equivalent_usd,partial.known_api_equivalent_usd);assert.equal(aggregate.api_equivalent_usd,null);
  const failed=trialEstimate({arm:'codex',status:'agent_failure',spec_usage:usage},config);
  assert.equal(failed.api_equivalent_usd,partial.spec_api_equivalent_usd,'valid usage remains billable even when the agent fails');
  assert.equal(trialEstimate({arm:'codex'},config).known_api_equivalent_usd,null);
  assert.equal(trialEstimate({arm:'ship'},config).known_api_equivalent_usd,null);
});

test('subscription mode rejects API credentials, strips environment overrides and keeps only requested OAuth', () => {
  const codex = { auth_mode: 'chatgpt', tokens: { access_token: 'fixture-oauth' }, OPENAI_API_KEY: 'fixture-key' };
  assert.equal(subscriptionCredential('codex', codex).OPENAI_API_KEY, undefined);
  assert.throws(() => subscriptionCredential('codex', { auth_mode: 'api', OPENAI_API_KEY: 'fixture-key' }), /API fallback is disabled/);
  const openai = { type: 'oauth', access: 'fixture-access', refresh: 'fixture-refresh' };
  assert.deepEqual(subscriptionCredential('opencode', { openai, other: { type: 'api', key: 'unrelated-key' } }), { openai });
  assert.throws(() => subscriptionCredential('opencode', { openai: { type: 'api', key: 'fixture-key' } }), /API fallback is disabled/);
  assert.deepEqual(subscriptionEnvironment({ PATH: '/bin', CODEX_API_KEY: 'a', OPENAI_API_KEY: 'b', CODEX_ACCESS_TOKEN: 'c', ANTHROPIC_AUTH_TOKEN: 'd' }), { PATH: '/bin' });
  assert.deepEqual(summarize([], ['codex', 'specship']).map(row => row.arm), ['codex', 'specship']);
});

test('prepared image mode changes are allowed but source content/path changes are rejected', () => {
  const base = ['100644 blob abc\tsource.py', '100644 blob def\tfile with spaces', ''].join('\0');
  assert.deepEqual(treeContents(base), treeContents(base.replaceAll('100644', '100755')));
  assert.notDeepEqual(treeContents(base), treeContents(base.replace('abc', 'fff')));
  assert.notDeepEqual(treeContents(base), treeContents(base.replace('source.py', 'other.py')));
});

test('case selection is deterministic, order independent, and rejects duplicate/unsafe instances', () => {
  assert.deepEqual(selectCases(rows, 'seed', 4), selectCases([...rows].reverse(), 'seed', 4));
  assert.notDeepEqual(selectCases(rows, 'seed', 4), selectCases(rows, 'other', 4));
  assert.throws(() => selectCases([...rows, rows[0]], 'seed', 4));
  assert.throws(() => selectCases([{ ...rows[0], instance_id: '../escape' }], 'seed', 1));
  assert.throws(() => selectCases(rows, 'seed', 0));
});

test('Codex usage counts completed turns once, includes cached input, and leaves HTTP requests unknown', () => {
  const completed = { type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 80, output_tokens: 20, reasoning_output_tokens: 15 } };
  const usage = codexUsage([{ type: 'turn.started' }, completed, { type: 'item.completed', usage: completed.usage }, completed]);
  assert.equal(usage.input, 200);assert.equal(usage.cached_input, 160);assert.equal(usage.output, 40);
  assert.equal(usage.completed_turns, 2);assert.equal(usage.api_requests, null);
  assert.equal(usage.input_total, 200);assert.equal(usage.output_total, 40);
  assert.equal(apiEstimate(usage, { input: 10, cached_input: 1, cache_write: 10, output: 20 }, 'spec'), 0.00136);
  assert.equal(codexUsage([]), null);
  assert.equal(codexUsage([{ ...completed, usage: { ...completed.usage, cached_input_tokens: 101 } }]), null);
  assert.equal(apiEstimate(usage, null, 'spec'), null);
});

test('Ship exports deduplicate message updates and preserve separate cache/reasoning categories', () => {
  const info = { id: 'a', sessionID: 'session', role: 'assistant', tokens: { input: 10, output: 20, reasoning: 5, cache: { read: 80, write: 4 } }, cost: 0.03 };
  const usage = shipUsage([{ messages: [{ info }] }, { messages: [{ info }, { info: { role: 'user' } }] }]);
  assert.equal(usage.input, 10);assert.equal(usage.cached_input, 80);assert.equal(usage.assistant_messages, 1);assert.equal(usage.harness_cost_usd, 0.03);
  assert.equal(usage.input_total, 94);assert.equal(usage.output_total, null);
  assert.equal(shipUsage([{ messages: [{ info }] }], { reasoningIsSeparate: true }).output_total, 25);
  const rates = { input: 10, cached_input: 1, cache_write: 10, output: 20 };
  assert.equal(apiEstimate(usage, rates, 'ship'), null, 'never guess reasoning billing semantics');
  assert.equal(apiEstimate(usage, { ...rates, reasoning_is_separate: true }, 'ship'), 0.00072);
  assert.equal(apiEstimate(usage, { ...rates, reasoning_is_separate: false }, 'ship'), 0.00062);
  assert.equal(shipUsage([]), null);
  assert.equal(shipUsage([{ messages: [{ info: { ...info, tokens: undefined } }] }]), null);
});

test('quota deltas require actual snapshots, exclusive usage and unchanged reset windows', () => {
  const snapshot = { source: 'provider account usage', bucket: 'five-hour', exclusive: true, before: { used_percent: 20, resets_at: 1000 }, after: { used_percent: 24, resets_at: 1000 } };
  assert.equal(quotaDelta(snapshot), 4);
  assert.equal(quotaDelta({ ...snapshot, exclusive: false }), null);
  assert.equal(quotaDelta({ ...snapshot, after: { used_percent: 1, resets_at: 2000 } }), null);
  assert.equal(quotaDelta({ ...snapshot, after: { used_percent: 19, resets_at: 1000 } }), null);
});

test('the DSH arm keeps Codex spec cost and leaves DSH ship usage unknown', () => {
  const rates={input:2,cached_input:0.1,cache_write:2.5,output:10};
  const usage=codexUsage([{type:'turn.completed',usage:{input_tokens:100,cached_input_tokens:80,output_tokens:20}}]);
  const config={spec:{rates},ship:{rates:{...rates,reasoning_is_separate:true}}};
  const measured=trialEstimate({arm:'specship-dsh',spec_usage:usage,ship_usage:null},config);
  assert.equal(measured.spec_api_equivalent_usd,0.000248);
  assert.equal(measured.ship_api_equivalent_usd,null);
  assert.equal(measured.known_ship_api_equivalent_usd,null);
  assert.equal(measured.api_equivalent_usd,null);
  const summary=summarize([{arm:'specship-dsh',...measured,spec_usage:usage,ship_usage:null}],['specship-dsh'])[0];
  assert.equal(summary.spec_tokens.input,100);
  assert.equal(summary.ship_tokens,null);
  assert.equal(summary.ship_usage_complete,false);
});

test('quality and cost remain independent; failed attempts count toward cost per success', () => {
  const trials = [
    { arm: 'specship', status: 'completed', resolved: true, accepted: true, api_equivalent_usd: 2 },
    { arm: 'specship', status: 'completed', resolved: false, accepted: true, api_equivalent_usd: 1 },
  ];
  const summary = summarize(trials).find(s => s.arm === 'specship');
  assert.equal(summary.success_rate, 0.5);assert.equal(summary.cost_per_success_usd, 3);assert.equal(summary.false_acceptances, 1);
  assert.equal(summarize([...trials, { arm: 'specship', status: 'infrastructure_failure', resolved: null, api_equivalent_usd: null }])[2].api_equivalent_usd, null);
  assert.equal(summarize([{ arm: 'codex', status: 'completed', resolved: null, api_equivalent_usd: 1 }])[0].cost_per_success_usd, null);
});

test('benchmark CLI preserves configuration, defaults to dry runs, and detects changed frozen cases', async t => {
  const home = await mkdtemp(join(tmpdir(), 'specship-benchmark-'));
  t.after(async () => { const path = await realpath(home);assert.equal(dirname(path), await realpath(tmpdir()));assert.ok(basename(path).startsWith('specship-benchmark-'));await rm(path, { recursive: true, force: true }); });
  const cli = (...args) => spawnSync(process.execPath, [resolve('scripts/benchmark.mjs'), ...args, '--home', home], { encoding: 'utf8', windowsHide: true });
  assert.equal(cli('init').status, 0);
  const original = await readFile(join(home, 'config.json'), 'utf8');
  assert.notEqual(cli('init').status, 0);assert.equal(await readFile(join(home, 'config.json'), 'utf8'), original);
  await writeFile(join(home, 'cases.lock.json'), JSON.stringify({ sha256: digest(rows.slice(0, 2)), cases: rows.slice(0, 2) }));
  const dry = cli('run');assert.equal(dry.status, 0);assert.match(dry.stdout, /"paid_calls_enabled": false/);assert.match(dry.stdout, /"attempts": 4/);
  const plan = JSON.parse(cli('plan').stdout);assert.deepEqual(plan.arms, ['codex', 'specship']);assert.equal(plan.authentication, 'subscription');
  const config = JSON.parse(original);config.spec.model = 'gpt-6.1-sol';config.ship.model = 'openai/gpt-6-luna';
  const codexFile = join(home, 'codex-auth.json'), opencodeFile = join(home, 'opencode-auth.json');
  await writeFile(codexFile, JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: 'fixture-access' } }));
  await writeFile(opencodeFile, JSON.stringify({ openai: { type: 'oauth', access: 'fixture-access' } }));
  config.auth.codex_file = codexFile;config.auth.opencode_file = opencodeFile;
  await checkSubscriptions(config, ['codex', 'specship']);
  await writeFile(opencodeFile, JSON.stringify({ openai: { type: 'api', key: 'fixture-key' } }));
  await assert.rejects(checkSubscriptions(config, ['codex', 'specship']), /not a subscription login/);
  const paid = cli('run', '--execute');assert.notEqual(paid.status, 0);assert.match(paid.stderr, /Set spec.model/);
  config.arms = ['specship-dsh'];config.spec.model = 'gpt-6.1-sol';config.ship.model = 'openai/gpt-6-luna';config.dsh = { model: 'deepseek-official/deepseek-flash', effort: 'high', rates: null };config.auth.mode = 'api';config.credential_env = [];
  await writeFile(join(home, 'config.json'), JSON.stringify(config));
  const dshPlan = JSON.parse(cli('plan', '--arm', 'specship-dsh').stdout);
  assert.deepEqual(dshPlan.arms, ['specship-dsh']);assert.equal(dshPlan.models.dsh, 'deepseek-official/deepseek-flash');
  const dshPaid = cli('run', '--execute', '--arm', 'specship-dsh');assert.notEqual(dshPaid.status, 0);assert.match(dshPaid.stderr, /DEEPSEEK_API_KEY/);
  const trial = join(home, 'runs', 'test-run', 'case--specship--0');await mkdir(trial, { recursive: true });
  await writeFile(join(home, 'runs', 'test-run', 'manifest.json'), JSON.stringify({ dataset_hash: digest(rows.slice(0, 2)), plan: { arms: ['specship'], cases: rows.slice(0, 2), repetitions: 1, attempts: 2 } }));
  await writeFile(join(trial, 'result.json'), JSON.stringify({ arm: 'specship', instance_id: rows[0].instance_id, status: 'completed', resolved: true, api_equivalent_usd: 0.02 }));
  await writeFile(join(trial, 'billing.json'), JSON.stringify({ source: 'provider receipt', usd: 0.03, api_requests: 4 }));
  await writeFile(join(trial, 'quota.json'), JSON.stringify({ source: 'provider', bucket: 'five-hour', exclusive: true, before: { used_percent: 12, resets_at: 100 }, after: { used_percent: 15, resets_at: 100 } }));
  assert.equal(cli('report', '--run', 'test-run').status, 0);
  const report = JSON.parse(await readFile(join(home, 'runs', 'test-run', 'summary.json'), 'utf8'));
  assert.equal(report.incomplete_run, true);assert.equal(report.quality_and_cost.length, 1);assert.equal(report.quality_and_cost[0].missing_attempts, 1);assert.equal(report.quality_and_cost[0].success_rate, null);
  assert.equal(report.trials[0].actual_billed_usd, 0.03);assert.equal(report.trials[0].api_requests, 4);assert.equal(report.trials[0].subscription_limit_delta, 3);
  await writeFile(join(home, 'cases.lock.json'), JSON.stringify({ sha256: 'changed', cases: rows }));
  assert.match(cli('plan').stderr, /Frozen cases changed/);
});

test('controller and agent entry points parse without execution', () => {
  for (const path of ['scripts/benchmark.mjs', 'scripts/benchmark/agent.mjs']) {
    const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8', windowsHide: true });assert.equal(result.status, 0, result.stderr);
  }
});
