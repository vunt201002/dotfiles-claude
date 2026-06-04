---
name: joy-point-assign
description: Estimate story points for Joy dev tasks using the Complexity × Uncertainty matrix (calibrated on 2,388 historical Joy tasks). Personal copy that works in any project without depending on the joy repo's .claude/scripts. Use when creating tasks, reviewing scope, estimating effort, or batch-assigning points to unscored Notion tasks.
---

# Joy Point Assignment — Task Estimation (personal, portable)

Estimate story points using the Complexity × Uncertainty matrix. Based on 2,388
historical Joy tasks. This is the **personal, standalone copy** of the joy repo's
`point-assign` skill: the scripts inline their own env loader, so the skill works
from any project directory — not just the joy checkout.

## Setup

The scripts need credentials, resolved in this order (first hit wins):

1. **Environment variables** — `NOTION_API_KEY`, `GITLAB_TOKEN`
2. **`.env.agent`** (or `.env.debug`) — searched by walking up from your current
   directory. If you run from inside the joy repo, its `.env.agent` is picked up
   automatically.
3. **Config files** — `~/.config/notion/api_key`, `~/.config/gitlab/token`

To use this skill outside the joy repo, set the env vars in your shell or drop the
two config files. `GITLAB_TOKEN` is per-dev (each dev uses their own token); it
needs `read_api` scope on the `avada/joy` GitLab project.

## How to Estimate

### Step 1: Identify Task Type
- **Bug Fix** — avg 2.7 pts (typically 1-5)
- **Development** — avg 7.7 pts (typically 3-21)
- **Test Addition** — avg 17.2 pts (typically 13-26)
- **Review** — avg 18 pts

### Step 2: Read the actual code — DO NOT estimate from title/keywords alone

**CRITICAL:** Never estimate based on title or label keywords. You MUST read the actual work:

**If MR is available:**
```bash
python3 ~/.claude/skills/joy-point-assign/scripts/read-mr.py MR_NUMBER
```
Then **read the changed files** in the codebase to understand what the code actually does.

**If no MR:**
Read the Notion task body for context, then trace the relevant code paths in the codebase.

**What to assess from the code:**
- **Files changed count** — 1-3 files = Easy, 5-10 = Medium, 10+ = Hard
- **Which layers touched** — handlers only? services? repositories? frontend?
- **New files vs modified** — new files = more complexity
- **Shopify API calls** — new webhooks, GraphQL queries, Functions?
- **Firestore changes** — new collections, indexes, queries?
- **Edge case risk** — does this change touch shared logic that could break other flows?
- **Data migration needed** — backfill, schema changes, index updates?

### Step 3: Use the Complexity × Uncertainty Matrix

Points are determined by TWO axes:

**Complexity** (vertical) — How hard is the implementation?
- **Easy** — Single file, known pattern, straightforward logic
- **Medium** — Multiple files/components, some new patterns
- **Hard** — Multi-service, new architecture, complex business logic

**Uncertainty** (horizontal) — Will this task grow beyond its current scope?
- **None** — Well-defined, no hidden edge cases expected
- **A Little** — Some edge cases likely, may uncover related bugs
- **A Lot** — High risk of scope creep, unknown dependencies, incurred bugs from changes

Uncertainty is NOT about requirement clarity. It's about whether the work will stay the size we think — edge cases we'll discover, related bugs that surface, scope creep from dependencies we didn't expect.

```
                    Uncertainty
              None    A Little    A Lot
           ┌────────┬─────────┬─────────┐
     Hard  │ 13  21 │  34  55 │  89 144 │
           │  8  13 │  21  34 │  55  89 │
           ├────────┼─────────┼─────────┤
   Medium  │  5   8 │  13  21 │  34  55 │
           │  3   5 │   8  13 │  21  34 │
           ├────────┼─────────┼─────────┤
     Easy  │  2   3 │   5   8 │  13  21 │
           │  1   2 │   3   5 │   8  13 │
           └────────┴─────────┴─────────┘
```

Each cell has 2 rows — pick the lower value for simpler end, higher for complex end of that zone.

### Step 4: Output

```
**Task:** [title]
**Complexity:** [Easy/Medium/Hard] — [why]
**Uncertainty:** [None/A Little/A Lot] — [why]
**Points:** [N]
**Comparable tasks:** [2-3 similar historical tasks at same point level]
```

## Single Task Workflow (Primary — after dev finishes)

When a developer finishes a task and it reaches Ready to Test or beyond:

### 1. Read the task from Notion
```bash
python3 ~/.claude/skills/joy-point-assign/scripts/read-task.py <notion_page_id_or_url>
```

### 2. Read the MR diff
```bash
python3 ~/.claude/skills/joy-point-assign/scripts/read-mr.py <mr_number>
```

### 3. Claude Code estimates using the matrix
Assess complexity and uncertainty, output the estimate.

### 4. Write Size card to Notion
```bash
python3 ~/.claude/skills/joy-point-assign/scripts/write-points.py <notion_page_id> <points>
```

## Batch Workflow (Occasional — backfill unscored tasks)

The batch scripts write CSVs to `./data/point-assign/` relative to your current
directory (created if absent).

```bash
# Export unscored tasks → data/point-assign/notion-tasks-to-estimate.csv
python3 ~/.claude/skills/joy-point-assign/scripts/export-unscored.py

# Claude reviews each, fills proposed_points, save as
# data/point-assign/notion-tasks-estimated.csv

# Apply to Notion (use --dry-run first to preview)
python3 ~/.claude/skills/joy-point-assign/scripts/apply-points.py --dry-run
python3 ~/.claude/skills/joy-point-assign/scripts/apply-points.py
```

## Common Patterns

### Bug Fixes
- Widget display issue → **2-3 pts**
- Point calculation error → **5-8 pts**
- Webhook not firing → **5-8 pts**
- Integration sync bug → **8-13 pts**
- Race condition / data integrity → **13 pts**

### New Features
- Add a config option → **3-5 pts**
- New notification template → **5 pts**
- New earning program type → **13-21 pts**
- New integration (Klaviyo, Fera, etc.) → **21-34 pts**
- New page/section (loyalty page, analytics) → **34-55 pts**
- New system (rule engine, POS extension) → **55-89 pts**

### Improvements
- UI polish, copy change → **1-3 pts**
- Performance optimization (simple) → **5-8 pts**
- Performance optimization (deep research, profiling, architecture change) → **21-34 pts**
- Refactor/migrate → **21-34 pts**
- Onboarding flow redesign → **13-21 pts**

## References
- `references/point-scale.md` — Full scale with 30+ real examples
- `references/estimation-rules.md` — Complexity/uncertainty assessment guides
