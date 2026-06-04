#!/usr/bin/env python3
"""
Read a GitLab MR diff for point estimation. (personal, standalone copy)

Usage:
  python3 read-mr.py 4091
  python3 read-mr.py https://gitlab.com/avada/joy/-/merge_requests/4091

Standalone: env loader is inlined so this works in any project without depending
on the joy repo's .claude/scripts/env_loader.py. Credentials resolve from env vars
(GITLAB_TOKEN), then .env.agent (walked up from cwd), then ~/.config/gitlab/token.
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

PROJECT = "avada%2Fjoy"


def get_token():
    token = os.environ.get("GITLAB_TOKEN")
    if not token:
        path = os.path.expanduser("~/.config/gitlab/token")
        if os.path.exists(path):
            token = open(path).read().strip()
    if not token:
        print("Error: Set GITLAB_TOKEN in env, .env.agent, or ~/.config/gitlab/token", file=sys.stderr)
        sys.exit(1)
    return token


def parse_mr_number(arg):
    m = re.search(r'merge_requests/(\d+)', arg)
    if m:
        return m.group(1)
    if arg.isdigit():
        return arg
    raise ValueError(f"Cannot parse MR number from: {arg}")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    mr = parse_mr_number(sys.argv[1])
    token = get_token()

    url = f"https://gitlab.com/api/v4/projects/{PROJECT}/merge_requests/{mr}/changes"
    req = Request(url, headers={"PRIVATE-TOKEN": token})

    try:
        data = json.loads(urlopen(req).read())
    except HTTPError as e:
        print(f"GitLab API error: {e.code}", file=sys.stderr)
        sys.exit(1)

    changes = data.get("changes", [])
    added = sum(c.get("added_lines", 0) for c in changes if isinstance(c.get("added_lines"), int))
    removed = sum(c.get("removed_lines", 0) for c in changes if isinstance(c.get("removed_lines"), int))

    print(f"MR !{mr}: {data.get('title', '?')}")
    print(f"State: {data.get('state', '?')} | Author: {data.get('author', {}).get('name', '?')}")
    print(f"Files: {len(changes)} | Lines: +{added}/-{removed}")
    print()

    # Categorize files by layer
    layers = {"handlers": [], "controllers": [], "services": [], "repositories": [],
              "frontend": [], "extensions": [], "locale": [], "tests": [], "config": [], "other": []}
    for c in changes:
        path = c.get("new_path", "")
        if "handlers/" in path or "pubsub/" in path or "schedule/" in path:
            layers["handlers"].append(path)
        elif "controllers/" in path:
            layers["controllers"].append(path)
        elif "services/" in path:
            layers["services"].append(path)
        elif "repositories/" in path or "Repository" in path:
            layers["repositories"].append(path)
        elif "assets/" in path or "scripttag/" in path or "web-components/" in path:
            layers["frontend"].append(path)
        elif "extensions/" in path:
            layers["extensions"].append(path)
        elif "locale/" in path or "translation" in path.lower():
            layers["locale"].append(path)
        elif "test" in path.lower() or "__test__" in path:
            layers["tests"].append(path)
        elif any(x in path for x in ["config", ".json", ".toml", ".yaml", "const"]):
            layers["config"].append(path)
        else:
            layers["other"].append(path)

    for layer, files in layers.items():
        if files:
            print(f"{layer} ({len(files)}):")
            for f in files[:5]:
                print(f"  {f}")
            if len(files) > 5:
                print(f"  ... and {len(files) - 5} more")
            print()


if __name__ == "__main__":
    main()
