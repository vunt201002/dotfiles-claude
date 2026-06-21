#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Create/append a note in the personal Brain (learning) vault with correct
frontmatter & topic folder.

  python note.py add --title "..." --type concept --topic "Frontend" [opts]
  python note.py list
  python note.py detect "<text>"

Body via --body or stdin. Existing title -> appends a dated section (unless --new).
"""
import argparse, os, re, sys, datetime

DEFAULT_VAULT = os.path.join(os.path.dirname(__file__), "..", "..", "..", "brain-vault")
VAULT = os.path.abspath(os.environ.get("BRAIN_VAULT", DEFAULT_VAULT))

TYPES = ["concept", "til", "gotcha", "question", "snippet", "resource", "raw"]
RESERVED = {"00-Index", "Templates", "Topics"}

KEYWORDS = {
    "Frontend": ["react", "vue", "svelte", "css", "html", "javascript", "typescript", "lit",
                 "web component", "dom", "browser", "vite", "tailwind", "frontend", "ui", "hook", "jsx",
                 "debounce", "throttle", "closure", "promise", "async", "await", "event loop",
                 "rerender", "re-render", "state management", "flexbox", "grid layout"],
    "Backend": ["node", "api", "express", "koa", "rest", "graphql", "backend", "microservice", "server-side"],
    "System Design": ["system design", "scalability", "scale", "load balanc", "caching", "cache",
                      "queue", "distributed", "throughput", "latency", "cap theorem", "sharding", "replication"],
    "DSA": ["algorithm", "data structure", "big-o", "big o", "complexity", "dynamic programming",
            "graph", "binary tree", "sorting", "leetcode", "dsa", "recursion", "hash table"],
    "Databases": ["sql", "postgres", "mysql", "mongodb", "firestore", "index", "transaction",
                  "database", "query plan", "nosql", "bigquery", "acid", "join"],
    "DevOps & Infra": ["docker", "kubernetes", "k8s", "ci/cd", "terraform", "aws", "gcp", "deploy",
                       "infra", "devops", "nginx", "observability", "pipeline"],
    "Security": ["security", "auth", "oauth", "jwt", "xss", "csrf", "injection", "crypto",
                 "owasp", "hmac", "tls", "vulnerab", "encrypt"],
    "AI & LLM": ["llm", "prompt", "rag", "embedding", "fine-tun", "openai", "claude", "gemini",
                 "agent", "token", "vector", "ai "],
    "CS Fundamentals": ["operating system", "network", "tcp", "udp", "http", "compiler", "memory",
                        "concurrency", "thread", "process", " os ", "kernel", "garbage collect"],
    "Career & Soft Skills": ["career", "leadership", "communication", "senior", "lead", "interview",
                             "soft skill", "management", "mentor", "promotion", "feedback"],
    "Tools": ["git", "vscode", "obsidian", "cli", "shell", "terminal", "shortcut", "productivity",
              "tmux", "vim", "regex"],
}

def today(): return datetime.date.today().isoformat()
def topics():
    d = os.path.join(VAULT, "Topics")
    return sorted([n for n in os.listdir(d) if os.path.isdir(os.path.join(d, n))]) if os.path.isdir(d) else []
def slug_filename(title): return (re.sub(r'[\\/:*?"<>|]', "-", title).strip())[:120] or "untitled"

def fuzzy(target, options):
    if not target: return None
    t = target.strip().lower()
    for o in options:
        if o.lower() == t: return o
    for o in options:
        if t in o.lower() or o.lower() in t: return o
    tt = set(re.split(r"\W+", t)); best, sc = None, 0
    for o in options:
        s = len(tt & set(re.split(r"\W+", o.lower())))
        if s > sc: best, sc = o, s
    return best

def detect_topic(text):
    t = (text or "").lower(); valid = set(topics()); scores = {}
    for name, kws in KEYWORDS.items():
        if name not in valid: continue
        s = sum(1 for kw in kws if kw in t)
        if s: scores[name] = s
    ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
    return (ranked[0][0] if ranked else None), ranked

def topic_moc(name, desc):
    DV, END = "```dataview", "```"
    return f"""---
type: moc
tags: [learn, moc]
---
# {name}

> {desc or 'Mảng kiến thức.'}

## 📒 Notes
{DV}
TABLE WITHOUT ID file.link AS Note, type AS "Loại", status AS "TT", updated AS "Cập nhật"
WHERE file.folder = this.file.folder AND file.name != "_MOC" AND type != "raw"
SORT type ASC, file.name ASC
{END}

## ❓ Câu hỏi mở ở mảng này
{DV}
TABLE WITHOUT ID file.link AS Note, created AS "Ngày"
WHERE file.folder = this.file.folder AND type = "question" AND status != "answered"
SORT created DESC
{END}

## 🗃 raw (ghi nhanh, chưa xử lý)
{DV}
LIST
WHERE file.folder = this.file.folder + "/raw"
{END}
"""

def ensure_topic(name, desc=""):
    """Return an existing topic (fuzzy) or CREATE a new topic folder (+_MOC +raw)."""
    safe = (re.sub(r'[\\/:*?"<>|]', "-", name).strip())[:60]
    folder = os.path.join(VAULT, "Topics", safe)
    if not os.path.isdir(folder):
        os.makedirs(os.path.join(folder, "raw"), exist_ok=True)
        open(os.path.join(folder, "raw", ".gitkeep"), "w").close()
        with open(os.path.join(folder, "_MOC.md"), "w", encoding="utf-8") as f:
            f.write(topic_moc(safe, desc))
        print(f"[new topic] created Topics/{safe}")
    return safe

def resolve_folder(ntype, topic, desc=""):
    if topic:
        m = fuzzy(topic, topics())
        name = m if m else ensure_topic(topic, desc)   # create when genuinely new
        base = os.path.join("Topics", name)
    else:
        base = "Inbox"
    return os.path.join(base, "raw") if ntype == "raw" else base

def build_frontmatter(ntype, status):
    fm = ["---", f"type: {ntype}"]
    if ntype == "question":
        fm.append(f"status: {status or 'open'}")
    elif status:
        fm.append(f"status: {status}")
    fm += [f"created: {today()}", f"updated: {today()}", "tags: [learn]", "---"]
    return "\n".join(fm)

def main():
    ap = argparse.ArgumentParser(); sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list")
    d = sub.add_parser("detect"); d.add_argument("text", nargs="*")
    a = sub.add_parser("add")
    a.add_argument("--title", required=True)
    a.add_argument("--type", default="concept", choices=TYPES)
    a.add_argument("--topic", "--area", dest="topic", default="")
    a.add_argument("--topic-desc", dest="topic_desc", default="")  # used when creating a new topic
    a.add_argument("--status", default="")
    a.add_argument("--body", default=None)
    a.add_argument("--links", default="")
    a.add_argument("--new", action="store_true")
    a.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not os.path.isdir(VAULT): sys.exit(f"Vault not found: {VAULT} (set BRAIN_VAULT)")

    if args.cmd == "list":
        print("Topics:", ", ".join(topics())); print("Types: ", ", ".join(TYPES)); return
    if args.cmd == "detect":
        text = " ".join(args.text) or (sys.stdin.read() if not sys.stdin.isatty() else "")
        best, ranked = detect_topic(text)
        print("topic:", best or "(none -> Inbox)")
        if ranked: print("  ranked:", ", ".join(f"{n}={s}" for n, s in ranked))
        return

    body = args.body
    if body is None: body = sys.stdin.read() if not sys.stdin.isatty() else ""
    body = (body or "").strip()

    if not args.topic or args.topic.lower() == "auto":
        best, _ = detect_topic(args.title + " " + body)
        if best: print(f"[auto] topic = {best}"); args.topic = best
        else: print("[auto] topic chưa rõ -> Inbox"); args.topic = ""

    rel = resolve_folder(args.type, args.topic, args.topic_desc)
    folder = os.path.join(VAULT, rel)
    path = os.path.join(folder, slug_filename(args.title) + ".md")

    link_md = ""
    if args.links.strip():
        items = [x.strip() for x in args.links.split(",") if x.strip()]
        link_md = "\n\nLiên quan: " + " ".join(f"[[{x}]]" for x in items)

    if args.dry_run:
        print(f"[dry-run] -> {os.path.relpath(path, VAULT)} (type={args.type})"); return

    os.makedirs(folder, exist_ok=True)
    if os.path.exists(path) and not args.new:
        cur = open(path, encoding="utf-8").read()
        cur = re.sub(r"(?m)^updated:.*$", f"updated: {today()}", cur, count=1)
        open(path, "w", encoding="utf-8").write(cur.rstrip() + f"\n\n---\n_Cập nhật {today()}_\n\n{body}{link_md}\n")
        print(f"APPENDED -> {os.path.relpath(path, VAULT)}"); return
    if os.path.exists(path) and args.new:
        i = 2
        while os.path.exists(os.path.join(folder, slug_filename(args.title) + f" ({i}).md")): i += 1
        path = os.path.join(folder, slug_filename(args.title) + f" ({i}).md")

    open(path, "w", encoding="utf-8").write(
        f"{build_frontmatter(args.type, args.status)}\n# {args.title}\n\n{body}{link_md}\n")
    print(f"CREATED -> {os.path.relpath(path, VAULT)}")

if __name__ == "__main__":
    main()
