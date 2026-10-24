import { OpenCodeAdapter } from '../../dist/adapters/opencode.js';

// Resolves the real server catalog and selected variant, but never submits a prompt.
export async function checkShipProfile(workspace, profile, adapter = new OpenCodeAdapter()) {
  await adapter.validate(profile, []);
  const { session, version } = await adapter.start(workspace, profile, 'implement', { url: 'http://127.0.0.1:1', capability: 'unused-preflight' });
  if (!await adapter.close(session)) throw Error('Ship profile preflight could not confirm server cleanup');
  return { model: profile.model, effort: profile.options.variant ?? null, version, model_calls: 0 };
}
