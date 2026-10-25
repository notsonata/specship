import { mkdtemp, rm, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { shipUsage } from './accounting.mjs';

// Select numeric accounting fields only. Never export prompts, tools, or credentials.
export async function readShipUsage(database, { workspace = '/testbed', since = 0, model, reasoningIsSeparate } = {}) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=3000');
    const rows = db.prepare(`SELECT m.id, m.session_id,
      json_extract(m.data, '$.tokens') AS tokens, json_extract(m.data, '$.cost') AS cost,
      json_extract(m.data, '$.modelID') AS model, json_extract(m.data, '$.providerID') AS provider,
      json_extract(m.data, '$.time.completed') AS completed,
      json_type(m.data, '$.error') IS NOT NULL AND json_type(m.data, '$.error') != 'null' AS has_error
      FROM message m JOIN session s ON s.id=m.session_id
      WHERE s.directory=? AND s.time_created>=? AND json_extract(m.data, '$.role')='assistant'
      ORDER BY m.session_id, m.time_created, m.id`).all(workspace, since);
    if (!rows.length) throw Error('No Ship assistant usage records in the trial database');
    const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
    const messages = rows.map(row => {
      const tokens = row.tokens ? JSON.parse(row.tokens) : null;
      return { info: { id: row.id, sessionID: row.session_id, role: 'assistant', modelID: row.model, providerID: row.provider,
        tokens: tokens ? { input: count(tokens.input), output: count(tokens.output), reasoning: count(tokens.reasoning), cache: { read: count(tokens.cache?.read), write: count(tokens.cache?.write) } } : null,
        cost: typeof row.cost === 'number' && Number.isFinite(row.cost) && row.cost >= 0 ? row.cost : null },
        completed: count(row.completed), has_error: Boolean(row.has_error) };
    });
    const valid = messages.filter(message => shipUsage([{ messages: [message] }], { reasoningIsSeparate }) !== null);
    const observed = shipUsage([{ messages: valid }], { reasoningIsSeparate });
    const byModel = Object.fromEntries([...new Set(messages.map(message => `${message.info.providerID}/${message.info.modelID}`))].map(key => [key,
      shipUsage([{ messages: valid.filter(message => `${message.info.providerID}/${message.info.modelID}` === key) }], { reasoningIsSeparate })]));
    return { schema: 1, source: 'opencode_sqlite', sessions: [...new Set(rows.map(row => row.session_id))], messages,
      complete: valid.length === messages.length && messages.every(message => message.completed !== null && !message.has_error),
      observed, by_model: byModel, model_matches: model ? Object.keys(byModel).every(key => key === model) : null };
  } finally { db.close(); }
}

export function applyShipUsage(result, evidence) {
  result.ship_usage = evidence.complete ? evidence.observed : null;
  result.ship_usage_observed = evidence.observed;
  result.ship_usage_complete = evidence.complete;
  result.ship_usage_source = evidence.source;
  result.ship_usage_model_matches = evidence.model_matches;
  result.ship_usage_by_model = evidence.by_model;
}

// The controller calls this after stopping the container and before deleting it.
// SQLite's WAL must accompany the database; acknowledged usage may exist only there.
export async function recoverShipUsage(docker, container, options, command) {
  const root = await mkdtemp(join(tmpdir(), 'specship-usage-'));
  const database = join(root, 'opencode.db');
  try {
    await command(docker, ['cp', `${container}:/root/.local/share/opencode/opencode.db`, database], { capture: true });
    for (const suffix of ['-wal', '-shm']) {
      try { await command(docker, ['cp', `${container}:/root/.local/share/opencode/opencode.db${suffix}`, `${database}${suffix}`], { capture: true }); }
      catch (error) { if (!/could not find the file|no such file or directory/i.test(error.message)) throw error; }
    }
    return await readShipUsage(database, options);
  } finally {
    for (const suffix of ['-shm', '-wal', '']) await rm(`${database}${suffix}`, { force: true });
    await rmdir(root);
  }
}
