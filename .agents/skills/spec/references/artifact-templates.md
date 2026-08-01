# Artifact templates

Copy these shapes and replace placeholders. Keep the fenced JSON block first.

## CONTEXT.md

````markdown
```json
{
  "artifact": "context",
  "protocol_version": "0.2.0",
  "plan_id": "<plan>",
  "contract_revision": 1
}
```

# Context: <title>

## Request

<Important original wording>

## Repository evidence

- `<path or symbol>`: <verified fact>

## Goals, constraints, and non-goals

- **Goal**: ...
- **Constraint**: ...
- **Non-goal**: ...

## Clarification ledger

### Q-001: <question>

- **Blocking**: Yes | No
- **Status**: Open | Answered | Superseded
- **Why it matters**: ...
- **Evidence**: ...
- **Answer**: Pending

## Decision ledger

### D-001: <decision>

- **Status**: Active | Superseded by D-NNN
- **Rationale**: ...

## Assumption ledger

### A-001: <assumption>

- **Risk**: ...
- **Authorization**: Repository convention | User authorized | To validate

## Revision history

- **Revision 1**: Initial contract.
````

## SPEC.md

````markdown
```json
{
  "artifact": "spec",
  "protocol_version": "0.2.0",
  "plan_id": "<plan>",
  "contract_revision": 1
}
```

# Specification: <title>

## Problem and desired outcome

...

## Current behavior

...

## Scope and non-goals

...

## Requirements

### REQ-001: <observable outcome>

- **Behavior**: ...
- **Acceptance criteria**: ...

## Constraints and invariants

...

## Scenarios, edge cases, and failures

...

## Validation expectations

...

## Accepted risks

...
````

## PLAN.md

````markdown
```json
{
  "artifact": "plan",
  "protocol_version": "0.2.0",
  "plan_id": "<plan>",
  "contract_revision": 1
}
```

# Implementation plan: <title>

## TASK-001: <descriptive outcome>

- **Requirements**: REQ-001
- **Objective**: ...
- **Rationale**: ...
- **Dependencies**: None
- **Files and symbols**: ...
- **Implementation instructions**: ...
- **Preserve**: ...
- **Validation**: ...
- **Acceptance criteria**: ...
- **Evidence required**: ...
- **Out of scope**: ...
````

## STATE.md

````markdown
```json
{
  "artifact": "state",
  "protocol_version": "0.2.0",
  "plan_id": "<plan>",
  "contract_revision": 1,
  "contract_digest": "UNSEALED",
  "lifecycle_state": "Draft",
  "planning_base_sha": "UNAVAILABLE",
  "planning_branch": "UNAVAILABLE",
  "planning_dirty_files": [],
  "planning_dirty_digest": "UNAVAILABLE",
  "implementation_start_sha": "UNSET",
  "implementation_end_sha": "UNSET",
  "implementation_dirty_files": [],
  "implementation_dirty_digest": "UNSET"
}
```

# Plan state: <title>

## Task state

| Task | Status | Attempts |
| --- | --- | ---: |

## Transition history

| Sequence | From | To | Actor | Note |
| ---: | --- | --- | --- | --- |
````

## RESULTS.md attempt and summary

````markdown
# Results: <title>

## TASK-001 — Attempt 1

- **Contract revision**: 1
- **Contract digest**: sha256:<digest>
- **Outcome**: Completed | Blocked | Failed
- **Files changed**: ...
- **Implementation**: ...
- **Validation**: ...
- **Deviations**: None
- **Remaining risks**: ...
- **Review notes**: ...

## Plan execution summary

- **Contract revision**: 1
- **Contract digest**: sha256:<digest>
- **Outcome**: Implemented
- **Tasks**: ...
- **Files changed**: ...
- **Plan-wide validation**: ...
- **Deviations**: None
- **Remaining risks**: ...
````

## REVIEW.md round

````markdown
# Review: <title>

## Review round 1

- **Contract revision**: 1
- **Contract digest**: sha256:<digest>
- **Implementation baseline**: <SHA and dirty files or exact limitation>
- **Status**: Changes required | Blocked | Ready for user confirmation
- **Reviewed scope**: ...
- **Findings**: ...
- **Acceptance criteria**: ...
- **Validation**: ...
- **Remaining risks**: ...
````

After explicit user confirmation and applicable canonical documentation updates, append:

````markdown
## Finalization

- **Contract revision**: 1
- **Contract digest**: sha256:<digest>
- **User confirmation**: <exact confirmation and date>
- **Canonical documentation updates**: <exact paths, or None required>
- **Validation freshness**: <why the passing review remains current>
````
