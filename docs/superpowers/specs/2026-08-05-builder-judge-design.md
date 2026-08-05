# Builder + judge pair — scored quality gate for agent-delivered work

## Problem

The standing rule in `personal/global-CLAUDE.md` routes non-trivial code work to
a background `Agent` and requires two things of it: brief the agent properly, and
route its finished code through `/review` before reporting done. That covers
correctness and safety reasonably well. It does not cover **quality of output**,
because the only party assessing the work is the same agent that produced it.

Self-assessment is weakest exactly where quality is subjective. An agent that
just rebuilt a page will report "done, looks good" without ever having looked at
the rendered result, and `design-eye`'s own premise says why that claim is empty:
the agent can read code but cannot see rendered UI. Today nothing forces a second
pair of eyes, and nothing forces a number.

The gap is narrowest for bug fixes, which already carry strong objective gates
(`/fix-bug` B2 demands a runtime-proven root cause, B8 demands observed verify,
`/fix-bug-loop` retries up to 3 times without ever relaxing the gate). It is
widest for **improve / build / redesign** work, which has no gate at all.

## Non-goals

- **Not a replacement for `/review`.** The `/review` gate in `global-CLAUDE.md`
  stays exactly where it is, and still runs after the loop converges. This adds
  a quality gate in front of it, it does not remove a safety gate.
- **Not a change to the bug-fix path.** `/fix-bug`, `/fix-bug-loop`,
  `/my-frontend-fix` and their gates are untouched. UI bug fixes keep using
  `design-eye §B` at its existing `≥8` threshold, self-scored, as today.
- **Not a new skill.** No `/command`, no new `SKILL.md`, no symlink. This is a
  general rule that the agent applies by classifying its own work.
- **Not a scored gate for domains with no credible rubric.** Where no rubric is
  registered, behavior is unchanged and no score is produced.

## Design

### The rule lives in `global-CLAUDE.md`, not in `rules/`

`personal/rules/*.md` are path-scoped: each carries a `paths:` frontmatter list
and only fires when a file matching one of its globs is touched. That is correct
for domain knowledge (`joy-widget-v4.md`, `harness-authoring.md`) and wrong for a
rule that must apply to all work regardless of which files it happens to touch.

So the rule goes in `personal/global-CLAUDE.md`, alongside the existing
spawn-agent rule it extends. To keep that file from bloating (it loads in every
session of every project), the rule itself stays compact and the heavy rubric
content lives in referenced files that load only when the loop actually runs.

### Rubric registry

The rule is general. What activates it per-domain is a small table:

| Domain | Rubric | Threshold |
|---|---|---|
| UI/design — improve, build, redesign | `design-eye §B` (5 dimensions) + `design-eye §E` anti-slop (taste-skill §9) | every dimension ≥9 |
| everything else | none registered | no score |

Adding a domain later costs one table row plus one rubric file. That is the
whole extensibility story, and it is deliberate: the user intends to apply
builder+judge across all work over time, gated on finding a credible standard
for each domain first.

**Where no rubric is registered, no score is produced.** A `9/10` with nothing
behind it is a fabricated number that manufactures false confidence, which is
worse than no number. Those domains keep the current path (one builder, then
`/review`) and the report says plainly that the work was not scored.

### Why the anti-slop dimension is separate

`design-eye §B` scores five dimensions: `spacing · alignment · hierarchy ·
states · mobile`. All five measure correctness and internal consistency. A page
can score 10/10 on all of them and still be generic AI output: perfect spacing,
consistent alignment, and still three equal feature cards, a `001 · Capabilities`
eyebrow, and a fake dashboard built out of divs.

Distinctiveness is a different axis, so it gets its own dimension rather than
being folded into the existing five. `§E` scores it against taste-skill §9
(AI Tells), which is a concrete, specific-negation list rather than a vibe.

Total: **6 dimensions, threshold ≥9 on every one.**

### The pair

Main spawns **both agents in a single message**, named `builder` and `judge`,
both background. Main is then free and does not relay between them.

```
main: classify work -> rubric registered -> spawn pair in one turn
      |- builder: full brief + rubric + handoff contract
      |- judge:   full brief + rubric -> loads criteria -> ends turn, waits

builder -> SendMessage("judge"): round N done, surface: <URL/route>, files: <list>
judge:  resumes -> opens /my-chrome itself -> captures 375/768/1280 -> measures
        -> scores 6 dimensions with grounded evidence
      |- any dimension <9 and rounds remain -> SendMessage("builder") with findings
      |- pass, or cap reached -> SendMessage("main") with score + evidence + leftovers

main: runs the /review gate -> reports to user
```

This works on native harness primitives, verified against the `SendMessage`
contract: agents address each other by teammate name, background subagents can
address `main`, messages from teammates are delivered automatically without
polling, and a send to a completed agent resumes it from its transcript. The
judge therefore loads its rubric, ends its first turn, and is woken by the
builder's ping with its context intact.

Main receives exactly **one** message from the loop, when it terminates.

### Judge context contract

The judge gets the **full task context**: the goal, the case being handled, the
constraints, and the rubric. It is not a stranger dropped in to score blind, and
it needs the same understanding of intent the builder has in order to judge
whether the result serves that intent.

What the judge does **not** get is the builder's implementation narrative: what
was tried, which approach was chosen and why, what the builder thinks it fixed.
The judge measures the result, it does not read the story.

The builder's handoff message to the judge is therefore restricted to a fixed
shape carrying exactly two things:

1. which round this is, and where the surface lives (URL or route)
2. the list of files touched

No self-assessment, no "spacing is handled now". Letting the builder narrate is
letting the builder frame what the judge looks at, which is the exact weakness
this design removes.

### Evidence rules

The judge opens the browser itself via `/my-chrome`, captures the mandatory
viewport matrix (375 / 768 / 1280), and reads computed styles directly. It does
not score from screenshots the builder supplied, because a builder that chooses
the evidence controls the verdict.

`design-eye`'s grounded law applies unchanged to every remark the judge makes:
element or region, plus a measurement, plus a screenshot. A remark that cannot be
localized does not count. `spacing 9/10` with no measurement behind it is not a
score.

Between rounds, the judge may only raise a dimension's score by pointing at what
changed. "Looks better this round" is not a reason.

### Termination

Cap: **3 rounds**, matching the `/fix-bug-loop` precedent and the standing
tripwire that 3 to 4 failed attempts at the same thing means stop and tell the
user rather than keep going.

The loop closes when **every dimension is ≥9**. There is one narrow escape,
carried over from `design-eye §B`: a finding may be accepted below threshold when
it is **genuinely unfixable within the task's constraints** (a Polaris rule, a
theme limitation, a platform behavior), not merely unfixed. Without this, a
constraint nobody can resolve would hold the loop open forever.

Three conditions bound the escape so it cannot become a general exit:

- **The judge decides, not the builder.** A builder cannot label its own
  remaining work as unfixable to end the loop.
- **The judge must name the constraint** that makes it unfixable, in the same
  grounded form as any other finding. "Hard to fix" is not a constraint.
- **The finding is reported with its severity**, never silently dropped, and
  travels up to the user in main's report.

If the cap is reached without convergence, the judge reports to main what is
still short and by how much. Main reports that to the user honestly rather than
presenting the work as finished.

### Relation to the existing `/review` gate

Unchanged and still mandatory. The order is: builder+judge loop converges, then
main runs `/review` (or the project's equivalent), then main reports to the user
folding in whatever review surfaced. The judge scores quality; `/review` catches
correctness and safety. They are not substitutes.

### Right-sizing

The loop applies to non-trivial improve / build / redesign UI work, judged by the
same non-trivial test the existing spawn rule already uses. A copy tweak, a color
change, a one-line CSS fix does not enter the loop. The user can also opt out per
task in plain language, the same way the existing spawn rule can be opted out of.

### Files touched

| File | Change |
|---|---|
| `personal/global-CLAUDE.md` | new section: the rule, the rubric registry table, the pair protocol, the cap. Compact by design. |
| `personal/skills/my-frontend-fix/references/design-eye.md` | new `§E`: the anti-slop dimension, its scoring criteria, and a pointer to the vendored taste-skill doc |
| `personal/docs/taste-skill-v2.md` | vendored taste-skill v2 (MIT, source and license attributed) |

`personal/docs/` is the right home for the vendored rubric: per
`personal/README.md` it holds reference docs that are never symlinked into
`~/.claude/skills/`. That matters here, because a file with no skill
`description:` can never auto-trigger. It is read only when the loop runs.

Token split so the rubric does not get paid for twice per round: the builder
loads the full taste-skill (it is generating, it needs the generation guidance),
the judge loads only §9 Tells plus the `§E` scoring criteria.

### No new symlink needed

Because this ships as a rule plus two edited reference files rather than a new
skill, there is nothing to link and the `fix-bug-loop`-style failure mode (a
skill written and then dead for two weeks because nobody ran `/sync-skills`) does
not apply. `personal/global-CLAUDE.md` is already symlinked to `~/.claude/CLAUDE.md`
and `design-eye.md` is already reachable through the existing `my-frontend-fix`
symlink.

## Open questions for implementation

1. **Exact `§E` scoring criteria.** taste-skill §9 is a long list of banned
   patterns, not a 0-10 scale. The implementation needs to define what a 9 means
   versus a 7 on distinctiveness, in a way a judge can apply repeatably. Likely
   shape: count of §9 violations present, weighted by whether the brief
   explicitly asked for the pattern.
2. **Which taste-skill version to vendor.** v2 is 87KB (~22K tokens), v1 is 21KB
   (~5K). The design assumes v2 for the builder and a §9 extract for the judge.
   Worth confirming that the §9 extract alone is sufficient for scoring before
   committing to carrying v2.
3. **Naming collisions when two loops run at once.** Teammate names are `builder`
   and `judge`; the `SendMessage` contract notes that when a newer agent takes a
   name, latest wins. Two concurrent loops would collide. Needs either
   per-loop name suffixes or an explicit "one loop at a time" constraint.
4. **Chrome contention across concurrent loops.** A single loop is sequential so
   builder and judge never want the browser at the same time. Two loops do.
   `/fix-bugs-parallel` already throttles browser verification for this reason;
   the same throttle likely applies here.
