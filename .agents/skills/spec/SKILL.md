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

Specify validation from narrow to broad. Require a full repository suite only for cross-cutting or high-risk changes, when repository instructions require it, or when the user explicitly requests it. Test count is not a planning target.

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
5. When corrective work comes from review findings, reference the applicable finding IDs in each affected task, such as `Addresses R2-F1 and R2-F3`.
6. If execution has already begun, explicitly report that prior result entries may be stale and that `$ship` must reconcile them with the repository before resuming.

Do not edit implementation files or rewrite execution history.

## Review implementation

Treat review as a fresh check of the actual repository, not approval of `$ship`'s narrative.

1. Read `PLAN.md`, `RESULTS.md` when present, and the complete existing `REVIEW.md` when present.
2. Inspect the implementation changes and relevant surrounding code.
3. Recheck every unresolved finding from prior review rounds before searching for new issues.
4. Check every task, acceptance criterion, preserved behavior, regression risk, and claim in `RESULTS.md`.
5. Rerun proportionate validation when feasible and state anything not run.
6. Report findings ordered by severity with file and location evidence.
7. Create `REVIEW.md` only when a durable review record is useful or the user requests one. If it already exists, reconcile prior findings and append the current round.

### Resolve prior review findings

Give each durable, actionable finding a stable identifier based on its review round, such as `R1-F1`, `R1-F2`, and `R2-F1`. Do not assign IDs to observations or optional suggestions.

During a re-review:

- Mark a prior finding `Resolved` when the implementation now satisfies it.
- Keep it `Open` when the issue remains.
- Mark it `Superseded` only when later plan or implementation changes make it inapplicable, and include evidence.
- Include concise repository evidence for every resolution decision.
- Do not delete or rewrite the original finding description, required correction, or review outcome.

When every finding from a prior round is resolved or superseded and any review blocker is gone, change that round's status from `Open` to `Resolved` and record the later review that resolved it. A prior round may be resolved even when the current review discovers new issues.

Use this shape:

```markdown
## Review 1

- **Status**: Open | Resolved
- **Outcome**: Changes required | Blocked | Pass
- **Resolved in**: Review 2 | This review | Not yet resolved

### Findings

#### R1-F1: Descriptive finding

- **Severity**: Critical | High | Medium | Low
- **Finding status**: Open | Resolved | Superseded
- **Evidence**: `path/to/file:location`
- **Required correction**: ...
- **Resolution evidence**: Pending | Verified in Review 2 at `path/to/file:location`
```

### Append the current review round

After reconciling prior findings, append a new numbered review round containing:

- its current status and outcome;
- prior findings checked and their resolution results;
- newly discovered findings;
- acceptance-criteria results;
- validation performed;
- validation not performed and why;
- remaining risks.

Use `Open` for a current round with unresolved findings or a review blocker. Use `Resolved` for a passing round with no findings requiring correction.

Use one current outcome:

- `Changes required`: one or more findings require implementation changes.
- `Blocked`: required evidence, access, or a material decision is missing.
- `Pass`: all prior findings are resolved or superseded, no findings requiring correction remain, and the checked acceptance criteria pass.

When changes are required, describe bounded corrective work but do not implement it. Let the user explicitly request `$spec update` or another `$ship` execution.

Do not finalize work or update canonical project documentation as a separate Specship operation. The target repository's instructions govern documentation updates during normal implementation.
