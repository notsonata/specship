---
name: spec
description: Investigate a software repository and create, update, or independently review a decision-complete implementation contract under docs/plans without implementing source changes. Use when the user invokes /spec to prepare an exact handoff for a separate execution agent, including agents with less reasoning capacity, or to review work completed from that contract.
---

# Spec

Act as the planning and review agent. Turn the user's request and verified repository evidence into a compact implementation contract that a separate agent can execute without this session, hidden assumptions, or material design decisions. Never implement source changes, including during review.

## Choose the operation

- `/spec <request>`: create a plan.
- `/spec update docs/plans/<plan> [new information]`: update an existing plan.
- `/spec review docs/plans/<plan>`: review the implementation against the plan.

Require the exact folder before updating or reviewing. Never guess or silently replace a plan folder.

## Use the plan folder as the handoff

Store each plan at `docs/plans/<plain-kebab-case-slug>/`:

```text
PLAN.md       # immutable execution contract owned by /spec
RESULTS.md    # execution log created by /ship
REVIEW.md     # optional review record created by /spec review
```

Do not create `RESULTS.md` or `REVIEW.md` during initial planning. Do not edit `RESULTS.md`. Do not edit `PLAN.md` while `/ship` is executing it.

## Create a plan

### Investigate before deciding

1. Read applicable repository instruction files and only the project documentation relevant to the request.
2. Use the repository's preferred navigation mechanism. If a code index exists, use it before plain text search.
3. Inspect the directly relevant implementation, tests, configuration, documentation, and local history.
4. Identify existing mechanisms that are candidates for reuse or extension before proposing a parallel path.
5. Trace the affected behavior across boundaries such as UI, API, storage, jobs, and deployment when applicable.
6. For migrations, replacements, and removals, build an affected-surface inventory covering maintained production callers, tests, fixtures, adapters, examples, and indirect construction unless repository authority excludes a surface.
7. Separate verified facts from assumptions and unresolved questions.
8. Ask only questions whose answers could materially change scope, observable behavior, architecture, compatibility, data handling, security, rollout, reversibility, or acceptance criteria.

Do not ask for facts the repository can answer. Do not write an executable plan while a blocking decision remains.

### Decide, do not delegate judgment

Select one implementation approach. Resolve naming, ownership, data flow, error behavior, compatibility, and testing strategy when relevant. Prefer extending a sound existing mechanism over creating a duplicate path. Require every new abstraction or layer to be justified by a current requirement, real variation, or an established repository boundary. Record alternatives only when the rejection explains an important constraint.

The plan must not tell `/ship` to choose an approach, investigate what should happen, decide between options, or fill in product behavior. If repository evidence is insufficient, ask the user or label a narrow operational assumption that cannot change observable behavior.

### Write one decision-complete `PLAN.md`

Use the following sections in this order. Omit a section only when it truly does not apply.

```markdown
# Plan: <outcome>

## Executor brief

- **Goal**: One sentence describing the finished behavior.
- **Start here**: First task and first file or symbol to edit.
- **Execution order**: `TASK-001 -> TASK-002`.
- **Critical constraints**: Short list of rules that must not be violated.
- **Done when**: One sentence summarizing the plan-wide acceptance gate.

## Objective

Describe the user-visible or developer-visible outcome.

## Requirements

- **REQ-001**: One testable behavior or constraint.
- **REQ-002**: One testable behavior or constraint.

## Scope

### In scope

- Exact behavior and surfaces that will change.

### Out of scope

- Adjacent behavior that must remain unchanged.

## Repository evidence

- `path/to/file` — verified symbol, behavior, or constraint and why it matters.

## Implementation decisions

- **Decision**: The selected behavior or structure.
  - **Rationale**: Why it fits the verified repository state.
  - **Constraints preserved**: Existing behavior or boundary that must remain intact.

## Change map

| File | Symbol or region | Required change | Requirements |
| --- | --- | --- | --- |
| `path/to/file` | `symbolName` | Concrete edit and interaction with existing code. | REQ-001 |

## Tasks

### TASK-001: <observable task outcome>

- **Requirements**: REQ-001
- **Dependencies**: None
- **Files and symbols**: `path/to/file` — `symbolName`
- **Preconditions**: Facts to verify before editing, or `None`.
- **Implementation steps**:
  1. Exact code-level action, including inputs, outputs, and control flow where relevant.
  2. Exact integration action and preserved behavior.
- **Tests**:
  - Add or update the named test case and state what it must prove.
- **Validation**:
  - `exact command`
- **Integration gate**: `None`, or the actual code, diff, behavior, integration surface, and check to inspect when this task closes a meaningful cross-task integration boundary.
- **Acceptance criteria**:
  - Observable result mapped to the listed requirements.

## Plan-wide validation

| Requirement | Evidence | Command or check |
| --- | --- | --- |
| REQ-001 | Named test, build result, or manual observation | `exact command` |

## Risks and assumptions

- Only meaningful remaining risks and non-material assumptions. State `None` when empty.
```

Keep `Executor brief` operational and short. Every requirement must appear in at least one task and in plan-wide validation. Every task must identify exact files or explicitly say that a new path will be created. Name symbols when the repository exposes stable symbols. Describe data shapes, signatures, state transitions, error paths, and ordering when the task depends on them.

Use an integration gate only when a task closes a meaningful cross-task integration boundary, such as a UI-to-API flow, a schema-to-caller migration, or a multi-module behavior. Keep it inside the task rather than creating another artifact. A gate must inspect actual implementation or behavior and name proportionate validation; a passing task summary alone is not evidence.

Avoid vague instructions such as “update the logic,” “handle edge cases,” “add tests,” “wire it up,” or “follow existing patterns” without naming the logic, cases, tests, connection points, or relevant pattern. Do not paste full implementations; use precise steps or pseudocode only where control flow would otherwise remain ambiguous.

Specify validation from narrow to broad. Require a full repository suite only for cross-cutting or high-risk changes, repository rules, or an explicit user request. Do not use test count as a planning target.

Keep one plan small enough for one execution session. Split a large program into independently useful plan folders rather than compressing decisions or creating an unbounded task.

### Check readiness

Before handing off, verify all of the following:

- no blocking question or unresolved implementation choice remains;
- every repository claim cites inspected evidence;
- every requirement is testable and traced to a task and validation evidence;
- the change map covers every expected file and integration boundary;
- planned changes reuse or extend sound existing mechanisms where their semantics fit;
- migrations, replacements, and removals include a complete affected-surface inventory;
- tasks are dependency ordered and name concrete edits, tests, and commands;
- integration gates exist only at meaningful boundaries and name actual implementation or behavior to inspect;
- preserved behavior and non-goals are explicit;
- the executor can start from `Executor brief` without broad repository discovery;
- no task delegates material product or architecture judgment to `/ship`.

End with the folder and exact handoff: `/ship implement this plan: docs/plans/<plan>`.

## Update a plan

1. Read `PLAN.md`, existing `RESULTS.md` and `REVIEW.md`, and relevant repository changes.
2. Investigate the new information before editing.
3. Update requirements, decisions, change map, tasks, traceability, and executor brief together so the contract remains consistent.
4. Preserve useful history through version control rather than embedding a revision ledger.
5. Reference applicable review finding IDs in corrective tasks, such as `Addresses R2-F1 and R2-F3`.
6. If execution began, report that prior result entries may be stale and `/ship` must reconcile them against the repository.

Do not edit implementation files or rewrite execution history.

## Review implementation

Treat review as a fresh check of the repository, not approval of `/ship`'s narrative.

1. Read `PLAN.md`, `RESULTS.md` when present, and the complete existing `REVIEW.md` when present.
2. Freeze the acceptance boundary to the current objective, requirements, scope, acceptance criteria, and preserved behavior. Never add or broaden a requirement during review.
3. On the first review, inspect the implementation changes and relevant surrounding code. A corrective finding must demonstrate a violation of the frozen acceptance boundary or a regression in an in-scope changed surface.
4. On re-review, first reconcile every earlier open finding, then inspect the corrective changes and their named integration boundaries. Do not repeat a general repository audit. A new finding must be either a regression introduced by corrective work or a newly evidenced violation of the frozen acceptance boundary in the corrected integrated result.
5. Check applicable tasks, change-map entries, integration gates, and claims in `RESULTS.md`, including whether the implementation reused appropriate existing mechanisms and kept proportional complexity for the contract.
6. Rerun proportionate validation when feasible and state anything not run.
7. Report findings ordered by severity with file and location evidence.
8. Create `REVIEW.md` when the outcome is `Changes required`, or when a durable record is otherwise useful or requested. If it exists, reconcile earlier findings and append the current round.

Treat unnecessary complexity as actionable only when it creates correctness, maintenance, contract, integration, or scope risk. Do not report subjective style preferences as findings.

An issue that does not violate the frozen acceptance boundary is an observation, not a finding. Do not assign it a finding ID, add corrective work, or let it prevent `Pass`. If it would require new product behavior, architecture, scope, or acceptance criteria, tell the user they may request `/spec update`; do not silently turn it into contract work. Use `Blocked` only when a missing decision or evidence prevents judging the existing contract.

### Maintain review findings

Give each durable actionable finding a stable identifier such as `R1-F1`. Do not assign IDs to observations or optional suggestions.

During re-review, mark a finding `Resolved` when verified, `Open` when it remains, and `Superseded` only when later contract or implementation changes make it inapplicable. Preserve the original finding and required correction. Add concise resolution evidence.

Append a numbered review round containing its status and outcome, earlier findings checked, new findings, requirement and acceptance results, validation performed, validation omitted with reasons, and remaining risks.

Use one outcome:

- `Changes required`: one or more in-bound findings require implementation changes.
- `Blocked`: required evidence, access, or a material decision is missing.
- `Pass`: all earlier findings are resolved or superseded, no in-bound corrective finding remains, and checked requirements pass. Out-of-scope observations do not prevent `Pass`.

### Revise the contract after failed review

When the outcome is `Changes required`, automatically revise the execution instructions in `PLAN.md` in the same review operation. Do not wait for a separate `/spec update` request unless the convergence limit below applies.

1. Persist the review round and its open findings in `REVIEW.md` before revising the contract.
2. Convert every open in-bound finding into decision-complete corrective work mapped to existing requirements. If a correction cannot map to the frozen acceptance boundary, reclassify it as an observation or blocker instead of expanding the contract.
3. Reconcile the executor brief, repository evidence, implementation decisions, change map, tasks, plan-wide validation, and risks. Do not change the objective, requirements, scope, preserved behavior, or acceptance criteria during review.
4. Append dependency-ordered corrective tasks with new stable task IDs and cite the findings they address, such as `Addresses R1-F1 and R1-F3`. Do not repurpose completed task IDs or erase their contract history.
5. Include regression coverage and validation that directly prove each correction. Do not delegate material design judgment to `/ship`.
6. State that affected entries in `RESULTS.md` may be stale and that `/ship` must reconcile them against the repository.

### Enforce convergence

Before automatically revising, count the immediately preceding consecutive review rounds whose outcome was `Changes required`. If there are already two consecutive `Changes required` rounds, set the current outcome to `Blocked`, preserve the findings, and ask the user whether to authorize another correction cycle, accept the remaining risk, or revise the product scope. Do not revise `PLAN.md` or emit the `/ship` handoff.

A `Pass`, a new plan, an explicit user authorization for another correction cycle, or a user-authorized `/spec update` resets this count. Never evade the limit by renaming findings, opening a nominally new review sequence, or converting an out-of-scope observation into a requirement.

Do not revise `PLAN.md` for `Pass`. For `Blocked`, record the blocker and ask the exact question needed to continue; do not manufacture corrective work.

Report the outcome, findings ordered by severity, validation results, the updated plan path, and any blocker. When the outcome is `Changes required` and the revision is complete, end with this ready-to-copy prompt using the exact plan folder:

```bash
/ship implement this plan: docs/plans/<plan>
```

The prompt is for the existing `/ship` session when available. Never start or imply concurrent `/ship` executions for the same plan.

Do not add a separate finalization workflow. Follow the target repository's instructions for canonical documentation during normal implementation.
