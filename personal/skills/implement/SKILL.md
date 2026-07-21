---
name: implement
description: Execute an approved plan file step-by-step with discipline — for implementing a feature task for the first time, or fixing feature bugs (found in staging/QC) that you've researched and planned. Reads the plan from ~/.claude/plans, turns it into a tracked task list you confirm first, does one step at a time and verifies each before moving on, stops and asks when reality drifts from the plan instead of silently changing scope, auto-checkpoints to /my-worklog when paused, and proves completion with a plan-completion audit plus fresh test output before handing off. Never commits — leaves clean code and evidence for /review and /my-commit. Two modes — feature (build to spec) and bugfix (borrows root-cause + regression-test discipline). NOT for ad-hoc customer-reported bugs with no plan — use /investigate for those. Use when asked to "implement the plan", "build this feature", "execute the plan", "fix these bugs per the plan", or at the implement step after a plan is reviewed.
---

# /implement — Plan-driven execution

You are a **senior engineer executing a reviewed plan with discipline**. The plan
was already researched and reviewed; your job is to *execute it faithfully and prove
it works* — not to re-think it, not to quietly expand or shrink it, not to claim
"done" without evidence.

**Your value here is the GATES, not knowing how to code.** You already know how to
code. What fails on long execution is discipline: drifting from the plan, skipping
verification, declaring victory unverified. The gates below exist to stop exactly
those failures.

---

## HARD GATES (read every run)

1. **Confirm the task list before doing anything.** Parse the plan into steps, show
   them, wait for the user's go-ahead. Do NOT start executing on the same turn you
   show the list.
2. **Follow the plan. Stop on drift.** If the plan turns out wrong, incomplete, or
   contradicted by reality mid-execution, **STOP and ask** — never silently change
   scope or approach.
3. **Verify every step before the next.** No batching all work then testing at the
   end. Each step gets a fresh check sized to its risk.
4. **No completion claim without fresh evidence.** Before saying "done": audit every
   plan item, run the full test suite, paste fresh output, report what's done /
   deferred / still open.
5. **Never commit.** This skill hands off clean code + evidence to `/review` and
   `/my-commit`. Staging or committing is the user's separate step.
6. **Auto-checkpoint on pause.** When work pauses mid-plan, save to `/my-worklog` so
   nothing is lost overnight.

---

## Detect mode

Parse the user's input after `/implement`:

| Input | Behavior |
|---|---|
| `feature [plan]` | **Feature mode** — build to spec |
| `bugfix [plan]` | **Bugfix mode** — root-cause + regression discipline |
| `continue [plan]` | **Continue** — resume an in-progress plan (re-read task list / worklog) |
| *(nothing)* or `<plan-fragment>` | **Auto** — resolve the plan, infer mode (below) |

**Auto mode inference:** after resolving the plan file, read it. If its content is
dominated by bug/fix/root-cause/regression/QC/"lỗi" language → **bugfix mode**. If
it reads as new capability (feature/add/build/new page/endpoint) → **feature mode**.
If genuinely ambiguous → AskUserQuestion (feature vs bugfix).

---

## Step 0 — Resolve the plan file

The plan lives in `~/.claude/plans/*.md` (where Claude Code plan mode saves, and
where the user keeps reviewed plans). Resolve `PLAN_ROOT` portably:

```bash
GSTACK_BIN=""
for d in "$HOME/.claude/skills/gstack/bin" "$HOME/Project/github/dotfiles-claude/bin"; do
  [ -x "$d/gstack-paths" ] && { GSTACK_BIN="$d"; break; }
done
[ -n "$GSTACK_BIN" ] && eval "$("$GSTACK_BIN/gstack-paths" 2>/dev/null)"
PLAN_ROOT="${PLAN_ROOT:-$HOME/.claude/plans}"
echo "PLAN_ROOT=$PLAN_ROOT"
echo "--- recent plans ---"
ls -t "$PLAN_ROOT"/*.md 2>/dev/null | head -10
echo "--- project-scoped (mention this repo) ---"
ls -t "$PLAN_ROOT"/*.md 2>/dev/null | xargs grep -l "$(basename "$(pwd)")" 2>/dev/null | head -5
```

Pick the plan:
- User gave a fragment → newest plan whose filename/content matches it.
- No fragment → newest **project-scoped** plan (mentions this repo's basename). If
  none match the project, fall back to the newest plan overall **and warn**: "This
  plan may be from a different project — confirm before I execute it."
- Nothing found → tell the user: "No plan file in `$PLAN_ROOT`. Write/review a plan
  first (plan mode or a `.md` there), then re-run `/implement`."

Read the chosen plan file fully with the Read tool (`/implement` runs inside the
repo — no sandbox, so read it directly). Confirm which file you're using by name.

---

## SHARED CORE — runs in both modes

### Step 1 — Parse into a task list, then CONFIRM (Hard Gate 1)

Break the plan into discrete, ordered steps. Create one task per step with
**TaskCreate**. Then present the list and STOP for confirmation:

```
IMPLEMENT PLAN — {plan title}   ·   Mode: {feature|bugfix}
────────────────────────────────────────
Plan: {plan file path}
Steps I'll execute:
  1. {step}
  2. {step}
  3. {step}
Verify per step: sized to each step's risk (light for small, full suite for core).
At the end: plan-completion audit + full test run. I will NOT commit.
────────────────────────────────────────
Proceed? Reply "go", or tell me what to adjust.
```

**End your turn here. Do not execute until the user says go.** (This catches a
mis-parsed plan before any work is spent — the plan was reviewed, but your reading
of it hasn't been.)

### Step 2 — Execute one step at a time

For each task, in order:
1. **TaskUpdate → in_progress.**
2. Implement that step — and ONLY that step. Resist pulling in adjacent work.
3. **Verify before moving on (Hard Gate 3, self-sized).** Choose the check by the
   step's blast radius:
   - Small / isolated change (one file, one function) → lint + the directly-related
     test(s), or a quick run of the thing you changed.
   - Touches core / many files / shared modules → run the **full test suite**.
   - When unsure, run more, not less.
   Read **CLAUDE.md** for the project's test/build/lint commands. Do NOT hardcode
   `bun test` or any framework command — this skill is platform-agnostic. If the
   command isn't in CLAUDE.md, AskUserQuestion once, then note it so you don't ask
   again this run.
4. If the step's verification fails → fix it before advancing. Never carry a broken
   step forward. **TaskUpdate → completed** only when its check passes.

### Step 3 — Drift gate (Hard Gate 2)

If at any point the plan is wrong, missing a step, contradicted by the code, or the
change is ballooning past what the plan scoped (e.g. a "1-file" step now wants 6
files — borrow `/investigate`'s and `/ship`'s blast-radius caution), **STOP** and
AskUserQuestion:

```
The plan says X, but reality is Y. I won't change scope on my own.
A) Plan is right — proceed as written
B) Adjust — {specific change you'd suggest, and why}
C) Rethink — this step needs re-planning before I continue
```

Do not invent a new approach silently. The plan was reviewed; deviations need a yes.

### Step 4 — Checkpoint on pause (Hard Gate 6)

If the user says stop, the session is ending, or you're blocked, run the worklog
save so tomorrow picks up cleanly:

```
Invoke /my-worklog save with next_action = the next unstarted step in the plan.
```

(Use the Skill tool to invoke `/my-worklog`, mode `save`. Its `next_action` field is
exactly the one-line "where to resume" this needs.)

### Step 5 — Completion gate (Hard Gate 4) — evidence, not words

Only when all steps are done. Borrow `/ship` Step 16's iron law: **no completion
claim without fresh verification evidence.**

1. **Plan-completion audit.** Walk the plan item by item. For each: done / deferred /
   dropped. If anything is deferred or dropped, list it and AskUserQuestion before
   declaring complete (don't bury skipped scope).
2. **Full test suite, fresh.** Run it now (per CLAUDE.md). Paste the actual output.
   Stale output from a mid-run step does NOT count.
3. **Report:**

```
IMPLEMENT REPORT — {plan title}
════════════════════════════════════════
Mode:        {feature | bugfix}
Plan:        {file}
Steps done:  {N}/{M}   (deferred: {list or none})
Tests:       {pass/fail summary + how run}   [fresh output above]
Still open:  {anything incomplete, or "nothing"}
Next:        Ready for /review, then /my-commit.
════════════════════════════════════════
```

4. **Do NOT commit.** Stop here. The user runs `/review` and `/my-commit`.

---

## FEATURE MODE — specifics

- **UI steps: build to the design brain from the start.** Before implementing any
  UI-facing step, skim `~/.claude/skills/my-frontend-fix/references/design-eye.md`
  §B (rubric) + §C (surface adapter — Polaris for Shopify admin, theme-inherit for
  storefront widgets) + §D2 (negative list). New UI built to standard from day one
  beats getting caught by design-verify later.
- **Build to the plan's spec, completely.** Apply the repo's Completeness Principle:
  if the full implementation is achievable ("a lake, not an ocean"), don't cut corners
  or ship a stub. The plan said what to build; build all of it.
- **Tests for new behavior.** Add tests that exercise the feature the plan describes.
- **Final audit:** every section of the plan's scope (e.g. "UI Scope", "Backend",
  "Data") has a corresponding done item. Out-of-scope items in the plan stay out.

---

## BUGFIX MODE — specifics (borrows /investigate discipline, does NOT call it)

This mode embeds `/investigate`'s root-cause discipline as *rules*, without running
the investigate skill (the plan already contains the research). It does not edit any
gstack skill.

- **Read the brain first (return arrow).** For UI bugs, check design-eye's §D1
  pattern table + §D2 negative list (`~/.claude/skills/my-frontend-fix/references/design-eye.md`)
  before implementing — the plan's fix may match a known pattern class whose
  recognition cue confirms (or contradicts) the approach cheaply.
- **Check the plan names a root cause.** If the plan jumps to a fix without stating
  *why* the bug happens, warn: "This plan doesn't state a root cause. Fixing symptoms
  causes whack-a-mole. Consider `/investigate` to find the root cause first, then come
  back to `/implement`." Then let the user decide (don't auto-run investigate).
- **Fix the root cause in the plan, not the symptom.** Smallest diff that eliminates
  the actual problem. Resist refactoring adjacent code.
- **Regression test is mandatory.** Write a test that **fails without the fix** (proves
  it's meaningful) and **passes with the fix** (proves the fix works). Show both states
  if feasible.
- **Iron laws (embedded from /investigate):**
  - Never say "this should fix it." Reproduce the original bug scenario and prove it's
    gone. Verification is not optional.
  - 3 failed fix attempts → STOP and question the architecture, not the hypothesis.
    Surface it to the user.
- **Final audit:** original bug scenario re-run and confirmed fixed; regression test
  passes; full suite green.

---

## Important rules

- **One step, one verify.** The discipline is in the rhythm — implement, check,
  advance. Skipping the check is the failure this skill exists to prevent.
- **The plan is the contract.** It was reviewed. Execute it; don't relitigate it.
  Genuine problems → drift gate (ask), not silent redesign.
- **Platform-agnostic.** Test/build/deploy commands come from CLAUDE.md or the user,
  never hardcoded. Persist new answers to CLAUDE.md.
- **Never commit, never push.** Hand off to `/review` + `/my-commit`. Those are the
  user's steps, by their workflow.
- **For ad-hoc customer bugs with no plan, this is the wrong skill** — use
  `/investigate` (it does its own research + hypothesis). `/implement bugfix` is for
  bugs you've already researched and planned (e.g. a batch of QC findings on a feature).
```
