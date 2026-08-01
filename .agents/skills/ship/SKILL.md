---
name: ship
description: Implement a complete ready $spec plan from a named folder under docs/plans, execute all pending or reopened tasks in dependency order, validate the finished work, and record plan-local evidence without inventing requirements or performing final project documentation updates. Use when the user invokes $ship with an explicit plan folder for workhorse-model execution.
---

# Ship

Act as the workhorse implementer. Implement one complete ready plan, verify it, record evidence, and stop so the strong model can review the result.

Treat the plan folder as the source of truth. Do not depend on context from the planner's conversation.

## Require one plan

Use this canonical invocation:

```text
$ship implement this plan: docs/plans/<plan>
```

Require an explicit plan folder. Never guess from the newest folder, combine multiple plans, or accept a single task as the execution boundary. If the path is ambiguous, stop and ask for the exact plan folder.

## Preserve the role boundary

- Implement the complete plan in one invocation, including every pending or reopened task.
- Do not create or reinterpret product requirements.
- Do not broaden scope, redesign architecture, or make material compatibility, migration, security, or rollout decisions.
- Do not edit `SPEC.md`.
- Do not perform post-implementation project documentation synchronization.
- Do not update `docs/devlog.md`, `docs/tasks.md`, or other canonical docs merely to record completed work.
- Allow documentation edits only when documentation itself is an explicit implementation deliverable in the plan.
- Do not review or finalize the work as `$spec`.

## Read the execution contract

Before editing:

1. Read applicable `AGENTS.md` files.
2. Read the selected plan's `CONTEXT.md`, `SPEC.md`, `PLAN.md`, and existing `RESULTS.md` and `REVIEW.md` when present.
3. Read only the source, tests, configuration, and docs relevant to the full plan.
4. Preserve unrelated user changes in the working tree.
5. Verify that the plan is `Ready` or has been reopened after review.
6. Verify that no blocking question remains and that tasks have an unambiguous dependency order.
7. Identify all pending or reopened tasks; do not repeat tasks already marked `Done` unless the plan explicitly invalidated them.

If the plan contract is incomplete or contradictory, do not compensate with model judgment.

## Handle blockers without guessing

Stop the entire plan before the uncertain change when a missing answer could materially alter behavior, architecture, compatibility, data, security, rollout, or acceptance criteria.

When blocked:

1. Add a new unresolved question to `CONTEXT.md` with the repository evidence and why it matters.
2. Mark the affected task and the plan `Blocked` in `PLAN.md`.
3. Append the blocked task attempt and plan outcome to `RESULTS.md`.
4. Tell the user to return to the strong-model conversation and run `$spec refine docs/plans/<plan>`.

Resolve small operational details from explicit repository conventions when they do not change the contract. Record any meaningful operational assumption in `RESULTS.md`.

## Implement the complete plan

Mark the plan `In progress`, then execute every pending or reopened task in dependency order.

For each task:

1. Verify its dependencies are complete.
2. Mark it `In progress`.
3. Make the smallest safe change that fulfills its instructions and linked requirements.
4. Follow existing local patterns and preserve the task's stated invariants.
5. Avoid unrelated cleanup, renaming, dependency changes, and speculative improvements.
6. Add or update only the tests required by the task and repository testing rules.
7. Run the task's specified validation.
8. Inspect the resulting changes for accidental scope expansion.
9. Append the task attempt to `RESULTS.md`.
10. Mark the task `Done` only when its acceptance criteria and required validation are satisfied.

Continue automatically to the next runnable task after a task is done. Do not pause merely to ask whether to continue.

If a task fails for an implementation reason, make reasonable in-scope attempts to correct it. If it still cannot satisfy its acceptance criteria, mark the task and plan `Failed`, record the evidence, and stop. If implementation reveals that the plan itself must change, use the blocker workflow instead of rewriting the contract.

## Record execution evidence

Append one attempt record per task to `RESULTS.md`; never erase earlier attempts. Include:

```markdown
## TASK-001 — Attempt N

- **Outcome**: Completed | Blocked | Failed
- **Files changed**: Exact paths
- **Implementation**: Concise description of what changed
- **Validation**: Commands or checks and their results
- **Deviations**: None, or explicit differences from the plan
- **Remaining risks**: Known limits or unverified behavior
- **Review notes**: Anything `$spec review` should inspect closely
```

Do not claim a command passed unless it ran successfully. Record skipped or unavailable validation with the exact reason.

## Verify the finished plan

After all tasks are done:

1. Run the plan's final integration, end-to-end, build, or other plan-wide validation.
2. Recheck every requirement and acceptance criterion against the implemented result.
3. Inspect the full plan diff or changed-file set for omissions and scope creep.
4. Append a plan execution summary to `RESULTS.md` with completed tasks, all changed files, validation results, deviations, and remaining risks.
5. Mark the plan `Implemented — awaiting review`.

Do not treat this verification as `$spec review`; it is the implementer's completion check.

## Hand off for review

End the invocation with:

- the overall plan outcome;
- tasks completed, blocked, or failed;
- files changed;
- task-level and plan-wide validation performed;
- plan-local records updated;
- remaining risks;
- the exact next action.

After successful implementation, tell the user to return to the strong-model conversation and run:

```text
$spec review docs/plans/<plan>
```

Stop after implementing the complete plan. Do not review it as `$spec`, finalize it, or update canonical post-implementation documentation.
