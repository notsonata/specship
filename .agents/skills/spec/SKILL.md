---
name: spec
description: Investigate a software repository and create, update, or independently review a decision-complete implementation contract under docs/plans without implementing source changes. Use when the user explicitly invokes the spec skill to prepare an exact handoff for a separate execution agent, including agents with less reasoning capacity, or to review work completed from that contract.
---

# Spec

Act as the planning and review agent. Turn the user's request and verified repository evidence into a compact implementation contract that a separate agent can execute without this session, hidden assumptions, or material design decisions. Never implement source changes, including during review.

## Use host-native explicit syntax

Use the invocation syntax native to the active host:

- Codex: `$spec` and `$ship`.
- Slash-command hosts: `/spec` and `/ship`.
- Other hosts: select or invoke the installed `spec` and `ship` skills using that host's normal skill interface.

Preserve the active host's syntax in every ready-to-copy handoff. The examples below use `/spec` and `/ship` as protocol notation unless both host forms are shown; do not present slash syntax as universal.

## Choose the operation

- `/spec <request>`: create a plan.
- `/spec update docs/plans/<plan> [new information]`: update an existing plan.
- `/spec review docs/plans/<plan>`: review the implementation against the plan.

Require the exact folder before updating or reviewing. Never guess or silently replace a plan folder.

## Use the plan folder as the handoff

Store each plan at `docs/plans/<plain-kebab-case-slug>/`:

```text
PLAN.md                       # execution contract owned by spec
RESULTS.md                    # non-review execution log owned by ship
reviews/
└── round-001/
    ├── REVIEW.md             # one immutable review round owned by spec
    └── RESULTS.md            # that round's corrective execution owned by ship
```

Do not create `RESULTS.md` or `reviews/` during initial planning. Never write review findings to root `REVIEW.md`. Do not edit any `RESULTS.md`. Do not edit `PLAN.md` while `/ship` is executing it.

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

### Ambiguity gate: invoke grilling before assuming

Do not convert an unresolved material question into an assumption. After repository research and before sealing a plan or review result, classify each uncertainty:

- **Fact** — inspect the repository, tools, tests, schemas, or docs and resolve it yourself.
- **Material decision** — invoke the existing `grilling` skill and wait for its design-tree interview to reach a user-confirmed shared understanding.
- **Vocabulary or documentation conflict** — invoke the existing `grill-with-docs` skill so its `grilling` and `domain-modeling` dispatches handle the repository terminology and requested documentation trail.
- **Ambiguous review finding or user feedback** — invoke `grilling` before assigning a finding, changing scope, or accepting a correction. If the required skill is unavailable or the user does not settle the decision, report `Blocked` rather than guessing.

Do not copy or inline the grilling questionnaire, create a local alias, or act on a recommended answer without user confirmation. Capture the confirmed result in the plan's requirements, scope, decisions, risks, and validation. If the required skill cannot be invoked, stop and report the missing capability; never silently fall back to an assumption.

### Write one decision-complete `PLAN.md`

Use the following sections in this order. Omit a section only when it truly does not apply.

```markdown
# Plan: <outcome>

**Plan revision**: 1

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

Every new plan starts at revision `1`. `Plan revision` is only an identity marker for reconciling artifacts after an explicit update; it is not a lifecycle state, lock, digest, or approval mechanism.

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

End with the folder and an exact handoff using the active host's syntax: `$ship implement this plan: docs/plans/<plan>` in Codex or `/ship implement this plan: docs/plans/<plan>` on slash-command hosts.

## Update a plan

1. Read `PLAN.md`, root `RESULTS.md`, all existing `reviews/round-NNN/REVIEW.md` and `reviews/round-NNN/RESULTS.md` files, and relevant repository changes.
2. Read `Plan revision`; treat a legacy plan with no revision field as revision `1`.
3. Investigate the new information before editing.
4. Update requirements, decisions, change map, tasks, traceability, and executor brief together so the contract remains consistent.
5. Set `Plan revision` to the previous integer plus one. Every explicit update must increment the plan revision by exactly one.
6. Add or replace `## Revision impact` with the prior revision, current revision, and exact task IDs that `/ship` must revalidate. State `All tasks` when the new information invalidates the whole execution contract.
7. Preserve useful history through version control rather than embedding a revision ledger.
8. Review-only fixes stay in `REVIEW.md`. Change `PLAN.md` only for the new information explicitly supplied to `/spec update`, never merely to absorb review findings.
9. Report that execution and review artifacts from an older plan revision may be stale and `/ship` must reconcile the named revision-impact tasks against the repository.

An unexecuted `Changes required` review from an older plan revision is historical after an update. Do not edit its immutable `REVIEW.md`; treat its correction work as `Superseded by plan revision <current>`. The next `/ship` executes the updated plan and writes root `RESULTS.md`. A later `/spec review` creates a new round against the current revision.

Do not edit implementation files or rewrite execution history.

## Review implementation

Treat review as a fresh check of the repository, not approval of `/ship`'s narrative. Every invocation owns one new immutable review round.

Never edit `PLAN.md` during review. The sealed plan remains the acceptance boundary; corrective execution instructions belong only in the current round's `REVIEW.md`.

1. Read `PLAN.md`, root `RESULTS.md` when present, and every existing numbered review folder in order, including both `REVIEW.md` and `RESULTS.md` when present. Treat a legacy plan, review, or result artifact with no `Plan revision` as revision `1`.
2. Set the current round to one greater than the highest existing `reviews/round-NNN/` number, starting at `round-001`. Format `NNN` as a zero-padded three-digit number. Never reuse, overwrite, or skip an existing round number.
3. Freeze the acceptance boundary to the current objective, requirements, scope, acceptance criteria, and preserved behavior. Never add or broaden a requirement during review.
4. On the first review, inspect the implementation changes and relevant surrounding code. A corrective finding must demonstrate a violation of the frozen acceptance boundary or a regression in an in-scope changed surface.
5. On re-review, first reconcile every earlier open finding, then inspect the corrective changes and their named integration boundaries. Do not repeat a general repository audit. A new finding must be either a regression introduced by corrective work or a newly evidenced violation of the frozen acceptance boundary in the corrected integrated result.
6. Check applicable tasks, change-map entries, integration gates, root execution evidence, and round-scoped corrective evidence, including whether the implementation reused appropriate existing mechanisms and kept proportional complexity for the contract.
7. Rerun proportionate validation when feasible and state anything not run.
8. Report findings ordered by severity with file and location evidence.
9. Create `reviews/round-NNN/` and write this round only to `reviews/round-NNN/REVIEW.md` for every outcome: `Pass`, `Changes required`, or `Blocked`. Record the current plan revision explicitly in every new review.

Treat unnecessary complexity as actionable only when it creates correctness, maintenance, contract, integration, or scope risk. Do not report subjective style preferences as findings.

An issue that does not violate the frozen acceptance boundary is an observation, not a finding. Do not assign it a finding ID, add corrective work, or let it prevent `Pass`. If it would require new product behavior, architecture, scope, or acceptance criteria, tell the user they may request `/spec update`; do not silently turn it into contract work. Use `Blocked` only when a missing decision or evidence prevents judging the existing contract.

### Maintain review findings

Give each durable actionable finding a stable identifier derived from its folder number, such as `R1-F1` in `round-001` and `R2-F1` in `round-002`. Do not assign IDs to observations or optional suggestions.

During re-review, mark a finding `Resolved` when verified, `Open` when it remains, and `Superseded` only when later contract or implementation changes make it inapplicable. Preserve the original finding and required correction. Add concise resolution evidence.

Each `REVIEW.md` contains that round's outcome, earlier findings checked, new findings, requirement and acceptance results, validation performed, validation omitted with reasons, and remaining risks. Never append a later round to an earlier file.

Use one outcome:

- `Changes required`: one or more in-bound findings require implementation changes.
- `Blocked`: required evidence, access, or a material decision is missing.
- `Pass`: all earlier findings are resolved or superseded, no in-bound corrective finding remains, and checked requirements pass. Out-of-scope observations do not prevent `Pass`.

Use this exact review shape:

```markdown
# Review: round-NNN

- **Plan**: `docs/plans/<plan>/PLAN.md`
- **Plan revision**: <integer>

## Outcome

**Pass | Changes required | Blocked**

## Contract checked

- **Requirements**: REQ-001, REQ-002
- **Acceptance criteria**: Checked | Partially checked | Not checked (reason)
- **Scope and preserved behavior**: Checked | Partially checked | Not checked (reason)

## Prior findings

- R1-F1 — Resolved | Open | Superseded — evidence, or `None`.

## Findings

### R1-F1: <title>

- **Status**: Open
- **Severity**: High | Medium | Low
- **Contract mapping**: REQ-001, named acceptance criterion, scope boundary, or preserved behavior
- **Evidence**: `path/to/file:line` and observed behavior
- **Violation**: Exact contract failure
- **Required correction**: Decision-complete implementation instruction
- **Files and symbols**: `path/to/file` — `symbolName`
- **Constraints preserved**: Behavior that must remain unchanged
- **Regression coverage**: Exact test or check to add or update
- **Validation**: `exact command`
- **Dependencies**: None, or earlier finding IDs

Use `None` when there are no findings.

## Requirement results

| Requirement | Result | Evidence |
| --- | --- | --- |
| REQ-001 | Pass | Named test, code, or behavior |

## Validation

- `command` — Passed | Failed | Not run (reason)

## Observations

- Out-of-scope or optional note, or `None`.

## Remaining risks

- Bounded risk, or `None`.
```

### Write corrective review instructions

When the outcome is `Changes required`, write decision-complete corrective work into the current `REVIEW.md` for `/ship` without changing `PLAN.md`:

1. Map every open finding to an existing requirement, acceptance criterion, scope boundary, or preserved behavior. If it cannot map to the frozen contract, reclassify it as an observation or blocker.
2. For each finding, include the repository evidence, required correction, exact files or symbols, constraints to preserve, regression coverage, and validation that proves resolution.
3. Order dependent corrections explicitly and identify shared integration checks. Do not assign new plan task IDs or rewrite completed plan tasks.
4. Resolve implementation choices inside the review. Do not delegate material product or architecture judgment to `/ship`; use `Blocked` when such a decision is missing.
5. Direct `/ship` to evaluate and execute the open findings from this `REVIEW.md` and record the correction cycle only in `reviews/round-NNN/RESULTS.md`. Root `RESULTS.md` must not receive review-correction evidence.

There is no automatic retry or convergence cutoff. Each user-invoked `/spec review` creates the next numbered round, reconciles prior findings, and reports `Pass`, `Changes required`, or `Blocked` from current evidence.

For `Blocked`, record the blocker and ask the exact question needed to continue; do not manufacture corrective work.

Report the outcome, findings ordered by severity, validation results, the exact `reviews/round-NNN/REVIEW.md` path, the unchanged plan path and revision, and any blocker. When the outcome is `Changes required`, state that corrective evidence belongs in `reviews/round-NNN/RESULTS.md`, then end with a ready-to-copy prompt using the exact plan folder and the active host's syntax:

```bash
$ship implement this plan: docs/plans/<plan>
# or, on slash-command hosts:
/ship implement this plan: docs/plans/<plan>
```

The prompt is for the existing `/ship` session when available. Never start or imply concurrent `/ship` executions for the same plan.

Do not add a separate finalization workflow. Follow the target repository's instructions for canonical documentation during normal implementation.
