# Benchmark findings

## Django migration acceptance investigation — 2026-10-27

The accepted django-15252 development patch and follow-ups exposed four review failures:

- The supervisor turned the issue's suggested recorder guard into a required
  mechanism before investigation, then treated its own brief as authorization
  for changed behavior.
- Ship made an existing migration test pass by granting its router an additional
  recorder permission. Review accepted that altered setup instead of checking
  the original witness. With only the production patch applied, the original
  `test_migrate_fake_initial` passed on the baseline and failed on the candidate
  with `table "migrations_tribble" already exists`. The new guard hid existing
  migration history, causing migration execution to recreate the table.
- The reported empty-plan test used a denied guard and an existing recorder
  table. It did not exercise an allowed, fresh database through
  `MigrationExecutor.migrate([], plan=[])`. An independent source-derived probe
  reproduced table creation on that path. Subsequent review requested a fresh
  allowed database but accepted `record_applied()` evidence instead: creating a
  table for recording does not establish that an empty migration avoids it.
- After requiring the exact public call, review tested it but treated the
  baseline's unconditional table creation as the intended contract. That proves
  the side effect already existed, not that empty work needs it. The source
  comment describes the table's purpose as recording applied migrations; review
  must also trace the initiating caller's disabled-work options rather than
  promote the disputed implementation behavior into a compatibility requirement.

The negative controls are saved in `.specship/migration-review-audit/`. Only
production changes were applied, original test inputs were retained, and no
held-out test patch was used. A separate review replay of the exact old candidate,
original request, brief, and delivered report returned **REQUEST_CHANGES** and
independently reproduced the original-router regression. Its evidence is in
`.specship/migration-review-replay-26ff11b2/`; this is a review regression, not a
new task score.

The Spec and Ship skills now keep briefs outcome-based, prohibit using a
self-authored brief to authorize fixture permission or history changes, and
require resolving reproduced regressions under original inputs. Review witnesses
identify the entry point, operation input, initial resource state, permission,
and effect; a different creating helper cannot close an empty-operation gap.
The acceptance tool description reinforces these rules. The benchmark prompt
also permits focused verification for concrete evidence gaps instead of an
absolute prohibition on repeating Ship tests. These are review instructions;
the runner cannot prove the semantic truth of supplied evidence. Baseline
reproduction of the disputed side effect now requires an independent intended
contract or a decision, rather than acceptance based on baseline equality.

Development attempts remain separate and preserved under
`.specship/benchmark-review-counterexamples-2026-10-27/runs/`:

| Run | Review behavior | Held-out result |
|---|---|---|
| `2026-10-27T09-01-27-699Z-118237f7` | Requested a correction, then self-authorized changed router inputs; accepted | Failed |
| `2026-10-27T09-18-02-690Z-cb82057c` | Preserved original routers/history, but substituted recording evidence for the empty caller; accepted | Failed |
| `2026-10-27T09-29-00-140Z-478f2865` | Tested exact empty caller, but treated baseline table creation as required behavior; accepted | Failed |
| `2026-10-27T09-43-15-459Z-c3c80568` | Traced disabled-work caller and corrected concrete regressions in three rounds; accepted | **Resolved** |

The third attempt also caught and corrected a real hinted-operation recording
regression. Its original-router witness passes with production changes only, but
the independent allowed/fresh/empty witness still fails; both observations are
saved in `.specship/migration-review-same-entrypoint-audit/`. Catching that separate
regression does not erase the false acceptance.

The final caller-intent development run,
`2026-10-27T09-43-15-459Z-c3c80568`, **resolved under the held-out evaluator** and
accepted after three correction rounds, with zero false acceptances or grading
errors in this one-case run.
Review explicitly required the actual `create_test_db(TEST.MIGRATE=False)` path,
including supported syncdb behavior, and preserved a supplied state on the empty
executor path. It also reproduced and corrected missing historical model hints,
field/model-name confusion, and inconsistent history for a denied dependency
followed by permitted work. Original fixture permissions and assertions stayed
unchanged. Ship's final relevant suite ran 655 tests successfully with one skip;
new isolated regressions use SQLite.

An independent production-only audit in `.specship/migration-review-fixed-audit/`
passed both the original-router witness and the allowed/fresh/empty executor
probe, retaining original tests and using no held-out test patch. Its baseline
control also passed. Trial execution took 1,410.002 seconds and recorded $0.385964
in API-equivalent usage under the frozen comparison tariff; this includes all
three correction rounds and is not an actual billing claim.

Repository validation after these changes: typecheck and build passed; the full
suite run serially passed **176 tests with one platform skip**; both skills passed
their validator. The serial run avoids a concurrent-load timing failure observed
in the unchanged compatibility ping fixture; that fixture also passed separately.

The historical ten-case comparison below is unchanged. These cases are already
known development regressions and cannot establish unseen-task accuracy.

## Acceptance repairs and fresh Verified sample — 2026-10-27

**Structured reporting no longer blocked completion, but semantic false acceptance
remains.** On ten fresh cases, direct supervision resolved 9/10 and Specship 8/10.
Both accepted every patch, producing one and two false acceptances respectively.
The measured images include the first review/evidence repairs. Counterexample and
fixture-isolation review rules were refined after this result and validated only
on separate development regressions, reported below; those are not fresh scores.

Run `2026-10-27T06-28-33-012Z-41c76347` is saved under
`.specship/benchmark-verified-2026-10-27/runs/`, with full evidence in `summary.json`,
the manifest, per-trial exports, and evaluator reports. The controller exited 0:
20/20 trials recorded and graded, no grading errors, no infrastructure or workflow
failures. It ran 14:28–16:07 Asia/Taipei on October 27, including builds and grading.

The new pool is [SWE-bench Verified](https://www.swebench.com/verified), a
human-validated set of 500 tasks. Ten cases were selected with seed
`specship-verified-v1-2026-10-27`, excluding all five previous case IDs before
selection. Dataset revision: `78f471bf655a3137b2e8a75af1501690ec009ec3`.
Frozen case hash: `c567dbc28508bd59015c6c149ee994ed45d5e2ecbeee6b9d1918c913b9d4c956`.
No cases were replaced after freezing, and no scored model trials were retried.
Both arms used Codex `gpt-6.1-sol` / high and OpenCode
`deepseek/deepseek-flash` / high, alternating order, one repetition, and the same
1,800-second trial limit and evaluator.

| Metric | Direct Codex → OpenCode | Specship |
|---|---:|---:|
| Resolved by held-out evaluator | **9/10** | **8/10** |
| Supervisor accepted | 10/10 | 10/10 |
| False acceptances | 1 | 2 |
| Infrastructure / workflow failures | 0 / 0 | 0 / 0 |
| Sum of trial seconds | 2,133.483 | 2,652.342 |
| Codex input tokens, including cached | 6,879,033 | 1,248,341 |
| Codex output tokens | 33,354 | 14,084 |
| Codex API-equivalent estimate | $1.9571 | $0.7138 |
| Full API-equivalent estimate | Unknown; recorded subtotal $2.1588 | $0.9242 |

Specship used about 82% fewer supervisor input tokens and 64% less estimated
supervisor cost, while recorded trial time was about 24% longer. Direct worker
usage is incomplete for Requests and scikit-learn-10297, so its full cost remains
null; the subtotal includes known supervisor and observed worker usage. Specship
worker usage is complete. Prices use the same frozen Sol Standard and DeepSeek
Flash off-peak comparison tariff for both arms, not inferred live billing. Actual
bills, service-tier/long-context premiums, and subscription-limit usage are unknown.

| Case | Direct supervision | Specship |
|---|---|---|
| psf__requests-2931 | Resolved | Resolved |
| django__django-14999 | Resolved | Resolved |
| scikit-learn__scikit-learn-25931 | Resolved | Resolved |
| scikit-learn__scikit-learn-10297 | Resolved | Resolved |
| django__django-15252 | Failed, accepted | Failed, accepted |
| sphinx-doc__sphinx-10449 | Resolved | Failed, accepted |
| scikit-learn__scikit-learn-14894 | Resolved | Resolved |
| pytest-dev__pytest-5262 | Resolved | Resolved |
| pytest-dev__pytest-7324 | Resolved | Resolved |
| django__django-14787 | Resolved | Resolved |

For django-15252, both workflows missed migration-schema/no-migration behavior.
The evaluator reports an unexpected `ensure_schema()` call under the disabled
migration setting and failure of the no-migrations path; existing pass-to-pass
tests did not regress. This is a remaining semantic review gap.

For Sphinx, Specship passed the new held-out bug test but failed three existing
autodoc output tests. Its patch added a `Square` class to a shared fixture and
updated expected output lists in the test file. Evaluation resets that test file
before applying held-out tests, leaving the extra fixture class without those
paired expectation changes. Failures show the extra `Square` output. This is a
test-fixture/evaluation interaction, but it remains a failed result and false
acceptance in the published counts; it was not rescored or repaired.

### What changed and what was verified

- Ready reports are now checked for complete, nonblank, unique, known criterion
  IDs **before** persistence. Rejected reports can be repaired in the same session;
  final acceptance retains the same coverage guard. Prose cannot stand in for
  required structured results. The native DeepSeek callback schema now exposes
  `acceptance_results`, matching the MCP transport.
- Spec and Ship now trace behavioral assumptions to unchanged source or the
  request, check repository API/test-seam compatibility, and request corrections
  for unsupported assumptions. These changes address the previous overly narrow
  diff/test-summary review; they do not guarantee semantic correctness.
- Eight Specship trials encountered recoverable report-schema errors because
  they omitted redundant legacy `acceptance_evidence` prose despite supplying
  structured results. All recovered and completed acceptance. **After model
  execution**, that legacy array was made optional with an empty default, verified
  through the real MCP callback and full tests. Recorded timings, tokens, and
  costs include the original retries and were not adjusted. The final normalization
  change has unit/integration validation, not a separately rerun quality benchmark.
- Fresh samples support recorded exclusions. Prepared task images are restored
  to the frozen source commit when necessary; Sphinx required restoration of its
  prepared `tox.ini` edit. Both arms received the same source. Registry DNS failures
  were handled with model-free image preparation and an exact cached evaluator
  image, `sha256:ad4814e3e92bc36327104dbc8030c2352d30b0839fa0001f9818dc06ca93bcec`,
  whose SWE-bench 5.0.2 version was verified. Incomplete grading now exits nonzero
  and preserves diagnostics instead of silently reporting completion.
- Validation: typecheck and build passed; full suite **176 passed, 1 platform
  skip**. Both edited skills passed the skill validator. Missing/blank/duplicate/
  unknown evidence, structured-only reports, native callbacks, same-session repair,
  and disposable source restoration have regression coverage.

### Targeted follow-up after the scored comparison

The two fresh-set failures were then used explicitly as development regressions,
without changing the ten-case comparison. Review now asks for an independently
derived disconfirming case, traces denied/empty/no-op paths when side effects are
forbidden, and keeps new regression data isolated from unrelated shared-fixture
outputs. These are general workflow instructions, not task-specific fixes or
held-out test details supplied to Ship.

Run `2026-10-27T08-14-13-944Z-27424e8a` in
`.specship/benchmark-review-counterexamples-2026-10-27/runs/` completed and graded
both development cases with the final reporting normalization and review rules:

| Development case | Held-out result | Acceptance |
|---|---|---|
| sphinx-doc__sphinx-10449 | **Resolved** | Accepted |
| django__django-15252 | **Failed** | Accepted |

The Sphinx follow-up used scoped regression data and passed the evaluator. The
migration follow-up again reported broad passing tests but failed held-out grading.
Both workflow completions were valid, no infrastructure/grading errors occurred,
and complete API-equivalent usage totaled $0.2720. These results demonstrate the
fixture repair and the remaining semantic review gap; they are not substituted
into the original 8/10 score and do not establish final-version unseen accuracy.

Two separate development attempts on old django-11848 are retained in
`.specship/benchmark-review-regression-2026-10-27/runs/`
(`2026-10-27T05-50-17-924Z-94b5cb63` and `2026-10-27T06-02-25-803Z-f6ccbb26`).
Both used UTC and complete structured reports but remained **failed, accepted**
under the official evaluator, whose clock mocks configure `utcnow()` while the
patches use `now(timezone.utc)`. A separate API-neutral New Year contract check
returned the expected 2075/1976 years; a local-clock counterfactual returned
1975/1976 and was rejected. That check confirms the original timezone defect is
addressed but does not replace either failed benchmark grade. Its script and
numeric evidence are saved in the same development home.

The reporting lifecycle failure is fixed. Semantic false acceptance is **not
solved**, and this experiment does not support claiming otherwise. Ten cases and
one repetition do not establish a general ranking or a causal quality improvement
over the different earlier sample. Public-task contamination/network caveats still
apply, and recovery/interruption behavior was not measured.

## Direct OpenCode supervision — 2026-10-27

**This pilot favors direct supervision for correctness and Specship for supervisor
usage. It does not establish a general ranking.**

Run `2026-10-26T20-21-11-340Z-d7917df3` is saved under
`.specship/benchmark-direct-2026-10-27/runs/`. Its `summary.json` contains all ten
graded results; the manifest freezes configuration, ordering, revision, and dirty
working-tree status. The controller exited 0 after grading, with no grading errors
or infrastructure failures. It ran from 20:21 to 21:14 UTC on October 26 (October 27
in Asia/Taipei), including builds and evaluation.

The comparison uses the same five previously frozen SWE-bench Lite cases, one
repetition, Codex `gpt-6.1-sol` / high, OpenCode `deepseek/deepseek-flash` / high,
and a 1,800-second trial limit. Both arms run fresh against the current working-tree
snapshot, including the pre-existing compact-review changes; earlier benchmark
results are not substituted. Toolchain versions match the earlier run below.

The new `codex-opencode` arm tells Codex to launch OpenCode through the shell,
continue the native session for corrections, review the diff and test evidence,
and finish with an explicit acceptance/blocker verdict. It supplies the exact CLI
invocation and comparable lean-supervision instructions. There is no Specship MCP
registration or installed project skill in this arm. Model-free catalog/profile
preflight, case isolation, permissions, and grading remain benchmark infrastructure
shared with the Specship arm. Arm order alternates across cases. Durable OpenCode
usage verifies delegation and the configured worker model.

| Metric | Direct Codex → OpenCode | Specship |
|---|---:|---:|
| Resolved by held-out evaluator | **5/5** | **4/5** |
| Supervisor accepted | 5/5 | 4/5 |
| Both accepted and resolved | 5/5 | 3/5 |
| False acceptances | 0 | 1 |
| Agent/workflow failures | 0 | 1 |
| Sum of trial seconds | 1,268.948 | 1,235.370 |
| Codex input tokens (including cached) | 6,104,454 | 460,732 |
| Codex output tokens | 23,482 | 5,135 |
| Codex API-equivalent estimate | $1.3682 | $0.2021 |
| Full API-equivalent estimate | Unknown; recorded subtotal $1.5083 | $0.3123 |

Specship used about 92% fewer supervisor input tokens and 85% less estimated
supervisor cost. Summed trial time differed by only 34 seconds. Direct supervision's
pytest trial interrupted an initial worker session; incomplete durable message
accounting leaves its full worker usage and total cost null. The $1.5083 figure is
a subtotal from known supervisor and observed worker usage at frozen rates, not a
complete total or invoice. Specship worker usage is complete. Published Sol Standard
and direct DeepSeek Flash off-peak tariffs were checked on October 27; all trials
finished within the off-peak window. Actual bills and subscription-limit consumption
remain unknown.

| Case | Direct supervision | Specship |
|---|---|---|
| pydata__xarray-5131 | Resolved, accepted | Resolved, accepted |
| pytest-dev__pytest-11148 | Resolved, accepted | Resolved, accepted |
| django__django-11848 | Resolved, accepted | Failed, accepted |
| matplotlib__matplotlib-25311 | Resolved, accepted | Resolved, accepted |
| django__django-15902 | Resolved, accepted | Resolved, acceptance blocked |

Two failures matter. For django-11848, Specship again accepted `datetime.now()`
where the HTTP-date calculation requires UTC; direct supervision used `utcnow()`.
The evaluator confirms the same false-acceptance defect discussed below. For
django-15902, Specship produced a passing patch but its report lacked structured
evidence for `management-warning`, `rendering-compatibility`, and `validation`.
Textual evidence was present, but `specship_accept` returned nonretryable
`ACCEPTANCE_EVIDENCE_INCOMPLETE`; the supervisor stopped with the run awaiting review.
This is an unfinished workflow, separately from patch correctness. These trial
artifacts were not repaired or rerun to improve the scores.

The measured benefit is lower supervisor usage, not better correctness or a clear
speed improvement. Five cases and one repetition leave substantial uncertainty;
public tasks with network access retain the contamination caveats below. This
experiment does not test restart recovery, conflicting writers, or interruption
guarantees. The reusable comparison is configured with
`arms: ["codex-opencode", "specship"]`.

## Earlier lean-orchestration run — 2026-10-26

Fresh lean-orchestration run of the frozen SWE-bench Lite sample, compared with the
2026-10-25 baseline. This records what was measured, what the numbers mean, the defect
that produced the one wrong answer, and the decisions taken as a result.

## What ran

| | |
|---|---|
| Fresh run | `2026-10-25T18-15-42-921Z-79b43c42` in `.specship/benchmark-lean-2026-10-26` |
| Baseline | `2026-10-25T12-04-49-319Z-0834d02b` in `.specship/benchmark-default-high-2026-10-25` |
| Revision | `b83eec7`, branch `checkpoint/benchmark-arm-fixes`, clean checkout |
| Cases | 5 frozen SWE-bench Lite instances, one repetition, three arms, 15 attempts |
| Timeout | 1800 s per attempt |
| Spec | Codex `gpt-6.1-sol`, high effort |
| Ship | OpenCode `deepseek/deepseek-flash`, high effort |
| Toolchain | Node 24.22.1, Codex 0.162.0-alpha.17.2, OpenCode 1.18.30, SWE-bench 5.0.2 |
| Wall time | 52.4 minutes including builds and grading; controller exit 0 |

Dataset hash `fe999130…c17d0`; observed revision `b0dde109…dff5`. Config and case lock
byte-identical to the baseline.

## Results

| Arm | Baseline resolved/graded | Fresh resolved/graded | Fresh accepted | False acceptances | Cost (baseline → fresh) | Trial seconds |
|---|---:|---:|---:|---:|---:|---:|
| codex | 5/5 | 5/5 | n/a | n/a | $0.455 → $0.550 | 480 → 408 |
| ship | 4/5 | 4/5 | n/a | n/a | $0.060 → $0.090 | 534 → 732 |
| specship | 3/4 | 4/5 | 0 → 5 | 1 | unknown → $0.340 | 1,287 → 1,096 |

Cost per resolved issue: **codex $0.110**, **specship $0.085**, **ship $0.023**.

Reliability changed completely: 15/15 attempts recorded and graded, zero infrastructure
failures, zero agent failures, no containers left behind. The baseline lost two Specship
attempts to infrastructure and accepted none.

## Per-case detail

| Case | codex | ship | specship |
|---|---|---|---|
| pydata__xarray-5131 | resolved, $0.042, 29 s | resolved, $0.001, 23 s | resolved, accepted, $0.050, 91 s |
| pytest-dev__pytest-11148 | resolved, $0.145, 79 s | **failed**, $0.055, 394 s | **resolved**, accepted, $0.087, 441 s |
| django__django-11848 | resolved, $0.076, 87 s | resolved, $0.006, 60 s | **failed**, accepted, $0.054, 162 s |
| matplotlib__matplotlib-25311 | resolved, $0.199, 148 s | resolved, $0.015, 144 s | resolved, accepted, $0.077, 260 s |
| django__django-15902 | resolved, $0.088, 64 s | resolved, $0.014, 110 s | resolved, accepted, $0.073, 142 s |

Specship and Ship tie at 4/5 on different cases. The supervisor rescued pytest (where the
bare cheap model failed) and rubber-stamped django-11848 (where the bare cheap model
succeeded in 60 s for $0.006). Net quality: zero. Net cost: +$0.25.

## The false acceptance

Accepted patch:

```python
current_year = datetime.datetime.now().year          # local clock
year += current_year - current_year % 100
if year > current_year + 50:
    year -= 100
```

Patch that resolved the same case in the same run (bare Ship, $0.006):

```python
current_year = datetime.datetime.utcnow().year       # UTC clock
year += 100 * (current_year // 100)
if year - current_year > 50:
    year -= 100
```

The held-out tests replace `django.utils.http.datetime.datetime` with a mock that configures
only `.utcnow`; with the local clock the arithmetic runs on mock objects and both
`test_parsing_rfc850` and `test_parsing_year_less_than_70` fail. This is also a real defect,
not only a test artifact: the header value is GMT, so deriving the year from local time is
wrong near New Year in any non-UTC zone. Django's upstream review flagged exactly this
("non-UTC today"), but that text lives in `hints_text`, which the harness does not send.

Spec's acceptance evidence cites "Ship reports all 46 HTTP tests passing". Those 46 include
Ship's own regression test, which mocks `now()` — the implementation's own API choice. The
test and the implementation agree with each other, so the suite cannot detect a wrong clock.

**Generalizable rule:** Ship's tests are not independent evidence when they mock the
implementation's own API choice. A reviewer must check the diff against repository
conventions, not against tests written alongside it.

## Token and cost anatomy

Per specship attempt (fresh run):

| | tokens | cached | cost |
|---|---:|---:|---:|
| Spec | 91k–114k input, 0.7k–1.1k output | ~85% | ~$0.049 |
| Ship | 282k–3.4 M input, 12k–38k output | ~97% | ~$0.019 |

Specship totals: Spec input 487,040 (406,144 cached), Spec output 4,207, Ship input
6,290,806 (6,119,424 cached), Ship output 85,631 (53,576 reasoning).

Spec performs **one model turn per run** and consumes **~7% of the tokens but ~72% of the
cost** ($0.244 of $0.340), because Sol input costs $2/M and output $10/M against flash's
$0.15/M and $0.6/M. The token count is already small and mostly cached; the dominant
variable is the supervisor's price per token, not its volume.

Lean-orchestration change versus baseline: Spec input −57.8%, Spec output −73.0%, Spec cost
−54.6%, coordinator commands 42 → 10, commands before dispatch 20 → 5.

## Architecture, as measured

```
Codex chat (Spec)
  └─ specship MCP server        child of the chat; owns Runner, Store, writer locks
       └─ OpenCode server       child of the runner; owns Ship's session
Ship ──report_result──▶ callback hub (HTTP) ──▶ Runner ──▶ event returned to Spec
Spec ──accept/correct──▶ Runner ──▶ run state completed | awaiting_review
```

Spec plans and reviews; the runner owns persistence, locks, deadlines, checks and delivery;
Ship does the work. The supervisor's turn blocks for the duration of Ship's work
(`specship_dispatch`), which is the cheapest and most reliable handoff available.

## Decisions

- **Keep the blocking wait.** It costs nothing while waiting, has no handoff latency, and
  depends only on Codex's MCP support. An idle-chat interrupt would add a model turn per
  handoff and depend on undocumented desktop internals.
- **Reject in-chat injection.** Verified limits: a loaded thread holds
  `~/.codex/thread-writer-locks/<thread>.lock`, so a second app-server is refused with
  "already has an active writer"; the desktop app's app-server exposes no control socket and
  refuses to start a managed daemon from outside (`Access is denied`). A message *can* wake a
  chat that is unloaded — demonstrated end to end: injected turn → `specship_wait
  {recover:true}` → lease reclaimed (`recovered:true`) → `implementation_ready` returned —
  but that is a closed-chat handoff, not an in-chat interrupt.
- **Keep Ship blocked-work supervision; document the wait instead.** The Spec skill now posts
  one line naming the task before dispatching, and the tool description states the expected
  wait, so the chat is legible while the call is open.
- **Do not add per-case mechanical checks.** A check like "`django.utils.http` must not call
  `datetime.now()`" is benchmark trivia, not a product rule. The portable fix is a review rule
  about evidence independence.

## Fixes landed this cycle

| Commit | Change |
|---|---|
| `247245b` | Ship profile permission policy (unattended path prompts), acceptance persists before server cleanup, dispatch cap, exit-code runbook note, tests |
| `b08b250` | Private-storage hardening no longer rewrites an already-correct owner (`WRITE_OWNER` is absent on a tightened file) |
| `67967d1` | Hardening runs once via a marker instead of re-ACLing ~24k paths per launch (75 s → 0.3 s startup) |
| `348c5e2` | Dispatch reclaims writer state whose owner process has exited (dead PID only; live owners still fail closed) |
| `b83eec7` | Spec states what Ship is doing before a blocking dispatch; tool description sets the wait expectation |

`npm run check`: 165 passed, 1 platform skip.

## Open questions

1. **Sample size.** Five cases, one repetition. 4/5 versus 5/5 is one case; the arm ranking is
   not established. The next measurement should be 25 cases (75 attempts, roughly 4–5 hours,
   $5–6).
2. **Cheaper supervisor.** The catalog offers `gpt-6-luna`, `gpt-5.6-luna` and
   `chatgpt-web/medium`. A weaker Spec with a tighter protocol is the highest-leverage cost
   experiment: if quality holds, specship moves from $0.34 toward $0.15–0.20.
3. **Instruction shape.** The Spec skill is ~44 lines of behavioural rules written to police a
   strong model. A four-step protocol with three hard rules — including "a new test that mocks
   the implementation's own choice is not evidence" — is the form a weaker model can follow.
4. **Report payload.** Spec currently receives the full report and evidence. Sending a compact
   summary plus criteria evidence would shrink the uncached input that dominates its cost.

## Threats to validity

- Public SWE-bench tasks with network access: contamination and network-assisted solving are
  possible; these are workflow comparisons, not clean-room or leaderboard results.
- Costs are API-equivalent estimates at frozen published rates, not invoices. Actual billing
  is unknown; subscription usage is not visible.
- `hints_text` is not passed to the agent; the failing case's upstream discussion of the UTC
  issue was therefore unavailable.
- The baseline ran against uncommitted source; the fresh run is a clean checkout. Behavioural
  differences between them are therefore a combination of code changes and harness fixes.
