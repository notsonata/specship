# Specship

Turn an ambiguous coding request into a precise implementation contract, execute the whole contract, and optionally review the result in a fresh session.

Specship provides two project-scoped skills:

- **`/spec`** investigates the repository and writes a decision-complete plan.
- **`/ship`** implements that plan, validates its requirements, and records concise evidence.

The plan folder is the handoff. Planning and implementation can happen in separate agents, sessions, or model providers without relying on shared chat history.

> **Status:** Specship v0.7 is a public source preview. It is being dogfooded and is not yet presented as production-ready.

## Why use Specship?

Coding agents often lose time in one of two places: an executor has to rediscover decisions that should have been settled during planning, or it quietly fills gaps with assumptions that change the intended result.

Specship separates those responsibilities:

| Skill | Responsibility | Boundary |
| --- | --- | --- |
| `/spec` | Investigate, resolve ambiguity, select an approach, and define observable success. | Never implements source changes. |
| `/ship` | Execute every task in one explicit plan and prove the mapped requirements. | Never edits the plan or invents product and architecture decisions. |

This gives the executor a concrete starting point, exact files and symbols, ordered tasks, preserved behavior, testable requirements, and proportionate validation commands.

## How it works

```text
/spec <request>
      |
      v
docs/plans/<plan>/PLAN.md
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

`/spec` reads the repository's instructions and relevant documentation, inspects the affected implementation and tests, resolves material decisions, and writes one self-contained `PLAN.md`.

The plan includes:

- a short executor brief and exact starting point;
- testable requirement IDs;
- explicit in-scope and out-of-scope behavior;
- verified repository evidence;
- one selected implementation approach;
- a file-and-symbol change map;
- dependency-ordered tasks;
- targeted tests, validation, and acceptance criteria; and
- optional integration gates when a task closes a meaningful integration boundary.

Planning also identifies sound mechanisms to reuse or extend. For migrations, replacements, and removals, it inventories maintained callers and affected surfaces so the executor does not mistake a narrow passing test for complete coverage.

When planning finishes, `/spec` returns the exact folder and handoff command.

### 2. Implement the complete plan

Open a separate execution session if you want a clean context, then use the handoff exactly as written:

```text
/ship implement this plan: docs/plans/organization-switching
```

`/ship` reads the plan, reconciles any existing execution evidence, and starts with the first incomplete task. Each task follows one local loop to inspect, implement, verify, self-review, fix, and reverify:

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

The executor records one concise result after reaching the task's terminal state. It continues through every ready task automatically; `/ship` is not a task picker and does not stop after an arbitrary subset of the plan.

If a task defines an integration gate, `/ship` checks the named code, diff, behavior, or boundary rather than trusting its own summary. At completion it inspects the integrated result for requirement coverage, regressions, appropriate reuse, scope compliance, and complexity proportional to the repository and requested outcome.

Every successful `/ship` result ends with the exact review command for the active plan folder, ready to copy into the review session:

```text
/spec review docs/plans/organization-switching
```

### 3. Review when the risk justifies it

Run an independent review from a planning/review session:

```text
/spec review docs/plans/organization-switching
```

Review checks the repository itself, not just `RESULTS.md`. It verifies requirements, acceptance criteria, preserved behavior, changed surfaces, integration gates, validation claims, reuse, duplicate mechanisms, and concrete complexity risks.

Every review creates the next numbered folder, starting with `reviews/round-001/`, and writes that round to `REVIEW.md`. Review produces one of three outcomes:

- **Pass** — checked requirements pass and no corrective finding remains.
- **Changes required** — bounded implementation defects remain; `/spec` writes decision-complete corrective work into that round's `REVIEW.md` without changing `PLAN.md`.
- **Blocked** — required evidence, access, or a material decision is missing.

Each review is durable, including passing and blocked reviews. Findings receive stable IDs from their round, such as `R1-F1`, so later reviews can resolve earlier issues without overwriting history.

Review does not expand the product contract. A corrective finding must violate an existing requirement, acceptance criterion, scope boundary, or preserved behavior. Issues requiring new behavior are reported as out-of-scope observations and do not prevent a passing contract review.

Re-review verifies earlier findings and the corrective changes without starting another unrestricted audit. A new finding must be either a regression introduced by the corrections or a newly evidenced violation of the frozen contract in the corrected integrated result.

After a `Changes required` review, `/spec` reports the findings and validation, identifies the new review folder, and ends with the exact prompt to send to the existing execution session:

```bash
/ship implement this plan: docs/plans/organization-switching
```

That corrective `/ship` run writes only to the same round folder's `RESULTS.md`. Root `RESULTS.md` remains reserved for non-review execution. A subsequent `/spec review` creates the next folder, such as `reviews/round-002/`.

## The plan folder

Each request gets one plain kebab-case folder:

```text
docs/plans/<plan>/
├── PLAN.md                       # contract created and owned by /spec
├── RESULTS.md                    # non-review execution evidence owned by /ship
└── reviews/
    ├── round-001/
    │   ├── REVIEW.md             # first review owned by /spec
    │   └── RESULTS.md            # first corrective execution owned by /ship
    └── round-002/
        ├── REVIEW.md             # second review owned by /spec
        └── RESULTS.md            # second corrective execution, when needed
```

`PLAN.md` remains unchanged while `/ship` executes it. Root `RESULTS.md` makes initial execution and non-review plan updates resumable. Each review correction cycle keeps its own review and execution evidence together, so later rounds never rewrite or contaminate earlier bookkeeping. On resume, `/ship` verifies the active execution record against the repository before deciding what remains.

Git preserves contract history. Specship does not add a separate lifecycle database, repository fingerprint, scheduler, or mandatory handover document.

## Changes, blockers, and corrections

Use `/spec update` when new information outside a review requires the contract to change:

```text
/spec update docs/plans/organization-switching with this new requirement
```

An update is appropriate when:

- the user changes or adds a requirement;
- repository changes invalidate a plan assumption;
- `/ship` discovers a missing product or architecture decision;
- the named files or boundaries no longer match reality; or
- new user or repository information requires clarified contract work before the next review.

`/spec update` rewrites every affected part of `PLAN.md` so it remains internally consistent and self-contained. Existing execution evidence is preserved; `/ship` reconciles stale entries when it resumes.

For a `Changes required` review, no plan update is performed. The round's `REVIEW.md` contains the open findings, exact corrective work, affected files and symbols, preserved constraints, regression coverage, and validation. `/ship` evaluates and executes that review directly, then records evidence in the same round's `RESULTS.md`. `PLAN.md` stays frozen and review never adds requirements or broadens scope.

Review never revises `PLAN.md`, and there is no fixed correction-round limit. Every explicit `/spec review` creates the next numbered round and evaluates the current repository until the outcome is `Pass`, `Changes required`, or `Blocked`.

After review:

| Situation | Next action |
| --- | --- |
| The implementation is correct | Finish. |
| Review finds correctable implementation defects | Run `/ship` with the same plan folder; it executes the latest round's `REVIEW.md`, then review again. |
| Evidence, access, or a decision is missing | Resolve the blocker before continuing. |

## Safety and scope

Specship is intentionally strict about ownership:

- Repository instruction files remain authoritative.
- `/spec` asks only questions that can materially change the result.
- `/ship` preserves unrelated user changes and avoids unrelated cleanup.
- Missing material decisions return to `/spec`; they are not guessed during execution.
- Validation starts with the smallest relevant check and broadens only when risk or repository rules justify it.
- Full-suite runs are reserved for cross-cutting changes, explicit requirements, or meaningful regression risk.
- Complexity findings must identify correctness, maintenance, contract, integration, or scope risk—not personal style preferences.

## Installation

### Requirements

- Git
- Node.js 18 or newer for `npx skills`
- A coding agent that supports the open Agent Skills format

### Install globally

Install both skills for your supported agents:

```bash
npx skills add notsonata/specship --skill spec --skill ship --global --yes
```

Use `--agent <agent-id>` to select a target explicitly. Repeat the flag to install into multiple agents. Restart an agent if the new skills do not appear immediately.

### Install in one project

Run the same command from the target repository without `--global`:

```bash
npx skills add notsonata/specship --skill spec --skill ship --yes
```

### Install from a local clone

```bash
git clone https://github.com/notsonata/specship.git
cd specship
npx skills add . --skill spec --skill ship --global --yes
```

## Quick reference

| Goal | Command |
| --- | --- |
| Plan a new request | `/spec <request>` |
| Implement a plan | `/ship implement this plan: docs/plans/<plan>` |
| Update a plan | `/spec update docs/plans/<plan> <new information>` |
| Review an implementation | `/spec review docs/plans/<plan>` |
| Correct work already covered by the plan | Run `/ship` again with the same folder. |

Always name the exact plan folder for implementation, update, and review. Specship never guesses the newest plan or combines multiple plan folders.

## Model and agent compatibility

Specship does not require a particular model provider or subagent system. The contract is plain Markdown, so planning and execution can use different compatible coding agents. A more capable planning model can resolve ambiguity and architecture while a faster or less expensive execution model follows the completed contract.

The quality of execution still depends on the selected agent's ability to edit the repository, run the required tools, and follow project instructions.

## Project status

Specship is an early public preview. The current focus is dogfooding the workflow across small fixes, multi-task features, interrupted execution, contract updates, correction loops, and passing and failing reviews. New protocol machinery is added only when repeated use demonstrates a concrete failure that simpler instructions and repository evidence cannot address.
