#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Long-horizon intention backlog with an optional active cycle.

  python backlog.py add "học microservices #học" [--tag tooling] [--note "..."]
  python backlog.py list [--tag học] [--all]
  python backlog.py open "sprint 08" [--until YYYY-MM-DD]
  python backlog.py pull 2
  python backlog.py today 1
  python backlog.py done 1
  python backlog.py drop 2
  python backlog.py update 3 [--text "..."] [--tag "..."] [--note "..."]
  python backlog.py close
  python backlog.py path

Storage: <repo>/personal/backlog/ (override with BACKLOG_VAULT). The path is
derived from this script's real location so invocation through a symlink still uses
the vault in the repository. Numbered commands resolve against `.last-list-order`
written by the most recent list.
"""
import argparse
import datetime
import glob
import os
import re
import subprocess
import sys
import unicodedata

_SCRIPT_DIR = os.path.dirname(os.path.realpath(__file__))
_PERSONAL_DIR = os.path.abspath(os.path.join(_SCRIPT_DIR, "..", "..", ".."))
DEFAULT_VAULT = os.path.join(_PERSONAL_DIR, "backlog")
VAULT = os.path.abspath(os.environ.get("BACKLOG_VAULT", DEFAULT_VAULT))
BACKLOG_FILE = os.path.join(VAULT, "backlog.md")
CYCLES_DIR = os.path.join(VAULT, "cycles")
ACTIVE_FILE = os.path.join(VAULT, ".active-cycle")
ORDER_FILE = os.path.join(VAULT, ".last-list-order")
TODO_SCRIPT = os.path.abspath(os.path.join(_SCRIPT_DIR, "..", "..", "todo", "scripts", "todo.py"))

LINE_RE = re.compile(r"^- \[(?P<state>[ xX~])\] (?P<body>.*?)(?:\s+<!--id:(?P<id>b#\d+)-->)?\s*$")
TAG_RE = re.compile(r"#[\w-]+", re.UNICODE)
TRAILING_TAGS_RE = re.compile(r"(?:\s+#[\w-]+)+\s*$", re.UNICODE)
WEEKDAYS = ["Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy", "Chủ nhật"]


def today():
    return datetime.date.today()


def ensure_vault():
    os.makedirs(CYCLES_DIR, exist_ok=True)


def ensure_pool():
    ensure_vault()
    if not os.path.exists(BACKLOG_FILE):
        with open(BACKLOG_FILE, "w", encoding="utf-8") as handle:
            handle.write("# BACKLOG\n\n")
    backfill_ids()


def cycle_path(slug):
    return os.path.join(CYCLES_DIR, f"{slug}.md")


def active_slug():
    try:
        with open(ACTIVE_FILE, encoding="utf-8") as handle:
            slug = handle.read().strip()
    except OSError:
        return None
    return slug or None


def all_item_files():
    files = [BACKLOG_FILE]
    files.extend(sorted(glob.glob(os.path.join(CYCLES_DIR, "*.md"))))
    return [path for path in files if os.path.exists(path)]


def parse_tags(value):
    """Normalize a comma-separated tag value while preserving first-seen order."""
    tags = []
    if value is None:
        return tags
    for raw in value.split(","):
        tag = raw.strip()
        if not tag:
            continue
        if not tag.startswith("#"):
            tag = f"#{tag}"
        if not TAG_RE.fullmatch(tag):
            raise ValueError(tag)
        if tag not in tags:
            tags.append(tag)
    return tags


def split_text_tags(text):
    """Separate trailing hashtag tokens from item text."""
    clean = text.strip()
    match = TRAILING_TAGS_RE.search(clean)
    if not match:
        return clean, []
    tags = TAG_RE.findall(match.group(0))
    return clean[:match.start()].rstrip(), tags


def merge_tags(first, second):
    return list(dict.fromkeys(first + second))


def item_body(text, tags):
    suffix = f" {' '.join(tags)}" if tags else ""
    return f"{text}{suffix}"


def item_line(state, text, tags, item_id):
    return f"- [{state}] {item_body(text, tags)}  <!--id:{item_id}-->\n"


def next_seq():
    """Return one more than the greatest stable id in the pool and all cycles."""
    highest = 0
    for path in all_item_files():
        with open(path, encoding="utf-8") as handle:
            for raw in handle:
                match = LINE_RE.match(raw.rstrip("\n"))
                if match and match.group("id"):
                    highest = max(highest, int(match.group("id").split("#", 1)[1]))
    return highest + 1


def backfill_ids():
    """Assign stable ids to item lines created by hand."""
    sequence = next_seq()
    for path in all_item_files():
        with open(path, encoding="utf-8") as handle:
            lines = handle.readlines()
        changed = False
        for index, raw in enumerate(lines):
            line = raw.rstrip("\n")
            match = LINE_RE.match(line)
            if match and match.group("id") is None:
                lines[index] = f"{line.rstrip()}  <!--id:b#{sequence}-->\n"
                sequence += 1
                changed = True
        if changed:
            with open(path, "w", encoding="utf-8") as handle:
                handle.writelines(lines)


def note_block_end(lines, lineno):
    """Return the index just after an item's indented continuation lines."""
    index = lineno + 1
    while index < len(lines):
        raw = lines[index]
        if not raw.strip() or not raw[:1].isspace() or LINE_RE.match(raw.rstrip("\n")):
            break
        index += 1
    return index


def collect_file(path, include_closed=True):
    """Read items and their indented note lines from one markdown file."""
    items = []
    current = None
    if not os.path.exists(path):
        return items
    with open(path, encoding="utf-8") as handle:
        for lineno, raw in enumerate(handle):
            line = raw.rstrip("\n")
            match = LINE_RE.match(line)
            if match:
                state = match.group("state").lower()
                current = None
                if state != " " and not include_closed:
                    continue
                text, tags = split_text_tags(match.group("body"))
                current = {
                    "state": state,
                    "text": text,
                    "tags": tags,
                    "id": match.group("id"),
                    "file": path,
                    "lineno": lineno,
                    "notes": [],
                }
                items.append(current)
                continue
            if not line.strip():
                current = None
                continue
            if current is not None and raw[:1].isspace() and line.strip():
                current["notes"].append(line.strip())
            else:
                current = None
    return items


def add(text, tag=None, note=None):
    ensure_pool()
    clean, inline_tags = split_text_tags(text)
    try:
        tags = merge_tags(inline_tags, parse_tags(tag))
    except ValueError as error:
        print(f"tag không hợp lệ: {error.args[0]}", file=sys.stderr)
        return 2
    if not clean:
        print("không có nội dung để thêm", file=sys.stderr)
        return 2
    with open(BACKLOG_FILE, "a", encoding="utf-8") as handle:
        handle.write(item_line(" ", clean, tags, f"b#{next_seq()}"))
        if note:
            for line in note.splitlines():
                if line.strip():
                    handle.write(f"      {line}\n")
    print(f"ĐÃ THÊM  {item_body(clean, tags)}")
    return 0


def read_cycle_meta(path):
    meta = {"name": os.path.splitext(os.path.basename(path))[0], "until": None}
    try:
        with open(path, encoding="utf-8") as handle:
            for raw in handle:
                line = raw.rstrip("\n")
                if line.startswith("Tên: "):
                    meta["name"] = line[5:].strip()
                elif line.startswith("Hạn: "):
                    try:
                        meta["until"] = datetime.date.fromisoformat(line[5:].strip())
                    except ValueError:
                        meta["until"] = None
                elif LINE_RE.match(line):
                    break
    except OSError:
        pass
    return meta


def cycle_header(slug):
    path = cycle_path(slug)
    meta = read_cycle_meta(path)
    header = f"CHU KỲ: {meta['name']}"
    if meta["until"]:
        delta = (meta["until"] - today()).days
        due = meta["until"].strftime("%d/%m")
        timing = f"còn {delta} ngày" if delta >= 0 else f"quá hạn {-delta} ngày"
        header += f"  (hạn {due}, {timing})"
    return header


def display_item(number, item, indent=2):
    padding = " " * indent
    print(f"{padding}{number}. [{item['state']}] {item_body(item['text'], item['tags'])}")
    for note in item["notes"]:
        print(f"{' ' * (indent + 7)}· {note}")


def write_order(items):
    ensure_vault()
    try:
        with open(ORDER_FILE, "w", encoding="utf-8") as handle:
            for item in items:
                handle.write(f"{item['file']}\t{item['lineno']}\n")
    except OSError:
        pass


def list_items(tag=None, include_closed=False):
    ensure_pool()
    try:
        wanted = parse_tags(tag)[0] if tag is not None else None
    except (ValueError, IndexError):
        print(f"tag không hợp lệ: {tag}", file=sys.stderr)
        return 2
    active = active_slug()
    cycle_items = collect_file(cycle_path(active), include_closed) if active else []
    pool_items = collect_file(BACKLOG_FILE, include_closed)
    if wanted:
        cycle_items = [item for item in cycle_items if wanted in item["tags"]]
        pool_items = [item for item in pool_items if wanted in item["tags"]]
    date = today()
    print(f"BACKLOG — {WEEKDAYS[date.weekday()]}, {date.strftime('%d/%m/%Y')}")
    print("=" * 40)
    order = []
    if active:
        print(f"\n{cycle_header(active)}")
        for item in cycle_items:
            order.append(item)
            display_item(len(order), item)
        if not cycle_items:
            print("  (trống)")
    print("\nKHO Ý ĐỊNH")
    groups = {}
    for item in pool_items:
        label = item["tags"][0] if item["tags"] else "(chưa tag)"
        groups.setdefault(label, []).append(item)
    for label in sorted(groups, key=lambda value: (value == "(chưa tag)", value.casefold())):
        print(f"  {label}")
        for item in groups[label]:
            order.append(item)
            display_item(len(order), item, indent=4)
    if not pool_items:
        print("  (trống)")
    write_order(order)
    cycle_open = sum(item["state"] == " " for item in cycle_items)
    pool_open = sum(item["state"] == " " for item in pool_items)
    footer = f"{cycle_open} việc chưa xong trong chu kỳ · {pool_open} chưa xong trong kho"
    if include_closed:
        all_items = cycle_items + pool_items
        done_count = sum(item["state"] == "x" for item in all_items)
        dropped_count = sum(item["state"] == "~" for item in all_items)
        footer += f" · {done_count} đã xong · {dropped_count} đã bỏ"
    print(f"\n{footer}")
    return 0


def slugify(name):
    mapped = name.translate(str.maketrans("đĐơƠưƯ", "dDoOuU"))
    normalized = unicodedata.normalize("NFKD", mapped)
    ascii_name = normalized.encode("ascii", "ignore").decode("ascii").lower()
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", ascii_name)).strip("-")


def open_cycle(name, until=None):
    ensure_pool()
    clean_name = name.strip()
    slug = slugify(clean_name)
    if not clean_name or not slug:
        print("tên chu kỳ không hợp lệ", file=sys.stderr)
        return 2
    deadline = None
    if until:
        try:
            deadline = datetime.date.fromisoformat(until)
        except ValueError:
            print("hạn phải có dạng YYYY-MM-DD", file=sys.stderr)
            return 2
    path = cycle_path(slug)
    if os.path.exists(path):
        print(f"chu kỳ đã tồn tại: {slug}", file=sys.stderr)
        return 2
    previous = active_slug()
    if previous:
        result = close_cycle()
        if result:
            return result
        print("đã đóng chu kỳ cũ trước khi mở chu kỳ mới")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(f"# CHU KỲ — {clean_name}\n\n")
        handle.write(f"Tên: {clean_name}\n")
        handle.write(f"Mở: {today().isoformat()}\n")
        if deadline:
            handle.write(f"Hạn: {deadline.isoformat()}\n")
        handle.write("\n")
    with open(ACTIVE_FILE, "w", encoding="utf-8") as handle:
        handle.write(f"{slug}\n")
    print(f"ĐÃ MỞ  {clean_name}  ->  {path}")
    return 0


def resolve_order_num(num):
    """Map a number from the last list back to its current item line."""
    try:
        with open(ORDER_FILE, encoding="utf-8") as handle:
            rows = [line.rstrip("\n").split("\t") for line in handle if line.strip()]
    except OSError:
        print("chạy `/backlog` trước để lấy số việc", file=sys.stderr)
        return None
    if num < 1 or num > len(rows):
        print(f"không có việc #{num} trong danh sách gần nhất", file=sys.stderr)
        return None
    try:
        path, raw_lineno = rows[num - 1][0], rows[num - 1][1]
        lineno = int(raw_lineno)
        with open(path, encoding="utf-8") as handle:
            lines = handle.readlines()
        match = LINE_RE.match(lines[lineno].rstrip("\n"))
    except (OSError, ValueError, IndexError):
        match = None
    if not match:
        print("dòng việc đã đổi, chạy `/backlog` rồi thử lại", file=sys.stderr)
        return None
    return path, lineno, lines, match


def cache_ids():
    """Capture stable ids and fallback rows in numbered order."""
    try:
        with open(ORDER_FILE, encoding="utf-8") as handle:
            rows = [line.rstrip("\n").split("\t") for line in handle if line.strip()]
    except OSError:
        return []
    ids = []
    for row in rows:
        if len(row) < 2:
            continue
        try:
            with open(row[0], encoding="utf-8") as handle:
                lines = handle.readlines()
            match = LINE_RE.match(lines[int(row[1])].rstrip("\n"))
            item_id = match.group("id") if match else None
        except (OSError, ValueError, IndexError):
            item_id = None
        ids.append((item_id, row[0], row[1]))
    return ids


def refresh_order(ids):
    """Keep the last visible numbering valid after items move or notes change."""
    locations = {}
    for path in all_item_files():
        with open(path, encoding="utf-8") as handle:
            for lineno, raw in enumerate(handle):
                match = LINE_RE.match(raw.rstrip("\n"))
                if match and match.group("id"):
                    locations[match.group("id")] = (path, lineno)
    try:
        with open(ORDER_FILE, "w", encoding="utf-8") as handle:
            for item_id, old_path, old_lineno in ids:
                if item_id in locations:
                    path, lineno = locations[item_id]
                    handle.write(f"{path}\t{lineno}\n")
                else:
                    handle.write(f"{old_path}\t{old_lineno}\n")
    except OSError:
        pass


def extract_block(lines, lineno):
    end = note_block_end(lines, lineno)
    return lines[lineno:end], lines[:lineno] + lines[end:]


def append_block(path, block):
    with open(path, "a", encoding="utf-8") as handle:
        handle.writelines(block)


def pull(num):
    slug = active_slug()
    if not slug:
        print("chưa có chu kỳ đang mở", file=sys.stderr)
        return 2
    resolved = resolve_order_num(num)
    if resolved is None:
        return 2
    path, lineno, lines, match = resolved
    if os.path.abspath(path) != os.path.abspath(BACKLOG_FILE):
        print(f"việc #{num} đã ở trong chu kỳ", file=sys.stderr)
        return 2
    ids = cache_ids()
    block, remaining = extract_block(lines, lineno)
    with open(path, "w", encoding="utf-8") as handle:
        handle.writelines(remaining)
    append_block(cycle_path(slug), block)
    refresh_order(ids)
    text, tags = split_text_tags(match.group("body"))
    print(f"ĐÃ KÉO  {item_body(text, tags)}")
    return 0


def append_note(path, lineno, lines, note):
    end = note_block_end(lines, lineno)
    lines.insert(end, f"      {note}\n")
    with open(path, "w", encoding="utf-8") as handle:
        handle.writelines(lines)


def send_today(num):
    resolved = resolve_order_num(num)
    if resolved is None:
        return 2
    if not os.path.exists(TODO_SCRIPT):
        print(f"không tìm thấy script /todo: {TODO_SCRIPT}", file=sys.stderr)
        return 2
    path, lineno, lines, match = resolved
    text, unused_tags = split_text_tags(match.group("body"))
    slug = active_slug()
    source = "kho"
    if slug and os.path.abspath(path) == os.path.abspath(cycle_path(slug)):
        source = read_cycle_meta(path)["name"]
    result = subprocess.run(
        [sys.executable, TODO_SCRIPT, "add", text, "--note", f"← /backlog: {source}"],
        check=False,
    )
    if result.returncode:
        print("không thể đẩy việc sang /todo", file=sys.stderr)
        return result.returncode
    ids = cache_ids()
    append_note(path, lineno, lines, f"→ /todo {today().strftime('%d/%m')}")
    refresh_order(ids)
    print(f"ĐÃ ĐẨY  {text}")
    return 0


def mark(num, state):
    resolved = resolve_order_num(num)
    if resolved is None:
        return 2
    path, lineno, lines, match = resolved
    lines[lineno] = re.sub(r"^- \[[ xX~]\]", f"- [{state}]", lines[lineno], count=1)
    with open(path, "w", encoding="utf-8") as handle:
        handle.writelines(lines)
    verb = "XONG" if state == "x" else "ĐÃ BỎ"
    print(f"{verb}  {match.group('body').strip()}")
    return 0


def update_item(num, text=None, tag=None, note=None):
    if text is None and tag is None and note is None:
        print("không có thay đổi, dùng --text, --tag hoặc --note", file=sys.stderr)
        return 2
    resolved = resolve_order_num(num)
    if resolved is None:
        return 2
    path, lineno, lines, match = resolved
    old_text, old_tags = split_text_tags(match.group("body"))
    new_text = text.strip() if text is not None else old_text
    if not new_text:
        print("--text không được để trống", file=sys.stderr)
        return 2
    try:
        new_tags = parse_tags(tag) if tag is not None else old_tags
    except ValueError as error:
        print(f"tag không hợp lệ: {error.args[0]}", file=sys.stderr)
        return 2
    ids = cache_ids()
    item_id = match.group("id") or f"b#{next_seq()}"
    lines[lineno] = item_line(match.group("state"), new_text, new_tags, item_id)
    if note is not None:
        end = note_block_end(lines, lineno)
        notes = [f"      {line}\n" for line in note.splitlines() if line.strip()] if note else []
        lines[lineno + 1:end] = notes
    with open(path, "w", encoding="utf-8") as handle:
        handle.writelines(lines)
    refresh_order(ids)
    print(f"ĐÃ SỬA  {item_body(new_text, new_tags)}")
    return 0


def close_cycle():
    slug = active_slug()
    if not slug:
        print("chưa có chu kỳ đang mở", file=sys.stderr)
        return 2
    ensure_pool()
    path = cycle_path(slug)
    items = collect_file(path, include_closed=True)
    done_count = sum(item["state"] == "x" for item in items)
    dropped_count = sum(item["state"] == "~" for item in items)
    open_items = [item for item in items if item["state"] == " "]
    ids = cache_ids()
    if open_items:
        with open(path, encoding="utf-8") as handle:
            lines = handle.readlines()
        blocks = []
        ranges = []
        for item in open_items:
            end = note_block_end(lines, item["lineno"])
            blocks.append(lines[item["lineno"]:end])
            ranges.append((item["lineno"], end))
        for start, end in reversed(ranges):
            del lines[start:end]
        with open(path, "w", encoding="utf-8") as handle:
            handle.writelines(lines)
        for block in blocks:
            append_block(BACKLOG_FILE, block)
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(f"\nĐóng: {today().isoformat()}\n")
    os.unlink(ACTIVE_FILE)
    refresh_order(ids)
    print(f"ĐÃ ĐÓNG  {read_cycle_meta(path)['name']}")
    print(f"{done_count} xong · {dropped_count} đã bỏ · {len(open_items)} chưa xong về kho")
    return 0


def show_path():
    print(VAULT)
    slug = active_slug()
    print(cycle_path(slug) if slug else "không có chu kỳ đang mở")
    return 0


def main():
    parser = argparse.ArgumentParser(prog="backlog.py", add_help=True)
    sub = parser.add_subparsers(dest="cmd")

    add_parser = sub.add_parser("add", help="thêm một ý định vào kho")
    add_parser.add_argument("text", nargs="+")
    add_parser.add_argument("--tag", default=None)
    add_parser.add_argument("--note", default=None)

    list_parser = sub.add_parser("list", help="xem chu kỳ và kho ý định")
    list_parser.add_argument("--tag", default=None)
    list_parser.add_argument("--all", action="store_true")

    open_parser = sub.add_parser("open", help="mở chu kỳ mới")
    open_parser.add_argument("name", nargs="+")
    open_parser.add_argument("--until", default=None)

    pull_parser = sub.add_parser("pull", help="kéo việc vào chu kỳ")
    pull_parser.add_argument("num", type=int)

    today_parser = sub.add_parser("today", help="đẩy việc sang /todo hôm nay")
    today_parser.add_argument("num", type=int)

    done_parser = sub.add_parser("done", help="đánh dấu việc hoàn thành")
    done_parser.add_argument("num", type=int)

    drop_parser = sub.add_parser("drop", help="bỏ một ý định")
    drop_parser.add_argument("num", type=int)

    update_parser = sub.add_parser("update", help="sửa việc theo số từ danh sách gần nhất")
    update_parser.add_argument("num", type=int)
    update_parser.add_argument("--text", default=None)
    update_parser.add_argument("--tag", default=None)
    update_parser.add_argument("--note", default=None)

    sub.add_parser("close", help="đóng chu kỳ đang mở")
    sub.add_parser("path", help="in đường dẫn vault và chu kỳ đang mở")

    args = parser.parse_args()
    ensure_pool()
    if args.cmd == "add":
        return add(" ".join(args.text), tag=args.tag, note=args.note)
    if args.cmd == "open":
        return open_cycle(" ".join(args.name), until=args.until)
    if args.cmd == "pull":
        return pull(args.num)
    if args.cmd == "today":
        return send_today(args.num)
    if args.cmd == "done":
        return mark(args.num, "x")
    if args.cmd == "drop":
        return mark(args.num, "~")
    if args.cmd == "update":
        return update_item(args.num, text=args.text, tag=args.tag, note=args.note)
    if args.cmd == "close":
        return close_cycle()
    if args.cmd == "path":
        return show_path()
    return list_items(
        tag=getattr(args, "tag", None),
        include_closed=getattr(args, "all", False),
    )


if __name__ == "__main__":
    sys.exit(main())
