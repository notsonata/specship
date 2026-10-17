# Specship

Plan in your Codex chat. Let a configured workhorse implement. Review the evidence and ship.

Specship has two skills and a local MCP runner:

- **Spec** plans with you, delegates exploration, decides consequential blockers, and independently accepts the result.
- **Ship** implements a compact brief, handles routine debugging and testing, and reports evidence.
- **The runner** launches the Ship harness, delivers callbacks to the same Codex conversation, and stores enough state to stop and recover safely.

Spec is whichever model you invoke `$spec` on. There is no separate Spec model setting or runner chat interface. OpenCode is the first Ship adapter; named profiles select its provider/model and reasoning variant. Further harnesses use the adapter contract after passing the same checks.

**Status:** redesign preview. Tested on Windows with Node 24.19.0, Codex 0.162.0-alpha.17.2, and OpenCode 1.18.30. Portability fixes and macOS setup instructions are included; native macOS execution and live Codex/OpenCode integration on macOS remain unverified.

## Setup

Clone this repository, install the locked dependencies, and build:

```powershell
npm ci
npm run build
```

Node 22 or newer is required; Node 24 is the tested runtime. Install OpenCode separately and authenticate through OpenCode's normal interface. Specship uses that authentication; it does not store provider keys or manage model sign-in.

### Windows

Generate setup for your target repository, choosing explicit limits and the actual OpenCode executable:

```powershell
node dist/cli.js setup --workspace C:\Projects\my-app --profile luna --model openai/gpt-6-luna --variant high --executable C:\path\to\opencode.exe --shell C:\Windows\System32\cmd.exe --max-dispatch-seconds 240 --delivery-margin-seconds 120
```

### macOS (live verification pending)

Use the same checkout and build commands on the Mac, with Node/npm, Git, and the pinned OpenCode 1.18.30 installed. Authenticate using OpenCode's normal interface. Run setup in a terminal on that Mac so it records the local Node and OpenCode executable paths:

```sh
cd "/path/to/specship"
npm ci
npm run build

node dist/cli.js setup \
  --workspace "/Users/you/Projects/my-app" \
  --profile luna \
  --model openai/gpt-6-luna \
  --variant high \
  --executable "$(command -v opencode)" \
  --shell /bin/sh \
  --max-dispatch-seconds 240 \
  --delivery-margin-seconds 120
```

`command -v opencode` must resolve to the absolute installed executable; supply that path directly if your terminal uses an alias or function. The example explicitly selects `/bin/sh` for Ship. You can choose another absolute shell executable or omit `--shell` to preserve OpenCode's configured shell. The example limits are configurable, not built-in defaults.

### Register with Codex (both platforms)

This creates `.specship/config.json` in the target repository and prints reviewable `codex_toml` and `hooks_json` registrations. It preserves existing configuration and does not change Codex settings or trust hooks automatically. Existing setup arguments must match the selected profile and limits; edit your configuration explicitly to change them.

Use the output generated on each machine rather than copying Windows paths or its PowerShell hook onto a Mac. On macOS setup emits a POSIX command with each argument quoted, including paths containing spaces or apostrophes; Windows retains its encoded PowerShell launcher. The MCP namespace and timeout settings are the same.

Merge the printed MCP registration into the target repository's `.codex/config.toml`. Preserve unrelated tables and any existing namespace entries. The essential settings are:

```toml
[features.code_mode]
direct_only_tool_namespaces = ["mcp__specship"]

[mcp_servers.specship]
command = "<absolute Node executable>"
args = ["<absolute path to specship/dist/cli.js>", "serve", "<absolute target workspace>"]
tool_timeout_sec = 360
```

The Codex timeout must cover the configured activity limit plus delivery margin. Direct tool exposure matters: a yielding code-mode wrapper caused additional model generations during the compatibility test. Increasing the timeout alone did not prevent that.

Merge the printed Interrupt entry into `.codex/hooks.json`, preserving other hooks. In Codex CLI at that repository, open `/hooks` and review/trust the exact command. Reload the MCP connection in the app/CLI. New or changed hook definitions require normal Codex trust review. The hook is needed because interrupting a Codex turn did not send MCP cancellation in the measured host.

The repository's `.agents/skills/spec` and `.agents/skills/ship` are the skill packages. In another project, install those two directories through your host's normal local skill installation mechanism. Keep the runner checkout available at the absolute path printed by setup.

Add `.specship/` to the target repository's `.gitignore`. It holds local configuration, execution state, retained artifacts, and private reconnect data. Do not commit that directory or share private adapter/callback descriptors.

## Workflow

In the Codex app or CLI:

```text
$spec Add pagination to the search results, preserving the current filters.
```

Spec investigates relevant facts and can delegate bounded read-only exploration. It verifies consequential findings, asks one useful question at a time with a recommendation when decisions remain, and settles a short brief. An already clear, authorized request needs no ritual reapproval.

Spec dispatches Ship automatically. One MCP call stays blocked while Ship works. Routine progress, heartbeat checks, shell polling, and speculative supervisor work do not wake the Spec model. Ship can call `ask_spec` immediately for a consequential blocker; the pending call returns that question to this same chat. Spec's answer is durable, releases Ship, and blocks until the next meaningful event.

When Ship finishes, Spec reviews its report and important implementation evidence. A concrete defect gets a focused correction in the same native Ship session. Once the agreed criteria pass, Spec records acceptance and reports the result. There are no mandatory PLAN/RESULTS files or immutable review rounds.

`$ship` also works directly with a supplied brief. Without a runner-associated Spec conversation, it returns consequential blockers to you and stops; it cannot promise automatic callbacks.

## Ship profiles

Edit the target repository's `.specship/config.json` to configure named choices:

```json
{
  "ship": {
    "default_profile": "luna",
    "profiles": {
      "luna": {
        "harness": "opencode",
        "model": "openai/gpt-6-luna",
        "executable": "C:/path/to/opencode.exe",
        "options": { "variant": "high", "shell": "C:/Windows/System32/cmd.exe" }
      }
    }
  },
  "limits": {
    "max_dispatch_seconds": 240,
    "delivery_margin_seconds": 120
  }
}
```

Profiles apply only to Ship. The default is used unless Spec selects another configured name. The first adapter accepts `low`, `medium`, or `high` reasoning variants and validates availability against the selected OpenCode model. An optional absolute `shell` executable configures only the runner-owned harness; omission preserves OpenCode's shell setting. The Windows stop/resume check passed with explicit `cmd.exe`; the measured PowerShell path failed to produce verifiable Node output. Unknown harnesses/options fail explicitly. There is no automatic model fallback or upgrade. Config changes do not change an already running or recovered activity's saved profile.

Only OpenCode 1.18.30 is currently accepted by the production adapter. Exploration denies editing, shell execution, and delegation through the harness's tool policy; this is not an OS sandbox. Implementation follows existing OpenCode permissions, with native questions/delegation disabled in favor of the Spec callback. Permission requests require user authorization.

## Brief, reports, and media

The brief contains `outcome`, observable `acceptance`, `boundaries`, settled `decisions`, `verified_context`, `validation`, and optional `artifacts`. It is a compact statement of intent, not an exhaustive task/file matrix. Ship owns routine implementation judgment.

Exploration reports contain findings, checks performed, and uncertainties. Implementation reports contain changes, acceptance evidence, actual validation, deviations, remaining issues, and a review status. A report or process exit alone cannot mark work accepted.

Initial media support is workspace-local PNG/JPEG input, with a combined 5,000,000-byte limit per activity to fit callback framing. A local artifact needs `path`, `mime`, and `purpose`; an optional ID identifies it in questions. The runner retains original bytes by content hash, verifies supplied integrity metadata, and replays requested originals as native image content with a blocker answer. It does not silently upscale, OCR, drop an image, or switch models.

Automatic access to Codex chat attachments is unverified. PDF/audio/video input is unsupported. Luna's small-image accuracy remains an observed limitation even when native delivery succeeds; Spec must independently verify important visual claims.

## Stopping and recovery

One workspace has one active writer. Stop/cancel releases ownership only after OpenCode confirms idle. An unconfirmed stop keeps the lease and returns the uncertainty. Partial edits are preserved; recovery never resets Git or deletes implementation work.

Runs and events are persisted under `.specship/runs/<run-id>/`. Operations have stable IDs, current brief/report versions, exact supervisor handles, and native execution identities. Repeated or uncertain delivery must reconcile existing work rather than submit the assignment again.

After reconnect, Spec uses `specship_wait` with the exact run, saved handle, and `recover=true`. Recovery rejects live owners, verifies profile/artifact snapshots, retains the original deadline, and reconnects to the same native session. A lost callback is answered with an explicit decision continuation after the old attempt is stopped. A missing native session or ambiguous execution returns a recovery failure rather than starting over.

In Git repositories the runner records local content hashes at material events, excluding its own storage. Changed files require reconciliation after recovery and prevent accepting stale validation. These hashes do not send repository contents to Spec. Non-Git workspaces still need manual change verification. Corrupt state or a stale recovery guard fails with ownership/recovery information; never delete locks while a writer may be alive.

The model-facing tools are `specship_dispatch`, `specship_reply`, `specship_wait`, `specship_inspect`, `specship_control`, and `specship_accept`. Inspection is for a concrete decision, review, or recovery; there is no status-polling tool. The terminal commands are just setup, MCP serving, and the internal Interrupt entry point.

## Development and verification

```powershell
npm run build
npm run check
```

`npm test` builds the production modules before exercising them, so the checks cannot silently use stale compiled code. The tests include an independent fake adapter, local HTTP/SSE protocol checks, production MCP stdio routing, state/recovery cases, and compatibility telemetry analysis.

Opt-in live checks consume normal model usage:

```powershell
node scripts/check-runtime.mjs C:\path\to\opencode.exe openai/gpt-6-luna high
node scripts/check-runtime.mjs C:\path\to\opencode.exe openai/gpt-6-luna high stop
node scripts/check-runtime.mjs C:\path\to\opencode.exe openai/gpt-6-luna high permission
node scripts/check-runtime.mjs C:\path\to\opencode.exe openai/gpt-6-luna high permission-bash
```

This uses an isolated fixture repository to check real implementation, callbacks, same-session correction, acceptance, exploration, confirmed interruption, and process-crash recovery. These scenarios passed on Windows. Direct MCP waits in Codex CLI and the desktop app stayed blocked for 130 seconds without additional model generations. The actual desktop Stop button with the production Interrupt hook still needs verification. Detailed evidence is retained locally under `.specship/compatibility/`.

For later macOS live verification, use the installed executable rather than the Windows `.exe` path:

```sh
npm run check
node scripts/check-runtime.mjs "$(command -v opencode)" openai/gpt-6-luna high
```

Native macOS process shutdown/recovery, trusted Interrupt delivery, and quiet waits in the actual Codex app/CLI still need live verification. The portability checks do not establish those host behaviors.
