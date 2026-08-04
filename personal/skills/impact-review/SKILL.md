---
name: impact-review
description: Report-only feature-impact review — reads a diff plus the surrounding code it touches (callers, dependents, related tests/config) and predicts whether the change breaks existing behavior or causes a regression. Always reads beyond the diff; never edits code. NOT a code-quality review (use /tech-review for naming, function shape, refactor). NOT the heavy pre-landing pipeline (use /review for SQL/security/concurrency). Use when asked "review tính năng", "code này có gây lỗi gì không", "review MR", "cái này có break gì không", "dự đoán ảnh hưởng", "impact review", "/impact-review", or before merging a change you're not sure is safe.
---

# /impact-review — feature-behavior impact review (report only)

Reads a change and everything it touches, then answers one question: **will this break
an existing feature?** It reasons about consequences — callers that assume the old
behavior, tests that encode the old contract, config that references what just changed —
not just whether the diff itself looks locally correct.

Route correctly — don't collide with lookalike skills:

- **Is the code well-built** (naming, function shape, refactor opportunities), not
  "does it work"? → **/tech-review** (this repo). Pure quality lens, no behavior
  reasoning. Often worth running alongside this skill, but they answer different
  questions.
- **Diff-scoped correctness at a configurable effort level**, without deliberately
  chasing down every caller → **/code-review** (global). Reach for this skill instead
  when you specifically need the blast-radius read — "who else touches this function,
  and did I just break their assumption."
- **Pre-landing safety** (SQL injection, race conditions, security) → **/review** (this
  repo's heavy pipeline). That's a different, broader checklist; this skill is narrowly
  about "did this change break a feature."
- **Just fix it** → neither. This skill only reports; if it finds something, the user
  decides whether to fix, and how.

## What "impact" means here

For each meaningfully-changed function, exported symbol, config value, or schema field:

1. **Find where it's used.** Grep/search for callers, importers, references — inside the
   diff's own files and outside them. A change to a function's signature, return shape,
   or side effects is only safe if every caller still gets what it expects.
2. **Compare old vs. new contract.** What did callers rely on before (return type,
   nullability, thrown-vs-returned errors, ordering, mutation of an argument, timing/
   async-vs-sync) — and does the new code still deliver that, or did something silently
   shift?
3. **Check related tests.** Do existing tests encode the OLD behavior in a way that would
   now be wrong (even if they still pass — e.g. a mock that no longer reflects reality)?
   Is there a test that *should* have caught this change but doesn't cover the changed
   path at all?
4. **Check config/data assumptions.** Does the change assume a shape of data, an env var,
   a feature flag, or a schema that isn't guaranteed at every call site? A change that's
   correct for the common case but wrong for an edge case a caller actually hits is still
   a regression.
5. **Trace conditional/branch changes for coverage.** If the diff adds or narrows a
   condition, what previously-handled case might now fall through unhandled, or what
   previously-excluded case might now execute?

Skip: whether the code is *clean* (naming, function size, refactor-worthiness) — that's
/tech-review's job, not this one's. A change can be ugly and still perfectly safe, or
beautiful and still break three callers.

## When invoked

1. **Determine scope.**
   - No argument → the current diff against the base branch.
   - A PR/MR number or URL given → fetch its diff (via `gh pr diff` / `gh pr view`, or
     the equivalent for the platform in use — check CLAUDE.md/project config for how
     this repo's PRs are hosted before guessing a command) plus its description, since
     the description states *intent* and a mismatch between stated intent and actual
     behavior is itself a finding.
   - A file/dir path given with no diff context → read it for what it exports/calls and
     reason about its current callers as a standing risk surface, not a "what changed."
2. **Read the diff first** to identify every changed function, exported symbol, config
   key, or schema field — this is the seed list for step 3, not the full review surface.
3. **Actively search beyond the diff.** For each item in the seed list, grep the
   repository for its usages. Do not limit the search to files already in the diff —
   the whole point of this skill is surfacing impact OUTSIDE the changed files. If the
   codebase is large enough that exhaustive search isn't practical in one pass, say so
   and prioritize the highest-risk items (exported/public API over internal-only,
   widely-called over single-caller) rather than silently truncating.
4. **For each usage found, reason concretely**: given the new contract, what does this
   specific caller now receive, and does its existing logic still handle that correctly?
   Write out the failure scenario in concrete terms — inputs/state that would trigger it,
   not just "this might not work."
5. **Rank findings by confidence and severity**, not just severity — a low-confidence
   guess about a subtle timing issue is still worth reporting, but say so plainly rather
   than stating it as fact. Distinguish "this WILL break because X" from "this MIGHT
   break if Y — worth checking."
6. **If the change is genuinely self-contained** (no external callers, no test/config
   dependency, or every usage checked out fine), say so plainly. A clean bill of health
   is a valid, useful result — don't manufacture speculative risk to look thorough.
7. **Report and stop.** No edits. If the user wants the risky spots fixed, that's a
   separate, explicit ask.

## Output format

```
## Impact review — <scope: diff vs main | PR #N | path>

1. **HIGH — file.ts:88 (caller of changed fn at src/foo.ts:42)**
   Change: <what shifted — old contract vs new>
   Failure scenario: <concrete input/state → wrong output/crash>
   Confidence: <will break | likely | worth checking>

2. ...

(N findings, or: "No external impact found — change appears self-contained.")
```

## Speed first

This is a targeted reasoning pass, not the multi-agent adversarial pipeline `/review`
runs. One thorough read beats a shallow multi-agent fan-out for this — the value here is
in actually tracing callers, not in volume of findings. If the blast radius turns out to
be large (a core shared utility, say), say so and ask whether to narrow scope rather than
silently sampling a subset of callers.
