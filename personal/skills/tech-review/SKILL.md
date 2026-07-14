---
name: tech-review
description: Report-only technical quality review of the current diff (or a named file/dir) — is the code clean, are functions well-shaped, is the input/output contract sane, is there anything worth refactoring for clarity or size. Also traces every merge commit on the branch back to master and flags any merge that pulled in a branch other than master (wrong-branch merge — brings in unrelated, unreviewed work); point it at a single commit hash to audit one historical merge after the fact. Pure code-quality + merge-provenance lens, NOT a bug hunt and NOT an auto-fixer. NOT for correctness bugs or feature regressions (use /impact-review or /code-review for that). NOT for auto-applying fixes (use /simplify — it does the same reuse/simplification/efficiency review but then edits the code; this skill only reports). NOT the pre-landing safety pipeline (use /review for SQL/security/concurrency checks). Use when asked "review kỹ thuật", "code này sạch chưa", "có chỗ nào refactor được không", "check function/naming", "merge nhầm branch", "check commit history", "commit này merge từ đâu", "tech review", "/tech-review", or before deciding whether a diff needs cleanup pass.
---

# /tech-review — pure technical-quality review (report only)

Reads code and judges it purely on craftsmanship: is it clean, are functions well-shaped,
is the input/output contract sane, is there anything worth refactoring. It never asks
"does this work correctly" and it never edits anything — it produces a findings list for
you to act on (or not).

It also runs one mechanical safety check before the quality read: did every merge into
this branch actually come from master? A branch merged into another feature branch
(instead of master into the feature branch) silently drags in unrelated, unreviewed work
— see "Step 0" below. This is the one non-quality check this skill performs, kept because
it's cheap (a few git log commands) and catches a class of incident that's invisible in a
diff-only read.

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
   - A commit hash given (e.g. "check this commit", a bare `<sha>` or `<sha>` pasted with
     no other context) → this is a **Step 0-only audit**, not a full quality review. Run
     Step 0 scoped to that single commit (skip straight to Step 0 step 3's classification,
     applied to just that one commit) and report only the merge-provenance finding — don't
     run the 5-dimension quality read against a single historical commit picked for
     provenance auditing, that's not what's being asked. This is the path for "did we ship
     a wrong-branch merge, check commit X" after-the-fact investigations, distinct from
     the pre-ship branch check below.
   - If neither a diff nor a path nor a commit hash resolves to anything (clean working
     tree, no path given) → say so and stop; don't invent scope.
2. **Run the Step 0 merge-provenance check** (below) whenever scope is a branch (i.e.
   whenever step 1 resolved to "diff against base branch" — not for a bare file/dir path,
   which has no merge history of its own to trace, and not for a single commit hash, which
   is handled directly above).
3. **Read the actual code**, not just the diff hunks in isolation — pull enough
   surrounding context (the rest of the function, sibling functions in the same file) to
   judge whether a function is doing too much or a name fits its neighbors. A 3-line diff
   hunk read alone tells you nothing about whether the function it's inside of is
   well-shaped.
4. **Walk the 5 scope dimensions above** per changed function/file. Skip dimensions that
   genuinely don't apply (a one-line config change has no "function design" to judge).
5. **Write findings**, most-impactful first — merge-provenance findings from Step 0 always
   lead the list, ahead of quality findings (a wrong-branch merge is a shipped-risk, not a
   style nitpick). For each quality finding: file:line, what's off, why it matters
   (concretely — "this function does X, Y, and Z; splitting Y out would let it be tested
   independently" beats "this function is too long"), and a one-line suggested fix
   direction (not a full rewrite — that's /simplify's job if requested).
6. **If nothing worth flagging survives your own second look, say so plainly** — an empty
   findings list is a valid, useful result. Don't manufacture nitpicks to look thorough.
7. **Report and stop.** No edits, no `git add`, no follow-up "want me to fix these?"
   unless the user asks — that's a distinct, explicit decision, not implied by asking
   for a review.

## Step 0 — merge provenance check (branch scope, or single-commit audit)

Before judging code quality, trace what actually got merged into this branch. This exists
because a wrong-branch merge (feature branch merged into feature branch, instead of
master into feature branch) is invisible in a normal diff read — the diff just shows a
pile of changed files, with no signal that they arrived via an unrelated, unreviewed
branch rather than the base branch. It's also invisible after the fact once the branch
has shipped and the offending commit is buried in history — see the reachability warning
in step 3 below for why you can't just check "is this branch name still around."

Two entry points, same classification logic (step 3):

- **Branch scope** (no commit hash given): enumerate every merge commit on the current
  branch and classify each. Steps 1-2 below.
- **Single-commit audit** (a commit hash was given, per "When invoked" step 1 above): skip
  straight to step 3, applied to just that one commit. This is the "did we ship a
  wrong-branch merge, check commit X" path — it does not enumerate a branch's full merge
  history, and it does not run the quality-dimension review afterward.

1. **Detect the base branch** (same detection as step 1 above — `git symbolic-ref
   refs/remotes/origin/HEAD` or ask if ambiguous). Call it `<base>` (typically `master`
   or `main`).
2. **List every merge commit on this branch since it diverged from `<base>`:**
   ```
   git log --merges --first-parent <base>..HEAD --format='%H|%P|%s'
   ```
   `--first-parent` here scopes to merges made directly onto *this* branch's own lineage
   — not merges that happened to ride in nested inside something else. If this returns
   nothing, there are no merges to check — skip straight to reporting "No merge commits on
   this branch" and move on to the quality review. (For a single-commit audit, skip this
   step entirely — there's exactly one commit to classify, given directly.)
3. **For each merge commit, classify it — trust the subject line, not reachability:**
   - Read the subject line and the two parent hashes (`%P` gives `<first-parent>
     <second-parent>`).
   - **The subject line is the primary and normally sufficient signal.** Standard git/
     GitLab/GitHub merge subjects name the source branch explicitly: `Merge branch 'X'
     into 'Y'`, `Merge remote-tracking branch 'origin/master' into Y`, `Merge branch 'X'
     into 'master'`. Parse `X` out of the subject and compare it against `<base>`.
   - **Do NOT use `git branch --all --contains <second-parent-hash>` or ancestor
     reachability (`git merge-base --is-ancestor`) as a substitute for the subject line
     when auditing historical commits** — only as a fallback when the subject is
     genuinely ambiguous (a squash-merge subject that names no branch). Reachability
     answers "is this commit an ancestor of ref X *right now*", which drifts over time as
     unrelated branches later converge back into `<base>` — a branch merged in wrongly
     last month can show up as "contained in master" today simply because *that other
     branch* also independently landed on master since. This produces false negatives on
     exactly the incidents this check exists to catch. The subject line records what was
     true *at merge time*, which is what actually matters here.
   - **A merge is expected** when the subject names the incoming branch as `<base>` itself
     (`master`, `origin/master`, `main`, `origin/main` — whatever this repo's base branch
     resolves to). This is the normal "sync with base to resolve conflicts before
     shipping" merge.
   - **A merge is suspect** when the subject names anything else as the incoming branch —
     another feature/fix/chore branch, especially one that doesn't share an obvious naming
     relationship with the current branch. This is the pattern that caused the incident
     this check exists for: `Merge branch 'feat/revamp-admin-wishlist-button' into
     'feature/wishlist-cart-drawer-tab-wc'` pulled an entire unrelated, untested feature
     into a branch that was about to ship.
4. **For each suspect merge, pull supporting evidence before reporting** — don't flag on
   the subject line alone:
   - `git show --stat <merge-hash>` — how many files, how large. A suspect merge that
     touched 1-2 files that are also touched by the branch's own commits might be an
     intentional cherry-pick-via-merge (rare but real); a suspect merge that touched many
     files unrelated to the branch's own diff is the dangerous case.
   - `git log <first-parent>..<second-parent> --format='%h %s'` — the actual commits that
     rode in on the merge, so the report can say what specifically got pulled in, not just
     "a merge happened."
5. **Report every suspect merge as a distinct, top-priority finding**, separate from and
   ahead of quality findings:
   ```
   ⚠ MERGE PROVENANCE — <merge-hash short> merged '<incoming-branch>' instead of '<base>'
      Commit: <full subject line>
      Brought in: <N files changed, M commits> — <one-line summary of what rode in>
      Why this matters: <incoming-branch> hasn't been reviewed/tested against this
      branch's own change set. If it ships together, <incoming-branch>'s work goes live
      without its own review/QA pass.
      Direction: confirm with the author whether this was intentional. If not, this
      branch needs the offending merge reverted/rebased out before it's safe to ship.
   ```
6. **This check is evidence-gathering, not enforcement** — it reports for you to act on
   (talk to the dev, decide whether to rebase it out), exactly like every other finding
   this skill produces. It does not block, revert, or edit anything on its own.

## Output format

```
## Tech review — <scope: diff vs main | path | single-commit audit>

### Merge provenance

⚠ MERGE PROVENANCE — <hash> merged '<incoming-branch>' instead of '<base>'
   Commit: <subject line>
   Brought in: <N files, M commits> — <what rode in>
   Why this matters: <...>
   Direction: <...>

(or: "All merges on this branch came from <base> — clean." / "No merge commits on this
branch.")

### Quality findings

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

Step 0 stays cheap by design: a handful of `git log`/`git show --stat` calls, not a full
read of every merged-in file. It only escalates to reading the actual rode-in commits'
diffs if the user asks for more detail after seeing a suspect-merge finding.
