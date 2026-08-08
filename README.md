# Specship

Specship v0.6 is a model-agnostic planning and execution workflow for coding agents:

- **`$spec`** investigates a repository and writes a decision-complete execution contract.
- **`$ship`** implements the complete contract, validates each mapped requirement, and records the result.

The plan folder is the handoff, so the skills can run in separate agents or sessions without shared chat history. The planning and execution agents may use different model providers.

> **Status: public source preview.** Specship is being dogfooded and is not yet presented as production-ready or submitted to a skill registry.

## Why Specship?

Planning and implementation reward different strengths. The planning agent resolves ambiguity, understands architecture, selects one approach, and defines observable success. It exposes those decisions through a self-contained Markdown contract so the execution agent can work directly without rediscovering product intent or making hidden design choices.

Specship deliberately keeps this contract small:

```text
$spec plan
    |
    v
Decision-complete PLAN.md
    |
    v
$ship implements the complete plan and writes RESULTS.md
    |
    v
Optional $spec review and REVIEW.md
```

`$spec` never implements source changes. `$ship` never edits the plan, invents requirements, redesigns settled decisions, or executes only a selected task from it.

## Plan folder

```text
docs/plans/<plan>/
|-- PLAN.md       # requirements, evidence, decisions, change map, tasks, and validation
|-- RESULTS.md    # created by $ship; progress and execution evidence
`-- REVIEW.md     # optional; created by $spec review when useful
```

`PLAN.md` is self-contained and remains unchanged while `$ship` executes it. Its executor brief identifies the starting point and order; requirement IDs connect concrete file-and-symbol changes to tests and acceptance evidence. Git preserves plan history; Specship does not maintain a separate revision ledger, digest, lifecycle, or repository fingerprint.

`RESULTS.md` supports interrupted execution by recording completed work and validation. On resume, `$ship` verifies that evidence against the actual repository before deciding what remains.

## Workflow

### 1. Create a plan

Start a planning-agent session:

```text
$spec Add organization switching to the account settings flow.
```

`$spec` reads repository instructions, investigates relevant code and tests, asks only genuinely blocking questions, and writes one decision-complete `PLAN.md`. The plan selects one approach and includes an executor brief, testable requirements, verified repository evidence, a file-and-symbol change map, ordered implementation steps, and requirement-to-validation traceability.

### 2. Implement the complete plan

Start a separate execution-agent session. It may use a different provider or a faster, less expensive model:

```text
$ship implement this plan: docs/plans/organization-switching
```

`$ship` reads the plan once, turns its executor brief and dependency map into a checklist, and starts with the first named file and symbol. It reconciles existing results, executes all incomplete tasks in dependency order, validates mapped requirements, and records concise evidence in `RESULTS.md`.

The executor does not broadly rediscover the repository or reconsider settled decisions. It expands inspection only when repository evidence contradicts the plan, a named location is missing, or validation exposes an unmapped boundary. A material contract gap returns to `$spec update` instead of becoming open-ended executor research.

Normal repository activity is not automatically a blocker. `$ship` preserves unrelated changes and stops only when drift conflicts with the plan or invalidates a material assumption.

Validation proceeds from the smallest relevant reproduction and targeted test toward broader checks only when justified. Full-suite runs are reserved for plans, repository rules, explicit requests, and changes with meaningful cross-cutting risk.

### 3. Review when useful

Return to a planning/review-agent session:

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

Then return to the execution agent:

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
| `$spec` | Investigation, clarification, exact contract creation and updates, independent review | Implement source changes or rewrite execution evidence |
| `$ship` | Direct complete-plan implementation, requirement validation, resumable execution evidence | Edit `PLAN.md`, invent requirements, revisit settled decisions, broaden scope, or review as `$spec` |

The target repository's instruction files remain authoritative for implementation practices, testing, task tracking, and canonical documentation updates. Specship adds no separate finalization operation.

## Installation

### Requirements

- Git
- Node.js 18 or newer for `npx skills`
- A coding agent that supports the open Agent Skills format

### Install globally

```bash
npx skills add notsonata/specship --skill spec --skill ship --global --yes
```

The installer detects supported agents and prompts when a target must be selected. Use `--agent <agent-id>` to choose one explicitly, or repeat the flag to install into multiple agents. Restart the target agent if the skills do not appear.

### Install into one project

Run inside the target repository without `--global`:

```bash
npx skills add notsonata/specship --skill spec --skill ship --yes
```

### Install from a local clone

```bash
git clone https://github.com/notsonata/specship.git
cd specship
npx skills add . --skill spec --skill ship --global --yes
```

## Repository layout

```text
.
|-- .agents/skills/
|   |-- spec/
|   |   |-- SKILL.md
|   |   `-- agents/openai.yaml  # optional UI metadata used by compatible clients
|   `-- ship/
|       |-- SKILL.md
|       `-- agents/openai.yaml  # optional UI metadata used by compatible clients
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
