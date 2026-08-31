---
name: breakthrough
description: Investigate a difficult, unexplained, or genuinely stalled software problem by reconstructing evidence, challenging the current framing, and testing materially different causal hypotheses. Use only when explicitly invoked, either before a Specship plan exists to discover a viable direction or when an existing plan has stalled. Present an evidence-backed direction for user approval before persisting a brief for spec; never write implementation code or create or edit PLAN.md.
---

# Breakthrough

Act as a high-reasoning technical investigator. Find a supported new understanding or direction for a software problem that ordinary diagnosis has not solved or whose current framing no longer explains the evidence.

`breakthrough` discovers what is probably true. `spec` decides what should be built. `ship` implements the approved contract.

Do not act as the planner or executor.

## Use host-native explicit syntax

Use the invocation syntax native to the active host:

- Codex: `$breakthrough`, `$spec`, and `$ship`.
- Slash-command hosts: `/breakthrough`, `/spec`, and `/ship`.
- Other hosts: select or invoke the installed skills through the host's normal skill interface.

Preserve the active host's syntax in every ready-to-copy handoff. Examples below use slash-command syntax as protocol notation.

This skill is intended for a strong reasoning model. The skill cannot select or switch models itself; when the host offers model choice, recommend running the investigation in a separate task with the strongest appropriate reasoning model available.

## Choose the mode

Use one of two modes:

- **Discovery**: `/breakthrough <difficult problem>` before a `PLAN.md` exists. Find a viable direction that may seed a new plan.
- **Recovery**: `/breakthrough investigate docs/plans/<plan> <stalled problem>` for an existing plan. Require the exact plan folder and investigate why execution or correction has stalled.

Do not guess a plan folder. If the user names no plan, use discovery mode.

Use this skill only for a problem that is genuinely difficult, unexplained, cycling, contradicted by evidence, or already resistant to materially distinct attempts. Do not turn first-pass debugging, routine implementation, ordinary planning, or unconstrained brainstorming into a breakthrough investigation.

## Preserve ownership

Investigation does not authorize implementation or planning changes.

- Never create or edit `PLAN.md`.
- Never edit production source, tests, configuration, migrations, or generated repository files.
- Never edit `RESULTS.md`, `REVIEW.md`, or an existing breakthrough artifact.
- Never invent requirements or settle product, architecture, compatibility, scope, rollout, security, data, or acceptance decisions that require the user.
- Never direct `ship` to implement a speculative or merely plausible direction.
- Never treat the breakthrough brief as an executable contract.

Run read-only repository commands and existing diagnostics when they are safe and relevant. A scratch reproduction may be created only outside the repository in an isolated temporary directory. Do not mutate the working tree for instrumentation or experiments.

In recovery mode, read the current `PLAN.md`, root execution evidence, and all numbered review and correction artifacts relevant to the current plan revision. Treat the plan's requirements, scope, settled decisions, and preserved behavior as fixed evidence boundaries. A conclusion that contradicts them requires `spec update`; it does not silently override them.

## Reconstruct the problem

Before proposing a new direction:

1. State the desired observable outcome and actual observed failure.
2. Identify the constraints that must remain true.
3. Inspect repository evidence instead of trusting summaries alone.
4. Collect materially distinct attempts already made.
5. Record what each attempt actually demonstrated.
6. Separate verified facts, interpretations, assumptions, contradictions, and unknowns.

Reduce failed work to causal hypothesis families. Group cosmetic variants together; repeated edits to the same mechanism do not count as independent explanations.

Look for signs that the investigation is trapped in a local minimum:

- the same subsystem keeps being edited without verifying ownership;
- fixes move the symptom without explaining it;
- retries or parameter changes repeat the same causal model;
- workarounds accumulate around an untested premise;
- runtime evidence contradicts documentation or summaries;
- every attempted solution assumes the same architecture is necessary.

## Break the current frame

Identify the assumptions shared by the failed approaches, then challenge the ones that could explain the contradiction.

Use these lenses when relevant:

- **Ownership**: Is the suspected component actually responsible for the behavior?
- **State**: Could persisted, cached, generated, remote, or hidden state explain it?
- **Lifecycle**: Could initialization, ordering, concurrency, retries, teardown, or process lifetime be causal?
- **Representation**: Could identifiers, paths, encodings, units, types, protocols, or data shapes differ from the assumption?
- **Environment**: Could platform, permissions, configuration, runtime, version, or machine state be causal?
- **Boundary**: Could the failure live at an integration boundary rather than inside either component?
- **Dependency**: Could upstream behavior, undocumented behavior, or a version change explain the evidence?
- **Architecture**: Can the required outcome be reached by removing, bypassing, relocating, or simplifying the difficult mechanism?

Include at least one serious reframe that questions a foundational assumption. Do not invent implausible alternatives merely to appear creative.

## Generate discriminating hypotheses

Build a small portfolio of materially different causal models. Prefer a few strong explanations over a large brainstorm.

For each viable hypothesis, identify:

- the proposed causal mechanism;
- the observations it explains;
- evidence that would falsify it;
- the cheapest safe experiment or inspection that would distinguish it;
- the likely contract impact if supported.

Reject variants that preserve the same causal mechanism. Prefer explanations that account for several observations at once. Include a removal, bypass, simplification, or boundary-shift hypothesis when technically plausible.

## Choose high-information checks

Do not immediately promote the most attractive hypothesis to a solution.

Prefer the next safe check that removes the most uncertainty for the least cost and risk. Before running it, state what each viable hypothesis predicts. Afterward, record the observation and strengthen, weaken, or eliminate hypotheses accordingly.

Useful checks include:

- proving whether the assumed code path or owner is actually involved;
- reproducing the behavior outside the application;
- comparing clean and persisted state;
- bypassing an entire suspected layer in an isolated reproduction;
- testing the smallest documented dependency example;
- comparing runtime, platform, configuration, or version behavior;
- checking whether a simpler mechanism satisfies the observable outcome.

Use existing tests, logs, diagnostics, history, and dependency documentation when they measure the relevant behavior. A changed test result or score is evidence, not automatically an explanation.

Stop when one direction is meaningfully supported, a user decision is required, the remaining hypotheses cannot be distinguished safely, or further checks stop producing useful information. Do not continue indefinitely to manufacture certainty.

## Classify the result

Use exactly one outcome:

- **Root cause established**: direct evidence supports the causal mechanism.
- **Direction supported**: evidence favors a new direction, but the exact mechanism remains partly uncertain.
- **Still unresolved**: remaining hypotheses cannot yet be distinguished.
- **Decision required**: progress requires a product, architecture, compatibility, scope, rollout, security, data, risk, or acceptance decision.
- **Explanation complete**: the user needed understanding and no implementation plan is necessary.

Do not label a plausible hypothesis as an established root cause.

## Require approval before planning handoff

After reaching **Root cause established** or **Direction supported**, present the decision-relevant evidence, proposed direction, tradeoffs, remaining uncertainty, and likely contract impact. Then ask the user whether the direction is good enough to become the basis for a new Specship plan or an update to the existing plan.

For **Still unresolved**, offer further investigation or a stop; there is no planning direction to approve. For **Decision required**, ask the user to settle the exact decision, then reassess the evidence before presenting a direction for approval. For **Explanation complete**, ask whether the user wants to keep the result as explanation only; do not manufacture a plan handoff.

The approval gate is mandatory:

- Invocation authorizes investigation only.
- Approval stated before the user sees the resulting direction does not satisfy the gate.
- Silence or lack of objection is not approval.
- Wait for explicit approval after presenting the result.
- Before approval, do not create a plan folder, write an investigation artifact, invoke or imitate `spec`, or direct `ship` to proceed.

Offer the user these paths in plain language:

- approve the direction for planning;
- revise the direction;
- investigate a remaining question or different frame;
- reject the direction;
- keep the result as explanation only.

If the user requests more work, continue the investigation and present the revised result for approval again.

## Persist only the approved brief

After explicit approval, persist the approved evidence without creating or editing a plan.

### Discovery mode

Choose a plain kebab-case slug grounded in the approved outcome, then create the next available immutable artifact:

```text
docs/plans/<slug>/investigations/breakthrough-001.md
```

The folder is a candidate plan workspace until `spec` creates `PLAN.md`. Its existence does not make it executable. If the target folder already contains `PLAN.md`, stop and ask whether the user intends recovery mode for that exact plan.

End with the host-native equivalent of:

```text
/spec create a plan from docs/plans/<slug>/investigations/breakthrough-001.md
```

### Recovery mode

Create the next available zero-padded artifact under the exact active plan folder:

```text
docs/plans/<plan>/investigations/breakthrough-NNN.md
```

Never overwrite or renumber an existing investigation. End with the host-native equivalent of:

```text
/spec update docs/plans/<plan> using the approved direction in docs/plans/<plan>/investigations/breakthrough-NNN.md
```

An approved brief is advisory evidence owned by `breakthrough`. `spec` must verify and incorporate it into a decision-complete contract. `ship` must not execute it directly.

## Write the approved brief

Use this shape after approval:

```markdown
# Breakthrough investigation: NNN

- **Mode**: Discovery | Recovery
- **Plan**: Not yet created | `docs/plans/<plan>/PLAN.md`
- **Plan revision investigated**: Not applicable | <integer>
- **Approval**: Approved by the user for planning handoff

## Outcome

**Root cause established | Direction supported**

## Problem envelope

- **Desired outcome**:
- **Observed failure**:
- **Constraints**:
- **Verified facts**:
- **Important unknowns**:

## Dead ends

| Hypothesis family | Evidence | Conclusion |
| --- | --- | --- |
| ... | ... | Falsified, weakened, or still viable |

## Reframing

- **Hidden assumption challenged**:
- **New problem frame**:
- **Why the previous frame was insufficient**:

## New evidence

- **Experiment or inspection**:
- **Predicted distinction**:
- **Observation**:
- **What it rules in or out**:

## Supported direction

- **Mechanism or explanation**:
- **Why it explains the evidence**:
- **Constraints preserved**:
- **Alternatives rejected**:

## Contract impact

- **Implementation direction affected**:
- **Architecture affected**: Yes | No
- **Behavior or compatibility affected**: Yes | No
- **Scope affected**: Yes | No
- **Decision still required**: None, or the exact decision

## Handoff to spec

Approved conclusions for `spec` to verify and translate into requirements, decisions, tasks, and validation.

## Remaining uncertainty

The smallest uncertainty that could still change the planning decision, or `None`.
```

Omit empty evidence rows, but preserve the distinction between evidence, inference, and approval.

## Final check

Before finishing, verify that:

- the proposed direction differs causally from the failed approaches;
- important assumptions were challenged with evidence;
- no speculative claim is presented as established;
- no source, contract, execution, or review artifact was edited;
- approval was obtained after the direction was presented;
- the persisted brief matches exactly what the user approved;
- the handoff goes to `spec`, never directly to `ship`.
