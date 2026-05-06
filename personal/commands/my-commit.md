---
description: Commit ONLY the files changed in this Claude Code session, split into separate commits by conventional-commit type (feat/fix/chore/docs/refactor/test/style). Ignores any other dirty files in the working tree.
---

Commit the changes from THIS session only. Never `git add -A`. Never touch files this session didn't modify. Split into multiple commits, one per conventional-commit type.

## Iron Law

- **Only commit files this session created or modified.** Anything dirty in `git status` that the session did NOT touch must be left alone — do NOT stage it, do NOT stash it, do NOT mention it as "ours."
- **Never use `git add -A`, `git add .`, or `git commit -a`.** Always `git add <specific paths>`.
- **One conventional-commit type per commit.** If the session has both `feat` and `fix` changes, that's two commits.

## Step 1 — Enumerate session-touched files

From your own memory of this session's tool calls, list every file you:
- Created with `Write`
- Modified with `Edit`
- Created/modified via `Bash` (e.g. `mv`, `cp`, `mkdir`, redirected output, `chmod`, generator scripts you ran)

Include both the literal target paths AND any symlinks/files those operations created on disk. If you ran a build/generator, list the generated outputs too.

State the list explicitly to the user before committing — they need to see and approve it. Format:

```
Session-touched files:
- path/to/file1
- path/to/file2
- ...
```

If you genuinely cannot recall a file you changed, say so — do NOT guess and do NOT fall back to `git add -A`.

## Step 2 — Verify against git status

Run `git status --porcelain` and cross-reference:

1. Every session-touched file should appear in `git status` (modified, untracked, or renamed). If a session file is NOT in `git status`, drop it from the list — there's nothing to commit for it.
2. For each `git status` entry that is NOT in your session list: leave it alone. Mention it once to the user as "ignored — not from this session" so they know it's intentional.

If the session created a symlink outside the repo (e.g. `ln -s ... ~/.claude/skills/...`), that's not committable — note it but skip.

## Step 3 — Group by conventional-commit type

Classify each session-touched file into ONE bucket:

| Type | When |
|---|---|
| `feat` | New feature, new file with new behavior, new skill/command |
| `fix` | Bug fix to existing behavior |
| `refactor` | Restructure without behavior change |
| `docs` | README, CHANGELOG, *.md docs only |
| `style` | Whitespace/formatting only |
| `test` | Adding or updating tests |
| `chore` | Build, config, deps, scripts, generated files |

Rules of thumb:
- A new skill folder (SKILL.md + scripts + references) → `feat`
- README.md updates that *describe* the new feat → roll into the same `feat` commit IF they only describe this session's feat. Otherwise `docs`.
- Generated output (e.g. regenerated SKILL.md from a template) → same commit as the template change, not separate.
- If a single file legitimately spans two types, ask the user which to use.

Show the grouping to the user before committing:

```
Commit plan:
1. feat(scope): <subject>
   - file A
   - file B
2. fix(scope): <subject>
   - file C
3. docs: <subject>
   - file D
```

Wait for user confirmation before proceeding. If the user says "go" or "yes" or similar, continue. If they ask for changes, regroup and re-show.

## Step 4 — Commit each group

For each group, in order:

1. `git add <exact paths from this group>` — never `-A`, never `.`, never globs that could pull in non-session files.
2. `git diff --staged --stat` — sanity check that ONLY the intended files are staged.
3. If something extra got staged (e.g. via a glob), `git restore --staged <file>` to unstage it.
4. Commit with HEREDOC:

```bash
git commit -m "$(cat <<'EOF'
<type>(<scope>): <subject>

<optional body — only if non-trivial. Focus on WHY, not WHAT.>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Subject rules:
- Imperative mood ("add X", not "added X")
- No trailing period
- Under 72 chars
- Match the existing repo's style (run `git log --oneline -5` first to see — e.g. this repo uses `feat(personal): ...`)

Body: include only if the WHY isn't obvious from the subject. Skip for trivial commits.

## Step 5 — Verify

After all commits:

```bash
git status
git log --oneline -<N>   # N = number of commits you just made
```

Confirm:
- The session-touched files are all committed
- The "ignored — not from this session" files are still dirty (untouched)
- Each commit's message matches its scope

Report a summary to the user:

```
Committed N changes in <count> commits:
- <hash> <type>: <subject>
- <hash> <type>: <subject>

Left untouched (not from this session):
- <file>
- <file>
```

## Do NOT push

This skill commits only. Pushing is a separate decision — wait for the user to ask.

## Edge cases

- **Pre-commit hook fails:** fix the underlying issue, re-stage the same files, and create a NEW commit. Never `--amend` (the failed commit didn't happen, so amend would target the previous commit).
- **No session-touched files in `git status`:** report "nothing from this session to commit" and stop.
- **Only one conventional type across all session files:** still fine — one commit is the correct answer, not a forced split.
- **User explicitly asks to bundle into one commit:** override the split rule and bundle, but still only stage session-touched files.
- **`browse/dist/` or `design/dist/` show as modified:** never stage these (per CLAUDE.md). If a session-touched file shares a directory, list paths individually so the binaries don't get pulled in.
