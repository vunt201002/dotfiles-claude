# Joy Task Board — Property Schema

## Database IDs

| Board | Database ID |
|---|---|
| Joy Board | `37e9a9f0-ff6a-42d6-a6f4-fdd46389acd2` |
| Support Board | `306b0da449f180119f18e9bf5f71c1a9` |
| Sales Meeting | `31fb0da449f1804db437ff4742056a4b` |
| Data Source ID | `74bfb6cb-c769-4121-b1ec-887b2765d625` |

## Properties

### Task name (title)
```json
{"Task name": {"title": [{"text": {"content": "Fix HMAC validation"}}]}}
```

### Status (status)
Values: To do, Doing, Analyzing, Ready, Ready to Test, Testing, Test production, To review, Reviewing, To deploy, UAT, Launching, Done, Archived, Ideas backlog, Pending

```json
{"Status": {"status": {"name": "Doing"}}}
```

### Priority (select)
Values: Low, Medium, High, Urgent, Critical

```json
{"Priority": {"select": {"name": "High"}}}
```

### Due date (date)
```json
{"Due date": {"date": {"start": "2026-04-10"}}}
```

### Labels (multi_select)
Values: Bug, Feature request, Improvement, Integration, Ultimate, Advanced, Essential, etc.

```json
{"Labels": {"multi_select": [{"name": "Bug"}, {"name": "Integration"}]}}
```

### DEV | MR (rich_text)
GitLab MR link.

```json
{"DEV | MR": {"rich_text": [{"text": {"content": "https://gitlab.com/avada/joy/-/merge_requests/4100", "link": {"url": "https://gitlab.com/avada/joy/-/merge_requests/4100"}}}]}}
```

### Staging (rich_text)
Staging environment number.

```json
{"Staging": {"rich_text": [{"text": {"content": "21"}}]}}
```

### Assignee (people)
Tech leads assigned for review. Multi-person.

```json
{"Assignee": {"people": [{"id": "bdda85c7-d04e-42e9-be48-13bc4eb64e98"}]}}
```

### Developer (people)
Developer doing the work.

```json
{"Developer": {"people": [{"id": "USER_ID"}]}}
```

### Tester (people)
QC team members. Multi-person.

```json
{"Tester": {"people": [{"id": "b3b15b62-256d-4844-8026-429386acb9c3"}]}}
```

### BA (people)
Business analyst (rarely used).

### Followers (people)
Watchers on the task.

### Test case (rich_text)
QA test case reference.

### Feature Categories (relation)
Related feature category pages.

### Lived at (date)
When the task was in a specific status (tracking).

## Reading Properties

```python
# Title
title = "".join(t["plain_text"] for t in props["Task name"]["title"])

# Status
status = props["Status"]["status"]["name"]

# Select
priority = (props["Priority"]["select"] or {}).get("name", "")

# Multi-select
labels = [s["name"] for s in props["Labels"]["multi_select"]]

# Date
due = (props["Due date"]["date"] or {}).get("start", "")

# People
assignees = [p["name"] for p in props["Assignee"]["people"]]

# Rich text
mr = "".join(t["plain_text"] for t in props["DEV | MR"]["rich_text"])
```

## Team Members

| Person | Role | Notion User ID |
|---|---|---|
| Win | Tech Lead | `bdda85c7-d04e-42e9-be48-13bc4eb64e98` |
| Trần Văn Nghĩa | Tech Lead | `6f8f2637-3765-44cc-8f9d-1604b5a72841` |
| Nguyễn Thị Mai | QC | `b3b15b62-256d-4844-8026-429386acb9c3` |
| Lan Anh | QC | `41d29b86-5610-4143-9386-7b4f591ede67` |
| Đinh Thị Thu Trang | QC | `2f7d872b-594c-81e0-a8de-000262db3328` |
| Sơn Bùi Khánh | PO | `1e1d872b-594c-819d-becf-0002730da3af` |

## Query Patterns

### Using data_sources endpoint (recommended)
```python
notion_api("POST", f"/data_sources/{DATA_SOURCE_ID}/query", {
    "page_size": 100,
    "filter": {
        "and": [
            {"property": "Status", "status": {"equals": "Testing"}},
            {"property": "Priority", "select": {"equals": "High"}},
        ]
    },
    "sorts": [{"property": "Due date", "direction": "ascending"}]
})
```

### Filter operators by type

**Status:** `equals`, `does_not_equal`
**Select:** `equals`, `does_not_equal`, `is_empty`, `is_not_empty`
**Multi-select:** `contains`, `does_not_contain`
**Date:** `equals`, `before`, `after`, `on_or_before`, `on_or_after`, `is_empty`, `is_not_empty`
**Title/Rich text:** `contains`, `does_not_contain`, `equals`, `starts_with`, `ends_with`
**People:** `contains`, `does_not_contain` (by user ID)