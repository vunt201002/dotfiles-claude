---
name: gate-fp
description: Mark a gate-log line as a false positive — the verdict a gate can never hand itself, so precision per gate stops being unmeasurable. Records the miss only; it NEVER edits the guard's rules, the hook, or any old log line. NOT for reading the book (`gate-log recent` / `read` / `stats` do that), NOT for fixing the rule that misfired. Use when saying "cái vừa chặn là oan", "guard chặn nhầm rồi", "cái này có nguy hiểm gì đâu", "đánh dấu false positive", "that block was wrong", "mark it a false positive", "/gate-fp", or right after a hook blocks something that was never dangerous.
---

# /gate-fp — mark what a gate got wrong

A gate cannot know it fired on nothing. `--no-verify` inside a JSON fixture and
`--no-verify` typed at a shell look identical to a substring matcher, so only the
person who typed it can say which one it was. Until that verdict is recorded,
`caught` counts are indistinguishable from noise: precision is unmeasurable, the
P8 unlock condition (`false_positive < 10%`) cannot be computed, and a gate that
cries wolf gets ignored within days — which is how the real alarm dies with it.

**Nothing is edited.** The log is append-only. A mark is a correction record
appended below the original line; `gate-log read --raw` still shows what the gate
said at the time.

**This skill never touches the gate that misfired.** Recording a bad block and
patching the rule behind it are two different decisions, and the second one is the
user's. Report the pattern; do not go fix `pre-tool-use-guard.sh`.

## 1. Find the tool and the project

```bash
for c in "$(readlink -f ~/.claude/skills/gate-fp 2>/dev/null)/../../.." "$(git rev-parse --show-toplevel 2>/dev/null)"; do
  [ -f "$c/bin/gate-log" ] && GL="$(cd "$c" && pwd)/bin/gate-log" && break
done
PROJECT=$(basename "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" | tr '[:upper:]' '[:lower:]')
echo "$GL"; echo "$PROJECT"
```

No `bin/gate-log` found means the dotfiles repo is somewhere this machine's symlink
does not reach. Say so and stop; do not write to the log by hand.

## 2. Show what the gate caught recently

```bash
bun "$GL" recent --project "$PROJECT" --verdict caught --origin work --limit 10
```

Lines are numbered newest first. Already-marked lines show `(was caught)`.

`--origin work` keeps probe lines out of the picker. A line tagged `<gate-test>` came
from something deliberately firing the gate to measure it, so it is a true positive by
construction and never the thing the user means. Drop the flag only when the user is
explicitly auditing a probe run.

If the user already pointed at one block ("the one that just blocked my test
command"), the top line is almost always it — say which one you read as the target
and mark it. Otherwise ask which number, with `AskUserQuestion` when there is real
ambiguity between two similar lines.

## 3. Mark it, with a reason

```bash
bun "$GL" fp 1 --note "why this was not a real hit"
```

The note is the whole point. It is what makes the record reviewable in a month, and
it is what tells the difference between "the rule is too broad" and "I typed
something dumb." One short line, concrete:

- `--no-verify inside a JSON fixture, not a command` — rule too broad
- `.env.example is committed and holds no values` — rule needs an exception
- `matched inside a grep pattern` — rule matches substrings anywhere

When the same rule misfired several times, mark the batch in one call instead of
counting line numbers. It only ever touches lines whose current verdict is
`caught`, so re-running it marks nothing twice. Preview first:

```bash
bun "$GL" fp --all-matching "rule=sensitive-file file=[.]env[.]example" --note "committed template, no values" --project "$PROJECT" --dry-run
```

Drop `--dry-run` to write it.

## 4. Show what it moved

```bash
bun "$GL" stats --project "$PROJECT"
```

Report the precision of the affected gate, before and after. That number is the
point of the exercise: a gate under ~90% precision is a gate to tune, and it is the
only evidence that will survive the week.

## Escape hatches

- **Marked the wrong line?** `bun "$GL" reclassify <N> --verdict caught --note "undo, it was a real hit"`.
  Last correction wins; both records stay on disk.
- **The listing is stale** ("line N is not in the last listing") — run step 2 again.
  Line numbers belong to one listing, not to the log.
- **A block the user disagrees with but that WAS a real hit** is not a false
  positive. Marking it inflates precision and hides the next real miss. Leave it.
- **A `<gate-test>` line is not a false positive either.** The gate answered
  correctly on something built to trip it. Marking it would drag precision down for
  a hit that never happened during real work, which is the mirror image of the
  mistake above. `stats` already leaves those lines out of the number.
