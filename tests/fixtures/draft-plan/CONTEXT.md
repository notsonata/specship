```json
{
  "artifact": "context",
  "protocol_version": "0.2.0",
  "plan_id": "fixture-plan",
  "contract_revision": 1
}
```

# Context: Fixture plan

## Request

Add a deterministic greeting helper.

## Repository evidence

- `src/greeting.py`: The target path for this isolated fixture.

## Goals, constraints, and non-goals

- **Goal**: Return a stable greeting.
- **Constraint**: Use no dependency.
- **Non-goal**: Localization.

## Clarification ledger

No questions were needed because the observable output is explicit.

## Decision ledger

### D-001: Use a pure function

- **Status**: Active
- **Rationale**: The requested behavior has no I/O.

## Assumption ledger

### A-001: Python is available

- **Risk**: Low for this validator fixture.
- **Authorization**: Repository convention

## Revision history

- **Revision 1**: Initial contract.
