---
name: backlog
description: Use for “backlog”, “ý định dài hạn”, “để sau làm”, “someday”, “open a cycle”, “kéo vào sprint”, “drop this idea”, “đẩy việc này sang hôm nay”, or `/backlog`. NOT `/todo`, which is the daily must-do list with no long horizon; NOT `/my-worklog`, which stores per-branch session context for resuming work; NOT `/learn`, which tracks a learning roadmap; NOT `/note` or `/joy-note`, which are knowledge vaults; NOT `/notion-task-personal`, which is the team's Notion board.
---

# /backlog — long-horizon intentions by cycle

Keep wants that may span weeks or months out of the daily must-do list. Store them in
one durable pool, pull a small set into one active cycle, and explicitly distinguish
finished work from ideas deliberately dropped.

Route correctly:

- **Must happen today?** → **/todo**, the daily checklist with no long horizon.
- **Need per-branch session context to resume work?** → **/my-worklog**.
- **Track a learning roadmap?** → **/learn**.
- **Capture knowledge or Joy work knowledge?** → **/note** or **/joy-note**.
- **Manage a team task on Notion?** → **/notion-task-personal**.
- **Want to do it over weeks or months?** → **/backlog**.

Script: `python3 ~/.claude/skills/backlog/scripts/backlog.py`
Storage: `<repo>/personal/backlog/` (override with `BACKLOG_VAULT`).

## Commands

| Command | What it does |
|---------|--------------|
| `add "<text>" [--tag a,b] [--note "..."]` | Append an intention to the pool. Accept trailing inline tags and/or comma-separated `--tag` values; merge and deduplicate them in first-seen order. |
| `list [--tag x] [--all]` (default) | Show the active cycle first, then the pool grouped by tag. Show open items by default; use `--tag` to filter or `--all` to include done and dropped items. |
| `open "<name>" [--until YYYY-MM-DD]` | Open a new cycle. Close the current cycle first when one is active. |
| `pull <N>` | Move pool item **#N** into the active cycle with its id and notes intact. |
| `today <N>` | Add item **#N** to today's `/todo` without its tags, and record the bridge under the backlog item. Works from the cycle or pool. |
| `done <N>` | Mark item **#N** finished with `[x]`. |
| `drop <N>` | Mark item **#N** deliberately dropped with `[~]`. |
| `update <N> [--text "..."] [--tag "a,b"] [--note "..."]` | Edit only the supplied fields in place. `--tag` replaces all tags; `--note ""` clears notes. |
| `close` | Close the active cycle, summarize outcomes, and move every unfinished item back to the pool. |
| `path` | Print the vault path and active cycle file path. |

## Detect scope — parse what comes after `/backlog`

| Input | Behavior |
|-------|----------|
| *(nothing)* / `list` / `xem backlog` / `show backlog` | Run `list`. |
| `<text>` / `thêm <text>` / `để sau <text>` / `add <text>` / `someday <text>` | Run `add`, preserving trailing hashtags and any stated note. |
| `tag <x>` / `lọc tag <x>` / `show tag <x>` | Run `list --tag <x>`. |
| `all` / `tất cả` / `--all` | Run `list --all`. |
| `open <name>` / `mở chu kỳ <name>` / `start cycle <name>` | Run `open`, including `--until` when a deadline is given. |
| `pull <N>` / `kéo <N> vào chu kỳ` / `move <N> to cycle` | Run `pull <N>`. |
| `today <N>` / `hôm nay làm <N>` / `send <N> to todo` | Run `today <N>`. |
| `done <N>` / `xong <N>` / `hoàn thành <N>` | Run `done <N>`. |
| `drop <N>` / `bỏ <N>` / `không làm <N>` | Run `drop <N>`, not `done`. |
| `update <N> ...` / `sửa <N> ...` / `đổi <N> ...` | Map changed text, tags, or notes to `--text`, `--tag`, or `--note`. |
| `close` / `đóng chu kỳ` / `end cycle` | Run `close`. |
| `path` / `đường dẫn` | Run `path`. |

Always run `list` first when the visible numbering may be stale. `pull`, `today`,
`done`, `drop`, and `update` resolve `<N>` against the most recent list ordering.

When the user gives several intentions at once, call `add` once per intention. Keep
each item to one faithful line. Put supporting context in `--note`, and keep technical
terms in their original language.

## Speed first

Act and report in one turn. For capture, run `add` and return its confirmation. For a
no-argument invocation, return the script's `list` output as the deliverable.

## Examples

```bash
python3 ~/.claude/skills/backlog/scripts/backlog.py add \
  "hạ ngưỡng chấm điểm /read-vi #skill" --tag tooling \
  --note "dịch đang lâu hơn đáng kể vì ngưỡng cao"
python3 ~/.claude/skills/backlog/scripts/backlog.py add \
  "học microservices cho tới khi dựng được service thật #học"

python3 ~/.claude/skills/backlog/scripts/backlog.py list
python3 ~/.claude/skills/backlog/scripts/backlog.py open "sprint 08" --until 2026-09-15
python3 ~/.claude/skills/backlog/scripts/backlog.py pull 1
python3 ~/.claude/skills/backlog/scripts/backlog.py today 1
python3 ~/.claude/skills/backlog/scripts/backlog.py done 1
python3 ~/.claude/skills/backlog/scripts/backlog.py drop 2
python3 ~/.claude/skills/backlog/scripts/backlog.py update 3 \
  --text "revamp wishlist UI" --tag "ui,wishlist"
python3 ~/.claude/skills/backlog/scripts/backlog.py list --all
python3 ~/.claude/skills/backlog/scripts/backlog.py close
```

## Setup note

The vault defaults to `<repo>/personal/backlog/` and is created on first use; override
it with `BACKLOG_VAULT`. The skill is reached through
`~/.claude/skills/backlog`; if that symlink is missing, let the normal personal-skill
sync setup create it. Do not create the symlink from this skill. The `/todo` bridge
invokes the sibling script as a subprocess and does not modify its implementation.
