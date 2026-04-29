---
description: Joy-specific batch fix bugs from a Notion task list. Reads bugs, groups by root cause/component, creates a fix plan with progress tracking, then fixes each bug using the joy-frontend-fix workflow.
argument-hint: [notion-url-or-page-id]
---

## Input
$ARGUMENTS

## Step 1: Read Bugs from Notion

```bash
python3 .claude/skills/notion-tasks/scripts/notion-tasks.py get $ARGUMENTS
```

If multiple bugs, read each linked page. Extract for each bug:
- Title / description
- Screenshots (if any)
- Severity / priority
- Steps to reproduce
- Which page/component is affected

## Step 2: Trace Root Causes

For each bug, read the codebase to identify:
- Which file(s) are involved
- The root cause (or hypothesis)
- Which layer: Widget UI / Admin UI / Data Fetch / Backend

**For Widget UI bugs**: Before hypothesizing a root cause, check the CSS variable map
(`~/.claude/skills/joy-widget-v4-fix/references/css-variable-map.md`) to understand the
editor setting → attribute → CSS variable → component chain.

## Step 3: Group & Prioritize

Group bugs into batches:

| Priority | Group Type | Why |
|----------|-----------|-----|
| 1 | **Same root cause** | 1 fix = N bugs solved |
| 2 | **Blockers / broken functionality** | Must fix first |
| 3 | **Same component/page** | Efficient — one Playwright session |
| 4 | **Backend/data bugs** | Fast to fix from code alone |
| 5 | **Independent cosmetic bugs** | Fix last |

## Step 4: Write Fix Plan

Save to `docs/bug-fix-{round-name}.md`:

```markdown
# Bug Fix: {Round Name}

> Generated: {date} | Source: {notion-link}
> Total: X bugs | Batches: Y

## Progress

| # | Bug | Batch | Status | Verified |
|---|-----|-------|--------|----------|
| 1 | [bug title] | A | pending | |
| 2 | [bug title] | A | pending | |
| ... | | | | |

## Batch A: [batch name — e.g. "Profile page state bugs"]

### Root Cause
[shared root cause or component]

### Bugs in this batch
- Bug #1: [description]
- Bug #2: [description]

### Fix Plan
- [ ] [file] → [change] → [expected result]

### Must NOT change
- [ ] [related areas]

### Verify on
- [ ] [pages/views]

---

## Batch B: [next batch]
...
```

## Step 5: Fix Each Batch (with auto browser verification)

For each batch, follow this exact procedure:

### 5a. Open browser FIRST (before any code changes)

Determine which browser target(s) the batch needs:

| Bug Layer | Open Command |
|-----------|-------------|
| Widget UI | `playwright-cli open --headed --persistent "http://localhost:5173"` |
| Admin UI | `playwright-cli open --headed --persistent "https://admin.shopify.com/store/joy-dev-store-ventu/apps/99808aac7f88fc96073c9a30082c1eef"` then navigate to bug page |
| Storefront | `playwright-cli open --headed --persistent "https://joy-dev-store-ventu.myshopify.com"` |

Then take baseline screenshot:
```bash
playwright-cli screenshot   # baseline BEFORE any fix
```

### 5b. For Widget UI bugs: Diagnose with `__joyDebug` BEFORE coding

`window.__joyDebug` is auto-loaded on Vite dev pages (`index.html`, `editor.html`).
It pierces Shadow DOM — `playwright-cli snapshot` cannot.

```bash
# Diagnose the symptom before guessing at a fix:
playwright-cli eval "window.__joyDebug.inspect('joy-component-name')"       # Full inspection
playwright-cli eval "window.__joyDebug.brandingPipeline()"                   # CSS var chain
playwright-cli eval "window.__joyDebug.innerStyles('joy-wc', '.inner-el', ['color','opacity'])"  # Inner element CSS
playwright-cli eval "window.__joyDebug.find('wrong text')"                   # Find text in shadow DOM
playwright-cli eval "window.__joyDebug.diff('joy-wc', 'propName', 'expected')"  # Check prop value
```

See full reference: `~/.claude/skills/joy-widget-v4-fix/references/shadow-dom.md`

### 5c. For EACH bug in the batch:

```
1. Present fix checklist → get user confirmation
2. For Widget UI: diagnose with __joyDebug (Step 5b) → confirm root cause
3. Make the code fix
4. playwright-cli screenshot → Read the image → is bug fixed?
   - NO → re-run __joyDebug to understand why, adjust code, repeat
   - YES → continue
5. playwright-cli goto "{related-page}" → playwright-cli screenshot → Read image
   - Regression? → adjust code, repeat from step 3
6. playwright-cli console error → any errors? fix them
7. Update plan doc: mark status as "done", add verification note
```

### 5d. After all bugs in batch are verified:
- Move to next batch (keep browser open if same target)
- Close browser only when switching to a different target

## Step 6: Summary

After all batches are done, update the plan doc with:
- Final status of all bugs
- Verification notes for each bug (which screenshot confirmed it)
- Any bugs that could not be fixed (with reason)
- Any new bugs discovered during fixing

## Rules

- **NEVER fix code without browser open** — open Playwright BEFORE coding
- **NEVER mark a bug as done without reading a screenshot** — this is the #1 cause of failed fixes
- **Use `joy-dev-store-ventu`** for admin/storefront testing (not staging stores)
- **Always use the `frontend-fix` skill** for UI bugs — it has the exact commands
- **Never skip the checklist** — even for "obvious" fixes
- **Update the plan doc after each bug** — user should always see current progress
- **If a batch grows too large** (>5 bugs), split it
- **If a bug turns out to be a different root cause** than the batch, move it to its own batch
- **If Playwright fails** (access denied, login needed), ask the user immediately — don't skip
