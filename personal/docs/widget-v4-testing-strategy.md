# Widget V4 Frontend Testing Strategy

## Problem

Frontend bugs in Widget V4 are significantly harder to fix than backend bugs:
- **Backend**: Claude can read codebase, trace flow, audit logic, find root cause from code alone
- **Frontend**: Requires visual feedback — CSS issues, layout problems, color mismatches cannot be detected by reading code

Current workflow relies heavily on manual steps: screenshot, copy element, paste console errors. This is slow and creates a bottleneck.

**Goal**: Reduce manual work, increase fix speed and accuracy, prevent bug recurrence.

## Current Approach (What Works)

1. **Screenshot-driven debugging** — User sends screenshots of UI bugs, Claude traces root cause in code
2. **Layer-by-layer fixing** — Separate adapter issues, data issues, UI issues
3. **DevTools bridge** — User inspects elements, shares computed styles and console errors

## Improvement Strategies

### Strategy 1: Playwright Persistent Session

Use `/browser-test` skill with persistent login to test widget directly on Shopify storefront.

**Setup**: Login once, keep cookie session. Claude can then:
- Open widget, take screenshots automatically
- Inspect DOM elements, read computed styles
- Verify fix before reporting "done"

**Best for**: Final integration testing, catching regressions

### Strategy 2: Visual Regression Script

Create a script that captures screenshots of widget at each view (earn, redeem, profile, activity, referral, wishlist, coupon).

**Workflow**: 
1. Capture baseline screenshots
2. After each fix, re-run script
3. Compare before/after — Claude can read images and detect regressions

### Strategy 3: CSS Audit Script

Similar to `scripts/check-widget-v4-translations.js`, create a CSS audit:
- CSS variables set but never used
- CSS variables used but never set
- Hardcoded color values that should use CSS variables
- Mismatched variable names between adapter and components

### Strategy 4: Isolated Component Test Page (Priority)

Create a standalone HTML page that imports web components directly with mock data. No Shopify login, no adapter, no real data needed.

**How it works**:
```html
<!-- Render full widget with theme overrides -->
<joy-loyalty-widget
  primary-color="#D600FF"
  heading-text-color="#00FFE5"
  secondary-text-color="#FF0000"
  block-text-color="#0000FF"
></joy-loyalty-widget>

<!-- Or test individual components -->
<joy-activity-detail .activity=${mockData}></joy-activity-detail>
<joy-referral-card reward-you="$5" reward-friend="$5"></joy-referral-card>
```

**Advantages over Shopify testing**:

| Shopify Testing | Isolated Test Page |
|---|---|
| Login, open store, open widget | Open 1 HTML file |
| Need real data (customer, points) | Mock data, full control |
| Change theme via editor, wait reload | Change attributes directly, instant |
| Hard to test edge cases (empty, error, loading) | Easy — just set props |
| Playwright needs login session | No auth needed |

**Playwright integration**:
1. Open test page
2. Change attributes programmatically (e.g., `secondary-text-color="#FF0000"`)
3. Take screenshot
4. Verify computed CSS styles of specific elements
5. Compare before/after fix

**Limitations**:
- Does NOT replace Shopify testing — still need integration test at the end
- Cannot test adapter logic (data mapping, API calls)
- Cannot test Shadow DOM interaction with Shopify theme
- Need to maintain mock data

**Workflow**: Fix → verify on isolated page → final test on Shopify

## Components to Prioritize

Based on frequently fixed components in Widget V4:
1. `joy-loyalty-widget` — main widget, theme variables
2. `joy-activity-detail` — activity detail view
3. `joy-profile` — profile page
4. `joy-referral-card` — referral section
5. `joy-earn-detail` — earn program detail
6. `joy-redeem-detail` — redeem program detail
7. `joy-membership-card` — tier/membership card
8. `joy-coupon-list` — coupon management

## Implementation Plan

1. **Phase 1**: Create isolated test page with full widget + mock data
2. **Phase 2**: Add individual component test sections
3. **Phase 3**: Integrate with Playwright for automated visual testing
4. **Phase 4**: Add CSS audit script

---
*Created: 2026-04-14*
