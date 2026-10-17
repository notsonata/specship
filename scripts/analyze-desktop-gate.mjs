import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeEvidence, analyzeInterruptedEvidence, readSessionTelemetry } from './compatibility-evidence.mjs';

const [threadId, probeId = 'desktop-gate', auditArgument] = process.argv.slice(2);
if (!threadId) throw new Error('Usage: node scripts/analyze-desktop-gate.mjs <exact-thread-id> [probe-id] [audit-path]');
const root = fileURLToPath(new URL('../', import.meta.url));
const auditPath = resolve(auditArgument ?? join(root, '.specship/compatibility/desktop/mcp-audit.jsonl'));
const allAudit = readFileSync(auditPath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const start = allAudit.findLast((record) => record.kind === 'wait_started' && record.probe_id === probeId);
if (!start?.server_id) throw new Error('No matching desktop probe server');
const audit = allAudit.filter((record) => record.server_id === start.server_id);
const telemetry = readSessionTelemetry(threadId);
const interrupted = audit.some((record) => record.kind === 'wait_interrupted' && record.request_id === start.request_id);
const summary = interrupted ? analyzeInterruptedEvidence({ audit, telemetry, threadId, probeId })
  : analyzeEvidence({ host: 'desktop', audit, telemetry, delayMs: start.delay_ms });
summary.thread_id = threadId;
summary.probe_id = probeId;
summary.server_id = start.server_id;
const output = resolve(auditPath, '..');
writeFileSync(join(output, interrupted ? 'interrupt-telemetry.json' : 'telemetry.json'), `${JSON.stringify(telemetry, null, 2)}\n`);
writeFileSync(join(output, interrupted ? 'interrupt-summary.json' : 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
process.exitCode = summary.status === 'passed' ? 0 : 1;
