---
name: tech-digest
description: Daily curated tech reading list. Fetches Hacker News top stories plus targeted web searches across the areas you follow (web/frontend, AI/LLM, backend/infra, Shopify, crypto/web3, security, DSA), filters HARD to ~10-15 of the best items, groups them into 🔥 hot / 💼 work-relevant / 🌐 broader sections, writes a one-or-two-line "why it's worth reading" in Vietnamese per item, and saves a dated file you can re-read. Also lets you SAVE specific articles to a read-it-later list (`/tech-digest save 2 5` → saved.md, `/tech-digest saved` to reopen) and FOLLOW sources — a blog, author, repo, or topic (`/tech-digest follow <url|name>`) that future digests fetch first and surface in a dedicated 📌 NỔI BẬT section. Built so a busy dev gets the signal without scrolling feeds. Summaries are grounded in real fetched sources, never invented. Use when asked for "tech news", "what's new in tech", "daily digest", "tech-digest", "reading list", to catch up on what shipped recently, or to save/follow something worth tracking.
---

# /tech-digest — Daily curated tech reading list

You are a **sharp engineer friend who reads everything so the user doesn't have
to.** They're busy; their colleagues stay current by grazing feeds all day. Your
job is to do that grazing, then hand back only the 10-15 things actually worth their
time — grouped, with a concrete reason to read each.

**CRITICAL — you cannot rely on memory.** Your knowledge cutoff is months old. Every
item in the digest MUST come from a source you fetched or searched *this run*. Never
list a story from memory, never invent a URL, never pad to hit a number. A short
honest digest beats a long fabricated one.

**The value is the FILTER, not the volume.** The user's interests are broad — if you
dump everything, you've just moved their feed-scrolling into a file. Cut hard. Each
item must earn its place.

---

## HARD GATES (read every run)

1. **Real sources only.** Every item = a URL you actually fetched (HN) or got from
   WebSearch this run. No memory, no invented links. If you're unsure a URL is real,
   drop the item.
2. **Filter, don't gather.** ~10-15 items default. Better to ship 8 great ones than
   20 mediocre. Say how many you kept and how many you dropped.
3. **Concrete "why" per item.** One or two lines in Vietnamese saying *specifically*
   why it's worth reading ("Postgres team giải thích vì sao DELETE không scale, chỉ
   DROP TABLE mới scale — đúng vấn đề khi dọn bảng lớn"). Banned: vague filler like
   "thú vị", "đáng chú ý", "hay" with no substance.
4. **Read-only + save only.** Only fetch web and write under the digest vault
   (`personal/tech-digest/`, resolved in Step 0 as `$DIGEST_DIR`). Never touch repo
   code outside that vault. Never commit (the user commits the vault when they choose).

---

## Detect scope

Parse input after `/tech-digest`:

| Input | Behavior |
|---|---|
| *(nothing)* | **Default digest** — ~10-15 items, all sections |
| `--wide` | Wider sweep — ~20-30 items (when the user wants to dig deeper one day) |
| `list` | List saved digests in the digest vault `$DIGEST_DIR` (newest first), then stop |
| `save <N...>` | **Save-for-later** — add items #N (from the LAST digest's numbering) to `saved.md`. See "Save / Saved". |
| `saved` | Show the read-it-later list (`saved.md`), newest first, then stop. |
| `saved done <N>` | Tick item #N in `saved.md` as read (`[x]`), then stop. |
| `follow <url\|name\|topic:...>` | **Follow a source** — append to `sources.md`. See "Follow / Sources". |
| `sources` | Show the followed-sources list (`sources.md`), then stop. |
| `unfollow <name>` | Remove a source from `sources.md` (match on identifier/substring), then stop. |
| `<topic>` (e.g. `security`, `ai`, `frontend`) | Single-area digest — focus searches there |

> **Routing note:** `save`, `saved`, `follow`, `sources`, `unfollow` are **management
> sub-commands** — they do NOT run a digest. Handle them via the "Save / Saved" and
> "Follow / Sources" sections below and STOP. Only the digest scopes (nothing, `--wide`,
> `<topic>`) run the Step 1-4 fetch pipeline.

---

## Step 0 — Setup

The digest vault lives **inside the dotfiles repo** (`personal/tech-digest/`) so
saved digests sync across machines via git. Resolve its path from this skill's real
location (following the `~/.claude/skills/tech-digest` symlink back to the repo), so
it works no matter where the repo is cloned. `$TECH_DIGEST_DIR` overrides it.

```bash
# Resolve the skill's real dir (skills/tech-digest), then walk up to personal/tech-digest
SKILL_LINK="$HOME/.claude/skills/tech-digest"
SKILL_REAL="$(cd "$(dirname "$(readlink "$SKILL_LINK" || echo "$SKILL_LINK")")" 2>/dev/null && pwd)/$(basename "$(readlink "$SKILL_LINK" || echo "$SKILL_LINK")")"
# personal/skills/tech-digest -> personal/tech-digest
DIGEST_DIR="${TECH_DIGEST_DIR:-$(cd "$SKILL_REAL/../.." && pwd)/tech-digest}"
mkdir -p "$DIGEST_DIR"
TODAY=$(date +%Y-%m-%d)            # never hardcode the date
NICE_DATE=$(date "+%A, %d/%m/%Y")  # for the header
SEEN="$DIGEST_DIR/seen-urls.txt"
SOURCES="$DIGEST_DIR/sources.md"   # followed sources (📌 NỔI BẬT)
SAVED="$DIGEST_DIR/saved.md"       # read-it-later list
echo "DIGEST_DIR=$DIGEST_DIR"; echo "TODAY=$TODAY"; echo "NICE_DATE=$NICE_DATE"
echo "--- already-seen URLs (skip these): ---"
[ -f "$SEEN" ] && wc -l < "$SEEN" || echo "0 (no history yet)"
echo "--- followed sources (fetch these first, Step 2): ---"
[ -f "$SOURCES" ] && sed -n '/<!-- FOLLOW-LIST/,$p' "$SOURCES" | grep '^- ' || echo "(none followed yet)"
```

For `list` scope: `ls -t "$DIGEST_DIR"/*.md 2>/dev/null` and show the dates, then stop.

Read `$SEEN` (if it exists) so you can drop articles already shown on previous days.
Read the follow-list in `$SOURCES` (lines under the `<!-- FOLLOW-LIST` marker) — these
drive Step 2's priority fetch and the 📌 NỔI BẬT section. `$SAVED` is only touched by the
`save` / `saved` sub-commands, not by a normal digest run.

---

## Step 1 — Fetch Hacker News (backbone)

Run the helper (it returns score-sorted, pre-filtered stories):

```bash
bash "$HOME/.claude/skills/tech-digest/scripts/fetch-hn.sh" --n 30 --min-score 40
```

(If that path is missing, use `$HOME/Project/github/dotfiles-claude/personal/skills/tech-digest/scripts/fetch-hn.sh`.)

For `--wide`, raise `--n 50 --min-score 25`. Each row is
`score <TAB> comments <TAB> title <TAB> url`. Skip `#` comment lines. If the script
errors (network down), say so and fall back to a couple of WebSearch queries for HN
front page — do not silently produce an empty digest.

---

## Step 2a — Fetch FOLLOWED sources first (feeds 📌 NỔI BẬT)

Before the general area searches, go through the follow-list read in Step 0 (lines
under `<!-- FOLLOW-LIST` in `$SOURCES`). For **each** followed source, actively look
for what's NEW from it this run:

| kind | how to fetch what's new |
|---|---|
| `site` (blog/domain) | `WebSearch` scoped to it: `site:<domain> {month} {year}` — or `WebFetch <domain>` if it's a small blog index, to read recent post titles. |
| `author` (person) | `WebSearch "<name>" {month} {year}` — latest posts/talks/releases by them. |
| `repo` (owner/name) | `WebFetch https://github.com/<owner>/<name>/releases` (or search `<owner>/<name> release {month} {year}`) for a new version/changelog. |
| `topic` (subject) | `WebSearch "<topic>" {month} {year}` — fresh developments in that subject. |

Rules for followed sources:
- **They get priority, not a free pass.** Only include an item if there's something
  genuinely NEW and its URL isn't in `$SEEN`. A followed blog with nothing new this
  week contributes nothing — that's fine, don't invent.
- Items that qualify go into the **📌 NỔI BẬT** section (Step 3/4), NOT the 3 general
  sections, and are exempt from the hard ~10-15 cut (follow = "always show me this").
- Still obey the no-fabrication gate: real fetched URL or it doesn't appear.
- If `$SOURCES` has no follow entries, skip this step entirely (no 📌 section).

## Step 2b — Targeted web search for the areas HN under-covers

HN skews toward general/backend/AI. For the user's other areas, run **focused**
WebSearch queries (1-2 per area you're covering this run), always scoped to recency:

- frontend/web: e.g. `"React" OR "browser" new release {month} {year}`
- AI/LLM & dev tools: e.g. `new AI coding tool {month} {year}`
- backend/infra & languages: e.g. `Rust OR Go OR database released {month} {year}`
- Shopify/ecommerce: e.g. `Shopify developer changelog {month} {year}`
- crypto/web3, security, DSA: one query each only when in scope

Get `{month} {year}` from the `date` output in Step 0 — do NOT hardcode.

**Reject SEO/listicle results.** Skip titles matching "top N", "best ... 2026",
"ultimate guide", "X tools compared", and content-farm domains. Prefer **primary
sources**: author blogs, project repos, release notes, RFCs, papers, official
changelogs. Use WebSearch's `blocked_domains` for known farms when helpful. If a
result looks like an ad or PR piece, drop it.

For any promising search hit where the title alone isn't enough, you may `WebFetch`
the URL for a one-line "what is this" — but don't fetch everything (costs turns).

---

## Step 3 — Filter and group (this is the "gu" — the judgement)

From the HN rows + search hits combined:

1. **Drop** anything whose URL is in `$SEEN` (already shown before).
2. **Pick the best ~10-15** (or ~20-30 for `--wide`; all-from-one-area for a topic
   scope). Judge by: genuinely new/important, substance over hype, primary source,
   relevant to the user's areas. HN score is a hint, not the only signal.
3. **Group into sections:**
   - 📌 **NỔI BẬT (từ nguồn theo dõi)** — new items from FOLLOWED sources (Step 2a).
     Goes FIRST, above everything. Omit the whole section if nothing new from follows
     today. These are exempt from the ~10-15 cut.
   - 🔥 **HOT HÔM NAY** — the 2-3 biggest things today, any area (highest signal /
     most discussed / most consequential).
   - 💼 **SÁT CÔNG VIỆC** — frontend / AI / Shopify (closest to the user's Joy work).
   - 🌐 **RỘNG HƠN** — backend / crypto / web3 / security / DSA / everything else.
   (Put each item in exactly one section — a follow-source item goes in 📌, not also in
   a general section. If a section has nothing good today, omit it rather than padding.)
4. For each item write: the original **title** (keep English), the source + signal
   (e.g. `HN 818↑ 242💬` or the domain), a **Vietnamese** one/two-line *why*, and the
   URL. Tech terms/product names stay in English. In 📌, add which followed source it
   came from (e.g. `theo: overreacted.io`).
5. **Number every item sequentially across the whole digest** (1, 2, 3... continuing
   through all sections). This numbering is what `/tech-digest save <N>` references, so
   it must be visible in both the printed output and the saved file.

---

## Step 4 — Output + save

Print this to the user, AND write the same content to `$DIGEST_DIR/$TODAY.md`:

Number items sequentially across ALL sections (the `N.` prefix). Omit 📌 when no
followed source had anything new.

**Every item MUST end with its full clickable URL on its own line** — in BOTH the
printed output and the saved file, for every section including 📌. The URL is what
makes the item readable-now (the user clicks straight from the terminal). Never drop,
shorten, or truncate it, never collapse it into the title, never emit an item without
its link. An item with no URL is a fabrication (see hard gates) — omit it entirely
rather than printing a linkless line. Print the URL in full even if long; do not use
"[link]" or markdown link syntax — the raw URL so it's clickable in a terminal.

```
TECH DIGEST — {NICE_DATE}
════════════════════════════════════════

📌 NỔI BẬT (từ nguồn theo dõi)
  1. {Title}  ({source} · theo: {followed-source})
     → {tiếng Việt: có gì mới}
     {url}

🔥 HOT HÔM NAY
  2. {Title}  ({source}, {signal})
     → {tiếng Việt: vì sao đáng đọc — cụ thể}
     {url}

💼 SÁT CÔNG VIỆC
  3. {Title}  ({source})
     → {tiếng Việt}
     {url}

🌐 RỘNG HƠN
  4. {Title}  ({source})
     → {tiếng Việt}
     {url}

────────────────────────────────────────
📊 {N} mục · bỏ {M} bài (trùng/đã đọc/SEO) · lưu: personal/tech-digest/{TODAY}.md
💾 Lưu đọc sau:  /tech-digest save <số>   (vd: save 1 3)
```

The `save <N>` footer line is required whenever the digest has items — it's how the
user knows the numbers map to the save command.

Then append every URL you listed to `$SEEN` so tomorrow won't repeat them:

```bash
# After writing the digest, append the listed URLs (one per line) to $SEEN.
# Use the Write/Edit tools or a printf-append in bash with the exact URLs.
```

If `$TODAY.md` already exists (ran twice today), append a `--- run 2 ({time}) ---`
section instead of overwriting — saved files are append-only.

---

## Save / Saved (read-it-later) — sub-commands, NO digest run

These operate on `$SAVED` (`personal/tech-digest/saved.md`). They do NOT fetch or run
a digest — do the file op and stop.

### `save <N...>` — stash items from the last digest

The numbers reference the **most recent digest's** sequential numbering. Resolve them
from today's file (or the newest digest file if none today):

```bash
# Newest digest file = source of the numbering the user is referencing.
LATEST=$(ls -t "$DIGEST_DIR"/20[0-9][0-9]-[0-9][0-9]-[0-9][0-9].md 2>/dev/null | head -1)
echo "LATEST=$LATEST"   # read this to map N -> {title, why, url}
```

Read `$LATEST`, find each requested item by its `N.` number, and for each one **prepend**
a block just under the `<!-- SAVED-LIST` marker in `$SAVED` (newest on top), format:

```
- [ ] {title} — {domain} · lưu {TODAY} (digest {date-of-LATEST})
      → {why line, copied/condensed from the digest}
      {url}
```

Use Read + Edit on `$SAVED` (anchor the Edit on the `<!-- SAVED-LIST ... -->` marker line,
insert after it). Never overwrite existing entries. If a requested number doesn't exist
in `$LATEST`, say so and skip it. Confirm: `ĐÃ LƯU {k} bài vào saved.md` + list titles.

### `saved` — show the list

Read `$SAVED` and print the entries (they're already newest-first). Lead with counts:
`{open} chưa đọc · {done} đã đọc`. If empty, say so and hint `save <N>` after a digest.

### `saved done <N>` — mark one read

Here `<N>` is the position in the `saved` listing you just showed (1 = topmost). Flip
that item's `- [ ]` to `- [x]` in `$SAVED` (Edit, unique match on the title line). Don't
delete — the list keeps a record of what you've read. Confirm the title.

---

## Follow / Sources — sub-commands, NO digest run

These operate on `$SOURCES` (`personal/tech-digest/sources.md`), the follow-list Step 2a
reads. They do NOT run a digest.

### `follow <arg>` — add a source

Classify `<arg>` into a `kind`, then **append** one line under the `<!-- FOLLOW-LIST`
marker in `$SOURCES`:

| `<arg>` looks like | kind | stored identifier |
|---|---|---|
| a URL / bare domain (`overreacted.io`, `https://...`) | `site` | the domain |
| `owner/name` (GitHub-style) | `repo` | `owner/name` |
| `topic:<thing>` or a multi-word subject phrase | `topic` | the subject text |
| a person's name (quoted, e.g. `"Dan Abramov"`) | `author` | the name |

Line format (Edit-insert after the marker; keep it one line per source):

```
- [{kind}] {identifier} — {ghi chú: theo dõi vì gì — hỏi user 1 câu ngắn nếu không rõ}
```

Before adding, read `$SOURCES` and skip if the identifier already exists (report "đã
follow rồi"). Confirm: `ĐANG THEO DÕI [{kind}] {identifier}` + note that the next digest
will pull from it into 📌 NỔI BẬT.

### `sources` — show the follow-list

Read `$SOURCES`, print the entries under the marker grouped/as-is. If none, say so and
hint `follow <url|name>`.

### `unfollow <name>` — remove a source

Read `$SOURCES`, find the line whose identifier contains `<name>` (substring, case-
insensitive). Exactly one match → remove that line (Edit). Multiple matches → list them
and ask which. No match → say so. Confirm the removed identifier.

---

## Important rules

- **No fabrication, ever.** Every URL must be one you fetched/searched this run. This
  is the difference between useful and worthless. When in doubt, drop it.
- **Always print the link.** Every listed item shows its full raw URL on its own line,
  ready to click — in the printed digest AND the saved `.md`, every section. No item
  without a link; no shortening/truncating. Missing link = drop the item, don't print
  it linkless.
- **Cut hard.** The user picked broad interests; your job is the filter that makes
  breadth readable. 10-15 great items, not 40 okay ones.
- **Vietnamese summaries, English terms.** Write the "why" in Vietnamese; keep titles,
  product names, and tech jargon in English.
- **Specific reasons.** Every "why" line tells the user something concrete about the
  content — enough to decide open-or-skip in 2 seconds.
- **Read-only + save.** Web + the digest vault (`$DIGEST_DIR`, includes `saved.md` +
  `sources.md`) only. No other repo edits, no commits.
- **Follow ≠ free pass.** A followed source only produces a 📌 item when it has something
  genuinely NEW this run (real fetched URL, not in `$SEEN`). No new = no item; never
  fabricate to fill 📌.
- **Number stability.** `save <N>` maps to the last digest's printed numbers, so always
  print sequential numbers and keep them in the saved file.
- **Honest counts.** Report how many kept / dropped. If sources were thin today, say
  so and list fewer — never pad.
- **Future:** to run this automatically each morning, wrap it with `/schedule` (the
  user can ask). This skill is the manual core that a schedule would call.
```
