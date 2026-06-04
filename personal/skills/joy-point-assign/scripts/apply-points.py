#!/usr/bin/env python3
"""
Apply estimated points from CSV to Notion Size card field. (personal, standalone copy)

Reads: ./data/point-assign/notion-tasks-estimated.csv (relative to cwd)
Updates: Size card (number) property on each Notion page.

Usage:
  python3 apply-points.py                    # apply all
  python3 apply-points.py --dry-run          # preview without writing
  python3 apply-points.py --file path.csv    # use a specific CSV

Standalone: env loader is inlined so this works in any project without depending
on the joy repo's .claude/scripts/env_loader.py.
"""

import argparse, json, os, csv, sys, time
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


def main():
    parser = argparse.ArgumentParser(description="Apply estimated points to Notion")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing")
    parser.add_argument("--file", default=None,
                        help="CSV file path (default: ./data/point-assign/notion-tasks-estimated.csv)")
    args = parser.parse_args()

    csv_path = args.file or os.path.join(
        os.getcwd(), "data", "point-assign", "notion-tasks-estimated.csv"
    )

    if not os.path.exists(csv_path):
        print(f"Error: {csv_path} not found", file=sys.stderr)
        sys.exit(1)

    key = get_api_key()
    headers = {
        "Authorization": f"Bearer {key}",
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
    }

    rows = list(csv.DictReader(open(csv_path, encoding="utf-8")))
    rows_with_points = [r for r in rows if r.get("proposed_points", "").strip()]

    if not rows_with_points:
        print("No tasks with proposed_points found in CSV.")
        sys.exit(0)

    print(f"{'[DRY RUN] ' if args.dry_run else ''}Applying {len(rows_with_points)} points...\n")

    success = 0
    failed = 0
    for r in rows_with_points:
        pid = r["page_id"]
        pts = int(r["proposed_points"])
        title = r["title"][:50]

        if args.dry_run:
            print(f"  {pts:3d} pts  {title}")
            success += 1
            continue

        body = json.dumps({"properties": {"Size card": {"number": pts}}}).encode()
        req = Request(f"https://api.notion.com/v1/pages/{pid}", data=body, headers=headers, method="PATCH")
        try:
            urlopen(req)
            print(f"  ✅ {pts:3d} pts  {title}")
            success += 1
        except HTTPError as e:
            print(f"  ❌ {title} — {e.code}: {e.read().decode()[:100]}")
            failed += 1
        time.sleep(0.4)

    print(f"\nDone: {success} {'previewed' if args.dry_run else 'updated'}, {failed} failed")


if __name__ == "__main__":
    main()
