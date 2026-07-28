---
name: trigger-deploy
description: Re-run a branch's CI pipeline by pushing one empty commit — nothing else. Use when a branch is ALREADY configured to deploy (its staging ref is set, the CI rules already match it) and you just need a fresh commit so the pipeline fires again — a flaky/cancelled pipeline, a re-deploy to staging after someone else's push, a redeploy with no code change. Detects the branch's configured staging slot from .gitlab-ci.yml and reports which pipeline is about to run, warns if the branch matches NO deploy job (nothing would happen), refuses to push on master/main, and reports the branch + commit hash. NOT for setting up the staging ref in the first place (use /deploy-staging — it rewrites .gitlab-ci.yml branch refs; this skill never edits any file). NOT for cutting a release tag (use /deploy-tag). NOT for skipping CI (use /skip-ci — the exact opposite). Use when asked to "trigger deploy", "deploy lại", "chạy lại pipeline", "empty commit để deploy", "re-deploy branch này", "kích pipeline", "/trigger-deploy", or when a staging deploy needs re-running with no code change.
---

# /trigger-deploy — Empty commit to re-fire the pipeline

The branch is already wired up to deploy. Its staging ref is set, CI rules
already match it, code is where it should be — the pipeline just needs a new
commit to fire. This skill pushes exactly one empty commit and nothing else.

Typical reasons: the last pipeline was cancelled or flaked, someone re-pointed a
staging slot, or a redeploy is needed with no code change.

## What this skill does NOT do

- **Does not edit any file** — not `.gitlab-ci.yml`, not anything. If the branch
  isn't configured to deploy yet, this skill won't make it deploy. That's
  `/deploy-staging`.
- **Does not add deploy markers** by default. The commit is plain, so the branch's
  normal pipeline runs under its existing rules. Marker tokens like
  `[deploy-only]` / `[deploy-extensions]` **narrow** what deploys and are a
  different intent — this skill only adds one if the user explicitly asks.

## HARD GATES

- **Empty commit only.** Always `--allow-empty`, nothing staged. Never `git add`,
  never `git add .`, never `git add -A`. Dirty tree → Step 2 stops and asks.
- **Never push to `master` / `main`.** Deploying the base branch is a release, not
  a re-trigger — Step 3 aborts.
- **Never force-push, never amend.** One new commit on top, plain `git push`.
- **Never write `[skip ci]`** — that would defeat the whole purpose. Also refuse to
  proceed if the *user's* supplied message contains a skip token; point out the
  contradiction and ask.
- **One commit per invocation.** If the pipeline still doesn't run, diagnose —
  don't spam empty commits.

---

## Step 1 — Read the branch and confirm it actually deploys

```bash
git rev-parse --abbrev-ref HEAD
git status --porcelain
git log --oneline -5
```

Then check the branch is wired into a deploy job. In GitLab repos the branch ref
appears under `only` / `only.refs` / `rules` of the staging jobs:

```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD)
grep -n -F "$BRANCH" .gitlab-ci.yml 2>/dev/null | head -20
```

Read the surrounding job names to find which staging slot it maps to (jobs are
usually named like `deploy_staging_9`, `build-staging-3`, or grouped under a
`staging N` stage). Report the slot in Step 5.

**If the branch appears nowhere in the CI config**, the empty commit will very
likely do nothing. Stop and tell the user:

> Branch `<branch>` doesn't appear in `.gitlab-ci.yml` — no deploy job matches it,
> so an empty commit would push but deploy nothing. Want `/deploy-staging <N>` to
> point a slot at this branch first?

Only continue past this if they explicitly say to push anyway.

Also check the branch history for a previously used slot — useful context when
the config scan is ambiguous:

```bash
git log --oneline -50 | grep -iE "staging|deploy" | head -10
```

## Step 2 — Handle a dirty working tree

If `git status --porcelain` is empty → Step 3.

If dirty, **stop and ask**. This is important here specifically: the user may
believe they're deploying changes that are in fact still uncommitted, so the
pipeline would build the old code. Show what's dirty and offer:

1. **Commit the changes first** (`/my-commit`), then push those — no empty commit
   needed at all, since a real commit already triggers the pipeline.
2. **Proceed with the empty commit anyway**, understanding the dirty files will
   NOT be deployed.

Never pick for them. Option 1 is usually what they meant — say so.

## Step 3 — Guard the branch

```bash
git symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null | sed 's#.*/##'
```

If the current branch is `master`, `main`, or the detected base branch → **abort**.
Re-deploying the base branch is a production release; that path is `/deploy-tag`,
not an empty commit.

Detached HEAD → abort.

## Step 4 — Build the message and push

Default message, plain and marker-free:

```bash
git commit --allow-empty -m "chore: trigger deploy"
git push origin "$BRANCH"
```

Variations:

- **Argument given** (`/trigger-deploy re-run staging 9`) → use it as the
  description: `chore: trigger deploy — re-run staging 9`.
- **Slot known from Step 1** → include it: `chore: trigger deploy staging 9`.
- **User explicitly asks for a deploy marker** ("chỉ deploy hosting thôi") → then
  and only then use the repo's own marker syntax as read from its CI config, e.g.
  title `[deploy-only] trigger deploy` with the matching description body the
  rules require. Read the actual rule before writing the token — do not guess it
  from memory.

Non-fast-forward rejection → **do not force**. Report it, suggest
`git pull --rebase origin "$BRANCH"` then re-push, let the user decide.

## Step 5 — Report

```
✅ Pushed empty commit to origin/<branch> — pipeline should fire

  commit   <short-hash>  chore: trigger deploy
  branch   <branch>
  deploys  <staging slot / job names matched at .gitlab-ci.yml:N>
```

If Step 1 couldn't confirm a matching deploy job but the user chose to push
anyway, say that plainly instead of the ✅ line — the commit landed, but whether
anything deploys is unverified.

Don't claim the deploy succeeded. This skill only guarantees the commit was
pushed; the pipeline result is in GitLab.

## Sibling skills

- `/deploy-staging <N>` — actually point staging slot N at this branch (edits CI config).
- `/skip-ci` — the opposite: push without firing any pipeline.
- `/deploy-tag` — cut a release tag after an MR merges to master.
