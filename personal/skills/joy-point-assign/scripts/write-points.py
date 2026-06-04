#!/usr/bin/env python3
"""
Write Size card points to a single Notion task. (personal, standalone copy)

Usage:
  python3 write-points.py <page_id_or_url> <points>
  python3 write-points.py 32db0da449f1813d8cf3c42b04bb537d 13

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


def parse_page_id(arg):
    m = re.search(r'([0-9a-f]{32})$', arg.replace("-", ""))
    if m:
        raw = m.group(1)
        return f"{raw[:8]}-{raw[8:12]}-{raw[12:16]}-{raw[16:20]}-{raw[20:]}"
    if re.match(r'^[0-9a-f-]{36}$', arg):
        return arg
    raise ValueError(f"Cannot parse page ID from: {arg}")


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)

    page_id = parse_page_id(sys.argv[1])
    points = int(sys.argv[2])

    key = get_api_key()
    body = json.dumps({"properties": {"Size card": {"number": points}}}).encode()
    req = Request(f"https://api.notion.com/v1/pages/{page_id}", data=body, method="PATCH", headers={
        "Authorization": f"Bearer {key}",
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
    })

    try:
        page = json.loads(urlopen(req).read())
        title = "".join(t.get("plain_text", "") for t in page["properties"].get("Task name", {}).get("title", []))
        print(f"✅ Set Size card = {points} on: {title}")
    except HTTPError as e:
        print(f"❌ Failed: {e.code} — {e.read().decode()[:200]}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
