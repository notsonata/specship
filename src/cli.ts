#!/usr/bin/env node
import { resolve, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { OpenCodeAdapter } from './adapters/opencode.js';
import { readConfig } from './config.js';
import { Store } from './state.js';
import { Runner } from './runner.js';
import { serveSpec } from './mcp.js';
import { interruptCommand } from './hooks.js';
import { preparePrivateStorage } from './private-storage.js';

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

async function setup(args: string[]): Promise<void> {
  const options = flags(args);
  const workspace = resolve(options.get('workspace') ?? process.cwd());
  const profileName = options.get('profile');
  const model = options.get('model');
  const executable = options.get('executable');
  const max = Number(options.get('max-dispatch-seconds'));
  const margin = Number(options.get('delivery-margin-seconds'));
  const variant = options.get('variant');
  const shipShell=options.get('shell');
  if (!profileName || !model || !/^[^/]+\/.+$/.test(model) || !executable || !isAbsolute(executable) || !Number.isSafeInteger(max) || max < 1 || !Number.isSafeInteger(margin) || margin < 1 || variant && !['low','medium','high'].includes(variant)||shipShell&&!isAbsolute(shipShell)) {
    throw new Error('setup requires --profile NAME --model provider/model --executable ABSOLUTE_PATH --max-dispatch-seconds N --delivery-margin-seconds N [--variant low|medium|high] [--shell ABSOLUTE_PATH]');
  }
  const configPath = join(workspace, '.specship', 'config.json');
  await mkdir(workspace, { recursive: true });
  await preparePrivateStorage(workspace);
  let config: any;
  try {
    config = await readConfig(configPath);
    const selected = config.ship.profiles[profileName];
    if (!selected || selected.model !== model || selected.executable !== executable || selected.options.variant !== variant || selected.options.shell!==shipShell || config.limits.max_dispatch_seconds !== max || config.limits.delivery_margin_seconds !== margin) throw new Error('Existing .specship/config.json is preserved; setup arguments must match its selected profile and limits');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    config = { ship: { default_profile: profileName, profiles: { [profileName]: { harness: 'opencode', model, executable, options: {...(variant?{variant}:{}),...(shipShell?{shell:shipShell}:{})} } } }, limits: { max_dispatch_seconds: max, delivery_margin_seconds: margin } };
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    process.stderr.write(`Created reviewable configuration ${configPath}\n`);
  }
  const cliPath = fileURLToPath(import.meta.url);
  const timeout = max + margin;
  const toml = `[features.code_mode]\ndirect_only_tool_namespaces = ["mcp__specship"]\n\n[mcp_servers.specship]\ncommand = ${quote(process.execPath)}\nargs = [${quote(cliPath)}, "serve", ${quote(workspace)}]\ntool_timeout_sec = ${timeout}\n`;
  const command = interruptCommand(process.execPath, cliPath, workspace);
  const hooks = { hooks: { Interrupt: [{ hooks: [{ type: 'command', command, timeout: 3 }] }] } };
  process.stdout.write(JSON.stringify({ configuration: configPath, codex_toml: toml, hooks_json: hooks, note: 'Review and explicitly trust the Interrupt hook in Codex; setup does not modify Codex settings.' }, null, 2) + '\n');
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
else if (command === 'interrupt') {
  const options = flags(args); await interrupt(resolve(options.get('workspace') ?? process.cwd()));
}
else if(command==='serve') {
  const workspace = resolve(args[0] ?? process.cwd());
  const store = new Store(workspace); await store.initialize();
  const config = await readConfig(resolve(workspace, '.specship', 'config.json'));
  const runner = new Runner(store, config, new OpenCodeAdapter());
  process.once('SIGINT', () => { void runner.close(); });
  process.once('SIGTERM', () => { void runner.close(); });
  await serveSpec(runner, store);
}
else throw new Error(`Unknown command: ${command}. Use setup, serve, or interrupt.`);
