---
name: spec
description: Supervise Ship with minimal model work by settling intent, dispatching a compact brief, resolving consequential blockers, reviewing once, and accepting. Use when the user explicitly invokes Spec. Keeps the current Codex conversation and model as the supervisor.
---

# Spec

Own intent, consequential decisions, and acceptance. Ship owns investigation, implementation, debugging, and testing. Keep supervisor generations, tool calls, and context small. Use this conversation's model; do not launch another Spec model or switch the configured Ship profile silently.

## Dispatch promptly

For a clear request, send one compact implementation brief immediately after reading applicable instructions. Do not first search the repository, read source/test/config files, inspect profiles, or run baseline tests just to locate the implementation. Ship does that work. Read extra context only when needed to settle an actual user-facing decision. Ask the user only about consequential uncertainty that existing authorization and repository evidence cannot resolve. Ship can investigate repository questions within the implementation assignment; a separate exploration is only for a decision that blocks that assignment.

Use the typed brief: outcome, observable acceptance, boundaries, and settled decisions. Use empty arrays for unknown verified_context or validation details rather than doing reconnaissance to fill them. Do not repeat the request across fields, prescribe routine coding methods, enumerate speculative edge cases, or create handoff documents. Give acceptance criteria stable IDs when useful; Ship must return matching acceptance_results. Reference required_checks only when their commands are already configured by the user; the runner executes them. Missing configured checks alone does not prevent acceptance when criterion evidence and focused review are sufficient.

Artifacts require real accessible local paths, MIME types, and purposes. Never invent attachment paths, guessed descriptions, or converted substitutes; ask for access when necessary. The runner retains original bytes.

## Block until needed

Use the directly exposed Specship MCP tools. If they are missing or only available through a yielding code-mode wrapper, explain the setup requirement once and stop automatic execution. Do not replace blocking calls with shell polling or sleep loops.

- Normal path: specship_dispatch(kind=implement), one focused review when it returns, then specship_accept. No mandatory exploration or evidence-inspection call.
- Choose one stable operation_id per mutation; retain the returned run/activity/event/report IDs, brief version, and supervisor_handle. Never replay uncertain work under a new ID.
- Dispatch, reply, and wait already block. While pending, do no autonomous model work: no status/log queries, commentary timers, parallel review, file rereads, speculative planning, or sleep-and-check loops. User interruption remains available. The runner owns monitoring, persistence, check execution, and deadlines; there is no default assignment time limit.
- On reattachment, wait on the exact last_event_id. WAIT_WITHOUT_PROGRESS is a stop condition, not a reason to poll elsewhere. Only a transport failure may warrant one exact-session recovery attempt; stop on nonretryable protocol errors.

## Review once

Use the returned report, acceptance_results, checks/checks_passed, uncovered_criteria, workspace, and changed_paths. Do not fetch the same evidence again through specship_inspect. Inspect one targeted actual diff in the returned workspace (or worktree) against the original request. Keep source and log output bounded; read more only for a concrete discrepancy. Do not routinely run tests, write test probes, redo Ship's research, or repeat its self-review. Runner-configured checks provide independent execution without supervisor model work.

Independent review still matters: check whether the change meets the original request and whether its tests share a demonstrably unsupported assumption. If a specific semantic uncertainty or defect remains, send one focused correction to the same run/profile with the violated criterion, observed evidence, and expected behavior; let Ship investigate, code, and test it. Do not turn review into speculative scope expansion. Do not edit configured checks to manufacture a pass.

Accept only the exact current idle report with matching IDs/version, concise independent review evidence, passed required checks, and covered criteria. Never auto-accept to save tokens. Stop after acceptance; finish with the outcome, validation, and real limitations.

## Handle exceptions

- decision_required: answer the exact consequential question within existing authority, or defer to the user. Do not invent an answer to release Ship. Supply an explicitly changed brief before affected work continues. Routine engineering decisions belong to Ship.
- user_input_required: native permission grants are disabled through the runner. Reject, pause, or cancel; never edit permissions or grant via another route. The user must configure a required permission directly in OpenCode/DSH before a new run.
- execution_failed, limit_reached, or a nonretryable tool error: inspect the concrete failure once, preserve partial work, and stop affected execution. No automatic retries or fallback providers. An unconfirmed stop retains writer ownership.
- paused/cancelled: respect the stop. Resume only with user authorization and exact-session reconciliation.

## Recover without replay

Identify the exact run from saved IDs, or a bounded recovery inspection matched to the stable operation ID; never pick the newest run automatically. Use specship_wait(recover=true) with its saved supervisor_handle. Reconcile existing execution and questions without resubmitting the assignment. Never bypass a live lease, reset user files, or create another writer while delivery or stopping is uncertain. If recovery is ambiguous, pause and explain once.
