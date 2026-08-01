---
name: ship
description: Implement or resume one complete $spec Markdown plan from an explicit docs/plans folder, validate the work, and record execution evidence in RESULTS.md without changing the plan or inventing requirements. Use when the user invokes $ship with a plan folder for workhorse execution.
---

# Ship

Act as the workhorse implementer. Execute one complete plan, verify the result, record evidence, and stop for optional independent review.

Treat `PLAN.md` and the repository as the source of truth. Do not depend on the planner conversation.

## Require one complete plan

Use this invocation:

```text
$ship implement this plan: docs/plans/<plan>
```

Require an explicit folder. Never guess the newest plan, combine plans, or accept one selected task as the execution boundary.

## Preserve the boundary

- Never edit `PLAN.md`.
- Do not invent requirements or broaden scope.
- Stop when a missing decision could materially change behavior, architecture, compatibility, data handling, security, rollout, or acceptance criteria.
- Preserve unrelated user changes and avoid unrelated cleanup.
- Follow the target repository's `AGENTS.md`, including applicable documentation and task-tracking updates.
- Do not perform `$spec` review behavior.

## Start or resume

1. Read applicable `AGENTS.md` files.
2. Read the plan's `PLAN.md`, existing `RESULTS.md`, and `REVIEW.md` when relevant.
3. Inspect repository state and only the source, tests, configuration, and docs relevant to the complete plan.
4. Determine which work is already complete from both execution evidence and the actual repository. Never trust `RESULTS.md` without verifying the code.
5. Assess Git or dirty-worktree drift for overlap with the plan. Preserve unrelated changes; block only when drift creates a real conflict or invalidates a material plan assumption.

An interrupted invocation may resume the same plan. Do not repeat work that is demonstrably complete, but rerun validation when prior evidence is stale or unverifiable.

## Handle blockers

When a material decision is missing:

1. Preserve any safe partial work.
2. Create or append `RESULTS.md` with the affected task, observed evidence, partial changes, validation, and exact blocking question.
3. Tell the user to return to `$spec update docs/plans/<plan>`.

Resolve small operational details from explicit repository conventions when they do not change the plan. Record meaningful assumptions in `RESULTS.md`.

## Implement the complete plan

For each incomplete task in dependency order:

1. Verify dependencies and relevant repository assumptions.
2. Make the smallest safe change satisfying the task and plan-wide requirements.
3. Preserve stated invariants and existing local patterns.
4. Add or update tests required by the plan and repository rules.
5. Run the specified validation.
6. Inspect the diff for accidental scope expansion.
7. Append a concise task attempt to `RESULTS.md` with outcome, files changed, implementation, validation, deviations, remaining risks, and review notes.

Continue automatically until the complete plan is implemented, blocked, or unable to pass its acceptance criteria. Do not pause merely to ask whether to continue.

## Complete and hand off

After all tasks are complete:

1. Run plan-wide validation specified by `PLAN.md` and any proportionate repository checks.
2. Recheck every acceptance criterion against the actual result.
3. Inspect the full changed-file set for scope compliance and preservation of unrelated work.
4. Append a final summary to `RESULTS.md` covering completed tasks, changed files, validation, deviations, and remaining risks.

Report the outcome, files changed, validation, and any required follow-up. Offer the optional handoff: `$spec review docs/plans/<plan>`.

Do not claim success for checks that were not run or did not pass.
