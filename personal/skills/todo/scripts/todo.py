#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Quick work-todo capture into the personal todo vault. One file per day,
checkbox tasks, priority-tagged. Built for "note now, read tomorrow by priority".

  python todo.py add "p1: finish merge-branch conflict" [--note "stuck on X"]
  python todo.py list                 # open tasks (today + carry-over), grouped P1>P2>P3
  python todo.py list --all           # include done tasks too
  python todo.py done 2               # tick task #2 from the last `list` ordering
  python todo.py path                 # print today's file path

Storage: ~/.todo/YYYY-MM-DD.md  (override with TODO_VAULT). Files are append-only;
`done` rewrites a single checkbox in place. Carry-over = unchecked tasks from prior days.
"""
import argparse, os, re, sys, datetime, glob

DEFAULT_VAULT = os.path.expanduser("~/.todo")
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
    """Return list of dicts across all days: {date, prio, done, text, id, file, lineno}."""
    out = []
    for path in all_day_files():
        date = os.path.splitext(os.path.basename(path))[0]
        with open(path, encoding="utf-8") as f:
            for i, raw in enumerate(f):
                m = LINE_RE.match(raw.rstrip("\n"))
                if not m:
                    continue
                done = m.group("done").lower() == "x"
                if done and not include_done:
                    continue
                out.append({
                    "date": date,
                    "prio": int(m.group("prio")[1]),
                    "done": done,
                    "text": m.group("text").strip(),
                    "id": m.group("id") or f"{date}#L{i}",
                    "file": path,
                    "lineno": i,
                })
    return out


def list_tasks(include_done=False):
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


def mark_done(num):
    try:
        with open(_order_path(), encoding="utf-8") as f:
            rows = [ln.rstrip("\n").split("\t") for ln in f if ln.strip()]
    except OSError:
        print("Run `/todo` (list) first so numbers map to tasks.", file=sys.stderr)
        return 2
    if num < 1 or num > len(rows):
        print(f"No task #{num} in the last list (had {len(rows)}).", file=sys.stderr)
        return 2
    path, lineno = rows[num - 1][0], int(rows[num - 1][1])
    with open(path, encoding="utf-8") as f:
        lines = f.readlines()
    m = LINE_RE.match(lines[lineno].rstrip("\n"))
    if not m:
        print("Task line moved; re-run `/todo` and try again.", file=sys.stderr)
        return 2
    lines[lineno] = lines[lineno].replace("- [ ]", "- [x]", 1)
    with open(path, "w", encoding="utf-8") as f:
        f.writelines(lines)
    print(f"DONE  {m.group('text').strip()}")
    return 0


def main():
    ap = argparse.ArgumentParser(prog="todo.py", add_help=True)
    sub = ap.add_subparsers(dest="cmd")

    a = sub.add_parser("add", help="add a task (text may start with p1:/p2:/p3:)")
    a.add_argument("text", nargs="+")
    a.add_argument("--note", default=None, help="optional extra lines under the task")

    lst = sub.add_parser("list", help="show open tasks grouped by priority")
    lst.add_argument("--all", action="store_true", help="include done tasks")

    d = sub.add_parser("done", help="tick task #N from the last list")
    d.add_argument("num", type=int)

    sub.add_parser("path", help="print today's file path")

    args = ap.parse_args()
    if args.cmd == "add":
        return add(" ".join(args.text), note=args.note)
    if args.cmd == "done":
        return mark_done(args.num)
    if args.cmd == "path":
        print(day_file(today()))
        return 0
    # default (no cmd, or `list`)
    return list_tasks(include_done=getattr(args, "all", False))


if __name__ == "__main__":
    sys.exit(main())
