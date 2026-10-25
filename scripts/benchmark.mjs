import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, readdir, cp } from 'node:fs/promises';
import { resolve, join, dirname, basename, delimiter, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { arms, defaultArms, digest, selectCases, quotaDelta, summarize, trialEstimate, usesSpec, usesShip, usesOpenCodeShip, usesDshShip } from './benchmark/accounting.mjs';
import { checkSubscriptions } from './benchmark/auth.mjs';
import { recoverShipUsage, applyShipUsage } from './benchmark/usage.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultHome = join(repository, '.specship', 'benchmark');
const [action = 'help', ...argv] = process.argv.slice(2);
const options = {};
for (let i = 0; i < argv.length; i++) {
  const key = argv[i];
  if (!key.startsWith('--') || key in options) throw Error(`Invalid option: ${key}`);
  options[key] = ['--execute'].includes(key) ? true : argv[++i];
  if (options[key] === undefined) throw Error(`Missing value: ${key}`);
}
const home = resolve(options['--home'] ?? defaultHome);
const ownedContainers = new Map();
async function interrupted() {
  await Promise.allSettled([...ownedContainers].map(([name, docker]) => processCommand(docker, ['rm', '-f', name], { capture: true, timeout: 15_000 })));
  process.exit(130);
}
process.once('SIGINT', () => { void interrupted(); });process.once('SIGTERM', () => { void interrupted(); });
const json = async path => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
async function save(path, value, exclusive = false) { await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: exclusive ? 'wx' : 'w' }); }
async function processCommand(executable, args, { cwd = repository, input, timeout = 120_000, capture = false } = {}) {
  return new Promise((resolvePromise, reject) => {
    const env = { ...process.env, PATH: [isAbsolute(executable) ? dirname(executable) : '', process.env.PATH].filter(Boolean).join(delimiter) };
    const child = spawn(executable, args, { cwd, env, windowsHide: true, stdio: ['pipe', capture ? 'pipe' : 'inherit', capture ? 'pipe' : 'inherit'] });
    const stdout = [], stderr = [];let size = 0;
    const timer = setTimeout(() => { child.kill();reject(Error(`Command timed out: ${executable}`)); }, timeout);
    child.stdout?.on('data', chunk => { size += chunk.length;if (size > 64_000_000) { child.kill();reject(Error('Command output exceeds 64 MB')); } else stdout.push(chunk); });
    child.stderr?.on('data', chunk => stderr.push(chunk));
    child.once('error', error => { clearTimeout(timer);reject(error); });
    child.once('close', code => { clearTimeout(timer);const output = Buffer.concat(stdout).toString();code === 0 ? resolvePromise(output) : reject(Error(`${executable} exited ${code}: ${Buffer.concat(stderr).toString().slice(-2000)}`)); });
    child.stdin.on('error', () => {});child.stdin.end(input);
  });
}
async function configuration() {
  const config = await json(join(home, 'config.json'));
  if (config.schema !== 1 || !Number.isSafeInteger(config.timeout_seconds) || config.timeout_seconds < 1 || config.timeout_seconds > 86_400 || !Number.isSafeInteger(config.repetitions) || config.repetitions < 1 || config.repetitions > 100) throw Error('Invalid benchmark configuration');
  if (config.arms && (!Array.isArray(config.arms) || !config.arms.length || new Set(config.arms).size !== config.arms.length || config.arms.some(arm => !arms.includes(arm)))) throw Error('Invalid benchmark arms');
  if (config.auth?.mode && !['api', 'subscription'].includes(config.auth.mode)) throw Error('Unknown authentication mode');
  return config;
}
async function frozen() {
  const lock = await json(join(home, 'cases.lock.json'));
  if (digest(lock.cases) !== lock.sha256) throw Error('Frozen cases changed; create a new benchmark home instead');
  return lock;
}
function imageFor(config, row) {
  const image = row.image ?? config.instance_image.replaceAll('{instance_id}', row.instance_id.toLowerCase());
  if (!/^[a-zA-Z0-9_./:@-]+$/.test(image)) throw Error('Invalid instance image');
  return image;
}
function validateModels(config, selectedArms) {
  const valid = (value, label) => { if (typeof value?.model !== 'string' || !value.model.trim() || /YOUR_|<|>/.test(value.model)) throw Error(`Set ${label}.model in ${join(home, 'config.json')}`); };
  if (selectedArms.some(usesSpec)) valid(config.spec, 'spec');
  if (selectedArms.some(usesOpenCodeShip)) valid(config.ship, 'ship');
  if (selectedArms.some(usesDshShip)) {
    valid(config.dsh, 'dsh');
    if (!config.dsh.model.startsWith('deepseek-official/')) throw Error('The DSH benchmark arm requires a deepseek-official/ dsh.model using DEEPSEEK_API_KEY');
    if (config.dsh.effort && !['off', 'low', 'high', 'max'].includes(config.dsh.effort)) throw Error('DSH dsh.effort must be off, low, high, or max');
  }
  if (!Array.isArray(config.credential_env) || config.credential_env.some(key => !/^[A-Z][A-Z0-9_]*$/.test(key))) throw Error('credential_env must contain environment variable names, never secret values');
  for (const path of [config.auth?.codex_file, config.auth?.opencode_file]) if (path && !isAbsolute(path)) throw Error('Authentication file paths must be absolute');
}
async function buildImage(config, row) {
  // Small context only: never send benchmark cases, secrets, Git history, or results to Docker.
  const buildRoot = join(home, 'build', randomUUID());await mkdir(buildRoot, { recursive: true });
  for (const path of ['package.json', 'package-lock.json', 'dist', '.agents/skills', 'scripts/benchmark']) {
    await mkdir(dirname(join(buildRoot, path)), { recursive: true });await cp(join(repository, path), join(buildRoot, path), { recursive: true });
  }
  const dshVersion = config.dsh_version ?? '0.2.1-rc.2';
  const image = `specship-benchmark:${digest({ instance: imageFor(config, row), codex: config.codex_version, opencode: config.opencode_version, dsh: dshVersion, runtime: await readFile(join(repository, 'dist/runner.js'), 'utf8'), accounting: await readFile(join(repository, 'scripts/benchmark/accounting.mjs'), 'utf8'), agent: await readFile(join(repository, 'scripts/benchmark/agent.mjs'), 'utf8') }).slice(0, 20)}`;
  await processCommand(config.docker, ['build', '--platform', 'linux/amd64', '-f', join(buildRoot, 'scripts/benchmark/Dockerfile'), '--build-arg', `INSTANCE_IMAGE=${imageFor(config, row)}`, '--build-arg', `CODEX_VERSION=${config.codex_version}`, '--build-arg', `OPENCODE_VERSION=${config.opencode_version}`, '--build-arg', `DSH_VERSION=${dshVersion}`, '-t', image, buildRoot], { timeout: 1_800_000 });
  const imageId = (await processCommand(config.docker, ['image', 'inspect', '--format', '{{.Id}}', image], { capture: true })).trim();
  return { image, imageId };
}
async function gradePatch(config, datasetPath, evalRoot, instanceId, label, patch) {
  const evaluationId = `bench-${randomUUID()}`;
  const predictions = join(evalRoot, `${evaluationId}.jsonl`);
  await writeFile(predictions, JSON.stringify({ instance_id: instanceId, model_name_or_path: label, model_patch: patch }) + '\n');
  const graderImage = `specship-benchmark-grader:${config.swebench_version}`;
  await processCommand(config.docker, ['build', '--platform', 'linux/amd64', '-f', join(repository, 'scripts/benchmark/evaluator.Dockerfile'), '--build-arg', `SWEBENCH_VERSION=${config.swebench_version}`, '-t', graderImage, join(repository, 'scripts/benchmark')], { timeout: 1_800_000 });
  const graderImageId = (await processCommand(config.docker, ['image', 'inspect', '--format', '{{.Id}}', graderImage], { capture: true })).trim();
  const graderName = `specship-grader-${randomUUID()}`;
  const instanceContainer = `sweb.eval.${instanceId}.${evaluationId}`;
  ownedContainers.set(graderName, config.docker);
  ownedContainers.set(instanceContainer, config.docker);
  try {
    // Only the trusted, model-free evaluator gets the Docker socket and held-out cases.
    await processCommand(config.docker, ['run', '--platform', 'linux/amd64', '--name', graderName, '--mount', `type=bind,source=${evalRoot},target=/evaluation`, '--mount', 'type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock', graderImage, '--dataset_name', `/evaluation/${basename(datasetPath)}`, '--predictions_path', `/evaluation/${evaluationId}.jsonl`, '--run_id', evaluationId, '--max_workers', '1'], { timeout: 2_100_000 });
  } finally {
    for (const name of [graderName, instanceContainer]) {
      await processCommand(config.docker, ['rm', '-f', name], { capture: true }).catch(() => {});ownedContainers.delete(name);
    }
  }
  const reportPath = join(evalRoot, 'logs', 'run_evaluation', evaluationId, label, instanceId, 'report.json');
  const report = await json(reportPath);
  if (typeof report[instanceId]?.resolved !== 'boolean') throw Error('Grader returned no boolean resolution result');
  if (report[instanceId].infra_failure) throw Error(`Official grader reported infrastructure failure: ${reportPath}`);
  return { resolved: report[instanceId].resolved, grader_report: reportPath, grader_image_id: graderImageId };
}

if (action === 'init') {
  await mkdir(home, { recursive: true, mode: 0o700 });
  const config = { schema: 1, dataset: 'SWE-bench/SWE-bench_Lite', dataset_config: 'default', split: 'test', sample_size: 5, seed: 'specship-v1', repetitions: 1, timeout_seconds: 1800, docker: 'docker', python: 'python', swebench_version: '5.0.2', codex_version: '0.162.0-alpha.17.2', opencode_version: '1.18.30', dsh_version: '0.2.1-rc.2', instance_image: 'swebench/sweb.eval.x86_64.{instance_id}:latest', credential_env: ['CODEX_API_KEY', 'OPENAI_API_KEY'], spec: { model: null, effort: 'high', rates: null }, ship: { model: null, effort: 'high', rates: null }, dsh: { model: null, effort: 'high', rates: null }, pricing_note: 'Supply USD per million tokens as input/cached_input/cache_write/output, with source/date. Ship rates also require reasoning_is_separate true/false for the configured harness/provider. Keep rates null when unknown. No cost is actual billing.' };
  config.arms = defaultArms;config.credential_env = [];
  config.auth = { mode: 'subscription', codex_file: null, opencode_file: null };
  await save(join(home, 'config.json'), config, true);
  console.log(`Created ${join(home, 'config.json')}. No models were called. Set explicit models before run.`);
} else if (action === 'fetch') {
  const config = await configuration();
  const get = async url => { const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });if (!response.ok) throw Error(`Dataset request failed: ${response.status}`);return response.json(); };
  const hub = `https://huggingface.co/api/datasets/${config.dataset}`;
  const before = await get(hub);
  const splits = await get(`https://datasets-server.huggingface.co/splits?${new URLSearchParams({ dataset: config.dataset })}`);
  if (!splits.splits.some(s => s.config === config.dataset_config && s.split === config.split)) throw Error('Dataset config/split is unavailable');
  const rows = [];let total = Infinity;
  while (rows.length < total) {
    const page = await get(`https://datasets-server.huggingface.co/rows?${new URLSearchParams({ dataset: config.dataset, config: config.dataset_config, split: config.split, offset: String(rows.length), length: '100' })}`);
    if (page.partial || !Number.isSafeInteger(page.num_rows_total) || page.rows.length === 0) throw Error('Incomplete dataset page');
    total = page.num_rows_total;rows.push(...page.rows.map(r => r.row));
  }
  const after = await get(hub);
  if (!before.sha || before.sha !== after.sha) throw Error('Dataset changed while downloading; retry in a new benchmark home');
  const cases = selectCases(rows, config.seed, config.sample_size);
  await save(join(home, 'cases.lock.json'), { schema: 1, dataset: config.dataset, dataset_revision_observed: before.sha, config: config.dataset_config, split: config.split, seed: config.seed, source_rows: rows.length, fetched_at: new Date().toISOString(), sha256: digest(cases), cases }, true);
  console.log(`Frozen ${cases.length} cases. Gold patches and test patches stay on the controller, outside agent containers.`);
} else if (['plan', 'run', 'build', 'preflight'].includes(action)) {
  const config = await configuration(), lock = await frozen();
  const selectedArms = options['--arm'] ? [options['--arm']] : (config.arms ?? defaultArms);
  if (selectedArms.some(a => !arms.includes(a))) throw Error('Unknown benchmark arm');
  const cases = options['--case'] ? lock.cases.filter(c => c.instance_id === options['--case']) : lock.cases;
  if (!cases.length) throw Error('No matching case');
  const plan = { cases: cases.map(c => ({ instance_id: c.instance_id, image: imageFor(config, c) })), arms: selectedArms, repetitions: config.repetitions, attempts: cases.length * selectedArms.length * config.repetitions, timeout_seconds: config.timeout_seconds, models: { spec: config.spec.model, ship: config.ship.model, dsh: config.dsh?.model ?? null }, prices_configured: Boolean(config.spec.rates), paid_calls_enabled: action === 'run' && options['--execute'] === true };
  plan.authentication = config.auth?.mode ?? 'api';
  if (action === 'build' || action === 'preflight') {
    for (const row of cases) {
      const built = await buildImage(config, row);
      console.log(JSON.stringify({ instance_id: row.instance_id, ...built }));
      if (action === 'preflight') console.log(await processCommand(config.docker, ['run', '--rm', '--platform', 'linux/amd64', '-i', built.image], { input: JSON.stringify({ preflight: true, base_commit: row.base_commit }), capture: true }));
    }
  } else if (!plan.paid_calls_enabled) { console.log(JSON.stringify(plan, null, 2));if (action === 'run') console.log('Dry run only. Add --execute to authorize model calls.'); }
  else {
    validateModels(config, selectedArms);
    const availableEnv = plan.authentication === 'subscription' ? [] : config.credential_env.filter(key => process.env[key]);
    const specArms = selectedArms.filter(usesSpec), openCodeArms = selectedArms.filter(usesOpenCodeShip), dshArms = selectedArms.filter(usesDshShip);
    if (plan.authentication === 'subscription') {
      if (dshArms.length) throw Error('The DSH benchmark arm requires auth.mode "api" with DEEPSEEK_API_KEY; saved subscription auth is not used');
      await checkSubscriptions(config, selectedArms);
    } else {
      if (specArms.length && !config.auth?.codex_file && !availableEnv.some(key => ['CODEX_API_KEY', 'OPENAI_API_KEY'].includes(key))) throw Error('Configure Codex API credentials or auth.codex_file');
      if (openCodeArms.length && !config.auth?.opencode_file && !availableEnv.some(key => key !== 'CODEX_API_KEY')) throw Error('Configure OpenCode provider credentials or auth.opencode_file');
      if (dshArms.length && !availableEnv.includes('DEEPSEEK_API_KEY')) throw Error('Add DEEPSEEK_API_KEY to credential_env and set it in the environment for the DSH arm');
    }
    const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
    const runRoot = join(home, 'runs', runId);await mkdir(runRoot, { recursive: true });
    const revision = await processCommand('git', ['rev-parse', 'HEAD'], { capture: true });
    const dirty = await processCommand('git', ['status', '--porcelain'], { capture: true });
    await save(join(runRoot, 'manifest.json'), { run_id: runId, dataset_hash: lock.sha256, configuration: config, git_revision: revision.trim(), working_tree_dirty: Boolean(dirty), plan });
    for (const row of cases) {
      const built = await buildImage(config, row);
      for (let repeat = 0; repeat < config.repetitions; repeat++) {
        // Rotate arm order across cases/repeats to reduce systematic ordering bias.
        const rotation = (cases.indexOf(row) + repeat) % selectedArms.length;
        const order = [...selectedArms.slice(rotation), ...selectedArms.slice(0, rotation)];
        for (const arm of order) {
          const trialRoot = join(runRoot, `${row.instance_id}--${arm}--${repeat}`);await mkdir(trialRoot);
          const name = `specship-bench-${randomUUID()}`;
          ownedContainers.set(name, config.docker);
          const task = { instance_id: row.instance_id, base_commit: row.base_commit, problem_statement: row.problem_statement, arm, spec: config.spec, ship: usesDshShip(arm) ? config.dsh : config.ship, auth_mode: plan.authentication, timeout_seconds: config.timeout_seconds };
          console.log(`${runId}: ${row.instance_id} / ${arm} / ${repeat + 1}`);
          let failure, shipEvidence, usageError, stopped = false;
          const trialStarted = Date.now();
          try {
            await processCommand(config.docker, ['create', '--platform', 'linux/amd64', '--name', name, '-i', '--cpus', '4', '--memory', '8g', ...availableEnv.flatMap(key => ['-e', key]), built.image], { capture: true });
            if (usesSpec(arm) && config.auth?.codex_file) await processCommand(config.docker, ['cp', config.auth.codex_file, `${name}:/root/.codex/auth.json`], { capture: true });
            if (usesOpenCodeShip(arm) && config.auth?.opencode_file) await processCommand(config.docker, ['cp', config.auth.opencode_file, `${name}:/root/.local/share/opencode/auth.json`], { capture: true });
            await processCommand(config.docker, ['start', '-a', '-i', name], { input: JSON.stringify(task), timeout: config.timeout_seconds * 1000, capture: true });
          } catch (error) { failure = error.message; }
          // Kill the container, not just the docker client; this also stops Ship descendants.
          try {
            await processCommand(config.docker, ['stop', '--time', '5', name], { capture: true });
            stopped = true;
            await processCommand(config.docker, ['cp', `${name}:/benchmark-output/.`, trialRoot], { capture: true });
          } catch (error) { failure ??= error.message; }
          // Recover durable accounting even when the agent was killed or its export failed.
          try {
            if (usesOpenCodeShip(arm)) {
              if (!stopped) await processCommand(config.docker, ['stop', '--time', '5', name], { capture: true });
              shipEvidence = await recoverShipUsage(config.docker, name, { since: trialStarted, model: config.ship.model, reasoningIsSeparate: config.ship.rates?.reasoning_is_separate }, processCommand);
              await save(join(trialRoot, 'ship-usage.json'), shipEvidence);
            }
          } catch (error) { usageError = error.message; }
          finally { await processCommand(config.docker, ['rm', '-f', name], { capture: true }).catch(() => {});ownedContainers.delete(name); }
          let result;
          try { result = await json(join(trialRoot, 'result.json')); }
          catch { result = { arm, instance_id: row.instance_id, status: 'infrastructure_failure', resolved: null, api_equivalent_usd: null, error: failure ?? 'No result from container' }; }
          if (failure) result.controller_error = failure;
          if (shipEvidence) applyShipUsage(result, shipEvidence);
          if (usageError && usesOpenCodeShip(arm)) result.ship_usage_recovery_error = usageError;
          Object.assign(result, trialEstimate(result, config));
          result.image_id = built.imageId;result.repetition = repeat;result.run_id = runId;
          await save(join(trialRoot, 'result.json'), result);
        }
      }
    }
    console.log(`Run saved: ${runRoot}\nNext: npm run benchmark -- grade --run ${runId}`);
  }
} else if (action === 'controls') {
  const config = await configuration(), lock = await frozen();
  await processCommand(config.python, [join(repository, 'scripts/benchmark/check-evaluator.py'), join(home, 'cases.lock.json'), config.swebench_version]);
  const cases = options['--case'] ? lock.cases.filter(c => c.instance_id === options['--case']) : lock.cases;
  if (!cases.length) throw Error('No matching case');
  const evalRoot = join(home, 'controls', randomUUID());await mkdir(evalRoot, { recursive: true });
  const datasetPath = join(evalRoot, 'dataset.json');await save(datasetPath, cases);
  const results = [];
  for (const row of cases) {
    const noop = 'diff --git a/.benchmark-control b/.benchmark-control\nnew file mode 100644\n--- /dev/null\n+++ b/.benchmark-control\n@@ -0,0 +1 @@\n+no implementation changes\n';
    const gold = await gradePatch(config, datasetPath, evalRoot, row.instance_id, 'gold', row.patch);
    const negative = await gradePatch(config, datasetPath, evalRoot, row.instance_id, 'noop', noop);
    results.push({ instance_id: row.instance_id, gold, noop: negative, valid: gold.resolved === true && negative.resolved === false });
  }
  await save(join(evalRoot, 'controls.json'), { dataset_hash: lock.sha256, results });
  console.log(JSON.stringify(results, null, 2));if (results.some(r => !r.valid)) process.exitCode = 1;
} else if (action === 'grade' || action === 'report') {
  const runId = options['--run'];if (!runId || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(runId)) throw Error('Supply --run RUN_ID');
  const runRoot = join(home, 'runs', runId), manifest = await json(join(runRoot, 'manifest.json')), lock = await frozen();
  if (manifest.dataset_hash !== lock.sha256) throw Error('Run and dataset lock mismatch');
  const trialDirs = (await readdir(runRoot, { withFileTypes: true })).filter(e => e.isDirectory() && e.name.includes('--')).map(e => join(runRoot, e.name));
  if (action === 'grade') {
    const config = await configuration();
    await processCommand(config.python, [join(repository, 'scripts/benchmark/check-evaluator.py'), join(home, 'cases.lock.json'), manifest.configuration.swebench_version]);
    const evalRoot = join(runRoot, `evaluation-${randomUUID()}`);await mkdir(evalRoot);
    // A local dataset snapshot avoids accidentally grading against a newer remote revision.
    const datasetPath = join(evalRoot, 'dataset.json');await save(datasetPath, lock.cases);
    for (const trialDir of trialDirs) {
      const result = await json(join(trialDir, 'result.json'));
      let patch = '';try { patch = await readFile(join(trialDir, 'patch.diff'), 'utf8'); } catch { /* no prediction produced */ }
      try {
        Object.assign(result, await gradePatch(config, datasetPath, evalRoot, result.instance_id, result.arm, patch));
        result.grading_error = null;
      } catch (error) { result.resolved = null;result.grading_error = error.message; }
      await save(join(trialDir, 'result.json'), result);
    }
  }
  const trials = [];
  for (const dir of trialDirs) {
    const result = await json(join(dir, 'result.json'));
    if (manifest.configuration) Object.assign(result, trialEstimate(result, manifest.configuration));
    try { const quota = await json(join(dir, 'quota.json'));result.subscription_limit_delta = quotaDelta(quota);result.quota_source = quota.source;result.quota_bucket = quota.bucket;result.quota_reset = quota.before?.resets_at; } catch { result.subscription_limit_delta = null; }
    try {
      const billing = await json(join(dir, 'billing.json'));
      if (typeof billing.source !== 'string' || !billing.source || typeof billing.usd !== 'number' || !Number.isFinite(billing.usd) || billing.usd < 0) throw Error('Invalid billing evidence');
      result.actual_billed_usd = billing.usd;result.billing_source = billing.source;
      result.api_requests = Number.isSafeInteger(billing.api_requests) && billing.api_requests >= 0 ? billing.api_requests : null;
    } catch { result.actual_billed_usd = null;result.api_requests = null; }
    trials.push(result);
  }
  const aggregates = summarize(trials, manifest.plan.arms);
  for (const item of aggregates) {
    item.planned_attempts = manifest.plan.arms.includes(item.arm) ? manifest.plan.cases.length * manifest.plan.repetitions : 0;
    item.missing_attempts = Math.max(0, item.planned_attempts - item.attempts);
    if (item.missing_attempts) {
      item.success_rate = null;item.api_equivalent_usd = null;item.cost_per_success_usd = null;
    }
    item.verified_success_fraction = item.planned_attempts ? item.resolved / item.planned_attempts : null;
  }
  const summary = { run_id: runId, dataset_hash: manifest.dataset_hash, planned_attempts: manifest.plan.attempts, incomplete_run: trials.length !== manifest.plan.attempts, quality_and_cost: aggregates, trials, caveats: ['API-equivalent cost is an estimate, not an invoice or subscription charge.', 'Codex completed turns and OpenCode assistant messages are not HTTP request counts.', 'Missing usage, prices, billing, quota, or grading results remain null.', 'Subscription deltas require exclusive account usage and matching reset windows.', 'Public tasks may be contaminated; network access remains enabled for providers.'] };
  await save(join(runRoot, 'summary.json'), summary);
  console.log(JSON.stringify(summary.quality_and_cost, null, 2));console.log(`Full report: ${join(runRoot, 'summary.json')}`);
} else if (action === 'doctor') {
  const config = await configuration();
  if (config.auth?.mode === 'subscription') {
    try { await checkSubscriptions(config, config.arms ?? defaultArms);console.log('authentication: saved subscriptions verified; no API-key fallback'); }
    catch (error) { console.log(`authentication: unavailable (${error.message})`);process.exitCode = 1; }
  }
  for (const [name, executable, args] of [['docker', config.docker, ['version', '--format', '{{.Server.Version}}']], ['swebench', config.python, [join(repository, 'scripts/benchmark/check-evaluator.py'), join(home, 'cases.lock.json'), config.swebench_version]]]) {
    try { console.log(`${name}: ${(await processCommand(executable, args, { capture: true })).trim()}`); }
    catch (error) { console.log(`${name}: unavailable (${error.message})`);process.exitCode = 1; }
  }
} else {
  console.log('Benchmark: init | fetch | doctor | plan | controls [--case ID] | build [--case ID] | preflight [--case ID] | run [--execute] [--arm codex|ship|specship] [--case ID] | grade --run ID | report --run ID\nAll commands accept --home PATH. Model execution requires run --execute.');
}
