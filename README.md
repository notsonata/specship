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
Clone the redesign branch into my project's .specship/runtime and build it
there with npm ci and npm run build. If that checkout already exists,
inspect and preserve local changes before updating it. Run setup for my
project, install the spec and ship skills into my project's .agents/skills,
and merge the generated Codex configuration and Interrupt hook without
overwriting existing settings or skills. Add .specship/ to .gitignore.
Keep existing configuration, runs, artifacts, and reconnect data in place.
Keep mcp__specship in direct_only_tool_namespaces and use the generated
long MCP tool timeout so Spec waits without polling. Use the absolute
executable paths and OS-specific hook generated on this machine.

Ask me which available OpenCode provider/model and reasoning effort to use
if I haven't specified them. Leave the assignment limit disabled unless I
explicitly request one. Keep Spec as the model in my Codex chat.

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

While Ship works, Spec waits for a result or a decision to make. It doesn't repeatedly ask for status. **There is no assignment time limit by default:** Ship runs until it finishes, needs a decision, fails, or you stop it. The local **runner** is the small program that launches Ship, carries messages between them, and saves progress for recovery.

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

### 1. Install inside your project

Open a terminal at the root of the project you want Ship to edit. These commands work in PowerShell and a macOS terminal:

```sh
git clone --branch redesign https://github.com/notsonata/specship.git .specship/runtime
cd .specship/runtime
npm ci
npm run build
```

The runner and dependencies live in `.specship/runtime/`. Your settings, saved runs, and artifacts stay alongside it:

```text
your-project/
  .specship/
    runtime/       # Specship checkout, dependencies, and built runner
    config.json    # Ship profiles and optional limits
    runs/          # Existing run IDs, decisions, and reconnect data
    artifacts/     # Retained images
  .agents/skills/  # Spec and Ship skills discovered by Codex
  .codex/         # MCP and Interrupt hook registrations
```

If `.specship/runtime/` already contains an installation, reuse it and inspect local changes before updating; cloning will refuse to overwrite it. Keep the local checkout in place. Node and OpenCode remain separately installed tools. Specship uses OpenCode's existing provider authentication; it doesn't manage sign-in or store provider keys for you.

### 2. Configure your project

Run setup from `.specship/runtime/`. The `--workspace ../..` argument points back to your project root. Replace the OpenCode executable path and model with your own values. Model IDs use `provider/model` format; the Luna model below is an example, not a requirement. Use a supported effort level, or omit `--variant high` to keep the model's default.

**Windows (PowerShell)**

```powershell
node dist/cli.js setup `
  --workspace ../.. `
  --profile workhorse `
  --model openai/gpt-6-luna `
  --variant high `
  --executable "C:\path\to\opencode.exe" `
  --shell "C:\Windows\System32\cmd.exe"
```

**macOS (live testing pending)**

```sh
node dist/cli.js setup \
  --workspace ../.. \
  --profile workhorse \
  --model openai/gpt-6-luna \
  --variant high \
  --executable "$(command -v opencode)" \
  --shell /bin/sh
```

The executable must be an absolute path. On macOS, if `command -v opencode` returns an alias or function, use the actual installed executable path instead. Generate setup separately on each machine so its paths and stop command match the OS.

These commands leave the assignment limit disabled. To opt into a one-hour limit, add `--max-dispatch-seconds 3600`. With a limit enabled, the delivery margin defaults to 120 seconds; change it with `--delivery-margin-seconds N`. A configured assignment deadline includes time waiting for a decision and is not a spending cap.

Setup checks that the local runtime is built, creates `<your-project>/.specship/config.json`, and prints two configuration entries pointing at `.specship/runtime/dist/cli.js`. It does **not** clone the runtime or install the entries into Codex automatically. If configuration already exists, setup preserves it and requires matching arguments; edit the file to change your settings. It does not relocate or reset saved runs.

### 3. Connect Codex

In the project you want to work on:

1. Merge the printed `codex_toml` text into `.codex/config.toml`. Decode the JSON string into normal TOML text; don't paste the surrounding JSON or literal `\n` escapes. Preserve existing tables and settings.
2. Merge the printed `hooks_json` object into `.codex/hooks.json`, preserving other hooks.
3. Copy `spec` and `ship` from `<your-project>/.specship/runtime/.agents/skills/` into `<your-project>/.agents/skills/`. Preserve their contents, including `agents/openai.yaml`, and check for existing skills with the same names before copying. Codex discovers project skills from this location. See [Codex skill locations](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills).
4. Add `.specship/` to your project's `.gitignore`. This excludes the local runtime checkout and dependencies as well as settings, saved runs, artifacts, and private connection information.
5. In Codex CLI opened at your project, use `/hooks` to review and trust the generated Interrupt hook. Codex requires review of new or changed hooks. See [hook trust instructions](https://learn.chatgpt.com/docs/hooks#review-and-trust-hooks).
6. Reload the MCP connection or restart Codex so it picks up the configuration. Confirm that `$spec` is available and the Specship tools are connected.

**Keep these generated MCP settings:**

```toml
[features.code_mode]
direct_only_tool_namespaces = ["mcp__specship"]
```

If you already have that table or list, merge the entry rather than replacing it. Also keep the generated `[mcp_servers.specship]` registration, including its absolute paths and `tool_timeout_sec`.

Direct tool access is what allows Spec to wait quietly. In compatibility checks, wrapping these tools in a yielding code-mode call caused extra model activity. The runner keeps the call pending until a meaningful event; it does not periodically return to Spec or ask it to renew a wait.

Codex has a [separate per-tool transport timeout](https://learn.chatgpt.com/docs/extend/mcp). With no assignment limit, setup generates `tool_timeout_sec = 2147483` (about 24.8 days), within the timer range used by the MCP clients. This is a transport backstop, not a runner assignment deadline. It is not a guarantee of an indefinitely connected host, and that full duration has not been live-tested. If the host times out or disconnects, recover the existing run instead of starting the task again.

Now open the project in Codex and try `$spec` with a small task. This will use your normal model allowance.

### Moving an existing external installation

Pause or stop the current run and confirm Ship is idle before changing its connection. Clone and build into `.specship/runtime/` as above, then run the local setup with your existing profile/options and limits. Merge its new MCP and hook paths, review/trust the changed hook, and reload the connection.

Leave `.specship/config.json`, `runs/`, `artifacts/`, and reconnect files where they are. Run IDs and saved session information do not change. Recover an interrupted run by its exact saved identifiers. Keep the old external checkout available until its existing native OpenCode sessions have finished or been retired, since those sessions may still reference its callback bridge. Existing external registrations continue to work until you replace them.

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
    "max_dispatch_seconds": null,
    "delivery_margin_seconds": 120
  }
}
```

Use your local executable paths; on macOS, the shell example is `/bin/sh`. The shell setting is optional. Explicit `cmd.exe` is the tested Windows choice; the PowerShell harness check failed to produce verifiable Node output.

- **`model`** selects Ship's provider and model in OpenCode.
- **`variant`** selects `low`, `medium`, or `high` reasoning effort, when supported by that model. You can omit it to use the model's default.
- **`profiles`** lets you save multiple choices. `default_profile` selects the usual one; you can ask Spec to use another configured profile by name.
- **`limits.max_dispatch_seconds`** is optional. Omit it or set it to `null` for no assignment deadline. Set a positive number of seconds only when you want a limit. You can omit the whole `limits` object for the defaults.
- **`limits.delivery_margin_seconds`** defaults to 120 and applies to result delivery when an assignment deadline is configured. It does not create a deadline for unlimited assignments.

Existing numeric limits remain active until you remove them or set them to `null`. To switch an existing project to unlimited work, edit that field, rerun setup without `--max-dispatch-seconds` (keeping your existing profile/options), merge its new MCP timeout, and reload the connection. Active or recovered assignments retain their saved deadline or no-limit setting. For a configured cap, setup uses the cap plus delivery margin for Codex's tool timeout, up to the same transport backstop.

Restart the MCP connection after changing configuration. Existing runs keep their saved profile. Specship doesn't silently upgrade the model or fall back to another one. Additional harnesses are planned; **OpenCode is the only supported Ship harness today**.

## Stops, reconnects, and images

**Permissions:** the runner cannot grant new OpenCode permissions through Spec, even if a reply says the user approved. Spec can reject a request, pause, or cancel. To allow an operation, cancel the blocked run, review/change the permissions yourself in OpenCode, then start a new run. Existing OpenCode permissions still apply; Specship is not an OS sandbox.

**Stopping:** ask Spec to pause or cancel the run. The Interrupt hook is also intended to stop Ship when you interrupt Codex. The runner only confirms a stop after OpenCode confirms it is idle; an uncertain stop keeps the workspace reserved. The actual desktop Stop button with the production hook still needs live verification.

**Reconnecting:** saved state lets Spec attempt to reconnect to the same Ship session, without submitting the job again. Ask it to recover the exact interrupted run. Recovery can require a decision if files changed, time expired, or the original session is unavailable. Partial edits are preserved. Don't delete locks or start a competing run to get around a recovery error.

**Images:** Ship can receive PNG and JPEG files from your project, up to 5 MB combined per assignment. Automatic access to images attached in Codex chat is unverified; use a local file path. PDF, audio, and video input aren't supported yet. Image delivery doesn't guarantee that the model reads it correctly, especially for small images.

Only one Ship writer can work in a project at a time. Git projects get automatic change checks during review and recovery; other folders still need manual change verification.

Saved decisions survive callback retries: the same request gets the same answer, including verified original image files. Reusing its ID for changed input or a later assignment is rejected.

Private configuration and run data are restricted to the current user on POSIX (`0700` directories, `0600` files). Windows uses ACLs allowing the current user, SYSTEM, and Administrators. Existing state is hardened on initialization; links and foreign ownership in private storage are rejected. The runtime root must be a real directory; its trusted executable contents retain dependency links and executable permissions. Processes running under your own account remain trusted, including your coding agents.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| `$spec` is missing | Check `.agents/skills/spec/SKILL.md` in your project, then restart Codex if needed. |
| Specship tools are missing | Check the generated MCP registration, absolute paths, and that `npm run build` succeeded. Reload the connection. |
| Setup says the runtime is missing | Clone into `<project>/.specship/runtime`, run `npm ci` and `npm run build` there, then rerun setup for the project. Keep existing run data in place. |
| Spec keeps checking progress | Ensure `mcp__specship` is in `direct_only_tool_namespaces` and that the tools are exposed directly. |
| A wait times out | Merge the current setup output's MCP timeout and reload the connection. A host timeout is separate from an assignment limit; recover the existing run rather than dispatching it again. |
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
