#!/usr/bin/env bash
# fetch-hn.sh — pull Hacker News top stories as a clean, pre-filtered list.
#
# Hacker News is the backbone source for /tech-digest: its score + comment
# counts are a community quality signal, so the digest starts from stories
# that real engineers already upvoted rather than blind web search.
#
# Output: one story per line, TAB-separated, sorted by score descending:
#   score <TAB> comments <TAB> title <TAB> url
#
# The /tech-digest skill reads this, then applies the model's judgement to
# pick + summarize. This script does NO summarizing — it's a fast fetch.
#
# Usage:
#   fetch-hn.sh [--n N] [--min-score S] [--type top|best|new]
#     --n N           how many top story IDs to fetch (default 30)
#     --min-score S   drop stories below this score (default 40)
#     --type          which HN list (default top; best = highest-rated recent)
#
# No API key needed (HN Firebase API is public). Network errors print a
# warning to stderr and exit non-zero, but never hang (every curl is capped).

set -uo pipefail

N=30
MIN_SCORE=40
LIST="topstories"

while [ $# -gt 0 ]; do
  case "$1" in
    --n)         N="${2:-30}"; shift 2 ;;
    --min-score) MIN_SCORE="${2:-40}"; shift 2 ;;
    --type)
      case "${2:-top}" in
        best) LIST="beststories" ;;
        new)  LIST="newstories" ;;
        *)    LIST="topstories" ;;
      esac
      shift 2 ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//' | head -22; exit 0 ;;
    *) shift ;;
  esac
done

API="https://hacker-news.firebaseio.com/v0"
CURL="curl -s --max-time 12 --retry 1"

# Need jq for clean JSON parsing. Fail loud if absent (rather than silently
# producing garbage) so the skill can fall back to WebFetch.
if ! command -v jq >/dev/null 2>&1; then
  echo "fetch-hn: jq not found — cannot parse HN JSON. Skill should use WebFetch fallback." >&2
  exit 3
fi

# 1. Fetch the list of top story IDs.
IDS=$($CURL "$API/${LIST}.json" 2>/dev/null | jq -r '.[]' 2>/dev/null | head -n "$N")
if [ -z "$IDS" ]; then
  echo "fetch-hn: could not fetch HN ${LIST} (network down or API changed)." >&2
  exit 1
fi

# 2. Fetch each item, emit TSV rows. Skip non-story types and self/Ask posts
#    with no URL (those are discussion threads, not articles to read).
#    Keep it sequential but capped — ~30 small JSON fetches is a few seconds.
emit_rows() {
  local id json score comments title url type
  for id in $IDS; do
    json=$($CURL "$API/item/${id}.json" 2>/dev/null)
    [ -z "$json" ] && continue
    type=$(printf '%s' "$json"  | jq -r '.type // "story"' 2>/dev/null)
    [ "$type" = "story" ] || continue
    score=$(printf '%s' "$json" | jq -r '.score // 0' 2>/dev/null)
    comments=$(printf '%s' "$json" | jq -r '.descendants // 0' 2>/dev/null)
    title=$(printf '%s' "$json" | jq -r '.title // ""' 2>/dev/null)
    url=$(printf '%s' "$json"   | jq -r '.url // ""' 2>/dev/null)
    [ -z "$title" ] && continue
    # No external URL → it's an Ask/Show-text thread; point at the HN discussion.
    [ -z "$url" ] && url="https://news.ycombinator.com/item?id=${id}"
    # score filter
    [ "$score" -ge "$MIN_SCORE" ] 2>/dev/null || continue
    # strip tabs/newlines from title to keep TSV intact
    title=$(printf '%s' "$title" | tr '\t\n' '  ')
    printf '%s\t%s\t%s\t%s\n' "$score" "$comments" "$title" "$url"
  done
}

# 3. Sort by score descending (numeric, first column).
ROWS=$(emit_rows | sort -t$'\t' -k1,1 -nr)

if [ -z "$ROWS" ]; then
  echo "fetch-hn: fetched ${LIST} but nothing cleared min-score=${MIN_SCORE}." >&2
  echo "# (try a lower --min-score)" >&2
  exit 0
fi

# Header comment (lines starting with # are easy for the skill to skip).
echo "# HN ${LIST} · top ${N} fetched · min-score ${MIN_SCORE} · score<TAB>comments<TAB>title<TAB>url"
printf '%s\n' "$ROWS"
