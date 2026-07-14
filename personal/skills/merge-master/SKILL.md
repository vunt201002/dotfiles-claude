---
name: merge-master
description: Merge master into the current branch and resolve conflicts carefully, split by file type. Translation/locale JSON files (locales/, i18n/, lang/, or flat key-value string files) get the simple rule — keep both sides' keys, since a conflict there is usually two branches adding different keys at the same spot. Same-key-different-value JSON conflicts stop and ask, never auto-picked. Everything else (code, config, non-translation JSON like package.json) gets careful, context-aware resolution — read both branches' intent, auto-apply only additive conflicts (new imports, new functions/routes added at the same spot), stop and propose a resolution for anything deeper before touching it. Stops at `git add` (staged, not committed) so the user reviews before committing. Use when asked "merge master", "merge master vào branch", "resolve conflict", "giải quyết conflict", "branch bị conflict", "cần merge master trước khi lên master", "/merge-master", or before opening/updating an MR that shows conflicts with the base branch.
---

# /merge-master — merge master into the current branch, resolve conflicts carefully

Most tasks eventually conflict with master (multiple branches touching nearby code).
Before a branch can go to master, master needs to be merged in and every conflict
resolved. This skill does exactly that merge, on the **current branch**, and resolves
conflicts using two different levels of care depending on what kind of file conflicted.

Not `/merge-branch` — that skill assembles *several* feature branches into one shared
merge-branch for staging. This skill is simpler and more common: bring **master** into
**the branch you're already on**, so it's current and mergeable. Use this one when the
task is "resolve my conflicts with master," not "combine branches for staging."

---

## The two conflict lanes

1. **Translation/locale JSON — simple lane.** These files are flat key→string maps.
   A conflict almost always means two branches added *different* keys at the same
   position in the file — both keys are needed, neither is wrong, they just collided on
   line number. Resolution: keep both sides' keys. No code-intent reading required.

2. **Everything else — careful lane.** Code files, config files, and JSON files that
   aren't translation maps (`package.json`, `tsconfig.json`, app config). A conflict here
   can silently break another feature if resolved carelessly, so it needs actual
   understanding of what each side's change was trying to do — not a mechanical rule.

**Deciding which lane a conflicted file is in** (check in this order):

- Path/name signals translation: contains `locales/`, `i18n/`, `lang/`, `locale/`, or the
  filename matches a language-code pattern (`en.json`, `vi.json`, `fr-FR.json`,
  `*.locale.json`, `*.i18n.json`) → **simple lane**.
- Otherwise, if it's `.json` but doesn't match the above (e.g. `package.json`,
  `tsconfig.json`, any config/manifest JSON) → **careful lane**. Don't assume "JSON" alone
  means simple — a version-number or dependency conflict in `package.json` can't be
  resolved by "keep both."
- Everything non-JSON (`.ts`, `.js`, `.tsx`, `.py`, `.rb`, `.go`, `.css`, whatever the repo
  uses) → **careful lane**.
- If a `.json` file's path doesn't obviously say "translation" but its *content* is a flat
  string-to-string map with no nesting beyond one level (the shape of a translation file)
  → treat as **simple lane**, but say so explicitly in the report so the user can correct
  the call if it's actually something else.

---

## HARD GATES

- **Working tree must be clean before starting.** If `git status --porcelain` shows any
  changes, STOP and tell the user to commit or stash first. Never merge on top of a dirty
  tree — you can't tell your own uncommitted changes apart from merge conflict markers.
- **Never push.** This skill is entirely local — merge, resolve, stage. No `git push`,
  ever, regardless of how clean the result is.
- **Never commit.** Stop after staging the resolved files (`git add <file>` by name). The
  user reviews the staged resolution and commits it themselves — resolving someone's
  conflicts and then silently committing removes their last chance to catch a bad
  resolution before it's in history.
- **Never `git add -A` / `git add .`.** Stage only the specific files you resolved, by
  name. A broad add would sweep in unrelated dirty files or tracked build artifacts.
- **Same-key-different-value JSON conflicts always stop and ask** — never auto-pick a
  side. This is the one case in the "simple lane" that isn't actually simple: two
  branches wanting different text for the same key is a real decision, not a collision.
- **Any careful-lane conflict you're not confident about stops and asks** — see Step 5
  below for what "confident" means. Guessing on code you don't fully understand is
  exactly the failure mode this skill exists to prevent.

---

## Step 1 — Detect the true main/master branch

Don't hardcode `master` — detect it the same way as the repo's other merge-aware skills:

```bash
# 1) origin's declared default branch — the authoritative answer.
MAIN=$(git symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')

# 2) If unset, ask the remote to populate it, then re-read.
if [ -z "$MAIN" ]; then
  git remote set-head origin -a >/dev/null 2>&1
  MAIN=$(git symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
fi

# 3) Fall back to GitHub/GitLab's view of the default branch.
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

If `MAIN` is still `UNKNOWN`, stop and ask the user which branch is the base branch.
Remember `MAIN` and the current branch name for the rest of this run (bash variables
don't persist across separate tool calls).

---

## Step 2 — Clean check, fetch, merge

```bash
if [ -n "$(git status --porcelain)" ]; then
  echo "DIRTY: working tree not clean — commit or stash first."
  git status --short
fi
```

If dirty, STOP (HARD GATE) and tell the user.

Otherwise, fetch latest and merge the base branch into the current branch:

```bash
git fetch origin --prune
git merge --no-ff "origin/<MAIN>" -m "merge: <MAIN> into <current-branch>"
```

Check the result:

- **"Already up to date"** → nothing to do. Report that and stop; there's no conflict to
  resolve because the branch already has everything from `<MAIN>`.
- **Merged cleanly, no conflicts** → report success (see Step 6) and stop — no conflicts,
  nothing further needed. The merge commit already exists at this point (a clean `git
  merge` commits automatically), which is fine — only *conflicted* merges need the
  stop-before-commit gate, because a clean merge has nothing for the user to double-check.
- **Conflicts** → continue to Step 3.

---

## Step 3 — List and triage conflicts

```bash
git diff --name-only --diff-filter=U
```

For each conflicted file, classify it into the simple lane or the careful lane using the
rules under "The two conflict lanes" above. Group them before resolving anything, so the
user (and you) can see the shape of the work up front:

```
Conflicts on <current-branch> after merging <MAIN>:
  Simple lane (translation JSON):  locales/en.json, locales/vi.json
  Careful lane (code/config):      src/routes.ts, src/helpers/icons.js, package.json
```

Resolve simple-lane files first (they're fast and mechanical), then careful-lane files.

---

## Step 4 — Simple lane: translation/locale JSON

For each simple-lane file:

1. **Read the conflicted file** and identify the conflict markers (`<<<<<<<`, `=======`,
   `>>>>>>>`). Each marked region is where the two sides diverged.
2. **For each conflicted region, determine whether the two sides added the same key or
   different keys:**
   - **Different keys** (the normal case — two branches each added their own new
     translation entries at the same line): keep both. Merge the two key sets into one,
     preserving valid JSON (watch trailing commas — a naive concatenation of both sides
     often leaves a dangling or missing comma). Sort order should follow whatever
     convention the rest of the file already uses (alphabetical, insertion order,
     whatever's already there) — don't invent a new ordering scheme.
   - **Same key, same value** (both branches happened to add the identical entry) — keep
     one copy, drop the duplicate. Not a real conflict, just noise.
   - **Same key, different value** (both branches want different text for the same key)
     — **STOP. Do not auto-pick a side.** This is a real content decision (which text is
     correct/current), not a mechanical collision. Report it to the user with both
     candidate values and which branch each came from, and wait for their choice before
     continuing. You may resolve every *other* conflict in the file and leave just this
     key's line still marked, or hold the whole file — either way, be explicit in your
     report about what's still pending.
3. **Remove all conflict markers** once resolved, leaving valid JSON. Validate the file
   parses (e.g. skim it or use a `python3 -c "import json; json.load(open('<file>'))"` /
   `node -e "JSON.parse(require('fs').readFileSync('<file>'))"` check, whichever runtime
   is already in this repo) before moving on — a syntax slip (bad comma) here breaks the
   whole locale file at runtime, not just the new keys.
4. **Stage the file by name**: `git add <file>`.
5. **Note the resolution** for the final report: which keys came from which side, and
   whether anything is still pending a user decision.

---

## Step 5 — Careful lane: code, config, non-translation JSON

For each careful-lane file, read enough context to actually understand both sides before
touching anything — the conflict markers alone rarely tell you *why* each side made its
change.

1. **Read the full conflicted file**, not just the marked regions — you need to see how
   the conflicting hunks fit into the surrounding function/module to judge intent.
2. **Understand both sides:**
   - `<<<<<<< HEAD` (or the current branch's label) — what the current branch was doing
     here, and why (check recent commits on this file if the intent isn't obvious from
     the code alone: `git log -3 --oneline -- <file>`).
   - `>>>>>>> <MAIN>` — what changed on master in the same spot, and why (same approach:
     recent commits on `<MAIN>` touching this file).
3. **Classify the conflict by how it should be resolved:**

   **Auto-apply — additive, no logic to reconcile.** Both sides added *new, independent*
   things at the same location and neither replaces or depends on the other:
   - Two new `import` statements added at the same line → keep both imports (dedupe if
     truly identical), reorder to match the file's existing import convention if one
     exists.
   - Two new functions/routes/handlers both added around the same line, each self-
     contained and not calling into the other's new code → keep both, in a sane order
     (e.g. by the order they appeared in the two branches, or grouped with related
     existing code).
   - A conflict where one side is a strict superset of the other (e.g. a formatting-only
     change on one side, a real change on the other, touching the same line) → take the
     side with the real change.

   Resolve these directly: remove markers, keep both, stage the file. No need to ask —
   this is the class of conflict that's genuinely mechanical once you've read enough to
   confirm the two additions really are independent.

   **Stop and propose — anything else.** Two sides editing the *same* logic in
   *incompatible* ways, a function signature changed on one side while the other side
   added a new call site expecting the old signature, shared state touched by both sides,
   or anything where you're not fully confident the two changes don't interact. This
   includes any conflict where confirming "these are independent" would require you to
   guess rather than verify.

   For these: **do not resolve yet.** Write up, per file:
   - What the current branch's side does and why (in plain terms, referencing the actual
     lines).
   - What master's side does and why.
   - Why they conflict (are they genuinely incompatible, or just textually overlapping
     but reconcilable — say which).
   - Your proposed resolution, concretely (not "merge them carefully" — the actual
     resulting code shape).
   - What breaks if the proposed resolution is wrong (name the feature/flow at risk).

   Then **ask the user** (AskUserQuestion) per file or as a batch if several are related:
   **A) Apply your proposed resolution** / **B) User explains what's correct, then you
   apply it** / **C) User resolves this file themselves** (you move on to the next file
   and leave this one for them). Do not proceed past a careful-lane conflict without one
   of these three.

4. **Once resolved** (auto-applied or per the user's answer), remove all conflict
   markers, **stage the file by name**: `git add <file>`.
5. **Note the resolution** for the final report: one line per file on what was kept and
   why, or a reference to the user's decision if they chose B/C.

Never move to the next careful-lane file while the current one's conflict is still open
(markers still in the file, or waiting on a user answer).

---

## Step 6 — Final report (stop here — no commit, no push)

```
MERGE MASTER — <current-branch>
────────────────────────────────
Merged:  <MAIN> → <current-branch>  (origin/<MAIN> at <short-sha>)
────────────────────────────────
Simple lane (translation JSON):
  ✓ locales/en.json    kept both — 3 keys from this branch, 2 from <MAIN>
  ✓ locales/vi.json    kept both — same 5 keys, mirrored
  ⏸ locales/fr.json    "button.save" differs (this branch: "Lưu", <MAIN>: "Lưu lại")
                        — waiting on your call, not staged
────────────────────────────────
Careful lane (code/config):
  ✓ src/routes.ts        auto-applied — two new routes added at the same line, independent
  ✓ src/helpers/icons.js auto-applied — two new icon helpers, independent (per the prior
                          tech-review incident, double-checked these don't collide with
                          any admin-revamp icon names)
  ✓ package.json          your call (B) — bumped to the higher of the two versions
────────────────────────────────
Staged (git add), NOT committed. Review `git diff --staged` before committing.
Nothing was pushed.
```

State plainly if anything is still unresolved (a pending same-key-different-value JSON
decision, or a careful-lane file the user chose to resolve themselves) — the branch is
NOT ready to commit/ship until those are closed out. List exactly which files are still
open.

---

## Why this design

- **Two lanes, not one uniform process.** Translation-key collisions and logic conflicts
  fail differently if handled wrong — a translation collision resolved wrong means a
  missing string; a logic conflict resolved wrong means a broken feature shipped
  silently (the exact incident that led to writing `/tech-review`'s merge-provenance
  check). Matching the care level to the actual risk keeps the fast lane fast without
  under-caring on the risky lane.
- **Same-key-different-value always escalates.** This is the one spot in the "simple"
  lane that secretly isn't simple — it's a content decision wearing a JSON-conflict
  costume. Auto-picking either side risks silently reverting someone's intentional text
  change.
- **Careful lane defaults to escalate, not guess.** Auto-apply is scoped tightly to
  provably-independent additions (new imports, new sibling functions) — the cases where
  "confident" doesn't require modeling runtime behavior, just reading that two additions
  don't reference each other. Everything with real interaction risk stops and proposes,
  because a wrong guess here is the kind of incident this skill exists to prevent, not
  produce.
- **Stops before commit.** Resolving someone's merge conflicts and then also committing
  removes their last checkpoint to catch a bad resolution. Staging (not committing) keeps
  the standard `git diff --staged` review available before it's permanent history.
- **Never pushes.** Conflict resolution is inherently a "get it right first" operation;
  pushing is a separate, later decision once the user has reviewed and committed.
