---
name: ship
description: Implement or resume one complete sealed $spec plan from docs/plans, execute all plan tasks in dependency order, validate the result, and append revision-pinned evidence without changing the contract or canonical completion docs. Use when the user invokes $ship with an explicit plan folder for workhorse execution.
---

# Ship

Act as the workhorse implementer. Implement one complete ready plan, verify it, record evidence, and stop so the strong model can review it.

Treat the plan folder as the source of truth. Do not depend on the planner conversation.

## Load and validate the protocol

Before operating on a plan:

1. Read `references/protocol.md` completely.
2. Read `references/artifact-templates.md` when creating `RESULTS.md` or checking evidence shape.
3. Resolve this skill's `scripts/validate_plan.py` to an absolute path.

Use the validator for every lifecycle and task-state mutation. Do not hand-edit `STATE.md`.

## Require one complete plan

Use this canonical invocation:

```text
$ship implement this plan: docs/plans/<plan>
```

Require an explicit folder. Never guess the newest plan, combine plans, or accept a task ID as the execution boundary. One `$ship` invocation implements or resumes the complete plan.

## Preserve ownership

- Never edit `CONTEXT.md`, `SPEC.md`, or `PLAN.md`; they are the sealed `$spec` contract.
- Never bypass a digest, baseline, lifecycle, dependency, or evidence validation failure.
- Append only to `RESULTS.md`; preserve all attempts.
- Do not create or reinterpret product requirements.
- Do not broaden scope or make material architecture, compatibility, migration, security, or rollout decisions.
- Do not review, refine, or finalize as `$spec`.
- Do not perform canonical post-implementation updates to `docs/tasks.md`, `docs/devlog.md`, or other project docs merely to record completion.
- Edit documentation only when the sealed plan explicitly defines that documentation as the product deliverable.

## Start or resume safely

1. Read applicable `AGENTS.md` files.
2. Read all six plan artifacts that exist.
3. Run `validate` before touching implementation.
4. Read only source, tests, config, and docs relevant to the complete plan.
5. Preserve unrelated user changes, including every dirty file recorded in the planning baseline.

If lifecycle is `Ready`, run `start`. It must verify that current Git HEAD and dirty-file set equal the sealed planning baseline before transitioning to `InProgress`.

If lifecycle is already `InProgress`, resume the same complete plan from `STATE.md`. Do not repeat `Done` or `Superseded` tasks. An operational interruption does not require a new contract.

If lifecycle is `Blocked`, `Failed`, `Implemented`, `ChangesRequired`, `ReadyForConfirmation`, or `Finalized`, stop and return control to `$spec`. Never force a transition.

## Handle contract blockers without guessing

Stop before an uncertain change when an answer could materially alter behavior, architecture, compatibility, data, security, rollout, or acceptance criteria.

When blocked:

1. Append the affected task attempt to `RESULTS.md`, including the current revision, digest, evidence, and exact question `$spec` must resolve.
2. Set the affected task to `Blocked` through the validator.
3. Transition the plan to `Blocked` through the validator.
4. Tell the user to return to the strong-model conversation and run `$spec refine docs/plans/<plan>`.

Do not write the question into `CONTEXT.md`; only `$spec` may revise the contract trail. Small operational details may follow explicit repository conventions when they do not change the contract; record meaningful operational assumptions in `RESULTS.md`.

## Implement the complete plan

Use the task table in `STATE.md` and the dependency contract in `PLAN.md`.

For each pending task in dependency order:

1. Verify dependencies are `Done` or `Superseded`.
2. Transition the task to `InProgress`; this increments its attempt number.
3. Make the smallest safe change satisfying its instructions and linked requirements.
4. Follow existing patterns and preserve stated invariants.
5. Avoid unrelated cleanup, renaming, dependencies, or speculative improvements.
6. Add or update only tests required by the plan and repository rules.
7. Run the specified validation.
8. Inspect the change for accidental scope expansion.
9. Append the task attempt to `RESULTS.md` using the template, current revision, exact digest, and exact files and validation.
10. Transition the task to `Done` only after its acceptance criteria and required validation pass.

Continue to the next runnable task automatically. Do not pause merely to ask whether to continue.

If implementation fails, make reasonable in-scope correction attempts. If acceptance criteria still cannot pass, append a `Failed` attempt, set the task to `Failed`, transition the plan to `Failed`, and stop. If the contract itself must change, use the blocker workflow.

## Complete and hand off

After every task is `Done` or `Superseded`:

1. Run plan-wide integration, end-to-end, build, or other specified validation.
2. Recheck every requirement and acceptance criterion against the actual result.
3. Inspect the full changed-file set against both the sealed baseline and plan scope.
4. Append one current-revision `Plan execution summary` to `RESULTS.md` with all tasks, changed files, validation, deviations, and risks.
5. Run `finish`. It verifies task evidence, captures the implementation-end Git baseline and dirty files, and transitions to `Implemented`.
6. Run `validate` again.

Report the outcome, tasks, files changed, validation, plan-local records, and remaining risks. Then tell the user to return to the strong-model conversation and run:

```text
$spec review docs/plans/<plan>
```

Stop. Do not perform `$spec review`, finalization, or canonical post-implementation documentation updates.
