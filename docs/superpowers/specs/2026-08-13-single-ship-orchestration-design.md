# Single-Ship Orchestration Design

## Summary

Add an optional orchestration layer around Specship that can plan with the model and harness in the initiating conversation, execute one plan with one separately selected Ship model in an isolated Git worktree, and return the integrated result to a fresh Spec reviewer. The orchestration layer remains model- and harness-agnostic through explicit runner adapters.

The existing `/spec` and `/ship` skills remain the protocol core. The plan folder remains the only required handoff between planning, execution, and review.

## Goals

- Preserve `/spec` as a planning and review role and `/ship` as the sole implementation role.
- Let the initiating conversation's harness, model, and reasoning configuration act as the Spec profile.
- Let the user select a different harness, provider, and model for Ship execution.
- Support cross-harness combinations such as Codex Sol planning with Codex Luna shipping, or Claude Code planning with OpenCode shipping through OpenRouter.
- Execute Ship in an isolated worktree and branch.
- Keep raw Ship logs out of the Spec context.
- Automatically monitor execution, run an independent review, and return actionable findings to the same Ship session.
- Stop after at most two review-driven correction attempts.
- Require user approval for Git mutations and destructive actions while allowing ordinary bounded engineering work to proceed automatically.
- Report execution status, validation evidence, model usage, and provider cost when the selected harness exposes them.

## Non-goals

- Multiple concurrent Ship models or task sharding.
- Competing implementations of the same plan.
- Automatic merge, push, release, or deployment.
- Automatic deletion of worktrees or branches containing user-visible work.
- A universal model benchmark or permanently ranked model catalog.
- Moving provider-specific configuration or credentials into `PLAN.md`.
- Replacing the native session, tool, or sandbox implementation of supported agent harnesses.
- Folding process supervision into the `/spec` skill itself.

## Architecture

The feature is an optional orchestrator surrounding the existing two-skill protocol:

```text
initiating conversation
  |  inherits Spec harness/model/reasoning profile
  v
/spec creates PLAN.md
  |
  v
model-free orchestrator
  |-- validates runner, authentication, repository, and plan
  |-- resolves or asks for one Ship harness/provider/model
  |-- requests approval for scoped Git setup
  |-- creates isolated worktree and branch
  |-- launches one persistent Ship session
  |-- normalizes events, approvals, usage, and terminal state
  |-- launches fresh Spec review with the initiating Spec profile
  |-- returns findings to the same Ship session, at most twice
  `-- reports the accepted or stopped branch without merging it
```

The orchestrator is deterministic application code, not another language model. Semantic planning and review remain model work; process state, retries, permissions, and bookkeeping do not.

## Components

### Orchestration command

Expose one explicit entry point, conceptually:

```text
/orchestrate [ship options] <request>
```

The command captures the initiating Spec profile, asks `/spec` to create a decision-complete plan, resolves Ship configuration, and starts the run. Explicit Ship options bypass interactive selection after validation.

Example configurations:

```yaml
spec:
  harness: inherit
  model: inherit
  reasoning: inherit

ship:
  harness: codex
  model: gpt-5.6-luna
```

```yaml
spec:
  harness: inherit
  model: inherit
  reasoning: inherit

ship:
  harness: opencode
  provider: openrouter
  model: anthropic/example-model
```

### Harness adapter

Each supported execution harness implements one normalized interface:

- Verify that the executable is installed and authenticated.
- Enumerate models currently exposed by the harness and its connected providers.
- Start a session in an exact worktree with an exact prompt.
- Resume the same session with review findings.
- Stream normalized progress, tool, approval, usage, and completion events.
- Approve, reject, or surface a pending operation without bypassing configured safety rules.
- Interrupt or terminate the owned session.
- Return a stable session identifier and terminal outcome.

The first supported Ship adapters are Codex and OpenCode. Additional adapters must satisfy the same conformance tests before being advertised.

### Spec adapter

The initiating harness supplies a Spec adapter capable of:

- Recording the initiating model and reasoning profile without copying credentials.
- Running initial `/spec` planning in the initiating conversation.
- Starting a fresh review session with the same Spec profile.
- Passing only the plan, relevant diff, concise Ship results, and proportionate validation evidence to review.
- Returning normalized review outcomes: `Pass`, `Changes required`, or `Blocked`.

If a harness cannot start a fresh matching review session, orchestration must disclose the limitation and require an explicit review profile rather than silently reusing a polluted context.

### Worktree manager

The worktree manager performs read-only repository checks first and presents the exact proposed branch and path before requesting Git approval. After approval, it creates one isolated branch and worktree from the verified baseline.

The manager must:

- Refuse ambiguous repository roots or unresolved plan folders.
- Preserve existing working-tree changes in the user's checkout.
- Record the base commit, branch, and worktree path in the run manifest.
- Never merge, push, delete, reset, or discard work without a separate user-approved Git or destructive action.
- Detect unexpected branch, HEAD, or worktree changes before resuming a run.

### Permission broker

The broker maps normalized harness operations to one of three outcomes:

- `allow`: bounded reads, edits inside the isolated worktree, configured validation commands, and explicitly permitted network or dependency operations.
- `ask`: Git mutations and operations classified as destructive or outside the approved boundary.
- `deny`: access outside the worktree, credential reads, prohibited commands, or actions the harness cannot safely classify.

The broker uses the native sandbox and permission system of each harness plus a narrow allowlist. It does not rely on a shell-command denylist as the primary containment mechanism. Non-interactive auto-approval flags may be used only when explicit `ask` and `deny` rules remain enforceable; otherwise the adapter must use an interactive or server interface that can surface pending approval requests.

### Run manifest

Persist orchestration metadata outside the immutable plan contract. The manifest records:

- Run identifier and lifecycle state.
- Plan folder and plan digest.
- Repository root, base commit, worktree, and branch.
- Spec and Ship harness/model profiles without secrets.
- Harness session identifiers.
- Review round and correction-attempt count.
- Approval decisions and their scope.
- Validation summaries.
- Token and cost data reported by each harness.
- Final outcome and required user action.

The manifest is operational state, not product or architecture authority. `PLAN.md`, repository state, `RESULTS.md`, and `REVIEW.md` retain their existing ownership rules.

## Model Selection

Ship selection is explicit or interactive:

1. If harness, provider, and model are supplied, validate that the combination is currently available.
2. If the model is omitted, list models exposed by the selected harness and connected provider.
3. The Spec model may recommend a short list using live capability, context, tool-support, and price metadata when available.
4. The user confirms the final model before paid execution begins.

Initial orchestration does not maintain a permanent quality ranking. Missing or stale metadata must be disclosed. A connected provider does not imply that every advertised model is suitable for autonomous coding or tool use.

## Execution and Review Flow

1. Validate repository state and applicable instructions.
2. Run `/spec <request>` in the initiating conversation.
3. Validate that the resulting plan is decision-complete and names one exact plan folder.
4. Resolve and confirm one Ship harness/provider/model.
5. Estimate or disclose pricing when the provider exposes it.
6. Request approval for the exact Git branch/worktree setup.
7. Create the isolated worktree and initialize the run manifest.
8. Start one Ship session with the exact handoff prompt:

   ```text
   /ship implement this plan: docs/plans/<plan>
   ```

9. Monitor normalized events without feeding raw logs into the Spec conversation.
10. Surface Git or destructive approval requests to the user; allow or deny all other operations according to the adapter policy.
11. When Ship reaches a terminal state, verify repository and result evidence.
12. Start a fresh Spec review using the initiating Spec profile.
13. On `Pass`, stop and report the branch, evidence, usage, and next actions.
14. On `Changes required`, send the persisted findings and revised handoff to the same Ship session, increment the correction count, and repeat review.
15. After two correction attempts, stop and ask the user even if findings remain.
16. On `Blocked`, provider failure, invalid repository state, or unavailable approval, preserve the run for explicit resume.

## Retry Semantics

Review-driven correction attempts and transport retries are separate:

- At most two correction attempts may follow `Changes required` reviews.
- Short provider or stream interruptions may retry with bounded backoff without consuming a correction attempt.
- A resumed provider request must attach to the same logical Ship session when supported.
- Authentication, insufficient-credit, incompatible-model, permission, and repository-integrity failures do not retry automatically.
- Exhausting correction attempts never triggers a model or harness substitution without user approval.

## Error Handling

- Fail before creating a worktree when the repository, plan, harness, provider, or model cannot be validated.
- Preserve the worktree, branch, manifest, and available session identifiers after any post-creation failure.
- Treat loss of a resumable Ship session as a blocker unless the user authorizes a fresh Ship session.
- Reject review findings that broaden the sealed plan; route scope changes back to `/spec update` and the user.
- Detect incomplete or malformed harness event streams and report the raw log location without injecting the full log into Spec context.
- Never report `Pass` solely from the Ship model's narrative; require the configured review and validation evidence.

## Security and Credentials

- Provider credentials remain in the native credential store or environment expected by each harness.
- Plans, manifests, logs, and review artifacts must never store API keys or reusable authentication tokens.
- Worktree access is the default writable boundary.
- Environment files and credential paths are denied by default unless repository instructions explicitly require a safe example file.
- External network access is adapter-configured and auditable.
- Git and destructive requests show the resolved operation and target before user approval.

## Usage and Cost Behavior

- The orchestrator itself consumes no model tokens.
- The initiating Spec model consumes tokens for planning and fresh reviews only.
- The selected Ship provider accounts for implementation and correction tokens.
- Raw Ship logs are summarized deterministically or by the Ship harness before review to avoid polluting the Spec context.
- Usage reporting distinguishes Spec, Ship, and review activity rather than presenting only an aggregate.
- The design does not promise lower total tokens; it aims for better code quality per unit cost and lets users place implementation usage on a cheaper provider.

## Testing Strategy

### Unit tests

- Lifecycle transitions and the two-correction limit.
- Model and harness option resolution.
- Permission classification and fail-closed behavior.
- Manifest serialization with secret redaction.
- Normalization of adapter events and outcomes.
- Separation of transport retries from correction attempts.

### Adapter contract tests

Run the same fixture suite against Codex and OpenCode adapters:

- Detect installed, missing, authenticated, and unauthenticated states.
- Enumerate and validate a model.
- Start in the exact worktree.
- Load and follow the `/ship` skill.
- Resume the same session with findings.
- Surface an approval request.
- Interrupt and recover session state.
- Report terminal status and usage when available.

Provider-dependent tests use mocks by default and opt-in live smoke tests to avoid unplanned charges.

### Integration tests

- Create a disposable repository and isolated worktree.
- Complete a small passing plan with one Ship session.
- Exercise one failed review followed by a passing correction.
- Exercise two exhausted correction attempts.
- Verify that unrelated changes in the user's checkout remain untouched.
- Verify that raw Ship logs do not enter the Spec review package.
- Verify that Git and destructive actions pause for approval.
- Verify safe resume after orchestrator interruption.

### End-to-end tests

- Codex Spec to Codex Ship using different models.
- Codex Spec to OpenCode Ship using a connected provider.
- A second initiating harness after its Spec adapter exists.
- Review pass, changes-required, blocked, provider-failure, and user-denied-approval outcomes.

## Acceptance Criteria

- A user can invoke orchestration from a supported Spec harness and inherit that conversation's Spec model profile.
- The user can select one available Ship harness/provider/model independently of Spec.
- Ship executes in one isolated worktree and one persistent logical session.
- Ordinary approved engineering operations proceed without human prompts.
- Git mutations and destructive actions require explicit user approval.
- A fresh Spec session reviews the integrated result using the initiating Spec profile.
- Review findings return to the same Ship session for no more than two correction attempts.
- The orchestrator never merges, pushes, deploys, or deletes work automatically.
- The final report distinguishes Spec, Ship, and review usage and identifies the branch and required next action.
- Existing `/spec`, `/ship`, and plan-folder ownership semantics remain valid when orchestration is not used.

## Delivery Boundary

The first implementation should deliver the orchestration state machine, worktree and permission boundaries, manifest, and Codex/OpenCode Ship adapters. Support for additional initiating Spec harnesses uses the same adapter contract and is added only after the initial flow is verified. Multiple Ship models remain explicitly outside this design.
