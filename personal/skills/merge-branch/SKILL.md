---
name: merge-branch
description: Cross-project skill to assemble many feature branches into one merge branch for shared-staging testing. From any branch, it detects the repo's true main branch, checks it out, pulls latest, creates a fresh merge branch (default merge/task-DD-MM-YYYY), then merges each requested branch from remote (origin) one at a time — every branch becomes exactly one commit. On conflict it stops, resolves carefully in context, reports what it did, commits, then continues to the next branch. As the final step it asks for a staging number and hands off to /deploy-staging to push and deploy (nothing is pushed before that question). Use when asked to "merge these branches", "gộp các nhánh để test", "merge-branch", "combine branches for staging", or "build a merge branch".
---

# /merge-branch — Assemble feature branches into one merge branch

You combine several feature branches into a single **merge branch** so they can all
be tested together in one shared staging slot (staging is limited). The user runs:

```
/merge-branch [branch-a, branch-b]              # name defaults to merge/task-DD-MM-YYYY
/merge-branch <merge-name> [branch-a, branch-b] # explicit merge branch name
```

The list of branches to merge is grouped inside `[ ... ]`, comma-separated. An
optional merge branch name may appear **before** the `[`. The default name uses
today's date in `DD-MM-YYYY`, e.g. on 2026-06-15 the default is `merge/task-15-06-2026`.

**Each merged branch becomes exactly one commit** (a `--no-ff` merge commit), so the
history reads cleanly: one merge commit per branch, in the order requested.

---

## HARD GATES

- **Working tree must be clean before starting.** If `git status --porcelain` shows
  any changes, STOP and tell the user to commit/stash first. Never merge on top of a
  dirty tree.
- **The merge assembly never pushes on its own.** Building the merge branch is purely
  local. The only push happens in the final deploy step (Step 7), and only after the
  user gives a staging number — pushing is delegated to `/deploy-staging`, never done
  directly here.
- **Always merge from remote.** Every branch in the list is merged from
  `origin/<branch>` after a fresh fetch — never from a possibly-stale local branch.
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

## Step 3 — Create the merge branch

Create a fresh branch off the just-updated main. Substitute the chosen name for
`<merge-name>`:

```bash
# If the merge branch already exists locally, this fails loudly — that's intended.
git checkout -b <merge-name>
```

If it already exists, ask the user (AskUserQuestion): (A) delete and recreate it
fresh off main, (B) pick a different name. Only delete with explicit consent:
`git branch -D <merge-name>` then recreate.

---

## Step 4 — Merge each branch, one at a time

First validate every requested branch exists on remote (after the Step 2 fetch):

```bash
# For each NAME in the list:
git show-ref --verify --quiet "refs/remotes/origin/<NAME>" && echo "OK <NAME>" || echo "MISSING <NAME>"
```

If any are `MISSING`, stop and report which — don't start merging a partial set
without telling the user. Ask whether to proceed with the ones that exist or fix the
names first.

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
Branch:  <merge-name>
Merged:  N branches, in order
────────────────────────────────
  ✓ branch-a    clean
  ✓ branch-b    conflict resolved (2 files: routes.ts, config.json)
────────────────────────────────
Local only, not pushed yet. Next: pick a staging slot to deploy to.
```

Show `git log --oneline <main>..HEAD` so the user sees exactly one commit per branch.
Remind them the branch is local-only and not pushed — pushing happens in Step 7.

---

## Step 7 — Deploy to a staging slot (asks first, then hands off)

The whole point of the merge branch is to test everything in one shared staging slot.
So the final step deploys it — but **never push without asking which slot first**.

1. **Ask the user for the staging number** (AskUserQuestion). This is required before
   anything is pushed. Offer:
   - A number (the staging slot to claim, e.g. `9`).
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

- **Remote-sourced merges** guarantee the staging build reflects what's actually on
  origin, not a teammate's stale local copy.
- **`--no-ff` everywhere** makes the history legible: one merge commit per branch,
  trivially revertable if one branch turns out to break staging.
- **Resolve-then-continue** keeps the whole assembly in one pass — the point is to get
  every branch into one slot, so stopping dead on the first conflict would defeat it.
  But unconfident conflicts still escalate to the user; correctness over speed.
- **Deploy is a handoff, gated on a question.** Assembling the branch and deploying it
  are one workflow (build a slot, test it), so Step 7 chains into `/deploy-staging`
  rather than leaving the user to remember it. But the push only happens after the user
  names a staging slot — no silent deploy. The CI-ref logic lives in `/deploy-staging`,
  not duplicated here.
