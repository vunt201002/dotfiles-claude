#!/usr/bin/env python3
"""
Slack Thread — fetch a Slack thread through the Slack Web API and print it as markdown.

Usage:
  python3 slack-thread.py <url> [<url> ...] [--no-files] [--max-file-mb N] [--out-dir DIR] [--json]

Reads SLACK_TOKEN from .env.agent (walking up from cwd). Never summarizes — the
calling agent does that.
"""

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime
from urllib.parse import urlencode, urlparse, parse_qs
from urllib.request import urlopen, Request
from urllib.error import HTTPError, URLError


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

try:
    import certifi
    os.environ.setdefault('SSL_CERT_FILE', certifi.where())
except ImportError:
    pass


SLACK_API = "https://slack.com/api"
CACHE_ROOT = os.path.expanduser("~/.cache/slack-thread")
PAGE_LIMIT = 200
MAX_REPLY_PAGES = 50
MAX_RATELIMIT_RETRIES = 3
REQUEST_TIMEOUT = 30
DEFAULT_MAX_FILE_MB = 20
DOWNLOAD_CHUNK = 64 * 1024
ATTACHMENT_TEXT_LIMIT = 300

PERMALINK_RE = re.compile(r"/archives/([A-Za-z0-9]{6,})/p(\d{11,})")
THREAD_TS_RE = re.compile(r"^\d{9,}\.\d{3,}$")
ANGLE_RE = re.compile(r"<([^<>]*)>")
USER_MENTION_RE = re.compile(r"<@([UWB][A-Za-z0-9]+)")
CHANNEL_MENTION_RE = re.compile(r"<#(C[A-Za-z0-9]+)")
UNSAFE_FILENAME_RE = re.compile(r"[\x00-\x1f\x7f/\\:*?\"<>|]+")
BLANK_RUN_RE = re.compile(r"\n{3,}")

SLACK_HOST = "slack.com"
SLACK_HOST_SUFFIX = ".slack.com"
BROADCAST_RANGES = ("here", "channel", "everyone")
BLOCK_TEXT_TYPES = ("text", "mrkdwn", "plain_text")
BLOCK_BREAK_TYPES = (
    "section", "header", "context", "actions", "divider", "input", "video",
    "rich_text", "rich_text_section", "rich_text_preformatted", "rich_text_quote",
    "rich_text_list",
)


class PermalinkError(ValueError):
    pass


class SlackError(Exception):
    def __init__(self, code, method, payload=None):
        super().__init__(code)
        self.code = code
        self.method = method
        self.payload = payload or {}


# === Token + transport ===

TOKEN_FILE = os.path.expanduser("~/.config/slack/token")


def get_token():
    token = os.environ.get("SLACK_TOKEN")
    if not token and os.path.exists(TOKEN_FILE):
        with open(TOKEN_FILE) as f:
            token = f.read().strip()
    if not token:
        raise SystemExit(
            "Error: SLACK_TOKEN not found.\n"
            "It lives in a project .env.agent, which this script looks for by walking up\n"
            "from the current directory. Either run it from inside such a project, or put\n"
            "the token in %s." % TOKEN_FILE
        )
    return token


def _retry_delay(headers, attempt):
    raw = headers.get("Retry-After") if headers else None
    try:
        return max(1, int(raw))
    except (TypeError, ValueError):
        return min(30, 2 ** attempt)


def slack_get(method, params, token):
    attempt = 0
    while True:
        url = "%s/%s?%s" % (SLACK_API, method, urlencode(params))
        req = Request(url, headers={
            "Authorization": "Bearer %s" % token,
            "Accept": "application/json",
        })
        headers = None
        try:
            with urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
                headers = resp.headers
                payload = json.loads(resp.read().decode("utf-8"))
        except HTTPError as e:
            if e.code == 429 and attempt < MAX_RATELIMIT_RETRIES:
                attempt += 1
                time.sleep(_retry_delay(e.headers, attempt))
                continue
            raise SlackError("http_%d" % e.code, method)
        except URLError as e:
            raise SlackError("network_error (%s)" % e.reason, method)
        except json.JSONDecodeError:
            raise SlackError("non_json_response", method)

        if payload.get("ok"):
            return payload
        if payload.get("error") == "ratelimited" and attempt < MAX_RATELIMIT_RETRIES:
            attempt += 1
            time.sleep(_retry_delay(headers, attempt))
            continue
        raise SlackError(payload.get("error") or "unknown_error", method, payload)


def slack_get_optional(method, params, token):
    try:
        return slack_get(method, params, token)
    except SlackError:
        return None


# === Permalink parsing ===

def parse_permalink(url):
    """Return (channel_id, root_ts) from a Slack message permalink."""
    parsed = urlparse(url.strip())
    host = (parsed.hostname or "").lower()
    is_slack_host = host == SLACK_HOST or host.endswith(SLACK_HOST_SUFFIX)
    if parsed.scheme not in ("http", "https") or not is_slack_host:
        raise PermalinkError(url)
    match = PERMALINK_RE.search(parsed.path)
    if not match:
        raise PermalinkError(url)

    channel_id = match.group(1)
    digits = match.group(2)
    message_ts = "%s.%s" % (digits[:-6], digits[-6:])

    query = parse_qs(parsed.query)
    for key in ("cid", "channel"):
        if query.get(key):
            channel_id = query[key][0]
            break

    root_ts = message_ts
    if query.get("thread_ts"):
        candidate = query["thread_ts"][0]
        if THREAD_TS_RE.match(candidate):
            root_ts = candidate

    return channel_id, root_ts


def permalink_help(url):
    return (
        "Not a Slack thread permalink: %s\n"
        "Expected: https://<workspace>.slack.com/archives/<CHANNEL_ID>/p<timestamp>"
        "[?thread_ts=<ts>&cid=<CHANNEL_ID>]\n"
        "Use Slack's \"Copy link\" action on the message to get this shape." % url
    )


# === Thread fetching ===

def fetch_replies(channel_id, root_ts, token):
    messages = []
    seen = set()
    cursor = None
    pages = 0
    while True:
        params = {"channel": channel_id, "ts": root_ts, "limit": PAGE_LIMIT}
        if cursor:
            params["cursor"] = cursor
        payload = slack_get("conversations.replies", params, token)
        for msg in payload.get("messages", []):
            ts = msg.get("ts")
            if ts in seen:
                continue
            seen.add(ts)
            messages.append(msg)
        pages += 1
        next_cursor = (payload.get("response_metadata") or {}).get("next_cursor")
        if not payload.get("has_more") or not next_cursor:
            break
        if next_cursor == cursor:
            raise SlackError("pagination_stalled", "conversations.replies")
        if pages >= MAX_REPLY_PAGES:
            raise SlackError("pagination_cap_reached", "conversations.replies")
        cursor = next_cursor
    return messages


def fetch_thread(channel_id, root_ts, token):
    """Fetch a thread, re-resolving once if the link pointed at a reply."""
    messages = fetch_replies(channel_id, root_ts, token)
    if len(messages) == 1:
        parent_ts = messages[0].get("thread_ts")
        if parent_ts and parent_ts != messages[0].get("ts"):
            return fetch_replies(channel_id, parent_ts, token), parent_ts
    return messages, root_ts


def channel_kind(info, channel_id):
    if info:
        if info.get("is_mpim"):
            return "mpim"
        if info.get("is_im"):
            return "dm"
        if info.get("is_private"):
            return "private"
        return "public"
    prefix = channel_id[:1].upper()
    return {"C": "public", "G": "private-or-group", "D": "dm"}.get(prefix, "unknown")


def channel_label(info, channel_id, kind):
    if info and info.get("name"):
        return "#%s" % info["name"]
    if kind == "dm":
        return "DM (%s)" % channel_id
    return channel_id


# === Error reporting ===

MPIM_NOTE = (
    "This looks like a multi-person group DM. The token is missing the mpim:history "
    "scope, so group DMs cannot be read at all. Ask the person to forward the thread "
    "into a channel avada_bot is in, or paste the messages directly."
)


def describe_slack_error(err, channel_id, token):
    code = err.code
    needed = (err.payload.get("needed") or "") if err.payload else ""

    if code == "missing_scope" and "mpim:history" in needed:
        return MPIM_NOTE

    if code == "not_in_channel":
        info = slack_get_optional("conversations.info", {"channel": channel_id}, token)
        channel = (info or {}).get("channel") or {}
        if channel.get("is_mpim"):
            return MPIM_NOTE
        label = "#%s" % channel["name"] if channel.get("name") else channel_id
        return (
            "avada_bot is not a member of %s (%s).\n"
            "Fix: open that channel in Slack and run  /invite @avada_bot  then retry.\n"
            "The bot cannot join by itself — the channels:join scope is not granted."
            % (label, channel_id)
        )

    if code == "channel_not_found":
        return (
            "Channel %s is not visible to this token.\n"
            "Either it is a private channel avada_bot was never invited to, or the link "
            "belongs to a different Slack workspace than the token." % channel_id
        )

    if code in ("invalid_auth", "token_revoked", "account_inactive", "not_authed"):
        reasons = {
            "invalid_auth": "SLACK_TOKEN is invalid or malformed.",
            "token_revoked": "SLACK_TOKEN has been revoked in Slack.",
            "account_inactive": "The bot account attached to SLACK_TOKEN is deactivated.",
            "not_authed": "No token was sent with the request.",
        }
        return "%s Check SLACK_TOKEN in .env.agent." % reasons[code]

    if code == "missing_scope":
        return (
            "The token is missing the %s scope (Slack asked for it on %s). "
            "A workspace admin has to add it to the avada_bot app."
            % (needed or "required", err.method)
        )

    if code == "ratelimited":
        return "Slack rate-limited us on %s and kept doing so after %d retries." % (
            err.method, MAX_RATELIMIT_RETRIES)

    if code == "pagination_stalled":
        return (
            "Slack kept handing back the same pagination cursor for %s, so the thread "
            "cannot be read to the end. Nothing was printed rather than a transcript "
            "that silently stops mid-thread. Retry in a moment." % channel_id
        )

    if code == "pagination_cap_reached":
        return (
            "This thread is longer than %d pages of %d messages, past what this script "
            "will fetch in one run. Read it in Slack — a truncated transcript would look "
            "complete and is worse than no transcript." % (MAX_REPLY_PAGES, PAGE_LIMIT)
        )

    if code in ("thread_not_found", "message_not_found"):
        return (
            "No message found at that timestamp in %s. The message may have been "
            "deleted, or the link points at a different channel than the one in the "
            "URL path." % channel_id
        )

    return "Slack API error on %s: %s" % (err.method, code)


# === Users and channel names ===

def display_name(user):
    profile = user.get("profile") or {}
    for candidate in (profile.get("display_name"), profile.get("real_name"),
                      user.get("real_name"), user.get("name")):
        if candidate:
            return candidate
    return user.get("id", "unknown")


def user_cache_path(team_id):
    return os.path.join(CACHE_ROOT, "users-%s.json" % (team_id or "unknown"))


def load_user_cache(team_id):
    path = user_cache_path(team_id)
    try:
        with open(path) as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def save_user_cache(team_id, cache):
    path = user_cache_path(team_id)
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            json.dump(cache, f, ensure_ascii=False, indent=0, sort_keys=True)
    except OSError:
        pass


def resolve_users(user_ids, token, cache):
    unknown = [uid for uid in user_ids if uid and uid not in cache]
    for uid in unknown:
        payload = slack_get_optional("users.info", {"user": uid}, token)
        user = (payload or {}).get("user")
        if user:
            cache[uid] = display_name(user)
    return cache


def resolve_channel_names(channel_ids, token, cache):
    for cid in channel_ids:
        if not cid or cid in cache:
            continue
        payload = slack_get_optional("conversations.info", {"channel": cid}, token)
        channel = (payload or {}).get("channel")
        if channel and channel.get("name"):
            cache[cid] = channel["name"]
    return cache


# === mrkdwn rendering ===

def extract_block_text(blocks):
    """Flatten Block Kit into mrkdwn-shaped text, mentions kept as <@U…> markers."""
    chunks = []

    def break_line():
        if chunks and chunks[-1] != "\n":
            chunks.append("\n")

    def walk_fields(fields):
        for field in fields:
            break_line()
            walk(field)
        break_line()

    def walk(node):
        if isinstance(node, list):
            for item in node:
                walk(item)
            return
        if not isinstance(node, dict):
            return
        node_type = node.get("type")
        if node_type in BLOCK_BREAK_TYPES:
            break_line()
        text_value = node.get("text")
        if node_type in BLOCK_TEXT_TYPES and isinstance(text_value, str) and text_value:
            chunks.append(text_value)
        elif node_type == "link":
            label = node.get("text") or node.get("url")
            if label:
                chunks.append(label)
        elif node_type == "user" and node.get("user_id"):
            chunks.append("<@%s>" % node["user_id"])
        elif node_type == "channel" and node.get("channel_id"):
            chunks.append("<#%s>" % node["channel_id"])
        elif node_type == "usergroup" and node.get("usergroup_id"):
            chunks.append("<!subteam^%s>" % node["usergroup_id"])
        elif node_type == "broadcast" and node.get("range"):
            chunks.append("<!%s>" % node["range"])
        elif node_type == "emoji" and node.get("name"):
            chunks.append(":%s:" % node["name"])
        for key in ("elements", "text", "fields", "rich_text"):
            if key not in node:
                continue
            if key == "fields" and isinstance(node[key], list):
                walk_fields(node[key])
            else:
                walk(node[key])
        if node_type in BLOCK_BREAK_TYPES:
            break_line()

    walk(blocks or [])
    return BLANK_RUN_RE.sub("\n\n", "".join(chunks)).strip()


def unescape_entities(text):
    return text.replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")


def render_mrkdwn(text, users, channels):
    if not text:
        return ""

    def replace(match):
        body = match.group(1)
        if not body:
            return match.group(0)
        head = body[0]
        rest = body[1:]

        if head == "@":
            ident, _, label = rest.partition("|")
            return "@" + (label or users.get(ident) or ident)
        if head == "#":
            ident, _, label = rest.partition("|")
            return "#" + (label or channels.get(ident) or ident)
        if head == "!":
            if rest.startswith("subteam^"):
                ident, _, label = rest.partition("|")
                return label or "@" + ident.split("^", 1)[1]
            ident, _, label = rest.partition("|")
            if ident in BROADCAST_RANGES:
                return "@" + (label or ident)
            return label or ident

        target, _, label = body.partition("|")
        if not label or label == target:
            return target
        if target.startswith("mailto:") and target[7:] == label:
            return label
        return "%s (%s)" % (label, target)

    return unescape_entities(ANGLE_RE.sub(replace, text))


# === Files ===

def human_size(num_bytes):
    if num_bytes is None:
        return "unknown size"
    step = float(num_bytes)
    for unit in ("B", "KB", "MB", "GB"):
        if step < 1024 or unit == "GB":
            return "%.0f %s" % (step, unit) if unit == "B" else "%.1f %s" % (step, unit)
        step /= 1024
    return "%d B" % num_bytes


def sanitize_filename(name, fallback):
    base = os.path.basename((name or "").replace("\\", "/"))
    base = UNSAFE_FILENAME_RE.sub("_", base).strip(" .")
    if not base or base in (".", ".."):
        base = fallback
    return base[:120]


def looks_like_html_login(head_bytes, content_type, mimetype):
    if "html" in (mimetype or "").lower():
        return False
    if "text/html" in (content_type or "").lower():
        return True
    return head_bytes[:64].lstrip().lower().startswith(b"<!doctype html")


def download_file(entry, token, dest_dir, max_bytes):
    """Return a dict describing the download outcome for one Slack file."""
    name = entry.get("name") or entry.get("title") or entry.get("id") or "file"
    result = {
        "name": name,
        "mimetype": entry.get("mimetype") or entry.get("filetype") or "unknown",
        "size": entry.get("size"),
        "path": None,
        "status": "skipped",
        "note": "",
    }

    if entry.get("mode") == "tombstone":
        result["note"] = "deleted in Slack"
        return result

    url = entry.get("url_private_download") or entry.get("url_private")
    if not url:
        result["note"] = "no download URL (external or restricted file)"
        return result

    size = entry.get("size")
    if isinstance(size, int) and size > max_bytes:
        result["note"] = "larger than the %s limit" % human_size(max_bytes)
        return result

    file_id = entry.get("id") or ""
    filename = sanitize_filename(name, file_id or "file")
    if file_id:
        filename = "%s-%s" % (file_id, filename)
    target = os.path.join(dest_dir, filename)

    if isinstance(size, int) and os.path.exists(target) and os.path.getsize(target) == size:
        result["status"] = "saved"
        result["path"] = target
        result["size"] = size
        result["note"] = "reused from cache"
        return result

    req = Request(url, headers={"Authorization": "Bearer %s" % token})
    try:
        with urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
            head = resp.read(min(DOWNLOAD_CHUNK, max_bytes))
            if looks_like_html_login(head, resp.headers.get("Content-Type"), result["mimetype"]):
                result["status"] = "error"
                result["note"] = "Slack returned an HTML page instead of the file (auth rejected)"
                return result
            os.makedirs(dest_dir, exist_ok=True)
            written = 0
            with open(target, "wb") as out:
                chunk = head
                while chunk:
                    written += len(chunk)
                    if written > max_bytes:
                        out.close()
                        os.remove(target)
                        result["note"] = "exceeded the %s limit while downloading" % human_size(max_bytes)
                        return result
                    out.write(chunk)
                    chunk = resp.read(DOWNLOAD_CHUNK)
    except (HTTPError, URLError, OSError) as e:
        result["status"] = "error"
        result["note"] = "download failed (%s)" % e
        return result

    result["status"] = "saved"
    result["path"] = target
    result["size"] = written
    return result


# === Message shaping ===

def author_of(msg, users):
    uid = msg.get("user")
    if uid:
        return users.get(uid) or uid, uid
    profile = msg.get("bot_profile") or {}
    if profile.get("name"):
        return profile["name"], msg.get("bot_id")
    if msg.get("username"):
        return msg["username"], msg.get("bot_id")
    if msg.get("bot_id"):
        return msg["bot_id"], msg["bot_id"]
    return "unknown", None


def shape_attachments(msg, users, channels):
    shaped = []
    for att in msg.get("attachments") or []:
        title = att.get("title") or att.get("service_name") or ""
        body = att.get("text") or att.get("fallback") or ""
        link = att.get("title_link") or att.get("from_url") or ""
        if not title and not body:
            continue
        rendered = render_mrkdwn(body, users, channels)
        if len(rendered) > ATTACHMENT_TEXT_LIMIT:
            rendered = rendered[:ATTACHMENT_TEXT_LIMIT].rstrip() + "…"
        shaped.append({
            "title": render_mrkdwn(title, users, channels),
            "text": rendered,
            "link": link,
        })
    return shaped


def shape_message(msg, users, channels):
    raw = msg.get("text") or ""
    if not raw.strip():
        raw = extract_block_text(msg.get("blocks"))
    name, uid = author_of(msg, users)
    ts = msg.get("ts") or "0"
    return {
        "ts": ts,
        "when": datetime.fromtimestamp(float(ts)),
        "author": name,
        "author_id": uid,
        "subtype": msg.get("subtype"),
        "text": render_mrkdwn(raw, users, channels),
        "reactions": [
            {"name": r.get("name"), "count": r.get("count", 0)}
            for r in (msg.get("reactions") or []) if r.get("name")
        ],
        "attachments": shape_attachments(msg, users, channels),
        "files": [],
        "raw_files": msg.get("files") or [],
    }


def collect_ids(messages):
    users = set()
    channels = set()
    for msg in messages:
        if msg.get("user"):
            users.add(msg["user"])
        text_pool = [msg.get("text") or "", extract_block_text(msg.get("blocks"))]
        for att in msg.get("attachments") or []:
            text_pool.append(att.get("text") or "")
            text_pool.append(att.get("title") or "")
        for chunk in text_pool:
            users.update(USER_MENTION_RE.findall(chunk))
            channels.update(CHANNEL_MENTION_RE.findall(chunk))
    return users, channels


# === Output ===

def format_thread_markdown(thread):
    lines = []
    messages = thread["messages"]
    count = len(messages)
    label = thread["channel_label"]

    lines.append("## Slack thread — %s (%d %s)" % (
        label, count, "message" if count == 1 else "messages"))

    if messages:
        first = messages[0]["when"]
        last = messages[-1]["when"]
        tz = datetime.now().astimezone().strftime("%Z")
        if first.date() == last.date():
            span = "%s  %s → %s (%s)" % (
                first.strftime("%Y-%m-%d"), first.strftime("%H:%M"),
                last.strftime("%H:%M"), tz)
        else:
            span = "%s → %s (%s)" % (
                first.strftime("%Y-%m-%d %H:%M"), last.strftime("%Y-%m-%d %H:%M"), tz)
        lines.append(span)

    lines.append(thread["url"])
    if thread["standalone"]:
        lines.append("")
        lines.append("> Standalone message — no replies. This is not a thread.")
    lines.append("")

    multiday = bool(messages) and messages[0]["when"].date() != messages[-1]["when"].date()
    stamp = "%Y-%m-%d %H:%M" if multiday else "%H:%M"

    for msg in messages:
        text = msg["text"] or "(no text)"
        body = text.split("\n")
        lines.append("[%s] %s: %s" % (msg["when"].strftime(stamp), msg["author"], body[0]))
        for extra in body[1:]:
            lines.append("  %s" % extra)
        for att in msg["attachments"]:
            head = att["title"] or "attachment"
            if att["link"]:
                head = "%s (%s)" % (head, att["link"])
            lines.append("  ↳ attachment: %s" % head)
            if att["text"]:
                for extra in att["text"].split("\n"):
                    lines.append("    %s" % extra)
        for f in msg["files"]:
            descriptor = "%s (%s, %s)" % (f["name"], f["mimetype"], human_size(f["size"]))
            if f["status"] == "saved":
                suffix = " (%s)" % f["note"] if f["note"] else ""
                lines.append("  ↳ file: %s → %s%s" % (descriptor, f["path"], suffix))
            elif f["status"] == "error":
                lines.append("  ↳ file: %s — NOT downloaded: %s" % (descriptor, f["note"]))
            else:
                lines.append("  ↳ file: %s — skipped: %s" % (
                    descriptor, f["note"] or "downloads disabled"))
        if msg["reactions"]:
            rendered = ", ".join(":%s: ×%d" % (r["name"], r["count"]) for r in msg["reactions"])
            lines.append("  ↳ %s" % rendered)
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def thread_to_json(thread):
    return {
        "ok": True,
        "url": thread["url"],
        "channel_id": thread["channel_id"],
        "channel_label": thread["channel_label"],
        "channel_kind": thread["kind"],
        "root_ts": thread["root_ts"],
        "standalone": thread["standalone"],
        "message_count": len(thread["messages"]),
        "messages": [
            {
                "ts": m["ts"],
                "time": m["when"].astimezone().isoformat(),
                "author": m["author"],
                "author_id": m["author_id"],
                "subtype": m["subtype"],
                "text": m["text"],
                "reactions": m["reactions"],
                "attachments": m["attachments"],
                "files": m["files"],
            }
            for m in thread["messages"]
        ],
    }


# === Orchestration ===

def process_url(url, token, session, args):
    channel_id, root_ts = parse_permalink(url)

    try:
        raw_messages, root_ts = fetch_thread(channel_id, root_ts, token)
    except SlackError as e:
        raise RuntimeError(describe_slack_error(e, channel_id, token))

    if not raw_messages:
        raise RuntimeError("Slack returned no messages for %s at %s." % (channel_id, root_ts))

    info_payload = slack_get_optional("conversations.info", {"channel": channel_id}, token)
    info = (info_payload or {}).get("channel")
    kind = channel_kind(info, channel_id)

    user_ids, channel_ids = collect_ids(raw_messages)
    resolve_users(user_ids, token, session["users"])
    resolve_channel_names(channel_ids, token, session["channels"])

    messages = [shape_message(m, session["users"], session["channels"]) for m in raw_messages]
    messages.sort(key=lambda m: float(m["ts"]))

    if not args.no_files:
        dest_dir = os.path.join(args.out_dir, "%s-%s" % (channel_id, root_ts))
        max_bytes = int(args.max_file_mb * 1024 * 1024)
        for msg in messages:
            for entry in msg["raw_files"]:
                msg["files"].append(download_file(entry, token, dest_dir, max_bytes))
    else:
        for msg in messages:
            for entry in msg["raw_files"]:
                msg["files"].append({
                    "name": entry.get("name") or entry.get("id") or "file",
                    "mimetype": entry.get("mimetype") or "unknown",
                    "size": entry.get("size"),
                    "path": None,
                    "status": "skipped",
                    "note": "--no-files",
                })

    for msg in messages:
        msg.pop("raw_files", None)

    standalone = len(messages) == 1 and not raw_messages[0].get("reply_count")

    return {
        "url": url,
        "channel_id": channel_id,
        "channel_label": channel_label(info, channel_id, kind),
        "kind": kind,
        "root_ts": root_ts,
        "standalone": standalone,
        "messages": messages,
    }


def main():
    parser = argparse.ArgumentParser(
        description="Fetch a Slack thread via the Web API and print it as markdown.")
    parser.add_argument("urls", nargs="+", help="Slack message permalink(s)")
    parser.add_argument("--no-files", action="store_true", help="Do not download attachments")
    parser.add_argument("--max-file-mb", type=float, default=DEFAULT_MAX_FILE_MB,
                        help="Skip attachments larger than this (default: %d)" % DEFAULT_MAX_FILE_MB)
    parser.add_argument("--out-dir", default=os.path.join(CACHE_ROOT, "files"),
                        help="Where attachments are saved")
    parser.add_argument("--json", action="store_true", dest="as_json",
                        help="Emit structured JSON instead of markdown")
    args = parser.parse_args()

    if not args.max_file_mb > 0:
        parser.error(
            "--max-file-mb must be greater than 0 (got %s). "
            "Use --no-files to skip attachment downloads entirely." % args.max_file_mb)

    token = get_token()
    args.out_dir = os.path.expanduser(args.out_dir)

    identity = slack_get_optional("auth.test", {}, token)
    if not identity:
        message = ("auth.test failed — SLACK_TOKEN is not usable. "
                   "Check the token in .env.agent.")
        if args.as_json:
            print(json.dumps([{"ok": False, "error": message}], ensure_ascii=False, indent=2))
        else:
            print("Error: %s" % message, file=sys.stderr)
        return 1

    team_id = identity.get("team_id")
    session = {"users": load_user_cache(team_id), "channels": {}}
    cached_user_count = len(session["users"])

    results = []
    failures = 0

    for url in args.urls:
        try:
            thread = process_url(url, token, session, args)
        except PermalinkError:
            failures += 1
            message = permalink_help(url)
            results.append({"ok": False, "url": url, "error": message})
            if not args.as_json:
                print(message, file=sys.stderr)
            continue
        except RuntimeError as e:
            failures += 1
            results.append({"ok": False, "url": url, "error": str(e)})
            if not args.as_json:
                print("Error: %s" % e, file=sys.stderr)
            continue

        results.append(thread_to_json(thread) if args.as_json else thread)
        if not args.as_json:
            print(format_thread_markdown(thread))

    if len(session["users"]) != cached_user_count:
        save_user_cache(team_id, session["users"])

    if args.as_json:
        print(json.dumps(results, ensure_ascii=False, indent=2))

    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
