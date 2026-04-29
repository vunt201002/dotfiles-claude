# Shadow DOM Inspection with Playwright CLI

## The Problem

`playwright-cli snapshot` only sees the outer custom elements — it does NOT traverse into
Shadow DOM. Our Joy widget is 40+ Lit web components nested 3-5 levels deep. Standard
snapshot/click/eval commands only reach the outermost layer.

## Solution: Joy Debug Helper (`__joyDebug`)

The Vite dev pages auto-load `window.__joyDebug` which provides shadow-piercing inspection.
See `.claude/skills/frontend-fix/SKILL.md` → "Shadow DOM Debug Commands" for the full
command reference.

## Playwright Locator Shadow Piercing

Playwright's `locator()` API **automatically pierces open Shadow DOM** — you don't need
manual `.shadowRoot` chaining for interactions:

```bash
# Click a button inside nested shadow DOM — locator chains pierce automatically
playwright-cli run-code "async page => {
  await page.locator('joy-loyalty-widget').locator('joy-fab-button').locator('button').click();
}"

# Read text inside shadow DOM
playwright-cli run-code "async page => {
  return await page.locator('joy-loyalty-widget').locator('joy-membership-card').locator('.points-value').textContent();
}"

# Check if element is visible
playwright-cli run-code "async page => {
  return await page.locator('joy-membership-card').locator('.tier-icon img').isVisible();
}"

# Wait for a component to appear inside shadow DOM
playwright-cli run-code "async page => {
  await page.locator('joy-loyalty-widget').locator('joy-earn-detail').waitFor({state: 'visible'});
}"
```

## Manual Shadow Root Traversal (via eval)

When you need computed styles or Lit properties (not just DOM interaction), use `eval`:

```bash
# Read Lit property directly
playwright-cli eval "document.querySelector('joy-loyalty-widget')?.primaryColor"

# Traverse shadow roots manually for computed styles
playwright-cli eval "
  const widget = document.querySelector('joy-loyalty-widget');
  const card = widget?.shadowRoot?.querySelector('joy-membership-card');
  const icon = card?.shadowRoot?.querySelector('.tier-icon img');
  icon ? getComputedStyle(icon).opacity : 'not found';
"

# Read the branding <style> tag the widget injects
playwright-cli eval "
  document.querySelector('joy-loyalty-widget')?.shadowRoot?.querySelector('style')?.textContent?.slice(0, 500)
"
```

## Common Debugging Patterns

### "Why is this element invisible?"
```bash
# Check opacity, visibility, display, dimensions
playwright-cli eval "window.__joyDebug.innerStyles('joy-membership-card', '.tier-icon img', ['opacity','visibility','display','width','height'])"
```

### "Why is the color wrong?"
```bash
# Trace the full branding pipeline
playwright-cli eval "window.__joyDebug.brandingPipeline()"

# Check what CSS vars resolve to at a specific component
playwright-cli eval "window.__joyDebug.cssVars('joy-membership-card')"
```

### "Is the data reaching the component?"
```bash
# Check property value
playwright-cli eval "window.__joyDebug.diff('joy-loyalty-widget', 'currentTierIcon', 'data:image/svg+xml,...')"

# See all non-default properties
playwright-cli eval "window.__joyDebug.props('joy-referral-card')"
```

### "Where does this text come from?"
```bash
playwright-cli eval "window.__joyDebug.find('Stackable with')"
```

## Key Differences from Regular DOM Testing

| Regular DOM | Shadow DOM |
|-------------|------------|
| `playwright-cli snapshot` shows everything | Snapshot shows only host elements, not shadow internals |
| `playwright-cli click e5` works for any element | Element refs from snapshot can't target shadow internals |
| `playwright-cli eval "el => el.textContent" e5` | Can't read text inside shadow children |
| CSS is global | Each component has scoped CSS — global overrides don't work |
| `document.querySelector('.class')` finds it | Must chain through `.shadowRoot.querySelector()` |

**Rule**: For Shadow DOM widgets, always prefer `__joyDebug` methods or `page.locator()` chains
over snapshot element refs.
