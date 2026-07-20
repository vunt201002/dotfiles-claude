---
name: deploy-tag
description: Cross-project skill to cut the next deploy tag on a GitLab repo after an MR is merged. Checks out the base branch (master/main), pulls latest, fetches all tags, infers the tag pattern from the repo's own existing tags (never assumes a format), figures out the next tag in that same shape, and prints a short clear confirmation plus the exact `git tag` and `git push origin <tag>` commands for YOU to run. When the session has context on what branch/task/MR was just merged, the tag command's message names it; otherwise the tag stays plain (or message-less, if the repo's own tags are lightweight). It NEVER pushes anything to the base branch and NEVER runs the tag/push itself — it only hands you the commands. When the latest tags are inconsistent (mixed patterns / multiple version lines) it shows the top tags and asks which to base the next tag on instead of guessing. Use when asked to "deploy tag", "tag tiếp theo", "cut a release tag", "tạo tag deploy", "next deploy tag", "/deploy-tag", or right after merging an MR when you need to tag a release.
---

# /deploy-tag — Cut the next deploy tag (you run the commands)

After an MR is merged on GitLab, a deploy means tagging the new base-branch HEAD and
pushing that tag. This skill does the read-only prep — sync the base branch, read the
existing tags, work out the next tag in the **repo's own** tag shape — and then hands
you two commands to run yourself: one to create the tag, one to push it.

```
/deploy-tag        # after merging an MR → prep + give me the tag commands
```

The skill stops at "here are your commands." It does not create the tag, does not push
the tag, and never touches the base branch on the remote. You stay in control of the
git-mutating steps.

---

## HARD GATES

- **Never push to the base branch.** This skill pulls the base branch to read its
  latest HEAD — that's all. No commits, no `git push` of any branch. The only thing
  ever pushed is a tag, and even that is a command **you** run, not the skill.
- **The skill runs NOTHING git-mutating.** No `git tag`, no `git push`, no `git commit`.
  It only runs read-only git (`fetch`, `checkout`, `pull --ff-only`, `tag --list`,
  `log`, `describe`). The create-tag and push-tag steps are printed for the user to run.
- **Derive the tag format from the repo, never assume one.** Read the actual existing
  tags and match their shape (prefix, separators, zero-padding, number of segments).
  Do not impose `vX.Y.Z` if the repo tags look like `2026.06.23` or `release-42`.
- **When tags are inconsistent, ask — don't guess.** If the most recent tags don't share
  one clear pattern (mixed prefixes, rc/hotfix tags mingled with releases, two parallel
  version lines), show the top tags and ask the user which one to base the next tag on.
- **Confirm message: clear but short.** One compact block — latest tags, the proposed
  next tag, and the two commands. No essay. The user asked for ngắn gọn.
- **Tag message reflects merged context only when that context actually exists in this
  session.** If the conversation already names a branch/task/MR that was just merged
  (the user said so, or an earlier skill in this session surfaced it — e.g.
  `/notion-task-personal`, `/merge-master`), the `git tag -a ... -m "..."` command's
  message names it. If no such context exists, do not invent one — fall back to the
  plain `release <tag>` message (or a lightweight tag, per Step 6's existing repo-style
  check). Never guess or fabricate a task description to fill the message.
- **Don't deploy from a dirty/unknown state silently.** If the base-branch pull isn't a
  clean fast-forward, or the working tree has changes that block checkout, STOP and
  report — don't force anything.

---

## Step 0 — Detect the base branch

Most of these repos use `master`; some use `main`. Detect it, don't hardcode.

```bash
# Prefer the remote's default branch; fall back to whichever of master/main exists.
BASE=$(git remote show origin 2>/dev/null | sed -n 's/.*HEAD branch: //p')
if [ -z "$BASE" ]; then
  for b in master main; do
    git show-ref --verify --quiet "refs/remotes/origin/$b" && BASE="$b" && break
  done
fi
echo "BASE=$BASE"
```

Remember `BASE` for the steps below (bash vars don't persist between blocks). If `BASE`
came out empty, ask the user which branch is the deploy/base branch before continuing.

---

## Step 1 — Checkout the base branch + pull latest (read-only on the remote)

Note the current branch first so the report can mention where the user started. Then
switch to the base branch and fast-forward it. **`--ff-only`** is deliberate: a deploy
tag must sit on the real merged HEAD, and a fast-forward-only pull fails loudly instead
of creating a stray merge commit if local `BASE` diverged.

```bash
git rev-parse --abbrev-ref HEAD              # where the user was (for the report)
git status --short                           # if dirty in a way that blocks checkout, STOP and report

git checkout "$BASE"
git pull --ff-only origin "$BASE"
git log -1 --oneline                         # the HEAD that the new tag will point at
```

If `git checkout` fails because of local changes, STOP — tell the user to stash/commit
first; don't discard anything. If `git pull --ff-only` fails (local `BASE` diverged from
origin), STOP and report — the user decides how to reconcile; this skill won't merge or
reset for them.

---

## Step 2 — Fetch every tag

```bash
git fetch --tags --force origin
```

`--tags` makes sure local tag refs match the remote (so we don't propose a tag that
already exists upstream). `--force` lets a moved tag update locally rather than erroring.

---

## Step 3 — Read the existing tags and infer the pattern

List the most recent tags two ways — newest-by-semver and newest-by-creation — so you
can tell a clean semver line from a repo that tags by date or counter:

```bash
echo "── by version sort ──"
git tag --list --sort=-v:refname | head -10
echo "── by creation date ──"
git tag --list --sort=-creatordate | head -10
echo "── what HEAD already describes as ──"
git describe --tags --abbrev=0 2>/dev/null || echo "(no reachable tag)"
```

Now **read** those tags and infer the format from them. Identify, from the actual
strings:

- **Prefix** — `v`? none? `release-`? `deploy-`? Keep exactly what the repo uses.
- **Segments + separators** — `X.Y.Z` (dots), `X.Y` (two), `YYYY.MM.DD` (date),
  `name-N` (counter). Match the count and the separator.
- **Zero-padding** — does the repo write `v1.04` / `2026.06.09`? Preserve padding width.

This inferred shape is the contract for the next tag. The point of reading the tags
(rather than assuming `vX.Y.Z`) is that the next tag must look like it belongs in this
repo's sequence.

---

## Step 4 — Decide the next tag (or ask, if ambiguous)

**Case A — the recent tags share one clear pattern.** Compute the next tag in that
exact shape by incrementing the natural counter:

- **Semver `vX.Y.Z` / `X.Y.Z`** → default to a **patch bump** (last segment +1), e.g.
  `v1.4.2 → v1.4.3`. In the confirm block, also name the minor/major alternatives on one
  line (`minor v1.5.0 · major v2.0.0`) so the user can pick if this release is bigger.
  Keep the prefix exactly as the latest tag has it.
- **Date-based `YYYY.MM.DD`** → use today's date in the same format. If a tag for today
  already exists, append/raise the repo's existing per-day suffix (e.g. `2026.06.23.1`,
  or `-1`/`-2` — match whatever the repo already does for same-day re-tags).
- **Counter `name-N`** → `name-(N+1)`, preserving any zero-padding.

Today's date, when needed: get it from the environment context (the `currentDate` line),
**not** by shelling out — `date` drift and timezones make the shell unreliable here.

**Case B — the recent tags are inconsistent.** If the top tags mix patterns (different
prefixes, rc/hotfix tags interleaved with releases, or two parallel version lines like
`v1.x` and `v2.x-beta`), DO NOT guess. Show the user the top few and ask which to base
the next tag on:

```
Tags gần đây không đồng nhất — lấy cái nào làm gốc để tăng?
  v1.4.2        (semver release line)
  2026.06-rc1   (date rc)
  hotfix-3      (counter)
```

Wait for the user's pick, then compute the next tag from that chosen base using the
Case-A rule for its shape.

Before finalizing, double-check the proposed tag does **not** already exist:

```bash
git tag --list "<proposed-tag>"   # must print nothing; if it prints the tag, bump again
```

---

## Step 5 — Check the session for merged-task context

Look back over this conversation (user messages, and anything an earlier skill in this
session surfaced — e.g. `/notion-task-personal`, `/merge-master`, `/merge-branch`) for a
branch name and/or task description that was just merged into the base branch.

- **Found it** → note the branch name and a short (few-words) task description. This
  becomes the tag message in Step 6. If more than one branch/task was merged (a batched
  release), note each — Step 6 lists them as separate lines in the message.
- **Not found** → don't guess, don't ask, don't infer one from the commit subject. Proceed
  to Step 6 with no context; the tag message falls back to plain `release <tag>` (or stays
  lightweight, per the repo-style check in Step 6).

This is read-only — it doesn't change which tag gets proposed, only what the `-m` message
says.

---

## Step 6 — Print the confirmation + the commands (this is the deliverable)

Show one compact block. This is what the skill produces — clear but short, and the two
commands are for the **user** to run. Do not run them.

No merged-task context found in Step 5:

```
DEPLOY TAG — <repo base branch> @ <short-hash> "<HEAD subject>"
────────────────────────────────
Latest tags:  v1.4.2  v1.4.1  v1.4.0
Next tag:     v1.4.3        (patch bump · minor v1.5.0 · major v2.0.0)

Run to create + push the tag:
  git tag v1.4.3
  git push origin v1.4.3
────────────────────────────────
```

Merged-task context found in Step 5 (one task):

```
DEPLOY TAG — <repo base branch> @ <short-hash> "<HEAD subject>"
────────────────────────────────
Latest tags:  v1.4.2  v1.4.1  v1.4.0
Next tag:     v1.4.3        (patch bump · minor v1.5.0 · major v2.0.0)
Merged:       feature/fix-cart-total — Fix sai tổng giỏ hàng khi áp coupon

Run to create + push the tag:
  git tag -a v1.4.3 -m "release v1.4.3 — merge feature/fix-cart-total (Fix sai tổng giỏ hàng khi áp coupon)"
  git push origin v1.4.3
────────────────────────────────
```

Merged-task context with more than one task (batched release) — one line per task in
both the `Merged:` block and the `-m` message body:

```
Merged:
  - feature/fix-cart-total: Fix sai tổng giỏ hàng khi áp coupon
  - feature/update-shipping: Cập nhật phí ship cho khu vực mới

  git tag -a v1.4.3 -m "release v1.4.3

- merge feature/fix-cart-total: Fix sai tổng giỏ hàng khi áp coupon
- merge feature/update-shipping: Cập nhật phí ship cho khu vực mới"
```

Notes for filling this in:

- **When no context was found (Step 5):** `git tag <tag>` is lightweight by default —
  that's the simple form. If the repo's existing tags are **annotated** (check with
  `git for-each-ref --format='%(objecttype)' refs/tags/<latest>` → `tag` = annotated,
  `commit` = lightweight), offer the annotated form instead so the new tag matches the
  repo's style: `git tag -a v1.4.3 -m "release v1.4.3"`. Match what the repo already does.
- **When context WAS found (Step 5):** always use the annotated form (`-a -m`) —
  a message that names the merged branch/task is the whole point, and a lightweight tag
  has nowhere to put it. This is the one case where the skill picks annotated regardless
  of the repo's usual style, because the message is the reason it's being added.
- Tag points at the **current** base-branch HEAD (the one shown from Step 1's
  `git log -1`). If the user needs the tag on a different commit, they append the
  commit-ish: `git tag v1.4.3 <commit>` — mention this only if relevant.
- Keep it to this one block. No multi-paragraph explanation unless the user asks.

If you want, also print the one-liner to do both at once for convenience, but keep the
two-line form as the primary (it's clearer about what each step does):

```
  git tag v1.4.3 && git push origin v1.4.3
```

---

## Step 7 — Hand off

End by stating plainly: base branch is synced, tag is **not** created yet, run the
commands above to deploy. Offer to run them **only if the user explicitly asks** —
the default is hands-off. If they say "push luôn" / "tự chạy đi", then (and only then)
run `git tag …` and `git push origin <tag>` for them, echoing each command first.

Point them at the GitLab pipelines/tags page if a tag push triggers a deploy pipeline,
so they can watch it run.

---

## Why this design

- **The repo owns the tag format.** Reading existing tags and matching their shape means
  the same skill works for a `vX.Y.Z` repo, a `YYYY.MM.DD` repo, and a `release-N` repo
  with no per-repo config. Assuming `vX.Y.Z` would silently produce wrong tags elsewhere.
- **Commands, not actions.** The user asked for the commands to run, not for the skill to
  push. Tagging a release is a deliberate, hard-to-undo act (a pushed tag often kicks off
  a production deploy), so the human keeps the trigger. The skill removes the repetitive
  prompting, not the control.
- **Never touches the base branch on the remote.** It only fast-forwards local `BASE` to
  read the right HEAD. `--ff-only` guarantees it can't invent a merge commit; a divergence
  surfaces as an error the user resolves, not as a silent reconcile.
- **Ask on ambiguity.** A wrong deploy tag is worse than a question. When the tag line
  isn't obvious, one short prompt beats guessing and tagging the wrong sequence.
- **Message reflects real context, never invented context.** A tag message naming the
  merged branch/task is only useful if it's true. Session context (the user said it, or
  an earlier skill surfaced it this run) is trustworthy; a description guessed from the
  commit subject or invented to fill the message is not — a wrong message is worse than
  a plain `release vX.Y.Z`, so absence of context falls back silently instead of guessing.
