# Specship

Turn an ambiguous coding request into a precise implementation contract, execute the complete contract with one executor, and independently review the result.

Specship provides three portable Agent Skills:

- **spec** investigates a repository and writes or reviews a decision-complete contract.
- **spec-visual** follows the same contract protocol while adding a grounded visual review surface for plans.
- **ship** implements one complete contract, validates every mapped requirement, and records concise evidence.

The plan folder is the handoff. Planning, implementation, and review can happen in separate sessions, agents, or model providers without relying on shared chat history.

> **Status:** Specship v0.8 is a public source preview. It is being dogfooded and is not yet presented as production-ready.

## Why use Specship?

Coding agents often lose time in one of two places: an executor has to rediscover decisions that should have been settled during planning, or it quietly fills gaps with assumptions that change the intended result.

Specship separates those responsibilities:

| Skill | Responsibility | Boundary |
| --- | --- | --- |
| spec | Investigate, resolve ambiguity, select an approach, and define observable success. | Never implements source changes. |
| spec-visual | Do everything `spec` does and publish diagrams, file maps, wireframes, prototypes, or structured review blocks when they help. | Visual artifacts supplement `PLAN.md`; it never implements source changes. |
| ship | Execute every task in one explicit plan and prove the mapped requirements. | Never edits the plan or invents product or architecture decisions. |

The result is a concrete execution contract with exact files and symbols, dependency-ordered tasks, preserved behavior, testable requirements, and proportionate validation commands.

Specship uses a single executor. It does not require a coordinator, subagent swarm, particular model, or shared conversation state.

## Invocation syntax

Use the syntax native to your agent host:

| Host | Plan or review | Implement |
| --- | --- | --- |
| Codex | `$spec ...` or `$spec-visual ...` | `$ship ...` |
| Slash-command hosts | `/spec ...` or `/spec-visual ...` | `/ship ...` |
| Other Agent Skills hosts | Select or invoke the installed `spec`, `spec-visual`, or `ship` skill using the host's skill interface. | Same. |

Examples in the workflow below use slash-command syntax as protocol notation. In Codex, replace `/spec` with `$spec`, `/spec-visual` with `$spec-visual`, and `/ship` with `$ship`. Each skill returns ready-to-copy handoffs in the active host's native syntax.

## How it works

```text
/spec <request>
      |
      v
docs/plans/<plan>/PLAN.md (revision 1)
      |
      v
/ship implement this plan: docs/plans/<plan>
      |
      v
docs/plans/<plan>/RESULTS.md
      |
      v
optional /spec review docs/plans/<plan>
      |
      v
docs/plans/<plan>/reviews/round-001/REVIEW.md
      |
      v (when changes are required)
/ship writes reviews/round-001/RESULTS.md
```

### 1. Create the contract

Start a planning session and describe the outcome you want:

```text
/spec Add organization switching to the account settings flow.
```

For UI-heavy, architecture-heavy, risky, or otherwise important work that benefits from visual approval, use the companion planner:

```text
/spec-visual Add organization switching to the account settings flow.
```

`spec-visual` keeps `docs/plans/<plan>/PLAN.md` as the exact executor contract and adds a hosted or local Agent-Native visual review surface. The visual artifact is supplementary, so `$ship` can execute the same plan even when the visual viewer is unavailable later.

`spec` reads repository instructions and relevant documentation, inspects the affected implementation and tests, resolves material decisions, and writes one self-contained `PLAN.md`.

The plan includes:

- an integer plan revision, starting at `1`;
- a short executor brief and exact starting point;
- testable requirement IDs;
- explicit in-scope, out-of-scope, and preserved behavior;
- verified repository evidence;
- one selected implementation approach;
- a file-and-symbol change map;
- dependency-ordered tasks;
- targeted tests, validation, and acceptance criteria; and
- optional integration gates for meaningful cross-task boundaries.

Planning also identifies sound mechanisms to reuse or extend. For migrations, replacements, and removals, it inventories maintained callers and affected surfaces so the executor does not mistake a narrow passing test for complete coverage.

When planning finishes, `spec` returns the exact folder and a host-native handoff command.

### 2. Implement the complete plan

Open a separate execution session if you want a clean context, then use the handoff exactly as written:

```text
/ship implement this plan: docs/plans/organization-switching
```

`ship` reads the current plan revision, reconciles existing execution evidence, and starts with the first incomplete task. Each task follows one local loop to inspect, implement, verify, self-review, fix, and reverify:

```text
inspect and inventory
        ↓
implement
        ↓
verify
        ↓
self-review
        ↓
fix and simplify
        ↓
reverify
```

The executor records one concise result after reaching the task's terminal state. It continues through every ready task automatically; `ship` is not a task picker and does not stop after an arbitrary subset of the plan.

If a task defines an integration gate, `ship` checks the named code, diff, behavior, or meaningful integration boundary rather than trusting its own summary. At completion it inspects the integrated result for requirement coverage, regressions, appropriate reuse, scope compliance, and complexity proportional to the repository and requested outcome.

Every task result and the execution summary record the plan revision. Every successful run ends with the exact host-native review command for the active plan folder.

### 3. Review when the risk justifies it

Run an independent review from a planning/review session:

```text
/spec review docs/plans/organization-switching
```

Review checks the repository itself, not just `RESULTS.md`. It verifies requirements, acceptance criteria, preserved behavior, changed surfaces, integration gates, validation claims, reuse, duplicate mechanisms, and concrete complexity risks.

Every review creates the next numbered folder, starting with `reviews/round-001/`, and writes a canonical `REVIEW.md` containing:

- the exact plan path and revision reviewed;
- one outcome: `Pass`, `Changes required`, or `Blocked`;
- the contract surfaces checked;
- the status of findings from earlier rounds;
- stable finding IDs with severity, evidence, contract mapping, required correction, affected files and symbols, preserved constraints, regression coverage, validation, and dependencies;
- requirement-by-requirement results;
- validation evidence, observations, and remaining risks.

Review outcomes mean:

- **Pass** — checked requirements pass and no in-bound corrective finding remains.
- **Changes required** — bounded implementation defects remain; `spec` writes decision-complete corrective work into that round's `REVIEW.md` without changing `PLAN.md`.
- **Blocked** — required evidence, access, or a material decision is missing.

Findings receive stable IDs from their round, such as `R1-F1`. Later reviews resolve or supersede earlier findings without overwriting history. A corrective finding must map to the existing contract; new product behavior is an observation, not an invented requirement.

After `Changes required`, run `ship` again with the same plan folder. It evaluates the active review, implements its findings, and records each finding's result in that round's `RESULTS.md`. Root `RESULTS.md` remains reserved for initial execution and non-review plan updates. A subsequent `spec review` creates the next review round.

No revision or correction loop runs implicitly, and there is no correction-round cutoff. Planning, execution, review, and correction happen only when explicitly invoked.

## The plan folder

Each request gets one plain kebab-case folder:

```text
docs/plans/<plan>/
├── PLAN.md                       # revisioned contract owned by spec
├── RESULTS.md                    # non-review execution evidence owned by ship
├── visual/                       # optional local MDX source owned by spec-visual
│   ├── plan.mdx
│   ├── canvas.mdx                # optional
│   └── prototype.mdx             # optional
└── reviews/
    ├── round-001/
    │   ├── REVIEW.md             # immutable review owned by spec
    │   └── RESULTS.md            # finding-scoped corrections owned by ship
    └── round-002/
        ├── REVIEW.md
        └── RESULTS.md
```

`PLAN.md` remains unchanged during execution and review. Each execution and review artifact records the plan revision it applies to. Each review correction cycle keeps its review and evidence together, so later rounds never rewrite earlier bookkeeping.

Git preserves contract history. Specship does not add a lifecycle database, state machine, repository fingerprint, manifest, scheduler, or mandatory handover document.

## Updating a plan

Use `spec update` when new information outside a review requires the contract to change:

```text
/spec update docs/plans/organization-switching with this new requirement
```

An update is appropriate when:

- the user changes or adds a requirement;
- repository changes invalidate a plan assumption;
- `ship` discovers a missing product or architecture decision;
- named files or boundaries no longer match reality; or
- new evidence requires clarified contract work before review.

Each explicit update increments the plan revision by exactly one and rewrites every affected part of `PLAN.md` so the contract remains consistent. It also adds a `Revision impact` section naming the exact tasks `ship` must revalidate, or `All tasks` when the whole contract changed.

Existing artifacts stay immutable. Results from an older revision may be stale and cannot prove a current-revision task complete. An unexecuted `Changes required` review from an older revision becomes historical and is treated as `Superseded by plan revision <current>`; the next `ship` run executes the updated plan into root `RESULTS.md`. The next review gets a new round against the current revision.

Review-only defects do not trigger a plan update. Their correction contract remains in that round's `REVIEW.md`.

## Safety and scope

Specship is intentionally strict about ownership:

- Repository instruction files remain authoritative.
- `spec` asks only questions that can materially change the result.
- `ship` preserves unrelated user changes and avoids unrelated cleanup.
- Missing material decisions return to `spec`; execution does not guess them.
- Validation starts with the smallest relevant check and broadens only when risk or repository rules justify it.
- Full-suite runs are reserved for cross-cutting changes, explicit requirements, or meaningful regression risk.
- Complexity findings identify correctness, maintenance, contract, integration, or scope risk—not personal style preferences.

## Installation

### Requirements

- Git
- Node.js 18 or newer for `npx skills`
- A coding agent that supports the open Agent Skills format

### Visual planning setup

The repository-local `spec-visual` skill is included; visual rendering needs an Agent-Native Plans surface as well:

- **Hosted plans:** install and authenticate the connector once for Codex with `npx -y @agent-native/core@latest skills add visual-plan --client codex`, then start a new Codex task so the `plan` tools load. If it is already registered, reconnect with `npx -y @agent-native/core@latest reconnect https://plan.agent-native.com --client codex`.
- **Local/private plans:** use `AGENT_NATIVE_PLANS_MODE=local-files` and the Agent-Native CLI's `plan local check`, `plan local serve`, and `plan local verify` commands against `docs/plans/<plan>/visual/`. No hosted Plan authentication is required. Use a Chromium-based browser for the local bridge.

The visual connector/CLI is optional for ordinary `$spec` and `$ship` workflows.

### Install globally

```bash
npx skills add notsonata/specship --skill spec --skill spec-visual --skill ship --global --yes
```

Use `--agent <agent-id>` to select a target explicitly. Repeat the flag to install into multiple agents. Restart an agent if the new skills do not appear immediately. A host that does not support global skill installation may be reported separately while supported hosts still install successfully.

### Install in one project

Run the same command from the target repository without `--global`:

```bash
npx skills add notsonata/specship --skill spec --skill spec-visual --skill ship --yes
```

### Install from a local clone

```bash
git clone https://github.com/notsonata/specship.git
cd specship
npx skills add . --skill spec --skill spec-visual --skill ship --global --yes
```

## Quick reference

The examples use slash-command syntax. Codex users should use `$spec`, `$spec-visual`, and `$ship`.

| Goal | Command |
| --- | --- |
| Plan a new request | `/spec <request>` |
| Plan with visual review | `/spec-visual <request>` |
| Implement a plan | `/ship implement this plan: docs/plans/<plan>` |
| Update a plan | `/spec update docs/plans/<plan> <new information>` |
| Review an implementation | `/spec review docs/plans/<plan>` |
| Correct reviewed work | Run `/ship` again with the same folder. |

Always name the exact plan folder for implementation, update, and review. Specship never guesses the newest plan or combines multiple plan folders.

## Model and agent portability

The contract and evidence are plain Markdown and contain no provider-specific execution state. Planning and execution may use different Agent Skills-compatible hosts or model providers, provided each selected agent can read and edit the repository, run the required tools, and follow project instructions. Host-native invocation is the only syntax-level difference described by the protocol.

## License

Licensed under the Apache License 2.0. See [LICENSE](LICENSE).

## Project status

Specship is an early public preview. The current focus is dogfooding the workflow across small fixes, multi-task features, interrupted execution, explicit contract updates, correction rounds, and passing and failing reviews. Protocol machinery is added only when repeated use demonstrates a concrete failure that simpler instructions and repository evidence cannot address.
