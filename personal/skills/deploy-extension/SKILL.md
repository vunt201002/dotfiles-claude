---
name: deploy-extension
description: Deploy Shopify app extensions by PRINTING the git commands that trigger the CI extension-deploy job — never runs them. Master-only, so it checks you're on master, that master is current with origin, and reads the trigger marker out of the repo's own .gitlab-ci.yml instead of assuming it. NOT /deploy-tag (cuts a release tag after a merge), NOT /deploy-staging (rewrites staging branch refs), NOT /skip-ci (pushes WITHOUT a pipeline — this one's whole job is to start one). Use when asked "deploy extension", "deploy extensions", "đẩy extension lên", "deploy theme extension", "/deploy-extension", or after extension changes land on master.
---

# /deploy-extension — Deploy Shopify extensions (you run the commands)

Extensions don't deploy from your machine. CI does it, and CI only wakes up when a
commit whose **title** carries a marker lands on `master`. This skill does the read-only
prep — find the marker in the repo's own CI config, check you're on master, check master
is current — then hands you the commands to run yourself.

```
/deploy-extension        # → prep + give me the commands
```

The skill stops at "here are your commands." It does not commit, does not push, does not
checkout. You keep every git-mutating step.

---

## HARD GATES

- **The skill runs NOTHING mutating.** Only `fetch`, `status`, `rev-parse`, `rev-list`,
  `log`, `branch`, and reading `.gitlab-ci.yml`. Every `checkout` / `pull` / `commit` /
  `push` is printed for the user. This holds even if the user seems in a hurry — see
  Step 5 for the one narrow exception.
- **Never `git add .` or `git add -A`.** Stage explicit paths, always.
- **Read the marker from the repo's CI, never assume it.** The literal string lives in
  `.gitlab-ci.yml` as `$CI_COMMIT_TITLE =~ /\[...\]/`. If it was renamed and this skill
  hardcoded the old one, every command it prints would be a silent no-op.
- **Master only.** If the CI job's `only.refs` doesn't list `master`, STOP and report what
  it actually lists — don't print commands for a branch CI ignores.
- **The marker goes in the commit TITLE, never the body.** `$CI_COMMIT_TITLE` is the first
  line only. A marker on line 3 looks right to a human and is invisible to CI.
- **Diverged master → STOP.** If local `master` is both ahead of and behind
  `origin/master`, report it and stop. Don't propose a merge, a rebase, or a reset; the
  user decides how to reconcile.
- **Off master with uncommitted `extensions/` changes → STOP and ask.** Checking out
  master would carry that work across and the next command would commit it to master.
  Ask before building any command for that state.
- **Say the word production.** The job that runs on master deploys to the production
  Shopify app. The printed block states that plainly.

---

## Step 0 — Find the extension deploy job in this repo

Extensions deploy from a CI job, so the job is the source of truth for both the trigger
marker and the branch it listens on. Read them; don't carry them in your head.

```bash
git rev-parse --show-toplevel
awk '
  /^deploy-shopify-extension/ { job=$0; inblock=1; show=0; next }
  inblock && /^[^[:space:]#]/ { inblock=0; show=0 }
  inblock && /^  only:/ { show=1; print "── " job; print "   " $0; next }
  show && /^  [a-zA-Z]/ { show=0 }
  show { print "   " $0 }
' .gitlab-ci.yml
grep -nA3 '^deploy-shopify-extension' .gitlab-ci.yml | grep -E 'environment|name:'
```

**Scope the read to the job blocks — do not grep the whole file for the marker.** These
CI files carry a different marker, `[deploy-only]`, on well over a hundred lines for the
staging/hosting jobs. A file-wide grep buries the two `[deploy-extensions]` lines in that
noise, and picking the wrong one produces a commit that triggers nothing. The awk above
prints only each extension job's `only:` block, verbatim.

Read that output and establish three things:

1. **The marker literal** — from `/\[deploy-extensions\]/` under `variables:`, the actual
   title substring is `[deploy-extensions]`. Strip the regex escaping; keep the brackets.
2. **Which job lists `master` under `refs:`** — that's the production job and the only one
   this skill targets. Note that `refs:` and `variables:` are *separate* keys: GitLab ANDs
   them, so the branch and the marker must both be right or nothing runs.
3. **Its `environment: name`** — usually `production`. It goes in the printed block.

A sibling job on some other branch (a rotating staging ref, rewritten by `/deploy-staging`)
is normal and not this skill's target. Ignore it.

If `.gitlab-ci.yml` has **no** job in the `deploy-shopify-extension` stage, stop here and
say so: this repo doesn't deploy extensions through CI, and this skill has nothing to
offer. Don't invent a command.

If a job exists but `master` is not among its `only.refs`, stop and report which branches
are listed. A marker commit on master would do nothing.

---

## Step 1 — Where you are, and what's uncommitted

```bash
git rev-parse --abbrev-ref HEAD
git status --short
git status --short -- extensions/
```

Three states matter, and they combine:

- **On master** — good, no checkout line needed.
- **Off master, nothing uncommitted under `extensions/`** — the block leads with
  `git checkout master`.
- **Off master, something uncommitted under `extensions/`** — STOP. Show those files and
  ask what they're for: carrying them onto master and committing them there is almost
  never what the user meant. Only continue once they've said what they want.

Also note any unrelated dirty files. They don't block anything (nothing gets staged
except explicit paths) but a checkout can fail on them — mention it if `git checkout`
is going in the block.

---

## Step 2 — Is master current with origin?

Fetch is read-only and safe to run. Comparing refs directly means this works even while
the user stands on another branch — no checkout needed to answer the question.

```bash
git fetch origin master
echo "behind: $(git rev-list --count master..origin/master)"
echo "ahead:  $(git rev-list --count origin/master..master)"
```

Four outcomes:

1. **behind 0, ahead 0** — current. No pull line in the block.
2. **behind N, ahead 0** — master is stale. The block includes
   `git pull --ff-only origin master` before the commit, and says how many commits behind.
   `--ff-only` is deliberate: it fails loudly rather than inventing a merge commit.
3. **behind 0, ahead N** — master has local commits not on origin. Say so in the block;
   the push will carry them too. Worth one line so it isn't a surprise.
4. **behind N, ahead M (both non-zero)** — diverged. STOP. Report both numbers and let
   the user reconcile. Print no commands.

---

## Step 3 — Decide the commit shape

Driven by whether anything under `extensions/` is uncommitted (Step 1), on master.

**Changes present** — stage those explicit paths and commit them with the marker:

```
git add extensions/<dir> [extensions/<dir> ...]
git commit -m "<type>(ext): <what changed> [deploy-extensions]"
```

List the real directories seen in Step 1. Never a bare `git add .`.

**Nothing to commit** — an empty commit carries the marker and nothing else:

```
git commit --allow-empty -m "chore: redeploy extensions [deploy-extensions]"
```

Message rules, both shapes:

- **Marker at the end of the first line.** Title only.
- **English.** The commit lands on master and gets read from `git log` by whoever is
  bisecting later. Restate a Vietnamese task description; don't paste it through.
- **No MR or issue numbers** — same reasoning as `/deploy-tag`: `!482` resolves only
  inside GitLab's UI and means nothing in `git log`.
- **Describe what changed, when that's known from this session.** If the session doesn't
  actually say, fall back to the plain redeploy message rather than inventing one.

---

## Step 4 — Print the block (this is the deliverable)

One compact block, English. Include only the steps that this state actually needs.

Already on an up-to-date master, with extension changes to commit:

```
DEPLOY EXTENSIONS — joy · master @ 3e34d390 "Merge branch 'improvement/...'"
────────────────────────────────
CI job:     deploy-shopify-extension:production   (environment: production)
Trigger:    commit title must contain [deploy-extensions]
Branch:     master — you are here
Master:     up to date with origin/master
Changes:    2 dirs under extensions/

Run these:
  git add extensions/theme-extension extensions/redeem-checkout-extension
  git commit -m "feat(ext): add redeem CTA to loyalty hub [deploy-extensions]"
  git push origin master
────────────────────────────────
This deploys to PRODUCTION.
```

Off master, master behind, nothing to commit:

```
DEPLOY EXTENSIONS — joy · master @ 3e34d390 "Merge branch 'improvement/...'"
────────────────────────────────
CI job:     deploy-shopify-extension:production   (environment: production)
Trigger:    commit title must contain [deploy-extensions]
Branch:     you are on feature/loyalty-hub-tweak — needs checkout
Master:     4 commits behind origin/master — needs pull
Changes:    nothing under extensions/ — empty commit will carry the marker

Run these:
  git checkout master
  git pull --ff-only origin master
  git commit --allow-empty -m "chore: redeploy extensions [deploy-extensions]"
  git push origin master
────────────────────────────────
This deploys to PRODUCTION.
```

Filling it in:

- Every line above the commands is a **fact read in Steps 0-2**, not a guess. If something
  couldn't be read, say so on that line instead of leaving a plausible-looking value.
- Keep it to the one block. No essay unless asked.
- Before printing, re-read it once: any Vietnamese, any `!NNN` / `#NNN`, any marker sitting
  somewhere other than the end of the commit title means rewrite it.

---

## Step 5 — Hand off

State plainly: nothing has been committed or pushed, and CI starts only once that commit
lands on master. Point at the repo's GitLab pipelines page so the user can watch the
`deploy-shopify-extension` job run.

Run the commands **only if the user explicitly asks** ("chạy luôn đi", "push hộ anh").
Even then: echo each command before running it, run them in order, and stop at the first
failure instead of pushing through. The default is hands-off.

---

## Why this design

- **The CI file owns the marker.** `[deploy-extensions]` is a string in someone's YAML,
  not a law. Reading it each run means a rename shows up as a different printed command
  instead of a deploy that silently never happens.
- **The silent no-op is the real hazard.** A marker commit pushed to the wrong branch, or
  with the marker in the message body, produces no pipeline and no error — the user waits
  for a deploy that was never queued. Most of Steps 0-2 exist to catch exactly that before
  a command is printed.
- **Commands, not actions.** This pushes straight to master and deploys extensions to the
  production Shopify app. It's a deliberate act with a blast radius, so the human keeps the
  trigger; the skill removes the remembering, not the control.
- **Read-only means read-only.** `fetch` and `rev-list` answer "is master current?" without
  touching the working tree, so the skill can report accurately from whatever branch the
  user happens to be standing on.
- **Stop instead of guessing.** Diverged master, no CI job, master missing from `only.refs`,
  uncommitted extension work on another branch — each is a state where any command this
  skill could print might be wrong. A question costs a minute; a wrong production deploy
  costs more.
