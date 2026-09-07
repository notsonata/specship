# Delegation contract

Read this reference before dispatching the first `$spec-codex` worker.

## Lanes

- `explore`: locate files, symbols, entry points, callers, callees,
  configuration, tests, data flow, and existing mechanisms.
- `impact`: inventory maintained callers, indirect construction, migrations,
  adapters, fixtures, jobs, persistence boundaries, compatibility surfaces, and
  explicitly incomplete coverage.
- `validate`: discover or run parent-prescribed test, lint, typecheck, build, or
  CI commands. Validation does not define or prove acceptance by itself.
- `review`: check one bounded requirement group, changed surface, integration
  boundary, regression risk, reuse claim, or prior finding. It never issues a
  finding, corrective scope, severity, or overall verdict.

## Task packet

Every task begins with the exact activation header:

```text
Invoked by: $spec-codex
Mode: specification evidence
```

Then send:

```text
Lane: explore | impact | validate | review
Objective: one bounded evidence question
Scope: known files, symbols, boundaries, or repository area
Contract: relevant REQ IDs, acceptance items, or None
Coverage required: exact surfaces to check
Commands: exact prescribed validation commands, or None
Prohibited: implementation, durable edits, decisions, canonical artifacts,
            worker spawning, raw transcript return
Return: Complete | Incomplete | Failed with compact cited evidence
```

Use a fresh worker for every independent review lane. Wait for every required
lane before reconciling the evidence.

## Scout result

```markdown
Status: Complete | Incomplete | Failed

## Evidence

### E-001
- File: `path/to/file`
- Symbol or line: `symbolName` or `path/to/file:line`
- Fact: Concrete verified fact.
- Relevance: Why it matters to the assigned objective.
- Confidence: high | medium | low

## Coverage
- Named surfaces checked and incomplete coverage.

## Existing mechanisms
- Reusable mechanism and exact location, or `None`.

## Contradictions
- Conflicting evidence, or `None`.

## Unknowns
- Unresolved gap and evidence needed, or `None`.
```

Ask for a focused correction when a scout returns raw logs, broad file dumps,
architecture recommendations, unreferenced claims, or unsupported completeness.

## Validator result

For every check require:

- exact command;
- `Passed`, `Failed`, or `Not run`;
- relevant requirement or contract item;
- concise evidence;
- before/after working-tree mutation check.

A validator may create temporary caches or build outputs required by a
prescribed command. Any durable repository mutation makes the lane `Failed`.
The validator preserves the original command status and never repairs source,
tests, configuration, dependencies, plans, or reviews.

## Worker status

- `Complete`: required coverage is established with cited evidence.
- `Incomplete`: inspected evidence is valid but named coverage remains unknown.
- `Failed`: activation, permission, command, mutation, or worker execution failed.

Workers prefer `Incomplete` over fabricated confidence and keep routine tool
transcripts in their own contexts.

If a shell or tool helper fails before the command starts with a sandbox or
session setup error such as `helper_unknown_error: setup refresh had errors`,
return `Failed` after retrying the same exact command once through the host's
approval path, when that path is available. Do not alter or broaden the command,
retry through another shell or CUA, increase reasoning effort, or request help
from another thread. Never escalate an ordinary command failure. If approval is
unavailable or denied, or the one recovery attempt fails, stop. The parent
preserves successful lanes and performs at most one bounded fallback for that
lane.
