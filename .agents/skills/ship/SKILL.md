---
name: ship
description: Implement or resume one complete $spec execution contract from an explicit docs/plans folder, validate every mapped requirement, and record concise evidence in RESULTS.md without changing the plan or inventing decisions. Use when the user invokes $ship with a plan folder and wants direct, bounded execution by any compatible coding agent.
---

# Ship

Act as the execution agent. Implement one complete plan, verify its requirements, record concise evidence, and stop for optional independent review.

Treat `PLAN.md` and the repository as the source of truth. Do not depend on the planning session.

## Require one complete plan

Use this invocation:

```text
$ship implement this plan: docs/plans/<plan>
```

Require an explicit folder. Never guess the newest plan, combine plans, or reduce the execution boundary to one selected task.

## Preserve the contract

- Never edit `PLAN.md`.
- Never invent requirements, select a different architecture, or broaden scope.
- Stop when a missing decision could materially change behavior, architecture, compatibility, data handling, security, rollout, or acceptance criteria.
- Preserve unrelated user changes and avoid unrelated cleanup.
- Follow applicable repository instruction files, including documentation and task-tracking rules.
- Do not perform `$spec` review behavior.

## Orient once, then execute

Keep startup bounded:

1. Read applicable repository instruction files.
2. Read `PLAN.md` in full, then read existing `RESULTS.md` and relevant `REVIEW.md` entries.
3. Turn `Executor brief`, the change map, and task dependencies into a checklist in memory. Do not rewrite the plan.
4. Inspect version-control status and the exact files and symbols named by the next incomplete task.
5. Identify the nearby callers, tests, boundaries, and sound existing mechanisms the task expects to reuse or extend.
6. Verify completed work against both `RESULTS.md` and the repository.
7. Begin the first incomplete task.

Do not perform a broad repository scan, redesign the plan, or re-investigate settled decisions. Expand inspection only when a named file or symbol is missing, repository evidence contradicts the plan, a dependency is unclear, or validation exposes an unmapped boundary.

An interrupted session may resume the same plan. Do not repeat demonstrably complete edits or passing checks whose evidence is still current.

## Check contract executability

Before editing, verify that the plan provides:

- a clear goal and execution order;
- testable requirement IDs;
- one selected implementation approach;
- exact files or new paths for each task;
- concrete implementation steps;
- task-level tests or checks and plan-wide requirement evidence.

Continue when a missing detail is operational and is settled by explicit repository convention. Record any meaningful non-behavioral assumption in `RESULTS.md`.

Block when the gap requires product or architecture judgment. Do not compensate with open-ended exploration.

## Handle blockers

When blocked:

1. Preserve safe partial work.
2. Append a `RESULTS.md` entry with the task, requirement IDs, observed evidence, partial changes, validation, and one exact blocking question.
3. Tell the user to return to `$spec update docs/plans/<plan>`.

## Execute task by task

For each incomplete task in dependency order:

1. **Inspect and inventory**: Verify preconditions and dependencies, then inspect only the named files, symbols, callers, tests, integration boundaries, and directly relevant reuse or extension points. For migrations, replacements, and removals, reconcile the plan's affected-surface inventory against the repository.
2. **Implement**: Apply the task steps using the smallest coherent change. Preserve listed constraints, invariants, and out-of-scope behavior; do not create a parallel mechanism when a sound existing one fits.
3. **Verify**: Add or update the specified tests and run the task's narrow validation.
4. **Self-review**: Inspect the task diff and affected behavior for missed callers, regressions, accidental scope expansion, duplicate mechanisms, and unjustified abstractions or layers.
5. **Fix and simplify**: Correct task-caused failures and self-review findings. Do not pursue unrelated failures beyond recording evidence.
6. **Reverify**: Rerun the narrow checks affected by the final task state.
7. If the task specifies an integration gate, inspect its named actual code, diff, behavior, or integration surface and run its proportionate check. Do not treat the task summary as gate evidence.
8. Append one concise terminal task entry to `RESULTS.md`, then continue automatically to the next ready task.

Use this result shape:

```markdown
## TASK-001: <outcome>

- **Status**: Done | Blocked | Failed
- **Requirements**: REQ-001
- **Files changed**: `path/to/file`
- **Implementation**: What changed, in concrete terms.
- **Validation**: `command` — Passed | Failed | Not run (reason)
- **Integration gate**: None, or inspected implementation/behavior and check result.
- **Deviations**: None, or an exact contract-safe deviation and reason.
- **Remaining risks**: None, or a bounded known risk.
```

Do not narrate routine exploration or log every command. Record evidence needed to resume work or review the result.

## Keep investigation bounded

Use the plan's implementation decisions as decisions, not suggestions. Prefer the first plan-compatible implementation supported by existing repository patterns.

After three distinct falsified root-cause or implementation hypotheses without convergence, stop. Record the hypotheses and evidence, then ask one unresolved question. Do not count routine syntax, compilation, formatting, or fixture corrections as separate hypotheses.

If a task needs materially more files, behavior, or architecture than its change map describes, treat that as a contract mismatch and block instead of silently widening scope.

## Validate proportionately

Run validation in this order:

1. Reproduce a reported failure before editing when feasible.
2. Run the smallest existing check that exercises the behavior.
3. Add only the regression coverage specified by the plan or needed to prove a listed requirement.
4. Run the directly affected test file, module, or package.
5. Run broader integration checks only for changed boundaries.
6. Run a full repository suite only when the plan, repository instructions, user, or cross-cutting risk requires it.

Do not repeatedly rerun unchanged passing suites after edits that cannot affect them. Never claim a check passed when it was not run or did not pass.

## Complete and hand off

After all tasks are done:

1. Run remaining plan-wide validation.
2. Verify every requirement against the plan's evidence table.
3. Recheck every acceptance criterion against the repository result.
4. Inspect the complete changed-file set and the smallest relevant actual code, diff, behavior, or integration surface for scope compliance, cross-task integration, regressions, appropriate reuse, and proportional complexity.
5. Repair in-scope findings and rerun only the validation affected by those repairs.
6. Append one final summary to `RESULTS.md`.

Use this summary shape:

```markdown
## Plan execution summary

- **Outcome**: Implemented | Blocked | Failed
- **Tasks**: TASK-001, TASK-002
- **Requirements verified**: REQ-001, REQ-002
- **Files changed**: `path/to/file`
- **Plan-wide validation**: `command` — result
- **Integrated inspection**: Actual code, behavior, or boundary checked and result.
- **Deviations**: None, or exact deviations.
- **Remaining risks**: None, or bounded risks.
```

Report the outcome, files changed, validation, and required follow-up. Offer the optional handoff: `$spec review docs/plans/<plan>`.
