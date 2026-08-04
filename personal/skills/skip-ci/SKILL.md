---
name: skip-ci
description: Push the current branch to remote WITHOUT triggering a CI pipeline, via an empty commit carrying [skip ci]. For refactors, comment/format cleanups, merge-master syncs — code that needs to land on remote without burning pipeline minutes. Verifies the repo's CI actually honors the keyword; refuses to push on master/main. NOT for triggering a deploy (/trigger-deploy — the opposite). NOT a commit-your-changes skill (/my-commit) — this only ever creates an EMPTY commit and never stages files. Use when asked "skip ci", "push không deploy", "push mà đừng build", "đẩy code lên nhưng khỏi chạy pipeline", "/skip-ci".
---

# /skip-ci — Empty commit + push, without triggering the pipeline

Land the current branch on remote **without** spending a pipeline run. Adds one
empty commit whose message carries the CI skip keyword, then pushes.

Use it when the push genuinely does not need CI: a refactor, comment/format
cleanup, a `merge master` sync, dead-code removal — anything where a build or
deploy would just burn minutes.

## The keyword matters — `[skip-ci]` does NOT work

GitLab (and GitHub Actions) only skip a pipeline when the commit message
contains one of these **exactly**:

| Works | Does NOT work |
|---|---|
| `[skip ci]` | `[skip-ci]` ← hyphen, silently ignored |
| `[ci skip]` | `skip ci` ← no brackets |
| `[skip-ci]` only if the repo has a **custom rule** matching it | `[no ci]`, `[nobuild]`, … |

A commit titled `[skip-ci] cleanup` runs the full pipeline. This skill therefore
always writes **`[skip ci]`** unless Step 1 proves the repo has a custom rule for
a different token.

## HARD GATES

- **Empty commit only.** Always `--allow-empty` with nothing staged. Never
  `git add`, never `git add .`, never `git add -A`, never commit tracked
  modifications. If the working tree is dirty, Step 2 stops and asks.
- **Never push to `master` / `main`.** Step 3 aborts if the current branch is the
  repo's base branch.
- **Never force-push.** Plain `git push` only.
- **Never amend or rewrite history.** Only ever adds one new commit on top.
- **One commit per invocation.** Don't loop or batch.

---

## Step 1 — Read the branch, the tree, and the repo's CI rules

```bash
git rev-parse --abbrev-ref HEAD
git status --porcelain
git log --oneline -3
ls .gitlab-ci.yml .github/workflows 2>/dev/null
```

If a CI config exists, check whether the repo overrides the default skip
behavior — some repos define rules that run jobs regardless, or that match a
custom token:

```bash
grep -n -iE "skip.?ci|ci.?skip|CI_COMMIT_TITLE|CI_COMMIT_MESSAGE" .gitlab-ci.yml 2>/dev/null | head -30
```

Interpret it:

- **No match** → the platform default applies. `[skip ci]` works. Proceed.
- **A rule matching a custom token** (e.g. `$CI_COMMIT_TITLE =~ /\[skip-ci\]/`)
  → use that repo's token instead, and say so in the report.
- **A rule that would run jobs anyway** — most importantly a `workflow:` block or
  a job rule using `when: always`, or a pipeline source this skill can't suppress
  (scheduled / triggered / merge-request pipelines are **not** stopped by
  `[skip ci]` on some setups) → **tell the user before committing** that the skip
  may not hold, and ask whether to continue.

Also sanity-check history to see which form this repo actually uses:

```bash
git log --oneline -300 | grep -iE "skip.?ci" | head -10
```

Mixed history is common and not authoritative — the CI config wins. Only treat
history as a signal if the config was silent.

## Step 2 — Handle a dirty working tree

If `git status --porcelain` is empty → go to Step 3.

If it is **not** empty, **stop and ask**. This skill makes an empty commit; it
will not sweep up the user's uncommitted work. Show what's dirty and offer:

1. **Commit the real changes first** with `/my-commit`, then re-run `/skip-ci`.
2. **Proceed anyway** — the empty commit lands, dirty files stay uncommitted
   locally (fine if they're scratch files).

Never pick for them.

## Step 3 — Guard the branch

```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD)
# Detect the repo's base branch rather than assuming
git symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null | sed 's#.*/##'
```

If `BRANCH` is `master`, `main`, or the detected base branch → **abort**. Tell the
user: pushing an empty commit straight to the base branch isn't what this skill is
for. They can switch to a feature branch and re-run.

If `BRANCH` is detached HEAD → abort, nothing to push.

## Step 4 — Build the message

Format:

```
[skip ci] <what this push is>
```

Pick `<what this push is>` from what's actually in context — the refactor just
finished, the merge just resolved, the cleanup just done. Keep it short and
concrete.

- Given an argument (`/skip-ci refactor cart drawer`) → use it as the description.
- No argument and context is clear → write it from context.
- No argument and no context → plain `[skip ci] push without deploy`.

Good:
```
[skip ci] refactor wishlist popup state handling
[skip ci] update branch with master (no deploy)
[skip ci] remove dead code in customer export
```

Bad: `[skip-ci] fix` (wrong token, useless description).

## Step 5 — Commit and push

```bash
git commit --allow-empty -m "[skip ci] <description>"
git push origin "$BRANCH"
```

If the push is rejected as non-fast-forward, **do not force**. Report it and
suggest `git pull --rebase origin "$BRANCH"` then re-run the push — the user
decides.

## Step 6 — Report

Short, factual:

```
✅ Pushed to origin/<branch> without triggering CI

  commit  <short-hash>  [skip ci] <description>
  branch  <branch>
  skip    [skip ci] — honored by <.gitlab-ci.yml default | custom rule at line N>
```

If Step 1 flagged that the skip might not hold (workflow rules, MR pipelines,
scheduled triggers), repeat that caveat here — don't let the ✅ imply a guarantee
the config didn't give.

## Sibling skill

Need the opposite — an empty commit specifically **to** make the pipeline run and
redeploy a branch? That's `/trigger-deploy`.
