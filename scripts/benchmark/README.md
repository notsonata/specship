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

The default arms are `codex` and `specship`. Add or remove arms in `config.json`.

`specship-dsh` uses the official DeepSeek API-key route (`deepseek-official/...`) inside the Linux benchmark container. It requires `DEEPSEEK_API_KEY` and `auth.mode: "api"`; saved Codex/OpenCode subscription auth does not apply to this arm. Quality is measured normally, but DSH usage and API-equivalent cost remain `null` because the benchmark does not have a durable DSH token-usage export yet.

## Prerequisites

| Tool | Requirement |
|---|---|
| Node.js | 22 or newer |
| Docker | A working daemon; Linux containers with `linux/amd64` support |
| Python | 3.10+ for the SWE-bench evaluator |
| Codex | Installed and authenticated for the `codex`, `specship`, and `specship-dsh` arms |
| OpenCode | Installed and authenticated for the `ship` and `specship` arms |
| DeepSeek API key | `DEEPSEEK_API_KEY` for the `specship-dsh` arm |

The controller uses Docker. The agent runs inside disposable `swebench/sweb.eval.x86_64.*` containers and never receives the benchmark cases or gold patches.

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
    "model": "provider/your-ship-model",
    "effort": "high",
    "rates": null
  },
  "dsh": {
    "model": "deepseek-official/deepseek-flash",
    "effort": "high",
    "rates": null
  },
  "auth": {
    "mode": "subscription",
    "codex_file": "C:/Users/you/.codex/auth.json",
    "opencode_file": "C:/Users/you/.local/share/opencode/auth.json"
  },
  "credential_env": []
}
```

Key fields:

- **`sample_size`** and **`seed`** select a deterministic subset of the dataset. Freeze them before the first fetch.
- **`spec.model`** is the model Codex uses to plan and review.
- **`ship`** is the OpenCode implementation config.
- **`dsh`** is the DeepSeek Harness implementation config; `specship-dsh` uses it, so OpenCode and DSH arms can run with different models in the same benchmark.
- **`effort`** is the model's reasoning effort when supported.
- **`rates`** are optional USD-per-million-token rates. Without them, token counts remain visible but cost stays unknown.
- **`timeout_seconds`** is the per-attempt wall-clock limit, including waiting for a Ship decision.
- **`repetitions`** repeats each case and arm.
- **`auth.mode`** is `subscription` or `api`.

Keep secrets out of `config.json`. For API mode, name environment variables in `credential_env`; the controller passes only those values into the agent container.

### Subscription auth

Use your saved Codex and OpenCode logins for the `codex`, `ship`, and `specship` arms:

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

Set those variables in the controller environment. Do not put raw keys in the file.

For `specship-dsh`, add `DEEPSEEK_API_KEY` to `credential_env` and set it before running. The container installs DSH and uses the official DeepSeek API-key route; no saved DSH desktop login is copied.

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

`doctor` checks authentication, Docker, and the evaluator. `plan` shows the exact cases, arms, repetitions, attempt count, models, and whether paid calls are enabled. Neither command calls a model.

Optional evaluator sanity check:

```sh
npm run benchmark -- controls
```

Controls grade a gold patch and a no-op patch for every frozen case. They do **not** call a model, but they do build and run Docker images and can take a while.

## Inspect before spending

```sh
npm run benchmark -- build
npm run benchmark -- preflight
```

`build` builds the agent image for each case. `preflight` verifies the image's base commit, Node, Codex, and OpenCode versions without submitting a prompt.

## Run

Paid model calls are disabled unless you pass `--execute`:

```sh
npm run benchmark -- run --execute
```

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

## Grade and report

```sh
npm run benchmark -- grade --run <run-id>
npm run benchmark -- report --run <run-id>
```

`grade` applies the official SWE-bench evaluator to each patch. `report` writes `summary.json` and prints quality and cost aggregates.

Quality and cost are deliberately separate:

- `resolved` and `accepted` measure whether the fix worked and whether Spec accepted it;
- `api_equivalent_usd` estimates what the tokens would cost at the configured rates;
- `actual_billed_usd` is only set when explicit billing evidence exists;
- `specship-dsh` quality is measured, but DSH usage and cost remain `null` until a durable DSH token export exists;
- missing data stays `null`.

A false acceptance is a trial where Spec accepted the report but SWE-bench did not resolve the issue. It is counted separately from a normal failure.

## Benchmark safety

- The agent container receives the repository at the declared base commit and a problem statement. It does not receive the dataset, gold patch, test patch, or controller files.
- Gold patches and grading happen on the controller and in the trusted evaluator container.
- Network access stays enabled because model providers need it. This means public-task contamination and network-assisted solving are possible; report them as caveats, not as clean-room results.
- The benchmark is for comparing workflows, not for producing an official SWE-bench leaderboard submission.
