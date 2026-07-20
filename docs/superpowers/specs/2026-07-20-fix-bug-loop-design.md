# `/fix-bug-loop` — auto-retry wrapper around `/fix-bug`

## Problem

Fixing a bug in this workflow means running `/fix-bug` (Workflow B). When the
verify step (B8) fails, `/fix-bug` correctly stops and reports "blocked" —
that's its own iron law: don't paper over a fix that didn't actually work. But
in practice, verify failures are often fixable on a second attempt (the
implementation needs adjusting, not a whole new investigation), and the user
ends up manually re-invoking `/fix-bug` with "try again" over and over. This
skill automates that retry loop without changing `/fix-bug`'s own behavior or
gates.

## Non-goals

- Not a replacement for `/fix-bug` — `/fix-bug/SKILL.md` is not modified.
  This is a separate skill that calls `/fix-bug` as a black box.
- Not for batches of bugs — `/fix-bugs-parallel` already owns that case. This
  skill is single-bug, same as `/fix-bug`.
- Not a way to relax verify standards to "get to green faster." Every retry's
  verify step runs through `/fix-bug`'s own B8, unchanged. The loop has no
  mechanism to soften what counts as passing.
- Not a retry-the-investigation loop. If `/fix-bug` reports blocked because
  root cause couldn't be proven (its B2 gate), retrying doesn't help — the
  next attempt has no new runtime evidence just because it's a new attempt.
  This case stops immediately, no retry.

## Design

### Mechanism: call `/fix-bug` as a sub-step, not a code fork

`/fix-bug-loop` is a thin orchestration wrapper. Each iteration is a complete,
independent invocation of `/fix-bug` — full Workflow B, B1 through B9, run
exactly as `/fix-bug` already runs it. The loop's only job is: read what
`/fix-bug` reports back, decide whether to call it again, and if so, pass
along context about what was already tried so the next attempt doesn't blindly
repeat a failed approach.

This keeps `/fix-bug`'s own logic as the single source of truth for how
Workflow B gates work. The loop never re-implements B2/B4/B7/B8 — it only
reacts to `/fix-bug`'s final report.

### Loop flow

```
attempt = 1
call /fix-bug(bug, prior_attempts=[])
  ↓
/fix-bug reports one of:
  - DONE (B9 reached, verify passed)
      → stop loop, report success with full attempt history
  - BLOCKED at B2 (root cause not provable)
      → stop loop immediately, no retry — report blocked,
        explain why retrying wouldn't help (see Non-goals)
  - BLOCKED at B8 (verify failed) — the retry case
      → record this attempt: what was implemented, why verify failed,
        what evidence showed
      → if attempt < retry_limit:
          attempt += 1
          call /fix-bug(bug, prior_attempts=[...previous attempts])
          (loop)
        else:
          stop loop, report blocked with full attempt history
  - BLOCKED at any other gate (B4 red-team hole, etc.)
      → stop loop immediately, no retry — same reasoning as B2:
        these are gates about whether the approach is sound, not
        about implementation execution, so a second attempt with
        the same information doesn't change the outcome
```

**Only a B8 (verify) failure triggers a retry.** Every other blocked state
from `/fix-bug` stops the loop on the first occurrence — retrying without new
information doesn't help investigation-phase gates the way it can help an
implementation that verify caught as incomplete or wrong.

### Retry limit

Default **3 attempts**. Overridable via an argument: `/fix-bug-loop 5`. Once
the limit is reached with the bug still failing verify, the loop stops and
reports blocked — it never retries indefinitely.

### What gets passed into each retry

Each call to `/fix-bug` after the first includes the original bug description
plus a summary of prior attempts:

```
Prior attempt(s) on this bug:

Attempt 1: implemented <summary of the fix>.
Verify (B8) failed: <specific reason, with the evidence from that failure —
not "something was wrong" but the actual observed mismatch>.

Do not repeat the same approach that already failed. If the verify failure
suggests the root cause itself was wrong or incomplete (not just the
implementation), you are allowed to re-investigate from B2 — but say so
explicitly in your report if you do.
```

This is the mechanism that lets a later attempt fix the actual implementation
gap on attempt 2, or — if the evidence genuinely points that way — go back to
root-cause investigation on its own, without the loop dictating which gate
`/fix-bug` should target. `/fix-bug` still owns its own gate discipline; the
loop only supplies better context.

### Why re-investigation (B2) is allowed inside a retry, but the loop itself never forces it

The loop's default assumption per retry is "the fix needs adjusting, root
cause still holds" — that's the common case for a verify failure (incomplete
blast-radius coverage, a wrong implementation detail, a missed edge case).
But `/fix-bug` running a retry attempt has the same B2 gate as always; if the
verify failure's evidence shows the root cause was actually wrong, `/fix-bug`
itself decides to re-investigate — the loop doesn't need a separate branch for
this, because it's not making that decision, `/fix-bug` is, using its own
existing gate logic, just now working with an extra hint that the prior
angle didn't hold up.

### Report format

**Success (verify passed, possibly after retries):**

```
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
```

If it succeeded on attempt 1 (no retry needed), report exactly as `/fix-bug`
does today — no need to manufacture an "attempt history" section for a single
attempt.

**Blocked — retry limit reached, still failing verify:**

```
FIX BUG (LOOP) — blocked after <N> attempts (retry limit reached)
────────────────────────────────
Attempt 1: <fix summary> → verify FAILED (<reason>)
Attempt 2: <fix summary> → verify FAILED (<reason>)
Attempt 3: <fix summary> → verify FAILED (<reason>)
────────────────────────────────
Not retrying further — needs a different approach, your call.
```

**Blocked — stopped immediately (B2, B4, or any non-B8 gate):**

```
FIX BUG (LOOP) — blocked at <gate>, not retrying
────────────────────────────────
<what /fix-bug reported>
────────────────────────────────
This gate is about whether the approach is sound, not implementation
execution — retrying without new evidence wouldn't change the outcome.
```

### Inputs

Same as `/fix-bug`: the bug from context (or ask if none found), verify
target asked lazily by whichever `/fix-bug` attempt reaches B8 first, repo
scope always the current working directory.

`/fix-bug-loop` adds one optional argument: a retry limit override, e.g.
`/fix-bug-loop 5`. Parsing rule: if the invocation's argument is a bare
integer, it's the retry limit (default 3 when omitted) — it is never
interpreted as bug content. Anything else after the command name (a pasted
description, a bug title) is bug context, same as `/fix-bug` accepts today.
These two argument shapes don't collide in practice — a retry-limit override
is always just a number with nothing else — but if a future case is
ambiguous, ask rather than guess which one was meant.

### What this skill never does

- Never modifies `fix-bug/SKILL.md` or any of Workflow B's gate logic.
- Never commits or pushes — same as `/fix-bug`, stops after B9 (or after a
  blocked report), hands the commit decision to the user.
- Never retries past the limit silently — always surfaces the full attempt
  history when it stops, whether by success or by exhausting retries.
- Never retries a B2/B4/non-B8 blocked state — those are one-shot; retry logic
  applies only to B8 verify failures.
- Never relaxes what counts as "verify passed" — that determination is made
  entirely inside each `/fix-bug` call, using its own unchanged B8 logic.

## Open questions for implementation

None — design is considered complete pending user review of this document.
