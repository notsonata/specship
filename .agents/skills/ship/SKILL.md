---
name: ship
description: Execute exactly one bounded implementation task from a named /spec plan folder under docs/plans, validate the change, and record plan-local evidence without inventing requirements or performing final project documentation updates. Use when the user invokes /ship with a plan folder and optional task ID for workhorse-model execution.
---

# Ship

Act as the workhorse implementer. Execute one ready task from an existing `/spec` plan, verify it, record evidence, and stop.

Treat the plan folder as the source of truth. Do not depend on context from the planner's conversation.

## Require a plan

Accept these forms:

- `/ship docs/plans/<plan>`: execute the first runnable pending task.
- `/ship docs/plans/<plan> TASK-002`: execute the named task.

Require an explicit plan folder. Never guess from the newest folder. If the path or requested task is ambiguous, stop and ask for the exact target.

## Preserve the role boundary

- Execute exactly one task per invocation unless the user explicitly requests a different bounded unit.
- Do not create or reinterpret product requirements.
- Do not broaden scope, redesign architecture, or make material compatibility, migration, security, or rollout decisions.
- Do not edit `SPEC.md`.
- Do not perform post-implementation project documentation synchronization.
- Do not update `docs/devlog.md`, `docs/tasks.md`, or other canonical docs merely to record completed work.
- Allow documentation edits only when documentation itself is an explicit implementation deliverable in the selected task.
- Do not invoke `/spec` behavior inside this role.

## Read the execution contract

Before editing:

1. Read applicable `AGENTS.md` files.
2. Read the selected plan's `CONTEXT.md`, `SPEC.md`, `PLAN.md`, and existing `RESULTS.md` and `REVIEW.md` when present.
3. Read only the source, tests, configuration, and docs directly relevant to the selected task.
4. Preserve unrelated user changes in the working tree.
5. Verify that the plan is `Ready`, the task is pending or explicitly reopened, its dependencies are complete, and no blocking question applies to it.

If the plan contract is incomplete or contradictory, do not compensate with model judgment.

## Handle blockers without guessing

Stop before the uncertain change when a missing answer could materially alter behavior, architecture, compatibility, data, security, rollout, or acceptance criteria.

When blocked:

1. Add a new unresolved question to `CONTEXT.md` with the repository evidence and why it matters.
2. Mark the selected task `Blocked` in `PLAN.md`.
3. Append a blocked attempt to `RESULTS.md`.
4. Tell the user to run `/spec refine docs/plans/<plan>` in the strong-model conversation.

Resolve small operational details from explicit repository conventions when they do not change the contract. Record any meaningful operational assumption in `RESULTS.md`.

## Execute one task

1. Mark the selected task `In progress`.
2. Make the smallest safe change that fulfills its instructions and linked requirements.
3. Follow existing local patterns and preserve the task's stated invariants.
4. Avoid unrelated cleanup, renaming, dependency changes, and speculative improvements.
5. Add or update only the tests required by the task and repository testing rules.
6. Run the task's specified validation, escalating only when broader validation is justified by the affected surface.
7. Inspect the resulting diff or changed files for accidental scope expansion.

If implementation reveals that the plan itself must change, stop and use the blocker workflow instead of rewriting the contract.

## Record execution evidence

Append one attempt record to `RESULTS.md`; never erase earlier attempts. Include:

```markdown
## TASK-001 — Attempt N

- **Outcome**: Completed | Blocked | Failed
- **Files changed**: Exact paths
- **Implementation**: Concise description of what changed
- **Validation**: Commands or checks and their results
- **Deviations**: None, or explicit differences from the plan
- **Remaining risks**: Known limits or unverified behavior
- **Review notes**: Anything `/spec review` should inspect closely
```

Do not claim a command passed unless it ran successfully. Record skipped or unavailable validation with the exact reason.

## Finish the task

Mark the task `Done` only when its acceptance criteria and required validation are satisfied. Otherwise mark it `Blocked` or `Failed` and preserve partial-work details.

End the invocation with:

- the task outcome;
- files changed;
- validation performed;
- the plan-local records updated;
- the next required action.

Stop after the selected task. Do not start the next task, review the work as `/spec`, finalize the plan, or update canonical post-implementation documentation.
