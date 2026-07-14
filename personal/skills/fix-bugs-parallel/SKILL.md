---
name: fix-bugs-parallel
description: Fix a batch of bugs in parallel by spawning one Agent per bug, each running Workflow B from /Users/avadavu/Project/github/dotfiles-claude/personal/docs/workflow.md against the current repo, verifying via /my-chrome against a given Shopify store URL. The main session stays in the coordinator seat — it reads the bug list from recent conversation context (e.g. a /notion-task-personal query just run), proposes a parallelism level based on bug count and apparent difficulty (never all-at-once, never hardcoded to 2-3), waits for confirmation, then dispatches agents and reports back. Non-browser steps (B1-B7: investigate, prove root cause, implement fix) run fully parallel; browser-verify (B8, /my-chrome) is throttled to the confirmed level since every agent shares the same real Chrome window. Never commits or pushes — stops at B9's /review + local verify, hands the commit decision back to the user. Use when asked "fix these bugs in parallel", "sửa nhiều bug song song", "spawn agent cho từng bug", "áp workflow B cho list bug này", "/fix-bugs-parallel", or right after listing several bugs (e.g. via /notion-task-personal) when the user wants them fixed concurrently.
---

# /fix-bugs-parallel — one agent per bug, Workflow B, coordinated verify

Packages a recurring instruction into one command: "read `workflow.md`, spawn one agent
per bug, each applies Workflow B, verify with `/my-chrome` against this store URL, you
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
   `/my-chrome`. If it's missing, ask for it — don't guess a store or reuse one from a
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
verifying with /my-chrome on the store above.
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
- **The browser-verify step (B8, `/my-chrome`) is the actual constraint** — every agent
  shares the same real, physical Chrome window. This is what parallelism level actually
  throttles: at most that many agents should be in their B8 verify step at the same
  moment. Say this explicitly in your proposal.

Propose a number and reasoning, e.g.:

```
Proposing 4 concurrent agents for this batch of 9 bugs:
  - 6 read as small (label/copy/one-line per bug titles) → safe to batch
  - 3 touch webhook/backend flows → want closer attention, would rather not have
    all 3 mid-investigation at once
  - Browser verify (B8) will be the pinch point — capping at 4 keeps at most 4
    agents ever trying to drive Chrome at the same time
Proceed with 4? Or a different number?
```

Wait for the user's answer (a number, "go with your suggestion", or a correction) before
dispatching. This is a real decision point, not a formality — skip it and you've
silently decided how much of the user's Chrome session gets contended.

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

When you reach a browser-verify step (B8 in Workflow B), use skill /my-chrome to drive
the browser against this store: <store-url>

Follow Workflow B's gates exactly:
- B2: do not proceed past "prove root cause" without runtime evidence. If you cannot
  find/prove a root cause, STOP and report back what you tried and where you're stuck
  — do not guess a fix.
- B4: red-team your own root cause (a codex challenge if that skill's available, or your
  own adversarial re-check if not) before implementing.
- B5-B7: red test → minimal fix at the root, no drive-by refactor.
- B8: verify + blast radius, using /my-chrome against the store URL above.
- B9: stop at /review + local verify. Do NOT run /my-commit, do NOT commit, do NOT push
  — that decision belongs to the user, made after seeing every agent's results together.

Report back: root cause found (with the runtime evidence), what you changed and why,
what you verified and how, and current state (clean/ready-for-review, or blocked and
why).
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
  user's one real Chrome window and makes root-cause investigations harder to attend to
  individually. Sizing it live off actual bug count and difficulty, then confirming,
  gets the batch-appropriate number without guessing wrong in either direction.
- **Non-browser steps run fully parallel; only B8 throttles.** The shared-resource
  constraint is real Chrome, not CPU or file I/O — B1-B7 (investigate, prove root cause,
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
