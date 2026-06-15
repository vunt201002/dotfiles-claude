---
name: my-worklog
description: Cross-project daily worklog for running many tasks in parallel. End of day, save each task's state (what's done, what's left, the one next action) into a shared store keyed by branch. Next morning, see a standup of every in-progress task grouped by day with its next action, hiding finished ones, then resume any task with full context loaded back into the session. Reuses the gstack checkpoint store so /context-restore stays compatible. Use when asked to "save my work", "what was I doing", "morning standup", "where did I leave off", "resume task", "worklog", or at the start/end of a work day with multiple tasks in flight.
---

# /my-worklog — Daily worklog across parallel tasks

You help a developer who runs **many tasks in parallel** (one terminal / one git
branch per task) survive the overnight context gap. In a focused day they remember
everything; the next morning they need to see what was in flight, with a concrete
next action per task, and reload one task's full context into a fresh session.

**A task == a git branch.** That is the natural task identity here. Cross-project
exceptions (one logical task spanning two branches) are rare — don't special-case
them; each branch is still its own worklog entry.

**This skill reuses the gstack checkpoint store** (the same files `/context-save`
writes), adding one field — `next_action` — so the morning standup can show each
task's next step without opening every file. The format stays byte-compatible with
`/context-restore`.

---

## HARD GATES

- **Never modify project code.** This skill only reads git/session state, writes
  worklog files, and (for `done`) flips a status field in a worklog file.
- **Worklog files are append-only.** `save` always creates a NEW file. Never
  overwrite an existing worklog file. (`done` is the only in-place edit, and it
  changes exactly one frontmatter line.)
- **Compute file paths and the title slug in BASH, never in the prompt layer** —
  a user-supplied title must not be able to inject shell metacharacters. The slug
  sanitizer is an allowlist: only `a-z 0-9 - .` survive.

---

## Detect mode

Parse the user's input after `/my-worklog`:

| Input | Mode |
|---|---|
| *(nothing)* or `standup` | **Standup** — the default |
| `save` or `save <title>` | **Save** |
| `resume` or `resume <branch\|title\|#>` | **Resume** |
| `done` or `done <branch\|title>` | **Done** |
| `list` | Tell the user: standup IS the list; `/my-worklog` shows it. |

When in doubt, do **Standup** — it is read-only and safe.

---

## Shared setup (all modes)

The store lives at `$GSTACK_STATE_ROOT/projects/$SLUG/checkpoints/`. Resolve
`SLUG` and `BRANCH` with the repo's `gstack-slug` helper (output is sanitized, so
`eval` is safe). On this machine gstack is NOT at `~/.claude/skills/gstack`, so
fall back to the dotfiles checkout for the helpers:

```bash
# Resolve the gstack bin dir (machine-portable).
GSTACK_BIN=""
for d in "$HOME/.claude/skills/gstack/bin" "$HOME/Project/github/dotfiles-claude/bin"; do
  [ -x "$d/gstack-slug" ] && { GSTACK_BIN="$d"; break; }
done
# SLUG + BRANCH (sanitized by gstack-slug).
if [ -n "$GSTACK_BIN" ]; then
  eval "$("$GSTACK_BIN/gstack-slug" 2>/dev/null)"
fi
SLUG="${SLUG:-$(basename "$PWD" | tr -cd 'a-zA-Z0-9._-')}"
BRANCH="${BRANCH:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null | tr -cd 'a-zA-Z0-9._-')}"
BRANCH="${BRANCH:-unknown}"
# State root.
STATE_ROOT="${GSTACK_STATE_ROOT:-$HOME/.gstack}"
CHECKPOINT_DIR="$STATE_ROOT/projects/$SLUG/checkpoints"
echo "SLUG=$SLUG"; echo "BRANCH=$BRANCH"; echo "CHECKPOINT_DIR=$CHECKPOINT_DIR"
```

Remember `SLUG`, `BRANCH`, and `CHECKPOINT_DIR` from this output — restate them in
prose for later steps (bash variables do not persist between code blocks).

---

## STANDUP mode (default)

Fastest path: just run the helper script, which already groups by day, hides done
tasks, dedups to the newest save per branch, and prints each `next_action`:

```bash
bash "$HOME/.claude/skills/my-worklog/scripts/worklog.sh"
```

(If that path doesn't exist, run `bash "$HOME/Project/github/dotfiles-claude/personal/skills/my-worklog/scripts/worklog.sh"`.)

Show the user the script output as-is. Then add a short, human read on top of it:
- Lead with the count: "You have N tasks in progress."
- If one task looks blocked (its `next_action` mentions "kẹt"/"stuck"/"blocked"),
  call it out as the one to look at first.
- Close with: "Open a terminal per task and run `/my-worklog resume <branch>` to
  reload its full context."

Do NOT read every file's body in standup — that wastes context. The script reads
only the one-line `next_action` per task; you do the same. Only open a full file
when the user picks a task to **resume**.

If the user passes `--all`, run the script with `--all` (tasks across all projects).

---

## SAVE mode

Use at end of day, or whenever leaving a task — capture it while the context is hot.

### Step 1 — gather state

Run the shared setup above, then collect git state:

```bash
echo "=== STATUS ==="; git status --short 2>/dev/null
echo "=== DIFF STAT ==="; git diff --stat 2>/dev/null
echo "=== STAGED ==="; git diff --cached --stat 2>/dev/null
echo "=== LOG ==="; git log --oneline -8 2>/dev/null
```

### Step 2 — compose the entry

From git state + this conversation, write:

1. **`next_action`** — ONE line, concrete enough to restart in 5 seconds: which
   file/line to open, which command to run, where you're stuck. This is the most
   important field. Example: `Mở widget.ts:42, chạy bun test theme, kẹt ở --joy-primary`.
   If you genuinely cannot infer it, ask the user one short question for it.
2. **Summary** — 1-3 sentences: the goal and current progress.
3. **Decisions Made** — architectural choices / trade-offs and why.
4. **Remaining Work** — numbered next steps in priority order.
5. **Notes** — gotchas, blocked items, open questions, things tried that failed.

**Title** defaults to a short phrase derived from the branch (branch == task). If
the user gave a title after `save`, use that instead.

### Step 3 — compute the file path (BASH, sanitized)

Pass the raw title in as `TITLE_RAW`. Never build the path in the prompt layer.

```bash
# Re-resolve CHECKPOINT_DIR (new shell). Reuse the setup block's logic:
GSTACK_BIN=""
for d in "$HOME/.claude/skills/gstack/bin" "$HOME/Project/github/dotfiles-claude/bin"; do
  [ -x "$d/gstack-slug" ] && { GSTACK_BIN="$d"; break; }
done
[ -n "$GSTACK_BIN" ] && eval "$("$GSTACK_BIN/gstack-slug" 2>/dev/null)"
SLUG="${SLUG:-$(basename "$PWD" | tr -cd 'a-zA-Z0-9._-')}"
STATE_ROOT="${GSTACK_STATE_ROOT:-$HOME/.gstack}"
CHECKPOINT_DIR="$STATE_ROOT/projects/$SLUG/checkpoints"
mkdir -p "$CHECKPOINT_DIR"

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
RAW="${TITLE_RAW:-untitled}"
# allowlist sanitize: lowercase, spaces→hyphens, strip to [a-z0-9.-], cap 60
TITLE_SLUG=$(printf '%s' "$RAW" | tr '[:upper:]' '[:lower:]' | tr -s ' \t' '-' | tr -cd 'a-z0-9.-' | cut -c1-60)
TITLE_SLUG="${TITLE_SLUG:-untitled}"
FILE="${CHECKPOINT_DIR}/${TIMESTAMP}-${TITLE_SLUG}.md"
# collision-safe (same-second double save)
if [ -e "$FILE" ]; then
  SUF=$(LC_ALL=C tr -dc 'a-z0-9' < /dev/urandom 2>/dev/null | head -c 4 || printf '%04x' "$$")
  FILE="${CHECKPOINT_DIR}/${TIMESTAMP}-${TITLE_SLUG}-${SUF}.md"
fi
echo "FILE=$FILE"; echo "TIMESTAMP_ISO=$(date +%Y-%m-%dT%H:%M:%S%z)"
```

### Step 4 — write the file

Write to the exact `$FILE` path printed above (use the string verbatim). Format —
**identical to gstack checkpoints plus the `next_action` line**:

```markdown
---
status: in-progress
branch: {BRANCH from setup}
timestamp: {TIMESTAMP_ISO}
next_action: "{the one-line next action}"
files_modified:
  - {relative path}
  - {relative path}
---

## Working on: {title}

### Summary
{summary}

### Decisions Made
{bullets}

### Remaining Work
{numbered}

### Notes
{notes}
```

`files_modified` comes from `git status --short` (staged + unstaged), repo-relative.
Quote the `next_action` value so colons/backticks inside it stay valid YAML.

### Step 5 — confirm

```
WORKLOG SAVED
────────────────────────────────
Task:    {title}
Branch:  {branch}
Next:    {next_action}
File:    {path}
────────────────────────────────
Morning: /my-worklog   ·   When done: /my-worklog done {branch}
```

---

## RESUME mode

Reload ONE task's full context into the session so work continues without the user
re-explaining anything.

### Step 1 — find the file

```bash
# (resolve CHECKPOINT_DIR as in setup) then:
find "$CHECKPOINT_DIR" -maxdepth 1 -name '*.md' -type f 2>/dev/null | sort -r
```

Pick the target among the newest-first list:
- `resume <branch>` → newest file whose `branch:` frontmatter matches.
- `resume <title-fragment>` → newest file whose title/filename contains it.
- `resume <#>` → the Nth from the standup list.
- `resume` with no arg → if the current `BRANCH` has a worklog, the newest file
  for it; otherwise the single newest file overall.

Do NOT pre-filter by branch when the user names something explicit — match across
all files (a task saved on one branch may be resumed from another / a fresh clone).

### Step 2 — load and present

Read the chosen file fully and present:

```
RESUMING — {title}
────────────────────────────────
Branch:  {branch}   Saved: {timestamp, human}   Status: {status}
Next:    {next_action}
────────────────────────────────
```

Then show **Summary**, **Decisions Made**, **Remaining Work**, **Notes**, and the
`files_modified` list. If the current branch differs from the file's `branch:`,
warn: "Saved on `{branch}`, you're on `{current}` — switch branch before continuing."

### Step 3 — offer to continue

Ask (AskUserQuestion): (A) start on the first Remaining Work item, (B) show the raw
file, (C) just needed the context. If A, restate the `next_action` and begin there.

---

## DONE mode

Mark a task finished so it drops out of tomorrow's standup.

### Step 1 — find the newest file for the task

```bash
# (resolve CHECKPOINT_DIR as in setup) then find newest matching file:
TARGET_BRANCH="{branch arg, or current BRANCH if omitted}"
find "$CHECKPOINT_DIR" -maxdepth 1 -name '*.md' -type f 2>/dev/null | sort -r
```

Choose the newest file whose `branch:` matches the arg (or the current branch if no
arg). If `done <title-fragment>` was given, match on title/filename instead.

### Step 2 — flip status in place

This is the ONLY in-place edit this skill makes, and it touches exactly one line.
Read the file, then change `status: in-progress` to `status: done` in the
frontmatter (leave everything else untouched). Use the Edit tool with the
`status: ...` line as the unique match.

### Step 3 — confirm

```
DONE — {title} ({branch}) marked complete. It won't show in the morning standup.
(Run /my-worklog --done to see completed tasks.)
```

---

## Why this design (for future-me reading this skill)

- **One store, not two.** This deliberately writes into the gstack checkpoint dir
  rather than a new root, so there is a single place to remember and
  `/context-restore` keeps working on these files. The only addition is the
  optional `next_action` field, which gstack ignores.
- **Branch == task** drives standup dedup (newest save per branch wins) and resume
  matching.
- **The script is the fast path; the skill is the smart path.** `worklog.sh` gives
  an instant terminal glance with zero model cost. The skill adds judgement: a
  good `next_action`, a human read of what's blocked, and full context reload.
