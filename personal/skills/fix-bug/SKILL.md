---
name: fix-bug
description: Apply Workflow B (Fix bug) from /Users/avadavu/Project/github/dotfiles-claude/personal/docs/workflow.md to ONE bug, run directly in the main session — the single-bug counterpart to /fix-bugs-parallel, with no agent spawn. Same B1-B9 discipline (prove root cause before fixing, red-team the root cause, minimal fix, verify + blast radius, stop before commit), but kept inline so Workflow B's own human checkpoints (B3 — anh đọc research, B4 — red-team, B6 — plan mode if needed) stay live and interactive instead of buried in an agent's isolated transcript. Reads the bug from what's already in context (a /notion-task-personal lookup, a pasted description, a bug report) or asks if nothing's there. Verify (B8) routes through workflow.md's "Test trên browser" ladder (/my-chrome → Chrome DevTools MCP → Playwright MCP + /qa-login) — asks for a target URL only if/when a browser-verify step is actually reached, never upfront. Never commits or pushes — stops at B9's /review + local verify, hands the commit decision back to the user. Use when asked "fix this bug", "sửa bug này", "áp workflow B cho bug này", "/fix-bug", or right after describing/pulling up a single bug when the user wants it fixed now. If context actually contains multiple bugs, say so and point at /fix-bugs-parallel instead of silently picking one.
---

# /fix-bug — Workflow B, one bug, done inline

Packages the same recurring instruction as `/fix-bugs-parallel` — "read `workflow.md`,
apply Workflow B, verify against the real environment, stop before commit" — but for
the single-bug case, where spawning an agent would only add overhead and cost the one
thing a solo bug doesn't need to sacrifice: **interactivity**.

**You (the main session) fix the bug yourself here — no agent spawn.** Unlike
`/fix-bugs-parallel`, where the main session stays in the coordinator seat and never
touches code, here there's nothing to coordinate: one bug, one investigation, no
parallelism to size or throttle. Run Workflow B directly, gate by gate, keeping its
built-in human checkpoints live instead of collapsing them into an agent's final
report.

If this ends up being one of several bugs, stop and use **`/fix-bugs-parallel`**
instead — it's built for the batch case (sizing parallelism, throttling the shared
browser, one agent per bug). Don't run this skill in a loop for a bug list; that's
what the other skill exists to do correctly.

---

## Inputs

1. **The bug — from context, or ask.** Usually already sitting in the conversation:
   a `/notion-task-personal` lookup, a pasted description, a bug report the user just
   typed. Pull it out directly.
   - **If recent context clearly contains exactly one bug** → use it, then restate it
     back (Step 1) before starting — catch a wrong read before any investigation time
     is spent.
   - **If recent context contains MULTIPLE bugs** → don't silently pick one. Say so
     and point at `/fix-bugs-parallel` (or ask which single bug they mean, if they
     clearly want just one out of the list).
   - **If nothing reads as a bug** → ask directly rather than inventing one.

2. **Verify target — optional, asked only when actually needed.** Workflow B's B8
   step may need a live browser (UI bug) or may not (backend-only bug verified via
   emulator/Jest, per the app's Project Adapter). Don't ask for a store URL/target
   upfront — reach B8 first, and if it turns out a browser is genuinely needed and
   none is already known from context, ask then. Asking upfront for every bug
   (including ones that never touch a browser) is exactly the friction the batch
   skill accepts as a tradeoff for parallelism; a single bug doesn't need to pay it.

3. **Repo scope — always the current working directory.** Same as
   `/fix-bugs-parallel`: this skill fixes the bug in the repo this session is already
   in, no separate path argument.

---

## Step 1 — Restate the bug before starting

Before touching any code, confirm what's about to be worked on:

```
FIX BUG — Workflow B
────────────────────────────────
<bug title/summary — repro steps if known>
────────────────────────────────
Reading workflow.md, applying Workflow B in this repo. Will stop before commit.
```

If the read-back is wrong (misread context, missing a detail that changes scope),
fix it here before Step 2 — don't start investigating on a guess.

---

## Step 2 — Run Workflow B, gate by gate, live

Read `personal/docs/workflow.md`'s Workflow B section and follow it directly in this
session — not delegated, not summarized-then-skipped. The gates that must never be
shortcut:

- **B1. Context** — read the bug: description, repro, when it started. Still
  mờ/unclear after Step 1's restate? Ask before investigating on a guess.
- **B1.5. Đọc não trước khi đào** (return arrow, 30 giây) — vùng này từng đụng
  chưa? Tra trước khi dựng giả thuyết mới: `bin/gstack-decision-search --query
  <keyword>` (nếu repo có), vault note (`/joy-note` cho Joy, brain-vault cho phần
  còn lại). Bug UI: phần pattern table nằm ở B2 bên dưới. Khớp một note cũ
  **không miễn** Iron Law — vẫn phải PROVE bằng runtime ở B2; note chỉ giúp đào
  trúng hố nhanh hơn, không thay được bằng chứng.
- **B2. Investigate + PROVE root cause** (`/my-bug-hunter`) — reproduce, localize,
  observe runtime per the app's Project Adapter (FE: debug-global/Playwright ·
  BE: emulator). UI bug: opening the surface also means running design-eye's §A
  visual read + checking its §D1 pattern table FIRST
  (`~/.claude/skills/my-frontend-fix/references/design-eye.md`) — matching
  patterns get investigated before fresh hypotheses. **Cổng — bằng chứng runtime.** No fix without `"tại Y:Z, biến = A
  nhưng phải = B"` backed by an actual observation. Cannot prove it? STOP, report
  what was tried and where it's stuck — do not guess a fix.
- **B3. Anh đọc research** — this is the point of running inline instead of via
  agent: surface the research here, in the conversation, so the user reads it and
  can catch a wrong direction before more time is spent. Don't skip past this as if
  it were just an internal checkpoint.
- **B4. Red-team ROOT CAUSE** (`/codex challenge` if available, otherwise your own
  adversarial re-check) — "Nguồn hay triệu chứng? Fix đây thì thượng nguồn còn sai
  gì? Còn nguyên nhân khác?" A hole here means back to B2, not forward.
- **B5. Red test → ĐỎ** — screenshot baseline / Playwright assertion (FE) or Jest /
  emulator repro (BE), per the app's test harness.
- **B6. Plan nếu cần** (plan mode) — skip only for a bug small enough that the
  proven root cause already IS the plan; otherwise use plan mode so the user sees
  the approach before implementation starts.
- **B7. Implement tối thiểu → XANH** (`/implement`) — fix AT THE ROOT, 1-3 lines if
  possible, no drive-by refactor riding along.
- **B8. Verify + blast radius** (`/my-verify`, routed by layer) — chống băng-dán
  (runtime value actually changed, not a hardcode/`!important` papering over it) +
  blast radius (every place sharing the root cause) + regression. **UI bug: B8
  includes `/my-frontend-fix`'s design-verify gate** (design-eye §B — mechanical
  DOM checks first, then taste rubric, scored 0-10 per dimension; every dimension
  ≥8 or remaining findings severity-triaged; [Medium]/[Nitpick] → reported as
  polish items, never fixed inline). B8 is not passed while design-verify hasn't.
  Needs a browser?
  Follow workflow.md's "Test trên browser" ladder: **/my-chrome** first (real Chrome,
  already logged in) → if unavailable, **Chrome DevTools MCP** → **Playwright MCP**
  (with `/qa-login` priming cookies if the target needs login and neither MCP is
  already authenticated) — see that doc section for the full ladder. Only ask the
  user for a target URL here, and only if genuinely needed and not already known.
- **B9. Stop here.** Run `/review` + local verify. Do **NOT** run `/my-commit`, do
  **NOT** commit, do **NOT** push — that decision belongs to the user, after seeing
  the result.

If a gate fails (root cause unprovable, red-team surfaces a hole, verify doesn't
hold), say so plainly and stop at that gate rather than pushing forward on a guess —
same iron law as the batch skill, just without a report to synthesize across N
agents since there's only one bug here.

---

## Step 3 — Report

Once B9 is reached (or the flow stopped early at a gate):

```
FIX BUG — done
────────────────────────────────
Root cause: <one line, with the runtime evidence that proved it>
Fix: <one line — what changed, where>
Verified: <one line — how, including blast radius check>
────────────────────────────────
Ready for /review + /my-commit. Nothing committed, nothing pushed — your call next.
```

If it stopped early instead:

```
FIX BUG — blocked at <gate>
────────────────────────────────
<what was tried, what's blocking, what would unblock it>
```

Same rule as the batch skill: a bug without a proven root cause does not get a fix
applied. Report it as blocked/unproven, don't paper over it as done.

---

## Why this design

- **No agent spawn — this is the actual point of the skill, not an oversight.**
  `/fix-bugs-parallel` spawns agents because N independent investigations need to run
  concurrently and the coordinator can't watch all N at once. One bug has nothing to
  parallelize, so spawning a single agent here would only add indirection: an extra
  hop before the user sees anything, and a flattened final report instead of
  Workflow B's own live checkpoints (B3's "anh đọc research" is designed to be read
  *as it happens*, not reconstructed from an agent's summary after the fact).
- **Verify target asked lazily, not upfront.** The batch skill asks for a store URL
  before dispatching because every one of N agents independently needs to know it
  going in. A single bug's B8 either needs a browser or it doesn't — find out when
  actually reaching that gate, not before, so a backend-only bug never gets asked for
  a URL it will never use.
- **Same gates, same discipline, just not delegated.** B2's root-cause-proof, B4's
  red-team, B9's stop-before-commit all carry over unchanged from Workflow B and from
  `/fix-bugs-parallel`'s own framing of those gates — consistency across both skills
  means the discipline doesn't depend on which one happens to be invoked.
- **Multiple bugs in context → redirect, don't silently narrow.** If `/fix-bug` gets
  invoked right after a query that returned several bugs, guessing which one the user
  meant (or worse, quietly fixing just the first one) is a wrong-scope risk. Naming
  the mismatch and pointing at `/fix-bugs-parallel` costs one turn and avoids it.
