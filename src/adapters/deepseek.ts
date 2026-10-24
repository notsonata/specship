import { spawn, type ChildProcess } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { createInterface, type Interface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { isDeepSeekProfile, type DeepSeekProfile, type Profile } from '../contracts.js';
import type { AdapterEvent, ShipAdapter } from './types.js';
import { splitModel } from '../config.js';

type JsonRpcMessage = { jsonrpc?: string; id?: number | string; method?: string; params?: any; result?: any; error?: { code?: number; message?: string } };
type Pending = { resolve: (value: any) => void; reject: (error: Error) => void; timer?: NodeJS.Timeout };
type QueuedStream = { queue: AdapterEvent[]; wake: Array<() => void>; failure?: Error };
type PromptState = { operationId: string; settled: boolean; stopReason?: string; error?: Error; settleWaiters: Array<() => void> };
type Permission = { id: number | string; session: string; options: Array<{ optionId: string; kind: string; name?: string }> };

const DEEPSEEK_OPTIONS = new Set(['reasoning_effort', 'profile', 'cli', 'sandbox']);
const CALLBACK_SERVER = 'specship_callbacks';

function modelValue(value: string): [string, string] | undefined {
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.length === 2 && typeof parsed[0] === 'string' && typeof parsed[1] === 'string') return [parsed[0], parsed[1]];
  } catch { /* ACP historically also emitted provider/model strings. */ }
  const split = value.indexOf('/');
  if (split > 0 && split < value.length - 1) return [value.slice(0, split), value.slice(split + 1)];
  return undefined;
}

function permissionOption(permission: Permission, decision: 'once' | 'always' | 'reject'): string | undefined {
  const options = permission.options ?? [];
  if (decision === 'reject') return options.find(option => option.kind === 'reject_once')?.optionId ?? options.find(option => option.kind === 'reject_always')?.optionId;
  if (decision === 'once') return options.find(option => option.kind === 'allow_once')?.optionId ?? options.find(option => option.kind === 'allow_always')?.optionId;
  return options.find(option => option.kind === 'allow_always')?.optionId ?? options.find(option => option.kind === 'allow_once')?.optionId;
}

export class DeepSeekAdapter implements ShipAdapter {
  readonly name = 'deepseek';
  private child?: ChildProcess;
  private lines?: Interface;
  private version = 'acp';
  private profile?: DeepSeekProfile;
  private workspace = '';
  private activityKind: 'explore' | 'implement' | 'correct' = 'implement';
  private session = '';
  private callback?: { url: string; capability: string; descriptorPath?: string; timeoutMs?: number };
  private readonly callbackCli = fileURLToPath(new URL('../callback-cli.js', import.meta.url));
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private permissions = new Map<string, Permission>();
  private streams = new Map<string, QueuedStream>();
  private prompts = new Map<string, PromptState>();
  private currentPrompt?: PromptState;
  private configOptions: any[] = [];
  private mediaTypes: string[] = [];
  private imageSupported = false;
  private diagnostics = '';
  private spawnFailure?: Error;
  private exited?: { code: number | null; signal: NodeJS.Signals | null };
  private closing = false;
  private sessionClosed = false;
  private shipPrompt = '';
  private submitted = 0;

  constructor(private stopTimeoutMs = 120_000) {}

  async validate(profile: Profile, media: string[]): Promise<void> {
    if (!isDeepSeekProfile(profile)) throw new Error('DeepSeek adapter requires a deepseek Ship profile');
    const unsupported = Object.keys(profile.options ?? {}).filter(key => !DEEPSEEK_OPTIONS.has(key));
    if (unsupported.length) throw new Error(`DeepSeek profile has unsupported options: ${unsupported.join(', ')}`);
    if (!isAbsolute(profile.executable)) throw new Error('DeepSeek executable must be an absolute path');
    if (profile.options.cli && !isAbsolute(profile.options.cli)) throw new Error('DeepSeek CLI must be an absolute path');
    const [provider, model] = splitModel(profile.model);
    if (!provider || !model) throw new Error('Profile model must be provider/model');
    if (media.length) throw new Error('DeepSeek ACP currently advertises no image input; use a text-only brief or another configured profile');
    this.mediaTypes = [...media];
    this.profile = profile;
  }

  private async launch(profile: DeepSeekProfile): Promise<{ command: string; args: string[]; env: Record<string, string> }> {
    const profileName = profile.options.profile ?? 'acp';
    if (profile.options.cli) {
      const electron = basename(profile.executable).toLowerCase() === 'deepseek harness.exe';
      return { command: profile.executable, args: [...(electron ? ['--expose-internals'] : []), profile.options.cli, '--profile', profileName], env: electron ? { ELECTRON_RUN_AS_NODE: '1' } : {} };
    }
    const name = basename(profile.executable).toLowerCase();
    if (process.platform === 'win32' && (name.endsWith('.cmd') || name.endsWith('.bat'))) throw new Error('Configure the DeepSeek Harness.exe path on Windows; the dsh.cmd launcher cannot be spawned without a shell');
    if (name === 'deepseek harness.exe') {
      const resources = join(dirname(profile.executable), 'resources');
      await access(join(resources, 'app.asar')).catch(() => { throw new Error(`DeepSeek resources were not found beside ${profile.executable}`); });
      const cli = join(resources, 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js');
      return { command: profile.executable, args: ['--expose-internals', cli, '--profile', profileName], env: { ELECTRON_RUN_AS_NODE: '1' } };
    }
    return { command: profile.executable, args: ['--profile', profileName], env: {} };
  }

  private async loadShipPrompt(): Promise<string> {
    const path = fileURLToPath(new URL('../../.agents/skills/ship/SKILL.md', import.meta.url));
    let raw: string;
    try { raw = await readFile(path, 'utf8'); }
    catch (error) { throw new Error(`The Ship skill is unavailable at ${path}`, { cause: error }); }
    return `${raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')}\nThis is a runner-associated assignment. DeepSeek ACP exposes only mcp__specship_callbacks__report_result; its MCP transport limits a single tool call, so do not depend on a long-held callback. For a consequential decision, submit a report_result with status needs_decision that includes the standard implementation fields (changes, acceptance_evidence, validation, deviations, remaining_issues) and states the blocker, evidence, attempts, and one decision needed in remaining_issues. The supervisor will resume this same session with an answer. Submit the final structured result through report_result before finishing. Routine command and path failures should be investigated within scope.\n`;
  }

  private async boot(profile: DeepSeekProfile, kind: 'explore' | 'implement' | 'correct'): Promise<void> {
    this.profile = profile;
    this.activityKind = kind;
    const launch = await this.launch(profile);
    const env: NodeJS.ProcessEnv = { ...process.env, ...launch.env, DSH_PERMISSION_MODE: kind === 'explore' ? 'read-only' : profile.options.sandbox ?? 'workspace-write' };
    delete env.DSH_SESSION_ID;
    delete env.DSH_WEB_URL;
    this.exited = undefined;
    this.spawnFailure = undefined;
    this.diagnostics = '';
    let child: ChildProcess;
    try { child = spawn(launch.command, launch.args, { cwd: this.workspace, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); }
    catch (error) { throw new Error(`Unable to start DeepSeek ACP: ${String(error)}`, { cause: error }); }
    this.child = child;
    child.once('error', error => { if (this.child !== child) return; this.spawnFailure = error instanceof Error ? error : new Error(String(error)); this.failAll(this.spawnFailure); });
    child.once('exit', (code, signal) => { if (this.child === child) this.handleExit(code, signal); });
    child.stdin?.on('error', error => { if (this.child === child) this.failAll(error instanceof Error ? error : new Error(String(error))); });
    child.stderr?.on('data', chunk => { if (this.child === child) this.diagnostics = (this.diagnostics + chunk.toString()).slice(-8_000); });
    if (!child.stdout) throw new Error('DeepSeek ACP stdout is unavailable');
    this.lines = createInterface({ input: child.stdout });
    this.lines.on('line', line => this.handleLine(line));
    const initialized = await this.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
      clientInfo: { name: 'specship', version: '1.0.0' },
    }, 20_000);
    if (initialized?.protocolVersion !== 1) throw new Error(`DeepSeek ACP protocol ${String(initialized?.protocolVersion)} is not supported`);
    this.version = typeof initialized?.agentInfo?.version === 'string' ? initialized.agentInfo.version : 'acp';
    this.imageSupported = Boolean(initialized?.agentCapabilities?.promptCapabilities?.image);
    if (this.mediaTypes.length && !this.imageSupported) throw new Error('Selected DeepSeek ACP route does not support image input');
    if (!initialized?.agentCapabilities?.sessionCapabilities?.resume) throw new Error('DeepSeek ACP does not advertise session resume; this adapter requires a DSH build with that capability');
  }

  private callbackServers(): unknown[] {
    if (!this.callback?.descriptorPath) throw new Error('DeepSeek adapter requires an authenticated callback descriptor path');
    return [{
      name: CALLBACK_SERVER,
      command: process.execPath,
      args: [this.callbackCli],
      env: [
        { name: 'SPECSHIP_CALLBACK_DESCRIPTOR', value: this.callback.descriptorPath },
        { name: 'SPECSHIP_CALLBACK_REPORT_ONLY', value: '1' },
      ],
    }];
  }

  private async createSession(): Promise<void> {
    const created = await this.request('session/new', { cwd: this.workspace, mcpServers: this.callbackServers(), additionalDirectories: [] }, 30_000);
    if (typeof created?.sessionId !== 'string' || !created.sessionId) throw new Error('DeepSeek ACP did not return a session identity');
    this.session = created.sessionId;
    this.sessionClosed = false;
    this.configOptions = Array.isArray(created.configOptions) ? created.configOptions : [];
    await this.selectModel();
    await this.selectEffort();
  }

  private async resumeSession(session: string): Promise<void> {
    const resumed = await this.request('session/resume', { sessionId: session, cwd: this.workspace, mcpServers: this.callbackServers(), additionalDirectories: [] }, 30_000);
    this.session = session;
    this.sessionClosed = false;
    this.configOptions = Array.isArray(resumed?.configOptions) ? resumed.configOptions : [];
    await this.selectModel();
    await this.selectEffort();
  }

  private modelChoices(): Array<{ value: string; model: [string, string]; name: string }> {
    const option = this.configOptions.find(item => item?.id === 'model');
    if (!option || option.type !== 'select') throw new Error('DeepSeek ACP did not advertise a model selector');
    const choices: Array<{ value: string; model: [string, string]; name: string }> = [];
    for (const entry of option.options ?? []) {
      const values = Array.isArray(entry?.options) ? entry.options : [entry];
      for (const item of values) {
        const parsed = typeof item?.value === 'string' ? modelValue(item.value) : undefined;
        if (parsed) choices.push({ value: item.value, model: parsed, name: item.name ?? parsed.join('/') });
      }
    }
    return choices;
  }

  private async selectModel(): Promise<void> {
    const [provider, model] = splitModel(this.profile!.model);
    const option = this.configOptions.find(item => item?.id === 'model');
    const match = this.modelChoices().find(item => item.model[0] === provider && item.model[1] === model);
    if (!match) throw new Error(`DeepSeek model unavailable: ${this.profile!.model}. Available: ${this.modelChoices().map(item => item.model.join('/')).join(', ') || 'none'}`);
    if (option.currentValue === match.value) return;
    const result = await this.request('session/set_config_option', { sessionId: this.session, configId: 'model', value: match.value }, 15_000);
    this.configOptions = Array.isArray(result?.configOptions) ? result.configOptions : this.configOptions;
    const current = this.configOptions.find(item => item?.id === 'model')?.currentValue;
    if (current !== match.value) throw new Error(`DeepSeek ACP did not apply model ${this.profile!.model}`);
  }

  private async selectEffort(): Promise<void> {
    const requested = this.profile!.options.reasoning_effort;
    if (!requested) return;
    const option = this.configOptions.find(item => item?.id === 'reasoning_effort');
    if (!option || option.type !== 'select') throw new Error('DeepSeek ACP did not advertise a reasoning effort selector');
    const values: string[] = [];
    for (const entry of option.options ?? []) for (const item of (Array.isArray(entry?.options) ? entry.options : [entry])) if (typeof item?.value === 'string') values.push(item.value);
    if (!values.includes(requested)) throw new Error(`DeepSeek reasoning effort ${requested} is unavailable; choose one of ${values.join(', ')}`);
    if (option.currentValue === requested) return;
    const result = await this.request('session/set_config_option', { sessionId: this.session, configId: 'reasoning_effort', value: requested }, 15_000);
    this.configOptions = Array.isArray(result?.configOptions) ? result.configOptions : this.configOptions;
    if (this.configOptions.find(item => item?.id === 'reasoning_effort')?.currentValue !== requested) throw new Error(`DeepSeek ACP did not apply reasoning effort ${requested}`);
  }

  async start(workspace: string, profile: Profile, kind: 'explore' | 'implement' | 'correct', callback: { url: string; capability: string; descriptorPath?: string; timeoutMs?: number }): Promise<{ session: string; version: string }> {
    if (!isDeepSeekProfile(profile)) throw new Error('DeepSeek adapter requires a deepseek Ship profile');
    if (this.child) throw new Error('This DeepSeek adapter already owns an active process');
    this.workspace = workspace;
    this.callback = callback;
    this.shipPrompt = await this.loadShipPrompt();
    try {
      await this.boot(profile, kind);
      await this.createSession();
      return { session: this.session, version: this.version };
    } catch (error) {
      const child = this.ownedChild();
      if (child && !await this.terminateChild(child)) throw new Error(`DeepSeek startup failed and process termination is unconfirmed (PID ${child.pid ?? 'unknown'})`, { cause: error });
      this.reset();
      throw error;
    }
  }

  async subscribe(session: string, signal: AbortSignal): Promise<void> {
    if (this.session !== session) throw new Error('DeepSeek session identity does not match the subscribed session');
    const stream: QueuedStream = { queue: [], wake: [] };
    this.streams.set(session, stream);
    signal.addEventListener('abort', () => { for (const wake of stream.wake.splice(0)) wake(); }, { once: true });
  }

  async *events(session: string, signal: AbortSignal): AsyncIterable<AdapterEvent> {
    const stream = this.streams.get(session);
    if (!stream) throw new Error('Subscribe to DeepSeek ACP events before submitting');
    while (!signal.aborted) {
      const event = stream.queue.shift();
      if (event) { yield event; continue; }
      if (stream.failure) throw stream.failure;
      await new Promise<void>(resolve => { stream.wake.push(resolve); signal.addEventListener('abort', () => resolve(), { once: true }); });
    }
  }

  async submit(session: string, operationId: string, prompt: string, artifacts: Array<{ mime: string; name: string; data: Buffer }>): Promise<{ messageId: string }> {
    if (this.session !== session) throw new Error('DeepSeek session identity does not match the submitted session');
    if (!this.streams.has(session)) throw new Error('DeepSeek ACP event subscription must be active before submit');
    if (artifacts.length) throw new Error('DeepSeek ACP does not support artifact input in this adapter');
    if (this.currentPrompt) throw new Error('A DeepSeek ACP prompt is already active');
    this.submitted++;
    const text = `${this.submitted === 1 ? `${this.shipPrompt}\n\n` : ''}${prompt}\n[specship-operation:${operationId}]`;
    const id = this.nextId++;
    const state: PromptState = { operationId, settled: false, settleWaiters: [] };
    const response = this.register(id, 0);
    this.prompts.set(operationId, state);
    this.currentPrompt = state;
    try {
      this.send({ jsonrpc: '2.0', id, method: 'session/prompt', params: { sessionId: session, prompt: [{ type: 'text', text }] } });
    } catch (error) {
      this.failPending(id, error as Error);
      throw new Error(`Ambiguous DeepSeek submission for operation ${operationId}; no replay attempted: ${String(error)}`);
    }
    void response.then(result => {
      state.settled = true;
      state.stopReason = typeof result?.stopReason === 'string' ? result.stopReason : undefined;
      this.currentPrompt = undefined;
      for (const wake of state.settleWaiters.splice(0)) wake();
    }).catch(error => {
      state.settled = true;
      state.error = error instanceof Error ? error : new Error(String(error));
      this.currentPrompt = undefined;
      for (const wake of state.settleWaiters.splice(0)) wake();
      if (!this.closing) this.push(session, { type: 'error', session, data: { error: { name: 'DeepSeekPromptError', message: state.error.message } } });
    });
    return { messageId: operationId };
  }

  async reconcile(session: string, messageId: string): Promise<'active' | 'complete' | 'unknown'> {
    if (this.session !== session) return 'unknown';
    const state = this.prompts.get(messageId);
    if (!state) return this.currentPrompt ? 'active' : 'unknown';
    if (state.error) return 'unknown';
    return state.settled ? 'complete' : 'active';
  }

  async abort(session: string): Promise<boolean> {
    if (this.session !== session) return false;
    this.cancelPermissions();
    const state = this.currentPrompt;
    if (!state) return true;
    try { this.send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId: session } }); }
    catch { return false; }
    return await this.waitForSettlement(state, this.stopTimeoutMs);
  }

  async reply(session: string, operationId: string, answer: string, artifacts: Array<{ mime: string; name: string; data: Buffer }>): Promise<void> {
    if (this.currentPrompt) throw new Error('A DeepSeek ACP prompt is already active');
    await this.submit(session, operationId, answer, artifacts);
  }

  async resolvePermission(session: string, requestId: string, decision: 'once' | 'always' | 'reject'): Promise<void> {
    const permission = this.permissions.get(requestId);
    if (!permission || permission.session !== session) throw new Error('Exact native permission is no longer pending; no approval was replayed');
    const option = permissionOption(permission, decision);
    this.send({ jsonrpc: '2.0', id: permission.id, result: { outcome: option ? { outcome: 'selected', optionId: option } : { outcome: 'cancelled' } } });
    this.permissions.delete(requestId);
  }

  async snapshot(session: string): Promise<unknown> {
    if (this.session !== session || !this.profile) throw new Error('DeepSeek session is not available for snapshot');
    return { harness: 'deepseek', version: this.version, session, pid: this.child?.pid, workspace: this.workspace, profile: this.profile, kind: this.activityKind };
  }

  async restore(snapshot: unknown, callback: { url: string; capability: string; descriptorPath?: string; timeoutMs?: number }): Promise<{ session: string; version: string }> {
    if (this.child) throw new Error('This DeepSeek adapter already owns an active process');
    const value = snapshot as any;
    if (value?.harness !== 'deepseek' || typeof value.session !== 'string' || !value.session) throw new Error('Invalid private DeepSeek reconnect snapshot');
    if (!isAbsolute(value.workspace) || !isDeepSeekProfile(value.profile)) throw new Error('Saved DeepSeek workspace or profile is invalid');
    await this.validate(value.profile, []);
    if (Number.isInteger(value.pid) && this.pidAlive(value.pid)) throw new Error('Saved DeepSeek process is still alive but cannot be authenticated; stop is unconfirmed');
    this.workspace = value.workspace;
    this.callback = callback;
    this.mediaTypes = [];
    try {
      await this.boot(value.profile, value.kind === 'explore' || value.kind === 'correct' ? value.kind : 'implement');
      await this.resumeSession(value.session);
      this.version = typeof value.version === 'string' ? value.version : this.version;
      return { session: this.session, version: this.version };
    } catch (error) {
      const child = this.ownedChild();
      if (child && !await this.terminateChild(child)) throw new Error(`DeepSeek recovery failed and process termination is unconfirmed (PID ${child.pid ?? 'unknown'})`, { cause: error });
      this.reset();
      throw error;
    }
  }

  async close(session: string): Promise<boolean> {
    if (this.session && this.session !== session) throw new Error('DeepSeek close does not match the active session');
    this.closing = true;
    this.cancelPermissions();
    try {
      if (this.session && !this.sessionClosed) {
        try { await this.request('session/close', { sessionId: session }, 15_000); this.sessionClosed = true; }
        catch {
          if (!this.exited && this.child?.exitCode === null && this.child?.signalCode === null) { this.closing = false; return false; }
          this.sessionClosed = true;
        }
      }
      const child = this.child;
      if (child && !await this.terminateChild(child)) { this.closing = false; return false; }
      this.reset();
      return true;
    } finally {
      if (!this.exited) this.closing = false;
    }
  }

  async reconcileOperation(session: string, operationId: string): Promise<{ messageId: string; status: 'active' | 'complete' | 'unknown' }> {
    if (this.session !== session) return { messageId: '', status: 'unknown' };
    const state = this.prompts.get(operationId);
    if (!state) return { messageId: '', status: 'unknown' };
    return { messageId: operationId, status: state.error ? 'unknown' : state.settled ? 'complete' : 'active' };
  }

  private register(id: number, timeoutMs: number): Promise<any> {
    let timer: NodeJS.Timeout | undefined;
    const promise = new Promise<any>((resolve, reject) => {
      if (timeoutMs > 0) timer = setTimeout(() => { this.failPending(id, new Error(`DeepSeek ACP request ${id} timed out`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
    void promise.catch(() => {});
    return promise;
  }

  private async request(method: string, params: unknown, timeoutMs = 30_000): Promise<any> {
    const id = this.nextId++;
    const promise = this.register(id, timeoutMs);
    try { this.send({ jsonrpc: '2.0', id, method, params }); }
    catch (error) { this.failPending(id, error as Error); throw error; }
    return await promise;
  }

  private send(message: JsonRpcMessage): void {
    if (!this.child?.stdin || this.child.stdin.destroyed) throw new Error('DeepSeek ACP stdin is unavailable');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleLine(line: string): void {
    if (!line.trim()) return;
    let message: JsonRpcMessage;
    try { message = JSON.parse(line); }
    catch { this.diagnostics = (this.diagnostics + `\nstdout: ${line}`).slice(-8_000); return; }
    if (message.id !== undefined && message.method === undefined) {
      const id = Number(message.id);
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      if (pending.timer) clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(`DeepSeek ACP error ${message.error.code ?? ''}: ${message.error.message ?? 'request failed'}`));
      else pending.resolve(message.result);
      return;
    }
    if (message.method === 'session/update') { this.handleUpdate(message.params); return; }
    if (message.method === 'session/request_permission') { this.handlePermission(message); return; }
    if (message.id !== undefined && message.method) {
      try { this.send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Unsupported client method ${message.method}` } }); }
      catch { /* The process is already gone. */ }
    }
  }

  private handleUpdate(params: any): void {
    if (params?.sessionId !== this.session) return;
    const update = params.update;
    if (!update || typeof update !== 'object') return;
    if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
      this.push(this.session, { type: 'message', session: this.session, message: update.toolCallId, data: update });
    }
  }

  private handlePermission(message: JsonRpcMessage): void {
    const params = message.params ?? {};
    if (params.sessionId !== this.session || message.id === undefined) {
      try { this.send({ jsonrpc: '2.0', id: message.id, result: { outcome: { outcome: 'cancelled' } } }); } catch { /* ignore */ }
      return;
    }
    const requestId = String(message.id);
    const permission: Permission = { id: message.id, session: params.sessionId, options: Array.isArray(params.options) ? params.options : [] };
    this.permissions.set(requestId, permission);
    this.push(this.session, { type: 'permission', session: this.session, data: { permissionID: requestId, toolCall: params.toolCall, options: params.options } });
  }

  private cancelPermissions(): void {
    for (const [requestId, permission] of this.permissions) {
      try { this.send({ jsonrpc: '2.0', id: permission.id, result: { outcome: { outcome: 'cancelled' } } }); } catch { /* ignore */ }
      this.permissions.delete(requestId);
    }
  }

  private push(session: string, event: AdapterEvent): void {
    const stream = this.streams.get(session);
    if (!stream) return;
    stream.queue.push(event);
    for (const wake of stream.wake.splice(0)) wake();
  }

  private failPending(id: number, error: Error): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    if (pending.timer) clearTimeout(pending.timer);
    pending.reject(error);
  }

  private failAll(error: Error): void {
    for (const id of [...this.pending.keys()]) this.failPending(id, error);
  }

  private waitForSettlement(state: PromptState, timeoutMs: number): Promise<boolean> {
    if (state.settled) return Promise.resolve(true);
    return new Promise<boolean>(resolve => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      state.settleWaiters.push(() => { clearTimeout(timer); resolve(true); });
    });
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.exited = { code, signal };
    const message = `DeepSeek ACP process exited (${code ?? signal ?? 'unknown'})${this.diagnostics ? `: ${this.diagnostics.slice(-1000)}` : ''}`;
    this.failAll(new Error(message));
    for (const stream of this.streams.values()) {
      stream.failure = new Error(message);
      for (const wake of stream.wake.splice(0)) wake();
    }
  }

  private ownedChild(): ChildProcess | undefined { return this.child; }

  private pidAlive(pid: number): boolean {
    try { process.kill(pid, 0); return true; }
    catch (error: any) { return error.code === 'EPERM'; }
  }

  private async terminateChild(child: ChildProcess): Promise<boolean> {
    if (child.exitCode !== null || child.signalCode !== null) return true;
    return new Promise<boolean>(resolve => {
      let done = false;
      const finish = (value: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        child.removeListener('exit', onExit);
        child.removeListener('error', onError);
        resolve(value);
      };
      const onExit = () => finish(true);
      const onError = () => finish(false);
      const timer = setTimeout(() => finish(false), Math.min(this.stopTimeoutMs, 10_000));
      child.once('exit', onExit);
      child.once('error', onError);
      try { if (!child.kill()) finish(false); }
      catch { finish(false); }
    });
  }

  private reset(): void {
    this.lines?.close();
    this.lines = undefined;
    this.child = undefined;
    this.session = '';
    this.sessionClosed = false;
    this.profile = undefined;
    this.callback = undefined;
    this.configOptions = [];
    this.pending.clear();
    this.permissions.clear();
    this.streams.clear();
    this.prompts.clear();
    this.currentPrompt = undefined;
    this.exited = undefined;
    this.spawnFailure = undefined;
    this.diagnostics = '';
    this.submitted = 0;
    this.shipPrompt = '';
    this.closing = false;
  }
}
