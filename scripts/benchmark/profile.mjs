import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { OpenCodeAdapter } from '../../dist/adapters/opencode.js';
import { DeepSeekAdapter } from '../../dist/adapters/deepseek.js';

// Resolves the real server catalog and selected variant, but never submits a prompt.
export async function checkShipProfile(workspace, profile, adapter = new OpenCodeAdapter()) {
  await adapter.validate(profile, []);
  const { session, version } = await adapter.start(workspace, profile, 'implement', { url: 'http://127.0.0.1:1', capability: 'unused-preflight' });
  if (!await adapter.close(session)) throw Error('Ship profile preflight could not confirm server cleanup');
  return { model: profile.model, effort: profile.options.variant ?? null, version, model_calls: 0 };
}

// Starts the real DSH ACP session and resolves its model catalog; no prompt is sent.
export async function checkDshProfile(workspace, profile, adapter = new DeepSeekAdapter()) {
  await adapter.validate(profile, []);
  const descriptorPath = join(tmpdir(), `specship-benchmark-callback-${process.pid}.json`);
  await writeFile(descriptorPath, JSON.stringify({ url: 'http://127.0.0.1:1', capability: 'unused-preflight', deadline: null, delivery_margin_ms: 1, callback_timeout_ms: null }), { mode: 0o600 });
  const { session, version } = await adapter.start(workspace, profile, 'implement', { url: 'http://127.0.0.1:1', capability: 'unused-preflight', descriptorPath });
  if (!await adapter.close(session)) throw Error('DSH profile preflight could not confirm session cleanup');
  return { model: profile.model, effort: profile.options.reasoning_effort ?? null, version, model_calls: 0 };
}
