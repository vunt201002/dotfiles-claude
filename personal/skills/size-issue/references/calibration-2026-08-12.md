# Calibration run — 2026-08-12

`manager-layer-plan-2026-08-12.md` §2.2 requires the router's rubric to be
checked against real finished issues **before** anything is built on it, with a
gate: *more than 3 in 10 wrong means the rubric is broken, and the rubric changes,
never the data.*

**Result: 6 of 15 wrong on the first pass. The rubric was broken.** Three
distinct defects were found and fixed; re-scored, the same fifteen cases land at
2 of 15, and both survivors are written up below rather than argued away.

---

## 1. Source and method

**Source:** `D:\Project\j\eivno` — the project shipping as *Kivora*, and the
first one the manager layer is meant to drive. Two trackers, both maintained and
both unusually honest about their own mistakes:

- `docs/LAUNCH-PLAN.md` — 23 closed and 38 open items, most carrying an effort
  estimate, and closed items carrying a retrospective that says what the work
  turned out to be, what review added, and what debt it spawned.
- `docs/DEBT.md` — 144 tracked items, resolved ones with date and commit, open
  ones with priority and estimate.

Nothing in that repo was modified.

**Blindness protocol.** The rubric's input has to be what a router would actually
see, so scoring used the **issue statement only**: the strikethrough title on the
launch-plan checkbox line, or DEBT.md's Issue column. No Notes column, no effort
estimate, no retrospective, no commit. Those were extracted with `grep`, the
fifteen scores were written to a file, and only then were the retrospectives
opened.

The record of that is real, not a claim: the blind scores were written before any
retrospective was read, and every miss below is a case where the blind score
disagrees with what the reveal showed.

**Two honest weaknesses in this run:**

1. Ground truth for closed items is the retrospective, not a clock. Nobody
   recorded hours per item. What the retrospectives *do* record is better than
   hours for this purpose — what review added, what the fix turned out to be,
   what the item spawned — but it is not a measured duration.
2. While pulling the two open items' descriptions with `grep`, the Notes column
   was truncated at 300 characters and some leaked. Both affected items (T-105,
   T-114) are marked below. The thirteen closed items were scored clean.

**"Actual lane" was defined before the reveal**, so the comparison could not be
fitted after the fact:

| Actual lane | Evidence required |
|---|---|
| `trivial` | one small edit, no test added, nothing spawned, no runtime observation needed |
| `bug-nho` | a repair, small, covered, no same-class follow-up, review changed nothing material |
| `bug-lon` | a repair where **any** of: review added something material · a same-class follow-up was spawned · the obvious first answer was wrong · money, legal documents, production data or tenant isolation were touched · runtime evidence was needed to localize it |
| `feature` | a new capability was built |

---

## 2. The fifteen cases

`✅` = rubric matched. `❌` = miss. `RC` = which root cause in §3.

| # | id | Issue as filed (blind input) | Rubric said | Actually was | | RC |
|---|---|---|---|---|---|---|
| 1 | T-106 | verify the template editor in a real browser | `bug-lon`, S/M · med | an **investigation**, not a repair — found a shipped defect no unit test could reach, spawned T-115 | ❌ | A |
| 2 | T-57 | confirm the cron is actually running | `bug-lon`, S · low | an **investigation** — 531 runs were green because each job `exit 0`s when `APP_URL` is unset; closed on a job log, not a tick | ❌ | A |
| 3 | T-113 | stop the test suite writing to the production database | `bug-lon`, M · med | `bug-lon` — review added **17 guard tests** and a skip-warning; 857 → 874 tests | ✅ | |
| 4 | T-109 | Yarn PnP artifacts | `bug-nho`, S · low | `bug-nho` — esbuild resolves `pdfkit` again, 242 MB reclaimed, one line of retrospective | ✅ | |
| 5 | B-13 | auto-email the invoice | `feature`, M · med | `feature` — "two features rather than one", +30 tests, red against 12 sabotages, spawned B-70 | ✅ | |
| 6 | T-104 | merchant logo and brand colour | `feature`, M · med | `feature` — 36 tests, 12 sabotages, one found a real bug; DEBT row admits it "understated its own scope" | ✅ | |
| 7 | T-137 | refunded shipping is missing from every credit note | `bug-lon`, L · high | `bug-lon` — wrong money on a transmitted legal document; **head of a seven-defect chain** (1.0c → 1.0d → 1.0e → T-148 → T-149) | ✅ | |
| 8 | T-146 | the webhook credits refunded shipping with no VAT | `bug-lon` + `round_2_fail`, M · med | `bug-lon`, round-2-fail confirmed: *"1.0 was not finished, and 1.0c is what proved it"*; same commit `9046d0f` as T-137 | ✅ | |
| 9 | T-147 | a held credit note is one Retry click from transmitting | `bug-lon`, M · med | `bug-lon` — *"fixed by neither of the two options this item had written down"*; 1246 → 1258 tests; review found two more | ✅ | |
| 10 | T-108 | scope template `load`/`save`/`rename` by shop | `bug-lon` (override 3, auth), M · med | `bug-nho`-sized — one commit `98ee511`, scope enforced by query, nothing spawned | ❌ | E |
| 11 | T-115 | the Bold switch discards its edit and says it didn't | `bug-nho`, S · low | `bug-lon` — settled by reading the shipped `polaris.js` shadow root and auditing **54** `dispatchEvent` sites; ten tests | ❌ | B |
| 12 | T-139 | raise the timeout on the DB-bound integration tests | `trivial`, S · low | `bug-nho` — the fix was **splitting the runner into two projects** so the unit suite kept its 5s clock, not raising a constant | ❌ | C |
| 13 | T-156 | the Settings form never learns it was saved | `bug-lon`, M · med | `bug-lon` — *"the cause was a previous fix's side effect"*; App Bridge's algorithm read out of the shipped bundle; spawned T-160 | ✅ | |
| 14 | T-105 | document font is Helvetica (WinAnsi), cannot render Greek/Polish/Czech | `feature`, S · low | 1h, Low priority, **and parked on the launch plan's §8 list** until a fifth locale is added | ❌ | D |
| 15 | T-114 | the production identity does not exist, created in one pass not repaired | `feature`, L · high | 3–4h + external lead time; irreversible `SCOPES` decision; four ordering traps | ✅ | |

**First pass: 9 ✅ / 6 ❌.** Gate is >3 in 10, i.e. >4.5 here. Failed.

---

## 3. What was actually wrong with the rubric

### A — the four lanes assume the deliverable is a diff *(cases 1, 2)*

`trivial`/`bug-nho`/`bug-lon`/`feature` all describe code changes. *Verify the
editor in a browser* and *confirm the cron is running* are neither repairs nor
new capability — they are questions, and they can legitimately find nothing. Both
fell through to `bug-lon`, which routes to Workflow B: reproduce, prove the root
cause, write a red test, fix. There is nothing to reproduce and possibly nothing
to fix. **The lane was unrunnable, not merely over-heavy.**

That this is a real class, not a curiosity, is clear from the same tracker:
`provision the production identity` and `settle the retail numbers` have the same
problem, and a third case (T-140, *establish whether the webhook carries shipping
VAT*) sat in the candidate pool.

**Fix:** an optional `kind` field — `code` (default) · `investigate` ·
`provision` · `decide`. When it is not `code`, the lane describes the work that
would *follow*, and `needs_human` is forced true because the follow-up is exactly
what the work exists to determine. `bug-lon` stays the usual value, and what it
buys is B2's evidence discipline. Case 2 is the argument: 531 green runs proved
nothing, and it closed on a real HTTP 200 in a job log. A cheaper lane would have
closed on the ticks.

### B — uncertainty under-called when the mechanism is in vendor code *(case 11)*

T-115 and T-156 are the same shape: a UI control misbehaving where the mechanism
lives in a third-party bundle, and both were settled by reading that bundle.
T-156 was scored `med` ("App Bridge behaviour is external"); T-115 was scored
`low` off the same kind of evidence. The signal existed only as intuition, so it
was applied once and forgotten once.

**Fix:** a hard floor in the rubric — *if the mechanism plausibly lives in
third-party code, `uncertainty` is at least `med`*, regardless of how small the
eventual fix looks. You cannot read your own repo to find out why someone else's
code misbehaves, so settling the mechanism becomes its own phase. With the floor,
case 11 scores `med` → `bug-lon`.

### C — the trivial test was applied to the title's proposed fix *(case 12)*

*"Raise the timeout on the DB-bound integration tests"* names a solution, and the
solution sounded knowable-by-reading, so it scored `trivial`. What shipped was a
runner split into `unit` and `integration` projects so only the DB-bound half got
the longer clock — a design call, made for a stated reason (*"a genuinely hung
unit test still fails fast rather than inheriting a laxer gate"*).

**Fix:** an explicit rule — *score the problem, never the fix the title proposes.*
A proposed fix is somebody's guess and is never evidence that the correct end
state is known. Titles that read as instructions are the main way the cheapest
lane gets claimed by mistake.

### D — `feature` is one lane covering 1h to 67h *(case 14)*

§7.1 gives bugs three gradations and features exactly one. Embedding a font file
(1h, Low priority, `DocumentTheme.fontRegular` already takes a `Uint8Array`) and
building the whole PDF foundation (~67h) both read `feature` → *Workflow A đầy
đủ*: spec gate, explore, plan, the review army, acceptance tests. That is not
proportionate.

**Partly fixed, and the important half was a different problem entirely.** The
decision-relevant fact about T-105 is not its size — it is that the launch plan's
§8 already parked it, with a reason (*"blocks neither Belgium nor Germany, the
only two markets in this plan"*) and a trigger (*"the day a locale outside
nl/fr/de/en is added"*). A manager that spawns an agent on T-105 wastes money on
work already decided against, and it would waste it whether the lane were heavy
or light. See §4.

The lane bluntness itself is **not** fixed, because fixing it means inventing a
fifth lane and §7.1 is the plan's to change, not this skill's. Written up in §5.

### E — override 3 promoted a case whose real effort was small *(case 10)*

T-108 is tenant isolation: `load`/`save`/`rename` took an id with no shop scope.
Override 3 (auth → at least `bug-lon`) fires, and the actual work was one commit
with nothing spawned.

**No fix. The override is doing its job.** A wrong fix to a cross-tenant scoping
bug leaks another shop's data, and the override is the plan's deliberate
insurance against exactly that. What the calibration can say is the price: it
fired on **1 of 15** cases and cost roughly one extra review pass. That is a
cheap premium, and it is recorded here so it is a measured cost rather than an
unexamined habit.

---

## 4. Envelope additions, and the one that was nearly rejected

Five optional fields were added beyond §3.1. All default to absent, so §3.1's own
example validates unchanged and any manager code written against the original
shape keeps working.

| Field | Why it exists | Enforced rule |
|---|---|---|
| `round_2_fail` | §7.1's override 2 is otherwise uncheckable — the envelope carries no way to say a fix already bounced | `true` → `lane` must be `bug-lon` |
| `touches_sensitive` | §7.1's override 3 is otherwise uncheckable | non-empty → `lane` ∈ {`bug-lon`, `feature`} |
| `kind` | root cause A | ≠ `code` → `needs_human: true` |
| `in_scope` + `defer_reason` | root cause D's real half | `false` → `needs_human: true` **and** `defer_reason` required |

**`in_scope` was nearly rejected.** The cheaper option is no new field at all:
express the deferral as a `blocking_questions` entry plus `needs_human: true`.
That works, costs nothing, and was seriously considered.

It was taken anyway, for two reasons. First, it is a genuinely different question
from the rest of `needs_human`: that flag means *we cannot verify this*, and a
parked item is often perfectly verifiable — T-105 has a full vitest suite behind
it, one hour of work, and low uncertainty. Collapsing "unverifiable" and "already
decided against" into one boolean loses the distinction the manager most needs.
Second, a boolean can be filtered and counted; prose cannot. A manager holding
eight queued issues should be able to answer *"how many of these did we already
decide not to do"* without re-reading eight paragraphs.

If that reasoning does not survive contact with the manager implementation, the
field is two lines in `validate.ts` and one bullet in `SKILL.md` to remove.

---

## 5. Re-score with the fixed rubric

Same fifteen cases, same blind statements, rubric as fixed in §3.

| # | id | Now scores | | Note |
|---|---|---|---|---|
| 1 | T-106 | `kind: investigate` · `bug-lon` · `needs_human` | ✅ | routable now — the lane is the spike's own evidence gate |
| 2 | T-57 | `kind: investigate` · `bug-lon` · `needs_human` | ✅ | |
| 3 | T-113 | `bug-lon` | ✅ | unchanged |
| 4 | T-109 | `bug-nho` | ✅ | unchanged |
| 5 | B-13 | `feature` | ✅ | unchanged |
| 6 | T-104 | `feature` | ✅ | unchanged |
| 7 | T-137 | `bug-lon` | ✅ | unchanged |
| 8 | T-146 | `bug-lon` · `round_2_fail` | ✅ | unchanged |
| 9 | T-147 | `bug-lon` | ✅ | unchanged |
| 10 | T-108 | `bug-lon` (override 3) | ❌ | **still over-heavy, deliberately** — see §3E |
| 11 | T-115 | `bug-lon` (vendor floor → `med`) | ✅ | fixed by B |
| 12 | T-139 | `bug-nho` (not `trivial`) | ✅ | fixed by C |
| 13 | T-156 | `bug-lon` | ✅ | unchanged |
| 14 | T-105 | `feature` · `in_scope: false` · `needs_human` | ❌ | **lane still disproportionate**, but the harm is contained — it no longer runs silently |
| 15 | T-114 | `kind: provision` · `feature` · `needs_human` | ✅ | |

**Re-scored: 13 ✅ / 2 ❌.** Passes the §2.2 gate. Both survivors are known and
neither is silent: one is the spec's own conservatism working as designed, the
other is a §7.1 asymmetry this skill is not authorised to change.

**Size accuracy, separately.** Lane is what routes, and only the `S`-vs-`M`
boundary flips it. Two size calls were under-scored on the reveal (case 5 read
`M` and shipped as two features; case 6's own DEBT row says it "understated its
own scope"), and neither changed the lane. Worth watching in the next run, since
`size` is what the manager will budget from.

---

## 6. Override checks against real cases

The plan's four overrides were checked against cases that exist rather than
against invented ones.

**Override 2 — round-2-fail → always `bug-lon`.** Confirmed live, and stronger
than expected. T-137 fixed the sweep path completely and the webhook path
partially, so *the same refund produced two different credit notes depending on
which path saw it*; T-146 closed the twin. The launch plan calls T-147 "the
seventh consecutive defect surfaced by fixing the previous one." §8 names the
class outright for T-149: *"this is the shape of T-124, T-137 and T-146 — a guard
on one path and not its twin — so treat the trigger as live, not theoretical."*
The rubric lists "a guard exists on one path but not its twin" as a `bug-lon`
signal and caught T-146 blind, before the override was even needed.

**Override 3 — auth / payment / data migration → at least `bug-lon`.** Three real
cases. T-114 gates on a `SCOPES` decision that forces every merchant through
re-consent if changed later — irreversible, external, auth. B-62 is the unbounded
loss case (Growth advertises unlimited, usage billing caps at $100/mo) — payment,
and the fix is explicitly two things, not either/or. And a standing hazard the
plan names twice: while `DATABASE_URL` points at both dev and production, *every
`prisma migrate dev` in the repo is a production DDL write* — recorded after it
happened by accident on two consecutive days. Any envelope for a schema-touching
issue in that repo carries `touches_sensitive: ["data-migration"]` until T-114
splits the databases.

**Override 4 — `assumption_count > 2` → `needs_human`.** No case in the fifteen
reached three assumptions, so this one is untested by this run. Its shape is
visible though: item 1.7 states its single assumption explicitly and in the open
(*"the assumption this is built on, stated so it can be corrected"*), which is
the behaviour the override is trying to make mandatory.

**Override 1 — no oracle → `needs_human`.** See §7.

---

## 7. Oracle probe, run for real against eivno

The probe in `SKILL.md` Step 2 was executed against `D:\Project\j\eivno`, not
described. Results:

| Signal | Found |
|---|---|
| Documented command | `CLAUDE.md`: `npx vitest run` — *"see the note below before running"* |
| `package.json` scripts | `test` = `vitest run` · `typecheck` = `react-router typegen && tsc --noEmit` · `lint` = eslint · three `check:*` node scripts |
| Runner deps | `vitest@^4.1.2` · `typescript@^5.9.3` · `eslint@^8.57.1` |
| Configs | `vitest.config.ts` · `tsconfig.json` |
| Assertion files | **93** — 72 `tests/services`, 7 `tests/integration`, 6 `tests/routes`, 2 `tests/frontend`, 1 `tests/docs` |
| Runner actually resolves | `vitest/4.1.2 win32-x64 node-v22.12.0` · `tsc 5.9.3` — both confirmed, no full run |

**Verdict:** `oracle_available: true`, `oracle_kind: ["vitest", "tsc", "eslint"]`.

Three findings the probe earned that a lookup table would have missed:

1. **There is no Playwright oracle here.** `.playwright-cli/` looks like one and
   is not: it holds console logs, `.yml` page snapshots and a PNG from an
   interactive CLI skill. Zero Playwright test files, no `@playwright/test`
   dependency, no `playwright.config.*`. Naming `playwright` in `oracle_kind`
   for this repo would have been a lie that survived until the first time
   something tried to run it. This is the whole argument for probing over
   remembering.
2. **The integration oracle is conditional on env.** `CLAUDE.md`: integration
   tests read `TEST_DATABASE_URL` and never `DATABASE_URL`, so with it unset they
   **skip** and print a warning — *"a green run with that warning is not a full
   run."* On this machine `.env.test` exists, so they run here. On a machine
   where it does not, `oracle_available` for any DB-bound issue is **false**,
   with the same repo and the same commit. The probe has to check the env, not
   just the harness.
3. **Coverage is not uniform across surfaces.** 72 of 93 files are service-layer;
   the frontend has exactly two (`fieldControl`, `settingsSaveBar`). A UI issue
   outside those two components has weak-to-no assertion coverage — which is
   precisely case 11's territory, closed on ten new tests plus a vendor source
   read, with the launch plan noting the fix was still never clicked in a real
   admin. This is why the rubric scopes `oracle_available` to the issue's
   surface rather than to the repo.

---

## 8. Open questions this run raises for the plan

1. **§7.1 has no lane for non-code work.** Handled here with a `kind` field and a
   forced `needs_human`, which is a containment, not an answer. Three of fifteen
   real items were non-code, and Stage 4 is almost entirely `provision` and
   `decide`. Worth deciding whether the lane table gains a row.
2. **`feature` covers 1h and 67h identically.** Bugs get three gradations,
   features get one. A `feature-nho` (spec gate + acceptance test, skip the review
   army) would mirror `bug-nho` and is the obvious shape.
3. **`oracle_kind` has no vocabulary in the plan.** Left open here, lowercase-kebab.
   A closed enum would have been wrong on day one: `monthly-point-sync`'s 35
   cases run through `node logic-test.cjs`, which is none of playwright/jest/tsc.
4. **`est_cost_usd` and `est_turns` are seeds with nothing behind them.** No
   measured run exists. §6.5 already forbids deriving the cost cap from them, so
   nothing is load-bearing yet, but the seed table in `rubric.md` §5 should be
   replaced by p90-of-actual per lane once ~20 tasks per lane are logged, not
   quietly kept.
