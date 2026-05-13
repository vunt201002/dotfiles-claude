---
description: Commit ONLY the files changed in this Claude Code session, split into separate commits by LOGICAL UNIT (each independently-revertable change) and conventional-commit type. Reads diffs and session memory to understand context. Ignores any other dirty files in the working tree.
---

Commit the changes from THIS session only. Never `git add -A`. Never touch files this session didn't modify. Split into multiple commits — one per **logical unit of change** (a single feature, a single bug fix, a single refactor step), further split by conventional-commit type when needed.

This skill is designed for sessions where you implemented a multi-step plan or whole phase of work, producing many changes that span several logical units. The skill must read the actual diffs and reconstruct the session's context to group changes correctly — it cannot just shove everything into one commit because "it was all one session."

## Iron Law (read every time, no exceptions)

- **Only commit files this session created or modified.** Anything dirty in `git status` that the session did NOT touch must be left alone — do NOT stage it, do NOT stash it, do NOT mention it as "ours."
- **Never use `git add -A`, `git add .`, or `git commit -a`.** Always `git add <specific paths>`.
- **Split by logical unit FIRST, then by conventional-commit type.** A logical unit = one feature, one fix, one refactor step, one independently-understandable change. If the session implemented Phase 1 + Phase 2 of a plan, that's at least two commits (more if either phase mixes types). The default assumption is "this needs to be split"; bundling is the exception that must be justified.
- **One conventional-commit type per commit.** Within a logical unit, if it mixes types (e.g. feat code + new tests + doc updates), further split by type unless the type-mix is small and tightly coupled (e.g. one new test file that ONLY exercises this commit's feat — that can ride along).
- **You MUST read the actual diffs before grouping.** Filename and type are not enough to determine logical units. `git diff` each session-touched file (or batch via `git diff -- <files>`) so you understand what each change actually does. Combine this with your memory of the session's work — what task were you doing when you made each edit? Was it part of Step 3 of a plan, or a follow-up cleanup? That context drives the grouping.
- **NEVER commit without explicit user confirmation.** You MUST show the commit plan and wait for the user to reply with "go", "yes", "ok", "proceed", or similar. Do NOT proceed on assumption. Do NOT proceed because the plan "looks obvious." Silence is NOT consent. If the user has not replied since you showed the plan, STOP and wait.

## Failure modes this skill exists to prevent

If you catch yourself about to do any of these, STOP and re-read the Iron Law:

1. Lumping all session changes into a single commit "because they're related" or "because it was all one session" → WRONG. A whole-phase implementation almost always contains multiple logical units. Split them.
2. Splitting only by conventional-commit type and ignoring logical units → WRONG. If you implemented two distinct features in one session, that's two `feat` commits, not one giant `feat` commit.
3. Grouping changes by filename or directory without reading the diffs → WRONG. Two edits to the same file can belong to two different logical units (and should be split via `git add -p` if needed). Two edits to different files can belong to the same logical unit.
4. Running `git commit` immediately after showing the plan, in the same response → WRONG. You must end your turn after showing the plan and wait for the user's next message.
5. Skipping the plan display "because there's only one file" → WRONG. Always show the plan, even for a single file. The user needs to confirm the type, scope, and subject.
6. Treating an earlier "yes commit my changes" from the user as standing approval for this run → WRONG. Each invocation of /my-commit requires fresh confirmation of the specific plan you just generated.
7. Skipping the diff-reading step "because you remember what you did" → WRONG. Session memory is a hint, not a substitute. Read the diffs.
8. Writing commit subjects that describe the plan/phase/session instead of the code change → WRONG. `fix: phase J-1 of guest wishlist plan` is meaningless to a future reader. Write `fix(wishlist): correct floating button alignment on mobile` instead. The plan reference belongs in the logical-unit label (internal grouping), never in the commit subject.

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

## Step 3 — Read the diffs to understand context

Before grouping anything, actually read the changes. For each session-touched file (or in batches), run:

```bash
git diff -- <file>             # for modified tracked files
git diff --cached -- <file>    # if anything is already staged
cat <file>                     # for new untracked files (or use Read tool)
```

For large diffs, scan the hunks rather than reading line-by-line. The goal is to understand WHAT each change does, not memorize the code.

While reading, also recall from your session memory:
- What was the user's original request or plan?
- Did you implement multiple phases / steps / features in this session?
- Were there mid-session pivots, retries, or follow-up fixes that produced changes belonging to different logical units?
- Are there changes that were drive-by cleanup vs. core to the task?

Write down (in your response prose, briefly) the logical units you identified. Example:

```
Logical units identified:
A. Phase 1 of plan X: add the new parser module (parser/lexer.ts, parser/grammar.ts)
B. Phase 2 of plan X: wire parser into the CLI (cli/main.ts, cli/options.ts)
C. Drive-by fix: typo in unrelated docs (README.md line 42)
D. Tests for the new parser (test/parser.test.ts)
```

## Step 4 — Group into commits (logical unit × conventional-commit type)

For each logical unit, classify its changes by conventional-commit type:

| Type | When |
|---|---|
| `feat` | New feature, new file with new behavior, new skill/command |
| `fix` | Bug fix to existing behavior |
| `refactor` | Restructure without behavior change |
| `docs` | README, CHANGELOG, *.md docs only |
| `style` | Whitespace/formatting only |
| `test` | Adding or updating tests |
| `chore` | Build, config, deps, scripts, generated files |

Then produce one commit per (logical unit × type) cell that has files in it. Rules:

- **Different logical units → always different commits**, even if they share a type. Phase 1 `feat` and Phase 2 `feat` are two commits, not one.
- **Within a logical unit, mixed types → usually split.** Exception: tests or doc updates tightly coupled to a single feat may ride along in the same commit if they exist ONLY because of that feat and are small. When in doubt, split.
- **Generated output** (e.g. regenerated SKILL.md from a template, build artifacts the project tracks) → same commit as the source change that produced it.
- **Same-file changes spanning two logical units** → split via `git add -p <file>` so each hunk lands in the right commit.
- **A new skill folder** (SKILL.md + scripts + references for one skill) → one logical unit, type `feat`.
- **README updates describing this session's new feat** → ride along with the feat commit. Unrelated doc edits → separate `docs` commit.

Show the grouping to the user before committing. Number each commit, list the files (and hunks if split), and write the proposed message. The "Logical unit" line is internal bookkeeping for the grouping decision — the COMMIT SUBJECT must describe the code change, not the logical unit name:

```
Commit plan (N commits):

1. feat(parser): add lexer and grammar modules
   - parser/lexer.ts (new)
   - parser/grammar.ts (new)
   Logical unit (internal): Phase 1 of plan X

2. test(parser): cover lexer and grammar tokenisation
   - test/parser.test.ts (new)
   Logical unit (internal): Phase 1 of plan X (tests split because they're sizeable)

3. feat(cli): wire parser into CLI entry point
   - cli/main.ts (modified)
   - cli/options.ts (modified)
   Logical unit (internal): Phase 2 of plan X

4. docs: fix typo in README install section
   - README.md (hunk on line 42 only — staged via `git add -p`)
   Logical unit (internal): drive-by cleanup
```

Notice every subject describes WHAT the code does (add lexer modules, cover tokenisation, wire parser into CLI, fix typo in install section) — none of them say "phase 1" or "drive-by cleanup" in the subject itself. That's the rule.

If the result is "everything is one logical unit and one type" (rare for a whole-phase implementation, common for a one-line fix), say so explicitly and show why each file belongs to the same unit before falling back to a single commit.

### BLOCKING GATE — do not pass without explicit user reply

After showing the plan, you MUST:

1. End your turn with a clear question: "Proceed with these N commits? Reply 'go' to confirm, or tell me what to change."
2. Make ZERO `git add`, `git commit`, or other staging tool calls in the same response that shows the plan.
3. Wait for the user's NEXT message. Do not infer consent from prior context.
4. Only proceed when the user replies with explicit go-ahead ("go", "yes", "ok", "proceed", "commit", "lgtm", or similar). If they ask for changes, regroup and re-show the plan, then gate again.
5. If you are uncertain whether the user has approved, ask again. Never commit on ambiguous signals.

This gate exists because past runs of this skill have committed without asking. Do not repeat that mistake.

## Step 5 — Commit each group (ONLY AFTER USER SAYS GO)

For each group, in order:

1. Stage the files for this commit:
   - Whole files: `git add <exact paths from this group>` — never `-A`, never `.`, never globs that could pull in non-session files.
   - Specific hunks (when one file spans two logical units): `git add -p <file>` and select only the hunks for THIS commit. If `-p` is impractical non-interactively, use `git apply --cached` with a hand-crafted patch, or commit the file once and amend the message later — but never lump unrelated hunks into one commit just because they share a file.
2. `git diff --staged --stat` — sanity check that ONLY the intended files (and hunks) are staged.
3. If something extra got staged, `git restore --staged <file>` to unstage it and re-stage correctly.
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
- **Describe what the CODE does, not where the work came from.** The subject is for someone reading `git log` six months from now who has zero context about the plan, phase, or session that produced it.
  - ✓ `fix: style of floating button on mobile`
  - ✓ `feat(wishlist): allow guests to save items via localStorage`
  - ✓ `refactor(parser): extract token classification into helper`
  - ✗ `fix: phase J-1 of guest wishlist plan` (references plan, not code)
  - ✗ `feat: implement step 3` (references plan step, not behavior)
  - ✗ `chore: address review feedback` (references process, not change)
  - ✗ `fix: bug from this session` (references session, not bug)
- The logical-unit label you used in the commit plan ("Phase 1 of plan X", "drive-by cleanup") is INTERNAL bookkeeping. It helps you group the commits correctly. It must NOT appear in the subject line or in commit-message scopes. Translate "Phase 1 added the lexer module" into "feat(parser): add lexer module" — describe the lexer, not the phase.
- The scope `(...)` should be a code area (module, file, feature surface), not a plan name. `feat(wishlist)` ✓, `feat(plan-j)` ✗.

Body: include only if the WHY isn't obvious from the subject. Skip for trivial commits. The body MAY reference the plan/phase if it genuinely helps a future reader understand WHY the change was made (e.g. "Part of the guest-wishlist migration; pairs with the schema change in <other-commit>."), but never as a substitute for describing the code change.

## Step 6 — Verify

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
- **Only one logical unit AND one conventional type across all session files:** still fine — one commit is the correct answer, not a forced split. You must prove BOTH conditions by listing each file's logical unit and type in the plan. "Whole session = one logical unit" is the conclusion to justify, not the assumption to start from.
- **User explicitly asks to bundle into one commit:** override the split rule and bundle, but still only stage session-touched files. "Explicitly asks" means a message in THIS run like "bundle these into one commit." A prior preference from another conversation is NOT a standing override — still split by default and still gate on confirmation.
- **Whole-phase implementation of a plan:** this is the case the skill was rewritten for. Expect MANY commits — typically one per phase/step of the plan, further split if a step mixes types or contains drive-by changes. Do not collapse a phase into one commit unless the phase is genuinely a single atomic change.
- **`browse/dist/` or `design/dist/` show as modified:** never stage these (per CLAUDE.md). If a session-touched file shares a directory, list paths individually so the binaries don't get pulled in.
