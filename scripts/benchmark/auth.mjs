import { readFile } from 'node:fs/promises';

export function subscriptionCredential(role, data) {
  if (role === 'codex' && data?.auth_mode === 'chatgpt' && typeof data.tokens?.access_token === 'string' && data.tokens.access_token) {
    const { OPENAI_API_KEY, ...subscription } = data;
    return subscription;
  }
  if (role === 'opencode' && data?.openai?.type === 'oauth' && typeof data.openai.access === 'string' && data.openai.access) return { openai: data.openai };
  throw Error(`Saved ${role} authentication is not a subscription login; API fallback is disabled`);
}

export function subscriptionEnvironment(env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !/(?:API_KEY|AUTH_TOKEN|ACCESS_TOKEN)$/i.test(key)));
}

export async function checkSubscriptions(config, selectedArms) {
  for (const role of ['codex', 'opencode']) {
    if (!selectedArms.some(arm => role === 'codex' ? arm !== 'ship' : arm !== 'codex')) continue;
    const file = config.auth?.[`${role}_file`];
    if (!file) throw Error(`Set auth.${role}_file for subscription authentication`);
    let data;
    try { data = JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, '')); }
    catch { throw Error(`Cannot read saved ${role} subscription authentication`); }
    subscriptionCredential(role, data);
  }
  if (selectedArms.some(arm => arm !== 'codex') && !config.ship.model?.startsWith('openai/')) throw Error('Saved OpenAI subscription authentication requires an openai/ Ship model');
}
