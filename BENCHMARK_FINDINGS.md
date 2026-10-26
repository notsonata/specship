# Benchmark findings — 2026-10-26

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
