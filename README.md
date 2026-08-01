# Specship

Specship v0.5 is a lightweight two-model workflow for Codex:

- **`$spec`** uses a stronger model to investigate a repository and write a reliable implementation plan.
- **`$ship`** uses a faster workhorse model to implement the complete plan, validate it, and record the result.

The plan folder is the handoff, so the two skills can run in separate Codex conversations without shared chat history.

> **Status: public source preview.** Specship is being dogfooded and is not yet presented as production-ready or submitted to a skill registry.

## Why Specship?

Planning and implementation reward different strengths. A strong model is most useful when resolving ambiguity, understanding architecture, selecting an approach, and defining observable success. Once that judgment is captured in a self-contained Markdown plan, a faster model can execute it without rediscovering product intent.

Specship deliberately keeps this contract small:

```text
$spec plan
    |
    v
Self-contained PLAN.md
    |
    v
$ship implements the complete plan and writes RESULTS.md
    |
    v
Optional $spec review and REVIEW.md
```

`$spec` never implements source changes. `$ship` never edits the plan, invents requirements, or executes only a selected task from it.

## Plan folder

```text
docs/plans/<plan>/
|-- PLAN.md       # request, evidence, scope, approach, tasks, and validation
|-- RESULTS.md    # created by $ship; progress and execution evidence
`-- REVIEW.md     # optional; created by $spec review when useful
```

`PLAN.md` is self-contained and remains unchanged while `$ship` executes it. Git preserves plan history; Specship does not maintain a separate revision ledger, digest, lifecycle, or repository fingerprint.

`RESULTS.md` supports interrupted execution by recording completed work and validation. On resume, `$ship` verifies that evidence against the actual repository before deciding what remains.

## Workflow

### 1. Create a plan

Open a conversation using the stronger model:

```text
$spec Add organization switching to the account settings flow.
```

`$spec` reads repository instructions, investigates relevant code and tests, asks only genuinely blocking questions, and writes one executable `PLAN.md`.

### 2. Implement the complete plan

Open a separate workhorse-model conversation:

```text
$ship implement this plan: docs/plans/organization-switching
```

`$ship` reads the plan, reconciles any existing results with the repository, executes all incomplete tasks in dependency order, runs validation, and records evidence in `RESULTS.md`.

Normal repository activity is not automatically a blocker. `$ship` preserves unrelated changes and stops only when drift conflicts with the plan or invalidates a material assumption.

Validation proceeds from the smallest relevant reproduction and targeted test toward broader checks only when justified. Full-suite runs are reserved for plans, repository rules, explicit requests, and changes with meaningful cross-cutting risk.

### 3. Review when useful

Return to a strong-model conversation:

```text
$spec review docs/plans/organization-switching
```

Review inspects the actual implementation against `PLAN.md`, reruns proportionate validation, and reports findings. Durable findings receive identifiers such as `R1-F1`; later reviews record whether each finding remains open, is resolved, or was superseded without rewriting its original description. A prior review can be resolved even when the current review discovers a different issue.

Review has three outcomes:

- **Pass**: the checked acceptance criteria pass and no finding requiring correction remains. The workflow is complete.
- **Changes required**: one or more bounded implementation defects remain.
- **Blocked**: required evidence, access, or a material decision is missing.

There is no separate finalization step.

### 4. Correct and repeat when needed

If review finds a straightforward implementation mistake already covered clearly by `PLAN.md`, run `$ship` again with the same folder. It verifies the repository rather than trusting the earlier completion record and implements the remaining work.

If the correction changes or clarifies the plan, update it first:

```text
$spec update docs/plans/organization-switching to address R2-F1 and R2-F3
```

Then return to the workhorse:

```text
$ship implement this plan: docs/plans/organization-switching
```

After correction, run `$spec review` again. The new review reconciles every earlier open finding before searching for new issues. It may resolve an earlier round while opening a different finding in the current round.

| `$spec review` result | Is the existing plan sufficient? | Next action |
| --- | --- | --- |
| `Pass` | Yes | Done |
| `Changes required` | Yes | `$ship` implements the corrections, then `$spec review` checks again |
| `Changes required` | No | `$spec update` revises the plan, `$ship` implements it, then `$spec review` checks again |
| `Blocked` | Not yet known | Resolve the missing evidence, access, or decision; update the plan when affected, then continue |

```text
$spec plan
    ↓
$ship implement
    ↓
$spec review
    ├── Pass → Done
    └── Changes required
            ↓
       Is the existing plan sufficient?
            ├── Yes → $ship implements corrections
            └── No  → $spec update → $ship implements
                              ↓
                         $spec review again
```

## What `$spec update` does

`$spec update` revises `PLAN.md` when the current handoff is no longer sufficient or accurate. Use it when:

- the user changes or adds a requirement;
- `$ship` encounters a material decision it cannot safely make;
- repository changes invalidate a plan assumption;
- review findings require clarified or additional corrective tasks; or
- the original plan is incomplete or internally inconsistent.

Example:

```text
$spec update docs/plans/organization-switching with this new requirement
```

`$spec` reads the plan, execution evidence, review history, and relevant repository changes, then rewrites every affected part of `PLAN.md` so it remains self-contained. Corrective tasks reference the applicable review finding IDs, such as `Addresses R2-F1 and R2-F3`.

`$spec update` does not implement code, erase `RESULTS.md`, rewrite original review findings, or create a formal revision lifecycle. Git preserves the previous plan. If implementation has already begun, `$spec` reports that earlier result entries may be stale and `$ship` reconciles them with the repository when it resumes.

## Responsibilities

| Skill | Owns | Must not do |
| --- | --- | --- |
| `$spec` | Investigation, clarification, plan creation and updates, independent review | Implement source changes or rewrite execution evidence |
| `$ship` | Complete-plan implementation, validation, resumable execution evidence | Edit `PLAN.md`, invent requirements, broaden scope, or review as `$spec` |

The target repository's `AGENTS.md` remains authoritative for implementation practices, testing, task tracking, and canonical documentation updates. Specship adds no separate finalization operation.

## Installation

### Requirements

- Git
- Node.js 18 or newer for `npx skills`
- Codex

### Install globally for Codex

```bash
npx skills add notsonata/specship --skill spec --skill ship --agent codex --global --yes
```

Restart Codex if the skills do not appear. Type `$` and select **Spec** or **Ship**.

### Install into one project

Run inside the target repository without `--global`:

```bash
npx skills add notsonata/specship --skill spec --skill ship --agent codex --yes
```

### Install from a local clone

```bash
git clone https://github.com/notsonata/specship.git
cd specship
npx skills add . --skill spec --skill ship --agent codex --global --yes
```

## Repository layout

```text
.
|-- .agents/skills/
|   |-- spec/
|   |   |-- SKILL.md
|   |   `-- agents/openai.yaml
|   `-- ship/
|       |-- SKILL.md
|       `-- agents/openai.yaml
`-- README.md
```

## Development and validation

Validate both skill packages before committing changes:

```bash
python3 /path/to/skill-creator/scripts/quick_validate.py .agents/skills/spec
python3 /path/to/skill-creator/scripts/quick_validate.py .agents/skills/ship
npx skills add . --list
```

Dogfood the workflow on small fixes, multi-task features, blocked implementations, interrupted execution, plan updates after partial work, and passing and failing reviews. Add machinery only when repeated use demonstrates a concrete failure that instructions and repository evidence cannot handle reliably.
