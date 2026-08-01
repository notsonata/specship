---
name: spec
description: Investigate a repository and create, update, or independently review a self-contained Markdown implementation plan under docs/plans without implementing source changes. Use when the user invokes $spec to prepare a reliable handoff for another model or to review work completed from such a plan.
---

# Spec

Act as the planner and reviewer. Investigate the repository, resolve material ambiguity, and produce a plan another model can execute without access to this conversation. Never implement source changes, including during review.

## Choose the operation

- `$spec <request>`: create a plan.
- `$spec update docs/plans/<plan> [new information]`: update an existing plan.
- `$spec review docs/plans/<plan>`: review the implementation against the plan.

Require the exact folder before updating or reviewing an existing plan. Never silently replace a plan folder.

## Use the plan folder as the handoff

Store each plan at `docs/plans/<plain-kebab-case-slug>/`:

```text
PLAN.md       # self-contained implementation plan owned by $spec
RESULTS.md    # execution progress and evidence created by $ship
REVIEW.md     # optional review record created by $spec review
```

Do not create `RESULTS.md` or `REVIEW.md` during initial planning. Do not edit `RESULTS.md`; it is the executor's record. Treat `PLAN.md` as immutable while `$ship` is executing it.

## Create a plan

### Investigate first

1. Read applicable `AGENTS.md` files and only the project docs relevant to the request.
2. Use the repository's preferred navigation mechanism. If `.codegraph/` exists, use CodeGraph before text search.
3. Inspect directly relevant implementation, tests, configuration, documentation, and local history.
4. Separate verified facts from inferences and unknowns.
5. Ask only questions whose answers can materially change scope, observable behavior, architecture, compatibility, data handling, security, rollout, reversibility, or acceptance criteria.

Do not ask for facts the repository can answer. If a blocking decision remains, ask the user before writing a supposedly executable plan.

### Write one self-contained `PLAN.md`

Scale detail to the work. Include:

- objective and desired outcome;
- verified current behavior and repository evidence with paths or symbols;
- in-scope and out-of-scope work;
- selected approach and rationale;
- constraints, invariants, assumptions, and meaningful risks;
- dependency-ordered implementation tasks;
- plan-wide validation and acceptance criteria.

For each task, include only the fields that help execution:

```markdown
## Task 1: Descriptive outcome

**Files and symbols**

- `path/to/file`: relevant symbol or responsibility

**Changes**

- Explicit implementation work.
- Existing behavior that must be preserved.

**Validation**

- Exact commands or meaningful manual checks.

**Acceptance criteria**

- Observable condition required for completion.
```

Use stable task IDs, requirement IDs, dependency tables, or migration and rollback sections only when the plan is complex enough to benefit from them. Label unverified paths or symbols as hypotheses.

Keep the complete plan small enough for one workhorse conversation to execute. Split genuinely large programs into separate, independently useful plan folders.

### Check readiness

Before handing off, confirm that:

- no blocking decision remains;
- repository claims have inspected evidence;
- scope and non-goals are explicit;
- tasks are ordered and executable without rediscovering product intent;
- validation and acceptance criteria are concrete;
- assumptions and risks are visible;
- the plan does not delegate material product or architecture judgment to `$ship`.

End with the folder and exact handoff: `$ship implement this plan: docs/plans/<plan>`.

## Update a plan

1. Read `PLAN.md`, any existing `RESULTS.md` and `REVIEW.md`, and relevant repository changes.
2. Investigate the new information before editing.
3. Update every affected part of `PLAN.md` so it remains internally consistent and self-contained.
4. Preserve useful history through Git rather than embedding a revision ledger in the plan.
5. If execution has already begun, explicitly report that prior result entries may be stale and that `$ship` must reconcile them with the repository before resuming.

Do not edit implementation files or rewrite execution history.

## Review implementation

Treat review as a fresh check of the actual repository, not approval of `$ship`'s narrative.

1. Read `PLAN.md` and `RESULTS.md` when present.
2. Inspect the implementation changes and relevant surrounding code.
3. Check every task, acceptance criterion, preserved behavior, regression risk, and claim in `RESULTS.md`.
4. Rerun proportionate validation when feasible and state anything not run.
5. Report findings ordered by severity with file and location evidence.
6. Create or append `REVIEW.md` only when a durable review record is useful or the user requests one.

Use one outcome: `Changes required`, `Blocked`, or `Pass`. When changes are required, describe bounded corrective work but do not implement it. Let the user request a plan update or implementation follow-up explicitly.

Do not finalize work or update canonical project documentation as a separate Specship operation. The target repository's instructions govern documentation updates during normal implementation.
