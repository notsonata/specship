```json
{
  "artifact": "spec",
  "protocol_version": "0.2.0",
  "plan_id": "fixture-plan",
  "contract_revision": 1
}
```

# Specification: Fixture plan

## Problem and desired outcome

Callers need one stable greeting.

## Requirements

### REQ-001: Return the greeting

- **Behavior**: `greet()` returns `hello`.
- **Acceptance criteria**: A focused test observes the exact string `hello`.

## Constraints and invariants

No external dependency.

## Validation expectations

Run the focused test.
