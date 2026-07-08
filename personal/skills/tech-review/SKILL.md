---
name: tech-review
description: Report-only technical quality review of the current diff (or a named file/dir) — is the code clean, are functions well-shaped, is the input/output contract sane, is there anything worth refactoring for clarity or size. Pure code-quality lens, NOT a bug hunt and NOT an auto-fixer. NOT for correctness bugs or feature regressions (use /impact-review or /code-review for that). NOT for auto-applying fixes (use /simplify — it does the same reuse/simplification/efficiency review but then edits the code; this skill only reports). NOT the pre-landing safety pipeline (use /review for SQL/security/concurrency checks). Use when asked "review kỹ thuật", "code này sạch chưa", "có chỗ nào refactor được không", "check function/naming", "tech review", "/tech-review", or before deciding whether a diff needs cleanup pass.
---

# /tech-review — pure technical-quality review (report only)

Reads code and judges it purely on craftsmanship: is it clean, are functions well-shaped,
is the input/output contract sane, is there anything worth refactoring. It never asks
"does this work correctly" and it never edits anything — it produces a findings list for
you to act on (or not).

Route correctly — three lookalike skills exist, don't collide with them:

- **Will this change actually break something?** (correctness, regressions, feature bugs)
  → **/impact-review** (this repo) or **/code-review** (global). Not this skill.
- **Just fix the quality issues, don't just report them** → **/simplify** (global) — same
  reuse/simplification/efficiency lens as this skill, but it edits the code afterward.
  Use `/tech-review` first if you want to see the list before anything changes.
- **Pre-landing safety** (SQL, security, concurrency, LLM trust boundary) → **/review**
  (this repo's heavy pipeline). Not this skill's job.

## Scope — what "technical quality" means here

Judge only these dimensions. Do not comment on whether the logic is *correct* — only
whether it's *well-built*.

1. **Cleanliness** — dead code, leftover debug statements, commented-out blocks,
   inconsistent formatting/naming within the same file, unnecessary complexity for what
   the code actually needs to do.
2. **Function design** — does each function do one coherent thing, or is it several
   responsibilities glued together? Is it a reasonable size, or does it need splitting?
   Is control flow easy to follow (early returns vs. deep nesting)?
3. **Naming** — do function/variable/parameter names say what they hold or do, without
   needing a comment to explain? Flag names that are misleading, too generic (`data`,
   `temp`, `handle`), or inconsistent with sibling code in the same file.
4. **Input/output contract** — for each changed function: are the parameters the function
   actually needs (no unused, no missing that force awkward workarounds elsewhere)? Is
   the return shape predictable (doesn't sometimes return `null`, sometimes `undefined`,
   sometimes throw, for what should be the same failure case)? Are side effects (mutating
   an argument, writing to shared state) obvious from the signature, or hidden?
5. **Refactor opportunities** — repeated logic that could collapse into one place,
   abstractions that don't earn their weight (over-engineering for what's actually a
   3-line case), places where the code fights the language/framework's idioms.

Skip: whether the algorithm produces the right answer, whether an edge case is handled,
whether a change breaks a caller elsewhere — that's /impact-review's job, not this one's.

## When invoked

1. **Determine scope.**
   - No argument → review the current diff against the base branch (`git diff` against
     `main`/`master`, whichever this repo uses — detect via `git symbolic-ref` or ask if
     ambiguous). This is the fast, pre-commit path.
   - A file or directory path given → review that path directly, not a diff.
   - If neither a diff nor a path resolves to anything (clean working tree, no path
     given) → say so and stop; don't invent scope.
2. **Read the actual code**, not just the diff hunks in isolation — pull enough
   surrounding context (the rest of the function, sibling functions in the same file) to
   judge whether a function is doing too much or a name fits its neighbors. A 3-line diff
   hunk read alone tells you nothing about whether the function it's inside of is
   well-shaped.
3. **Walk the 5 scope dimensions above** per changed function/file. Skip dimensions that
   genuinely don't apply (a one-line config change has no "function design" to judge).
4. **Write findings**, most-impactful first. For each: file:line, what's off, why it
   matters (concretely — "this function does X, Y, and Z; splitting Y out would let it be
   tested independently" beats "this function is too long"), and a one-line suggested
   fix direction (not a full rewrite — that's /simplify's job if requested).
5. **If nothing worth flagging survives your own second look, say so plainly** — an empty
   findings list is a valid, useful result. Don't manufacture nitpicks to look thorough.
6. **Report and stop.** No edits, no `git add`, no follow-up "want me to fix these?"
   unless the user asks — that's a distinct, explicit decision, not implied by asking
   for a review.

## Output format

```
## Tech review — <scope: diff vs main | path>

1. **file.ts:42** — <one-sentence defect statement>
   Why: <concrete reasoning, not a platitude>
   Direction: <short suggested fix, not a diff>

2. ...

(N findings, or: "Nothing worth flagging — code reads clean.")
```

## Speed first

This is a lens, not a pipeline — one pass, no multi-agent fan-out, no adversarial
verification round. If the diff is large enough that a single read genuinely can't hold
it (many unrelated files), say so and ask whether to scope down, rather than skimming and
reporting shallow findings across everything.
