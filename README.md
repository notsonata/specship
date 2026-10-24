# Specship

**Plan with your best model. Build with a cheaper one. Stay in the same chat.**

Specship splits AI coding into two jobs: **Spec** works out what to build with you, and **Ship** writes and tests the code. Spec checks the result and sends back a focused correction if something is wrong.

The idea is to spend your strongest model's time on decisions that matter, while a cheaper coding model handles the implementation. Both models still use your normal accounts and usage limits; savings depend on the models and the task.

You talk to Spec in the **Codex app or Codex CLI**. Spec launches Ship through **OpenCode** automatically, so you don't have to copy plans and results between chats.

> **Preview:** this version lives on the `redesign` branch. Windows has been tested. macOS setup is included, but live testing on a Mac is still pending. Requires Codex **0.162.0-alpha.17.2 or newer** and OpenCode **1.18.30 or newer**, unless you configure the preview DeepSeek Harness adapter instead.

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
| OpenCode | **1.18.30 or newer**, authenticated with access to your chosen Ship model. Required for the `opencode` harness. |
| DeepSeek Harness (optional) | `0.2.1-rc.3` tested. The installed desktop app must expose the built-in `acp` profile and its saved account sign-in. No OpenCode install is needed for a DeepSeek-only setup. |

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

- **`model`** selects Ship's provider and model in the selected harness. OpenCode uses its `provider/model` identifier; DeepSeek uses the exact route its ACP session advertises.
- **`variant`** is the OpenCode reasoning effort (`low`, `medium`, or `high`) when that model supports it. DeepSeek uses `reasoning_effort` instead. You can omit either setting to use the model's default.
- **`profiles`** lets you save multiple choices. `default_profile` selects the usual one; you can ask Spec to use another configured profile by name.
- **`limits.max_dispatch_seconds`** is optional. Omit it or set it to `null` for no assignment deadline. Set a positive number of seconds only when you want a limit. You can omit the whole `limits` object for the defaults.
- **`limits.delivery_margin_seconds`** defaults to 120 and applies to result delivery when an assignment deadline is configured. It does not create a deadline for unlimited assignments.

Existing numeric limits remain active until you remove them or set them to `null`. To switch an existing project to unlimited work, edit that field, rerun setup without `--max-dispatch-seconds` (keeping your existing profile/options), merge its new MCP timeout, and reload the connection. Active or recovered assignments retain their saved deadline or no-limit setting. For a configured cap, setup uses the cap plus delivery margin for Codex's tool timeout, up to the same transport backstop.

### Code-enforced acceptance checks

A brief can name checks that the runner executes itself after Ship reports. Add them to `.specship/config.json`; do not let Ship or Spec author arbitrary commands:

```json
{
  "checks": {
    "test": {
      "command": "npm test",
      "cwd": ".",
      "timeout_ms": 120000,
      "expected_exit": 0
    }
  }
}
```

Then include optional structured acceptance data in the brief:

```json
{
  "acceptance": ["pagination keeps existing filters working"],
  "acceptance_criteria": [
    { "id": "A1", "text": "filters still apply" },
    { "id": "A2", "text": "invalid page returns 400" }
  ],
  "required_checks": ["test"]
}
```

Ship returns `acceptance_results` keyed by criterion ID. The runner runs the configured checks in the workspace, stores their exit status and bounded output hashes, and includes them in the `implementation_ready` event. `specship_accept` fails if a required check did not pass, a criterion has no evidence, or the workspace drifted after the report/checkpoint. Existing string-only briefs still work without these fields. Check commands are trusted user configuration and can modify the workspace; the runner records the post-check checkpoint for acceptance.

### Optional worktree isolation

A project can keep Ship's edits out of the main working tree until acceptance:

```json
{
  "ship": {
    "default_profile": "workhorse",
    "isolation": "worktree",
    "profiles": { "workhorse": { "harness": "opencode", "model": "openai/gpt-6-luna", "options": {} } }
  }
}
```

Setup can write it with `--isolation worktree`.

In worktree mode, the runner creates a detached Git worktree at the repository HEAD for each implementation/correction activity and starts Ship there. The main workspace remains untouched while Ship works. The `implementation_ready` event includes the worktree path; `specship_inspect` with `section: "recovery"` also reports `isolation` and `ship_workspace`, so Spec can inspect the actual diff before accepting. Acceptance runs the configured checks in the worktree, then applies the staged worktree diff to the main workspace with `git apply` and removes the worktree. If the patch conflicts, acceptance fails and the worktree remains for inspection.

Limitations: this mode requires a Git repository with a commit, uses the committed `HEAD` rather than uncommitted main-tree changes, and leaves the worktree in place after cancellation/failure so partial work can be inspected or recovered. It is not an OS sandbox; it is a Git boundary.

### Wait and inspection policy

These are runner rules, not prompt suggestions:

- A wait that repeats the same `last_event_id` without a new event is rejected as `WAIT_WITHOUT_PROGRESS` after the retry budget; the tool returns a structured error envelope.
- A second concurrent blocking wait is rejected.
- `specship_inspect` is rate-limited per run. Inspecting `logs` requires `purpose: "review"` or `"recovery"`.
- A sleeping or polling loop in the host is not a substitute for a pending supervisor wait.

Tool failures return a structured body with `error.code`, `error.message`, and `error.retryable`. Stop on non-retryable policy errors instead of retrying the same call.

Run states are written as schema 2. A schema-1 run is migrated in memory and a private `state.v1.backup.json` is written before its first v2 save. A private `transitions.jsonl` records phase changes for audit; use `specship_inspect` with `section: "transitions"` and a review/recovery purpose. Do not edit or delete run state to work around a policy error.

Restart the MCP connection after changing configuration. Existing runs keep their saved profile. Specship doesn't silently upgrade the model or fall back to another one. OpenCode and DeepSeek Harness are selectable Ship harnesses; additional adapters must pass the same contract before they are selectable.

## Use DeepSeek Harness for Ship

Specship includes a preview `deepseek` harness adapter. It launches the installed DeepSeek Harness through its ACP profile, keeps one persistent session per run, and uses the same authenticated loopback callback server as OpenCode. The adapter does not copy provider credentials or modify the DeepSeek Harness installation.

```json
{
  "ship": {
    "default_profile": "dsh",
    "profiles": {
      "dsh": {
        "harness": "deepseek",
        "model": "deepseek-account/deepseek-flash",
        "executable": "C:/Users/you/AppData/Local/Programs/DeepSeek Harness/DeepSeek Harness.exe",
        "options": {
          "reasoning_effort": "high",
          "sandbox": "workspace-write"
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

On Windows, `executable` must be the installed `DeepSeek Harness.exe`. The adapter derives the bundled ACP CLI beside it. Do not point it at `dsh.cmd`: a batch-file launcher cannot be spawned safely without a shell. On macOS or Linux, point `executable` at the installed `dsh` launcher instead. If you run DSH from a source checkout, set `options.cli` to the absolute `dsh` CLI entry and `executable` to the Node or Electron executable that runs it.

Setup can create this profile:

```powershell
node dist/cli.js setup `
  --workspace ../.. `
  --harness deepseek `
  --profile dsh `
  --model deepseek-account/deepseek-flash `
  --executable "C:\path\to\DeepSeek Harness.exe" `
  --variant high `
  --sandbox workspace-write
```

Use the provider/model IDs advertised by your DSH session. `deepseek-account/deepseek-flash` and `deepseek-account/deepseek-v4-pro` are the choices shown by the tested saved account; `deepseek-official/deepseek-v4-flash` is the API-route default. `options.reasoning_effort` accepts `off`, `low`, `high`, or `max`. The adapter verifies the exact route before submitting a prompt; it never silently substitutes another model.

**DeepSeek ACP boundaries.** The ACP profile advertises no image input, so a DeepSeek profile rejects image artifacts before starting work. Explore activities run with DSH's `read-only` policy; implementation and correction activities use `options.sandbox` (default `workspace-write`). Approval requests raised outside that sandbox are surfaced to Spec as `user_input_required`; Spec can reject, pause, or cancel but cannot grant them. To allow the operation, cancel the run, change the DSH permission policy yourself, and start a new run.

The DeepSeek MCP bridge also applies a 60-second timeout to one tool call. A Spec decision can take longer, so this adapter exposes only `report_result` to Ship (the runner's callback bridge omits `ask_spec` for this harness). For a consequential decision, Ship submits a `needs_decision` implementation report; Spec answers it, and the runner resumes the same DSH session with the answer. The tested decision path returned `decision_required` and then a fresh `implementation_ready` report after the reply. The tradeoff is an explicit turn boundary instead of an in-turn wait. A native DSH callback plugin capable of longer calls is future work; until then, do not describe DeepSeek Ship as having the same unlimited decision wait as OpenCode.

Crash recovery uses ACP `session/resume` against the persisted DSH session and the same working directory. The adapter also writes a private per-run `deepseek-prompt.json` journal (`submitted`, `complete`, or `failed`). A resumed session with a `submitted` prompt that has no completion record is treated as ambiguous and is not replayed; a completed operation can be reconciled. The tested path covers starting, selecting a model, closing, resuming a session without replaying a prompt, and a report-based decision continuation; a real DSH probe confirmed the native approval request shape, and the adapter's rejection path is covered by the fake ACP tests. If the original DSH process is still alive, recovery refuses to take over its session. If an interrupted prompt's outcome cannot be reconciled, the runner reports a concrete `execution_failed` event and stops instead of guessing or replaying the prompt.

## Stops, reconnects, and images

**Permissions:** the runner cannot grant new harness permissions through Spec, even if a reply says the user approved. Spec can reject a request, pause, or cancel. To allow an operation, cancel the blocked run, review/change the permissions yourself in OpenCode or DeepSeek Harness, then start a new run. Existing harness permissions still apply; Specship is not an OS sandbox.

**Stopping:** ask Spec to pause or cancel the run. The Interrupt hook is also intended to stop Ship when you interrupt Codex. The runner only confirms a stop after the selected harness confirms it is idle; an uncertain stop keeps the workspace reserved. The actual desktop Stop button with the production hook still needs live verification.

**Reconnecting:** saved state lets Spec attempt to reconnect to the same Ship session, without submitting the job again. Ask it to recover the exact interrupted run. Recovery can require a decision if files changed, time expired, or the original session is unavailable. Partial edits are preserved. Don't delete locks or start a competing run to get around a recovery error.

**Images:** an OpenCode Ship profile can receive PNG and JPEG files from your project, up to 5 MB combined per assignment. The preview DeepSeek ACP profile advertises no image input and rejects image artifacts before starting work. Automatic access to images attached in Codex chat is unverified; use a local file path. PDF, audio, and video input aren't supported yet. Image delivery doesn't guarantee that the model reads it correctly, especially for small images.

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
| DeepSeek ACP is unavailable | Use an installed DeepSeek Harness version with the built-in `acp` profile, and set `executable` to `DeepSeek Harness.exe` on Windows. `dsh --profile acp --dump-config` should print a composed profile. |
| DeepSeek model or effort is rejected | Copy the exact provider/model and effort advertised by the DSH session. The adapter lists the available model choices in the error and never substitutes one. |
| A DeepSeek decision takes a long time | DeepSeek Ship uses `needs_decision` reports because the harness caps one MCP tool call at 60 seconds. Answer the decision event; the runner resumes the same DSH session. |
| The stop hook doesn't run | Review/trust the current hook through `/hooks`; changed commands need review again. |

## Development

```sh
npm ci
npm run check
```

The check command typechecks, builds, and runs the automated tests. It doesn't call a paid model. Tests cover runner state, callbacks, recovery, MCP routing, OpenCode protocol handling, DeepSeek ACP protocol handling through a fake agent, harness routing, and platform-specific hook commands.

GitHub Actions runs these automated checks on Windows and macOS with Node 22 and 24. CI does not launch Codex, OpenCode, or DeepSeek Harness, authenticate providers, or perform live model tests.

Opt-in live checks use your normal model allowance:

```sh
node scripts/check-runtime.mjs /absolute/path/to/opencode provider/model high
```

On Windows, use the full path to `opencode.exe`. Additional scenarios accept `stop`, `permission`, or `permission-bash` as a final argument. The permission scenarios check that model-issued grants are blocked, then cancel the run. Evidence is saved locally under `.specship/compatibility/`.

Windows live checks have covered implementation, callbacks, corrections, acceptance, exploration, stopping, and crash recovery. Direct MCP waits in Codex CLI and the app stayed blocked for 130 seconds without additional model generations. Native macOS process handling, hook delivery, and quiet waits still need live checks on a Mac.

## Benchmark coding quality and usage

The default benchmark compares **raw Codex** with **Specship** on the same frozen SWE-bench cases. Both use the same configured Spec model and effort; Specship additionally uses the configured Ship model. Set `arms` to choose the comparison; `--arm ship` remains available as an optional diagnostic. Quality comes from the official external test harness; model reports do not determine the score. Token usage, estimated API-equivalent cost, actual billing evidence, and subscription-limit changes are separate measurements. No model calls happen without `run --execute`.

Prerequisites: Node 22+ with the built-in `node:sqlite` module available (Node 24 recommended), a built Specship checkout, Docker with Linux AMD64 containers, and Python 3.10+ with `swebench==5.0.2` installed in a separate virtual environment for dataset preflight. The actual grader runs the pinned package inside a Linux container, avoiding Windows newline differences. Only this trusted, model-free grader receives the Docker socket and held-out dataset. The benchmark installs pinned Codex/OpenCode versions inside disposable agent images, using each case's official SWE-bench image as the base. Image downloads/builds can require substantial disk space. Set `auth.codex_file` and `auth.opencode_file` to absolute paths to the respective CLI's saved subscription authentication JSON. Those files are copied only into each applicable temporary container and removed with it; they are never included in image builds or result artifacts. Authentication/refresh support still depends on the pinned CLI and provider.

```sh
npm run build
npm run benchmark -- init
npm run benchmark -- fetch
npm run benchmark -- doctor
npm run benchmark -- plan
```

Edit `.specship/benchmark/config.json` before running. Choose `spec.model` (the Codex model ID), `ship.model` (`provider/model`), and their efforts. Set absolute `docker`/`python` paths if those tools are not on PATH. The default sample is five deterministic SWE-bench Lite cases, one attempt per configuration: 10 attempts total. `cases.lock.json` retains the selected records, observed dataset revision, seed, and content hash. Create another `--home PATH` for a new sample; fetching never overwrites an existing lock.

Authentication defaults to `auth.mode: "subscription"`. Set `auth.codex_file` to a saved ChatGPT login and `auth.opencode_file` to OpenCode's saved OpenAI OAuth login. Preflight rejects API-only credentials. Subscription trials forward no API-key environment variables, strip any image-provided API/token overrides, force Codex's ChatGPT sign-in method, and remove unrelated OpenCode provider credentials before model execution. Missing or expired subscription authentication fails the attempt; there is no API-key fallback. To explicitly run an API-billed comparison instead, set `auth.mode: "api"` and configure `credential_env`. Dollar estimates in subscription runs are API-equivalent comparisons, not subscription charges.

Prices are explicit USD per million tokens in each model's `rates`: `input`, `cached_input`, `cache_write`, and `output`. Record the pricing source/date and tariff (for example, standard short context) alongside the rates. Estimates apply that flat tariff; they do not reconstruct long-context, Fast mode, regional, or tool surcharges from aggregate token totals. Codex input includes cached input; OpenCode reports its input and cache categories separately. Ship rates additionally require `reasoning_is_separate: true` if its `tokens.output` excludes reasoning, or `false` if it already includes it; verify this for the configured provider/harness. Unknown prices/accounting remain `null`. Failed attempts retain their known per-role costs; `known_api_equivalent_usd` is a lower bound when another role's usage is missing, while the complete total remains `null`. OpenCode's own reported cost is retained separately and is not treated as an invoice. No prices are inferred from a model name.

Validate the grader with a reference fix and an unrelated-file change before spending model allowance. The reference must pass and the unrelated change must fail. These commands run tests/build images but make no model calls:

```sh
npm run benchmark -- controls --case CASE_ID
npm run benchmark -- build --case CASE_ID
npm run benchmark -- preflight --case CASE_ID       # verifies image base/tools, no models
```

Use a case ID from `plan`. Run a small pilot with `--case CASE_ID`; omit it for the complete frozen sample. `--arm codex`, `--arm ship`, or `--arm specship` selects one configuration. Each command creates a new run; it never silently replays a failed attempt.

```sh
npm run benchmark -- run                           # dry run only
npm run benchmark -- run --execute --case CASE_ID  # uses model allowance
npm run benchmark -- grade --run RUN_ID
npm run benchmark -- report --run RUN_ID
```

Each case/configuration gets a fresh container. Only its problem statement, model configuration, base commit, and configured authentication are passed in; no host workspace, Docker socket, reference patch, or held-out tests are mounted. Repository history is removed after checking the base commit. Ship configurations refresh the public catalog and validate the exact model/variant through the production adapter before any model prompt is submitted. The real Codex Spec skill supervises the production runner; the controller does not simulate Spec's answers or acceptance. The external wall-clock limit covers the complete attempt and stops the entire container, including Ship. It is not a dollar spending cap. Runs, raw usage evidence, patches, image IDs, version/configuration records, and JSON summaries stay under `.specship/benchmark/`. This measures the CLI workflow, not desktop UI behavior. Containers retain provider network access: public benchmark tasks are not guaranteed unseen, and this is not a network-sealed evaluation.

Missing token evidence or grader results stay unknown. Token summaries retain raw harness categories and add `input_total` including cache plus `output_total` including reasoning, for comparisons across harnesses. Unknown reasoning semantics leave the output total unknown. Failed/ungraded attempts are reported separately; incomplete grading does not produce a complete success rate or cost-per-success score. Specship acceptance followed by external test failure is a false acceptance. Raw turn/message counts are not API request counts; retries and rate-limit waits require separate provider/proxy evidence.

For actual billing, place `billing.json` beside a trial's `result.json`, with `source`, nonnegative `usd`, and optionally a measured `api_requests`. For subscription limits, place `quota.json` there with `source`, `bucket`, `exclusive: true`, and `before`/`after` objects containing `used_percent` and `resets_at`. `report` imports these controller-side records. Quota deltas are percentage points and are only computed for exclusive account usage within an unchanged reset window; no token-to-subscription conversion is invented. Quota and actual billing remain unknown unless you supply evidence. Account-wide usage while other chats are active cannot be attributed to this benchmark.

The automated test suite exercises the benchmark without provider authentication or paid model calls. Live agent integration and each selected image's gold/no-op controls must be checked on your benchmark host before interpreting results.

Ship accounting comes from OpenCode's persisted assistant-message token records, including corrections and additional sessions in that trial. `ship-usage.json` retains only message/session/model identifiers, numeric usage, completion markers, and harness cost; prompts, tool contents, and authentication are excluded. The controller reads the stopped container's database and WAL before deletion, then removes its temporary database copies. Full-conversation export is supplementary and its failure does not discard measured usage. Reports include Ship input, cache reads/writes, output, reasoning, assistant-message count, and API-equivalent cost. Interrupted or missing records leave the complete total unknown; `ship_tokens_observed` and known costs retain measured lower bounds. Unexpected models remain visible in the trial's per-model breakdown, but do not receive the configured model's tariff. Assistant-message counts are not HTTP request counts, and harness costs are not invoices. Historical usage cannot be reconstructed after both the original database and valid exports have been lost.

## License

[Apache 2.0](LICENSE)
