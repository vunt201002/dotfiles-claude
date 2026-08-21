---
name: fix-bugs-parallel
description: Fix a BATCH of bugs concurrently — one Agent per bug running Workflow B, with browser-verify throttled because agents share browser sessions and must route by surface. Storefront/theme/standalone Admin use claude-in-chrome; embedded Admin cross-origin iframes use /browse `frame --name app-iframe`, never coordinate-clicking. Main session coordinates, proposes parallelism, and never edits code itself. NOT for a single bug — use /fix-bug. Never commits or pushes. Use when asked "fix these bugs in parallel", "sửa nhiều bug song song", "spawn agent cho từng bug", "áp workflow B cho list bug này", "/fix-bugs-parallel", or right after listing several bugs to fix concurrently.
---

# /fix-bugs-parallel — one agent per bug, Workflow B, coordinated verify

Packages a recurring instruction into one command: "read `workflow.md`, spawn one agent
per bug, each applies Workflow B, route browser verify with `/my-chrome` against this store URL, you
stay in the coordinator seat and report back." This exists so that instruction doesn't
need to be typed out by hand every time a batch of bugs needs fixing.

**You (the main session) never fix code yourself here.** Your job is: read the bug list,
size the batch, dispatch one Agent per bug with everything it needs, wait for results,
synthesize a report, escalate anything that needs the user's judgment call. The actual
investigation/fix/verify work happens inside each spawned agent.

---

## Inputs

1. **Store URL — required.** A Shopify admin/storefront URL (e.g.
   `https://admin.shopify.com/store/<slug>/apps/<app-id>?dev-console=show`), passed
   right after the command. Every spawned agent verifies against this same URL via
   `/my-chrome` theo surface. If it's missing, ask for it — don't guess a store or reuse one from a
   much earlier, possibly stale part of the conversation without confirming it's still
   the right one.

2. **Bug list — read from recent conversation context, not re-typed.** The user
   typically already ran something like `/notion-task-personal` (or pasted a list) just
   before invoking this skill, so the bugs are already sitting in context: title,
   description, repro steps, whatever detail is available. Pull that list out.
   - **If the recent context clearly contains a bug list** (a query result, a pasted
     set of bugs, an explicit enumeration) → use it directly. State the list back to the
     user before dispatching (see Step 1) so they can catch a wrong read before agents
     spawn.
   - **If nothing in recent context reads as a bug list** → ask (AskUserQuestion or a
     direct question) rather than inventing one or silently picking "whatever's on
     screen." A wrong guess here means N agents burn time on the wrong work.

3. **Repo scope — always the current working directory.** Every spawned agent operates
   on the repo this session is already in. This skill does not take a separate repo-path
   argument — if the user is at a different repo's terminal/session, that's exactly the
   normal case this skill is built for (the workflow doc lives in `dotfiles-claude`, but
   the code being fixed lives wherever the session's cwd is).

---

## Step 1 — Restate the batch before dispatching anything

Before spawning a single agent, show the user exactly what's about to happen:

```
FIX BUGS IN PARALLEL — <N> bugs, store: <store-url>
────────────────────────────────
1. <bug 1 title/summary>
2. <bug 2 title/summary>
...
N. <bug N title/summary>
────────────────────────────────
Each agent will read workflow.md and run Workflow B (Fix bug) against this repo,
verifying with /my-chrome surface routing on the store above.
```

If the read-back doesn't match what the user meant (wrong bugs pulled from context,
missing one, includes something that isn't actually a bug), this is the moment to catch
it — fix the list before Step 2, don't dispatch on a guess.

---

## Step 2 — Propose a parallelism level, then wait for confirmation

**Never spawn all N agents at once, and never hardcode a fixed small number either.**
The right level depends on the actual batch — size it live, don't apply a rule of thumb
blindly:

- **Bug count** — 3 small bugs and 15 bugs don't call for the same batch size.
- **Apparent difficulty** — skim the bug descriptions/titles pulled in Step 1. Bugs that
  read as "typo/label/copy/one-line" (per workflow.md's Right-size principle) can run in
  bigger batches; bugs that sound like they touch shared state, backend/webhook flows,
  or cross-cutting concerns should run in smaller batches since their root-cause
  investigations are more likely to need your attention mid-flight.
- **The non-browser steps (B1-B7 — context, investigate, prove root cause, red test,
  implement) have no shared-resource constraint** and can all run fully parallel
  regardless of the batch size — every agent has its own investigation, its own
  terminal, its own file edits (assuming bugs don't touch the same files; flag it in
  Step 1's read-back if two bug titles look like they'll collide on the same
  file/feature area, and consider serializing just that pair).
- **The browser-verify step (B8, `/my-chrome`) is the actual constraint** — agents
  share real-Chrome tab groups or the `/browse` session selected by surface. This is
  what parallelism level actually throttles: at most that many agents should be in
  B8 at the same moment. Say this explicitly in your proposal.

Propose a number and reasoning, e.g.:

```
Proposing 4 concurrent agents for this batch of 9 bugs:
  - 6 read as small (label/copy/one-line per bug titles) → safe to batch
  - 3 touch webhook/backend flows → want closer attention, would rather not have
    all 3 mid-investigation at once
  - Browser verify (B8) will be the pinch point — capping at 4 keeps at most 4
    agents ever trying to drive the shared browser target at the same time
Proceed with 4? Or a different number?
```

Wait for the user's answer (a number, "go with your suggestion", or a correction) before
dispatching. This is a real decision point, not a formality — skip it and you've
silently decided how much of the shared browser session gets contended.

---

## Step 3 — Dispatch one Agent per bug

For each bug, spawn an Agent (general-purpose, or a more specific agent type if the bug
clearly fits one) with a self-contained prompt — the agent has no memory of this
conversation, so it needs everything spelled out:

```
Read /Users/avadavu/Project/github/dotfiles-claude/personal/docs/workflow.md and apply
Workflow B (Fix bug) to the bug below, working in the current repo (this session's
working directory).

Bug: <full bug description — title, repro steps, whatever detail is available>

When you reach a browser-verify step (B8 in Workflow B), use skill /my-chrome to route
by surface against this store: <store-url>. Storefront/theme editor/standalone Admin
use claude-in-chrome. Embedded Admin cross-origin iframe uses /browse:
`$B frame --name app-iframe` → `$B snapshot -i` → act by `@ref` → `$B frame main`.
That frame path is documented in source but not yet live-verified against Shopify here.
Never use claude-in-chrome find/read_page or coordinate-clicking for embedded controls.
After 2 failed attempts to reach the same control: STOP, report, do not retry a third
time or try a third browser tool. If UI remains unreachable, verify staging Firestore
or the storefront and state explicitly that embedded UI was not verified.

If the bug is UI/frontend: read ~/.claude/skills/my-frontend-fix/references/design-eye.md
and apply it — §A visual read (+ §D1 pattern table first) when opening the surface, §B
design-verify (mechanical DOM checks, then taste rubric, scored 0-10, severity-triaged)
before closing B8. Include the design-verify scores in your report. [Medium]/[Nitpick]
findings are reported as polish items, never fixed inline.

Follow Workflow B's gates exactly:
- B1.5: before building any hypothesis, spend 30 seconds reading what's already known
  about this area — `bin/gstack-decision-search --query <keyword>` if the repo has it,
  plus vault notes. A matching note does NOT exempt you from B2's runtime proof; it
  only tells you which hole to dig first.
- B2: do not proceed past "prove root cause" without runtime evidence. If you cannot
  find/prove a root cause, STOP and report back what you tried and where you're stuck
  — do not guess a fix.
- B4: red-team your own root cause (a codex challenge if that skill's available, or your
  own adversarial re-check if not) before implementing.
- B5-B7: red test → minimal fix at the root, no drive-by refactor.
- B8: verify + blast radius, using /my-chrome surface routing against the store URL above.
- B9: run the closing sequence in workflow.md's order, don't collapse it — (1) spec-check
  FIRST: re-read your own diff against ONLY the root cause you proved at B2 and the scope
  you set at B6/B7, asking "did I fix the proven source, and did anything ride along that
  nobody asked for?"; (2) /tech-review + /impact-review; (3) /review; (4) local verify.
  Then stop. Do NOT run /my-commit, do NOT commit, do NOT push — that decision belongs to
  the user, made after seeing every agent's results together.
- B9 ratchet: PROPOSE, don't write. Answer "does this failure class deserve a mechanism?"
  (a design-eye §D1 pattern line / §D2 negative-list line / a hook / a rewritten lint
  message / keeping the red test as a regression test) and put the proposal in your
  report. Do NOT edit design-eye.md or personal/hooks/ yourself — N agents editing the
  same shared files concurrently is a merge conflict by construction. The coordinator
  applies the accepted ones in a single pass.

Report back: root cause found (with the runtime evidence), what you changed and why,
what you verified and how, current state (clean/ready-for-review, or blocked and why),
and your ratchet proposal (or an explicit "no ratchet because ...").
```

Dispatch up to the confirmed parallelism level from Step 2. If the batch is larger than
that level, the remaining bugs queue — as each dispatched agent finishes, start the next
queued one, keeping the in-flight count at or under the confirmed level throughout
(this naturally caps how many agents are ever mid-B8 at once, without needing a separate
mechanism to serialize just the browser step).

---

## Step 4 — While agents run: stay in the coordinator seat

- **Don't fix bugs yourself while agents are running.** If you notice something while
  monitoring, note it for the report — don't reach in and edit code that belongs to a
  dispatched agent's scope.
- **If an agent reports being blocked** (can't prove root cause, hit a real gate
  failure, needs a decision only the user can make) — don't try to unblock it yourself
  by guessing. Surface it to the user as soon as it's known, don't hold it until the
  final report if it's blocking that one agent from making progress.
- **If two agents' bugs turn out to touch the same file/area** (discovered mid-flight,
  not caught in Step 1) — flag the collision risk to the user rather than letting both
  land conflicting edits silently.

---

## Step 5 — Final report

Once all agents finish (or the user asks to wrap up with partial results):

```
FIX BUGS IN PARALLEL — done: <N> bugs, store: <store-url>
────────────────────────────────
✓ <bug 1>   root cause: <one-line>   fix: <one-line>   verified: <one-line>
✓ <bug 2>   root cause: <one-line>   fix: <one-line>   verified: <one-line>
⏸ <bug 3>   BLOCKED — <what's blocking, what was tried>
✗ <bug 4>   root cause not proven — agent stopped per B2 gate, did not guess
────────────────────────────────
Ready for /review + /my-commit: bug 1, bug 2
Needs your input: bug 3 (blocked), bug 4 (root cause unclear)
────────────────────────────────
Nothing committed, nothing pushed — that's your call next.
```

UI bugs additionally carry their design-verify scores (from design-eye §B) in the
verified line, and any polish items the agents flagged get collected into one shared
"polish backlog" section — same standard across all agents, so N agents produce ONE
taste, not N.

**Then apply the ratchets — you, once, not the agents.** Collect every agent's ratchet
proposal, drop the duplicates (a batch often hits the same failure class more than once,
and that repetition is itself the signal a mechanism is worth it), and write the accepted
ones in a single pass: pattern lines into design-eye §D1/§D2, a hook into
`personal/hooks/`, a rewritten lint message, a regression test kept from a red test.
List what got written in the report:

```
RATCHET — <k> cơ chế mới từ batch này
  + design-eye §D1: <dòng pattern>  (đề xuất bởi bug 1, bug 4 — gặp 2 lần)
  + personal/hooks/<file>: <chặn cái gì>
  − bug 2: không ratchet (one-off, đúng như agent nói)
```

A batch that produces zero ratchets is a valid outcome — say so explicitly rather than
leaving the section out, so it reads as a decision instead of a skipped step.

Every bug lands in exactly one bucket: **done and verified**, **blocked** (with what's
blocking it), or **root cause not proven** (agent correctly refused to guess, per
Workflow B's iron law). Don't paper over a blocked/unproven bug as "done" — the whole
point of routing through Workflow B's gates is that a bug without proven root cause
does NOT get a fix applied.

---

## Why this design

- **Bug list from context, not re-typed.** The batch usually already exists on screen
  (a Notion query just run, a pasted list) — re-asking for it by hand every time is
  exactly the friction this skill exists to remove. But context can be misread, so
  Step 1 always reads it back before committing to it.
- **Parallelism is proposed and confirmed, not fixed or unlimited.** A hardcoded "2-3"
  under-uses a batch of 20 easy typo fixes; "spawn everything at once" contends the
  user's shared browser sessions and makes root-cause investigations harder to attend to
  individually. Sizing it live off actual bug count and difficulty, then confirming,
  gets the batch-appropriate number without guessing wrong in either direction.
- **Non-browser steps run fully parallel; only B8 throttles.** The shared-resource
  constraint is the routed browser session, not CPU or file I/O — B1-B7 (investigate, prove root cause,
  implement) have no such constraint, so throttling the whole pipeline to the browser
  limit would waste the parallelism the skill exists to provide.
- **Never commits/pushes.** Committing bug fixes from N different agents without the
  user seeing them side-by-side first risks landing a wrong "root cause not proven"
  guess, or missing that two fixes touch overlapping code. B9 in Workflow B already
  stops before `/my-commit` for exactly this reason — this skill just holds that line
  across the whole batch, not just one bug.
- **Self-contained agent prompts.** Each spawned agent has zero memory of this
  conversation, so the workflow.md path, the specific bug, the store URL, and the exact
  gates to respect all have to be spelled out explicitly — nothing is implied.
