#!/usr/bin/env python3
"""
Notion Tasks — Joy Task Board CLI (personal copy)

Standalone version: env_loader is inlined so this skill works in any project
without depending on .claude/scripts/env_loader.py.

Usage:
  python3 notion-tasks.py list [--status S] [--priority P] [--assignee A] [--search Q] [--overdue]
  python3 notion-tasks.py get <page_id_or_url>
  python3 notion-tasks.py create --title "..." [--status S] [--priority P] [--label L] [--due DATE] [--mr URL]
  python3 notion-tasks.py update <page_id> [--status S] [--priority P] [--mr URL] [--due DATE]
  python3 notion-tasks.py comment <page_id> "message" [--mention NOTION_USER_ID]
"""

import argparse
import json
import os
import re
import sys
from datetime import datetime, timedelta
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.error import HTTPError


# === Inlined env loader (walks up from cwd to find .env.agent) ===

def _parse_env_file(path):
    env_dir = os.path.dirname(os.path.abspath(path))
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if value.startswith("~"):
                value = os.path.expanduser(value)
            elif not value.startswith("/") and (os.sep in value or "/" in value):
                resolved = os.path.join(env_dir, value)
                if os.path.exists(resolved):
                    value = os.path.abspath(resolved)
            if key not in os.environ:
                os.environ[key] = value


def load_env_agent():
    """Walk up from cwd to find .env.agent (or .env.debug as fallback)."""
    current = os.getcwd()
    for _ in range(10):
        for name in (".env.agent", ".env.debug"):
            env_file = os.path.join(current, name)
            if os.path.exists(env_file):
                _parse_env_file(env_file)
                return env_file
        parent = os.path.dirname(current)
        if parent == current:
            break
        current = parent
    return None


load_env_agent()

# Try to fix macOS SSL
try:
    import certifi
    os.environ.setdefault('SSL_CERT_FILE', certifi.where())
except ImportError:
    pass

NOTION_VERSION = "2026-03-11"
DATA_SOURCE_ID = "74bfb6cb-c769-4121-b1ec-887b2765d625"
JOY_BOARD_DB = "37e9a9f0-ff6a-42d6-a6f4-fdd46389acd2"
SUPPORT_BOARD_DB = "306b0da449f180119f18e9bf5f71c1a9"
BOARD_URL = "https://www.notion.so/avadagroup/37e9a9f0ff6a42d6a6f4fdd46389acd2"

SKIP_STATUSES = {"Done", "Archived", "Ideas backlog", "Pending"}


def get_api_key():
    key = os.environ.get("NOTION_API_KEY")
    if not key:
        key_file = os.path.expanduser("~/.config/notion/api_key")
        if os.path.exists(key_file):
            key = open(key_file).read().strip()
    if not key:
        print("Error: Set NOTION_API_KEY in .env.agent or ~/.config/notion/api_key", file=sys.stderr)
        sys.exit(1)
    return key


def notion_api(method, path, body=None):
    key = get_api_key()
    url = f"https://api.notion.com/v1{path}"
    data = json.dumps(body).encode() if body else None
    req = Request(url, data=data, method=method, headers={
        "Authorization": f"Bearer {key}",
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
    })
    try:
        with urlopen(req) as resp:
            return json.loads(resp.read())
    except HTTPError as e:
        err_body = e.read().decode()
        print(f"Notion API error ({e.code}): {err_body}", file=sys.stderr)
        sys.exit(1)


def parse_page_id(arg):
    """Extract page ID from URL or raw ID."""
    m = re.search(r'([0-9a-f]{32})$', arg.replace("-", ""))
    if m:
        raw = m.group(1)
        return f"{raw[:8]}-{raw[8:12]}-{raw[12:16]}-{raw[16:20]}-{raw[20:]}"
    if re.match(r'^[0-9a-f-]{36}$', arg):
        return arg
    if re.match(r'^[0-9a-f]{32}$', arg):
        return f"{arg[:8]}-{arg[8:12]}-{arg[12:16]}-{arg[16:20]}-{arg[20:]}"
    raise ValueError(f"Cannot parse page ID from: {arg}")


# === Property helpers ===

def prop_title(props, field="Task name"):
    parts = props.get(field, {}).get("title", [])
    return "".join(t.get("plain_text", "") for t in parts).strip()


def prop_status(props):
    return (props.get("Status", {}).get("status") or {}).get("name", "")


def prop_select(props, field):
    return (props.get(field, {}).get("select") or {}).get("name", "")


def prop_multi_select(props, field):
    return [s.get("name", "") for s in props.get(field, {}).get("multi_select", [])]


def prop_date(props, field="Due date"):
    return (props.get(field, {}).get("date") or {}).get("start", "")


def prop_rich_text(props, field):
    parts = props.get(field, {}).get("rich_text", [])
    return "".join(t.get("plain_text", "") for t in parts).strip()


def prop_people(props, field):
    return [p.get("name", "").strip() for p in props.get(field, {}).get("people", []) if p.get("name")]


def format_task(page):
    props = page["properties"]
    title = prop_title(props)
    status = prop_status(props)
    priority = prop_select(props, "Priority")
    due = prop_date(props)
    mr = prop_rich_text(props, "DEV | MR")
    assignee = prop_people(props, "Assignee")
    developer = prop_people(props, "Developer")
    labels = prop_multi_select(props, "Labels")
    staging = prop_rich_text(props, "Staging")
    url = page.get("url", "")

    lines = [f"  {title}"]
    meta = []
    if status:
        meta.append(f"Status: {status}")
    if priority:
        meta.append(f"Priority: {priority}")
    if due:
        meta.append(f"Due: {due}")
    if labels:
        meta.append(f"Labels: {', '.join(labels)}")
    if meta:
        lines.append(f"    {' | '.join(meta)}")

    people = []
    if developer:
        people.append(f"Dev: {', '.join(developer)}")
    if assignee:
        people.append(f"Assignee: {', '.join(assignee)}")
    if people:
        lines.append(f"    {' | '.join(people)}")

    if mr:
        lines.append(f"    MR: {mr.split(chr(10))[0]}")
    if staging:
        lines.append(f"    Staging: {staging}")
    lines.append(f"    {url}")
    return "\n".join(lines)


# === Markdown → Notion Blocks ===

def _rich_text(content):
    """Split text into 2000-char chunks for Notion API limit."""
    chunks = []
    while content:
        chunks.append({"type": "text", "text": {"content": content[:2000]}})
        content = content[2000:]
    return chunks


def markdown_to_blocks(text):
    """Parse markdown text into Notion block objects."""
    blocks = []
    for line in text.split("\n"):
        stripped = line.strip()
        if not stripped:
            continue
        if stripped == "---":
            blocks.append({"object": "block", "type": "divider", "divider": {}})
        elif stripped.startswith("## "):
            blocks.append({"object": "block", "type": "heading_2",
                           "heading_2": {"rich_text": _rich_text(stripped[3:])}})
        elif stripped.startswith("### "):
            blocks.append({"object": "block", "type": "heading_3",
                           "heading_3": {"rich_text": _rich_text(stripped[4:])}})
        elif stripped.startswith("- [ ] ") or stripped.startswith("- [x] "):
            checked = stripped[3] == "x"
            blocks.append({"object": "block", "type": "to_do",
                           "to_do": {"rich_text": _rich_text(stripped[6:]), "checked": checked}})
        elif stripped.startswith("- ") or stripped.startswith("* "):
            blocks.append({"object": "block", "type": "bulleted_list_item",
                           "bulleted_list_item": {"rich_text": _rich_text(stripped[2:])}})
        elif re.match(r'^\d+\.\s', stripped):
            text_content = re.sub(r'^\d+\.\s', '', stripped)
            blocks.append({"object": "block", "type": "numbered_list_item",
                           "numbered_list_item": {"rich_text": _rich_text(text_content)}})
        elif stripped.startswith("```"):
            continue
        else:
            blocks.append({"object": "block", "type": "paragraph",
                           "paragraph": {"rich_text": _rich_text(stripped)}})
    return blocks


def load_body(body_arg):
    """Load body from file path or return as text. Returns list of Notion blocks."""
    if not body_arg:
        return []
    path = Path(body_arg)
    if path.exists() and path.is_file():
        text = path.read_text(encoding="utf-8")
    else:
        text = body_arg
    return markdown_to_blocks(text)


# === Commands ===

def cmd_list(args):
    filters = []

    if args.status:
        filters.append({"property": "Status", "status": {"equals": args.status}})

    if args.priority:
        filters.append({"property": "Priority", "select": {"equals": args.priority}})

    if args.search:
        filters.append({"property": "Task name", "title": {"contains": args.search}})

    if args.overdue:
        today = datetime.now().date().isoformat()
        filters.append({"property": "Due date", "date": {"before": today}})
        filters.append({"property": "Due date", "date": {"is_not_empty": True}})

    if args.assignee:
        pass

    filter_body = {"and": filters} if len(filters) > 1 else (filters[0] if filters else {})

    pages = []
    cursor = None
    while True:
        body = {
            "page_size": 100,
            "sorts": [{"property": "Due date", "direction": "ascending"}],
        }
        if filter_body:
            body["filter"] = filter_body
        if cursor:
            body["start_cursor"] = cursor

        result = notion_api("POST", f"/data_sources/{DATA_SOURCE_ID}/query", body)
        pages.extend(result.get("results", []))
        if result.get("has_more"):
            cursor = result.get("next_cursor")
        else:
            break

    if not args.status or args.status not in SKIP_STATUSES:
        pages = [p for p in pages if prop_status(p["properties"]) not in SKIP_STATUSES]

    if args.assignee:
        name_lower = args.assignee.lower()
        pages = [p for p in pages if any(
            name_lower in n.lower()
            for n in prop_people(p["properties"], "Assignee") +
                     prop_people(p["properties"], "Developer") +
                     prop_people(p["properties"], "Tester")
        )]

    if not pages:
        print("No tasks found.")
        return

    print(f"Found {len(pages)} tasks:\n")
    for page in pages:
        print(format_task(page))
        print()


def cmd_get(args):
    page_id = parse_page_id(args.page_id)
    page = notion_api("GET", f"/pages/{page_id}")
    print(format_task(page))

    blocks = notion_api("GET", f"/blocks/{page_id}/children?page_size=100")
    content_blocks = blocks.get("results", [])
    if content_blocks:
        print("\n--- Content ---")
        for block in content_blocks:
            btype = block.get("type", "")
            bdata = block.get(btype, {})
            if btype in ("paragraph", "heading_2", "heading_3", "bulleted_list_item", "numbered_list_item", "to_do"):
                text = "".join(t.get("plain_text", "") for t in bdata.get("rich_text", []))
                prefix = {"heading_2": "## ", "heading_3": "### ", "bulleted_list_item": "- ",
                          "numbered_list_item": "1. "}.get(btype, "")
                if btype == "to_do":
                    checked = "x" if bdata.get("checked") else " "
                    prefix = f"- [{checked}] "
                if text:
                    print(f"{prefix}{text}")
            elif btype == "image":
                print("[Image]")
            elif btype == "divider":
                print("---")


def cmd_create(args):
    properties = {
        "Task name": {"title": [{"text": {"content": args.title}}]},
    }

    if args.status:
        properties["Status"] = {"status": {"name": args.status}}
    else:
        properties["Status"] = {"status": {"name": "To do"}}

    if args.priority:
        properties["Priority"] = {"select": {"name": args.priority}}

    if args.label:
        properties["Labels"] = {"multi_select": [{"name": args.label}]}

    if args.due:
        properties["Due date"] = {"date": {"start": args.due}}

    if args.mr:
        properties["DEV | MR"] = {"rich_text": [{"text": {"content": args.mr, "link": {"url": args.mr}}}]}

    body = {"parent": {"data_source_id": DATA_SOURCE_ID}, "properties": properties}

    children = load_body(getattr(args, 'body', None))
    if children:
        body["children"] = children

    page = notion_api("POST", "/pages", body)

    print(f"Created: {prop_title(page['properties'])}")
    print(f"Status: {prop_status(page['properties'])}")
    print(f"URL: {page.get('url', '')}")


def cmd_update(args):
    page_id = parse_page_id(args.page_id)
    properties = {}

    if args.status:
        properties["Status"] = {"status": {"name": args.status}}
    if args.priority:
        properties["Priority"] = {"select": {"name": args.priority}}
    if args.due:
        properties["Due date"] = {"date": {"start": args.due}}
    if args.mr:
        properties["DEV | MR"] = {"rich_text": [{"text": {"content": args.mr, "link": {"url": args.mr}}}]}

    children = load_body(getattr(args, 'body', None))

    if not properties and not children:
        print("Nothing to update. Specify --status, --priority, --due, --mr, or --body", file=sys.stderr)
        sys.exit(1)

    if properties:
        page = notion_api("PATCH", f"/pages/{page_id}", {"properties": properties})
        print(f"Updated: {prop_title(page['properties'])}")
        print(f"Status: {prop_status(page['properties'])}")
        print(f"URL: {page.get('url', '')}")

    if children:
        notion_api("PATCH", f"/blocks/{page_id}/children", {"children": children})
        print(f"Body appended ({len(children)} blocks)")


def cmd_comment(args):
    page_id = parse_page_id(args.page_id)

    rich_text = []
    if args.mention:
        rich_text.append({"type": "mention", "mention": {"user": {"id": args.mention}}})
        rich_text.append({"type": "text", "text": {"content": " "}})

    rich_text.append({"type": "text", "text": {"content": args.message}})

    notion_api("POST", "/comments", {
        "parent": {"page_id": page_id},
        "rich_text": rich_text,
    })
    print(f"Comment posted on {page_id}")


def main():
    parser = argparse.ArgumentParser(description="Notion Tasks — Joy Task Board CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    p_list = subparsers.add_parser("list", help="Query tasks")
    p_list.add_argument("--status", help="Filter by status (e.g., Doing, Testing)")
    p_list.add_argument("--priority", help="Filter by priority (e.g., High, Critical)")
    p_list.add_argument("--assignee", help="Filter by person name (searches all people fields)")
    p_list.add_argument("--search", help="Search by title keyword")
    p_list.add_argument("--overdue", action="store_true", help="Show overdue tasks only")
    p_list.add_argument("--board", default="joy", choices=["joy", "support"], help="Which board (default: joy)")

    p_get = subparsers.add_parser("get", help="Get task details")
    p_get.add_argument("page_id", help="Page ID or Notion URL")

    p_create = subparsers.add_parser("create", help="Create a task")
    p_create.add_argument("--title", required=True, help="Task title")
    p_create.add_argument("--status", help="Status (default: To do)")
    p_create.add_argument("--priority", help="Priority (Low, Medium, High, Urgent, Critical)")
    p_create.add_argument("--label", help="Label (Bug, Feature request, Improvement, etc.)")
    p_create.add_argument("--due", help="Due date (YYYY-MM-DD)")
    p_create.add_argument("--mr", help="GitLab MR URL")
    p_create.add_argument("--body", help="Body content: markdown text or path to .md file")
    p_create.add_argument("--board", default="joy", choices=["joy", "support"], help="Which board (default: joy)")

    p_update = subparsers.add_parser("update", help="Update a task")
    p_update.add_argument("page_id", help="Page ID or Notion URL")
    p_update.add_argument("--status", help="New status")
    p_update.add_argument("--priority", help="New priority")
    p_update.add_argument("--due", help="New due date (YYYY-MM-DD)")
    p_update.add_argument("--mr", help="GitLab MR URL")
    p_update.add_argument("--body", help="Body content to append: markdown text or path to .md file")

    p_comment = subparsers.add_parser("comment", help="Post a comment")
    p_comment.add_argument("page_id", help="Page ID or Notion URL")
    p_comment.add_argument("message", help="Comment text")
    p_comment.add_argument("--mention", help="Notion user ID to @mention")

    args = parser.parse_args()

    if hasattr(args, 'board') and args.board == "support":
        global JOY_BOARD_DB
        JOY_BOARD_DB = SUPPORT_BOARD_DB

    {"list": cmd_list, "get": cmd_get, "create": cmd_create,
     "update": cmd_update, "comment": cmd_comment}[args.command](args)


if __name__ == "__main__":
    main()
