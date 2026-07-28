---
name: sync-skills
description: Detect and symlink personal skills/commands/global-instructions that this machine hasn't linked yet. Symlinks into ~/.claude/skills, ~/.claude/commands, and ~/.claude/CLAUDE.md are local (not in git), so after pulling the dotfiles repo on another machine, newly-added skills/commands and the machine-wide CLAUDE.md need linking. This scans personal/skills/*, personal/commands/*.md, and personal/global-CLAUDE.md, links any that are missing (links first, reports after), and flags broken/mis-pointed symlinks without deleting them. Idempotent — safe to run repeatedly. A maintenance tool for adding new links after the first bootstrap, NOT the first-time installer (it can't link itself on a fresh machine). Use when asked to "sync skills", "link my skills", "symlink new skills", "sync-skills", or after pulling the repo with new skills on a machine.
---

# /sync-skills — Link personal skills/commands this machine is missing

You keep personal skills in `personal/skills/<name>/`, commands in
`personal/commands/<name>.md`, and your machine-wide Claude instructions in
`personal/global-CLAUDE.md` inside the dotfiles repo. The repo syncs via git, but
the **symlinks** that make them usable (`~/.claude/skills/<name>`,
`~/.claude/commands/<name>.md`, `~/.claude/CLAUDE.md`) are local to each machine and
are NOT in git. So when you add a skill on one machine and pull it on another, the
new one needs linking.

This skill scans the repo, links anything not yet linked, and reports. It **links
first, then reports** (linking is idempotent and safe, so no need to ask first).

## ⚠️ This is a maintenance tool, not the first-time installer

`/sync-skills` is itself a skill — so on a **brand-new machine with no symlinks yet**,
you can't invoke it (Claude only sees skills that are already linked). Chicken-and-egg.
Use this AFTER the one-time bootstrap below has linked at least this skill. For a
fresh machine, run the bootstrap in a terminal first:

```bash
# ONE-TIME BOOTSTRAP on a new machine (paste into a terminal). Idempotent.
cd ~/Project/github/dotfiles-claude
for s in personal/skills/*/; do n=$(basename "$s"); [ -e ~/.claude/skills/"$n" ] || ln -s "$PWD/$s" ~/.claude/skills/"$n"; done
mkdir -p ~/.claude/commands
for c in personal/commands/*.md; do n=$(basename "$c"); [ -e ~/.claude/commands/"$n" ] || ln -s "$PWD/$c" ~/.claude/commands/"$n"; done
# Machine-wide instructions. Refuses to clobber an existing real file — merge that by hand.
[ -e ~/.claude/CLAUDE.md ] || ln -s "$PWD/personal/global-CLAUDE.md" ~/.claude/CLAUDE.md
```

That bootstrap does exactly what this skill does — so on a fresh machine it also
links everything in one go. After it, `/sync-skills` works inside Claude for future
additions.

## HARD GATES

- **Only create symlinks** under `~/.claude/skills/`, `~/.claude/commands/`, and the
  single file `~/.claude/CLAUDE.md`, each pointing back into the repo. Never delete or
  overwrite anything.
- **Never touch the real files** in the repo. This skill only reads the repo and
  writes symlinks elsewhere.
- **Broken/mis-pointed symlinks are reported, never auto-removed.** If a link is dead
  (target gone) or points somewhere unexpected, list it for the user — they decide.
- **Never commit.** This skill changes local machine state only.

---

## Step 0 — Resolve the dotfiles repo root

```bash
# Prefer the known checkout; fall back to the enclosing git repo if run from inside it.
REPO=""
for c in "$HOME/Project/github/dotfiles-claude" "$(git rev-parse --show-toplevel 2>/dev/null)"; do
  if [ -n "$c" ] && [ -d "$c/personal/skills" ]; then REPO="$c"; break; fi
done
echo "REPO=${REPO:-NOT_FOUND}"
```

If `REPO` is `NOT_FOUND`, stop and tell the user: "Couldn't find the dotfiles repo
(looked for `~/Project/github/dotfiles-claude` and the current git root). Tell me
where it is." Remember `REPO` for the next steps.

---

## Step 1 — Link missing skills (directory symlinks)

Skills link as **whole directories**: `personal/skills/<name>/` →
`~/.claude/skills/<name>`. Run this (substitute the real `$REPO`):

```bash
mkdir -p "$HOME/.claude/skills"
for d in "$REPO"/personal/skills/*/; do
  name=$(basename "$d")
  dest="$HOME/.claude/skills/$name"
  if [ -L "$dest" ]; then
    target=$(readlink "$dest")
    if [ ! -e "$dest" ]; then
      echo "BROKEN  skill   $name  → $target (target missing)"
    elif [ "$target" != "${d%/}" ]; then
      echo "OTHER   skill   $name  → $target (points elsewhere, not this repo)"
    else
      echo "OK      skill   $name"
    fi
  elif [ -e "$dest" ]; then
    echo "REALDIR skill   $name  (a real dir/file exists here, not a symlink — left alone)"
  else
    ln -s "${d%/}" "$dest" && echo "LINKED  skill   $name"
  fi
done
```

Read the output: `LINKED` = newly linked, `OK` = already correct, `BROKEN`/`OTHER`/
`REALDIR` = needs the user's attention (not touched).

---

## Step 2 — Link missing commands (file symlinks)

Commands link as **individual files**: `personal/commands/<name>.md` →
`~/.claude/commands/<name>.md`:

```bash
mkdir -p "$HOME/.claude/commands"
for f in "$REPO"/personal/commands/*.md; do
  [ -e "$f" ] || continue   # no commands → skip cleanly
  name=$(basename "$f")
  dest="$HOME/.claude/commands/$name"
  if [ -L "$dest" ]; then
    target=$(readlink "$dest")
    if [ ! -e "$dest" ]; then
      echo "BROKEN  command $name  → $target (target missing)"
    elif [ "$target" != "$f" ]; then
      echo "OTHER   command $name  → $target (points elsewhere)"
    else
      echo "OK      command $name"
    fi
  elif [ -e "$dest" ]; then
    echo "REALFILE command $name  (a real file exists here, not a symlink — left alone)"
  else
    ln -s "$f" "$dest" && echo "LINKED  command $name"
  fi
done
```

---

## Step 3 — Link the machine-wide CLAUDE.md (single file symlink)

`personal/global-CLAUDE.md` holds the hard rules that apply to **every project on the
machine** (no inline comments, sub-agent routing, etc). Claude Code reads it from
`~/.claude/CLAUDE.md`, so it links as one file:

```bash
src="$REPO/personal/global-CLAUDE.md"
dest="$HOME/.claude/CLAUDE.md"
if [ ! -e "$src" ]; then
  echo "MISSING global  personal/global-CLAUDE.md not in repo — nothing to link"
elif [ -L "$dest" ]; then
  target=$(readlink "$dest")
  if [ ! -e "$dest" ]; then
    echo "BROKEN  global  CLAUDE.md  → $target (target missing)"
  elif [ "$target" != "$src" ]; then
    echo "OTHER   global  CLAUDE.md  → $target (points elsewhere)"
  else
    echo "OK      global  CLAUDE.md"
  fi
elif [ -e "$dest" ]; then
  echo "REALFILE global CLAUDE.md  (this machine has its own real ~/.claude/CLAUDE.md — left alone)"
else
  ln -s "$src" "$dest" && echo "LINKED  global  CLAUDE.md"
fi
```

**`REALFILE` here matters more than elsewhere.** It means this machine already has its
own global instructions that are NOT in the repo. Do NOT overwrite them — the rules in
them may be ones the user wants. Report it and offer to diff the two so the user can
merge by hand:

```bash
diff "$HOME/.claude/CLAUDE.md" "$REPO/personal/global-CLAUDE.md"
```

---

## Step 4 — Report

Tally the lines from Steps 1-3 and present:

```
SYNC SKILLS
────────────────────────────────
Skills:    {X} already linked · {Y} newly linked{ (names)}
Commands:  {X} already linked · {Y} newly linked{ (names)}
Global:    CLAUDE.md {linked | already linked | needs attention}
────────────────────────────────
⚠ Needs your attention (not touched):
  {BROKEN/OTHER/REALDIR/REALFILE lines, each on one line, or "none"}
────────────────────────────────
New skills are live immediately (Claude picks them up). New commands work in a new
Claude session.
```

- If nothing was newly linked and nothing needs attention, say so plainly:
  "Everything already linked — N skills, M commands. Nothing to do."
- For each `BROKEN`/`OTHER` item, give a one-line suggestion (e.g. "if that skill was
  renamed/removed, `rm ~/.claude/skills/foo` to clear the dead link") — but do NOT run
  it. The user decides.

---

## Important rules

- **Idempotent.** Running again is safe: already-linked items report `OK`, nothing is
  re-created, no errors.
- **Links first, report after** — no confirmation prompt (creating a symlink that
  points into the repo is safe and reversible).
- **Never delete.** Dead or wrong symlinks are surfaced, never removed automatically —
  removing a link the user made intentionally would be wrong.
- **Three link shapes, don't mix them.** Skills = directory symlinks; commands = file
  symlinks; global CLAUDE.md = one file symlink at `~/.claude/CLAUDE.md`. Linking a
  command as a directory (or vice-versa) breaks discovery.
- **Never overwrite a real `~/.claude/CLAUDE.md`.** A machine with its own global
  instructions keeps them; surface the diff and let the user merge.
- **This skill can't link itself on a fresh machine** — that's the bootstrap's job
  (see the top). Don't pretend `/sync-skills` is the first-run installer.
```
