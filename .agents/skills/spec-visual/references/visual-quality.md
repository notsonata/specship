# Visual plan quality bar

Read this reference before authoring or editing any wireframe, canvas, prototype, or structured visual-plan document.

## Document

- Make the document standalone, outcome-first, and prose-first. A reader who never saw the chat should understand the goal, selected approach, repository evidence, scope, risks, and approval decision.
- Put a native block beside the prose it explains: `diagram` for relationships, `file-tree` for affected files, `api-endpoint`/`openapi-spec` for contracts, `data-model`/`json-explorer` for data shape, `diff`/`annotated-code` for code changes, and `question-form` once at the bottom for unresolved decisions.
- Use visuals to make a decision easier to inspect, not to decorate the plan. Do not repeat the same information in several blocks or pad a one-step plan.

## Wireframes and prototypes

- Use semantic HTML fragments inside `<Screen surface="..." html={...} />`; never add `<html>`, `<head>`, `<style>`, font tags, or legacy kit-tree children such as `<FrameScreen>`, `<Card>`, `<Row>`, or `<Btn>`.
- Inspect the existing app shell before drawing. Keep real chrome, density, labels, statuses, content, loading/error/empty states, and interaction affordances. Do not replace a product state with an architecture diagram.
- Use the correct renderer `surface` preset, renderer `--wf-*` tokens instead of hard-coded colors, full-width chrome, and pinned bottom bars when those exist in the real app. Keep content inside natural flow.
- Make prototypes the same flow as the canvas: reuse screen IDs, labels, statuses, and transitions. A prototype is an operable version of the static reference, not a second design direction.

## Canvas

- Treat the canvas as the static source of truth. Use one artboard per user-visible state, including meaningful popovers, sheets, loading, and error states. Connect only adjacent transitions.
- Keep product UI and explanatory/meta diagrams separate. Put short designer notes in plain-text annotations anchored to a stable `targetId` and `placement`; keep contracts, tradeoffs, file maps, and verification in the document body.
- Canvas frames do not scroll. Preserve the surface width and increase frame height when the screen needs more vertical space. Inspect the bottom edge at default zoom before handoff.
- Apply canvas edits surgically. For hosted plans, use targeted `contentPatches`; for local plans, use stable MDX block/artboard/annotation IDs. Never replace the full document from a stale read.

## Integrity checks

- Call `get-plan-blocks` before authoring so tag names, required fields, and prop shapes come from the live registry.
- `content` is a complete replacement; do not combine it with convenience arrays or send a partial object. Preserve every unrelated block and visual surface during replacement.
- After every write, re-read the persisted plan and inspect the rendered surface. A successful JSON response does not prove that Markdown, CSS, canvas frames, or prototypes rendered correctly.
- For a destructive hosted write, obtain a fresh `plan.updatedAt` from `get-visual-plan` and pass it as `expectedUpdatedAt`.
- Keep rich-text values as real Markdown with runtime line breaks; literal `\\n` text must not turn the whole document into one heading.
