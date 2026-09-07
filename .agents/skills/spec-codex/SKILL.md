---
name: spec-codex
description: Use when the user explicitly invokes $spec-codex to create, update, split, or review a Specship contract while delegating bounded repository evidence gathering to Codex subagents.
---

# Spec Codex

Create and review Specship contracts while keeping repository grunt work out of
the parent context. The active parent remains the specification authority.

**Never implement application changes.** Neither the parent nor any worker may
edit source code, author fixes, or perform `$ship` work. `$ship` is the only
implementation entry point.

## Apply the canonical protocol

**REQUIRED BASE SKILL:** Read and follow the installed `spec` skill in full. It
is the canonical protocol for artifacts, planning, updates, ambiguity,
decomposition, revisions, reviews, and handoffs. This skill adds delegation
only. If `spec` is unavailable, return `Blocked` with instructions to install
both skills; never reconstruct or copy the missing protocol.

Plans and reviews created here are ordinary Specship artifacts. Never add
worker transcripts, metrics, state, or Codex-only requirements to them.

## Require explicit workers

Use only `specship_scout` for `explore`, `impact`, and `review`, and
`specship_validator` for `validate`. If either type needed for the operation is
unavailable, do not substitute a general worker. Check whether both definitions
already exist as personal agents under `~/.codex/agents/` or as project agents
under `.codex/agents/`. If they exist, return `Blocked` and tell the user to
fully restart Codex and start a new task; do not recommend reinstalling them.

If they are absent, return `Blocked` and recommend a one-time personal install:
run the bundled `scripts/install_agents.py --scope user` from this installed
skill directory. Give the path syntax for the user's shell (`~/.agents/skills/`
on POSIX or `%USERPROFILE%\.agents\skills\` in Windows Command Prompt). Mention
project scope only when the user explicitly wants repository-local agents.

The TOML files pin the worker model and role-appropriate sandbox but deliberately
leave reasoning effort unset so each dispatch can select it. Spawn every normal
worker with its named `agent_type`, `fork_turns: none`, and
`reasoning_effort: high`. Use `reasoning_effort: xhigh` only for a focused retry
when material evidence remains incomplete or contradictory. Never use a full-
history fork or omit the reasoning effort.

Before the first dispatch, read
[references/delegation.md](references/delegation.md). It defines the activation
header, lane contract, task packet, compact result schema, and mutation checks.

## Preserve parent authority

The parent interprets the request, chooses evidence lanes, resolves ambiguity
with the user, and makes every product, architecture, naming, scope,
compatibility, implementation-strategy, acceptance, and phase decision.

Only the parent writes `PLAN.md`.

Only the parent writes the canonical `REVIEW.md`.

Only the parent decides requirements, tasks, findings, severity, corrective
scope, and the overall `Pass`, `Changes required`, or `Blocked` outcome.

Worker outputs are evidence, not decisions. Every worker must not spawn another agent.
The parent alone owns orchestration.

Avoid broad parent-side reconnaissance when a bounded worker can gather the
evidence. Inspect directly only to resolve conflicting reports, verify uncertain
decision-critical evidence, or close a material gap that focused redispatch
could not establish.

## Delegate proportionately

Delegate bounded repository evidence whenever the operation needs it. A small
request may need one scout. Run independent lanes concurrently without
duplicating work, and use fresh scout instances for independent review lanes.
Do not spawn every lane ceremonially.

Never delegate product decisions, architecture selection, ambiguity resolution,
requirements, acceptance changes, phase boundaries, finding classification, or
final review judgment. Give each worker only the context needed for one bounded
objective, never the entire planning conversation.

Preserve successful evidence when another lane is `Incomplete` or `Failed`.
Narrow, split, retry, use a focused `xhigh` escalation, inspect the exact dispute,
continue when immaterial, or return `Blocked` according to impact. Never resolve
conflicting reports by majority vote.

Discard a worker's attempted decision, implementation, canonical artifact,
recursive delegation, or result based on durable repository mutation and treat
that lane as failed.

## Apply to every `spec` operation

- **Create or breakthrough handoff:** workers gather repository, impact, and
  validation evidence; the parent runs the complete ambiguity gate, selects one
  approach, and writes the plan.
- **Update:** workers investigate only the new information's repository impact;
  the parent revises the canonical contract and revision impact.
- **Decompose:** workers gather dependency, boundary, migration, and validation
  evidence; the parent proposes, confirms, and writes every phase.
- **Review:** workers check bounded requirements, changed surfaces, integrations,
  regressions, prior findings, or commands; the parent adjudicates evidence and
  writes the next immutable round.
- **Re-review:** reconcile prior findings first and delegate only corrections,
  named integration boundaries, and plausible corrective regressions. Never
  repeat the original broad evidence set automatically.

## Completion check

Before writing or reporting a plan or review, confirm that the complete `spec`
protocol was applied, repository claims have cited evidence, material conflicts
are closed or blocked, workers made no decisions or durable changes, nobody
implemented application code, canonical artifacts remain worker-agnostic, and
the final handoff uses the host syntax required by `spec`.
