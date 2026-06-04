#!/usr/bin/env python3
"""
Read a Notion task for point estimation. (personal, standalone copy)

Usage:
  python3 read-task.py <page_id_or_url>
  python3 read-task.py https://www.notion.so/avadagroup/Widget-Add-Minimal-32db0da449f1813d8cf3c42b04bb537d

Standalone: env loader is inlined so this works in any project without depending
on the joy repo's .claude/scripts/env_loader.py. Credentials resolve from env vars
(NOTION_API_KEY), then .env.agent (walked up from cwd), then ~/.config/notion/api_key.
"""

import json, os, re, sys
from urllib.request import urlopen, Request
from urllib.error import HTTPError


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


def notion_api(method, path):
    key = get_api_key()
    req = Request(f"https://api.notion.com/v1{path}", headers={
        "Authorization": f"Bearer {key}",
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
    })
    return json.loads(urlopen(req).read())


def parse_page_id(arg):
    m = re.search(r'([0-9a-f]{32})$', arg.replace("-", ""))
    if m:
        raw = m.group(1)
        return f"{raw[:8]}-{raw[8:12]}-{raw[12:16]}-{raw[16:20]}-{raw[20:]}"
    if re.match(r'^[0-9a-f-]{36}$', arg):
        return arg
    raise ValueError(f"Cannot parse page ID from: {arg}")


def prop(props, name, ptype):
    p = props.get(name, {})
    if ptype == "title":
        return "".join(t.get("plain_text", "") for t in p.get("title", [])).strip()
    elif ptype == "status":
        return (p.get("status") or {}).get("name", "")
    elif ptype == "select":
        return (p.get("select") or {}).get("name", "")
    elif ptype == "number":
        return p.get("number")
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
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    page_id = parse_page_id(sys.argv[1])
    page = notion_api("GET", f"/pages/{page_id}")
    p = page["properties"]

    print(f"Title:     {prop(p, 'Task name', 'title')}")
    print(f"Status:    {prop(p, 'Status', 'status')}")
    print(f"Priority:  {prop(p, 'Priority', 'select')}")
    print(f"Labels:    {prop(p, 'Labels', 'multi_select')}")
    print(f"Due:       {prop(p, 'Due date', 'date')}")
    print(f"Developer: {prop(p, 'Developer', 'people')}")
    print(f"Reviewer:  {prop(p, 'Reviewer', 'people')}")
    print(f"Tester:    {prop(p, 'Tester', 'people')}")
    print(f"MR:        {prop(p, 'DEV | MR', 'rich_text')}")
    print(f"Staging:   {prop(p, 'Staging', 'rich_text')}")
    print(f"Size card: {prop(p, 'Size card', 'number')}")
    print(f"Story pts: {prop(p, 'Story points', 'number')}")
    print(f"URL:       {page.get('url', '')}")

    # Page body content
    blocks = notion_api("GET", f"/blocks/{page_id}/children?page_size=100")
    content = blocks.get("results", [])
    if content:
        print("\n--- Task Description ---")
        for block in content:
            btype = block.get("type", "")
            bdata = block.get(btype, {})
            if btype in ("paragraph", "heading_2", "heading_3", "bulleted_list_item",
                         "numbered_list_item", "to_do"):
                text = "".join(t.get("plain_text", "") for t in bdata.get("rich_text", []))
                prefix = {"heading_2": "## ", "heading_3": "### ",
                          "bulleted_list_item": "- ", "numbered_list_item": "1. "}.get(btype, "")
                if btype == "to_do":
                    checked = "x" if bdata.get("checked") else " "
                    prefix = f"- [{checked}] "
                if text:
                    print(f"{prefix}{text}")
            elif btype == "image":
                print("[Image]")
            elif btype == "divider":
                print("---")


if __name__ == "__main__":
    main()
