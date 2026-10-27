# Specship benchmarks

This directory contains the reproducible benchmark harness for Specship. It compares coding workflows on a frozen sample of SWE-bench Lite tasks and records quality, usage, and API-equivalent cost separately.

The harness is intentionally conservative:

- cases are frozen and hashed before any model runs;
- gold patches and grading data stay on the controller, never in the agent container;
- model calls require an explicit `--execute`;
- missing usage, prices, billing, or grading data stay `null` instead of becoming estimates;
- benchmark homes are private and separate from normal Specship runs.

## What it compares

| Arm | Workflow |
|---|---|
| `codex` | One Codex coding agent |
| `ship` | One OpenCode coding agent |
| `specship` | Codex as Spec + OpenCode as Ship |
| `specship-dsh` | Codex as Spec + DeepSeek Harness as Ship |
| `codex-opencode` | Codex launches and supervises OpenCode through the shell, without Specship |

The default arms are `codex` and `specship`. Add or remove arms in `config.json`.

For an unseen follow-up sample, choose a new benchmark home and seed, set `dataset`
to `SWE-bench/SWE-bench_Verified` (or another evaluator-compatible SWE-bench dataset),
and optionally set `exclude_instance_ids` to earlier case IDs. `fetch` filters those
IDs before deterministic selection and records the exclusions in the frozen lock.
If too few eligible cases remain, selection fails rather than silently shrinking
the sample. Freeze the set before model execution; do not replace difficult cases.

For a direct supervision comparison, set `arms` to `["specship", "codex-opencode"]`.
Both arms use the same `spec` and `ship` models, reasoning efforts, frozen cases,
timeouts, and held-out evaluator, with arm order rotating across cases/repetitions.
The direct arm receives a compact delegation/review prompt and the exact OpenCode
CLI invocation; Codex owns launch, waiting, session continuation, and review without
Specship skills or MCP registration. Its final explicit verdict supplies `accepted`,
while durable OpenCode usage must confirm delegation and the configured model.
Both models' usage counts toward cost, including correction calls. A verdict is
self-reported review evidence; held-out grading determines correctness for both arms.
This comparison measures ordinary task execution, not interruption/recovery guarantees.

`specship-dsh` uses the official DeepSeek API-key route (`deepseek-official/...`) inside the Linux benchmark container. It requires `DEEPSEEK_API_KEY` and `auth.mode: "api"`; saved Codex/OpenCode subscription auth does not apply to this arm. Quality is measured normally, but DSH usage and API-equivalent cost remain `null` because the benchmark does not have a durable DSH token-usage export yet.

## Prerequisites

| Tool | Requirement |
|---|---|
| Node.js | 22 or newer |
| Docker | A working daemon; Linux containers with `linux/amd64` support |
| Python | 3.10+ for the SWE-bench evaluator |
| Codex | Installed and authenticated for the `codex`, `codex-opencode`, `specship`, and `specship-dsh` arms |
| OpenCode | Installed and authenticated for the `ship`, `codex-opencode`, and `specship` arms |
| DeepSeek API key | `DEEPSEEK_API_KEY` for the `specship-dsh` arm |

The controller uses Docker. The agent runs inside disposable `swebench/sweb.eval.x86_64.*` containers and never receives the benchmark cases or gold patches.

Prepared images are checked against each task's frozen base commit. If their
prepared Git tree contains source changes, tracked source is restored to that base
inside the disposable container, preserving installed dependencies and untracked
build artifacts. Preflight and trial results record both the prepared head and
whether restoration was needed; the original repository history is then removed
before a model runs.

## Put the DeepSeek API key in `.specship/.env`

> [!IMPORTANT]
> The DSH benchmark arm reads the DeepSeek API key from **`<project>/.specship/.env`**. Do not put the key in `config.json`, do not commit it, and do not pass it on the command line.

Create the file once:

```powershell
notepad C:\path\to\your-project\.specship\.env
```

It should contain one line:

```ini
DEEPSEEK_API_KEY=your-deepseek-api-key
```

The benchmark loads this file automatically before running. The Specship `setup` command creates the same `.specship/.env` when installing into a project, and preserves it on re-runs. A real environment variable with the same name takes precedence. `.specship/` is gitignored.

`npm run benchmark -- init` also writes `.specship/.env.example`, so a fresh benchmark checkout makes this obvious. Copy it to `.specship/.env` and fill in the key. Keep the file readable only by your account.

This is the benchmark credential. The DeepSeek Harness **desktop app** stores its own login in DSH settings; the benchmark does not read that.

## One-time setup

From the repository root:

```sh
npm ci
npm run build
npm run benchmark -- init
```

`init` creates `.specship/benchmark/config.json` with no models selected. Edit it before running anything paid.

### Configuration

```json
{
  "schema": 1,
  "dataset": "SWE-bench/SWE-bench_Lite",
  "dataset_config": "default",
  "split": "test",
  "sample_size": 5,
  "seed": "specship-v1",
  "repetitions": 1,
  "timeout_seconds": 1800,
  "docker": "docker",
  "python": "python",
  "codex_version": "0.162.0-alpha.17.2",
  "opencode_version": "1.18.30",
  "dsh_version": "0.2.1-rc.2",
  "instance_image": "swebench/sweb.eval.x86_64.{instance_id}:latest",
  "swebench_version": "5.0.2",
  "arms": ["codex", "specship", "specship-dsh"],
  "spec": {
    "model": "your-spec-model",
    "effort": "high",
    "rates": null
  },
  "ship": {
    "model": "opencode-go/deepseek-v4-pro",
    "effort": "high",
    "rates": null
  },
  "dsh": {
    "model": "deepseek-official/deepseek-v4-flash",
    "effort": "high",
    "rates": null
  },
  "auth": {
    "mode": "api",
    "codex_file": "C:/Users/you/.codex/auth.json",
    "opencode_file": "C:/Users/you/.local/share/opencode/auth.json"
  },
  "credential_env": ["DEEPSEEK_API_KEY"]
}
```

Key fields:

- **`sample_size`** and **`seed`** select a deterministic subset of the dataset. Freeze them before the first fetch.
- **`spec.model`** is the model Codex uses to plan and review.
- **`ship`** is the OpenCode implementation config. Use any model OpenCode advertises, including DeepSeek, for example `opencode-go/deepseek-v4-pro`.
- **`dsh`** is the DeepSeek Harness implementation config; `specship-dsh` uses it, so OpenCode and DSH arms can run with different models in the same benchmark.
- **`effort`** is the model's reasoning effort when supported.
- **`rates`** are optional USD-per-million-token rates. Without them, token counts remain visible but cost stays unknown.
- **`timeout_seconds`** is the per-attempt wall-clock limit, including waiting for a Ship decision.
- **`repetitions`** repeats each case and arm.
- **`auth.mode`** is `subscription` or `api`.

Keep secrets out of `config.json`. For API mode, name environment variables in `credential_env`; the controller passes only those values into the agent container. The DSH key belongs in `.specship/.env`, not in the JSON.

### Subscription auth

Use your saved Codex and OpenCode logins for the `codex`, `ship`, `codex-opencode`, and `specship` arms:

```json
"auth": {
  "mode": "subscription",
  "codex_file": "C:/Users/you/.codex/auth.json",
  "opencode_file": "C:/Users/you/.local/share/opencode/auth.json"
}
```

The harness rejects API-key fallback for saved subscription logins and strips unrelated credential variables from the agent environment.

### API auth

```json
"auth": { "mode": "api" },
"credential_env": ["CODEX_API_KEY", "OPENAI_API_KEY", "DEEPSEEK_API_KEY"]
```

Put the values in `.specship/.env`; the benchmark loads it. Do not put raw keys in `config.json`.

For `specship-dsh`, add `DEEPSEEK_API_KEY` to `credential_env` and put the key in `.specship/.env`. The container installs DSH and uses the official DeepSeek API-key route; no saved DSH desktop login is copied.

## Freeze the dataset

```sh
npm run benchmark -- fetch
```

This downloads the selected SWE-bench split, validates its revision, selects the seeded cases, and writes a hash-locked `cases.lock.json`. If the dataset changes during download, the command fails instead of mixing revisions.

## Verify the setup

```sh
npm run benchmark -- doctor
npm run benchmark -- plan
```

`doctor` checks authentication, Docker, the evaluator, the local `.env`, and whether `DEEPSEEK_API_KEY` is present without printing it. `plan` shows the exact cases, arms, repetitions, attempt count, models, and whether paid calls are enabled. Neither command calls a model.

Optional evaluator sanity check:

```sh
npm run benchmark -- controls
```

Controls grade a gold patch and a no-op patch for every frozen case. They do **not** call a model, but they do build and run Docker images and can take a while.

To grade with an already built evaluator while registry access is unavailable, set
`grader_image_id` to its exact local `sha256:...` image ID in `config.json`.
The controller verifies the installed `swebench` version against `swebench_version`
and records the immutable image ID with each grade. Without this option it builds
the evaluator normally. Incomplete grading returns a nonzero exit code while
preserving saved patches and usage; retrying `grade` never calls a model.

## Inspect before spending

```sh
npm run benchmark -- build
npm run benchmark -- preflight
```

`build` builds the agent image for each case. `preflight` verifies the image's base commit, Node, Codex, OpenCode, and DSH versions without submitting a prompt.

## Run

Paid model calls are disabled unless you pass `--execute`:

```sh
npm run benchmark -- run --execute
```

For a future authorized comparison, `node scripts/benchmark.mjs run --execute --finish --home <benchmark-home>` runs the trials, grades the same run, and writes its report in one controller invocation. `--finish` alone remains a dry run. The controller writes `runs/<run-id>/progress.json`, trial artifacts, `grade.log`, `report.log`, and `summary.json`; no model is needed to discover the run ID, monitor progress, or coordinate grading. Redirect the controller's output to a local log and let it finish; avoid a supervisor chat repeatedly reading logs, sleeping, or issuing status commentary while it runs. A stopped provider route remains stopped; model-free grading/reporting can still preserve the partial results. The controller exits `0` when the run completes and its report is written. Docker build progress is still written to stderr, so a wrapper must read the process exit code (PowerShell: `$LASTEXITCODE`) rather than treating stderr output, or PowerShell's `$?`, as a failure signal.

Limit a run while developing the harness:

```sh
npm run benchmark -- run --execute --arm specship
npm run benchmark -- run --execute --arm specship-dsh
npm run benchmark -- run --execute --arm specship-dsh --case django__django-11848
```

The DSH arm is slower to start because its image installs the DSH package and its preflight initializes a real ACP session. Its quality result is directly comparable, but its token and cost fields stay `null` until DSH usage accounting is added.

Each trial writes:

```text
.specship/benchmark/runs/<run-id>/
  manifest.json
  <case>--<arm>--<repeat>/
    result.json
    patch.diff
    events.jsonl
    stderr.log
    protocol.json
    ship-usage.json
```

The controller stops the container, recovers durable Ship usage, and removes the container even when the agent fails or times out.

Set `ship_first: true` to run the first planned standalone Ship trial before any Codex coordinator work; remaining arms keep their normal rotation. The plan records the exact trial order. Nonretryable authentication, provider, or credit errors stop the remaining batch and are recorded in the run manifest. No completed trials are retried automatically.

## Grade and report

```sh
npm run benchmark -- grade --run <run-id>
npm run benchmark -- report --run <run-id>
```

`grade` applies the official SWE-bench evaluator to each patch. `report` writes `summary.json` and prints quality and cost aggregates.
Empty patches remain ungraded with an explicit explanation and a null resolution.

Quality and cost are deliberately separate:

- `resolved` and `accepted` measure whether the fix worked and whether Spec accepted it;
- `api_equivalent_usd` estimates what the tokens would cost at the configured rates;
- `actual_billed_usd` is only set when explicit billing evidence exists;
- `specship-dsh` quality is measured, but DSH usage and cost remain `null` until a durable DSH token export exists;
- missing data stays `null`.

A false acceptance is a trial where Spec accepted the report but SWE-bench did not resolve the issue. It is counted separately from a normal failure.

## Tests

`npm run check` includes benchmark contract tests: case selection, accounting, DSH preflight shape, DSH arm planning, and fail-closed authentication. They do not call a model. A real quality result still requires `run --execute` with valid credentials.

## Benchmark safety

- The agent container receives the repository at the declared base commit and a problem statement. It does not receive the dataset, gold patch, test patch, or controller files.
- Gold patches and grading happen on the controller and in the trusted evaluator container.
- Network access stays enabled because model providers need it. This means public-task contamination and network-assisted solving are possible; report them as caveats, not as clean-room results.
- The `specship` and `specship-dsh` arms run unattended, so the generated Ship profile answers path prompts by configuration instead of waiting for a human: `external_directory` is allowed and `webfetch` is denied, matching the standalone `ship` arm. `question` and `task` stay denied for every profile. Each dispatch is also capped at `timeout_seconds - 300`, so a stalled attempt records `limit_reached` instead of being killed at the container timeout.
- The benchmark is for comparing workflows, not for producing an official SWE-bench leaderboard submission.
