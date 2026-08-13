# Rubric — how `size`, `uncertainty` and `lane` are decided

`SKILL.md` stays short because it is read on every invocation. This file is the
reasoning behind each field and is read when a call is close to a boundary, or
when the rubric is being recalibrated. Every threshold here is traceable to
either the `/joy-point-assign` matrix (calibrated on 2,388 real Joy tasks) or to
`personal/docs/manager-layer-plan-2026-08-12.md` §7.1 / `personal/docs/workflow.md`.

Nothing in this file invents a new scale. The scale already exists.

---

## 1. The two axes come from `/joy-point-assign`, unchanged

`/joy-point-assign` scores a task on Complexity (how hard is the implementation)
× Uncertainty (will this stay the size we think it is), lands on a Fibonacci
point, and has 2,388 historical tasks behind that mapping. Reuse it. Read
`personal/skills/joy-point-assign/references/estimation-rules.md` for the
complexity/uncertainty signal lists — they are not restated here.

```
                    Uncertainty
              None    A Little    A Lot
           ┌────────┬─────────┬─────────┐
     Hard  │ 13  21 │  34  55 │  89 144 │
           │  8  13 │  21  34 │  55  89 │
           ├────────┼─────────┼─────────┤
   Medium  │  5   8 │  13  21 │  34  55 │
           │  3   5 │   8  13 │  21  34 │
           ├────────┼─────────┼─────────┤
     Easy  │  2   3 │   5   8 │  13  21 │
           │  1   2 │   3   5 │   8  13 │
           └────────┴─────────┴─────────┘
```

### `uncertainty` — direct 3-to-3 mapping

| joy-point-assign | envelope |
|---|---|
| None | `low` |
| A Little | `med` |
| A Lot | `high` |

Same meaning, same test. Uncertainty is **not** "is the requirement clear" — it
is "will this work stay the size we currently think it is." A bug with a crisp
one-line repro can still be `high` if nobody knows yet which layer emits the
wrong value.

**Hard signal, added by the 2026-08-12 calibration: if the mechanism plausibly
lives in third-party code — a framework, a vendor bundle, an SDK, a platform
behaviour — `uncertainty` is at least `med`.** Not because the fix is big, but
because you cannot read your own repo to find out why it misbehaves, and
"settle the mechanism" becomes its own phase before a line changes. Two of the
calibration cases were this exact shape (a Polaris `s-switch` re-dispatching
without `bubbles`, App Bridge re-baselining only on a `document`-level submit),
and both were closed by reading the shipped vendor bundle. Scoring one of them
`low` and the other `med` off the same evidence is what this signal exists to
stop.

### `size` — banded off the resulting point, on the real distribution

Read the matrix cell (both axes), take the point, then band:

| Point | `size` | Share of the 2,388 historical tasks |
|---|---|---|
| 1 · 2 · 3 | `S` | 37.9% |
| 5 · 8 | `M` | 39.9% |
| 13 · 21 | `L` | 17.3% |
| 34 · 55 · 89 · 144 | `XL` | 3.1% |

Bands are cut on the real distribution rather than on round numbers, so `S` and
`M` carry most of the mass — which matches reality, where most issues are small.
An issue that lands `XL` is claiming to be in the top 3% of everything ever
shipped on that board. Check that claim before writing it down.

**The double-count is deliberate, and it is safe.** Uncertainty feeds `size`
(through the matrix's X-axis) and is also its own envelope field, so a small,
very uncertain issue reads as both `size: M` and `uncertainty: high`, and the
lane rule's `size ≥ M OR uncertainty ≥ med` fires on both. That redundancy can
only ever push a lane **up**, never down, and up is the safe direction. The two
fields answer different questions downstream: `size` sets the budget the manager
allocates, `uncertainty` sets which gates the lane must keep. Don't "fix" the
redundancy by stripping uncertainty out of the size read — the joy scale has
uncertainty baked into its point values, and pulling it out would silently
recalibrate a scale that took 2,388 tasks to earn.

### Where the calibration stops being about `size`

`size` only reaches the lane through one threshold: is it `≥ M`. Anything above
that boundary routes the same way. So a case argued between `L` and `XL` is not
a routing risk, only a budget-precision risk. Spend the argument on `S` vs `M`,
where the lane actually flips.

---

## 2. `lane` — the base decision

Four lanes, from §7.1. Decide the base lane first, then apply the overrides in
§4. Overrides only escalate; nothing in this rubric may move a lane down.

### First: is this a code change at all?

The four lanes all assume the deliverable is a diff. Three real kinds of work
are not, and the 2026-08-12 calibration lost two cases to exactly this by
forcing them through the bug lanes:

| `kind` | The work is | Example from calibration |
|---|---|---|
| `code` (default) | a diff | everything below |
| `investigate` | finding out whether something is true | *verify the template editor in a real browser*; *confirm the cron is actually running* |
| `provision` | creating infrastructure or an identity | *provision the production identity* |
| `decide` | choosing, where the output is a decision | *settle the retail numbers* |

For `kind ≠ code`, the lane still gets filled in — but it describes the work
that would **follow**, and nobody can pick that until the spike finishes. So
`needs_human` is forced true, and the value of the lane is which gates the spike
itself should keep, not which fix to write. `bug-lon` is usually right there, and
what it buys is Workflow B's B2 discipline: prove with runtime evidence, don't
close on a plausible-looking signal.

That discipline is not theoretical. *Confirm the cron is actually running* had
531 green runs and was still unproven, because each job `exit 0`s when a variable
is unset; it closed on a job log showing a real HTTP 200, not on the green ticks.
An `investigate` item routed as if it were a small fix would have closed on the
ticks.

### Score the issue, not the fix its title proposes

An issue titled *"raise the timeout on the DB-bound integration tests"* names a
solution. The rubric scores the **problem**, and a proposed fix is never evidence
that the correct end state is knowable — the fix that actually shipped there was
splitting the runner into two projects so the unit suite kept its strict clock,
which is a design call, not a constant. Titles that read as instructions are the
most common way `trivial` gets over-claimed.

### `feature` — the item builds something that does not exist yet

The discriminator is not size, it is direction: are we **repairing behavior that
was supposed to work** (bug lanes) or **adding behavior that was never there**
(feature lane)? A 3-line feature is still a feature — Workflow A's Gate 1 exists
because the expensive failure in new work is building the wrong thing, and that
failure does not get cheaper when the diff is small.

Routes to Workflow A in full (`workflow.md` A1-A8).

**Known bluntness, reported rather than patched.** §7.1 gives bugs three
gradations and features exactly one, so a one-hour additive change and a
sixty-seven-hour stage both read `feature` and both nominally get Workflow A in
full. The calibration hit this on a font-embedding item estimated at 1h. Adding a
`feature-nho` lane would be the fix, and it is not this skill's call to invent a
fifth lane — the asymmetry is written up in `calibration-2026-08-12.md` §5 for
the plan to answer.

### `trivial` — the correct end state is knowable without running anything

§7.1 lists typo / label / color / copy / one-liner. The property those five share
is the actual test:

> **Can you state exactly what the code should say, without observing anything at
> runtime?**

Yes → `trivial`, fix it directly. No → at minimum `bug-nho`, because you are
about to guess, and `workflow.md`'s core principle ("prove trước khi build")
says a guess is where the round-2-fail comes from.

This test is stricter than a line count, on purpose. `fix(hooks): find the
dotfiles repo from the script's own location` is a 4-line diff and is **not**
trivial: you had to observe that the guard was exiting silently to know the path
was wrong. `fix(deploy-tag): keep the confirm block English and free of MR
numbers` is a 41-line diff and **is** trivial-adjacent: it is a prose rule about
what a message may contain, decidable by reading.

`trivial` additionally requires `uncertainty: low`. A change you can fully
specify on paper but that might drag other things with it is not trivial.

### `bug-nho` — small, certain, and there is something that can prove it fixed

All three, no exceptions:

- `size: S`
- `uncertainty: low`
- `oracle_available: true`, and the oracle covers **this issue's surface** (§3)

Routes to Workflow B with B4 (red-team) and B6 (plan) dropped. B2's root-cause
proof still runs — dropping B4 removes the second opinion on a root cause, not
the requirement to have one.

Signals that a case genuinely belongs here: the symptom reproduces on demand;
one file or one function is suspected and the suspicion is checkable in a single
observation; nothing persisted changes shape.

### `bug-lon` — everything else that is a repair

Any one of these is enough:

- `size ≥ M`
- `uncertainty ≥ med`
- round-2-fail (a fix for this already bounced back from QC)

Routes to Workflow B in full, and **B2's runtime-evidence gate is mandatory** —
no `[CHƯA CHỨNG MINH]` handoff, no fix before the source is proven.

Signals that pull a case up into `bug-lon` even when it first reads small:

| Signal | Why it belongs here |
|---|---|
| Shared logic used in 3+ call sites | Blast radius is the work, not the fix |
| Which layer emits the wrong value is unknown | B2 is the whole job |
| Persisted state: rows, records, points, money | A wrong fix corrupts data that outlives the session |
| Concurrency, ordering, caching, or a stale cache key | Not reproducible by reading |
| Intermittent symptom, no reliable repro | You cannot verify a fix you cannot trigger |
| Cross-surface (admin + storefront, or 2+ widget-v4 layers) | The classic round-2-fail: fix one surface, ship the other broken |
| A previous fix in this same class already bounced | Override 2, hard |
| Touches auth, payment, or a data migration | Override 3, hard |
| More than 2 assumptions needed to proceed | Override 4 — and in practice the lane was misjudged |

---

## 3. `oracle_available` — probed, never assumed, and scoped to the surface

An oracle is something that **runs** and **says pass or fail without a human
looking at it**. Three properties, all required:

1. It executes. A `jest.config.js` in a repo where the runner does not resolve is
   not an oracle.
2. It asserts. A dev server that boots is not an oracle. A screenshot nobody
   diffs is not an oracle.
3. **It covers the surface this issue lives on.** This is the property that gets
   skipped, and skipping it is how a task enters an autonomous lane with nothing
   able to catch it. Joy has a real frontend observation path (`__joyDebug`) and
   zero backend tests; for a Joy backend issue, `oracle_available` is `false`
   even though the repo is not test-free.

Per `manager-layer-plan` §0 principle 4, `oracle_available: false` forces
`needs_human: true` — always, at every size, including `trivial`. The lane itself
is not escalated by this rule (a copy change in an untested repo is still a copy
change); `needs_human` is what keeps it out of unattended execution.

### Detection order

1. **The repo's own `CLAUDE.md` / `AGENTS.md`.** Project config wins over
   guessing — this is the platform-agnostic rule the whole harness runs on.
2. **`personal/hooks/stop-full-check.sh`.** Its per-repo dispatch already encodes
   what this machine believes each repo can run, and it was corrected three times
   against reality (wishlist monorepo, joy's missing root tsconfig).
3. **Probe the working tree** — see `SKILL.md` Step 2 for the command.
4. **Confirm the runner resolves.** Cheap existence check only (`--version`,
   `--listTests`); a full suite run belongs at B5/B8, not at sizing time.

### `oracle_kind`

The plan never enumerates the allowed values. Treat it as an open vocabulary,
lowercase-kebab, naming the thing that actually runs. Recommended values:

`playwright` · `jest` · `vitest` · `tsc` · `eslint` · `node-script` · `emulator`
· `screenshot-diff` · `curl-assert`

`node-script` exists because the best-covered project on this machine
(`monthly-point-sync`, 35 cases in `logic-test.cjs` loading `Code.gs` into
`node:vm`) is not jest, not vitest, and not playwright. Any closed enum that
looks reasonable would have forced a lie about that repo on day one.

Never write a kind you did not observe. An empty `oracle_kind` and
`oracle_available: false` must agree — the validator rejects them apart.

---

## 4. The four overrides, in order

Applied after the base lane, each one escalation-only.

**1. `oracle_available: false` → `needs_human: true`.**
Nothing can prove the work landed. The lane stays whatever it was; the flag stops
it from running unattended.

**2. Round-2-fail → `lane: "bug-lon"`, regardless of size.**
A fix that already bounced back from QC once has, by definition, a wrong or
incomplete root cause behind it. Size is not the variable that failed; the
proof was. Re-running the short lane repeats the mistake with more confidence.

**3. Touches auth / payment / data migration → at least `bug-lon`.**
`trivial` and `bug-nho` are both promoted; `feature` stays `feature` (Workflow A
already carries heavier gates). "Touches" means the diff will plausibly land in
that code, not that the feature is vaguely adjacent to it.

**4. `assumption_count > 2` → `needs_human: true`.**
Per §3.1: many assumptions means the router already mis-scoped the work.
An assumption that is wrong and unblocked is the failure class that ships most
often, which is why the count is a hard gate and not a note in the report.

### Two more gates, added by the calibration and not in §7.1

**5. `in_scope: false` → `needs_human: true`, and `defer_reason` is required.**
The most decision-relevant fact about an issue is sometimes that somebody already
decided not to do it. A well-run project keeps that list — eivno's launch plan
§8 has fourteen rows, each with a reason and a trigger for revisiting. An item
sitting on that list can be small, certain, fully covered by tests, and still
must not run: the money is not wasted on the difficulty, it is wasted on the
question. `needs_human` alone does not carry this — that flag means "we cannot
verify it", and a parked item is often perfectly verifiable. Check the deferral
list before scoring, and when the issue is on it, say so in `defer_reason`
including what revives it.

**6. `kind ≠ code` → `needs_human: true`.** Per §2 above: the lane describes the
follow-up, and the follow-up is exactly what the spike exists to determine.

### Assumption or blocking question?

From §10.4, and it is worth getting right because it drives override 4:

| | Goes in |
|---|---|
| Wrong answer makes the work meaningless or unsafe | `blocking_questions` — task hangs, human answers |
| Wrong answer costs a rework, work continues meanwhile | `assumptions` — proceed, state it in the report |

A `blocking_questions` entry that is not really blocking is how a batch of
questions turns into noise nobody reads. An `assumptions` entry that really was
blocking is how the wrong thing gets built confidently.

---

## 5. `est_cost_usd` and `est_turns` — seeds, explicitly not a budget

These two fields are the least trustworthy in the envelope and the plan already
says so: §6.5 forbids deriving the cost cap from `est_cost_usd`, because the
estimate comes from the same agent whose spend it would be bounding, and models
under-estimate systematically. The manager runs a flat bootstrap cap (about
$5/task) and replaces it with the **p90 of actual** per lane once there are ~20
tasks of history.

So these numbers exist to measure how wrong the agent's estimate is. Seed table,
scaled off the oracle-chain length each lane runs (§7.2):

| Lane | `est_turns` | `est_cost_usd` |
|---|---|---|
| `trivial` | 5-10 | 0.10-0.30 |
| `bug-nho` | 15-25 | 0.40-0.90 |
| `bug-lon` | 35-60 | 1.00-2.50 |
| `feature` | 60-120 | 2.00-5.00 |

**These seeds are not calibrated.** No measured run stands behind them. Replace
the table with the gate log's p90 per lane as soon as ~20 tasks per lane exist,
and do not quietly keep using it past that point.

Within a band, move toward the top when: the surface is unfamiliar, the oracle is
slow (browser rather than headless), or `uncertainty` is `high`.

---

## 6. Worked examples — all real, all from the 2026-08-12 calibration

Scored from the issue statement alone, then checked against what the work
actually turned out to be. Full workings, including the six that missed, in
`calibration-2026-08-12.md`.

| Real issue | kind | size | unc | lane | Why |
|---|---|---|---|---|---|
| Verify the template editor in a real browser | investigate | M | med | bug-lon | Outcome unknown by design; found a shipped defect no unit test reached |
| Confirm the cron is actually running | investigate | S | med | bug-lon | The cheap signal lies — 531 green runs over a no-op |
| Yarn PnP artifacts break `pdfkit` resolution | code | S | low | bug-nho | One build config, symptom fully localized, tsc covers it |
| Raise the timeout on the DB-bound integration tests | code | S | low | bug-nho | Title proposes a constant; the right end state was a runner split |
| The Bold switch discards its edit and says it didn't | code | S | med | bug-lon | Mechanism lives in a vendor bundle → uncertainty floor |
| The Settings form never learns it was saved | code | M | med | bug-lon | Caused by a prior fix; vendor algorithm had to be read |
| Scope template `load`/`save`/`rename` by shop | code | M | med | bug-lon | Tenant isolation → override 3 |
| Stop the test suite writing to the production database | code | M | med | bug-lon | Production data; review added 17 guard tests |
| Refunded shipping is missing from every credit note | code | L | high | bug-lon | Wrong money on a transmitted legal document |
| The webhook credits refunded shipping with no VAT | code | M | med | bug-lon | Twin path of the above → round-2-fail |
| Auto-email the invoice | code | M | med | feature | New capability; the hard part was not sending twice |
| Merchant logo and brand colour | code | M | med | feature | New capability across settings and rendering |
| Document font cannot render Greek, Polish or Czech | code | S | low | feature | Parked on the launch plan's §8 list → `in_scope: false` |
| Provision the production identity | provision | L | high | feature | Irreversible scope decision, external lead time |

---

## 7. Recalibrating this rubric

`manager-layer-plan` §2.2 sets the standard: score real, finished issues, compare
to the effort actually spent, and if **more than 3 in 10 miss, the rubric is
wrong** — change the rubric, never the data.

The 2026-08-12 run did exactly that and **failed at 6/15**, which is why §1's
vendor-uncertainty floor, §2's `kind` question, §2's score-the-issue-not-the-fix
rule and §4's two extra gates exist. Re-scored with them, the same fifteen cases
land at 2/15. Both numbers, and the two that still miss, are in
`calibration-2026-08-12.md`.

Re-run once the gate log holds ~30 sized tasks with outcomes attached (§9: "ghi
dự đoán vs thực tế; hiệu chuẩn sau ~30 task"). Three things worth watching that
this run could not measure:

- **`S`-vs-`M` boundary accuracy specifically.** That is the only threshold that
  flips a lane, and a retrospective run cannot separate it from hindsight.
- **Whether `trivial` is being over-claimed.** It is the only lane with no gate
  to catch a bad call, so it has the strongest pull and the least protection. It
  was claimed once in this run and was wrong once.
- **Whether the post-fix 2/15 holds on issues nobody has finished yet.** A
  rubric tuned on closed work has seen every answer; the honest test is the next
  fifteen, scored before the work runs.
