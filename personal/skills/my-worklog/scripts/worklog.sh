#!/usr/bin/env bash
# worklog.sh — terminal standup view for /my-worklog.
#
# Reads the gstack checkpoint store (~/.gstack/projects/<SLUG>/checkpoints/*.md),
# hides tasks marked `status: done`, groups the rest by day, and prints each
# task's one-line `next_action` so you can pick up where you left off. When a
# save also recorded an `in_flight` value (something left half-finished at the
# moment of saving), it prints as a dim second line under the next action.
#
# No Claude needed — this is the "quick glance" view. For a smarter summary or
# to actually resume a task into a session, use the /my-worklog skill.
#
# Usage:
#   worklog.sh              # tasks for the CURRENT project (by git slug)
#   worklog.sh --all        # tasks across ALL projects in the store
#   worklog.sh --done       # include done tasks too (normally hidden)
#
# Exit codes: 0 always (a glance tool should never break a prompt).

set -uo pipefail

WANT_ALL=0
SHOW_DONE=0
for arg in "$@"; do
  case "$arg" in
    --all)  WANT_ALL=1 ;;
    --done) SHOW_DONE=1 ;;
    -h|--help)
      grep '^#' "$0" | grep -v '^#!' | sed 's/^# \{0,1\}//' | head -17
      exit 0 ;;
  esac
done

# --- locate the state root + project slug -----------------------------------
# Prefer the repo's gstack-slug (sanitized SLUG). Fall back to a basename if the
# helper isn't on PATH (e.g. running outside a configured machine).
STATE_ROOT="${GSTACK_STATE_ROOT:-$HOME/.gstack}"

resolve_slug() {
  # Try gstack-slug from PATH, then the well-known dotfiles checkout.
  local slug_bin=""
  if command -v gstack-slug >/dev/null 2>&1; then
    slug_bin="gstack-slug"
  elif [ -x "$HOME/Project/github/dotfiles-claude/bin/gstack-slug" ]; then
    slug_bin="$HOME/Project/github/dotfiles-claude/bin/gstack-slug"
  fi
  if [ -n "$slug_bin" ]; then
    # gstack-slug prints `SLUG=...` and `BRANCH=...`; eval is safe (sanitized).
    eval "$("$slug_bin" 2>/dev/null)" 2>/dev/null
    [ -n "${SLUG:-}" ] && { printf '%s' "$SLUG"; return; }
  fi
  # Fallback: sanitized basename of cwd.
  basename "$PWD" | tr -cd 'a-zA-Z0-9._-'
}

# --- read one frontmatter field from a checkpoint file ----------------------
# Only scans the block between the first two `---` fences. Returns "" if absent.
read_fm() {
  local file="$1" key="$2"
  awk -v key="$key" '
    NR==1 && $0=="---" { infm=1; next }
    infm && $0=="---"  { exit }
    infm {
      # match `key: value` (value may be quoted)
      idx = index($0, ":")
      if (idx > 0) {
        k = substr($0, 1, idx-1)
        gsub(/^[ \t]+|[ \t]+$/, "", k)
        if (k == key) {
          v = substr($0, idx+1)
          gsub(/^[ \t]+|[ \t]+$/, "", v)
          # strip one layer of surrounding quotes
          gsub(/^"|"$/, "", v)
          gsub(/^'\''|'\''$/, "", v)
          print v
          exit
        }
      }
    }
  ' "$file"
}

# Title comes from the `## Working on: <title>` line (fallback: filename slug).
read_title() {
  local file="$1" t
  t=$(grep -m1 '^## Working on:' "$file" 2>/dev/null | sed 's/^## Working on:[[:space:]]*//')
  if [ -z "$t" ]; then
    # filename: YYYYMMDD-HHMMSS-<title-slug>.md  → take the slug part
    t=$(basename "$file" .md | sed -E 's/^[0-9]{8}-[0-9]{6}-//; s/-/ /g')
  fi
  printf '%s' "$t"
}

# --- gather checkpoint dirs --------------------------------------------------
declare -a DIRS=()
if [ "$WANT_ALL" -eq 1 ]; then
  while IFS= read -r d; do DIRS+=("$d"); done < <(find "$STATE_ROOT/projects" -maxdepth 2 -type d -name checkpoints 2>/dev/null | sort)
  SCOPE_LABEL="all projects"
else
  SLUG="$(resolve_slug)"
  DIRS=("$STATE_ROOT/projects/$SLUG/checkpoints")
  SCOPE_LABEL="$SLUG"
fi

# --- collect candidate files (newest first by filename prefix) --------------
declare -a FILES=()
for d in "${DIRS[@]}"; do
  [ -d "$d" ] || continue
  while IFS= read -r f; do FILES+=("$f"); done < <(find "$d" -maxdepth 1 -name '*.md' -type f 2>/dev/null | sort -r)
done

if [ "${#FILES[@]}" -eq 0 ]; then
  printf '\n  No saved work yet for \033[1m%s\033[0m.\n' "$SCOPE_LABEL"
  printf '  Save the current task with \033[36m/my-worklog save\033[0m, then check back here.\n\n'
  exit 0
fi

# --- group by day, dedup to the NEWEST file per branch ----------------------
# A task = a branch. Multiple saves on the same branch collapse to the latest
# (files are already sorted newest-first, so first-seen wins).
# macOS ships bash 3.2 (no associative arrays), so the seen-set is a plain
# newline-delimited string we grep against. Keys are branch names normalized here
# to [a-zA-Z0-9._-], so newline/glob collisions can't happen and the same branch
# saved with or without slashes (feature/foo vs featurefoo) counts as one task.
SEEN_BRANCH=$'\n'
CUR_DAY=""
SHOWN=0
HID_DONE=0

# human-ish day header from a YYYYMMDD prefix
fmt_day() {
  local ymd="$1" iso="${1:0:4}-${1:4:2}-${1:6:2}"
  # GNU date vs BSD date (macOS) — try both, fall back to raw ISO.
  date -j -f "%Y-%m-%d" "$iso" "+%a %d/%m/%Y" 2>/dev/null \
    || date -d "$iso" "+%a %d/%m/%Y" 2>/dev/null \
    || printf '%s' "$iso"
}

printf '\n\033[1mIN PROGRESS\033[0m — %s\n' "$SCOPE_LABEL"

for f in "${FILES[@]}"; do
  base=$(basename "$f")
  day="${base:0:8}"
  [[ "$day" =~ ^[0-9]{8}$ ]] || day="00000000"

  status=$(read_fm "$f" status); status="${status:-in-progress}"
  branch=$(read_fm "$f" branch); branch="${branch:-unknown}"

  # one task per branch (newest save wins) — unless --all, where the same branch
  # name could legitimately exist in different projects; key by dir+branch then.
  bkey=$(printf '%s' "$branch" | tr -cd 'a-zA-Z0-9._-')
  bkey="${bkey:-unknown}"
  [ "$WANT_ALL" -eq 1 ] && bkey="$(dirname "$f")::$bkey"
  case "$SEEN_BRANCH" in
    *$'\n'"$bkey"$'\n'*) continue ;;
  esac
  SEEN_BRANCH="${SEEN_BRANCH}${bkey}"$'\n'

  if [ "$status" = "done" ] && [ "$SHOW_DONE" -eq 0 ]; then
    HID_DONE=$((HID_DONE+1))
    continue
  fi

  title=$(read_title "$f")
  next=$(read_fm "$f" next_action)
  inflight=$(read_fm "$f" in_flight)

  if [ "$day" != "$CUR_DAY" ]; then
    CUR_DAY="$day"
    printf '\n  \033[2m%s\033[0m\n' "$(fmt_day "$day")"
  fi

  # task line: [branch] Title   (+ done marker if showing done)
  if [ "$status" = "done" ]; then
    printf '    \033[32m[%s]\033[0m %s \033[32m✓ done\033[0m\n' "$branch" "$title"
  else
    printf '    \033[36m[%s]\033[0m %s\n' "$branch" "$title"
  fi
  if [ -n "$next" ]; then
    printf '       \033[33m→\033[0m %s\n' "$next"
  else
    printf '       \033[2m→ (no next_action saved)\033[0m\n'
  fi
  if [ -n "$inflight" ] && [ "$status" != "done" ]; then
    printf '       \033[2m⏸ đang dở: %s\033[0m\n' "$inflight"
  fi
  SHOWN=$((SHOWN+1))
done

if [ "$SHOWN" -eq 0 ]; then
  printf '\n  Nothing in progress'
  [ "$HID_DONE" -gt 0 ] && printf ' (%d done task(s) hidden — see --done)' "$HID_DONE"
  printf '.\n'
fi

printf '\n  \033[2mResume a task:\033[0m  /my-worklog resume <branch>\n'
[ "$SHOW_DONE" -eq 0 ] && [ "$HID_DONE" -gt 0 ] && printf '  \033[2m%d done task(s) hidden.\033[0m  worklog --done to show.\n' "$HID_DONE"
printf '\n'
exit 0
