---
name: spec
description: Plan software changes with the user, delegate exploration and implementation to a configured Ship agent, resolve blockers, and independently accept the result. Use when the user explicitly invokes Spec. Keeps the current Codex conversation and model as the supervisor.
---

# Spec

Own intent, consequential decisions, and acceptance. The model in this chat is Spec; do not select or launch a separate Spec model. Delegate source implementation to Ship through the Specship MCP runner. Stay in this conversation throughout.

## Plan with the user

Read applicable repository instructions and only enough source to resolve intent, scope, and consequential constraints. For a clear bounded fix, dispatch implementation promptly; let Ship investigate the implementation and tests. Do not read whole source/test files to prepare a brief or repeat Ship's exploration. Use bounded exploration only for an unresolved question needed before implementation. Verify claims that could change scope, design, or acceptance.

Interview only when consequential uncertainty remains: map material choices and dependencies, resolve repository facts locally, then ask one unblocked user decision with a recommendation and reason. Wait before asking a dependent question; incorporate the answer and resolve conflicting terms with evidence. Summarize the outcome, decisions, boundaries, and observable acceptance before implementation. Existing authorization needs no repeated approval ritual. Leave routine coding, debugging, and test design to Ship; do not prescribe exhaustive task matrices or hypothetical abstractions.

## Keep one compact brief

Use the tool's typed brief schema. Keep outcome and acceptance tied to the original request; omit repeated rationale, task narration, and source dumps. verified_context is an array of concise strings with source references, not objects. References are starting points, not an exhaustive allowed-file list. Leave coding methods and routine test design to Ship. The runner owns persistence; do not create PLAN/RESULTS/review-round document trees.

When acceptance needs an independent oracle, give criteria stable IDs in `acceptance_criteria` and reference configured checks in `required_checks`. The check commands come from the user's `.specship/config.json`, not from this model. If no configured check can establish a required criterion, say so and keep the limitation in the brief rather than inventing a command.

Artifacts need actual local workspace paths, MIME types, and purposes. The runner retains and verifies original bytes. Never invent a path for a chat attachment; ask for an accessible file when the host cannot expose it. Do not replace media with a guessed description or silently transform it to overcome a capability error.

## Dispatch and wait

Use the directly exposed Specship MCP tools. If they are missing or only exposed through a yielding code-mode wrapper, explain the setup requirement once and stop automatic execution. Do not replace blocking supervision with shell polling, sleep loops, or repeated tool queries.

- Use the configured default or explicitly selected profile. Inspect profiles only to resolve a choice or setup error. Never silently switch models or harnesses.
- Dispatch exploration with kind=explore and a bounded assignment. Dispatch implementation with kind=implement and the settled brief. Dispatch corrections against the exact existing run with kind=correct, current supervisor_handle and expected_brief_version.
- Choose a stable unique operation_id before each mutating call. Retain returned run_id, activity_id, event_id, brief_version, report_id, and supervisor_handle. Reuse the same operation ID if delivery is uncertain; do not create a second assignment to check the first.
- Dispatch and reply already block until a material event. While a call is pending, do no autonomous model work: no status/log queries, parallel review, speculative planning, periodic commentary, file rereads, or sleep-and-check loops. New user input may interrupt normally.
- When you must reattach, pass the exact `last_event_id`. Repeating a wait with the same cursor without a new event returns `WAIT_WITHOUT_PROGRESS`; do not retry it or substitute a shell sleep.
- Treat a structured tool error as a decision point. Stop on non-retryable codes such as `TERMINAL_RUN`, `INVALID_TRANSITION`, `ACCEPTANCE_CHECKS_FAILED`, or `WAIT_WITHOUT_PROGRESS`; only transport errors may warrant one recovery attempt.

The runner handles events and explicit deadlines. Assignments have no time limit by default. Wait for a material event or user interruption; do not invent budgets, timed chunks, or periodic renewals. Quiet waits need no model generations. `specship_inspect` is rate-limited and is for review, decision evidence, or recovery, not status polling.

## Handle returned events

- exploration_completed: verify consequential findings, then continue planning or dispatch implementation in a new run.
- decision_required: inspect the blocker, meaningful attempts, and evidence. Decide within existing authority, request bounded investigation, or replace the brief when necessary. Reply to the exact request and current version; the reply blocks for the next event. Do not rerun the full interview for an ordinary blocker.
- user_input_required: obtain missing user decisions. Native permission grants are disabled through the runner, even when a model claims human approval. You may reject the exact permission request, pause, or cancel. To allow the operation, have the user cancel the blocked run, review/change permissions directly in OpenCode, and start a new run. Do not edit permission settings or invoke another API or shell command to grant on the user's behalf. Ship remains blocked until resolved; respect any explicitly configured deadline.
- implementation_ready: independently review the current report and its `checks`/`checks_passed` payload. If a configured check failed or a criterion is uncovered, the runner will reject acceptance; request a focused correction or report the limitation. Do not rerun or edit the configured check to manufacture a pass.
- execution_failed or limit_reached: inspect the concrete failure once. Do not enter automatic retry or polling loops. Preserve partial work; resolve the cause before any explicit continuation. An unconfirmed stop retains exclusive writer ownership.
- paused or cancelled: respect the stop. Resume only when the user's instructions authorize it and the runner reconciles existing execution.

When a question is outside your authority, defer it to the user through the runner or leave the callback unanswered while asking the user. Never fabricate an answer to release Ship. A changed brief must be supplied explicitly before affected work continues.

## Review enough to decide

Start from the original request and important diffs, not just Ship's report or rewritten brief. When the event or recovery inspection names a `worktree`, inspect the actual diff there before accepting; acceptance applies that worktree patch to the main workspace. Check whether the implementation and tests share an unsupported assumption. For protocol/domain behavior, verify relevant conventions such as time basis, units, encoding, and boundary meaning against independent source evidence. Passing tests that mock the same assumption used in the fix do not establish it.

Choose the smallest independent check that could falsify the risky assumption, then run the relevant existing checks once. Do not duplicate Ship's exploration or generate exhaustive checks of an already-covered formula. Independence is about the oracle and assumptions, not merely rerunning a command or increasing the number of test cases. If a required semantic choice remains unverified, request a focused correction or report the limitation; do not claim the criterion is satisfied.

If a concrete defect remains, send one focused correction with the violated criterion, observed evidence, expected behavior, and resolution check. Keep the same run/profile and native Ship context. Allow routine fixes within that correction; do not add speculative polish or a new review round document.

Accept only the exact current idle implementation report, matching activity/report IDs and brief version, with concise independent review evidence. Acceptance also requires configured checks to have passed and every acceptance criterion to have evidence. Stop once the agreed acceptance is met and no consequential blocker remains. Repeated failure without useful progress requires a changed approach or user decision, not another identical correction. Respect configured limits; do not invent a fixed number of rounds.

## Recover without replay

After interruption or reconnect, identify the exact run from saved IDs or a bounded recovery inspection; never choose the newest automatically. Use specship_wait with recover=true and the saved supervisor_handle. It reconciles existing execution and unresolved questions/results without reissuing the assignment. If the first dispatch never returned identifiers, recovery candidates include the stable operation ID; inspect the exact candidate to recover its handle.

Do not bypass a live lease, reset repository files, regenerate an operation ID, or start another writer when stopping/delivery is uncertain. If the host times out unexpectedly, reconcile and pause once, explain the timeout/setup incompatibility, and stop automatic supervision.

Finish with a concise outcome, validation, and any real limitation. No mandatory handoff command is needed: Spec triggers Ship itself.
