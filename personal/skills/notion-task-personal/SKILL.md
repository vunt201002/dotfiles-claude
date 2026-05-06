---
name: notion-task-personal
description: Manage Joy task board on Notion — create, update, query, and comment on tasks. Personal copy that works in any project without depending on the project-local notion-tasks skill. Use when asked to create a task, update task status, check what's in progress, find overdue tasks, or post comments/mentions on Notion pages.
---

# Notion Task (Personal) — Joy Task Board Management

Manage the Joy Notion task board directly from Claude Code. Personal copy of `notion-tasks` — usable in any project (env_loader is inlined; no project-local dependencies).

## Setup

Requires `NOTION_API_KEY`. Set it via one of:

- `.env.agent` (or `.env.debug`) at the project root — auto-discovered by walking up from `cwd`
- `~/.config/notion/api_key`
- `NOTION_API_KEY` environment variable

## Script

All operations go through one script:

```bash
python3 ~/.claude/skills/notion-task-personal/scripts/notion-tasks.py <command> [options]
```

## Commands

### Query tasks

```bash
# List tasks by status
python3 ~/.claude/skills/notion-task-personal/scripts/notion-tasks.py list --status "Doing"
python3 ~/.claude/skills/notion-task-personal/scripts/notion-tasks.py list --status "To review"

# List overdue tasks
python3 ~/.claude/skills/notion-task-personal/scripts/notion-tasks.py list --overdue

# List by priority
python3 ~/.claude/skills/notion-task-personal/scripts/notion-tasks.py list --priority "High"

# List tasks assigned to someone
python3 ~/.claude/skills/notion-task-personal/scripts/notion-tasks.py list --assignee "Win"

# Search by title keyword
python3 ~/.claude/skills/notion-task-personal/scripts/notion-tasks.py list --search "webhook"

# Combine filters
python3 ~/.claude/skills/notion-task-personal/scripts/notion-tasks.py list --status "Testing" --priority "High"
```

### Read a task

```bash
# By page ID or URL
python3 ~/.claude/skills/notion-task-personal/scripts/notion-tasks.py get <page_id_or_url>
```

### Create a task

```bash
python3 ~/.claude/skills/notion-task-personal/scripts/notion-tasks.py create \
  --title "Fix webhook HMAC validation" \
  --status "To do" \
  --priority "High" \
  --label "Bug" \
  --due "2026-04-10" \
  --mr "https://gitlab.com/avada/joy/-/merge_requests/4100"

# Minimal (title only, defaults to To do)
python3 ~/.claude/skills/notion-task-personal/scripts/notion-tasks.py create --title "Investigate order #12345"

# With body description (inline markdown)
python3 ~/.claude/skills/notion-task-personal/scripts/notion-tasks.py create \
  --title "Refactor customerRepository" \
  --label "Tech Debt" \
  --body "## Goal
- Extract business logic to customerService
- Keep repo as pure CRUD
## Files
- customerRepository.js
- customerService.js"

# With body from markdown file
python3 ~/.claude/skills/notion-task-personal/scripts/notion-tasks.py create \
  --title "Refactor customerRepository" \
  --body "/path/to/description.md"
```

### Update a task

```bash
# Update status
python3 ~/.claude/skills/notion-task-personal/scripts/notion-tasks.py update <page_id> --status "Doing"

# Update multiple properties
python3 ~/.claude/skills/notion-task-personal/scripts/notion-tasks.py update <page_id> \
  --status "Done" \
  --priority "Medium" \
  --mr "https://gitlab.com/avada/joy/-/merge_requests/4100"

# Append body content to existing task
python3 ~/.claude/skills/notion-task-personal/scripts/notion-tasks.py update <page_id> \
  --body "## Update
- Found root cause in customerRepository.js
- Fix requires extracting to service layer"

# Append body from file
python3 ~/.claude/skills/notion-task-personal/scripts/notion-tasks.py update <page_id> \
  --body "/path/to/update.md"
```

### Comment on a task

```bash
# Post a comment
python3 ~/.claude/skills/notion-task-personal/scripts/notion-tasks.py comment <page_id> "Root cause identified: HMAC key rotation"

# Post with @mention (use Notion user ID)
python3 ~/.claude/skills/notion-task-personal/scripts/notion-tasks.py comment <page_id> "Please review" --mention "bdda85c7-d04e-42e9-be48-13bc4eb64e98"
```

## Task Board Properties

| Property | Type | Values |
|---|---|---|
| Task name | title | Free text |
| Status | status | To do, Doing, Analyzing, Ready, Ready to Test, Testing, Test production, To review, Reviewing, To deploy, UAT, Launching, Done, Archived, Ideas backlog, Pending |
| Priority | select | Low, Medium, High, Urgent, Critical |
| Due date | date | ISO date (2026-04-10) |
| Labels | multi_select | Bug, Feature request, Improvement, etc. |
| DEV \| MR | rich_text | GitLab MR URL |
| Assignee | people | Tech leads (reviewers) |
| Developer | people | Dev doing the work |
| Tester | people | QC team |
| Staging | rich_text | Staging number |

## Team Members (Notion IDs)

| Person | Role | Notion ID |
|---|---|---|
| Win | Tech Lead | `bdda85c7-d04e-42e9-be48-13bc4eb64e98` |
| Trần Văn Nghĩa | Tech Lead | `6f8f2637-3765-44cc-8f9d-1604b5a72841` |
| Nguyễn Thị Mai | QC | `b3b15b62-256d-4844-8026-429386acb9c3` |
| Lan Anh | QC | `41d29b86-5610-4143-9386-7b4f591ede67` |
| Đinh Thị Thu Trang | QC | `2f7d872b-594c-81e0-a8de-000262db3328` |
| Sơn Bùi Khánh | PO | `1e1d872b-594c-819d-becf-0002730da3af` |

## Status → Pending Person Rules

| Status | Pending On |
|---|---|
| To review, Reviewing, To deploy | Tech Lead (from Assignee field) |
| Ready, UAT, Launching | PO (Sơn Bùi Khánh) |
| Ready to Test, Testing, Test production | Tester (from Tester field) |
| Doing, Analyzing, To do | Developer (in progress, no blocker) |
