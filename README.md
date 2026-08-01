# Specship

Specship is a two-model workflow for Codex that separates high-judgment specification and review from full-plan implementation:

- **`$spec`** uses a stronger model to investigate, clarify material ambiguity, write a sealed implementation contract, review the result, and explicitly finalize confirmed work.
- **`$ship`** uses a faster workhorse model to implement or resume the complete sealed plan, validate it, and record revision-pinned evidence.

The skills communicate through durable Markdown artifacts under `docs/plans/`, so they can run in separate Codex conversations without shared chat history.

> **Status: public source preview.** The repository is public so the workflow can be installed across devices and dogfooded in real projects. Specship is not considered publicly released, production-ready, or ready for a skills.sh or plugin submission yet.
>
> **Built for Codex.** Specship is designed and validated around Codex skill discovery, `$skill` invocation, repository instructions, and shared-workspace behavior. Other Agent Skills-compatible tools are currently unverified.

## Why Specship?

Planning and implementation reward different strengths. A strong model is most useful when resolving ambiguity, understanding architecture, defining observable success, and reviewing the result. Once that judgment becomes a precise contract, a faster model can execute the bounded work without rediscovering product intent.

Specship makes that division auditable:

```text
$spec plan
    |
    v
Sealed, versioned plan contract
    |
    v
$ship implements the complete plan
    |
    v
$spec review
    |-- issues remain --> new contract revision --> $ship --> $spec review
    `-- review passes --> user confirmation --> $spec finalize
```

`$spec` never implements, even for a tiny fix. `$ship` never executes only one selected task: it implements or resumes one complete plan and then stops for review.

## Responsibilities

| Skill | Recommended model | Responsibilities | Must not do |
| --- | --- | --- | --- |
| `$spec` | Higher-intelligence model | Investigate, clarify material ambiguity, write and seal contracts, review implementation, finalize confirmed work | Implement source changes, hide material assumptions, edit execution history, finalize without confirmation |
| `$ship` | Faster workhorse model | Implement every runnable task in one plan, run validation, append evidence, resume interrupted execution | Edit the contract, invent requirements, broaden scope, review, update canonical completion docs |

## Plan contract

Every request receives a plain-slug folder:

```text
docs/plans/<plan>/
|-- CONTEXT.md   # Request, evidence, questions, decisions, assumptions
|-- SPEC.md      # Requirements, constraints, behavior, acceptance criteria
|-- PLAN.md      # Ordered full-plan implementation tasks
|-- STATE.md     # Lifecycle, revision, digest, baselines, task state
|-- RESULTS.md   # Append-only execution evidence from $ship
`-- REVIEW.md    # Append-only review and finalization evidence from $spec
```

The ownership boundary is strict:

| Artifact | Owner | Rule |
| --- | --- | --- |
| `CONTEXT.md`, `SPEC.md`, `PLAN.md` | `$spec` | Immutable after sealing; any change starts a new contract revision |
| `STATE.md` | Bundled validator after bootstrap | `$spec` creates it from the template; later lifecycle and task state are validator-managed |
| `RESULTS.md` | `$ship` | Append-only and pinned to the contract revision and digest |
| `REVIEW.md` | `$spec` | Append-only and pinned to the reviewed revision and digest |

Sealing records a SHA-256 digest of the three contract artifacts plus the Git HEAD, branch, unrelated dirty-file set, and dirty-content fingerprint. `$ship` refuses to start if the contract was edited or the repository baseline drifted. State mutations also revalidate the active contract. A new `$spec refine` revision invalidates old completion state rather than letting stale evidence satisfy a changed plan.

## Workflow

Use separate Codex conversations. The repository and plan folder are the handoff mechanism.

### 1. Plan with the strong model

Open a conversation using the stronger model:

```text
$spec Add organization switching to the account settings flow.
```

`$spec` investigates before asking questions. It asks only when ambiguity can materially change the contract; a precise request may need no questions. Blocking questions and their answers remain in `CONTEXT.md`.

When ready, `$spec` seals the contract and gives the exact handoff command. To incorporate new information or repository drift:

```text
$spec refine docs/plans/organization-switching
```

### 2. Implement the complete plan with the workhorse

Open a separate conversation using the workhorse model:

```text
$ship implement this plan: docs/plans/organization-switching
```

`$ship` validates the digest and Git baseline, executes every pending task in dependency order, runs task-level and plan-wide validation, appends evidence to `RESULTS.md`, and stops after the complete plan is implemented.

If the conversation is interrupted while `STATE.md` is `InProgress`, the same command in a new workhorse conversation resumes the full plan without repeating completed tasks. If implementation exposes a material contract ambiguity, `$ship` records the blocker without editing the contract and returns control to `$spec refine`.

### 3. Review with the strong model

Return to the strong-model conversation:

```text
$spec review docs/plans/organization-switching
```

Review checks the actual changes against the exact sealed revision and appends a round to `REVIEW.md`.

- When issues remain, `$spec` creates and seals a new revision with bounded corrective tasks. It does not fix them.
- When checks pass, the plan becomes `ReadyForConfirmation`.
- Review never writes post-implementation canonical project updates.

### 4. Finalize only after confirmation

After personally confirming the result:

```text
$spec finalize docs/plans/organization-switching
```

Only finalization updates applicable project records such as `docs/tasks.md`, `docs/devlog.md`, and affected setup, testing, API, UI, architecture, or codebase-map documentation.

## Lifecycle

```text
Draft -> AwaitingClarification -> Ready -> InProgress
                                      |-> Blocked -> new revision
                                      |-> Failed  -> new revision
                                      `-> Implemented
                                            |-> ChangesRequired -> new revision
                                            `-> ReadyForConfirmation -> Finalized
```

Lifecycle and task transitions are performed by the bundled validator, not by prose edits.

## Installation

### Requirements

- Git
- Node.js 18 or newer for `npx skills`
- Codex

### Install globally for Codex

Install both skills directly from the public repository for personal testing:

```bash
npx skills add notsonata/specship --skill spec --skill ship --agent codex --global --yes
```

Restart Codex if the skills do not appear. Type `$` and select `Spec` or `Ship`; these are dollar-invoked skills, not slash commands.

### Install into one project

Omit `--global` while inside the target repository:

```bash
npx skills add notsonata/specship --skill spec --skill ship --agent codex --yes
```

### Install from a local clone

```bash
git clone https://github.com/notsonata/specship.git
cd specship
npx skills add . --skill spec --skill ship --agent codex --global --yes
```

To update, pull the clone and run the same `npx skills add .` command again.

## Repository layout

```text
.
|-- .agents/skills/
|   |-- spec/
|   |   |-- SKILL.md
|   |   |-- agents/openai.yaml
|   |   |-- references/
|   |   `-- scripts/validate_plan.py
|   `-- ship/
|       |-- SKILL.md
|       |-- agents/openai.yaml
|       |-- references/
|       `-- scripts/validate_plan.py
`-- README.md
```

Each skill contains its own validator and protocol references so it remains self-contained when installed.

## Development and validation

Run before committing a skill change:

```bash
python3 /path/to/skill-creator/scripts/quick_validate.py .agents/skills/spec
python3 /path/to/skill-creator/scripts/quick_validate.py .agents/skills/ship
npx skills add . --list
```

## Dogfooding gate

The source can remain public while the workflow stays an unreleased preview. Do not submit it to skills.sh, package it as a plugin, or describe it as production-ready until it has passed repeated end-to-end use across real projects.

At minimum, test:

- a precise one-file fix that needs no clarification;
- a multi-task feature and a migration with rollback concerns;
- an execution blocker returned to `$spec refine`;
- stale Git and dirty-worktree baselines;
- interrupted full-plan execution resumed in a new conversation;
- a failed review followed by corrective work;
- a passing review where finalization is delayed or declined;
- refinement after partial implementation.

Before considering a public release, also choose a license, evaluate skill-name collisions, decide whether plugin packaging is useful, test supported Codex surfaces, and review every protocol guarantee during dogfooding.
