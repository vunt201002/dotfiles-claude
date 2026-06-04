#!/usr/bin/env python3
"""
Export Notion tasks with null Size card for point estimation. (personal, standalone copy)

Filters: Status from Ready to Test → Done (excludes Archived, Ideas backlog,
To do, Analyzing, PRD ready, Designing, Ready, Doing, Pending).
Also excludes tasks last edited before the current year (stale).

Output: ./data/point-assign/notion-tasks-to-estimate.csv (relative to cwd)

Standalone: env loader is inlined so this works in any project without depending
on the joy repo's .claude/scripts/env_loader.py.
"""

import json, os, csv, sys
from datetime import datetime
from urllib.request import urlopen, Request


# === Inlined env loader (walks up from cwd to find .env.agent) ===

def _parse_env_file(path):
    env_dir = os.path.dirname(os.path.abspath(path))
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
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

try:
    import certifi
    os.environ.setdefault('SSL_CERT_FILE', certifi.where())
except ImportError:
    pass

NOTION_VERSION = "2025-09-03"
DATA_SOURCE = "74bfb6cb-c769-4121-b1ec-887b2765d625"
ASSIGNABLE = {
    "Ready to Test", "Testing", "UAT", "To review", "Reviewing",
    "To deploy", "Test Production", "Launching", "Done",
}
CURRENT_YEAR = str(datetime.now().year)


def get_api_key():
    key = os.environ.get("NOTION_API_KEY")
    if not key:
        path = os.path.expanduser("~/.config/notion/api_key")
        if os.path.exists(path):
            key = open(path).read().strip()
    if not key:
        print("Error: Set NOTION_API_KEY in env, .env.agent, or ~/.config/notion/api_key", file=sys.stderr)
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
    return json.loads(urlopen(req).read())


def get_prop(props, name, ptype):
    p = props.get(name, {})
    if ptype == "title":
        return "".join(t.get("plain_text", "") for t in p.get("title", [])).strip()
    elif ptype == "status":
        return (p.get("status") or {}).get("name", "")
    elif ptype == "select":
        return (p.get("select") or {}).get("name", "")
    elif ptype == "date":
        return (p.get("date") or {}).get("start", "")
    elif ptype == "rich_text":
        return "".join(t.get("plain_text", "") for t in p.get("rich_text", [])).strip()
    elif ptype == "people":
        return ", ".join(pp.get("name", "") for pp in p.get("people", []))
    elif ptype == "multi_select":
        return ", ".join(s.get("name", "") for s in p.get("multi_select", []))
    return ""


def main():
    # Paginated query: null Size card
    pages = []
    cursor = None
    while True:
        body = {
            "page_size": 100,
            "filter": {"property": "Size card", "number": {"is_empty": True}},
            "sorts": [{"property": "Due date", "direction": "ascending"}],
        }
        if cursor:
            body["start_cursor"] = cursor
        result = notion_api("POST", f"/data_sources/{DATA_SOURCE}/query", body)
        pages.extend(result.get("results", []))
        if result.get("has_more"):
            cursor = result["next_cursor"]
        else:
            break

    # Output to ./data/point-assign/ relative to cwd
    out_dir = os.path.join(os.getcwd(), "data", "point-assign")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "notion-tasks-to-estimate.csv")

    count = 0
    skipped_status = 0
    skipped_stale = 0

    with open(out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["page_id", "title", "status", "priority", "labels", "due_date",
                         "developer", "mr", "staging", "proposed_points"])

        for page in pages:
            props = page["properties"]
            status = get_prop(props, "Status", "status")
            if status not in ASSIGNABLE:
                skipped_status += 1
                continue

            edited_year = page.get("last_edited_time", "")[:4]
            if edited_year != CURRENT_YEAR:
                skipped_stale += 1
                continue

            title = get_prop(props, "Task name", "title")
            if not title:
                continue

            writer.writerow([
                page["id"], title[:100], status,
                get_prop(props, "Priority", "select"),
                get_prop(props, "Labels", "multi_select"),
                get_prop(props, "Due date", "date"),
                get_prop(props, "Developer", "people"),
                get_prop(props, "DEV | MR", "rich_text")[:100],
                get_prop(props, "Staging", "rich_text"),
                "",
            ])
            count += 1

    print(f"Exported {count} tasks to {out_path}")
    print(f"Skipped: {skipped_status} wrong status, {skipped_stale} stale ({CURRENT_YEAR} only)")


if __name__ == "__main__":
    main()
