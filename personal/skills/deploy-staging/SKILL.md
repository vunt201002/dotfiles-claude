---
name: deploy-staging
description: Cross-project skill to deploy the current branch to a numbered GitLab staging slot. Reads the repo's .gitlab-ci.yml, finds every job belonging to the requested staging number, rewrites that job's branch ref (under only/only.refs/rules) to the current branch, commits .gitlab-ci.yml with message "deploy: staging <N>", and pushes the current branch so the staging pipeline runs. Built for the avada/joy and avada/wishlist repos but detects the staging layout instead of hardcoding it. Use when asked to "deploy to staging N", "deploy staging 9", "đẩy lên staging", "set staging ref", or "/deploy-staging".
---

# /deploy-staging — Point a numbered staging at the current branch

You deploy the **current branch** to a numbered staging slot on GitLab CI. Staging
slots are limited and shared, so a deploy means: claim slot N by rewriting its jobs'
branch ref to your branch, commit that change, and push so the pipeline runs.

```
/deploy-staging <N>        # e.g. /deploy-staging 9  → deploys current branch to staging 9
```

GitLab CI runs a staging job only when a commit lands on the branch named in that
job's `only` / `rules` ref. This skill sets that ref to your current branch, then
pushes — that's what makes the deploy actually happen.

---

## HARD GATES

- **Only edit `.gitlab-ci.yml`.** This skill rewrites branch refs in that one file
  and nothing else. Never stage other files, never `git add -A`. If the working tree
  has unrelated changes, leave them dirty — the commit must contain `.gitlab-ci.yml`
  alone (Step 6 commits by path to guarantee this even if something else is staged).
- **Only touch the requested staging's jobs.** Never modify production jobs (`tags`,
  `master`, `main`, `name: production`) or jobs belonging to a different staging
  number. When unsure whether a job belongs to staging N, ask — don't guess.
- **Never touch `except:` / variable conditions.** Replace only the *branch ref*
  (the git-branch value under `only` / `only.refs` / `rules`). Leave
  `$CI_COMMIT_TITLE =~ ...`, `variables:`, `tags`, etc. exactly as they are.
- **Guard the source branch.** If the current branch is `main`/`master`/`production`
  or a base branch, STOP and confirm with the user — you almost never deploy those
  to a staging slot.
- **One branch holds at most ONE slot.** Before deploying to slot N, release every
  OTHER slot whose ref is already the current branch (Step 3.5). Skipping this is how
  one branch ends up occupying two slots: both slots' jobs match the same push.
- **Park a released slot on a ref that can never match.** Never hand it to `master`,
  `main`, or any real branch — that just delays the deploy until someone pushes that
  branch, and pointing a staging job at `master` deploys on every master commit. Use
  `parked/no-deploy` (a branch name that must not exist in the repo).
- **Show the plan before committing.** List every job you'll change and the
  old→new ref, show the diff, then commit + push.

---

## Step 0 — Parse args + get the current branch

The argument is the staging **number**. Accept a bare number (`9`) or a leading
"staging" word (`staging 9`) — extract the trailing integer either way. If no number
is given, ask which staging slot.

```bash
# Current branch — this is the value we write into every matched ref.
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
echo "BRANCH=$BRANCH"
# Refuse obviously-wrong source branches (confirm with user if matched).
case "$BRANCH" in
  main|master|production|develop|HEAD) echo "GUARD: '$BRANCH' looks like a base/prod branch — confirm before deploying it to staging." ;;
esac
# Working tree note (we'll commit only .gitlab-ci.yml regardless).
git status --short
```

Remember `BRANCH` and the staging number `N` for the steps below (bash vars don't
persist between blocks).

---

## Step 1 — Locate the CI file

```bash
ls -la .gitlab-ci.yml 2>/dev/null || echo "NO .gitlab-ci.yml at repo root"
```

If there's no `.gitlab-ci.yml` at the repo root, STOP and tell the user — this skill
needs it. (Don't go hunting for CI config in other formats; these two repos use
GitLab CI at the root.)

---

## Step 2 — Inventory EVERY staging slot, not just N

Read `.gitlab-ci.yml` and map **all** staging slots in the file: slot number → its
jobs → each job's current branch ref. You need the whole picture, not only slot N —
Step 3.5 uses it to find slots your branch is already squatting on.

Identify jobs by staging number. The two target repos use different naming
conventions, so **detect, don't hardcode**:

**Primary signal — `environment.name`:**
- Staging **1** → `name: staging` (joy) or `name: staging1` (wishlist).
- Staging **N ≥ 2** → `name: staging_N` (joy) or `name: stagingN` / `name: staging-N`.
- Match any of these shapes for the number N: `staging`, `stagingN`, `staging_N`,
  `staging-N` (and for N=1 also bare `staging`/`staging1`).

**Secondary signal — job name** (use to corroborate / catch jobs without an
`environment` block):
- joy: `deploy_staging` (N=1), `deploy_staging_N`, plus the `_only`,
  `_only_hosting`, `_only_functions` variants, and `deploy-shopify-extension:stagingN`.
- wishlist: `deploy-firebase:staging`.

Helpful greps (adjust N):

```bash
# All job headers + their environment names, with line numbers.
grep -nE '^[A-Za-z0-9_.:-]+:[[:space:]]*$|name:[[:space:]]*staging' .gitlab-ci.yml
```

Then **read the actual job blocks** for the candidates to confirm membership and to
find each branch ref. Do not rely on grep alone — open the YAML and verify each job's
`environment.name` matches staging N before you touch it.

Collect the full set: for staging N, you want **every** job in that environment
(main deploy + all `_only*` variants + the shopify-extension job, per the user's
"all jobs of that staging" rule). Do the same pass for the other slots — you only
need their refs, so a lighter read is fine, but every slot must appear in the
inventory or Step 3.5 can't see a leak.

---

## Step 3 — Find each job's branch ref

Within each matched job, the branch ref appears in one of these shapes. Replace the
**branch value(s)** with `BRANCH`; touch nothing else:

1. **Direct `only` list:**
   ```yaml
   only:
     - integration/intercom        # ← replace this branch with BRANCH
   except:
     variables: [...]              # ← leave untouched
   ```
   The branch is the bare list item that is a git-branch name. Items like `tags`,
   `master`, `main`, or anything starting with `$` are NOT branch refs — skip them.

2. **`only.refs` list:**
   ```yaml
   only:
     refs:
       - feature/chat-window-thinking-ui   # ← replace with BRANCH
     variables:
       - $CI_COMMIT_TITLE =~ /.../          # ← leave untouched
   ```

3. **`rules` form** (if present):
   ```yaml
   rules:
     - if: '$CI_COMMIT_REF_NAME == "some-branch"'   # ← replace the branch literal only
   ```

A job usually has exactly one branch ref line. List, for each job: the job name, the
ref line number, and the current value.

---

## Step 3.5 — Release slots your branch already holds

A staging job runs whenever a commit lands on the branch in its ref. So if slot 9 is
still pointed at your branch and you now claim slot 5, the single push at Step 6 fires
**both** — your branch silently occupies two shared slots, and whoever needed slot 9
finds it busy.

Using the Step 2 inventory, list every slot **other than N** whose ref equals the
current branch. Each one gets re-pointed to the parked ref:

```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD)
# Every ref line in the file that names the current branch — the target slot's jobs
# will be in here too; exclude those, the rest are leaks to release.
grep -nF -- "$BRANCH" .gitlab-ci.yml
```

Map each hit back to its owning job (walk up to the nearest job header) and then to
its slot number, exactly as in Step 2. Do not classify on the grep line alone — the
branch name can also appear in a comment or a variable.

**Park them on `parked/no-deploy`.** GitLab runs the job only when a commit lands on
the named branch, so a branch name that doesn't exist in the repo can never fire it.
That is the whole point: the slot must stop deploying, not deploy later.

- **Never park on a real branch.** `master`/`main` turns the slot into a
  deploy-on-every-master-commit job. Another dev's branch hands them a slot they
  didn't ask for and re-triggers on their next push.
- **Confirm the parked ref really doesn't exist** before writing it:
  ```bash
  git ls-remote --heads origin 'parked/no-deploy'   # expect NO output
  ```
  If it does exist, pick another obviously-dead name and say which one you used.
- **Releasing needs no extra confirmation.** By definition the slot is pointed at
  *your own* branch, so releasing it can't disturb anyone else's deploy. Show it in
  the Step 4 plan and the Step 7 report; don't stop to ask.
- **Nothing to release is the normal case.** Say so in one line and move on.

If the user wants the slot handed back to whoever had it before instead of parked,
the old ref is recoverable — `git log -p -- .gitlab-ci.yml` shows the commit where
this skill claimed it. That's a manual call, not the default: a stale branch restored
into a live slot starts deploying again on its next push.

---

## Step 4 — Show the plan (confirmation gate)

Before editing, show the user exactly what will change:

```
DEPLOY PLAN — staging 5 → branch "<BRANCH>"
────────────────────────────────
CLAIM staging 5 (M jobs):
  deploy_staging_5                  intercom/old-ref      → <BRANCH>
  deploy_staging_5_only             old-ref               → <BRANCH>
  deploy_staging_5_only_hosting     old-ref               → <BRANCH>
  deploy_staging_5_only_functions   old-ref               → <BRANCH>
  deploy-shopify-extension:staging5 old-ref               → <BRANCH>

RELEASE staging 9 — still held by this branch (2 jobs):
  deploy_staging_9                  <BRANCH>              → parked/no-deploy
  deploy-shopify-extension:staging9 <BRANCH>              → parked/no-deploy
────────────────────────────────
Then: commit ".gitlab-ci.yml" as "deploy: staging 5" and push origin <BRANCH>.
```

Drop the RELEASE block entirely when there's nothing to release (the normal case) —
print `No other slot held by this branch.` instead.

If the source-branch guard tripped (Step 0) or you weren't able to confidently map
all jobs, ask the user to confirm before proceeding. Otherwise this plan is a heads-up
and you may continue.

---

## Step 5 — Edit the refs

For each ref, use the Edit tool. **Make each edit uniquely anchored.** The same branch
string can appear on several identical ref lines (e.g. three `_only*` jobs share a
ref), and a bare `    - old-branch` line is not unique. To avoid wrong/over-broad
replacements:

- Anchor each Edit on a span that includes the **unique job name header** (job names
  are unique) down through its ref line, so the match is unambiguous. Example
  old_string:
  ```
  deploy_staging_9_only:
    stage: deploy
    only:
      refs:
        - old-branch
  ```
  new_string: same block with `old-branch` → `<BRANCH>`.
- Only use `replace_all` when you've confirmed the old ref string appears **only**
  inside staging N's jobs and every occurrence should change.

Never replace a ref that lives in a production job.

**Release edits are the same shape, opposite direction** — anchor on the released
job's unique header down through its ref line, and write `parked/no-deploy` in place
of the current branch. Watch the ordering trap: after Step 5 the current branch
appears in slot N's jobs too, so a `replace_all` on the branch string would park the
slot you just claimed. Anchor every release edit on its own job header, or do all
releases **before** claiming N so the only occurrences of the branch are the leaks.

---

## Step 6 — Verify, commit, push

```bash
git diff -- .gitlab-ci.yml
```

Confirm the diff shows ONLY branch-ref changes — inside staging N's jobs, plus the
released slots' jobs if Step 3.5 found any (no variable conditions, no unrelated jobs,
no other files). Two specific things to check before committing:

- The current branch now appears **only** under slot N's jobs. Any other slot still
  naming it means a release was missed and the push will occupy two slots.
- No released job got `master`/`main` or a real branch instead of the parked ref.

If anything extra changed, fix it before committing.

Then commit **only** the CI file and push the current branch to trigger the pipeline.
Pass the path straight to `git commit` so the commit captures `.gitlab-ci.yml` and
nothing else — even if other files happen to be staged already, they stay out:

```bash
# Belt-and-suspenders: unstage anything that may already be staged, so the
# commit can only contain .gitlab-ci.yml.
git reset -q                                    # clears the index; working tree untouched
git commit .gitlab-ci.yml -m "deploy: staging N"  # commits ONLY this path, exact message
git push origin "$(git rev-parse --abbrev-ref HEAD)"
```

Why `git commit <path>` instead of `git add` + bare `git commit`: a bare commit
captures the **whole** staging area, so any pre-staged unrelated file would ride
along. Naming the path commits only that file's changes, regardless of index state.
The `git reset -q` first makes doubly sure nothing else is staged. Never `git add -A`.

The commit message is literally `deploy: staging <N>` — no scope, no body, matching
the example `deploy: staging 9`.

Before committing, sanity-check that only the intended file is in play:

```bash
git status --short    # expect just " M .gitlab-ci.yml" (other dirty files stay dirty)
```

---

## Step 7 — Report

```
DEPLOYED — staging 5
────────────────────────────────
Branch:   <BRANCH>
Jobs:     M refs pointed at <BRANCH>
Released: staging 9 → parked/no-deploy (was held by this branch)
Commit:   <hash> deploy: staging 5
Push:     origin/<BRANCH> ✓ — pipeline runs staging 5 only
────────────────────────────────
```

Omit the `Released:` line when nothing was released. When something was, say so
plainly — the user needs to know slot 9 stopped deploying, especially if they had a
tab open on it.

Point the user at their GitLab pipelines page to watch it run. If the push was
rejected (non-fast-forward), report it — don't force-push; the user decides.

---

## Why this design

- **Detect the staging layout, don't hardcode it.** joy uses `staging_2`, wishlist
  uses `staging1`; the same skill serves both by matching on `environment.name` plus
  job-name shape. A third repo with a slightly different convention still works as
  long as the number is discoverable.
- **All jobs of the slot move together.** A staging slot is one environment; leaving
  one of its jobs pointed at an old branch would deploy a mismatched mix. Sync them
  all to the current branch.
- **Ref-only edits.** The `except`/`variables` conditions encode deploy-mode logic
  (`[deploy-only]`, hosting vs functions). They're orthogonal to which branch deploys,
  so this skill never touches them.
- **Commit + push is the deploy.** The CI ref change is inert until pushed; pushing
  the branch is what makes GitLab run the staging job.
- **A branch holds one slot, and moving is a move — not a copy.** Claiming a slot
  doesn't release the last one, and the ref left behind isn't dormant: it matches the
  very same push. Two slots burn on one branch, and the leak only shows up when a
  teammate finds a slot busy for a deploy nobody meant to run. Releasing belongs in
  the same commit as the claim, so the file never describes a state we didn't intend.
- **Parked, not reassigned.** "Point it at some other branch" reads like it solves
  this, but any *real* branch just moves the unwanted deploy to whenever that branch
  is next pushed — and `master` would fire on every commit to master. A ref that
  matches no existing branch is the only value that actually means "this slot is
  idle".
