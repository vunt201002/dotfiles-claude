---
name: todo
description: Quick capture of WORK TODOs into a personal day-keyed vault (~/.todo) — jot what to do next with no context, then read it back tomorrow sorted by priority, and edit any task's text/priority/note later. One file per day, checkbox tasks tagged p1/p2/p3, unfinished tasks auto carry over to the next day's view. NOT a context-restoring worklog (use /my-worklog when you need full session state + branch resume), NOT a learning note (use /note), NOT Joy work knowledge (use /joy-note), NOT the Notion team board (use /notion-task-personal). Use when asked to "todo", "note this task", "ghi việc cần làm", "what should I do next", "remind me to", "sửa task", "update task 2", "đổi priority task", "/todo", or at end of day to jot tomorrow's priorities.
---

# /todo — quick work-todo capture (read back by priority tomorrow)

A dead-simple place to jot work tasks with **no context saving**, then open tomorrow
and start by priority. A Python script writes/reads the files; you just classify priority
and write a faithful one-liner (plus optional note).

This is the lightweight cousin of the heavier tracking skills. Route correctly:

- **Need full session context + resume into the work (keyed by branch)?** → **/my-worklog**.
  That's for "load me back where I left off." /todo deliberately saves NO context.
- **Captured a thing you LEARNED** (concept, TIL, gotcha)? → **/note** (Brain vault).
- **Joy work knowledge** (a bug to watch, how something works, a decision)? → **/joy-note**.
- **A real team task** (assignee, status, board)? → **/notion-task-personal**.
- **/todo** = a personal scratch checklist for "what do I do next," nothing more.

Script: `python3 ~/.claude/skills/todo/scripts/todo.py`
Storage: `~/.todo/YYYY-MM-DD.md` (one file per day; override with `TODO_VAULT`).

## Commands

| Command | What it does |
|---------|--------------|
| `add "<text>" [--note "..."]` | Append a task to TODAY's file. Text may start with `p1:`/`p2:`/`p3:` (default `p2`). `--note` adds indented context lines under it. |
| `list` (default) | Show **open** tasks across all days, grouped P1→P2→P3, **with each task's note lines shown underneath**. Unfinished tasks from earlier days appear with `(từ YYYY-MM-DD)` — this is the carry-over that makes "start tomorrow" work. |
| `list --all` | Same, but include done (`[x]`) tasks too. |
| `list --brief` | Same as `list`, but hides note lines — one line per task, for a quick scan. Combines with `--all`. |
| `done <N>` | Tick task **#N** from the most recent `list` ordering (works across days). |
| `update <N> [--text "..."] [--prio p1\|p2\|p3] [--note "..."]` | Edit task **#N** in place — any combination of flags; only the ones passed change. `--prio` moves it between P1/P2/P3 groups. `--note ""` clears existing note lines; omitting `--note` leaves them untouched. The task stays in the day file it was created in. |
| `path` | Print today's file path (to open it by hand). |

## Detect scope — parse what comes after `/todo`

| Input | Behavior |
|-------|----------|
| *(nothing)* | **Read mode** — run `list`. This is the morning "what do I do next" view; notes show by default. |
| `<text>` (a task) | **Capture mode** — `add` it. Pull a leading `p1:/p2:/p3:` if present. |
| `done <N>` / `xong <N>` | Mark task #N done. |
| `update <N> ...` / `sửa <N> ...` / `đổi <N> ...` | Edit task #N — parse what changed (new text, a `p1:/p2:/p3:` re-tag, a new note) into the matching `--text`/`--prio`/`--note` flags. **Always `list` first** if the last listing is stale (new session, or the user hasn't seen numbers yet) — `update`/`done` both resolve `<N>` against the last `list` output, so a wrong or missing prior listing means the wrong task gets edited. |
| `all` / `--all` | `list --all` (include finished). |
| `brief` / `gọn` / `tóm tắt` | `list --brief` — read mode with note lines hidden, for a quick scan. |
| `path` | Print today's file path. |

When the user dumps **several tasks at once** (the common end-of-day case), call `add`
once per task. Preserve their priority words; if they imply order ("first…, then…"),
map first→p1 and so on. Keep each task to one faithful line; push detail into `--note`.

## Writing the task line

- **One line, imperative, faithful.** "finish merge-branch conflict on .gitlab-ci.yml",
  not a paragraph. Don't invent scope the user didn't say.
- **Priority** = the user's signal (explicit p1/p2/p3, or words like "urgent",
  "first thing", "if I have time"). Default `p2` when unsignaled. Don't over-think it —
  a wrong priority is trivially re-jotted.
- **Optional `--note`** for the one thing future-you needs: where you left off, the
  blocker, a file path. Keep it short — this is NOT a worklog; if you're writing
  paragraphs of state, the user wants **/my-worklog** instead, so say so.
- **Language:** write the task/notes in the user's language (Vietnamese is fine;
  keep code, file names, and tech terms in English).

## Speed first
This skill is for capture-and-go. Default to act-and-report in one turn: parse priority,
`add`, confirm with the `ADDED [P1] ...` line the script prints. For the no-arg read,
just print the `list` output — that's the deliverable.

## Examples

```bash
# End of day — jot tomorrow's three, with one blocker noted:
python3 ~/.claude/skills/todo/scripts/todo.py add "p1: finish merge-branch conflicts" \
  --note "left off: deploy-staging ref rewrite conflicts on .gitlab-ci.yml"
python3 ~/.claude/skills/todo/scripts/todo.py add "review widget v4 layer matrix bug"
python3 ~/.claude/skills/todo/scripts/todo.py add "p3: clean up seen-urls dedup"

# Next morning — read by priority, notes shown (carry-over from prior days shows automatically):
python3 ~/.claude/skills/todo/scripts/todo.py list

# Quick scan — just the task lines, no notes:
python3 ~/.claude/skills/todo/scripts/todo.py list --brief

# Knock one out:
python3 ~/.claude/skills/todo/scripts/todo.py done 1

# Something about task #2 changed — bump priority and add a blocker note:
python3 ~/.claude/skills/todo/scripts/todo.py update 2 --prio p1 --note "blocked on API key"

# Reword task #3, leave its priority and note alone:
python3 ~/.claude/skills/todo/scripts/todo.py update 3 --text "revamp home page metrics, not just manual check"

# Note resolved — clear it without touching text/priority:
python3 ~/.claude/skills/todo/scripts/todo.py update 3 --note ""
```

## Setup note
Vault defaults to `~/.todo/` (created on first `add`; override with `TODO_VAULT`).
The skill is symlinked into `~/.claude/skills/todo` — if it's missing on a machine,
run **/sync-skills** to link it. `add` appends; `done` flips a single checkbox in
place; `update` rewrites a task's own line(s) in place without moving it to a
different day file. Read-only beyond `~/.todo/` — never touches repo code, never commits.
