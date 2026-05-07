---
description: Walk through a codebase to build deep understanding. Two modes — Full Picture (no args) surveys the whole project end-to-end; Deep Dive (with args) zooms in on one pattern, file, or concept and explains how it works and why. Use when onboarding to an unfamiliar repo, when a pattern looks unusual and you need to understand why, or before planning a non-trivial change.
---

# Explore

Walk through a codebase to build deep understanding — either the **full picture** of the project, or a **deep dive** on one specific pattern, file, or concept.

## When to invoke

- Onboarding to an unfamiliar repo and need a complete mental model.
- A pattern looks unusual or different from what you'd expect, and you want to understand *why* it's done that way.
- Before planning a non-trivial change, to ground the plan in how the code actually works.
- Explaining a slice of the system to a teammate (or to yourself, three months from now).

**Skip this command** for: a single file you can read in 30 seconds, simple how-do-I questions, or anything where the answer is in `README.md` already.

## Arguments

- `$ARGUMENTS` — Optional. Behaviour depends on whether it's provided:
  - **Empty** → **Full Picture mode**: survey the whole project end-to-end.
  - **Provided** → **Deep Dive mode**: focus on the named pattern, file, function, concept, or question.

Examples:
- `/my-explore` — full project survey
- `/my-explore repository pattern` — deep dive on a pattern
- `/my-explore packages/functions/src/services/pointsService.js` — deep dive on a file
- `/my-explore why webhooks use pubsub` — answer a why-question from the code

## Mode A — Full Picture

Goal: produce a complete, well-structured mental model of the project. Read enough of the code to ground every claim — never invent.

### Phase 1 — Orient

1. **Repo-level context**
   - Read `README.md`, `CLAUDE.md`, `package.json` (root + workspaces), `shopify.app.toml` (if present), top-level config files (`tsconfig.json`, `firebase.json`, `.gitlab-ci.yml`, etc.).
   - List top-level directories and note their roles.
   - Identify the runtime / framework / language mix.

2. **Workspace shape**
   - For monorepos: enumerate every package under `packages/`, `extensions/`, `apps/`, etc.
   - For each, capture: purpose, language, framework, entry point.

### Phase 2 — Product & Features

Goal: understand the project as a *product* — what it does for users, not just how it's built. **Code-grounded**: every feature claim must trace to an admin page, a route, a handler, a webhook topic, a CLI command, or an extension.

3. **Elevator pitch** — in 1–2 sentences, what is this product, who uses it, what problem does it solve? Cross-reference `README.md`, `CLAUDE.md`, app store / marketing pages if present, and the actual surface area of the code.

4. **User personas** — who are the actors? (e.g. merchant admin, end-customer, support agent, third-party integrator, internal cron). For each, note where they enter the system (admin URL, storefront page, API endpoint, webhook).

5. **Feature inventory** — enumerate the major features by reading entry-point code:
   - **Admin pages** — list every route in the frontend router (`pages/`, `routes/`, `App.jsx`).
   - **Storefront surfaces** — extensions, theme blocks, customer account UI, checkout UI.
   - **Public APIs / webhooks** — HTTP handlers, webhook topics, public webhook events.
   - **Background work** — cron jobs, pub/sub subscribers, scheduled tasks.
   - **CLI / scripts** — anything in `scripts/` or `bin/`.

   Group features by user-facing capability (e.g. "Loyalty Points", "VIP Tiers", "Referral", "Reviews") not by code layer. For each capability, name 2–4 of the most important files.

6. **Core user flows** — pick 2–3 marquee flows (the ones the product is built around) and trace them end-to-end through the code. For each: trigger → entry point → service path → side effects → user-visible result.

7. **Surface vs. depth** — note where the product is *deep* (lots of features, many files, active development) vs. where it's *thin* (one file, stub, half-built). This signals product priorities.

### Phase 3 — Architecture

8. **Layered structure** — for each package, identify the layers (handlers / services / repositories / presenters / components / pages / hooks / etc.) and how they import each other. Note the import direction rule.

9. **Data flow** — trace one representative request end-to-end (e.g. an HTTP handler → service → repository → external API) and one event flow (webhook, cron, pubsub).

10. **Storage & external systems** — Firestore collections, BigQuery tables, Redis, Pub/Sub topics, third-party APIs (Shopify, etc.). For each: what it stores, who reads, who writes.

11. **Multi-tenancy / scoping** — how is tenant isolation done? (`shopId`, workspace ID, etc.)

### Phase 4 — Conventions

12. **Code style signals** — read 5–10 files across different layers and capture the recurring conventions: response shape, error handling, async style, naming, JSDoc usage, type definitions, comments.

13. **Testing approach** — where are tests, what frameworks, what's mocked vs. real.

14. **Build & deploy** — how is the project run locally, how does CI/CD work, where do deployments go.

### Phase 5 — Hotspots

15. **Where the action is** — which files are largest, most-edited, or most depended-upon. These are the load-bearing parts.

```bash
git log --pretty=format: --name-only | sort | uniq -c | sort -rg | head -20
```

16. **Sharp edges** — anything that surprised you: unusual patterns, vendored dependencies, custom abstractions, comments warning future readers, files named `*-legacy*` or `*-v2*`.

### Phase 6 — Output

Produce a structured report:

```markdown
# Project Explore — [repo name]

## TL;DR
[3–5 sentences: what the product is, who it serves, the headline features, the dominant architectural choice.]

## Product

### Elevator pitch
[1–2 sentences — what it does, for whom, what problem it solves.]

### Users / personas
- **[Persona]** — enters via [admin URL / storefront / API / webhook]; cares about [outcome].

### Feature map
| Capability | Surface | Key files |
|------------|---------|-----------|
| [e.g. Loyalty points] | Admin page + storefront widget | `path/to/file.js`, `path/to/file.js` |
| … | … | … |

### Core flows
1. **[Flow name]** — [trigger] → [entry] → [service] → [side effects] → [result]. Files: `…`
2. …

## Tech Stack
- Backend: …
- Frontend: …
- Storage: …
- External: …

## Workspaces / Packages
| Package | Purpose | Entry |
|---------|---------|-------|
| … | … | … |

## Architecture
[Diagram or layered description. Trace one request end-to-end with file paths.]

## Data Model
[Key collections / tables, relationships, multi-tenant scoping.]

## Conventions That Matter
- [Convention] — [why it exists, where to see it]

## Hotspots
- [File / module] — [why it's load-bearing]

## Sharp Edges
- [Surprise] — [what to know before touching it]

## Open Questions
- [Things the code didn't answer; worth asking the user]
```

Keep the report dense but skimmable. Cite file paths with `path:line` so the reader can jump to source. **Never speculate** — if something isn't clear from the code, list it under Open Questions.

## Mode B — Deep Dive

Goal: explain one pattern, file, or concept thoroughly enough that the reader can confidently reason about it, modify it, or compare it to alternatives.

### Phase 1 — Locate

1. Resolve `$ARGUMENTS` to concrete code:
   - If a path → read that file plus its direct callers and callees.
   - If a pattern name (e.g. "repository pattern", "webhook delivery") → grep the codebase to find every instance, pick 3–5 representative ones.
   - If a question ("why X?") → find the code that answers it, plus any historical context (`git log --all --oneline -S "<symbol>"`).

### Phase 2 — Understand

2. **What it does** — read the actual code. Walk through the control flow line-by-line for the critical path.

3. **Why it exists** — look for clues: comments, commit messages (`git log -p -- <file>` for a few commits), related issue/MR titles, neighbouring patterns. If the rationale isn't recoverable, say so.

4. **How it differs from alternatives** — if the user said "this is different from X", find X in the codebase or in conventional usage and contrast them concretely.

5. **Where it's used** — grep for callers/imports. Quantify: "used in 12 places, all under `services/`."

### Phase 3 — Output

```markdown
# Deep Dive — [topic]

## What it is
[1–2 sentence definition grounded in the actual code.]

## How it works
[Walk-through of the critical path with file:line references and short code excerpts. Explain each non-obvious step.]

## Why this design
[Rationale — from comments, commits, or inference clearly labelled as inference.]

## How it differs from [alternative]
[Side-by-side comparison if relevant. Concrete, not hand-wavy.]

## Where it's used
- `path/to/file.js:42` — [what for]
- … ([N] total usages)

## Gotchas
- [Sharp edge a future editor should know]

## Open Questions
- [What the code didn't tell you]
```

## Operating Principles

- **Read before claiming.** Every architectural claim must be traceable to a file. If you haven't read the code, don't summarise it.
- **Cite file paths with `path:line`.** Makes the report navigable.
- **No invented patterns.** If the code is messier than the description suggests, say so. Don't smooth over reality.
- **Surface unknowns.** "Open Questions" is a first-class section — better than fabrication.
- **Prefer width then depth.** In Full Picture mode, get a shallow read of everything before deep-reading any one part. In Deep Dive mode, do the opposite.
- **Use parallel reads aggressively.** Phase 1 of either mode is mostly independent file reads — batch them.
- **Ask before writing files.** This command is read-only by default. If a finding suggests a `.claude/` update, mention it but don't edit unless asked.

## Tips for Larger Codebases

- For monorepos with >20 packages, group by domain in the report instead of listing each one.
- Use the `Explore` agent (`subagent_type: Explore`) for the breadth-first sweep, then come back and read key files yourself.
- `git log --pretty=format: --name-only | sort | uniq -c | sort -rg | head -30` reveals the parts of the codebase under active development — usually the most important to understand.
- `rg --files-with-matches "TODO|FIXME|HACK|XXX"` surfaces self-documented sharp edges.

---

Now explore: $ARGUMENTS
