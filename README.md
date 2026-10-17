# Specship

**Plan with your best model. Build with a cheaper one. Stay in the same chat.**

Specship splits AI coding into two jobs: **Spec** works out what to build with you, and **Ship** writes and tests the code. Spec checks the result and sends back a focused correction if something is wrong.

The idea is to spend your strongest model's time on decisions that matter, while a cheaper coding model handles the implementation. Both models still use your normal accounts and usage limits; savings depend on the models and the task.

You talk to Spec in the **Codex app or Codex CLI**. Spec launches Ship through **OpenCode** automatically, so you don't have to copy plans and results between chats.

> **Preview:** this version lives on the `redesign` branch. Windows has been tested. macOS setup is included, but live testing on a Mac is still pending. Requires OpenCode **1.18.30 or newer** and Codex **0.162.0-alpha.17.2 or newer**.

## Let your AI agent set it up

Give an agent that can run terminal commands and edit local files this prompt. Replace the project path with the folder where you want to use Specship:

```text
Install and configure Specship for my project at <absolute project path>.

Use https://github.com/notsonata/specship and read its README
in full. Use the redesign branch, not the default branch.

Check my OS and installed tools, then follow the manual setup in the README.
Use OpenCode 1.18.30 or newer and Codex 0.162.0-alpha.17.2 or newer.
Keep the Specship checkout at a stable location outside my project. Build
the runner, install the spec and ship skills into my project, and merge the
generated Codex configuration and Interrupt hook without overwriting my
existing settings or skills. Add .specship/ to my project's .gitignore.
Keep mcp__specship in direct_only_tool_namespaces and set Codex's tool
timeout to cover the assignment limit plus the delivery margin. Use the
absolute executable paths and OS-specific hook generated on this machine.

Ask me which available OpenCode provider/model, reasoning effort, and
assignment time limit to use if I haven't specified them. Keep Spec as
the model in my Codex chat.

Verify the build and configuration. Leave account sign-in and Codex hook
trust to me, explain any reload needed, and don't run a paid model test
unless I ask. Tell me what changed and how to start with $spec.
```

The prompt covers all the manual setup steps below, including skills, model settings, MCP registration, timeouts, and the stop hook. The agent can do the file and configuration work. You'll still need to sign in to your model provider, approve the stop hook in Codex, and reload/restart Codex when needed. There isn't a one-command installer yet.

## Use it

Open your project in Codex, choose the model you want to plan with, and type:

```text
$spec Add pagination to the search results. Keep the existing filters working.
```

That's the entry point. You don't need to launch Ship yourself.

1. **Work out the plan.** Spec inspects the relevant code and asks about decisions that need your input. It can delegate investigation, then verify the important findings before planning.
2. **Hand off a short brief.** Spec tells Ship the intended outcome, boundaries, and what must pass. There is no required folder of planning documents.
3. **Build and test.** Ship implements the change and handles routine debugging. If it needs a consequential decision, it asks Spec and waits for an answer in the same Codex conversation.
4. **Check and finish.** Spec reviews the report, inspects important changes, and independently checks acceptance. It requests a correction when there's a concrete defect and stops when the agreed work is done.

While Ship works, Spec waits for a result or a decision to make. It doesn't repeatedly ask for status. The local **runner** is the small program that launches Ship, carries messages between them, and saves progress for recovery.

**Spec is whichever model you're using when you invoke `$spec`.** Pick a stronger model when the planning warrants it. Ship's model and reasoning effort are configured separately.

## Manual setup

You'll need:

| Tool | Requirement |
| --- | --- |
| Codex | `0.162.0-alpha.17.2` or newer, with local skills, MCP tools, and Interrupt hooks. This is the tested Codex runtime/CLI version. |
| Node.js and npm | Node 22 or newer; Node 24 is the tested version. |
| Git | For cloning Specship; recommended for the project you're changing too. |
| OpenCode | **1.18.30 or newer**, authenticated with access to your chosen Ship model. |

MCP is the connection that lets Codex call the runner. The Interrupt hook lets Codex tell the runner to stop Ship when you interrupt the chat.

These are minimum versions, not exact pins. OpenCode's version is checked by the runner; the setup agent checks Codex's installed version. Required host metadata and model/API capabilities are still checked at runtime. Newer versions are allowed, but have not all been live-tested.

### 1. Download and build

Run these commands in a folder where you keep tools, outside the project you want Ship to edit:

```sh
git clone --branch redesign https://github.com/notsonata/specship.git
cd specship
npm ci
npm run build
```

Keep this checkout in place: Codex will use its built runner. Specship uses OpenCode's existing provider authentication; it doesn't manage sign-in or store provider keys for you.

### 2. Configure your project

Run setup from the Specship checkout. Replace the project path, OpenCode executable path, and model with your own values. Model IDs use `provider/model` format; the Luna model below is an example, not a requirement. Use a supported effort level, or omit `--variant high` to keep the model's default.

**Windows (PowerShell)**

```powershell
node dist/cli.js setup `
  --workspace "C:\Projects\my-app" `
  --profile workhorse `
  --model openai/gpt-6-luna `
  --variant high `
  --executable "C:\path\to\opencode.exe" `
  --shell "C:\Windows\System32\cmd.exe" `
  --max-dispatch-seconds 240 `
  --delivery-margin-seconds 120
```

**macOS (live testing pending)**

```sh
node dist/cli.js setup \
  --workspace "/Users/you/Projects/my-app" \
  --profile workhorse \
  --model openai/gpt-6-luna \
  --variant high \
  --executable "$(command -v opencode)" \
  --shell /bin/sh \
  --max-dispatch-seconds 240 \
  --delivery-margin-seconds 120
```

The executable must be an absolute path. On macOS, if `command -v opencode` returns an alias or function, use the actual installed executable path instead. Generate setup separately on each machine so its paths and stop command match the OS.

The example gives each Ship assignment **240 seconds**, plus **120 seconds** for delivering the result before Codex's tool timeout. Choose limits appropriate to your work; these are example values, not defaults or a spending cap. The assignment deadline also continues while Ship waits for a decision.

Setup creates `<your-project>/.specship/config.json` and prints two configuration entries. It does **not** install them into Codex automatically. If configuration already exists, setup preserves it and requires matching arguments; edit the file to change your settings.

### 3. Connect Codex

In the project you want to work on:

1. Merge the printed `codex_toml` text into `.codex/config.toml`. Decode the JSON string into normal TOML text; don't paste the surrounding JSON or literal `\n` escapes. Preserve existing tables and settings.
2. Merge the printed `hooks_json` object into `.codex/hooks.json`, preserving other hooks.
3. Copy Specship's `.agents/skills/spec` and `.agents/skills/ship` directories into your project's `.agents/skills/` directory. Preserve their contents, including `agents/openai.yaml`, and check for existing skills with the same names before copying. Codex discovers project skills from this location. See [Codex skill locations](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills).
4. Add `.specship/` to your project's `.gitignore`. That folder contains local settings, saved runs, artifacts, and private connection information.
5. In Codex CLI opened at your project, use `/hooks` to review and trust the generated Interrupt hook. Codex requires review of new or changed hooks. See [hook trust instructions](https://learn.chatgpt.com/docs/hooks#review-and-trust-hooks).
6. Reload the MCP connection or restart Codex so it picks up the configuration. Confirm that `$spec` is available and the Specship tools are connected.

**Keep these generated MCP settings:**

```toml
[features.code_mode]
direct_only_tool_namespaces = ["mcp__specship"]
```

If you already have that table or list, merge the entry rather than replacing it. Also keep the generated `[mcp_servers.specship]` registration, including its absolute paths and `tool_timeout_sec`.

Direct tool access is what allows Spec to wait quietly. In compatibility checks, wrapping these tools in a yielding code-mode call caused extra model activity. The Codex timeout must be at least the assignment limit plus the delivery margin: **360 seconds** for the examples above.

Now open the project in Codex and try `$spec` with a small task. This will use your normal model allowance.

## Change Ship's model or effort

Edit `.specship/config.json` in the project you're working on. For example:

```json
{
  "ship": {
    "default_profile": "workhorse",
    "profiles": {
      "workhorse": {
        "harness": "opencode",
        "model": "openai/gpt-6-luna",
        "executable": "C:/path/to/opencode.exe",
        "options": {
          "variant": "high",
          "shell": "C:/Windows/System32/cmd.exe"
        }
      }
    }
  },
  "limits": {
    "max_dispatch_seconds": 240,
    "delivery_margin_seconds": 120
  }
}
```

Use your local executable paths; on macOS, the shell example is `/bin/sh`. The shell setting is optional. Explicit `cmd.exe` is the tested Windows choice; the PowerShell harness check failed to produce verifiable Node output.

- **`model`** selects Ship's provider and model in OpenCode.
- **`variant`** selects `low`, `medium`, or `high` reasoning effort, when supported by that model. You can omit it to use the model's default.
- **`profiles`** lets you save multiple choices. `default_profile` selects the usual one; you can ask Spec to use another configured profile by name.
- **`limits`** controls assignment time and result delivery. If you change these values, update Codex's `tool_timeout_sec` to cover their sum.

Restart the MCP connection after changing configuration. Existing runs keep their saved profile. Specship doesn't silently upgrade the model or fall back to another one. Additional harnesses are planned; **OpenCode is the only supported Ship harness today**.

## Stops, reconnects, and images

**Permissions:** the runner cannot grant new OpenCode permissions through Spec, even if a reply says the user approved. Spec can reject a request, pause, or cancel. To allow an operation, cancel the blocked run, review/change the permissions yourself in OpenCode, then start a new run. Existing OpenCode permissions still apply; Specship is not an OS sandbox.

**Stopping:** ask Spec to pause or cancel the run. The Interrupt hook is also intended to stop Ship when you interrupt Codex. The runner only confirms a stop after OpenCode confirms it is idle; an uncertain stop keeps the workspace reserved. The actual desktop Stop button with the production hook still needs live verification.

**Reconnecting:** saved state lets Spec attempt to reconnect to the same Ship session, without submitting the job again. Ask it to recover the exact interrupted run. Recovery can require a decision if files changed, time expired, or the original session is unavailable. Partial edits are preserved. Don't delete locks or start a competing run to get around a recovery error.

**Images:** Ship can receive PNG and JPEG files from your project, up to 5 MB combined per assignment. Automatic access to images attached in Codex chat is unverified; use a local file path. PDF, audio, and video input aren't supported yet. Image delivery doesn't guarantee that the model reads it correctly, especially for small images.

Only one Ship writer can work in a project at a time. Git projects get automatic change checks during review and recovery; other folders still need manual change verification.

Saved decisions survive callback retries: the same request gets the same answer, including verified original image files. Reusing its ID for changed input or a later assignment is rejected.

Local storage is restricted to the current user on POSIX (`0700` directories, `0600` files). Windows uses ACLs allowing the current user, SYSTEM, and Administrators. Existing state is hardened on initialization; linked storage and files owned by another user are rejected. Processes running under your own account remain trusted, including your coding agents.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| `$spec` is missing | Check `.agents/skills/spec/SKILL.md` in your project, then restart Codex if needed. |
| Specship tools are missing | Check the generated MCP registration, absolute paths, and that `npm run build` succeeded. Reload the connection. |
| Spec keeps checking progress | Ensure `mcp__specship` is in `direct_only_tool_namespaces` and that the tools are exposed directly. |
| A wait times out | Check Codex's tool timeout against the assignment limit plus delivery margin. Recover the existing run rather than dispatching it again. |
| OpenCode version or model is rejected | Use OpenCode 1.18.30 or newer and a provider/model and variant available in your authenticated OpenCode setup. |
| The stop hook doesn't run | Review/trust the current hook through `/hooks`; changed commands need review again. |

## Development

```sh
npm ci
npm run check
```

The check command typechecks, builds, and runs the automated tests. It doesn't call a paid model. Tests cover runner state, callbacks, recovery, MCP routing, OpenCode protocol handling, and platform-specific hook commands.

GitHub Actions runs these automated checks on Windows and macOS with Node 22 and 24. CI does not launch Codex or OpenCode, authenticate providers, or perform live model tests.

Opt-in live checks use your normal model allowance:

```sh
node scripts/check-runtime.mjs /absolute/path/to/opencode provider/model high
```

On Windows, use the full path to `opencode.exe`. Additional scenarios accept `stop`, `permission`, or `permission-bash` as a final argument. The permission scenarios check that model-issued grants are blocked, then cancel the run. Evidence is saved locally under `.specship/compatibility/`.

Windows live checks have covered implementation, callbacks, corrections, acceptance, exploration, stopping, and crash recovery. Direct MCP waits in Codex CLI and the app stayed blocked for 130 seconds without additional model generations. Native macOS process handling, hook delivery, and quiet waits still need live checks on a Mac.

## License

[Apache 2.0](LICENSE)
