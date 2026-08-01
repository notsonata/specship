```json
{
  "artifact": "plan",
  "protocol_version": "0.2.0",
  "plan_id": "fixture-plan",
  "contract_revision": 1
}
```

# Implementation plan: Fixture plan

## TASK-001: Add the greeting helper

- **Requirements**: REQ-001
- **Objective**: Provide `greet()` with the required output.
- **Rationale**: Satisfy the public behavior.
- **Dependencies**: None
- **Files and symbols**: `src/greeting.py`, `greet`
- **Implementation instructions**: Add the pure helper and focused test.
- **Preserve**: Existing behavior.
- **Validation**: Run the focused test command.
- **Acceptance criteria**: The exact string is returned and the test passes.
- **Evidence required**: Changed files and test output.
- **Out of scope**: Localization.
