---
name: my-worklog
description: Cross-project daily worklog for running many tasks in parallel. End of day, save each task's state — what's done, what's left, the one next action, and what was left half-finished mid-edit — into a shared store keyed by branch. Every save also carries a running session log forward from the previous save (what was attempted, what came back, which dead ends are already ruled out), so the newest file alone rebuilds the whole picture without re-deriving anything. Next morning, see a standup of every in-progress task grouped by day with its next action and any loose ends, hiding finished ones, then resume any task with full context loaded back into the session. Reuses the gstack checkpoint store so /context-restore stays compatible. Use when asked to "save my work", "what was I doing", "morning standup", "where did I leave off", "resume task", "worklog", or at the start/end of a work day with multiple tasks in flight.
---

# /my-worklog — Daily worklog across parallel tasks

You help a developer who runs **many tasks in parallel** (one terminal / one git
branch per task) survive the overnight context gap. In a focused day they remember
everything; the next morning they need to see what was in flight, with a concrete
next action per task, and reload one task's full context into a fresh session.

**A task == a git branch.** That is the natural task identity here. Cross-project
exceptions (one logical task spanning two branches) are rare — don't special-case
them; each branch is still its own worklog entry.

A save captures two different things, and both matter:

1. **The end state** — where the task stands, what's left, the one next action.
2. **The process that got there** — what was actually attempted this session, what
   came back, which hypotheses are already dead, and what was left half-finished
   at the moment the save was requested.

(2) exists so that neither a fresh Claude session nor the user re-walks ground
that has already been walked. It is served by a **cumulative session log**: each
save reads the previous save for the same branch and folds its history forward, so
the newest file is always self-sufficient. `resume` reads exactly one file.

**This skill reuses the gstack checkpoint store** (the same files `/context-save`
writes), adding a few optional fields — `next_action`, `in_flight`, `session` — so
the morning standup can show each task's next step and loose ends without opening
every file. The format stays byte-compatible with `/context-restore`: existing keys
are never renamed or removed, and everything new is optional and ignorable.

---

## HARD GATES

- **Never modify project code.** This skill only reads git/session state, writes
  worklog files, and (for `done`) flips a status field in a worklog file.
- **Worklog files are append-only.** `save` always creates a NEW file. Never
  overwrite an existing worklog file. Carry-forward **reads** the previous save and
  folds its history into the new file — it never edits the old one. The gate
  protects *prior* saves: `done` is the only in-place edit to one, and it changes
  exactly one frontmatter line. (Fixing the file you created moments ago, in the
  same save turn, when the user corrects a bullet in Step 6, is not history — that
  is allowed. Anything written in an earlier turn is.)
- **Compute file paths and the title slug in BASH, never in the prompt layer** —
  a user-supplied title must not be able to inject shell metacharacters. The slug
  sanitizer is an allowlist: only `a-z 0-9 - .` survive.
- **Never invent session history.** Every session-log bullet must trace to
  something that actually happened in this conversation: a command you ran, a file
  you read, output you saw. A short honest log beats a padded one, because the next
  session trusts this file completely and will not re-verify it.

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
`SLUG` with the repo's `gstack-slug` helper (output is sanitized, so `eval` is
safe). On this machine gstack is NOT at `~/.claude/skills/gstack`, so fall back to
the dotfiles checkout for the helpers:

```bash
GSTACK_BIN=""
for d in "$HOME/.claude/skills/gstack/bin" "$HOME/Project/github/dotfiles-claude/bin"; do
  [ -x "$d/gstack-slug" ] && { GSTACK_BIN="$d"; break; }
done
if [ -n "$GSTACK_BIN" ]; then
  eval "$("$GSTACK_BIN/gstack-slug" 2>/dev/null)"
fi
SLUG="${SLUG:-$(basename "$PWD" | tr -cd 'a-zA-Z0-9._-')}"
BRANCH_RAW=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
BRANCH_RAW="${BRANCH_RAW:-${BRANCH:-unknown}}"
BRANCH_KEY=$(printf '%s' "$BRANCH_RAW" | tr -cd 'a-zA-Z0-9._-')
BRANCH_KEY="${BRANCH_KEY:-unknown}"
STATE_ROOT="${GSTACK_STATE_ROOT:-$HOME/.gstack}"
CHECKPOINT_DIR="$STATE_ROOT/projects/$SLUG/checkpoints"
echo "SLUG=$SLUG"
echo "BRANCH=$BRANCH_RAW"
echo "BRANCH_KEY=$BRANCH_KEY"
echo "CHECKPOINT_DIR=$CHECKPOINT_DIR"
```

Remember `SLUG`, `BRANCH`, `BRANCH_KEY`, and `CHECKPOINT_DIR` from this output —
restate them in prose for later steps (bash variables do not persist between code
blocks).

**Two branch values, on purpose.** `BRANCH` is the real branch name and is what
gets written into the file and shown to the user (`feature/foo`). `BRANCH_KEY` is
the same name with `/` stripped (`featurefoo`) and is used **only** for matching
one save against another. The store historically contains both spellings for the
same task, so matching on the raw name alone would miss prior saves and silently
restart a task's history at session 1.

---

## STANDUP mode (default)

Fastest path: just run the helper script, which already groups by day, hides done
tasks, dedups to the newest save per branch, and prints each `next_action` plus a
dim `⏸ đang dở` line when that save left something half-finished:

```bash
bash "$HOME/.claude/skills/my-worklog/scripts/worklog.sh"
```

(If that path doesn't exist, run `bash "$HOME/Project/github/dotfiles-claude/personal/skills/my-worklog/scripts/worklog.sh"`.)

Show the user the script output as-is. Then add a short, human read on top of it:
- Lead with the count: "You have N tasks in progress."
- If one task looks blocked (its `next_action` mentions "kẹt"/"stuck"/"blocked"),
  call it out as the one to look at first.
- If any task shows a `⏸ đang dở` line, name those separately: they have loose
  ends sitting in a working tree, so they cost more to leave alone and are the
  safest ones to finish first.
- Close with: "Open a terminal per task and run `/my-worklog resume <branch>` to
  reload its full context."

Do NOT read every file's body in standup — that wastes context. The script reads
only the one-line `next_action` and `in_flight` per task; you do the same. Only
open a full file when the user picks a task to **resume**.

If the user passes `--all`, run the script with `--all` (tasks across all projects).

---

## SAVE mode

Use at end of day, or whenever leaving a task — capture it while the context is hot.

### Step 1 — gather git state

Run the shared setup above, then:

```bash
echo "=== STATUS ==="; git status --short 2>/dev/null
echo "=== DIFF STAT ==="; git diff --stat 2>/dev/null
echo "=== STAGED ==="; git diff --cached --stat 2>/dev/null
echo "=== LOG ==="; git log --oneline -8 2>/dev/null
```

### Step 2 — find and read the previous save for this branch

This is what makes the new file self-sufficient. Self-contained block (re-resolves
everything; nothing carries over from Step 1):

```bash
GSTACK_BIN=""
for d in "$HOME/.claude/skills/gstack/bin" "$HOME/Project/github/dotfiles-claude/bin"; do
  [ -x "$d/gstack-slug" ] && { GSTACK_BIN="$d"; break; }
done
[ -n "$GSTACK_BIN" ] && eval "$("$GSTACK_BIN/gstack-slug" 2>/dev/null)"
SLUG="${SLUG:-$(basename "$PWD" | tr -cd 'a-zA-Z0-9._-')}"
BRANCH_RAW=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
BRANCH_RAW="${BRANCH_RAW:-${BRANCH:-unknown}}"
BRANCH_KEY=$(printf '%s' "$BRANCH_RAW" | tr -cd 'a-zA-Z0-9._-')
BRANCH_KEY="${BRANCH_KEY:-unknown}"
STATE_ROOT="${GSTACK_STATE_ROOT:-$HOME/.gstack}"
CHECKPOINT_DIR="$STATE_ROOT/projects/$SLUG/checkpoints"

fm() { awk 'NR==1 && $0=="---" {f=1; next} f && $0=="---" {exit} f' "$1" | grep -m1 "^$2:" | sed "s/^$2:[[:space:]]*//; s/^\"//; s/\"$//"; }

PREV=""
while IFS= read -r f; do
  [ -n "$f" ] || continue
  fb=$(fm "$f" branch | tr -cd 'a-zA-Z0-9._-')
  if [ "$fb" = "$BRANCH_KEY" ]; then PREV="$f"; break; fi
done < <(find "$CHECKPOINT_DIR" -maxdepth 1 -name '*.md' -type f 2>/dev/null | sort -r)

if [ -n "$PREV" ]; then
  echo "PREV_FILE=$PREV"
  echo "PREV_SESSION=$(fm "$PREV" session)"
  echo "PREV_TIMESTAMP=$(fm "$PREV" timestamp)"
else
  echo "PREV_FILE="
  echo "PREV_SESSION="
fi
```

Then decide the session number:

1. If `PREV_FILE` is empty, there is no prior save for this branch. This is
   **session 1**. Skip the rest of this step.
2. If `PREV_FILE` is set and `PREV_SESSION` is a number N, this save is **session
   N+1**. Read `PREV_FILE` in full — you need its session log, ruled-out list,
   decisions, and notes to carry forward.
3. If `PREV_FILE` is set but `PREV_SESSION` is empty, that file predates session
   numbering. Treat it as session 1, so this save is **session 2**. Read it in
   full anyway and reconstruct one condensed bullet for it from its Summary.

Never write to `PREV_FILE`. You are reading it only.

### Step 3 — compose the entry

From git state, the previous file (if any), and this conversation, write the
following. The section-by-section contract is in **Save file format** below — read
it before composing, especially the part about which section absorbs what.

1. **`next_action`** — ONE line, concrete enough to restart in 5 seconds: which
   file/line to open, which command to run, where you're stuck. Example:
   `Mở widget.ts:42, chạy bun test theme, kẹt ở --joy-primary`. If you genuinely
   cannot infer it, ask the user one short question for it.
2. **`in_flight`** — ONE line naming the exact half-finished thing, or omit the
   field entirely if the session stopped at a clean point. See the split below.
3. **This session's log block** — 5-10 `action → result` bullets, drafted from
   real evidence in this conversation.
4. **Carry-forward** — fold the previous file's session log down the condensation
   ladder, and carry its ruled-out list, decisions, and notes.
5. The prose sections: Summary, Đang dở, Đã loại trừ, Decisions Made, Remaining
   Work, Notes.

**Title** defaults to a short phrase derived from the branch (branch == task). If
the user gave a title after `save`, use that instead. On a continuing task, prefer
the previous file's title unless the task's focus genuinely changed.

#### `next_action` vs `in_flight` — keep both, they are different

- **`next_action` faces forward.** What to do when you sit back down. Always present.
- **`in_flight` faces backward.** The loose end that already exists — in the
  working tree, in a half-applied edit, in a decision you were mid-way through
  making. Omit the key when nothing is half-done.

They are separate because the next action is frequently **unsafe until the loose
end is resolved**, and a single field hides that:

```yaml
next_action: "Chạy lại `bun test theme` sau khi sửa xong getThemeVar(), target 14/14 pass"
in_flight: "getThemeVar() (widget.ts:150) sửa dở — đang đổi sang CSS var, CHƯA build lại nên bản trên staging vẫn là code cũ"
```

Read alone, `next_action` would send the next session to run a test against a build
that does not contain the change. `in_flight` is what stops that.

#### Writing this session's log bullets

Style is **milestone + evidence**, not a transcript and not vague summary. Each
bullet is `action → result` and carries the anchor that made it real: a `file:line`,
the exact command run, the URL verified, a commit hash.

```
- Đọc widget.ts:120-180 → tìm ra layer render V4
- Chạy `bun test theme` → fail 2/14 (--joy-primary)
- Verify staging9 /cart → bug vẫn còn
- ĐÃ LOẠI TRỪ: cache CDN, sai config store
- ĐANG DỞ: sửa dở getThemeVar(), chưa build lại
```

The last two lines are deliberate duplication, not an oversight. `ĐÃ LOẠI TRỪ`
and `ĐANG DỞ` appear **both** as a bullet here and in their own sections, because
they answer two different questions. In the session log they answer "what happened
in phiên 3" and stay attached to the session that produced them. In `### Đã loại
trừ` / `### Đang dở` they answer "what is true of the task right now", pooled
across every session. Write them in both places. When phiên 3 later compresses
down the ladder, these two bullets are the first to drop — the dedicated sections
already hold them.

Rules:
- **5-10 bullets.** If the session was thin, write 2 honest bullets. Do not pad.
- **Milestones only.** If a step did not change what you know or what is on disk,
  it is not a bullet. Ten tool calls that converge on one finding are one bullet.
- **A bullet with no anchor and no result is noise.** "Investigated the theme
  layer" says nothing; "Đọc widget.ts:120-180 → layer render V4" says where to look.
- **Only what happened in THIS session.** If this session began with a `resume`,
  the prior file's work is already carried forward — do not re-list it as if you
  just did it. Your bullets start where the resume ended.
- **Never invent.** See HARD GATES. If you cannot point at the moment in this
  conversation where a bullet happened, delete the bullet.

#### The condensation ladder (bounded history)

A task can run for weeks. The session log must not grow without limit, so older
sessions compress on a fixed ladder. When writing session N:

| Band | Which sessions | Budget |
|---|---|---|
| **Newest** | session N (the one you are writing) | 5-10 bullets, full detail |
| **Recent** | sessions N-1, N-2, N-3 | **max 2 bullets each** |
| **Older** | everything before N-3 | **one `#### Trước đó` block, max 3 bullets total** |

Mechanically, each save shifts everything down one rung:
1. Last save's newest block moves into **Recent** — compress its 5-10 bullets to
   the ≤2 that still matter. Keep outcomes, drop attempts.
2. Whatever falls out of the bottom of **Recent** merges into the `#### Trước đó`
   block, which is then re-compressed back to ≤3 bullets total no matter how many
   sessions it now covers.
3. Blocks already in **Recent** or **Trước đó** are copied forward as-is unless
   they are the ones moving a rung.

Ceiling: ~19 bullets, however long the task runs.

**Promote before you compress — this is what makes the ladder safe.** Before
dropping any line, move what must survive into the section that owns it forever:

| The line is... | Promote it to |
|---|---|
| a hypothesis that got eliminated | `### Đã loại trừ` |
| a design choice + why | `### Decisions Made` |
| an environment gotcha / don't-do-this | `### Notes` |
| something still unfinished | `### Remaining Work` |

The session log is a **narrative index, not the system of record.** The durable
sections are. Once you have promoted, dropping a session-log line loses nothing.

### Step 4 — compute the file path (BASH, sanitized)

Pass the raw title in as `TITLE_RAW`. Never build the path in the prompt layer.

```bash
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

### Step 5 — write the file

Write to the exact `$FILE` path printed above (use the string verbatim), in the
**Save file format** below. `files_modified` comes from `git status --short`
(staged + unstaged), repo-relative. Quote the `next_action` and `in_flight` values
so colons/backticks inside them stay valid YAML, and **escape any `"` inside the
text as `\"`** — an unescaped quote inside a quoted scalar produces a malformed
frontmatter line that a strict YAML reader (`/context-restore`) can choke on.
Prefer backticks around identifiers in these two fields; `getThemeVar()` needs no
escaping, `"getThemeVar"` does.

### Step 6 — confirm, and invite a correction

Show the composed session log and in-flight line back to the user, not just the
file path. This is the moment they can catch a wrong bullet while they still
remember the session; tomorrow they will not.

```
WORKLOG SAVED — phiên {N}
────────────────────────────────
Task:    {title}
Branch:  {branch}
Next:    {next_action}
Đang dở: {in_flight, or "— dừng ở điểm sạch"}
File:    {path}
────────────────────────────────
Phiên {N} ghi lại:
  - {session bullet 1}
  - {session bullet 2}
  - ...
────────────────────────────────
Sai chỗ nào thì nói, anh sửa lại file luôn.
Morning: /my-worklog   ·   When done: /my-worklog done {branch}
```

If the user corrects something, edit **the file you just wrote in this same turn**.
Per the HARD GATES this is not an append-only violation: you are fixing your own
brand-new file, not rewriting history. Never reach back into an older save to
"correct" it — if an older file is wrong, note the correction in the new file.

---

## Save file format

```markdown
---
status: in-progress
branch: {branch}
timestamp: {ISO 8601}
session: {N}
next_action: "{one line — what to do next}"
in_flight: "{one line — what was left mid-air; omit this key if nothing was}"
files_modified:
  - {relative path}
  - {relative path}
---

## Working on: {title}

### Summary
{1-3 sentences: the goal, and where it stands NOW. Not the story of how it got
here — that is the Session log.}

### Đang dở (in flight)
{2-5 bullets expanding the in_flight line: which files are half-edited, what state
the build/tree is in, what decision was pending, and whether to finish it or
revert it. If nothing was in flight, write exactly:}
_Không có gì dở dang — dừng ở điểm sạch._

### Session log

#### Phiên {N} — {DD/MM HH:MM} (mới nhất)
- {action → result, with anchor}
- {5-10 of these}

#### Phiên {N-1} — {DD/MM} (rút gọn)
- {≤2 bullets}

#### Phiên {N-2} — {DD/MM} (rút gọn)
- {≤2 bullets}

#### Phiên {N-3} — {DD/MM} (rút gọn)
- {≤2 bullets}

#### Trước đó (phiên 1-{N-4}, rút gọn)
- {≤3 bullets total}

{Blocks that don't exist yet are simply omitted — a session-2 file has one
condensed block and no "Trước đó" at all.}

### Đã loại trừ (đừng đào lại)
- {hypothesis} — {the evidence that killed it} (phiên {n})

### Decisions Made
{choices committed to, and why}

### Remaining Work
{numbered, priority order}

### Notes
{gotchas, environment quirks, don't-commit warnings, open questions, links}
```

### Which section holds what

The new sections take content that used to be crammed into Notes and Summary.
Follow this split so nothing is stated twice:

| Section | Holds | Does NOT hold |
|---|---|---|
| **Summary** | Goal + where it stands now, 1-3 sentences | The narrative of how it got here → *Session log* |
| **Đang dở** | The half-finished thing, right now | Anything already finished, or not yet started |
| **Session log** | What was attempted per session + what came back | Anything that must survive forever → promote it first |
| **Đã loại trừ** | Hypotheses/approaches killed, + the evidence | Design choices we adopted → *Decisions Made* |
| **Decisions Made** | Choices committed to, and why | Things merely eliminated → *Đã loại trừ* |
| **Remaining Work** | Forward steps, numbered | Half-done work → *Đang dở* (list it here only as "finish X" / "decide X") |
| **Notes** | Gotchas, env quirks, don't-commit warnings, links | **"Things tried that failed" — those now go to *Đã loại trừ*** |

**Đã loại trừ is the one section that only grows.** Merge duplicates and
near-duplicates, but never delete a line just because the list got long — re-digging
a dead end costs far more than a few extra lines.

**Carry forward, don't restate.** Decisions, ruled-out entries, and notes from the
previous file are copied into the new one so it stands alone. Copy them; do not
rewrite them into new words, and do not re-derive them. Only add, correct, or mark
something as superseded when this session actually changed it.

---

## RESUME mode

Reload ONE task's full context into the session so work continues without the user
re-explaining anything. The newest file per branch is self-sufficient by
construction — **read exactly one file.**

### Step 1 — find the file

```bash
GSTACK_BIN=""
for d in "$HOME/.claude/skills/gstack/bin" "$HOME/Project/github/dotfiles-claude/bin"; do
  [ -x "$d/gstack-slug" ] && { GSTACK_BIN="$d"; break; }
done
[ -n "$GSTACK_BIN" ] && eval "$("$GSTACK_BIN/gstack-slug" 2>/dev/null)"
SLUG="${SLUG:-$(basename "$PWD" | tr -cd 'a-zA-Z0-9._-')}"
STATE_ROOT="${GSTACK_STATE_ROOT:-$HOME/.gstack}"
CHECKPOINT_DIR="$STATE_ROOT/projects/$SLUG/checkpoints"
find "$CHECKPOINT_DIR" -maxdepth 1 -name '*.md' -type f 2>/dev/null | sort -r
```

Pick the target among the newest-first list:
- `resume <branch>` → newest file whose `branch:` frontmatter matches. Compare with
  `/` stripped from both sides, so `feature/foo` also matches a file saved as
  `featurefoo`.
- `resume <title-fragment>` → newest file whose title/filename contains it.
- `resume <#>` → the Nth from the standup list.
- `resume` with no arg → if the current branch has a worklog, the newest file for
  it; otherwise the single newest file overall.

Do NOT pre-filter by branch when the user names something explicit — match across
all files (a task saved on one branch may be resumed from another / a fresh clone).

Only read older files for the same branch if the user explicitly asks for deeper
history. The newest one already carries it, condensed.

### Step 2 — check the in-flight claim against reality

If the file has an `in_flight` value, the tree may have moved since it was written
(the user may have stashed, reverted, or committed the half-done work in another
terminal). Verify before trusting it:

```bash
git status --short 2>/dev/null; echo "=== LOG ==="; git log --oneline -5 2>/dev/null
```

1. If the named files are still dirty, the loose end is real — present it as-is.
2. If the tree is clean or those files are gone from it, say so plainly: "File ghi
   `{in_flight}`, nhưng working tree sạch — chắc đã commit hoặc revert rồi. Xác
   nhận trước khi làm tiếp." Do not silently drop it and do not assume which.

### Step 3 — present

```
RESUMING — {title}   ·   phiên {N}
────────────────────────────────
Branch:  {branch}   Saved: {timestamp, human}   Status: {status}
Next:    {next_action}
Đang dở: {in_flight, or "— dừng ở điểm sạch"}
────────────────────────────────
```

Then present the body **in this order** — the session log and in-flight are the
payoff of this whole design, so they come before the standing sections, not after:

1. **Summary** — one short orientation paragraph.
2. **Đang dở (in flight)** — full section, plus the reality check from Step 2.
3. **Session log** — newest session first, in full. Then the condensed older
   blocks, so the arc of the task is visible in one read.
4. **Đã loại trừ** — call this out explicitly: "these are already ruled out, don't
   re-dig them."
5. **Remaining Work**
6. **Decisions Made**
7. **Notes**
8. **files_modified**

If the current branch differs from the file's `branch:`, warn: "Saved on
`{branch}`, you're on `{current}` — switch branch before continuing."

### Step 4 — offer to continue

Ask (AskUserQuestion). When `in_flight` is present, the first option is to resolve
it, because the next action usually assumes a state the tree is not in yet:

- (A) **Resolve the in-flight thing first** — finish it, or revert it. *(Only offer
  when `in_flight` is present; make it the default.)*
- (B) Start on the first Remaining Work item.
- (C) Show the raw file.
- (D) Just needed the context.

If A, restate the in-flight bullets and start there. If B, restate the
`next_action` and begin there.

---

## DONE mode

Mark a task finished so it drops out of tomorrow's standup.

### Step 1 — find the newest file for the task

```bash
GSTACK_BIN=""
for d in "$HOME/.claude/skills/gstack/bin" "$HOME/Project/github/dotfiles-claude/bin"; do
  [ -x "$d/gstack-slug" ] && { GSTACK_BIN="$d"; break; }
done
[ -n "$GSTACK_BIN" ] && eval "$("$GSTACK_BIN/gstack-slug" 2>/dev/null)"
SLUG="${SLUG:-$(basename "$PWD" | tr -cd 'a-zA-Z0-9._-')}"
STATE_ROOT="${GSTACK_STATE_ROOT:-$HOME/.gstack}"
CHECKPOINT_DIR="$STATE_ROOT/projects/$SLUG/checkpoints"
find "$CHECKPOINT_DIR" -maxdepth 1 -name '*.md' -type f 2>/dev/null | sort -r
```

Choose the newest file whose `branch:` matches the arg (or the current branch if no
arg), comparing with `/` stripped from both sides. If `done <title-fragment>` was
given, match on title/filename instead.

### Step 2 — flip status in place

This is the ONLY in-place edit this skill makes, and it touches exactly one line.
Read the file, then change `status: in-progress` to `status: done` in the
frontmatter (leave everything else untouched). Use the Edit tool with the
`status: ...` line as the unique match.

Leave `in_flight` exactly as it is — the gate allows one changed line, and the
standup script already hides the in-flight line for done tasks.

### Step 3 — confirm

```
DONE — {title} ({branch}) marked complete. It won't show in the morning standup.
(Run /my-worklog --done to see completed tasks.)
```

---

## Why this design (for future-me reading this skill)

- **One store, not two.** This deliberately writes into the gstack checkpoint dir
  rather than a new root, so there is a single place to remember and
  `/context-restore` keeps working on these files. Everything this skill adds
  (`next_action`, `in_flight`, `session`, and the extra body sections) is optional
  and ignorable, so gstack reads these files fine and always will.
- **Branch == task** drives standup dedup (newest save per branch wins), resume
  matching, and which prior file a save carries forward from. Matching normalizes
  `/` away because the store contains both spellings for the same branch; without
  that, a task's history restarts at session 1 the moment the spelling flips.
- **Cumulative carry-forward, because resume must read one file.** A save captures
  the end state *and* the process, but only the newest file is ever loaded. So each
  save reads the previous one and folds its history forward. The append-only gate
  survives untouched: carry-forward reads the old file and writes a new one. The
  cost is that the newest file is slightly redundant with its predecessor; that is
  the price of a resume that never has to walk a chain.
- **The condensation ladder exists because a self-sufficient file would otherwise
  grow forever.** 10 bullets newest, ≤2 for each of the previous three, ≤3 for
  everything older — a hard ~19-bullet ceiling. It is only safe because of
  promote-before-compress: anything that must outlive the ladder moves to Đã loại
  trừ / Decisions / Notes / Remaining Work *first*. The session log is a narrative
  index; the durable sections are the system of record.
- **`next_action` and `in_flight` are two fields because they answer two
  questions.** Forward: what do I do now. Backward: what did I leave broken. Merging
  them loses the second one every time, and the second one is precisely what
  evaporates overnight — a half-applied edit you were mid-thought on reads as
  finished code the next morning. It is also the field that makes a stale build or
  a dirty tree visible before you waste an hour verifying against it.
- **Dead ends are stored, not just described.** "Đã loại trừ" is the only
  ever-growing section on purpose. Re-digging an eliminated hypothesis is the most
  expensive failure mode in a multi-day task, and it is the one a fresh session is
  most prone to, because a clean hypothesis space looks inviting.
- **The confirmation step shows the session log back.** The only moment the user
  can cheaply correct a wrong bullet is while they still remember the session.
- **The script is the fast path; the skill is the smart path.** `worklog.sh` gives
  an instant terminal glance with zero model cost — now including the one-line
  in-flight marker, so the morning glance shows which tasks have loose ends without
  opening anything. The skill adds judgement: a good `next_action`, an honest
  session log, a human read of what's blocked, and full context reload.
