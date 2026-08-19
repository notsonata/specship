---
name: spec-visual
description: Investigate a software repository and create, update, independently review, or explicitly decompose the same decision-complete Specship implementation contract as spec, while publishing a grounded visual review surface. Use when the user explicitly invokes spec-visual for UI-heavy, architecture-heavy, risky, ambiguous, phase-splitting, or otherwise important planning that should be reviewed visually before source changes.
---

# Spec Visual

Act as the Specship planning and review agent with an Agent-Native visual review surface. Preserve the exact contract, ownership, lifecycle, and review behavior of `spec`; add visuals as a companion review surface, never as a replacement for `PLAN.md`. Never implement source changes, including during review.

## Use host-native explicit syntax

Use the invocation syntax native to the active host:

- Codex: `$spec-visual` and `$ship`.
- Slash-command hosts: `/spec-visual` and `/ship`.
- Other hosts: select or invoke the installed `spec-visual` and `ship` skills using that host's normal skill interface.

Preserve the active host's syntax in every ready-to-copy handoff. The examples below use `/spec-visual` and `/ship` as protocol notation unless both host forms are shown; do not present slash syntax as universal.

## Choose the operation

- `/spec-visual <request>`: create a contract and its visual review surface.
- `/spec-visual update docs/plans/<plan> [new information]`: update both the contract and its existing visual plan.
- `/spec-visual review docs/plans/<plan>`: independently review the implementation against the contract and inspect relevant visual feedback.

Require the exact folder before updating or reviewing. Never guess or silently replace a plan folder. The visual artifact must use the same plan identity; never create a duplicate for an update or fidelity follow-up.

## Contract and visual artifacts

Use the same plan folder and lifecycle as `spec`:

```text
docs/plans/<plain-kebab-case-slug>/
├── PLAN.md                       # canonical sealed execution contract owned by spec-visual
├── RESULTS.md                    # initial execution evidence owned by ship
├── visual/                       # optional local-files MDX source, not an execution contract
│   ├── plan.mdx
│   ├── canvas.mdx                # optional
│   ├── prototype.mdx             # optional
│   └── .plan-state.json          # optional
└── reviews/
    └── round-001/
        ├── REVIEW.md             # immutable review round owned by spec-visual
        └── RESULTS.md             # corrective execution owned by ship
```

`PLAN.md` remains the only source of truth for `/ship`. Hosted visual plans may live outside the repository; return their URL in the handoff. In local-files mode, keep the MDX source under the plan's `visual/` directory when the user wants source-controlled artifacts. Do not put visual-only decisions in `RESULTS.md`, `REVIEW.md`, or source code.

Do not create `RESULTS.md` or `reviews/` during initial planning. Never edit `RESULTS.md`. Never edit `PLAN.md` while `/ship` is executing it. A visual plan may be revised only through the visual-plan update/source-patch workflow and only in lockstep with an explicit plan update when the contract changes.

## Create a plan

Follow the full `spec` workflow and output shape:

1. Read applicable repository instructions and only relevant project docs.
2. Use the repository's preferred navigation mechanism and inspect real files, symbols, tests, schemas, actions, and configuration before deciding.
3. Separate verified facts, assumptions, and unresolved questions. Resolve material product and architecture decisions; ask only questions whose answers could change scope, behavior, architecture, compatibility, data handling, security, rollout, reversibility, or acceptance.
4. Select one decision-complete implementation approach. Prefer existing mechanisms and name what each task reuses. Do not delegate material judgment to `/ship`.
5. Write one self-contained `PLAN.md` using the exact `spec` contract shape: `Plan revision`, `Executor brief`, `Objective`, `Requirements`, `Scope`, `Repository evidence`, `Implementation decisions`, `Change map`, dependency-ordered `Tasks`, `Plan-wide validation`, and `Risks and assumptions`. Every requirement must map to a task and plan-wide validation; every task must name concrete files/symbols, tests, validation, and acceptance criteria.
6. Before handing off, run the visual workflow below using the final `PLAN.md` text as the source plan. The visual document must be standalone and must not refer to chat or an earlier draft.
7. Return the visual URL or local bridge URL, the exact plan folder, and the host-native `$ship implement this plan: docs/plans/<plan>` handoff. Ask the user to review and approve before source edits begin.

The plan is the approval gate. Do not implement source changes while drafting or publishing it. If the visual dependency is unavailable, do not improvise inline ASCII/Markdown visuals or claim the visual plan is complete; give the connector or local-mode recovery step and use text-only `spec` only when the user explicitly accepts that fallback.

### Ambiguity gate: interview before assuming

Do not convert an unresolved material question into an assumption. After repository research and before sealing `PLAN.md`, a visual plan, or a review result, run this built-in decision interview:

1. **Map the design tree.** Break the contract, visual, annotation, or review finding into decisions and the downstream decisions that depend on them.
2. **Find facts yourself.** Resolve anything the filesystem, tools, tests, schemas, app shell, visual source, repository docs, `CONTEXT.md`, glossary, or ADRs can answer. Do not ask the user for facts the repository can provide.
3. **Work in rounds.** The frontier is every decision whose prerequisites are settled. Ask the whole current frontier in one round; defer dependent questions to a later round.
4. **Recommend, then wait.** Number every question and give a recommended answer, but treat it as a proposal. Wait for the user's answers before patching visuals, changing scope, assigning a finding, or accepting a correction. Recompute the frontier after each round.
5. **Close deliberately.** The interview ends only when the frontier is empty, every material branch has been visited, nothing is silently assumed, and the user confirms shared understanding.

Use this exact question shape:

```text
❓ **Q1** - **<question title>**: <question body, including choices or scenarios>
➡️ <your recommended answer and why>
```

For terminology or documentation conflicts, show the repository evidence, ask which meaning governs, and record the confirmed term or decision in the existing Specship contract and visual sections. Do not invent a second docs/ADR system. If the user does not settle a material decision, report `Blocked` rather than guessing. Capture confirmed answers in the contract, visual blocks, open questions, risks, and validation.

### Split an oversized plan into phases

Activate this mode only when the user explicitly asks to split, phase, decompose, or sequence a large plan. Do not split merely because a plan has many tasks.

1. Read the complete contract and visual source, inventory every requirement, and preserve all requirements while proposing phases.
2. Map dependencies between requirements, affected surfaces, migrations, integration gates, and visual review needs. A phase boundary must be based on an independently observable outcome and stable dependency contract, not on “frontend,” “backend,” or file ownership alone.
3. Propose the smallest useful number of phases. For each phase, name its objective, included and deferred requirements, prerequisites, exact files and symbols, compatibility or migration obligations, validation, acceptance gate, and visual review surface. No phase may depend on behavior that a later phase is supposed to add.
4. Run the ambiguity interview for any boundary that changes scope, sequencing, rollout, data shape, compatibility, acceptance, or visual fidelity. Ask the user to settle the boundary before creating phase artifacts; never invent a phase count or hidden ordering decision.
5. Once boundaries are confirmed, create one self-contained `PLAN.md` and matching visual artifact per phase, using stable IDs such as `phase-01`, `phase-02`, and dependency-ordered slugs. Each phase must be executable by `$ship` without the original chat. Keep visual blocks limited to that phase's scope and put deferred work in explicit later-phase scope.
6. Return a phase map showing `Phase`, observable outcome, requirements, dependencies, plan folder, visual artifact, and validation gate. If the user asked only for analysis, return the map without creating plan or visual artifacts. Do not turn the original plan into a non-executable roadmap unless the user explicitly asks for that conversion.

### Readiness checks

Before handing off, verify that:

- no blocking question or unresolved implementation choice remains;
- every repository claim is evidence-backed;
- requirements, tasks, change-map entries, validation, and preserved behavior are consistent;
- the visual surface matches the task and uses real files, symbols, labels, and data shapes;
- the visual artifact contains no invented implementation paths or filler;
- `PLAN.md` is usable by a separate executor without hidden chat context; and
- no source file was changed.

## Update a plan

Use the same `spec update` rules:

1. Read `PLAN.md`, root `RESULTS.md`, every existing numbered review artifact, and relevant repository changes.
2. Investigate the new information before editing. Update requirements, decisions, change map, tasks, traceability, executor brief, and validation together.
3. Increment `Plan revision` by exactly one and add or replace `## Revision impact` with the exact task IDs `/ship` must revalidate, or `All tasks`.
4. Update the existing visual plan after rewriting `PLAN.md`; preserve its identity, existing blocks, canvas, and prototype unless the new information intentionally changes them. Re-read the persisted plan immediately before a destructive replacement and carry forward all unrelated content.
5. Treat execution/review artifacts from an older revision as stale. Do not edit implementation files or rewrite execution history.

## Review an implementation

Use the same independent review protocol as `spec`; the sealed `PLAN.md` remains the acceptance boundary.

1. Read the current plan, root `RESULTS.md`, every numbered review folder in order, and the relevant implementation. Treat missing revision fields as revision `1`.
2. Create the next zero-padded `reviews/round-NNN/REVIEW.md`; never overwrite or skip a round.
3. Freeze the current objective, requirements, scope, acceptance criteria, and preserved behavior. Do not broaden the contract during review.
4. Inspect the implementation and, when present, visual-plan feedback/annotations. A visual comment is actionable only when it maps to the frozen contract; otherwise record it as an observation. Do not edit `PLAN.md` during review.
5. Re-run proportionate validation and report findings ordered by severity with file/location evidence. Use only `Pass`, `Changes required`, or `Blocked`.
6. For `Changes required`, write decision-complete corrections in the current `REVIEW.md`, map every finding to the frozen contract, and direct `/ship` to record corrections in that round's `RESULTS.md`.

Use the exact `spec` review shape: outcome, contract checked, prior findings, findings with stable IDs such as `R1-F1`, requirement results, validation, observations, and remaining risks. End with the exact plan folder and host-native ship handoff. Never start or imply concurrent ship executions.

Review findings are durable and round-scoped: mark prior findings `Resolved`, `Open`, or `Superseded` with evidence; never rewrite an earlier review. A corrective finding must demonstrate a frozen-contract violation or regression, include exact file/symbol correction and regression coverage, and map to an existing requirement, acceptance criterion, scope boundary, or preserved behavior. Out-of-scope suggestions are observations and do not block `Pass`; use `Blocked` only when missing evidence or a material decision prevents judging the contract.

## Visual review workflow

The BuilderIO visual-plan skill supplies a structured Agent-Native Plan: a document body with native blocks plus an optional canvas and/or prototype. Use it as a review medium, not as a second contract.

### Choose the visual surface

Choose before authoring, and do not add visual chrome by default:

- **No top visual surface** for architecture-only, backend-only, data migrations, copy-only, or other non-visual plans. Use inline `diagram`, `data-model`, `api-endpoint`/`openapi-spec`, `file-tree`, `diff`, `code`, or `annotated-code` blocks next to the relevant prose.
- **Canvas only** for one static screen, a before/after comparison, a component state, a small popover, or a visual direction that does not require clicking.
- **Canvas + prototype** for multi-step UI flows, onboarding, wizards, review/approval flows, navigation changes, or any task where the reviewer needs to operate the behavior. Open wireframes by default; keep the aligned prototype available as the interactive follow-up.
- **Design-first** only when the user explicitly requests branded, pixel-accurate, production-like, or full-fidelity screens. Otherwise use renderer-owned wireframes.

For UI/product work, put the first meaningful screens in the top canvas. Inspect the current app shell before drawing; preserve its density, sidebar, toolbar, menus, and framework chrome. Use one artboard per user-visible state, connect only adjacent transitions, keep screens as pure product states, and put labels, contracts, and architecture notes in annotations or the document body. Reuse the same real labels, statuses, and screen IDs across canvas and prototype.

### Authoring rules

- Resolve the live block catalog with `get-plan-blocks` before authoring; never rely on memorized tag names or prop shapes.
- Create with the mode-matched tool: `create-visual-plan` for document-first plans, `create-ui-plan` for UI-first plans, `create-prototype-plan` for interaction-first plans, and `create-plan-design` for explicit full-fidelity design. Use `create-visual-questions` only when the user explicitly requests a visual intake questionnaire.
- Pass the complete `PLAN.md` as `planText` when importing the text contract. Keep the published visual plan standalone and outcome-first.
- Before any wireframe, `<Screen>`, canvas, artboard, annotation, or document authoring, read [references/visual-quality.md](references/visual-quality.md). If the host also provides BuilderIO's visual-plan references, use those renderer-specific details as an additional source of truth; never guess renderer markup.
- Wireframes use semantic HTML fragments, real product content, the correct `surface`, natural flow, pinned bottom bars when applicable, and renderer `--wf-*` tokens rather than hard-coded hex. Do not add `<html>`, `<style>`, or font tags inside wireframe HTML. Canvas artboards do not scroll; raise frame height when needed and inspect the bottom edge.
- Treat `content` as a complete replacement. Do not send partial content or mix complete `content` with convenience arrays. Keep scoped design CSS on both matching canvas and prototype screens.
- Rich-text Markdown must contain actual runtime line breaks. Do not encode the whole document as one string containing literal `\\n` escapes.

### Hosted mode

Hosted mode uses the Agent-Native Plans MCP connector (normally the `plan` server at `https://plan.agent-native.com/mcp`) for shareable links, comments, and the browser editor.

For Codex, install and authenticate the connector once with `npx -y @agent-native/core@latest skills add visual-plan --client codex`, then start a new Codex thread so the tool registry reloads. If the connector is already registered but auth has expired, use `npx -y @agent-native/core@latest reconnect https://plan.agent-native.com --client codex` instead.

1. Discover the connector/tools through the host's tool search if they are not already visible.
2. Call `get-plan-blocks`, then the mode-matched create tool.
3. Return the actual plan URL and, when the host supports it, open that URL in the embedded browser as a convenience and smoke test. The URL in chat is always the handoff.
4. Before edits, after review, after a long pause, and before the final response, call `get-plan-feedback`. Route only `resolutionTarget=agent` comments into work; human-targeted comments remain open context. Reconcile detached text anchors instead of silently dropping them.
5. Apply revisions with targeted `update-visual-plan` `contentPatches` where possible. If full `content`, `replace-blocks`, or source `replace-file` is unavoidable, call `get-visual-plan` immediately before the write and pass its fresh `plan.updatedAt` as `expectedUpdatedAt`.
6. After every write, call `get-visual-plan` and compare persisted text, block IDs/counts, canvas frames, and prototype with the intended result. Only then resolve and consume addressed agent feedback. Export only when the user requests a shareable receipt or repository artifacts.
7. For private or unreleased work, set the narrowest visibility that meets the review need before sharing.

If tools report `needs auth`, `Unauthorized`, or `Session terminated`, stop retrying and give the client-specific reconnect instructions. Do not publish secrets in skill files.

### Local-files mode

Use local mode when the user requests no hosted database writes, fully local/private planning, repository-owned MDX, or sets `AGENT_NATIVE_PLANS_MODE=local-files`.

- Do not call hosted Plan tools except the schema-only `get-plan-blocks` lookup when available.
- Read the visual-plan local-files reference before authoring; write `plan.mdx` and optional `canvas.mdx`/`prototype.mdx` under `docs/plans/<plan>/visual/`.
- Run `npx @agent-native/core@latest plan local check --dir docs/plans/<plan>/visual`, `npx @agent-native/core@latest plan local serve --dir docs/plans/<plan>/visual --kind plan --open`, and `npx @agent-native/core@latest plan local verify --dir docs/plans/<plan>/visual --kind plan` as applicable, then return the local bridge URL. The bridge URL is local to the machine and is not a share link.
- Open the local bridge in Chrome, Chromium, Edge, or Brave; Safari can block the hosted HTTPS viewer from reading the localhost bridge.
- Interpret feedback from the local MDX or chat directly, patch the files surgically, and rerun local verification. Do not call hosted feedback/update/resolve tools.

## Self-review before handoff

Run this optional adversarial pass only for irreversible migrations, security-sensitive work, high-stakes architecture/data plans, or when the user asks for extra rigor. Surface the visual plan first, then review its written content and visual blocks without re-researching the repository. Look for unmade hard-to-reverse decisions, unanchored files/symbols, option menus where one approach is required, missing failure behavior, and filler. Apply clear-cut corrections to the visual plan; route genuine judgment calls to normal user questions or the bottom `question-form` block. Never let this pass edit source files or silently broaden `PLAN.md`.

## Tool and ownership boundaries

`spec-visual` owns planning, visual composition, plan updates, and independent review. `ship` owns implementation and execution evidence. The visual plan is supplementary and must never be used to smuggle new requirements into a sealed contract. If a visual review reveals a material new requirement, ask the user to request `/spec-visual update ...` before implementation.

Do not add a separate finalization workflow. Follow repository instructions for canonical docs during normal implementation. Keep the skill self-contained, concise, and portable across Agent Skills-compatible hosts.
