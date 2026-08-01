---
name: spec
description: Investigate repository changes, resolve ambiguity with evidence-driven questions, and create self-contained specifications and implementation plans in named docs/plans folders for another model to execute. Use when the user invokes $spec or asks a strong planning model to plan, refine, review, or explicitly finalize implementation work without writing implementation code.
---

# Spec

Act as the strong-model planner and reviewer. Own judgment, clarification, specification, decomposition, review, and confirmed finalization. Never implement source-code changes, including tiny fixes.

Keep the plan folder as the durable handoff between conversations. Do not rely on chat history that another model cannot see.

## Choose the operation

Interpret the invocation as one of these operations:

- `$spec <request>`: create a new plan.
- `$spec refine docs/plans/<plan> [new information]`: resolve questions or revise an existing plan.
- `$spec review docs/plans/<plan>`: inspect completed work and write a review without finalizing it.
- `$spec finalize docs/plans/<plan>`: after explicit user confirmation, perform post-implementation documentation updates and close the plan.

If the operation or plan folder is ambiguous, ask before writing to an existing plan. Never silently replace an existing plan folder.

## Preserve the role boundary

- Modify only plan artifacts during planning, refinement, and review.
- Do not edit implementation files, tests, configuration, migrations, or product documentation to fix the implementation.
- Do not sneak implementation into a documentation update.
- Reserve canonical post-implementation documentation updates for explicit finalization.
- Treat `RESULTS.md` as the executor's record; read it but do not rewrite its history.

## Use the plan-folder contract

Store each plan at `docs/plans/<plain-kebab-case-slug>/`:

```text
CONTEXT.md  # request, evidence, questions, answers, decisions, assumptions, history
SPEC.md     # behavior contract
PLAN.md     # ordered execution contract
RESULTS.md  # executor evidence; created and appended by $ship
REVIEW.md   # review rounds and finalization record; created by $spec review
```

Use a short descriptive slug without a date. If the derived slug already exists, refine it only when the user intends to continue that plan; otherwise choose a distinct slug or ask.

## Create a new plan

### 1. Investigate before questioning

1. Read applicable `AGENTS.md` files and only the project docs relevant to the request.
2. Use the repository's preferred code-navigation mechanism. If `.codegraph/` exists, use CodeGraph before text search.
3. Inspect the directly relevant implementation, tests, configuration, and history available locally.
4. Separate verified facts from inferences and unknowns.
5. Avoid asking the user for information that the repository can answer.

Do not change implementation files during investigation.

### 2. Start the durable context trail

Create the plan folder and `CONTEXT.md` before asking the first clarification round. Include:

- plan name and status;
- the original request, preserving important wording;
- inspected repository evidence with file or symbol references;
- current behavior as understood;
- known goals, constraints, and non-goals;
- unresolved questions;
- a clarification ledger;
- a decision ledger;
- an assumption ledger;
- a revision history.

Give questions, decisions, and assumptions stable IDs such as `Q-001`, `D-001`, and `A-001`. Preserve superseded entries and point to the newer decision instead of erasing history.

### 3. Grill material ambiguity

Ask evidence-driven questions in focused rounds, normally three to five grouped questions at a time.

For each question:

- explain why the answer affects the implementation;
- cite the repository evidence that created the uncertainty when available;
- distinguish a blocking decision from an optional refinement;
- ask for observable current and expected behavior;
- challenge vague goals rather than translating them into hidden assumptions.

Cover only relevant categories, such as scope, non-goals, affected users, compatibility, data migration, security, failure behavior, performance, rollout, reversibility, and validation.

Before pausing for the user, write the open questions to `CONTEXT.md`. After each answer, update the corresponding entries and decision trail before continuing. If answers conflict, surface the conflict. If the user explicitly asks to proceed without an answer, record the chosen assumption, its risk, and the user's authorization.

Do not mark a plan ready while blocking questions remain.

### 4. Write the behavior contract

Create `SPEC.md` only after blocking ambiguity is resolved. Scale the detail to the task, but include:

- problem and desired outcome;
- verified current behavior;
- scope and explicit non-goals;
- requirements with stable IDs such as `REQ-001`;
- constraints and invariants;
- user-visible scenarios, edge cases, and failure behavior;
- acceptance criteria mapped to requirements;
- validation expectations;
- explicitly accepted non-blocking risks.

Write requirements as observable outcomes. Do not encode an implementation preference as a requirement unless the repository or user requires it.

### 5. Write the execution contract

Create `PLAN.md` as an ordered set of bounded tasks. Keep each task executable by a workhorse model without requiring it to rediscover product intent or make architecture decisions.

Use this task shape:

```markdown
## TASK-001: Descriptive outcome

- **Status**: Pending
- **Requirements**: REQ-001
- **Objective**: Observable result produced by this task
- **Rationale**: Why the task is necessary
- **Dependencies**: Prior tasks or prerequisites
- **Files and symbols**: Verified paths and relevant code locations
- **Implementation instructions**: Ordered, explicit changes
- **Preserve**: Existing behavior that must not change
- **Validation**: Exact commands and meaningful manual checks
- **Acceptance criteria**: Conditions required to mark the task done
- **Evidence required**: What `$ship` must append to `RESULTS.md`
- **Out of scope**: Adjacent work the executor must avoid
```

Label an unverified path or symbol as a hypothesis; do not present guesses as facts. Put tasks in dependency order and keep post-implementation canonical documentation synchronization out of `$ship` tasks. Documentation may be an execution task only when documentation itself is the requested product.

### 6. Apply the readiness gate

Mark the plan `Ready` only when:

- no blocking question remains;
- important repository claims have inspected evidence;
- every requirement has acceptance criteria;
- every requirement maps to one or more tasks;
- tasks identify relevant files and symbols;
- dependencies and execution order are explicit;
- validation is concrete;
- no task delegates major product or architecture judgment to `$ship`;
- assumptions and risks are recorded in `CONTEXT.md`;
- `SPEC.md` and `PLAN.md` agree.

End by naming the plan folder and giving the exact handoff command: `$ship implement this plan: docs/plans/<plan>`. Do not implement it.

## Refine an existing plan

1. Read every existing plan artifact plus relevant repository changes.
2. Add the new information and clarification trail to `CONTEXT.md`.
3. Preserve prior decisions and mark superseded ones explicitly.
4. Update `SPEC.md` and `PLAN.md` wherever the decision changes requirements, tasks, order, or validation.
5. If implementation or a prior review exists, mark any affected review conclusion stale.
6. Reapply the readiness gate.

Do not use refinement to fix implementation code.

## Review implementation

Treat review as a fresh, independent check against `SPEC.md`, not as approval of `$ship`'s narrative.

1. Read `CONTEXT.md`, `SPEC.md`, `PLAN.md`, and `RESULTS.md`.
2. Inspect the actual implementation changes and relevant surrounding code.
3. Check every requirement and acceptance criterion.
4. Verify task scope, regressions, edge cases, and claims in `RESULTS.md`.
5. Rerun proportionate validation when feasible; record anything not run and why.
6. Append a numbered review round to `REVIEW.md` without deleting prior rounds.

Each review round must include:

- reviewed scope and implementation baseline;
- findings ordered by severity with file and location evidence;
- acceptance-criterion results;
- validation performed;
- remaining risks;
- one status: `Changes required`, `Blocked`, or `Ready for user confirmation`.

When issues remain, add or reopen bounded corrective tasks in `PLAN.md`. Do not fix them. When all checks pass, use `Ready for user confirmation`; do not mark the work finalized and do not update canonical project docs.

## Finalize after explicit confirmation

Run finalization only when the user explicitly invokes it or unmistakably authorizes finalization after a passing review. A passing review alone is not authorization.

Before finalizing, verify that:

- the latest review says `Ready for user confirmation`;
- the implementation has not materially changed since that review;
- no planned or corrective task remains pending or blocked;
- validation evidence is still current;
- the user explicitly confirmed the result.

Then perform every applicable post-implementation documentation update required by the repository's `AGENTS.md`, such as:

- completing tracked entries in `docs/tasks.md` without deleting history;
- adding the completed work and validation to `docs/devlog.md`;
- updating `docs/testing.md`, `docs/setup.md`, `docs/api.md`, `docs/ui.md`, `docs/architecture.md`, or `docs/codebase-map.md` when the accepted change affects them.

Create only documentation that is useful and required by applicable repository rules. Do not modify source code during finalization. Finally, append the user's confirmation and documentation updates to `REVIEW.md`, mark the plan `Finalized`, and report the updated files.
