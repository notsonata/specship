import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, '.specship', 'compatibility', 'desktop');
mkdirSync(output, { recursive: true });
const fixture = resolve(root, 'test/fixtures/blocking-mcp.mjs');
const audit = join(output, 'mcp-audit.jsonl');
const interrupt = join(output, 'interrupt.json');
const hookPaths = [process.execPath, resolve(root, 'test/fixtures/interrupt-hook.mjs'), interrupt].map((path) => path.replaceAll('\\', '/'));
// This local test's paths contain no shell metacharacters or spaces. Refuse to
// invent portable shell escaping for a different installation.
if (hookPaths.some((path) => !/^[A-Za-z0-9_:/.\-]+$/.test(path))) throw new Error('Generate a shell-quoted hook command for these paths manually');
const interruptHook = { hooks: { Interrupt: [{ hooks: [{ type: 'command', command: hookPaths.join(' '), timeout: 3 }] }] } };
// Generates a snippet only. Registering it must preserve any existing project
// configuration and direct-tool namespace entries.
const config = `[features.code_mode]
direct_only_tool_namespaces = ["mcp__specship_gate"]

[mcp_servers.specship_gate]
command = ${JSON.stringify(process.execPath)}
args = [${JSON.stringify(fixture)}]
tool_timeout_sec = 250

[mcp_servers.specship_gate.env]
SPECSHIP_GATE_DELAY_MS = "130000"
SPECSHIP_GATE_AUDIT = ${JSON.stringify(audit)}
SPECSHIP_GATE_INTERRUPT_FILE = ${JSON.stringify(interrupt)}
`;
const destination = join(output, 'config.toml');
writeFileSync(destination, config);
writeFileSync(join(output, 'hooks.json'), `${JSON.stringify(interruptHook, null, 2)}\n`);
writeFileSync(join(output, 'prompt.txt'), 'Call the specship_gate gate_wait tool directly exactly once with probe_id "desktop-gate". Wait for the result without polling, other work, or commentary. After receiving gate_released, output exactly GATE_OK.\n');
console.log(`Desktop configuration snippet: ${destination}`);
console.log(`Probe prompt: ${join(output, 'prompt.txt')}`);
console.log(`Interrupt hook for explicit Codex trust review: ${join(output, 'hooks.json')}`);
console.log('No Codex configuration was modified. Load this MCP server in the app before running the probe.');
