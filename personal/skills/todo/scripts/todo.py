#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Quick work-todo capture into the personal todo vault. One file per day,
checkbox tasks, priority-tagged. Built for "note now, read tomorrow by priority".

  python todo.py add "p1: finish merge-branch conflict" [--note "stuck on X"]
  python todo.py list                 # open tasks (today + carry-over), grouped P1>P2>P3, notes shown
  python todo.py list --all           # include done tasks too
  python todo.py list --brief         # same list, but hide note lines (one line per task)
  python todo.py done 2               # tick task #2 from the last `list` ordering
  python todo.py update 2 --prio p1   # edit task #2: text/prio/note (any combo)
  python todo.py path                 # print today's file path

Storage: <repo>/personal/todo/YYYY-MM-DD.md  (override with TODO_VAULT). The vault
lives inside the dotfiles repo so todos sync across machines via git. Path is derived
from this script's location, so it works regardless of where the repo is cloned.
Files are append-only except `done`/`update`, which rewrite a task's own line(s) in
place — the task stays in the day file it was created in even after edits. Carry-over
= unchecked tasks from prior days. Both `done` and `update` use the numbering from the
last `list` call (`.last-list-order` cache), so always `list` first.
"""
import argparse, os, re, sys, datetime, glob

# Vault lives in the repo, three dirs up from this script:
#   personal/skills/todo/scripts/todo.py  ->  personal/todo/
# realpath() resolves the ~/.claude/skills/todo symlink back to the real repo path,
# so the vault is found whether called directly or via the symlinked skill.
_SCRIPT_DIR = os.path.dirname(os.path.realpath(__file__))
_PERSONAL_DIR = os.path.abspath(os.path.join(_SCRIPT_DIR, "..", "..", ".."))
DEFAULT_VAULT = os.path.join(_PERSONAL_DIR, "todo")
VAULT = os.path.abspath(os.environ.get("TODO_VAULT", DEFAULT_VAULT))

PRIOS = {"p1": 1, "p2": 2, "p3": 3}
PRIO_LABEL = {1: "P1", 2: "P2", 3: "P3"}
# A task line: "- [ ] (P2) text  <!--id:2026-06-23#3-->"
LINE_RE = re.compile(r"^- \[(?P<done>[ xX])\] \((?P<prio>P[123])\) (?P<text>.*?)(?:\s*<!--id:(?P<id>[^>]+)-->)?\s*$")


def today():
    return datetime.date.today().isoformat()


def ensure_vault():
    os.makedirs(VAULT, exist_ok=True)


def day_file(date):
    return os.path.join(VAULT, f"{date}.md")


def all_day_files():
    """Every YYYY-MM-DD.md, oldest first."""
    files = glob.glob(os.path.join(VAULT, "[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9].md"))
    return sorted(files)


def parse_prio(text):
    """Pull a leading p1:/p2:/p3: off the text. Returns (prio_int, clean_text)."""
    m = re.match(r"^\s*(p[123])\s*:\s*(.*)$", text, re.IGNORECASE)
    if m:
        return PRIOS[m.group(1).lower()], m.group(2).strip()
    return 2, text.strip()  # default P2


def next_seq(path):
    """Next per-day sequence number for stable ids."""
    if not os.path.exists(path):
        return 1
    n = 0
    with open(path, encoding="utf-8") as f:
        for line in f:
            if LINE_RE.match(line.rstrip("\n")):
                n += 1
    return n + 1


def add(text, note=None):
    ensure_vault()
    prio, clean = parse_prio(text)
    if not clean:
        print("nothing to add (empty task text)", file=sys.stderr)
        return 2
    date = today()
    path = day_file(date)
    seq = next_seq(path)
    tid = f"{date}#{seq}"
    new_file = not os.path.exists(path)
    with open(path, "a", encoding="utf-8") as f:
        if new_file:
            nice = datetime.date.fromisoformat(date).strftime("%A, %d/%m/%Y")
            f.write(f"# TODO — {nice}\n\n")
        f.write(f"- [ ] ({PRIO_LABEL[prio]}) {clean}  <!--id:{tid}-->\n")
        if note:
            for ln in note.splitlines():
                f.write(f"      {ln}\n")
    print(f"ADDED [{PRIO_LABEL[prio]}] {clean}  ->  {path}")
    return 0


def collect(include_done=False):
    """Return list of dicts across all days: {date, prio, done, text, id, file, lineno, notes}."""
    out = []
    for path in all_day_files():
        date = os.path.splitext(os.path.basename(path))[0]
        cur = None  # task the following note lines belong to (None = drop them)
        with open(path, encoding="utf-8") as f:
            for i, raw in enumerate(f):
                line = raw.rstrip("\n")
                m = LINE_RE.match(line)
                if m:
                    done = m.group("done").lower() == "x"
                    if done and not include_done:
                        cur = None
                        continue
                    cur = {
                        "date": date,
                        "prio": int(m.group("prio")[1]),
                        "done": done,
                        "text": m.group("text").strip(),
                        "id": m.group("id") or f"{date}#L{i}",
                        "file": path,
                        "lineno": i,
                        "notes": [],
                    }
                    out.append(cur)
                    continue
                stripped = line.strip()
                if stripped and not stripped.startswith("#") and cur is not None:
                    cur["notes"].append(stripped)
    return out


def list_tasks(include_done=False, show_notes=False):
    tasks = collect(include_done=include_done)
    if not tasks:
        print("No open tasks. Add one:  /todo p1: <thing>")
        return 0
    today_str = today()
    # Sort: priority asc, then carry-over (older) before today, then date.
    tasks.sort(key=lambda t: (t["prio"], t["date"]))
    print(f"TODO — {datetime.date.fromisoformat(today_str).strftime('%A, %d/%m/%Y')}")
    print("=" * 40)
    n = 0
    last_prio = None
    # Stash the ordering so `done <n>` maps numbers -> tasks.
    order = []
    for t in tasks:
        if t["prio"] != last_prio:
            print(f"\n{PRIO_LABEL[t['prio']]}")
            last_prio = t["prio"]
        n += 1
        order.append(t)
        carry = "" if t["date"] == today_str else f"  (từ {t['date']})"
        box = "x" if t["done"] else " "
        print(f"  {n}. [{box}] {t['text']}{carry}")
        if show_notes:
            for note in t["notes"]:
                print(f"         · {note}")
    _write_order(order)
    open_n = sum(1 for t in tasks if not t["done"])
    print(f"\n{open_n} việc chưa xong" + (f" · {len(tasks)-open_n} đã xong" if include_done else ""))
    return 0


def _order_path():
    return os.path.join(VAULT, ".last-list-order")


def _write_order(order):
    try:
        with open(_order_path(), "w", encoding="utf-8") as f:
            for t in order:
                f.write(f"{t['file']}\t{t['lineno']}\n")
    except OSError:
        pass  # ordering cache is best-effort; `done` falls back to re-listing


def _resolve_order_num(num):
    """Shared by done/update: map a `/todo list` ordering number -> (path, lineno, match).
    Returns None (and prints the error) on any failure."""
    try:
        with open(_order_path(), encoding="utf-8") as f:
            rows = [ln.rstrip("\n").split("\t") for ln in f if ln.strip()]
    except OSError:
        print("Run `/todo` (list) first so numbers map to tasks.", file=sys.stderr)
        return None
    if num < 1 or num > len(rows):
        print(f"No task #{num} in the last list (had {len(rows)}).", file=sys.stderr)
        return None
    path, lineno = rows[num - 1][0], int(rows[num - 1][1])
    with open(path, encoding="utf-8") as f:
        lines = f.readlines()
    m = LINE_RE.match(lines[lineno].rstrip("\n"))
    if not m:
        print("Task line moved; re-run `/todo` and try again.", file=sys.stderr)
        return None
    return path, lineno, lines, m


def mark_done(num):
    resolved = _resolve_order_num(num)
    if resolved is None:
        return 2
    path, lineno, lines, m = resolved
    lines[lineno] = lines[lineno].replace("- [ ]", "- [x]", 1)
    with open(path, "w", encoding="utf-8") as f:
        f.writelines(lines)
    print(f"DONE  {m.group('text').strip()}")
    return 0


def _note_block_end(lines, lineno):
    """Index just past the note lines following the task at lineno (indented,
    non-blank, non-task, non-heading lines) — i.e. where a new note block would
    start/end. Mirrors the reader in collect()."""
    i = lineno + 1
    while i < len(lines):
        stripped = lines[i].strip()
        if not stripped or stripped.startswith("#") or LINE_RE.match(lines[i].rstrip("\n")):
            break
        i += 1
    return i


def update_task(num, text=None, prio=None, note=None):
    if text is None and prio is None and note is None:
        print("Nothing to update — pass --text, --prio, and/or --note.", file=sys.stderr)
        return 2
    resolved = _resolve_order_num(num)
    if resolved is None:
        return 2
    path, lineno, lines, m = resolved
    done_mark = m.group("done")
    new_prio = PRIOS[prio.lower()] if prio else int(m.group("prio")[1])
    new_text = text.strip() if text is not None else m.group("text").strip()
    if not new_text:
        print("--text cannot be empty.", file=sys.stderr)
        return 2
    tid = m.group("id") or f"{os.path.splitext(os.path.basename(path))[0]}#?"
    lines[lineno] = f"- [{done_mark}] ({PRIO_LABEL[new_prio]}) {new_text}  <!--id:{tid}-->\n"
    if note is not None:
        end = _note_block_end(lines, lineno)
        new_notes = [f"      {ln}\n" for ln in note.splitlines()] if note else []
        lines[lineno + 1:end] = new_notes
    with open(path, "w", encoding="utf-8") as f:
        f.writelines(lines)
    print(f"UPDATED [{PRIO_LABEL[new_prio]}] {new_text}  ->  {path}")
    return 0


def main():
    ap = argparse.ArgumentParser(prog="todo.py", add_help=True)
    sub = ap.add_subparsers(dest="cmd")

    a = sub.add_parser("add", help="add a task (text may start with p1:/p2:/p3:)")
    a.add_argument("text", nargs="+")
    a.add_argument("--note", default=None, help="optional extra lines under the task")

    lst = sub.add_parser("list", help="show open tasks grouped by priority")
    lst.add_argument("--all", action="store_true", help="include done tasks")
    lst.add_argument("--notes", action="store_true", help="(default on) show note lines under each task — kept for backwards compat")
    lst.add_argument("--brief", action="store_true", help="hide note lines, one line per task")

    d = sub.add_parser("done", help="tick task #N from the last list")
    d.add_argument("num", type=int)

    u = sub.add_parser("update", help="edit task #N from the last list (text/prio/note)")
    u.add_argument("num", type=int)
    u.add_argument("--text", default=None, help="replace the task text")
    u.add_argument("--prio", choices=["p1", "p2", "p3"], default=None, help="move to a new priority")
    u.add_argument("--note", default=None, help="replace the note lines (empty string clears them)")

    sub.add_parser("path", help="print today's file path")

    args = ap.parse_args()
    if args.cmd == "add":
        return add(" ".join(args.text), note=args.note)
    if args.cmd == "done":
        return mark_done(args.num)
    if args.cmd == "update":
        return update_task(args.num, text=args.text, prio=args.prio, note=args.note)
    if args.cmd == "path":
        print(day_file(today()))
        return 0
    # default (no cmd, or `list`) — notes show by default; --brief hides them.
    return list_tasks(include_done=getattr(args, "all", False),
                      show_notes=not getattr(args, "brief", False))


if __name__ == "__main__":
    sys.exit(main())
