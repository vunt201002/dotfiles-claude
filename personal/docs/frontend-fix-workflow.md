# Frontend Fix Workflow

> How we fix frontend bugs efficiently with Claude Code.
> Agreed on 2026-04-15 after analyzing repeated multi-round fix failures and community feedback.

## The Problem

Frontend bugs are significantly harder to fix with AI coding tools than backend bugs.

| | Backend | Frontend |
|---|---|---|
| **Fix rate (1st attempt)** | ~8/10 | ~3-4/10 |
| **Feedback type** | Text-based (logs, errors, tests) | Visual (requires seeing the UI) |
| **Trace ability** | handler → service → repository | editor → adapter → CSS variable → component → rendered DOM |
| **Verification** | Read code + run tests | Must see the screen |

### Root Causes of Failed Fixes

1. **Claude can't see the UI** — reads code but can't verify visual output
2. **Over/under-scoping** — changes too many or too few files
3. **Cascade breaks** — fixing one layer breaks another downstream (Type C problem)
4. **No structured expectations** — no clear definition of "done" before coding

### Where Bugs Come From (by layer)

| Layer | Debug Method | Pain Level |
|---|---|---|
| **Widget UI** (Lit web components, CSS, theme) | Vite preview + Playwright | Medium — can test in isolation |
| **Data layer** (backend services, Firestore) | Read code, trace flow | Low — works well already |
| **Data fetch** (adapter, API mapping) | Read code, add logs | Low — traceable from code |
| **Admin UI** (React/Polaris, embedded in Shopify) | Playwright on real app | **High — most bugs, hardest to verify** |

## The Solution: 3-Layer Workflow

Inspired by community feedback (Marc's 3-layer context approach from Reddit r/ClaudeAI):

### Layer 1: Source Code
Read the component, trace the full chain from data source to rendered output.

### Layer 2: Rendered Output
See what actually renders — via Playwright screenshot or user-provided screenshot.

### Layer 3: Expectation Mapping (the key insight)
Before coding, explicitly define:
- What **should** change
- What **should NOT** change
- Which pages/views to verify

This prevents over-scoping, under-scoping, and cascade breaks.

## Workflow Steps

### Step 1: Fix Checklist (before any code)

```
## Fix: [bug description]
## Layer: Widget UI / Admin UI / Data Fetch

### Root cause:
- [file:line] → [what's wrong and why]

### Changes:
- [ ] [file] → [what to change] → [expected visual result]

### Must NOT change:
- [ ] [component/page] → [should stay as-is]

### Verify on:
- [ ] [specific pages/views to check]
```

User confirms → then coding starts.

### Step 2: Fix → Verify Loop (Playwright in the loop)

**Open Playwright BEFORE coding**, not after.

#### Widget UI
```bash
cd packages/web-components && npm run dev
playwright-cli open --headed --persistent "http://localhost:5173"
# Take baseline screenshot
playwright-cli screenshot
```

#### Admin UI
```bash
# User has yarn dev running
playwright-cli open --headed --persistent "https://admin.shopify.com/store/{store}/apps/{app-handle}/embed"
# Take baseline screenshot
playwright-cli screenshot
```

#### The Loop
```
1. Make code change
2. Screenshot immediately → playwright-cli screenshot
3. Bug fixed?
   - NO → adjust code, go to 1
   - YES → regression check
4. Screenshot related pages
5. Regressions?
   - YES → adjust, go to 1
   - NO → done
```

**Claude does the visual relay, not the user.**

### Step 3: Report with Evidence

```
### What changed:
- [file:line] → [change]

### Verified:
- [x] [page] — visually confirmed
- [x] [related page] — no regression

### User to verify:
- [ ] [one final check — what to look for]
```

User only checks **once** at the end.

## Batch Fix Workflow

For test rounds with many bugs (10+):

### Phase 1: Create the Plan — `/batch-fix [notion-url]`

1. **Read all bugs** from Notion (screenshots, descriptions, severity)
2. **Trace root causes** in codebase for each bug
3. **Group into batches** by priority:
   - Same root cause (1 fix = N bugs)
   - Blockers first
   - Same component/page (one Playwright session)
   - Backend bugs (fast, no visual check needed)
   - Cosmetic bugs last
4. **Write plan doc** to `docs/bug-fix-{round-name}.md` with:
   - Progress table (all bugs with status)
   - Per-batch: root cause, fix plan, must-not-change, verify checklist
   - Fix order recommendation

### Phase 2: Execute Fixes — `/fix Batch X from docs/bug-fix-{round}.md`

Two ways to use:

| What you want | Command |
|---|---|
| Fix one batch | `/fix Batch F from docs/bug-fix-staging25.md` |
| Fix all batches | `/fix All batches from docs/bug-fix-staging25.md` |
| Fix single bug | `/fix Bug #3 from docs/bug-fix-staging25.md` |

For each batch:
1. Read the plan doc → present fix checklist → get user confirmation
2. Fix using `frontend-fix` workflow (Playwright in the loop)
3. Update the plan doc: set bug status to `done`, add commit hash
4. Move to next batch

### Progress Tracking

The plan doc (`docs/bug-fix-{round}.md`) is the single source of truth:

```markdown
| # | Bug | Batch | Status | Fixed In |
|---|-----|-------|--------|----------|
| 1 | White screen on upgrade | A | done | abc1234 |
| 2 | Missing translations | B | in progress | |
| 3 | pointsLabel raw key | B | pending | |
```

Status values: `pending` → `in progress` → `done` / `blocked` / `wontfix`

After all batches, the doc gets a final summary with:
- Which bugs were fixed
- Which bugs are blocked (with reason)
- Any new bugs discovered during fixing

## Tools & Skills Reference

| Tool | Use For |
|---|---|
| `/fix [issue]` | Single bug or batch — routes to `frontend-fix` for UI bugs |
| `/fix Batch X from docs/...` | Fix a specific batch from plan doc |
| `/fix All batches from docs/...` | Fix all batches sequentially |
| `/batch-fix [notion-url]` | Create batch plan from Notion bug list |
| `/browser-test [target]` | Open Playwright on admin/storefront/theme |
| `frontend-fix` skill | The structured 3-layer fix workflow |
| `css-variable-map.md` | Widget theme variable → component reference |
| `playwright-cli` | Browser automation during fix loop |

## CSS Variable Quick Reference

For widget theme bugs, always check `.claude/skills/web-components/references/css-variable-map.md`.

Key mappings:

| Editor Setting | CSS Variable | Controls |
|---|---|---|
| Primary color | `--joy-primary` | Buttons, links, active states |
| Body text color | `--joy-text-secondary` | Page labels, nav text, timestamps |
| Paragraph color | `--joy-block-text-color` | Labels inside cards/surfaces |
| Heading text color | `--joy-heading-text-color` | Page titles, section headings |

`joy-text` color prop mapping: `secondary` → `--joy-text-secondary`, `block` → `--joy-block-text-color`, `primary` → `--joy-text-primary`

## Common Pitfalls

| Pitfall | Prevention |
|---------|------------|
| Over-scoping (changing 20 files for a 3-file fix) | Checklist limits scope before coding |
| CSS variable fallback chains breaking | Check css-variable-map.md |
| Fix works in isolation, breaks in context | Screenshot related pages |
| Saying "done" without seeing the UI | Playwright verification is mandatory |
| Multi-round fix cycles (3-4 rounds) | Fix checklist + Playwright loop = 1 round |
| Fixing one layer, breaking another | Checklist defines "must NOT change" |

---
*Created: 2026-04-15*
*Based on: Reddit r/ClaudeAI discussion, real experience fixing widget v4 bugs*
