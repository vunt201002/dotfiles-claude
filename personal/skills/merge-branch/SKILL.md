---
name: merge-branch
description: Assemble several feature branches into ONE merge branch for shared-staging testing — brings each branch up to date with main first (confirms before pushing them back), then folds each into merge/task-DD-MM-YYYY as a single commit, stopping to resolve conflicts carefully. Re-running folds newly-listed branches into the existing merge branch. Hands off to /deploy-staging at the end. NOT for merging master into your own branch — that's /merge-master. Use when asked "merge these branches", "gộp các nhánh để test", "combine branches for staging", "build a merge branch", "/merge-branch".
---

# /merge-branch — Assemble feature branches into one merge branch

You combine several feature branches into a single **merge branch** so they can all
be tested together in one shared staging slot (staging is limited). The user runs:

```
/merge-branch [branch-a, branch-b]              # first run — name defaults to merge/task-DD-MM-YYYY
/merge-branch <merge-name> [branch-a, branch-b] # explicit merge branch name
/merge-branch <existing-name> [branch-a]        # second run — fold branch-a into an existing merge branch
```

The list of branches to merge is grouped inside `[ ... ]`, comma-separated. An
optional merge branch name may appear **before** the `[`. The default name uses
today's date in `DD-MM-YYYY`, e.g. on 2026-06-15 the default is `merge/task-15-06-2026`.

**Two flows, same command.** If the named merge branch doesn't exist yet, it's built
fresh (first run). If it already exists, you're re-using it (second run): the branches
you list this time are folded into the existing merge branch, branches merged earlier
are kept, and the deploy step re-uses the slot this merge branch last went to. Step 3
detects which case you're in and confirms before doing anything destructive.

**Each merged branch becomes exactly one commit** (a `--no-ff` merge commit), so the
history reads cleanly: one merge commit per branch, in the order requested.

**Before assembling, each feature branch is updated with main** (Step 2.5): main is
merged into branch-a, branch-b, ... so they're current and conflict less when combined.
Those updated branches are pushed back to remote, but only after you confirm — pushing
shared branches changes their PRs and teammates' work, so it's gated.

---

## HARD GATES

- **Working tree must be clean before starting.** If `git status --porcelain` shows
  any changes, STOP and tell the user to commit/stash first. Never merge on top of a
  dirty tree.
- **The merge-branch assembly itself never pushes.** Building the merge branch
  (Steps 3-6) is purely local. The merge branch is only pushed in the final deploy
  step (Step 7), after the user gives a staging number — delegated to
  `/deploy-staging`, never pushed directly here.
- **The only other push is the feature-branch update (Step 2.5), and it is gated.**
  Updating each feature branch with main and pushing it back changes shared branches
  on the remote, so it happens ONLY after an explicit confirmation listing exactly
  which branches will be pushed. Never force-push; a rejected push stops and reports.
- **Always merge from remote.** Every branch in the list is merged from
  `origin/<branch>` after a fresh fetch — never from a possibly-stale local branch.
  (Step 2.5 pushes the updated branches first precisely so this remote ref is current.)
- **One commit per branch.** Use `git merge --no-ff` so even fast-forwardable
  branches produce a distinct merge commit. On conflict, resolve then commit — still
  one commit for that branch.
- **Stop on the first hard failure.** If a branch doesn't exist on remote, or a
  conflict can't be resolved confidently, stop and report — don't silently skip.

---

## Step 0 — Parse the request

From the text after `/merge-branch`:

1. **Branch list** — the comma-separated names inside `[ ... ]`. Trim whitespace off
   each. This is required; if there's no `[ ]` or it's empty, ask the user which
   branches to merge.
2. **Merge branch name** — any token before the `[`. If absent, compute the default
   `merge/task-DD-MM-YYYY` from today's date.

```bash
# Compute the default merge branch name (today, DD-MM-YYYY).
DEFAULT_MERGE="merge/task-$(date +%d-%m-%Y)"
echo "DEFAULT_MERGE=$DEFAULT_MERGE"
```

Restate in prose: the chosen merge branch name, and the ordered list of branches to
merge. Order matters — merge in the order the user listed them.

---

## Step 1 — Detect the true main branch

Most repos have one main branch; some carry both `main` and `master`. Find the
**authoritative** default, don't guess:

```bash
# 1) origin's declared default branch — the authoritative answer.
MAIN=$(git symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')

# 2) If unset, ask the remote to populate it, then re-read.
if [ -z "$MAIN" ]; then
  git remote set-head origin -a >/dev/null 2>&1
  MAIN=$(git symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
fi

# 3) Fall back to GitHub's view of the default branch.
if [ -z "$MAIN" ]; then
  MAIN=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name 2>/dev/null)
fi

# 4) Last resort: prefer main, then master, among existing remote branches.
if [ -z "$MAIN" ]; then
  for c in main master; do
    git show-ref --verify --quiet "refs/remotes/origin/$c" && { MAIN="$c"; break; }
  done
fi

echo "MAIN=${MAIN:-UNKNOWN}"
echo "CURRENT=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
```

If `MAIN` is still `UNKNOWN`, stop and ask the user which branch is the main branch.

If **both** `origin/main` and `origin/master` exist, the symbolic-ref / `gh` result
above already tells you the real one — trust it, and mention in your summary that two
candidates existed and which you picked (and why).

Remember `MAIN` and the merge branch name for the next steps (bash vars don't persist
across blocks).

---

## Step 2 — Clean check, switch to main, pull latest

```bash
# Abort if the working tree is dirty.
if [ -n "$(git status --porcelain)" ]; then
  echo "DIRTY: working tree not clean — commit or stash first."
  git status --short
fi
```

If dirty, STOP (HARD GATE) and tell the user.

Otherwise check out the main branch (detected in Step 1) and pull latest from remote.
Substitute the real branch name for `<main>`:

```bash
git fetch origin --prune
git checkout <main>
git pull --ff-only origin <main>
```

If `git pull --ff-only` fails (local main diverged), stop and report — the user needs
to reconcile their local main first; don't force anything.

---

## Step 2.5 — Update each feature branch with main first (then push)

Before assembling the merge branch, bring **every feature branch up to date with
main**, so each one is tested against current main and produces fewer conflicts when
combined. For each branch in the list: check it out from remote, merge main into it,
resolve any conflicts, **add an empty `[skip ci]` commit so the branch's own deploy
pipeline doesn't fire**, and **push it back to remote** (the assembly in Step 4 merges
from `origin/<branch>`, so the update only counts once it's pushed).

**This step pushes to shared feature branches — that changes them on the remote**
(affecting their PRs and anyone else working on them). So it is gated: nothing is
pushed until the user confirms the list.

### 2.5a — Validate the whole list exists on remote (before touching anything)

```bash
# After the Step 2 fetch. For each NAME in the list:
git show-ref --verify --quiet "refs/remotes/origin/<NAME>" && echo "OK <NAME>" || echo "MISSING <NAME>"
```

If any are `MISSING`, STOP and report which — do not start updating a partial set.
Ask the user whether to proceed with the ones that exist or fix the names first.
(Validating up front means we never push half the branches and then hit a bad name.)

### 2.5b — For each branch, in the listed order

Substitute the real names for `<main>` and `<NAME>`:

```bash
git checkout -B <NAME> "origin/<NAME>"   # local <NAME> tracking the remote tip
git merge --no-ff <main> -m "merge: <main> into <NAME>"
```

Then check the result:

- **Already up to date** (merge says "Already up to date") → main is already in this
  branch. **Skip it — do not push** (an empty push is noise). Note `<NAME> — already
  current` for the report and move to the next branch.
- **Merged cleanly** (a merge commit was created) → add the skip-CI commit (below),
  then proceed to push (2.5c).
- **Conflict** → resolve it carefully, exactly the way Step 5 describes (list
  conflicts with `git diff --name-only --diff-filter=U`, understand both sides, keep
  both when independent, STOP and ask when a true incompatible conflict you're not
  confident about, stage **resolved files by name** — never `git add -A` — then
  `git commit --no-edit`). Then add the skip-CI commit (below) and proceed to push.

### 2.5b-skip — Add an empty `[skip ci]` commit (on every branch that got updated)

These feature branches must NOT trigger their own deploy pipeline — only the merge
branch gets deployed. So on each branch that actually received a merge (NOT the
"already current" ones), add an empty commit whose message tells GitLab CI to skip:

```bash
git commit --allow-empty -m "[skip ci] update branch with <main> (no deploy)"
```

- The commit changes nothing (`--allow-empty`); its only job is the `[skip ci]` token.
- **Exact token matters: `[skip ci]` or `[ci skip]`** (with a space) — GitLab only
  recognizes these. `[skip-ci]` (hyphen) does NOT work and the pipeline would still run.
- This commit is pushed together with the merge commit in 2.5c, so when the branch
  lands on the remote, GitLab sees `[skip ci]` on the tip commit and skips the pipeline.
- Skip this for "already current" branches — there's nothing being pushed for them.

Never start the next branch while the current one's merge/conflict is unresolved.

### 2.5c — Confirm, then push the updated branches

Updating a shared branch on the remote is outward-facing, so confirm before pushing.
After all branches are merged locally, show what will be pushed and ask
(AskUserQuestion):

```
UPDATE-MAIN PLAN — push these updated branches to origin?
────────────────────────────────
  branch-a   merged main (1 conflict resolved: routes.ts) + [skip ci]  → will push
  branch-b   already current                                            → skip (no push)
────────────────────────────────
Each pushed branch gets the merge commit + an empty [skip ci] commit, so its own
deploy pipeline won't run (only the merge branch deploys).
These pushes change the branches on the remote (their PRs, teammates' work).
```

- Offer: **A) Push the updated branches** / **B) Skip pushing — keep updates local
  only** (then Step 4 will merge stale remote refs, so warn it makes this step moot)
  / **C) Cancel**.
- On **A**, push each branch that actually changed (skip the "already current" ones),
  one at a time, without force:

  ```bash
  git push origin <NAME>          # plain push, never --force
  ```

  If a push is **rejected** (e.g. the remote branch moved under you), STOP and report
  that branch — do **not** force-push. The user decides how to reconcile.

Only after this step do we build the merge branch (Step 3).

---

## Step 3 — Create OR re-open the merge branch

First check whether the merge branch already exists (locally or on the remote):

```bash
git show-ref --verify --quiet "refs/heads/<merge-name>"        && echo "LOCAL exists"
git show-ref --verify --quiet "refs/remotes/origin/<merge-name>" && echo "REMOTE exists"
```

### Case 1 — it does NOT exist yet (first run for this merge branch)

Create a fresh branch off the just-updated main:

```bash
git checkout -b <merge-name>
```

Then go to Step 4 and merge the listed branches into it.

### Case 2 — it ALREADY exists (second+ run — re-using a merge branch)

This is the "I changed a branch and want it folded into the existing merge branch"
flow. Ask the user (AskUserQuestion) which they want:

```
Merge branch <merge-name> already exists (local/remote). What do you want?
A) Merge INTO it (default) — fold the branches you listed this run into the existing
   merge branch. Branches already merged before are kept as-is.
B) Recreate from scratch — delete it and rebuild off the latest main, re-merging
   everything from your list (use when you want a clean, fully-fresh merge branch).
C) Different name — use a new merge-branch name instead (the first-run flow).
```

- **A) Merge into it (default for a second run).** Check out the existing merge branch
  and bring it to the remote tip; do NOT recreate from main, do NOT delete anything:
  ```bash
  # Prefer the local branch if present; otherwise track the remote one.
  git checkout <merge-name> 2>/dev/null || git checkout -B <merge-name> "origin/<merge-name>"
  git pull --ff-only origin <merge-name> 2>/dev/null || true   # get latest if it's ahead on remote
  ```
  Then go to Step 4 and merge ONLY the branches in this run's list into it. Previously-
  merged branches stay (they're already in this branch's history) — you are adding, not
  rebuilding.
- **B) Recreate from scratch.** Only with explicit consent: `git branch -D <merge-name>`
  (and delete the remote one only if the user says so), then `git checkout -b <merge-name>`
  off the updated main, and Step 4 merges the full list again.
- **C) Different name.** Treat the new name as a first-run merge branch (Case 1).

---

## Step 4 — Merge each branch, one at a time

Existence on remote was already validated in Step 2.5a, so no need to re-check names.
But Step 2.5 just pushed updated branches, so refresh the remote refs first to be sure
you merge the **updated** `origin/<NAME>` (the one that now contains main), not a stale
cached ref:

```bash
git fetch origin --prune
```

Then, **in the listed order**, merge each branch from remote with `--no-ff`:

```bash
git merge --no-ff origin/<NAME> -m "merge: <NAME> into <merge-name>"
```

After each merge, check the result:

- **Exit 0, no conflict** → one merge commit created. Move to the next branch.
- **Conflict** → handle per Step 5, then continue to the next branch.

Never run the next branch's merge while a conflict is still unresolved.

---

## Step 5 — Resolve conflicts carefully (then continue)

When a merge stops with conflicts, do NOT hand it back — resolve it in context, the
way the user chose:

1. **List the conflicts:**

   ```bash
   git diff --name-only --diff-filter=U
   ```

2. **For each conflicted file:** read it, understand both sides (`<<<<<<<` = current
   merge branch / accumulated work, `>>>>>>>` = the incoming branch), and resolve by
   intent — usually keep BOTH changes when they're independent, choose the correct
   side when they truly conflict. Remove all conflict markers. When two sides edited
   the same logic in incompatible ways and you're not confident, STOP and ask the
   user rather than guessing.

3. **Stage and commit** — this is the one commit for this branch. Stage **only the
   files you just resolved** (the ones `--diff-filter=U` listed in step 1) — never
   `git add -A`, which would sweep in unrelated dirty files like tracked build
   artifacts (`browse/dist/`, `design/dist/`):

   ```bash
   # Stage exactly the conflicted files you resolved. Re-list them to be safe:
   git add $(git diff --name-only --diff-filter=U)
   # If a resolution required touching a file that wasn't in the conflict set,
   # add that one explicitly by name too — still never `-A`.
   git status --short        # sanity-check ONLY intended files are staged
   git commit --no-edit      # keeps the "merge: <NAME> ..." message
   ```

   `git diff --name-only --diff-filter=U` returns the unmerged paths; once you've
   removed the conflict markers and saved each, that same list is exactly what to
   stage. After staging, `git status --short` should show only those files as staged
   (`M`/`A`) — if anything unexpected is staged, `git restore --staged <file>` it.

4. **Report what you resolved**: for each file, one line on how you reconciled it
   (e.g. `routes.ts — kept both new routes`, `config.json — took incoming value for
   X`). The user must be able to audit your resolution.

Then continue with the next branch in the list.

> Staging rule (applies to every commit this skill makes): never `git add -A` /
> `git add .` — stage resolved files by name (see Step 5.3). Repos that track build
> artifacts get them swept in otherwise; in this gstack repo specifically, never
> stage `browse/dist/` or `design/dist/`.

---

## Step 6 — Final report

Summarize:

```
MERGE BRANCH READY
────────────────────────────────
Main:    <main>  (detected; note if both main/master existed)
Branch:  <merge-name>  (created fresh  |  re-used existing — folded in this run's branches)
Updated with main + pushed:  branch-a (1 conflict resolved) · branch-b skipped (already current)
Merged into merge branch:    N branches this run, in order
────────────────────────────────
  ✓ branch-a    clean
  ✓ branch-b    conflict resolved (2 files: routes.ts, config.json)
────────────────────────────────
Merge branch is local-only, not pushed yet. (Feature branches WERE pushed in Step 2.5.)
Next: pick a staging slot to deploy to.
```

State explicitly whether you **created the merge branch fresh** or **re-used an existing
one** (folding in only this run's branches). On a re-use, note that earlier-merged
branches remain part of the merge branch.

Show `git log --oneline <main>..HEAD` so the user sees exactly one commit per branch.
Remind them the branch is local-only and not pushed — pushing happens in Step 7.

---

## Step 7 — Deploy to a staging slot (asks first, then hands off)

The whole point of the merge branch is to test everything in one shared staging slot.
So the final step deploys it — but **never push without asking which slot first**.

**First, check if this merge branch was deployed before** (so a second run can re-use the
same slot). Read the most recent deploy commit from its history:

```bash
# Latest "deploy: staging N" on this merge branch (local, or remote if local lacks it).
git log --oneline -50 <merge-name> 2>/dev/null      | grep -m1 -iE 'deploy: staging [0-9]+' \
  || git log --oneline -50 origin/<merge-name> 2>/dev/null | grep -m1 -iE 'deploy: staging [0-9]+'
```

Extract the number (e.g. `staging 9` → `9`). This is the previously-used slot, if any.

1. **Ask the user for the staging number** (AskUserQuestion). This is required before
   anything is pushed.
   - **If a previous slot was found:** pre-fill it — "This merge branch last deployed to
     **staging {N}**. Re-deploy to {N}?" Offer: A) Yes, staging {N} / B) A different number
     / C) Skip. (Default A — the second-run case is usually "same slot again".)
   - **If none found (first deploy):** just ask which slot.
   - "Skip / I'll deploy later" — if chosen, stop here. The branch stays local; tell
     the user they can run `/deploy-staging <N>` themselves anytime.
2. **Hand off to `/deploy-staging <N>`** with the number the user gave, while still on
   the merge branch. That skill does the rest: rewrites the staging jobs' branch ref
   in `.gitlab-ci.yml` to this merge branch, commits `deploy: staging <N>`, and pushes
   the merge branch (which carries all the merge commits) to trigger the pipeline.

Do not reimplement the CI-ref editing or the push here — delegate to `/deploy-staging`
so there's a single source of truth for how a staging deploy works. The only thing
this step owns is **asking for the slot before any push happens**.

---

## Why this design

- **Update each feature branch with main first (Step 2.5).** A branch that's behind
  main gets tested against stale code and fights more conflicts when combined. Merging
  main into each branch up front means the staging build reflects how each branch
  behaves on *current* main, and the Step 4 assembly hits fewer conflicts. It's pushed
  back so the work persists on the real branch — but gated, because pushing a shared
  branch is outward-facing (PRs, teammates), never silent.
- **Empty `[skip ci]` commit on the updated feature branches.** Pushing the updated
  branch would otherwise trigger that branch's own deploy pipeline, but only the merge
  branch is meant to deploy. An empty commit carrying GitLab's `[skip ci]` token on the
  tip suppresses the pipeline without changing any code. (Token must be `[skip ci]` /
  `[ci skip]` with a space — the hyphenated form GitLab doesn't recognize.)
- **Remote-sourced merges** guarantee the staging build reflects what's actually on
  origin, not a teammate's stale local copy. (Step 2.5 pushes the updated branches
  first, so "remote" is current.)
- **`--no-ff` everywhere** makes the history legible: one merge commit per branch,
  trivially revertable if one branch turns out to break staging.
- **Resolve-then-continue** keeps the whole assembly in one pass — the point is to get
  every branch into one slot, so stopping dead on the first conflict would defeat it.
  But unconfident conflicts still escalate to the user; correctness over speed.
- **Re-using an existing merge branch (second run).** When you tweak one branch after the
  first assembly, you don't want to rebuild the whole slot — Step 3 folds the changed
  branch into the existing merge branch and keeps the rest. The previous deploy slot is
  recovered by reading the merge branch's own history (`deploy: staging N`) rather than a
  side file — git is the single source of truth, so it works across machines with no
  extra state to sync. Recreating-from-scratch stays available for when you want a clean
  rebuild off the latest main.
- **Deploy is a handoff, gated on a question.** Assembling the branch and deploying it
  are one workflow (build a slot, test it), so Step 7 chains into `/deploy-staging`
  rather than leaving the user to remember it. But the push only happens after the user
  names a staging slot — no silent deploy. The CI-ref logic lives in `/deploy-staging`,
  not duplicated here.
