---
name: joy-frontend-fix
description: Personal v2 of Joy frontend-fix workflow. Enhanced with __joyDebug shadow DOM diagnosis, CSS variable map, and step-by-step recipes for widget v4 bugs. Use for any frontend/UI bug fix in Joy — widget CSS/theme issues, admin React/Polaris bugs, data fetch problems, layout breaks, color mismatches, state bugs after reload. Provides structured 3-layer workflow with visual verification via Playwright to prevent multi-round fix cycles.
---

# Frontend Fix Workflow

> **Core problem**: Frontend bugs require visual verification. Claude can read code but can't see the UI. Without a structured workflow, fixes take 3-4 rounds or fail entirely.

## Quick Reference

| Topic | Reference |
|-------|-----------|
| Shadow DOM inspection with `__joyDebug` | `~/.claude/skills/joy-widget-v4-fix/references/shadow-dom.md` |
| CSS Variable → Component Map | `~/.claude/skills/joy-widget-v4-fix/references/css-variable-map.md` |
| Widget branding pipeline | `packages/web-components/src/components/widget/joy-loyalty-widget.ts` → `_getCustomStyles()` |

## 3-Layer Context (Required Before Coding)

Every frontend fix needs these three layers understood before writing any code:

| Layer | What | How |
|-------|------|-----|
| **1. Source** | Read the component code, trace the chain | Read files, grep for variables/props |
| **2. Rendered** | See what actually renders | Screenshot from user, or Playwright snapshot |
| **3. Expectation** | What should change, what should NOT change | Fix checklist (below) |

## Step 1: Fix Checklist (MANDATORY)

Before touching any code, create and confirm with the user:

```
## Fix: [bug description]
## Layer: [Widget UI / Admin UI / Data Fetch]

### Root cause:
- [file:line] → [what's wrong and why]

### Changes:
- [ ] [file] → [what to change] → [expected visual result]

### Must NOT change:
- [ ] [component/page] → [should stay as-is]

### Verify on:
- [ ] [specific pages/views to check]
```

**Do NOT start coding until user confirms the checklist.**

## Step 2: Open Browser (BEFORE any code change)

**This step is NOT optional. Execute these commands before writing any code.**

### Auto-detect browser target

Determine the bug layer and open the correct browser:

#### Widget UI — Vite Preview
```bash
# 1. Ensure Vite dev server is running
lsof -i :5173 || (cd packages/web-components && npm run dev &)

# 2. Open Playwright
playwright-cli open --headed --persistent "http://localhost:5173"

# 3. Navigate to the relevant preview page
playwright-cli goto "http://localhost:5173/index.html"

# 4. Take BASELINE screenshot
playwright-cli screenshot
```

#### Admin UI — Embedded App
```bash
# 1. Read store info — use the FIRST store in the Playwright session's store list
#    The local dev store is: joy-dev-store-ventu
#    The app ID for dev: 99808aac7f88fc96073c9a30082c1eef

# 2. Open Playwright to admin
playwright-cli open --headed --persistent "https://admin.shopify.com/store/joy-dev-store-ventu/apps/99808aac7f88fc96073c9a30082c1eef"

# 3. Navigate to the bug page (e.g., widget editor)
playwright-cli goto "https://admin.shopify.com/store/joy-dev-store-ventu/apps/99808aac7f88fc96073c9a30082c1eef/embed/storefront/branding/widget-editor"

# 4. Take BASELINE screenshot
playwright-cli screenshot
```

#### Storefront — Live Widget
```bash
# 1. Open storefront
playwright-cli open --headed --persistent "https://joy-dev-store-ventu.myshopify.com"

# 2. Take BASELINE screenshot
playwright-cli screenshot
```

#### Data Fetch — Code Trace + Log
```bash
# No Playwright needed. Trace: API endpoint → adapter mapping → component props
# If unsure, add console.log at adapter layer
# Check browser DevTools console OR firebase-debug.log
```

## Step 2.5: Diagnose with `__joyDebug` (Widget UI bugs — BEFORE coding)

> **Why this step exists**: `playwright-cli snapshot` does NOT see inside Shadow DOM. Our widget
> is 40+ Lit components nested 3-5 levels deep. Without diagnosis, you're guessing at the fix.
> **Diagnose first, fix second.**

`window.__joyDebug` is auto-loaded on Vite dev pages (`index.html`, `editor.html`) via
`packages/web-components/src/utils/joy-debug-init.ts`. It's DEV-only (tree-shaken from production).

**Run these AFTER opening browser (Step 2), BEFORE writing any code (Step 3):**

### Diagnosis by symptom

| Symptom | Diagnosis commands | What you learn |
|---------|-------------------|----------------|
| **Element invisible / wrong color** | `brandingPipeline()` → `innerStyles(wc, '.class', ['color','background-color','opacity','display','visibility'])` | Which CSS var is wrong, where in the chain it breaks |
| **Wrong text displayed** | `find('the wrong text')` → `props(tag)` | Which component renders it, what data it has |
| **Data not reaching component** | `diff(tag, propName, expectedValue)` | Whether prop is set, actual vs expected |
| **CSS variable not applying** | `cssVars(tag)` | Resolved values + source (inline/branding/inherited) |
| **Don't know where to start** | `tree('joy-loyalty-widget', {maxDepth: 2})` → `inspect(tag)` | Component hierarchy, then deep dive |
| **Layout/spacing broken** | `innerStyles(wc, '.class', ['display','flex','gap','padding','margin','width','height'])` | Computed layout properties of inner elements |

### Core commands

```bash
# 1. OVERVIEW: Component tree (start here if unsure)
playwright-cli eval "window.__joyDebug.tree('joy-loyalty-widget', {maxDepth: 2, sparse: true})"

# 2. INSPECT: Full deep-dive on one component
playwright-cli eval "window.__joyDebug.inspect('joy-redeem-detail')"
#   Returns: properties, @state, computed CSS, CSS vars, child components

# 3. PROPS: Just the @property values
playwright-cli eval "window.__joyDebug.props('joy-membership-card')"

# 4. DIFF: Check if a specific property matches expected value
playwright-cli eval "window.__joyDebug.diff('joy-loyalty-widget', 'primaryColor', '#1a1a1a')"

# 5. BRANDING: Full pipeline — editor setting → attribute → CSS var → computed value
playwright-cli eval "window.__joyDebug.brandingPipeline()"

# 6. CSS VARS: All --joy-* vars resolved at a component
playwright-cli eval "window.__joyDebug.cssVars('joy-loyalty-widget')"

# 7. INNER STYLES: Computed CSS of elements inside shadow DOM (div, span, img)
playwright-cli eval "window.__joyDebug.innerStyles('joy-membership-card', '.tier-icon img', ['width','height','opacity','visibility'])"

# 8. INNER TEXT: Read text content inside shadow DOM
playwright-cli eval "window.__joyDebug.innerText('joy-coupon-list', '.joy-coupon-status')"

# 9. FIND: Search ALL shadow roots for text content
playwright-cli eval "window.__joyDebug.find('250 points')"

# 10. TREE with filter: Find specific component types
playwright-cli eval "window.__joyDebug.tree('joy-loyalty-widget', {filter: 'membership', maxDepth: 3})"
```

### Interact inside shadow DOM (Playwright locators auto-pierce)

```bash
# Click through nested shadow DOM
playwright-cli run-code "async page => {
  await page.locator('joy-loyalty-widget').locator('joy-fab-button').locator('button').click();
}"

# Read computed style of deep shadow element
playwright-cli eval "getComputedStyle(window.__joyDebug.queryShadow('joy-membership-card .tier-icon img')).opacity"
```

```bash
# Full method list
playwright-cli eval "window.__joyDebug.help()"
```

**After diagnosis**: Update your fix checklist root cause with what you found. Then proceed to Step 3.

---

## Step 3: Fix → Screenshot → Verify Loop

**Repeat this loop for EACH bug until visually confirmed:**

```
1. Make the code change (per checklist)
2. IMMEDIATELY screenshot the bug page:
   → playwright-cli screenshot
   → Read the screenshot image file
3. Compare with baseline — is the bug fixed?
   - YES → go to step 4 (regression check)
   - NO → re-diagnose with __joyDebug, adjust code, go back to step 1
4. Regression check — screenshot 2-3 related pages:
   → playwright-cli goto "{related-page}"
   → playwright-cli screenshot
   → Read the screenshot image file
5. Check for JS errors:
   → playwright-cli console error
6. Any regressions or errors?
   - YES → adjust code, go back to step 1
   - NO → done, go to Step 4: Report
```

**Key rules**:
- Claude does the visual relay, not the user
- The user only does one final check at the end
- NEVER say "fix is done" without having read a screenshot that confirms it
- For Widget UI bugs: if the fix doesn't work on first try, **re-run `__joyDebug` commands** to diagnose why — don't blindly iterate

### Playwright Quick Commands

```bash
playwright-cli screenshot                    # Full page screenshot
playwright-cli snapshot                      # DOM snapshot (does NOT pierce shadow DOM)
playwright-cli eval "document.title"         # Check page state
playwright-cli console error                 # Check for JS errors
playwright-cli goto "{url}"                  # Navigate to another page
playwright-cli click e5                      # Click element by ref
playwright-cli fill e5 "text"                # Fill input by ref
playwright-cli close                         # Close browser
```

## Step 4: Report

Report with evidence:

```
## Fix Complete

### What changed:
- [file:line] → [change description]

### Verified:
- [x] [page/view] — screenshot confirmed
- [x] [related page] — no regression

### User to verify:
- [ ] [final check on real app — specific page + what to look for]
```

## Common Pitfalls (From Experience)

| Pitfall | Prevention |
|---------|------------|
| Fixing code without opening browser first | Step 2 is BEFORE Step 3 — always |
| Saying "done" without reading a screenshot | NEVER mark done without playwright-cli screenshot + Read |
| Over-scoping — changing 20 files for a 3-file fix | Checklist limits scope before coding |
| CSS variable fallback chains breaking | Check `css-variable-map.md` for dependencies |
| Fix works in isolation, breaks in context | Screenshot related pages, not just the bug page |
| color="secondary" vs custom-style="color: var(...)" | Named colors resolve via joy-text colorMap, check mappings |
| Using staging store instead of local dev store | Always use `joy-dev-store-ventu` for admin/storefront testing |
| Guessing at shadow DOM issues without diagnosis | Run `__joyDebug.inspect()` or `brandingPipeline()` BEFORE coding — Step 2.5 |
| Using `playwright-cli snapshot` to debug widget internals | Snapshot can't pierce shadow DOM — use `__joyDebug` commands instead |
| Blindly iterating when fix doesn't work | Re-run `__joyDebug` diagnosis to understand WHY, don't just try different values |
