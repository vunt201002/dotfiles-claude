# fix-bug-loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `personal/skills/fix-bug-loop` skill that auto-retries `/fix-bug` on a B8 (verify) failure, stopping immediately (no retry) on any other blocked gate, without modifying `/fix-bug` itself.

**Architecture:** A single `SKILL.md` prompt template (no code, no build step — this repo's `personal/skills/*` are plain Markdown instruction files read directly by Claude via the `Skill` tool). The file instructs the orchestrating session to invoke `/fix-bug` repeatedly (up to a retry limit), branching on which gate `/fix-bug` reports back, and to track/report attempt history. No new source files, no generator, no compiled binary — this is prompt-engineering content, not application code.

**Tech Stack:** Markdown + YAML frontmatter (matches every other skill under `personal/skills/`). "Testing" in this domain means: valid YAML frontmatter, internally consistent prose (no contradictions with the approved spec), and a manual dry-run invocation to confirm the skill reads coherently end-to-end — there is no unit-test harness for `personal/skills/*` (confirmed: no `*.test.ts` references `personal/skills`, unlike the separate `gstack`-project skills under `test/skill-*.test.ts` which use a different generator-based format this repo doesn't use for personal skills).

## Global Constraints

- Do not modify `personal/skills/fix-bug/SKILL.md` — the spec's core non-goal. (spec: "Non-goals")
- Only a B8 (verify) failure triggers a retry. B2, B4, or any other blocked gate stops the loop immediately, no retry. (spec: "Loop flow")
- Default retry limit is 3 attempts, overridable via a bare-integer argument (`/fix-bug-loop 5`). (spec: "Retry limit")
- Never commits or pushes — stops after B9 or after a blocked report, same as `/fix-bug`. (spec: "What this skill never does")
- Never relaxes what counts as "verify passed" — each `/fix-bug` call runs its own unchanged B8 logic; the loop only reads that call's final report. (spec: "What this skill never does")
- Repo scope is always the current working directory (same as `/fix-bug`). (spec: "Inputs")
- Argument parsing: a bare integer argument is the retry-limit override, never bug content; anything else after the command name is bug context, same as `/fix-bug` accepts. (spec: "Inputs")

---

### Task 1: Write `fix-bug-loop/SKILL.md`

**Files:**
- Create: `personal/skills/fix-bug-loop/SKILL.md`

**Interfaces:**
- Consumes: `/fix-bug` skill (existing, unmodified — `personal/skills/fix-bug/SKILL.md`), invoked via the `Skill` tool with `skill: "fix-bug"` and an `args` string carrying the bug description (first call) or bug description + prior-attempt context (retry calls).
- Produces: the `fix-bug-loop` skill itself, invoked via `Skill` tool with `skill: "fix-bug-loop"`, optional `args` being a bare integer (retry limit) or bug context text.

This is a single-file, single-task skill — there's no multi-task decomposition to do here (no separate "components" to build independently; the whole deliverable is one coherent prompt document). Right-sizing per the writing-plans guidance: this is the smallest unit that carries its own verification cycle (frontmatter parses, content is self-consistent, a dry run reads coherently) and is worth a fresh reviewer's gate.

- [ ] **Step 1: Create the skill directory and write the frontmatter + opening section**

Create `personal/skills/fix-bug-loop/SKILL.md` with this exact content to start:

```markdown
---
name: fix-bug-loop
description: Auto-retry wrapper around /fix-bug — when Workflow B's verify step (B8) fails, calls /fix-bug again (up to a retry limit, default 3) with context on what was already tried, instead of stopping at the first verify failure. Does NOT modify /fix-bug or any of its gates — each attempt is a complete, independent /fix-bug invocation (B1 through B9). Only a B8 (verify) failure triggers a retry; if /fix-bug reports blocked at B2 (root cause not provable), B4 (red-team hole), or any other gate, the loop stops immediately with no retry, since a second attempt has no new evidence and won't change the outcome. Never commits or pushes — same as /fix-bug, stops after B9 or after a blocked report. Never relaxes what counts as "verify passed" — every attempt's B8 runs through /fix-bug's own unchanged logic. Use when asked "retry this bug fix", "loop until it passes", "fix bug lặp lại đến khi qua verify", "keep trying until verify passes", "/fix-bug-loop", or right after a /fix-bug run reports blocked at B8 and the user wants it retried automatically instead of manually re-invoking /fix-bug each time.
---

# /fix-bug-loop — retry /fix-bug on verify failure, unchanged gates

`/fix-bug` runs Workflow B and correctly stops when the verify step (B8) fails —
that's its own iron law, not a bug in it. But a B8 failure is often fixable on a
second attempt: the implementation needs adjusting, not a whole new investigation.
Without this skill, that means manually re-invoking `/fix-bug` with "thử lại đi"
over and over. This skill automates exactly that retry, and nothing more.

**This skill never touches `/fix-bug`'s own file or logic.** Every attempt —
the first and every retry — is a complete, independent `/fix-bug` invocation:
full Workflow B, B1 through B9, run exactly as `/fix-bug` already runs it. This
skill's only job is to read what `/fix-bug` reports back, decide whether to call
it again, and if so, pass along what was already tried so the next attempt
doesn't blindly repeat a failed approach.

If `/fix-bug` reports blocked at any gate OTHER than B8 (root cause not provable
at B2, a red-team hole at B4, anything else) — **stop immediately, no retry.**
Retrying without new evidence doesn't help an investigation-phase gate the way
it can help an implementation that verify caught as incomplete or wrong.
```

- [ ] **Step 2: Write the Inputs section**

Append to the same file:

```markdown
---

## Inputs

1. **The bug — from context, or ask.** Same as `/fix-bug`: usually already
   sitting in the conversation (a `/notion-task-personal` lookup, a pasted
   description, a bug report just typed). Pull it out directly. If recent
   context contains multiple bugs, don't silently pick one — say so and point
   at `/fix-bugs-parallel` (same redirect `/fix-bug` itself uses).

2. **Retry limit — optional, default 3.** Parsing rule: if the invocation's
   argument is a bare integer (e.g. `/fix-bug-loop 5`), that's the retry limit
   override — it is never interpreted as bug content. Anything else after the
   command name (a pasted description, a bug title) is bug context, same as
   `/fix-bug` accepts today. These two argument shapes don't collide in
   practice — a retry-limit override is always just a number with nothing
   else attached. If a future invocation is genuinely ambiguous, ask rather
   than guess which one was meant.

3. **Verify target — same as `/fix-bug`, asked lazily.** Don't ask for a
   browser target upfront. Whichever `/fix-bug` attempt first reaches B8 will
   ask for it if it's genuinely needed and not already known — this skill
   doesn't duplicate that logic, it's inherited from calling `/fix-bug`
   unchanged.

4. **Repo scope — always the current working directory.** Same as `/fix-bug`.
```

- [ ] **Step 3: Write the Step 1 (restate) and Step 2 (loop) sections**

Append to the same file:

```markdown
---

## Step 1 — Restate the bug and retry limit before starting

Before the first `/fix-bug` call, confirm what's about to happen:

\```
FIX BUG LOOP — up to <N> attempt(s)
────────────────────────────────
<bug title/summary — repro steps if known>
────────────────────────────────
Each attempt is a full /fix-bug run (Workflow B, B1-B9). Only a verify (B8)
failure triggers a retry — any other blocked gate stops immediately. Will
stop before commit.
\```

`<N>` is 3 unless a retry-limit argument was given. If the read-back is wrong
(misread context, wrong bug), fix it here before Step 2.

---

## Step 2 — Run the retry loop

Maintain an in-conversation attempt log (not a file — just what's been called
and what came back) as you go:

\```
attempt = 1
prior_attempts = []
retry_limit = <N from Step 1's restate — 3, or the override argument>

LOOP:
  invoke Skill(skill: "fix-bug", args: <bug description> +
               (prior_attempts formatted per "Retry context" below, if any))

  read /fix-bug's final report and classify it as one of:

  A. DONE — B9 reached, verify (B8) passed.
     → exit loop. Go to Step 3 (success report).

  B. BLOCKED at B8 — verify failed.
     → append to prior_attempts: what /fix-bug implemented this attempt,
       why B8 failed, the specific evidence /fix-bug's report gave for the
       failure (not "something was wrong" — the actual observed mismatch it
       reported).
     → if attempt < retry_limit:
         attempt += 1
         go to LOOP (this is the only case that loops back)
       else:
         exit loop. Go to Step 3 (retry-limit-reached report).

  C. BLOCKED at B2, B4, or any other gate (not B8).
     → exit loop immediately. Do NOT increment attempt, do NOT retry.
       Go to Step 3 (stopped-immediately report).
\```

### Retry context — what gets passed into each retry's `/fix-bug` call

When invoking `/fix-bug` for attempt 2 or later, prepend this to the bug
description passed as `args`:

\```
Prior attempt(s) on this bug:

Attempt 1: implemented <summary of the fix /fix-bug made>.
Verify (B8) failed: <specific reason, with the evidence from that failure —
the actual observed mismatch /fix-bug's report gave, not a vague restatement>.

[repeat one paragraph per prior attempt, in order, if attempt >= 3]

Do not repeat the same approach that already failed. If the verify failure
suggests the root cause itself was wrong or incomplete (not just the
implementation), you are allowed to re-investigate from B2 — but say so
explicitly in your report if you do.

---

<original bug description>
\```

This is the whole mechanism for letting a later attempt fix the actual
implementation gap, or — if the evidence genuinely points that way — let
`/fix-bug` itself decide to re-investigate from B2 using its own existing gate
logic. This skill does not add a separate branch for "should this retry
re-investigate" — that decision is `/fix-bug`'s to make, same as always, just
now with an extra hint that the prior angle didn't hold up.
```

- [ ] **Step 4: Write the Step 3 (report) section**

Append to the same file:

```markdown
---

## Step 3 — Report

**Case A — succeeded (verify passed), attempt 1 only (no retry needed):**

Report exactly as `/fix-bug` does today for its own success case — do not
manufacture an attempt-history section for a single attempt:

\```
FIX BUG — done
────────────────────────────────
Root cause: <one line, with the runtime evidence that proved it>
Fix: <one line — what changed, where>
Verified: <one line — how, including blast radius check>
────────────────────────────────
Ready for /review + /my-commit. Nothing committed, nothing pushed — your call next.
\```

**Case A — succeeded after 2+ attempts:**

\```
FIX BUG (LOOP) — done after <N> attempt(s)
────────────────────────────────
Attempt 1: <fix summary> → verify FAILED (<reason + evidence>)
Attempt 2: <fix summary> → verify PASSED (<evidence: observed A→B>)
────────────────────────────────
Root cause: <from the final successful attempt>
Fix: <what changed, where>
Verified: <how, including blast radius>
────────────────────────────────
Ready for /review + /my-commit. Nothing committed, nothing pushed.
\```

**Case B — blocked, retry limit reached, still failing verify:**

\```
FIX BUG (LOOP) — blocked after <N> attempts (retry limit reached)
────────────────────────────────
Attempt 1: <fix summary> → verify FAILED (<reason>)
Attempt 2: <fix summary> → verify FAILED (<reason>)
Attempt 3: <fix summary> → verify FAILED (<reason>)
────────────────────────────────
Not retrying further — needs a different approach, your call.
\```

**Case C — blocked, stopped immediately (B2, B4, or any non-B8 gate):**

\```
FIX BUG (LOOP) — blocked at <gate>, not retrying
────────────────────────────────
<what /fix-bug reported>
────────────────────────────────
This gate is about whether the approach is sound, not implementation
execution — retrying without new evidence wouldn't change the outcome.
\```

Every attempt lands in exactly one of these four report shapes. Never pad a
retry-limit-reached or stopped-immediately case as if it were done — same
iron law `/fix-bug` itself follows: a bug without a passing verify does not
get reported as fixed.
```

- [ ] **Step 5: Write the "Why this design" section**

Append to the same file:

```markdown
---

## Why this design

- **Calls `/fix-bug` as a black box, never forks its logic.** `/fix-bug`
  already owns Workflow B's gate discipline (B2's root-cause proof, B4's
  red-team, B8's verify-not-band-aid check, B9's stop-before-commit). Having
  this skill re-implement any of those gates would create two places that can
  drift out of sync. Every attempt is a full, unmodified `/fix-bug` run; this
  skill only reacts to what comes back.
- **Only B8 failures retry.** A B2 (root cause unprovable) or B4 (red-team
  hole) block means the *approach* is unsound, not that an otherwise-correct
  fix just needs another pass. A second `/fix-bug` call in that state has no
  new runtime evidence to work with — retrying would just burn a turn
  re-deriving the same block. B8 is different: the root cause and approach
  already held up through B2-B7, and the failure is specifically about
  whether the implementation or its blast-radius coverage was complete and
  correct — exactly the kind of gap a second attempt, now informed by what
  went wrong, can close.
- **Retry limit is a hard stop, not a suggestion.** Verify failures that
  persist past 3 attempts (or whatever limit was set) are a signal the
  approach needs human judgment, not more automated attempts. Reporting the
  full attempt history at that point — not just the last failure — gives the
  user everything needed to decide the next move without re-deriving it.
- **Verify standards never soften.** Because each attempt's B8 runs entirely
  inside an unmodified `/fix-bug` call, there is no code path in this skill
  that could relax what counts as "passed" to make the loop exit sooner. The
  only lever this skill has is "call `/fix-bug` again with more context" —
  it cannot touch what `/fix-bug` considers success.
- **Prior-attempt context, not a forced re-investigation branch.** Passing
  "here's what already failed and why" into the retry lets `/fix-bug`'s own
  B2 gate decide, using its own logic, whether the evidence points at a wrong
  root cause — this skill doesn't need a separate "should this retry go back
  to B2" decision tree, because `/fix-bug` already has one.
```

- [ ] **Step 6: Verify the frontmatter parses as valid YAML**

Run:

```bash
cd /Users/avadavu/Project/github/dotfiles-claude
python3 -c "
import re, yaml
content = open('personal/skills/fix-bug-loop/SKILL.md').read()
match = re.match(r'^---\n(.*?)\n---\n', content, re.DOTALL)
assert match, 'No frontmatter block found'
fm = yaml.safe_load(match.group(1))
assert 'name' in fm and fm['name'] == 'fix-bug-loop', f'name mismatch: {fm.get(\"name\")}'
assert 'description' in fm and len(fm['description']) > 0, 'description missing/empty'
print('OK: frontmatter valid, name=' + fm['name'])
print('description length:', len(fm['description']), 'chars')
"
```

Expected output:
```
OK: frontmatter valid, name=fix-bug-loop
description length: <some number > 0> chars
```

If `python3`/`yaml` isn't available, an equivalent one-liner with `node` and
a small inline YAML-frontmatter parse is acceptable — the point of this step
is only to prove the frontmatter block is well-formed, not to require a
specific interpreter.

- [ ] **Step 7: Manual coherence read-through**

Read the complete file top to bottom (`Read personal/skills/fix-bug-loop/SKILL.md`)
and confirm, against the approved spec at
`docs/superpowers/specs/2026-07-20-fix-bug-loop-design.md`:

- [ ] Frontmatter `description` matches what the skill actually does (no
      drift from Step 1's text)
- [ ] Loop flow section (Step 3 of this task) matches the spec's "Loop flow"
      section exactly: DONE / BLOCKED-at-B8-retries / BLOCKED-at-B2-or-other-stops
- [ ] Retry context block (Step 3 of this task) matches the spec's "What gets
      passed into each retry" section
- [ ] All four report shapes (Step 4 of this task) are present and match the
      spec's "Report format" section
- [ ] No mention anywhere of modifying `fix-bug/SKILL.md`, committing, or
      pushing
- [ ] No placeholder text (TBD, TODO, "handle appropriately", etc.)

This step has no automated command — it's the same kind of read-through
`/fix-bug`'s own Step 1 ("restate before starting") asks the orchestrating
session to do for a bug description, applied here to the finished skill file
before it's committed.

- [ ] **Step 8: Commit**

```bash
git add personal/skills/fix-bug-loop/SKILL.md
git commit -m "$(cat <<'EOF'
feat(fix-bug-loop): add skill to auto-retry /fix-bug on verify failure

Calls /fix-bug as an unmodified black box, up to a retry limit (default
3), only when it reports blocked at B8 (verify). Any other blocked gate
(B2 root cause, B4 red-team) stops immediately since a retry has no new
evidence to work with.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Post-plan verification (manual dry run)

This is not a Task 2 — it's a one-time end-to-end sanity check to run once
after Task 1's commit, before considering the feature done. There is no
automated test harness for `personal/skills/*`, so this substitutes for one.

- [ ] Invoke `Skill(skill: "fix-bug-loop")` with no bug in context and confirm
      it asks for the bug rather than inventing one (mirrors `/fix-bug`'s own
      "if nothing reads as a bug → ask directly" behavior — confirms the
      skill correctly delegates that behavior rather than re-deciding it).
- [ ] With a bug in context, invoke it and confirm Step 1's restate block
      shows the correct retry limit (3, or the override if one was passed)
      before any `/fix-bug` call happens.
- [ ] Confirm the retry-limit argument parsing: `/fix-bug-loop 5` is read as
      "limit=5, no bug text", not as bug content.

Report results informally in-conversation — no separate report file needed.
