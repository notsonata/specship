import { randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isOpenCodeProfile, type NativePermissionAction, type OpenCodeProfile, type Profile } from '../contracts.js';
import type { AdapterEvent, ShipAdapter } from './types.js';
import { splitModel } from '../config.js';

type NativeMessage = { info: { id: string; role: string; parentID?: string; finish?: string; sessionID?: string }; parts?: Array<{ type: string; text?: string }> };
type QueuedStream = { controller: AbortController; queue: AdapterEvent[]; wake: Array<() => void>; ready: Promise<void>; setReady: () => void; failure?: Error };
export interface OpenCodeTestEndpoint { address: string; password: string; version?: string }

const explorePermission: Record<string, NativePermissionAction> = { '*': 'deny', read: 'allow', glob: 'allow', grep: 'allow', specship_callbacks_ask_spec: 'allow', specship_callbacks_report_result: 'allow' };

// Specship owns two rules: questions route to Spec, and subagents stay disabled. A profile
// may choose everything else (for example allowing `external_directory` in a disposable
// container) so an unattended run answers the prompt by configuration instead of blocking
// on a human who is not there. Exploration stays fully locked down.
export function shipPermissionPolicy(kind: 'explore' | 'implement' | 'correct', overrides?: Record<string, NativePermissionAction>): Record<string, NativePermissionAction> {
  if (kind === 'explore') return { ...explorePermission };
  return { ...(overrides ?? {}), question: 'deny', task: 'deny' };
}

function supportedVersion(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const identifier = '(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)';
  const match = new RegExp(`^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-(${identifier}(?:\\.${identifier})*))?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`).exec(value);
  if (!match) return false;
  const actual = match.slice(1, 4).map(Number);
  if (!actual.every(Number.isSafeInteger)) return false;
  const minimum = [1, 18, 30];
  for (let i = 0; i < minimum.length; i++) if (actual[i] !== minimum[i]) return actual[i]! > minimum[i]!;
  return match[4] === undefined;
}

export class OpenCodeAdapter implements ShipAdapter {
  readonly name = 'opencode';
  private child?: ChildProcess;
  private address = '';
  private password = '';
  private version = '';
  private profile?: OpenCodeProfile;
  private streams = new Map<string, QueuedStream>();
  private mediaTypes: string[] = [];
  private diagnostics = '';
  private restoredPid?:number;
  private workspace?:string;
  private activityKind:'explore'|'implement'|'correct'='implement';
  private stoppedSessions=new Set<string>();
  private permissionVersions=new Map<string,'v1'|'v2'>();

  constructor(private executable = process.env.OPENCODE_BIN ?? 'opencode', private stopTimeoutMs = 120_000, private testEndpoint?: OpenCodeTestEndpoint) {}

  async capabilities(profile: Profile): Promise<{ media: string[]; resume: boolean; inTurnDecision: boolean }> {
    if (!isOpenCodeProfile(profile)) throw new Error('OpenCode adapter requires an OpenCode profile');
    return { media: ['image/png', 'image/jpeg'], resume: true, inTurnDecision: true };
  }

  async validate(profile: Profile, media: string[]): Promise<void> {
    if (!isOpenCodeProfile(profile)) throw new Error('OpenCode adapter requires an OpenCode profile');
    if (Object.keys(profile.options).some(key => !['variant','shell','permission'].includes(key))) throw new Error('OpenCode profile has unsupported options');
    if(profile.options.shell&&(typeof profile.options.shell!=='string'||!isAbsolute(profile.options.shell)))throw new Error('OpenCode shell must be an absolute executable path');
    for(const [name,action] of Object.entries(profile.options.permission??{})){if(!['allow','ask','deny'].includes(action))throw new Error(`OpenCode permission for '${name}' must be allow, ask, or deny`);}
    if (media.some(type => type !== 'image/png' && type !== 'image/jpeg')) throw new Error('OpenCode media support is verified only for PNG/JPEG images');
    if (profile.model !== 'default') splitModel(profile.model);
    if (profile.executable) {
      if (!isAbsolute(profile.executable)) throw new Error('OpenCode executable must be an absolute path');
      if (!process.env.OPENCODE_BIN) this.executable = profile.executable;
    } else if (!process.env.OPENCODE_BIN && !this.testEndpoint && this.executable === 'opencode') {
      throw new Error('Configure the exact OpenCode executable path in the selected Ship profile');
    }
    this.mediaTypes = [...media];
  }

  private async availablePort(): Promise<number> {
    const server = createServer();
    await new Promise<void>((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
    const port = (server.address() as { port: number }).port;
    await new Promise<void>(resolve => server.close(() => resolve()));
    return port;
  }

  private authHeaders(): Record<string, string> {
    return { authorization: `Basic ${Buffer.from(`opencode:${this.password}`).toString('base64')}` };
  }

  private async request(path: string, body?: unknown, timeoutMs = 15_000): Promise<any> {
    const response = await fetch(`${this.address}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...this.authHeaders(), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
    });
    let text = '';
    if (response.body) {
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 8_000_000) { await reader.cancel(); throw new Error(`OpenCode response exceeded 8 MB: ${path}`); }
        chunks.push(value);
      }
      text = new TextDecoder().decode(Buffer.concat(chunks));
    }
    if (!response.ok) throw new Error(`OpenCode ${path}: HTTP ${response.status} ${text.slice(0, 500)}`);
    return text ? JSON.parse(text) : null;
  }

  private async startServer(workspace: string, profile: OpenCodeProfile, kind: 'explore' | 'implement' | 'correct', callback: { url: string; capability: string; descriptorPath?:string;timeoutMs?:number }): Promise<void> {
    this.workspace=workspace;this.activityKind=kind;
    const port = await this.availablePort();
    this.password = randomBytes(32).toString('hex');
    const explicitModel = profile.model === 'default' ? undefined : splitModel(profile.model);
    const callbackCli = fileURLToPath(new URL('../callback-cli.js', import.meta.url));
    const skill=await readFile(fileURLToPath(new URL('../../.agents/skills/ship/SKILL.md',import.meta.url)),'utf8');
    const shipPrompt=skill.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/,'')+`\nThis is a runner-associated assignment. Callback tools ask_spec and report_result are available. Submit the structured result through report_result before finishing. Routine command/path failures should be investigated within scope; a Node runtime is available at ${JSON.stringify(process.execPath)} if node is missing from PATH. PowerShell requires the & call operator before a quoted executable path.\n`;
    const config = {
      ...(profile.options.shell?{shell:profile.options.shell}:{}),
      agent: {
        specship_ship: {
          description: 'Specship implementation agent', mode: 'primary', ...(explicitModel ? { model: profile.model } : {}),
          ...(profile.options.variant ? { variant: profile.options.variant } : {}),
          permission:shipPermissionPolicy(kind,profile.options.permission), prompt: shipPrompt,
        },
      },
      ...(explicitModel ? {
        provider: { [explicitModel[0]]: { models: { [explicitModel[1]]: { options: profile.options.variant ? { reasoningEffort: profile.options.variant } : {} } } } },
      } : {}),
      mcp: { specship_callbacks: {
        type: 'local', enabled: true, ...(callback.timeoutMs?{timeout:callback.timeoutMs}:{}), command: [process.execPath, callbackCli],
        environment: callback.descriptorPath ? { SPECSHIP_CALLBACK_DESCRIPTOR: callback.descriptorPath } : { SPECSHIP_CALLBACK_URL: callback.url, SPECSHIP_CALLBACK_CAPABILITY: callback.capability },
      } },
    };
    const environment={...process.env};
    for(const key of Object.keys(environment))if(key.toLowerCase()==='path')delete environment[key];
    environment[process.platform==='win32'?'Path':'PATH']=`${dirname(process.execPath)}${delimiter}${process.env.PATH??process.env.Path??''}`;
    this.child = spawn(this.executable, ['serve', '--hostname', '127.0.0.1', '--port', String(port)], {
      cwd: workspace, windowsHide: true,
      env: { ...environment, OPENCODE_CONFIG_CONTENT: JSON.stringify(config), OPENCODE_SERVER_PASSWORD: this.password },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';let startupError:Error|undefined;
    this.child.once('error',error=>{startupError=error;});
    this.child.stdout?.on('data', chunk => { stdout = (stdout + chunk.toString()).slice(-16_000); });
    this.child.stderr?.on('data', chunk => { this.diagnostics = (this.diagnostics + chunk.toString()).slice(-8_000); });
    const until = Date.now() + 20_000;
    while (Date.now() < until) {
      if(startupError)throw startupError;
      if (this.child.exitCode !== null) throw new Error(`OpenCode server exited (${this.child.exitCode}): ${this.diagnostics.slice(-1000)}`);
      const match = stdout.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { this.address = match[0]; break; }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (!this.address) throw new Error(`OpenCode server startup timed out: ${this.diagnostics.slice(-1000)}`);
  }

  private async validateLiveProfile(profile: OpenCodeProfile): Promise<void> {
    const health = await this.request('/global/health');
    if (!supportedVersion(health?.version)) throw new Error(`Unsupported OpenCode version ${health?.version}; requires 1.18.30 or newer`);
    this.version = health.version;
    const providers = await this.request('/provider');
    const [providerID, modelID] = splitModel(profile.model);
    if (!providerID || !modelID) throw new Error('Profile model must be provider/model');
    const selected = providers.all?.find((item: any) => item.id === providerID)?.models?.[modelID];
    if (!selected) throw new Error(`OpenCode model unavailable: ${profile.model}`);
    if (this.mediaTypes.length && !selected.capabilities?.input?.image) throw new Error(`Selected model does not support image input: ${profile.model}`);
    const variant = profile.options.variant;
    if (variant && selected.variants?.[variant]?.reasoningEffort !== variant) throw new Error(`OpenCode variant ${variant} unavailable or unresolved for ${profile.model}`);
    this.profile = profile;
  }

  private async defaultModel(): Promise<string> {
    const config = await this.request('/config');
    if (config.model !== undefined) {
      if (typeof config.model !== 'string') throw new Error('OpenCode default model must be provider/model');
      splitModel(config.model);
      return config.model;
    }
    // Match OpenCode's Provider.defaultModel: configured model, valid recent
    // model, then the first configured/connected provider's preferred model.
    const available = await this.request('/config/providers');
    if (!Array.isArray(available.providers)) throw new Error('OpenCode did not return connected providers for default model selection');
    const paths = await this.request('/path');
    if (typeof paths.state !== 'string' || !isAbsolute(paths.state)) throw new Error('OpenCode did not return an absolute state directory for default model selection');
    let recent: unknown;
    try { recent = JSON.parse(await readFile(join(paths.state, 'model.json'), 'utf8')).recent; }
    catch { /* OpenCode also ignores missing or unreadable recent-model state. */ }
    for (const entry of Array.isArray(recent) ? recent : []) {
      if (typeof entry?.providerID !== 'string' || typeof entry?.modelID !== 'string') continue;
      if (available.providers.some((provider: any) => provider.id === entry.providerID && Object.hasOwn(provider.models ?? {}, entry.modelID))) return `${entry.providerID}/${entry.modelID}`;
    }
    const configured = Object.keys(config.provider ?? {});
    const provider = available.providers.find((item: any) => !configured.length || configured.includes(item.id));
    const model = provider && available.default?.[provider.id];
    if (typeof model !== 'string' || !Object.hasOwn(provider.models ?? {}, model)) throw new Error('OpenCode has no available default model; configure a model in OpenCode or select an explicit Specship model');
    return `${provider.id}/${model}`;
  }

  async start(workspace: string, profile: Profile, kind: 'explore' | 'implement' | 'correct', callback: { url: string; capability: string; descriptorPath?:string;timeoutMs?:number }): Promise<{ session: string; version: string; profile?: OpenCodeProfile }> {
    if (!isOpenCodeProfile(profile)) throw new Error('OpenCode adapter requires an OpenCode profile');
    const alreadyOwned = Boolean(this.child);
    try {
      if (!this.child && this.testEndpoint) {
        this.address = this.testEndpoint.address;
        this.password = this.testEndpoint.password;
      } else if (!this.child) await this.startServer(workspace, profile, kind, callback);
      const resolved = profile.model === 'default' ? { ...profile, model: this.profile?.model ?? await this.defaultModel() } : profile;
      if (alreadyOwned && JSON.stringify(this.profile) !== JSON.stringify(resolved)) throw new Error('A running OpenCode server cannot change the pinned Ship profile');
      if (!this.profile || JSON.stringify(this.profile) !== JSON.stringify(resolved)) await this.validateLiveProfile(resolved);
      const session = await this.request('/session', { title: `Specship ${kind}` });
      return { session: session.id, version: this.version, profile: this.profile };
    } catch (error) {
      if (!alreadyOwned) {
        const child = this.child;
        if (child && !await this.terminateChild(child)) throw new Error(`OpenCode startup failed and server termination is unconfirmed (PID ${child.pid ?? 'unknown'})`, { cause: error });
        this.child = undefined;
        this.address = '';
        this.password = '';
        this.profile = undefined;
      }
      throw error;
    }
  }

  async subscribe(session: string, signal: AbortSignal): Promise<void> {
    const controller = new AbortController();
    let setReady!: () => void;
    const ready = new Promise<void>(resolve => { setReady = resolve; });
    const stream: QueuedStream = { controller, queue: [], wake: [], ready, setReady };
    this.streams.set(session, stream);
    signal.addEventListener('abort', () => {
      controller.abort();
      for (const wake of stream.wake.splice(0)) wake();
    }, { once: true });
    void this.readEvents(session, stream).catch(error => {
      stream.failure = error instanceof Error ? error : new Error(String(error));
      stream.setReady();
      for (const wake of stream.wake.splice(0)) wake();
    });
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([ready, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('OpenCode SSE subscription timed out')), 10_000); })]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private async readEvents(session: string, stream: QueuedStream): Promise<void> {
    const response = await fetch(`${this.address}/event`, { headers: this.authHeaders(), redirect: 'error', signal: stream.controller.signal });
    if (!response.ok || !response.body) throw new Error(`OpenCode SSE failed: HTTP ${response.status}`);
    stream.setReady();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (!stream.controller.signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > 1_000_000) throw new Error('OpenCode SSE event exceeded 1 MB');
      const chunks = buffer.split(/\r?\n\r?\n/);
      buffer = chunks.pop() ?? '';
      for (const chunk of chunks) {
        const data = chunk.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
        if (!data) continue;
        let event: any;
        try { event = JSON.parse(data); } catch { continue; }
        const properties = event.properties ?? {};
        const info = properties.info ?? {};
        const eventSession = info.sessionID ?? properties.sessionID ?? properties.status?.sessionID;
        if (eventSession && eventSession !== session) continue;
        let normalized: AdapterEvent | undefined;
        if (event.type === 'permission.asked'||event.type==='permission.v2.asked') {
          if(typeof properties.id==='string')this.permissionVersions.set(properties.id,event.type==='permission.v2.asked'?'v2':'v1');
          normalized = { type: 'permission', session, data: properties };
        }
        else if (event.type === 'session.error') normalized = { type: 'error', session, data: properties };
        else if (event.type === 'session.status' && properties.status?.type === 'idle') normalized = { type: 'idle', session, data: properties.status };
        else if (event.type === 'message.updated' && info.role === 'assistant') normalized = { type: 'message', session, message: info.id, data: info };
        if (normalized) { stream.queue.push(normalized); for (const wake of stream.wake.splice(0)) wake(); }
      }
    }
    if(!stream.controller.signal.aborted)throw new Error('OpenCode event stream disconnected');
  }

  async *events(session: string, signal: AbortSignal): AsyncIterable<AdapterEvent> {
    const stream = this.streams.get(session);
    if (!stream) throw new Error('Subscribe to OpenCode events before submitting');
    while (!signal.aborted) {
      const event = stream.queue.shift();
      if (event) { yield event; continue; }
      if (stream.failure) throw stream.failure;
      await new Promise<void>(resolve => stream.wake.push(resolve));
    }
  }

  private async messages(session: string): Promise<NativeMessage[]> {
    return this.request(`/session/${encodeURIComponent(session)}/message`);
  }

  private messageText(message: NativeMessage): string {
    return (message.parts ?? []).filter(part => part.type === 'text').map(part => part.text ?? '').join('\n');
  }

  private async findUserMessage(session: string, operationId: string): Promise<NativeMessage | undefined> {
    const marker = `\n[specship-operation:${operationId}]`;
    const messages = await this.messages(session);
    return messages.find(message => message.info?.role === 'user' && this.messageText(message).includes(marker));
  }

  private async waitForUserMessage(session: string, operationId: string): Promise<NativeMessage | undefined> {
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      const message = await this.findUserMessage(session, operationId);
      if (message) return message;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return undefined;
  }

  async submit(session: string, operationId: string, prompt: string, artifacts: Array<{ mime: string; name: string; data: Buffer }>): Promise<{ messageId: string }> {
    if (!this.streams.has(session)) throw new Error('OpenCode SSE subscription must be active before submit');
    this.stoppedSessions.delete(session);
    const marker = `\n[specship-operation:${operationId}]`;
    const [providerID, modelID] = splitModel(this.profile!.model);
    const body = {
      agent: 'specship_ship', model: { providerID, modelID },
      ...(this.profile!.options.variant ? { variant: this.profile!.options.variant } : {}),
      parts: [{ type: 'text', text: `${prompt}${marker}` }, ...artifacts.map(a => ({ type: 'file', mime: a.mime, filename: a.name, url: `data:${a.mime};base64,${a.data.toString('base64')}` }))],
    };
    try {
      await this.request(`/session/${encodeURIComponent(session)}/prompt_async`, body, 10_000);
    } catch (error) {
      // A failed response can follow successful delivery. Reconcile the marker exactly; never replay it.
      const delivered = await this.waitForUserMessage(session, operationId).catch(() => undefined);
      if (delivered) return { messageId: delivered.info.id };
      throw new Error(`Ambiguous OpenCode submission for operation ${operationId}; no replay attempted: ${String(error)}`);
    }
    const message = await this.waitForUserMessage(session, operationId);
    if (!message?.info?.id) throw new Error(`OpenCode accepted ${operationId}, but its native user message is not yet reconcilable; no replay attempted`);
    return { messageId: message.info.id };
  }

  private async isIdle(session: string): Promise<boolean> {
    const exactSession = await this.request(`/session/${encodeURIComponent(session)}`);
    if (!exactSession?.id || exactSession.id !== session) throw new Error('OpenCode session identity could not be verified');
    const status = await this.request('/session/status');
    return status?.[session] === undefined || status[session]?.type === 'idle';
  }

  async reconcile(session: string, userMessageId: string): Promise<'active' | 'complete' | 'unknown'> {
    const messages = await this.messages(session);
    const parent = messages.find(message => message.info?.id === userMessageId && message.info.role === 'user');
    if (!parent) return 'unknown';
    if(this.stoppedSessions.has(session)&&await this.isIdle(session))return 'complete';
    const assistant = messages.filter(message => message.info?.role === 'assistant' && message.info.parentID === userMessageId).at(-1);
    if (!assistant || !assistant.info.finish || assistant.info.finish === 'tool-calls') return 'active';
    return await this.isIdle(session) ? 'complete' : 'active';
  }

  async abort(session: string): Promise<boolean> {
    try { await this.request(`/session/${encodeURIComponent(session)}/abort`, {}); }
    catch {
      // A session the server no longer tracks is stopped, not stuck; any other failure is unknown.
      if (!await this.isIdle(session).catch(() => false)) return false;
      this.stoppedSessions.add(session);
      return true;
    }
    const deadline = Date.now() + this.stopTimeoutMs;
    while (Date.now() < deadline) {
      if (await this.isIdle(session)) {this.stoppedSessions.add(session);return true;}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return false;
  }

  async reply(session: string, operationId:string, answer: string, artifacts: Array<{ mime: string; name: string; data: Buffer }>): Promise<void> {
    await this.submit(session, operationId, answer, artifacts);
  }

  async resolvePermission(session: string, requestId: string, decision: 'once' | 'always' | 'reject'): Promise<void> {
    let version=this.permissionVersions.get(requestId);
    if(!version){
      const pending=await this.request(`/api/session/${encodeURIComponent(session)}/permission/${encodeURIComponent(requestId)}`).catch(()=>undefined);
      if(pending?.data?.id===requestId)version='v2';
      else{const legacy=await this.request('/permission');if(!legacy.some((item:any)=>item.id===requestId&&item.sessionID===session))throw new Error('Exact native permission is no longer pending; no approval was replayed');version='v1';}
    }
    await this.request(version==='v2'?`/api/session/${encodeURIComponent(session)}/permission/${encodeURIComponent(requestId)}/reply`:`/permission/${encodeURIComponent(requestId)}/reply`, { reply: decision });
    this.permissionVersions.delete(requestId);
  }

  async snapshot(session:string):Promise<unknown>{return {address:this.address,password:this.password,version:this.version,profile:this.profile,session,pid:this.child?.pid,workspace:this.workspace,kind:this.activityKind};}
  async restore(snapshot:unknown,callback:{url:string;capability:string;descriptorPath?:string;timeoutMs?:number}):Promise<{session:string;version:string}>{
    const value=snapshot as any;const url=new URL(value.address);
    if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.pathname!=='/'||url.username||url.password||url.search||url.hash||!value.password||!value.profile||!value.session)throw new Error('Invalid private OpenCode reconnect snapshot');
    this.address=url.origin;this.password=value.password;this.version=value.version;this.profile=value.profile;
    this.workspace=value.workspace;this.activityKind=value.kind??'implement';
    this.restoredPid=Number.isInteger(value.pid)?value.pid:undefined;
    let health;
    try{health=await this.request('/global/health',undefined,3000);}
    catch(error){
      // A dead server can be relaunched against OpenCode's durable native session store.
      // A live but unreachable process remains ambiguous and must never be replaced.
      if(this.restoredPid){try{process.kill(this.restoredPid,0);throw new Error('Saved OpenCode process is still alive but cannot be authenticated; stop is unconfirmed');}catch(probe:any){if(probe.code!=='ESRCH')throw probe;}}
      if(!this.workspace||!isAbsolute(this.workspace))throw new Error('Saved OpenCode endpoint is unavailable and has no verified workspace for recovery');
      await this.validate(value.profile,[]);this.address='';this.restoredPid=undefined;
      await this.startServer(this.workspace,value.profile,this.activityKind,callback);
      health=await this.request('/global/health');
    }
    if(health.version!==value.version)throw new Error('Saved OpenCode server version changed');
    const session=await this.request(`/session/${encodeURIComponent(value.session)}`);
    if(session?.id!==value.session)throw new Error('Saved OpenCode session is unavailable');
    return {session:value.session,version:value.version};
  }
  async reconcileOperation(session:string,operationId:string):Promise<{messageId:string;status:'active'|'complete'|'unknown'}>{const user=await this.findUserMessage(session,operationId);if(!user)return {messageId:'',status:'unknown'};const status=await this.reconcile(session,user.info.id);return {messageId:user.info.id,status};}

  private async terminateChild(child: ChildProcess): Promise<boolean> {
    if (child.exitCode !== null || child.signalCode !== null) return true;
    return new Promise<boolean>(resolve => {
      const finish = (confirmed: boolean) => {
        clearTimeout(timer);
        child.removeListener('exit', onExit);
        child.removeListener('error', onError);
        resolve(confirmed);
      };
      const onExit = () => finish(true);
      const onError = () => finish(false);
      const timer = setTimeout(() => finish(false), Math.min(this.stopTimeoutMs, 10_000));
      child.once('exit', onExit);
      child.once('error', onError);
      // A refused signal usually means the process already exited; only a real exit confirms it.
      try { if (!child.kill()) finish(child.exitCode !== null || child.signalCode !== null); }
      catch { finish(child.exitCode !== null || child.signalCode !== null); }
    });
  }

  async close(session: string): Promise<boolean> {
    const stopped = await this.abort(session);
    if (!stopped) return false;
    for (const [key, stream] of this.streams) { if (key === session) { stream.controller.abort(); this.streams.delete(key); } }
    const child = this.child;
    if (child) {
      // Keep the process and endpoint available for an explicit cleanup retry.
      if (!await this.terminateChild(child)) return false;
    } else if(this.restoredPid&&this.restoredPid!==process.pid){
      try{process.kill(this.restoredPid,'SIGTERM');}catch(error:any){if(error.code!=='ESRCH')return false;}
      const deadline=Date.now()+10_000;
      while(Date.now()<deadline){try{process.kill(this.restoredPid,0);}catch(error:any){if(error.code==='ESRCH'){this.restoredPid=undefined;break;}return false;}await new Promise(resolve=>setTimeout(resolve,100));}
      if(this.restoredPid)return false;
    }
    this.child = undefined; this.restoredPid=undefined;this.address = ''; this.password = '';this.profile=undefined;
    return true;
  }
}
