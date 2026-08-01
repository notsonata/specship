# Specship protocol 0.2

Use this protocol for every plan folder. The fenced JSON block at the top of each artifact is machine-readable; do not change field names or lifecycle spellings.

## Ownership

| Artifact | Owner | Mutation rule |
| --- | --- | --- |
| `CONTEXT.md` | `$spec` | Contract artifact; editable only while Draft, then immutable until a new revision starts |
| `SPEC.md` | `$spec` | Contract artifact; editable only while Draft, then immutable until a new revision starts |
| `PLAN.md` | `$spec` | Contract artifact; editable only while Draft, then immutable until a new revision starts |
| `STATE.md` | Validator | Both skills invoke the validator; neither hand-edits it |
| `RESULTS.md` | `$ship` | Append-only execution evidence |
| `REVIEW.md` | `$spec` | Append-only review and finalization evidence |

Contract artifacts share `protocol_version`, `plan_id`, and `contract_revision`. Sealing hashes their exact bytes into `STATE.md`. Any later change requires `$spec` to start a new revision first. Evidence must name the revision and digest it applies to.

## Lifecycle

```text
Draft -> AwaitingClarification -> Ready -> InProgress
                                      ├-> Blocked -> Draft (new revision)
                                      ├-> Failed  -> Draft (new revision)
                                      └-> Implemented -> ChangesRequired -> Draft (new revision)
                                                      └-> ReadyForConfirmation -> Finalized
```

`$ship` executes or resumes the complete plan; task state is not a separate invocation boundary. A stopped plan returns to `$spec` only when the contract needs judgment or revision.

## Validator commands

From either installed skill, set `VALIDATOR` to that skill's `scripts/validate_plan.py`, then use:

```bash
python3 "$VALIDATOR" validate docs/plans/<plan>
python3 "$VALIDATOR" revise docs/plans/<plan> --note "Why the contract must change"
python3 "$VALIDATOR" seal docs/plans/<plan> --note "Contract ready for implementation"
python3 "$VALIDATOR" start docs/plans/<plan> --note "Begin full-plan implementation"
python3 "$VALIDATOR" task docs/plans/<plan> TASK-001 InProgress
python3 "$VALIDATOR" task docs/plans/<plan> TASK-001 Done
python3 "$VALIDATOR" transition docs/plans/<plan> Blocked --actor ship --note "Blocking reason"
python3 "$VALIDATOR" finish docs/plans/<plan> --note "All plan tasks implemented"
python3 "$VALIDATOR" transition docs/plans/<plan> ChangesRequired --actor spec --note "Review found issues"
python3 "$VALIDATOR" transition docs/plans/<plan> ReadyForConfirmation --actor spec --note "Review passed"
python3 "$VALIDATOR" transition docs/plans/<plan> Finalized --actor spec --note "User confirmed"
```

Use `revise` before modifying any sealed contract. It increments the revision, invalidates the old digest, returns the lifecycle to Draft, and resets task execution state. After editing, use `seal`; it synchronizes task IDs, records the Git HEAD, branch, unrelated dirty-file set and content fingerprint, computes the contract digest, validates the contract, and transitions to Ready.

`start` refuses a plan when the current Git HEAD, unrelated dirty-file set, or dirty-content fingerprint differs from the sealed planning baseline. Contract artifacts are protected separately by their digest, and plan-local mutable artifacts are excluded from the dirty fingerprint. Return drift to `$spec refine`; do not bypass it. If Git is unavailable, the validator records that limitation and emits a warning.

## Required evidence

Every `$ship` task attempt and plan summary must include:

- `Contract revision`
- `Contract digest`
- outcome and exact changed files
- validation performed or the exact reason it was not run

Every `$spec` review round must include the same revision and digest plus the inspected implementation baseline. Lifecycle transitions out of `Implemented` require a matching current review status. Finalization also requires a current `Finalization` record containing the user's explicit confirmation and exact canonical documentation updates.
