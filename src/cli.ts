#!/usr/bin/env node
import { resolve, isAbsolute, join } from 'node:path';
import { isDeepStrictEqual, promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { existsSync } from 'node:fs';
import { writeFile, mkdir, readFile, lstat } from 'node:fs/promises';
import { OpenCodeAdapter } from './adapters/opencode.js';
import { DeepSeekAdapter } from './adapters/deepseek.js';
import { HarnessRegistry } from './adapters/registry.js';
import { readConfig } from './config.js';
import { Store } from './state.js';
import { Runner } from './runner.js';
import { serveSpec } from './mcp.js';
import { interruptCommand } from './hooks.js';
import { preparePrivateStorage } from './private-storage.js';
import { DEFAULT_DELIVERY_MARGIN_SECONDS, toolTimeoutSeconds } from './timeouts.js';
import { localInstallation } from './installation.js';

function flags(args: string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]; const value = args[i + 1];
    if (!key?.startsWith('--') || !value || value.startsWith('--') || result.has(key)) throw new Error(`Invalid or duplicate option: ${key ?? ''}`);
    result.set(key.slice(2), value);
  }
  return result;
}
const quote = (value: string) => JSON.stringify(value);
const execute = promisify(execFile);

async function openCodeModels(executable: string): Promise<string[]> {
  let stdout: string;
  try {
    const extension = executable.toLowerCase().split('.').pop();
    const siblingCmd = executable.replace(/\.ps1$/i, '.cmd');
    const invocation = process.platform === 'win32' && extension === 'ps1' && existsSync(siblingCmd)
      ? { command: 'cmd.exe', args: ['/d', '/s', '/c', `${siblingCmd} models`] }
      : process.platform === 'win32' && extension === 'ps1'
        ? { command: 'powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', executable, 'models'] }
        : process.platform === 'win32' && (extension === 'cmd' || extension === 'bat')
          ? { command: 'cmd.exe', args: ['/d', '/s', '/c', `${executable} models`] }
          : { command: executable, args: ['models'] };
    const result = await execute(invocation.command, invocation.args, { windowsHide: true, maxBuffer: 8_000_000, timeout: 60_000 });
    stdout = result.stdout;
  } catch (error) {
    const detail = (error as { stderr?: string }).stderr?.trim();
    throw new Error(`Could not list OpenCode models from ${executable}${detail ? `: ${detail}` : ''}`);
  }
  const models = [...new Set(stdout.split(/\r?\n/).map(line => line.trim()).filter(line => /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.:-]+$/.test(line)))].sort();
  if (!models.length) throw new Error(`OpenCode returned no models from ${executable}`);
  return models;
}

async function modelsCommand(args: string[]): Promise<void> {
  const options = flags(args);
  const executable = options.get('executable') ?? 'opencode';
  const query = (options.get('query') ?? '').toLowerCase();
  const models = (await openCodeModels(executable)).filter(model => !query || model.toLowerCase().includes(query));
  if (!models.length) throw new Error(`No OpenCode model matches "${query}"`);
  if (options.get('json') === 'true') process.stdout.write(`${JSON.stringify({ models }, null, 2)}\n`);
  else process.stdout.write(`${models.join('\n')}\n`);
}

async function selectOpenCodeModel(executable: string): Promise<string> {
  if (!process.stdin.isTTY) throw new Error('--select-model requires an interactive terminal; pass --model provider/model instead');
  const models = await openCodeModels(executable);
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const query = (await rl.question('Filter OpenCode models (blank for all): ')).trim().toLowerCase();
    const candidates = models.filter(model => !query || model.toLowerCase().includes(query));
    if (!candidates.length) throw new Error(`No OpenCode model matches "${query}"`);
    candidates.forEach((model, index) => process.stderr.write(`${index + 1}. ${model}\n`));
    const answer = await rl.question(`Select model number (1-${candidates.length}): `);
    const selected = candidates[Number(answer) - 1];
    if (!selected) throw new Error('Invalid model selection');
    return selected;
  } finally { rl.close(); }
}

async function worktrees(args: string[]): Promise<void> {
  const options = flags(args);
  const workspace = resolve(options.get('workspace') ?? process.cwd());
  const prune = options.get('prune') === 'true' || options.get('prune') === '1';
  const store = new Store(workspace); await store.initialize();
  const rows = await store.listRuns(0, 1_000);
  const result: { worktrees: unknown[]; removed: string[] } = { worktrees: [], removed: [] };
  for (const row of rows) {
    if (!row.ship_workspace) continue;
    let exists = true;
    try { exists = (await lstat(row.ship_workspace)).isDirectory(); } catch { exists = false; }
    const reclaimable = ['completed', 'cancelled', 'failed'].includes(String(row.phase ?? row.lifecycle));
    if (prune && exists && reclaimable) {
      await execute('git', ['-C', workspace, 'worktree', 'remove', '--force', row.ship_workspace], { windowsHide: true }).catch(() => undefined);
      await execute('git', ['-C', workspace, 'worktree', 'prune'], { windowsHide: true }).catch(() => undefined);
      const state = await store.load(row.run_id);
      state.ship_workspace = undefined;
      state.checkpoint_root = undefined;
      await store.save(state);
      result.removed.push(row.ship_workspace);
    } else {
      result.worktrees.push({ run_id: row.run_id, phase: row.phase, exists, reclaimable, ship_workspace: row.ship_workspace });
    }
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function setup(args: string[]): Promise<void> {
  const options = flags(args);
  const workspace = resolve(options.get('workspace') ?? process.cwd());
  const profileName = options.get('profile');
  let model = options.get('model');
  const executable = options.get('executable');
  const selectModel = options.get('select-model') === 'true';
  const max = options.has('max-dispatch-seconds') ? Number(options.get('max-dispatch-seconds')) : null;
  const margin = Number(options.get('delivery-margin-seconds') ?? DEFAULT_DELIVERY_MARGIN_SECONDS);
  const variant = options.get('variant');
  const shipShell=options.get('shell');
  const harness=options.get('harness') ?? 'opencode';
  const cliOption=options.get('cli');
  const sandbox=options.get('sandbox');
  const isolation=options.get('isolation');
  if (!profileName || !executable || !isAbsolute(executable) || max !== null && (!Number.isSafeInteger(max) || max < 1) || !Number.isSafeInteger(margin) || margin < 1 || isolation && !['shared','worktree'].includes(isolation)) {
    throw new Error('setup requires --profile NAME --executable ABSOLUTE_PATH and either --model provider/model or --select-model true; optional --harness opencode|deepseek --max-dispatch-seconds N --delivery-margin-seconds N --variant VALUE --shell ABSOLUTE_PATH --cli ABSOLUTE_PATH --sandbox workspace-write|danger-full-access --isolation shared|worktree');
  }
  if (selectModel && harness !== 'opencode') throw new Error('--select-model is available for the opencode harness; pass --model explicitly for deepseek');
  if (!model && selectModel) model = await selectOpenCodeModel(executable);
  if (!model || !/^[^/]+\/.+$/.test(model)) throw new Error('setup requires --model provider/model or --select-model true');
  let entry: any;
  if (harness === 'opencode') {
    if (variant && !['low','medium','high'].includes(variant)) throw new Error('OpenCode variant must be low, medium, or high');
    if (shipShell && !isAbsolute(shipShell)) throw new Error('OpenCode shell must be an absolute executable path');
    if (cliOption || sandbox) throw new Error('--cli and --sandbox apply only to the deepseek harness');
    entry = { harness: 'opencode', model, executable, options: { ...(variant?{variant}:{}), ...(shipShell?{shell:shipShell}:{}) } };
  } else if (harness === 'deepseek') {
    if (variant && !['off','low','high','max'].includes(variant)) throw new Error('DeepSeek reasoning effort must be off, low, high, or max');
    if (shipShell) throw new Error('--shell is an OpenCode option; DeepSeek ACP uses its own shell tools');
    if (cliOption && !isAbsolute(cliOption)) throw new Error('DeepSeek CLI must be an absolute path');
    if (sandbox && !['workspace-write','danger-full-access'].includes(sandbox)) throw new Error('DeepSeek sandbox must be workspace-write or danger-full-access');
    entry = { harness: 'deepseek', model, executable, options: { ...(variant?{reasoning_effort:variant}:{}), ...(cliOption?{cli:cliOption}:{}), ...(sandbox?{sandbox}:{}) } };
  } else throw new Error(`Unsupported harness '${harness}'; use opencode or deepseek`);
  const configPath = join(workspace, '.specship', 'config.json');
  await mkdir(workspace, { recursive: true });
  await preparePrivateStorage(workspace);
  const installation = await localInstallation(workspace);
  let config: any;
  try {
    config = await readConfig(configPath);
    const selected = config.ship.profiles[profileName];
    if (!selected || !isDeepStrictEqual(selected, entry) || (config.ship.isolation ?? 'shared') !== (isolation ?? 'shared') || (config.limits.max_dispatch_seconds ?? null) !== max || config.limits.delivery_margin_seconds !== margin) throw new Error('Existing .specship/config.json is preserved; setup arguments must match its selected profile, isolation, and limits');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    config = { ship: { default_profile: profileName, profiles: { [profileName]: entry }, ...(isolation?{isolation}:{}) }, limits: { max_dispatch_seconds: max, delivery_margin_seconds: margin } };
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    process.stderr.write(`Created reviewable configuration ${configPath}\n`);
  }
  const envPath = join(workspace, '.specship', '.env');
  const envExamplePath = join(workspace, '.specship', '.env.example');
  const deepSeekKey = process.env.DEEPSEEK_API_KEY?.replace(/[\r\n]/g, '').trim();
  let envCreated = false;
  try {
    await writeFile(envPath, `# Specship local credentials. Never commit this file.\n# Required only for the DeepSeek Harness benchmark/API route.\nDEEPSEEK_API_KEY=${deepSeekKey ?? ''}\n`, { flag: 'wx', mode: 0o600 });
    envCreated = true;
    process.stderr.write(`Created ${envPath}${deepSeekKey ? ' with DEEPSEEK_API_KEY from the environment' : '; set DEEPSEEK_API_KEY there for the DSH benchmark'}\n`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  await writeFile(envExamplePath, '# Copy to .env and fill in the DeepSeek API key. Never commit this file.\nDEEPSEEK_API_KEY=\n', { flag: 'wx', mode: 0o600 }).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; });
  const cliPath = installation.cli;
  const timeout = toolTimeoutSeconds(max, margin);
  const toml = `[features.code_mode]\ndirect_only_tool_namespaces = ["mcp__specship"]\n\n[mcp_servers.specship]\ncommand = ${quote(process.execPath)}\nargs = [${quote(cliPath)}, "serve", ${quote(workspace)}]\ntool_timeout_sec = ${timeout}\n`;
  const command = interruptCommand(process.execPath, cliPath, workspace);
  const hooks = { hooks: { Interrupt: [{ hooks: [{ type: 'command', command, timeout: 3 }] }] } };
  process.stdout.write(JSON.stringify({ runtime: installation.root, configuration: configPath, environment: envPath, environment_example: envExamplePath, environment_created: envCreated, codex_toml: toml, hooks_json: hooks, note: 'Review and explicitly trust the Interrupt hook in Codex; setup does not modify Codex settings. Put DEEPSEEK_API_KEY in .specship/.env for the DSH benchmark; the DSH desktop app uses its own sign-in.' }, null, 2) + '\n');
}

async function interrupt(workspace: string): Promise<void> {
  const chunks: Buffer[] = [];
  let size=0;
  for await (const chunk of process.stdin) { const part=Buffer.from(chunk);size+=part.length;if(size>64_000)throw new Error('Interrupt event exceeds 64 KB');chunks.push(part); }
  const event = JSON.parse(Buffer.concat(chunks).toString() || '{}');
  if (event.hook_event_name !== 'Interrupt' || typeof event.session_id !== 'string' || typeof event.turn_id !== 'string') throw new Error('Interrupt hook must supply native session_id and turn_id');
  let descriptor;
  try { descriptor=JSON.parse(await readFile(join(workspace, '.specship', 'active-run.json'), 'utf8')); }
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
  if (event.session_id !== descriptor.session_id || event.turn_id !== descriptor.turn_id) throw new Error('Interrupt does not match the exact active Codex turn');
  const url = new URL(descriptor.url);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !Number(url.port) || url.pathname !== '/' || url.username || url.password || url.search || url.hash || typeof descriptor.capability!=='string') throw new Error('Active runner descriptor is not a trusted loopback endpoint');
  const response = await fetch(`${url.origin}/interrupt`, { method: 'POST', headers: { authorization: `Bearer ${descriptor.capability}`, 'content-type': 'application/json' }, body: JSON.stringify({ session_id: event.session_id, turn_id: event.turn_id }), redirect: 'error', signal: AbortSignal.timeout(2_000) });
  if (!response.ok) throw new Error(`Runner did not confirm Interrupt (${response.status})`);
  await response.arrayBuffer();
}

const [command = 'serve', ...args] = process.argv.slice(2);
if (command === 'setup') await setup(args);
else if (command === 'models') await modelsCommand(args);
else if (command === 'interrupt') {
  const options = flags(args); await interrupt(resolve(options.get('workspace') ?? process.cwd()));
}
else if(command==='worktrees') await worktrees(args);
else if(command==='serve') {
  const workspace = resolve(args[0] ?? process.cwd());
  const store = new Store(workspace); await store.initialize();
  const config = await readConfig(resolve(workspace, '.specship', 'config.json'));
  const runner = new Runner(store, config, new HarnessRegistry({ opencode: new OpenCodeAdapter(), deepseek: new DeepSeekAdapter() }));
  process.once('SIGINT', () => { void runner.close(); });
  process.once('SIGTERM', () => { void runner.close(); });
  await serveSpec(runner, store);
}
else throw new Error(`Unknown command: ${command}. Use setup, models, serve, interrupt, or worktrees.`);
