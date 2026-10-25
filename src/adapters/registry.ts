import type { Profile } from '../contracts.js';
import type { AdapterEvent, ShipAdapter } from './types.js';

/**
 * Routes one runner through the adapters named by each Ship profile.
 *
 * The runner historically owned one harness for its whole lifetime. Profiles can
 * now name different harnesses, so this boundary keeps session ownership here
 * and preserves the single-adapter Runner contract.
 */
export class HarnessRegistry implements ShipAdapter {
  readonly name = 'registry';
  private owners = new Map<string, ShipAdapter>();
  constructor(private adapters: Record<string, ShipAdapter>) {}

  private adapterFor(profile: Profile): ShipAdapter {
    const adapter = this.adapters[profile.harness];
    if (!adapter) throw new Error(`Unsupported Ship harness '${profile.harness}'`);
    return adapter;
  }

  private owner(session: string): ShipAdapter {
    const adapter = this.owners.get(session);
    if (!adapter) throw new Error('The native session is not owned by an attached harness adapter');
    return adapter;
  }

  async capabilities(profile: Profile) {
    const adapter = this.adapterFor(profile);
    if (!adapter.capabilities) throw new Error(`Harness '${adapter.name}' does not declare capabilities`);
    return await adapter.capabilities(profile);
  }

  async validate(profile: Profile, media: string[]): Promise<void> { await this.adapterFor(profile).validate(profile, media); }

  async start(workspace: string, profile: Profile, kind: 'explore' | 'implement' | 'correct', callback: { url: string; capability: string; descriptorPath?: string; timeoutMs?: number }): Promise<{ session: string; version: string; profile?: Profile }> {
    const adapter = this.adapterFor(profile);
    const started = await adapter.start(workspace, profile, kind, callback);
    this.owners.set(started.session, adapter);
    return started;
  }

  async subscribe(session: string, signal: AbortSignal): Promise<void> { await this.owner(session).subscribe(session, signal); }
  async submit(session: string, operationId: string, prompt: string, artifacts: Array<{ mime: string; name: string; data: Buffer }>): Promise<{ messageId: string }> { return await this.owner(session).submit(session, operationId, prompt, artifacts); }
  events(session: string, signal: AbortSignal): AsyncIterable<AdapterEvent> { return this.owner(session).events(session, signal); }
  async reconcile(session: string, messageId: string): Promise<'active' | 'complete' | 'unknown'> { return await this.owner(session).reconcile(session, messageId); }
  async abort(session: string): Promise<boolean> { return await this.owner(session).abort(session); }
  async reply(session: string, operationId: string, answer: string, artifacts: Array<{ mime: string; name: string; data: Buffer }>): Promise<void> { await this.owner(session).reply(session, operationId, answer, artifacts); }

  async resolvePermission(session: string, requestId: string, decision: 'once' | 'always' | 'reject'): Promise<void> {
    const adapter = this.owner(session);
    if (!adapter.resolvePermission) throw new Error('Selected harness cannot resolve a native permission');
    await adapter.resolvePermission(session, requestId, decision);
  }

  async snapshot(session: string): Promise<unknown> {
    const adapter = this.owner(session);
    if (!adapter.snapshot) throw new Error('Selected harness cannot snapshot native execution');
    return { ...(await adapter.snapshot(session) as Record<string, unknown>), harness: adapter.name };
  }

  async restore(snapshot: unknown, callback: { url: string; capability: string; descriptorPath?: string; timeoutMs?: number }): Promise<{ session: string; version: string }> {
    const value = snapshot as { harness?: string };
    const harness = value?.harness ?? 'opencode';
    const adapter = this.adapters[harness];
    if (!adapter) throw new Error(`Saved harness '${harness}' is not configured`);
    if (!adapter.restore) throw new Error('Selected harness cannot restore native execution');
    const restored = await adapter.restore(snapshot, callback);
    this.owners.set(restored.session, adapter);
    return restored;
  }

  async close(session: string): Promise<boolean> {
    const adapter = this.owner(session);
    const closed = adapter.close ? await adapter.close(session) : await adapter.abort(session);
    if (closed) this.owners.delete(session);
    return closed;
  }

  async reconcileOperation(session: string, operationId: string): Promise<{ messageId: string; status: 'active' | 'complete' | 'unknown' }> {
    const adapter = this.owner(session);
    if (!adapter.reconcileOperation) throw new Error('Selected harness cannot reconcile a native operation');
    return await adapter.reconcileOperation(session, operationId);
  }
}
