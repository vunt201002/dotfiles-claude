---
name: size-issue
description: Score how hard one issue is and pick which workflow lane to run it through, returning a machine-readable JSON envelope (size, uncertainty, lane, oracle_available, needs_human) instead of prose — the triage question the manager layer asks a project's main agent before spawning any work. Report-only: it never fixes, never edits, never commits. NOT story-point estimation for Joy tasks — /joy-point-assign does that. NOT the fix itself — /fix-bug, /fix-bugs-parallel and /implement run the lane this picks. Use when asked "issue này khó cỡ nào", "size cái này", "nên chạy workflow nào", "phân lane cho issue này", "cần full workflow B không", "how big is this issue", "which lane", "triage this issue", "/size-issue", or when a manager agent asks this project to triage an issue before deciding whether to run it unattended.
---

# /size-issue — score one issue, pick its lane, return an envelope

Not every issue deserves the same workflow. `workflow.md` runs Workflow B with a
mandatory root-cause proof gate, and that gate is right for a data-loss bug and
absurd for a typo. Today that judgement lives in someone's head. This skill turns
it into an object a manager can read, log, and later check itself against.

**The output is JSON, not prose.** A person may read it; a program definitely
will. The last thing this skill emits is one fenced `json` block and nothing
after it.

**This skill never fixes anything.** No edits, no commits, no spawned work. It
reads, probes, scores, and hands back an envelope. Whoever called it decides what
runs next. If the issue turns out to be a two-character typo you can see from
here, the answer is still an envelope with `lane: "trivial"` — not a fix.

Full reasoning behind every threshold lives in `references/rubric.md`. Read it
whenever a call sits near a boundary, and before changing any number here.

---

## Inputs

1. **The issue.** From the invocation argument, from context (a
   `/notion-task-personal` lookup, a pasted QC report, a bug just described), or
   from a tracker id. If nothing in context reads as one issue, ask — do not
   size a guess.

2. **One issue, not a batch.** Several issues in context means several
   envelopes; size them one at a time and emit one JSON array of envelopes at the
   end, same shape per element. Never merge several issues into one envelope.

3. **`project` and `issue` ids.** `project` is the repo/product slug the manager
   uses (`kivora`, `joy`, `wishlist`, `monthly-point-sync`). `issue` is the
   tracker id if there is one; if there is none, use a short stable slug derived
   from the title rather than inventing a number.

4. **Repo scope: the current working directory.** The oracle probe in Step 2 is
   about *this* checkout. Never carry an oracle answer over from another repo or
   from a previous session.

---

## Step 0 — The contract

Every run ends with exactly this object. Every field is required.

```json
{
  "project": "kivora",
  "issue": "t105",
  "title": "Checkout không áp mã giảm giá khi giỏ có sản phẩm sale",
  "size": "S|M|L|XL",
  "uncertainty": "low|med|high",
  "lane": "trivial|bug-nho|bug-lon|feature",
  "why": "one sentence, the reason for THIS lane",
  "oracle_available": true,
  "oracle_kind": ["playwright", "tsc"],
  "needs_human": false,
  "blocking_questions": [],
  "assumptions": [],
  "assumption_count": 0,
  "est_cost_usd": 1.2,
  "est_turns": 40
}
```

Five optional fields exist so Step 5's gates are machine-checkable rather than
only described in prose. Include them when they apply, omit them otherwise —
an envelope without any of them is still valid:

- `"round_2_fail": true` — a fix for this already bounced back from QC.
- `"touches_sensitive": ["auth"|"payment"|"data-migration"]` — the diff will
  plausibly land in one of those.
- `"kind": "code"|"investigate"|"provision"|"decide"` — defaults to `code`.
  Anything else means the deliverable is not a diff.
- `"in_scope": false` + `"defer_reason": "..."` — the project already decided
  not to do this now. The reason must name what revives it.

`validate.ts` in this directory is the enforcement of all of the above. The
manager imports it. Run it on your own output before emitting (Step 7).

---

## Step 1 — Read the issue, and split what you don't know into two piles

Read the issue itself: description, repro steps, when it started, which surface
it was seen on. Where a tracker or MR is referenced, read that too. Where the
issue names a file, function, or error string, grep for it now — a single grep
that localizes the symptom changes the uncertainty score, and it is cheap.

Do not read the whole codebase. Sizing is a triage step; the expensive reading
belongs in the lane that gets picked.

**Score the problem, never the fix the title proposes.** A title like "raise the
timeout" or "add a flag" is somebody's guess at a solution. It is not evidence
that the right end state is known, and treating it as such is the most common way
the cheapest lane gets claimed by mistake.

**Check whether the project already parked this.** Most well-run repos keep a
list of what is deliberately not being done now — a "not in scope" section in a
launch plan, a deferred column in a debt tracker, a `wontfix` label. Look for one
before scoring: `grep -rniE 'not in scope|deferred|revisit when|wont ?fix|postponed'`
over the repo's docs and trackers usually finds it in one shot. If this issue is
on that list, set `in_scope: false` and put the reason **and what revives it** in
`defer_reason`. This is often the single most decision-relevant fact about an
issue, and it is invisible in the issue's own text.

Everything you still don't know goes into exactly one of two piles (§10.4):

| The unknown | Pile |
|---|---|
| Wrong answer makes the work meaningless or unsafe | `blocking_questions` |
| Wrong answer costs a rework; work can continue meanwhile | `assumptions` |

Set `assumption_count` to the length of `assumptions`. These two piles decide
override 4 in Step 5, so a lazy split there quietly changes the routing.

---

## Step 2 — Probe this repo for a real oracle

An oracle is something that **runs**, **asserts**, and **covers the surface this
issue lives on**. Probe it — never assume from repo name or memory. Project
config outranks probing, so read the repo's own docs first.

```bash
root=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$root" || exit 0
echo "REPO: $root"

echo "--- documented test commands (project config wins) ---"
for f in CLAUDE.md AGENTS.md README.md; do
  [ -f "$f" ] && grep -inE 'npm (run )?test|yarn (test|jest)|bun test|npx (tsc|jest|vitest|playwright)|pytest|go test|node .*test' "$f" | head -6
done

echo "--- package.json scripts + runner deps (no jq: absent in Git Bash) ---"
[ -f package.json ] && node -e '
const p=require("./package.json"), s=p.scripts||{};
for (const k of Object.keys(s)) if (/test|jest|vitest|playwright|cypress|e2e|tsc|typecheck|lint|check/i.test(k)) console.log("script  "+k+" = "+s[k]);
const d={...(p.devDependencies||{}),...(p.dependencies||{})};
for (const k of Object.keys(d)) if (/^(jest|vitest|mocha|cypress|typescript|eslint)$|^@playwright\//.test(k)) console.log("dep     "+k+"@"+d[k]);
' 2>/dev/null

echo "--- runner config files ---"
ls -1 jest.config.* vitest.config.* playwright.config.* cypress.config.* tsconfig.json pytest.ini 2>/dev/null

echo "--- assertion files, any convention ---"
git ls-files 2>/dev/null | grep -iE '(^|/)(tests?|__tests__|e2e|spec)/|[._-](test|spec)\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go)$' | head -20
git ls-files 2>/dev/null | grep -iE '[^/]*test[^/]*\.(cjs|mjs|js|ts|py|sh)$' | head -10

echo "--- what this machine already believes about this repo ---"
node -e '
const fs=require("fs"),os=require("os"),p=require("path");
const s=JSON.parse(fs.readFileSync(p.join(os.homedir(),".claude","settings.json"),"utf8"));
const c=JSON.stringify(s.hooks||{}).match(/[A-Za-z]:[^"]*stop-full-check\.sh/);
if (c) console.log(fs.readFileSync(c[0],"utf8"));
' 2>/dev/null | grep -A6 -iE "\*[a-z-]*\)" | head -40
```

Read the output against the three properties:

1. **It executes.** A config file for a runner that does not resolve is not an
   oracle. Confirm the runner is reachable with a cheap check only — `--version`,
   `--listTests`, `node <script> --help`. A full suite run belongs at B5/B8, not
   here.
2. **It asserts.** A dev server that boots proves nothing. A screenshot nobody
   diffs proves nothing.
3. **It covers this issue's surface.** This is the property that gets skipped,
   and skipping it is how a task enters an unattended lane with nothing able to
   catch it. A repo with a strong frontend harness and zero backend tests has
   `oracle_available: false` for a backend issue.

Set `oracle_kind` to what you actually observed, lowercase-kebab: `playwright`,
`jest`, `vitest`, `tsc`, `eslint`, `node-script`, `emulator`, `screenshot-diff`,
`curl-assert`. `oracle_available` and a non-empty `oracle_kind` must agree in both
directions — the validator rejects them apart. Never name a kind you did not see.

---

## Step 3 — Score `size` and `uncertainty` on the existing matrix

Use `/joy-point-assign`'s Complexity × Uncertainty matrix, calibrated on 2,388
real tasks. Do not invent a scale, and do not score from the title alone — that
skill's own rule, and it holds here.

Read the cell, take the point, then band it:

| Point | `size` |
|---|---|
| 1 · 2 · 3 | `S` |
| 5 · 8 | `M` |
| 13 · 21 | `L` |
| 34 · 55 · 89 · 144 | `XL` |

`uncertainty` maps straight across: None → `low`, A Little → `med`, A Lot →
`high`. Uncertainty is "will this stay the size we think", not "is the
requirement clear."

**Floor: if the mechanism plausibly lives in third-party code** — a framework, a
vendor bundle, an SDK, a platform behaviour — `uncertainty` is at least `med`,
however small the eventual fix looks. You cannot read your own repo to find out
why someone else's code misbehaves, so settling the mechanism becomes a phase of
its own before anything changes.

The complexity and uncertainty signal lists are in
`personal/skills/joy-point-assign/references/estimation-rules.md`. The band
reasoning, and why uncertainty legitimately appears on both axes, are in
`references/rubric.md` §1.

Only one threshold changes the routing: `S` versus `M`. Spend the thinking there.

---

## Step 4 — Pick the base lane

**First: is the deliverable a diff at all?** The four lanes all assume it is, and
three real kinds of work are not:

| `kind` | The deliverable is | Reads like |
|---|---|---|
| `code` (default) | a diff | everything else |
| `investigate` | an answer | "verify X in a real browser", "confirm the cron is running", "establish whether the payload carries Y" |
| `provision` | infrastructure or an identity | "provision the production app", "create the plans in the dashboard" |
| `decide` | a decision | "settle the retail numbers", "choose the access point" |

For `kind ≠ code`, still fill in the lane — but it describes the work that would
**follow**, and `needs_human` is true, because what the spike finds is exactly
what decides the follow-up. `bug-lon` is usually the right value there: what it
buys is B2's discipline, prove it with runtime evidence rather than closing on a
signal that looks green.

**Then the direction question, which is not a size question:** is this repairing
behavior that was supposed to work, or adding behavior that was never there?
Adding → `feature`, at any size. A three-line feature still goes through
Workflow A, because the expensive failure in new work is building the wrong
thing, and that does not get cheaper with a small diff.

For a repair, in this order:

1. **`trivial`** — if you can state exactly what the code should say **without
   observing anything at runtime** (typo, label, colour, copy, a one-liner whose
   correct value is knowable by reading), and `uncertainty` is `low`.
2. **`bug-nho`** — if `size` is `S` **and** `uncertainty` is `low` **and**
   `oracle_available` is `true` for this surface. All three.
3. **`bug-lon`** — everything else. `size ≥ M`, or `uncertainty ≥ med`, or a
   prior fix already bounced.

The `trivial` test is stricter than a line count on purpose. A four-line diff
whose wrongness you only learned by watching something fail at runtime is not
trivial — it is a `bug-nho` at best, because the next step after "I think it's
this line" without proof is the round-2-fail.

What each lane means downstream (§7.1, mapped onto `workflow.md`):

| Lane | Runs |
|---|---|
| `trivial` | Fix directly. Hook checks only (lint/tsc). |
| `bug-nho` | Workflow B, dropping B4 (red-team) and B6 (plan). B2's proof still runs. |
| `bug-lon` | Workflow B in full, **B2's runtime-evidence gate mandatory**. |
| `feature` | Workflow A in full, A1-A8. |

---

## Step 5 — Apply the four overrides, in order, escalation only

None of these may move a lane down. If two disagree, the higher one wins.

1. **`oracle_available: false` → `needs_human: true`.** At every size, including
   `trivial`. Nothing can prove the work landed, so it does not run unattended.
   The lane itself is not escalated — a copy change in an untested repo is still
   a copy change, it just needs eyes on it.
2. **Round-2-fail → `lane: "bug-lon"`, regardless of size.** A fix that already
   bounced from QC has a wrong or incomplete root cause behind it. Size was not
   what failed; the proof was. Set `"round_2_fail": true` so the manager can see
   why the lane jumped.
3. **Touches auth / payment / data migration → at least `bug-lon`.** `trivial`
   and `bug-nho` are promoted; `feature` stays `feature`. Record which one in
   `"touches_sensitive"`. "Touches" means the diff will plausibly land there, not
   that the feature is vaguely adjacent.
4. **`assumption_count > 2` → `needs_human: true`.** Many assumptions means the
   scoping is already wrong (§3.1). An unblocked wrong assumption is the failure
   class that ships most often, which is why this is a gate and not a note.

Two more gates, from the 2026-08-12 calibration rather than from §7.1:

5. **`in_scope: false` → `needs_human: true`, and `defer_reason` is required.**
   A parked item can be small, certain and fully covered by tests and still must
   not run — the waste is not in the difficulty, it is in the question. This is a
   different flag from the rest of `needs_human`: that one means "we cannot
   verify it", this one means "somebody already decided against it."
6. **`kind ≠ code` → `needs_human: true`.** Per Step 4: the lane names the
   follow-up, and the follow-up is what the work exists to determine.

Then set `est_cost_usd` and `est_turns` from the seed table in
`references/rubric.md` §5. Those two numbers are seeds, not a budget: §6.5
forbids the manager deriving its cost cap from them, and they exist so the gate
log can measure how far off the estimate ran.

Write `why` as **one sentence naming the reason for this lane**, not a summary of
the issue. "Chạm logic tính giá dùng chung 3 nơi, chưa rõ nguồn ở FE hay rule
engine" is a reason. "Checkout bug" is not.

---

## Step 6 — Sanity-check the call before emitting

Four questions that catch most bad envelopes:

- **Did `oracle_available` come from a probe in this repo, this session?** If it
  came from memory or from a table of what projects usually have, it is not an
  answer. Re-probe.
- **Does the oracle cover this issue's surface, or just the repo?** A repo-level
  yes with a surface-level no is the mistake that puts an unverifiable task into
  an unattended lane.
- **Is `trivial` being claimed because it's cheap?** It is the only lane with no
  gate behind it, so it is the one with the strongest pull and the least
  protection. Re-apply the "knowable without runtime observation" test honestly —
  and if the title named a fix, check you scored the problem and not that fix.
- **Did anyone already decide not to do this?** The 2026-08-12 calibration's
  single most expensive miss was an issue that was small, certain, fully covered
  by tests, and parked on the project's own deferral list. Cheap to check, and
  invisible in the issue's own text.
- **If the mechanism might be in vendor code, is `uncertainty` at least `med`?**
  This was the calibration's one dangerous-direction miss — a small-looking UI
  bug that took a vendor bundle read to settle.
- **Does `why` explain the lane, or just restate the title?** If it restates the
  title, the lane decision was never actually made.

---

## Step 7 — Validate, then emit JSON and nothing else

Write the candidate envelope to a temp file and run the validator. It enforces
the schema, the enums, and all four overrides — including the pair the prose
version cannot check on its own.

```bash
tmp=$(mktemp -t envelope-XXXXXX.json)
cat > "$tmp" <<'JSON'
{ ...the candidate envelope... }
JSON
bun run "$HOME/.claude/skills/size-issue/validate.ts" "$tmp"
```

Fix whatever it reports and re-run until it exits 0. A rejection is not a
formatting nit: every rule it enforces is one of the plan's hard gates, so an
envelope that fails validation is a routing decision that would have been wrong.

Then emit the envelope as the final message: one fenced `json` block, nothing
after it. No summary paragraph, no "let me know if". A caller parsing this
output is not reading English.

---

## What this skill never does

- **Never fixes, edits, commits, or spawns work.** Report-only, same posture as
  `/impact-review` and `/tech-review`. The envelope is the deliverable.
- **Never returns prose instead of the object.** If the issue is too vague to
  size, that is `blocking_questions` plus `needs_human: true` — still an
  envelope. "I need more information" as a bare sentence is not an output.
- **Never guesses `oracle_available`.** Probing is cheap; a wrong `true` there is
  the single failure that lets unverifiable work run unattended.
- **Never invents a new point scale.** `/joy-point-assign`'s matrix has 2,388
  tasks behind it. Changing the axes here would silently discard that.
- **Never lowers a lane.** Every override escalates. If two rules disagree, the
  higher lane wins, always.
