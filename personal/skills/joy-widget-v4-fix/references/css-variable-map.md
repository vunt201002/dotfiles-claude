# Widget CSS Variable Map

Quick reference: which CSS variable controls which visual elements.

## Theme Variables (Set by Editor → Adapter → Widget Attributes)

| Editor Setting | Widget Attribute | CSS Variable | What It Controls |
|---|---|---|---|
| Primary color | `primary-color` | `--joy-primary` | Buttons, links, active tabs, accent backgrounds, borders |
| | | `--joy-primary-hover` | Button hover states (auto: primaryColor + dd) |
| | | `--joy-primary-light` | Selected/active backgrounds (auto: primaryColor + 18) |
| | | `--joy-accent` | Same as primary |
| | | `--joy-accent-bg` | Accent section backgrounds |
| | | `--joy-border-accent` | Accent borders |
| Body text color | `secondary-text-color` | `--joy-text-secondary` | Page-level labels, navigation text, timestamps, descriptions outside cards |
| Paragraph color | `block-text-color` | `--joy-block-text-color` | Labels inside content cards/surfaces, card descriptions, list item secondary text |
| Heading text color | `heading-text-color` | `--joy-heading-text-color` | Page titles, section headings |
| | | `--joy-text-primary` | Fallback: cardHeaderColor → headingTextColor → primaryTextColor |

## joy-text Color Prop Mapping

When using `<joy-text color="X">`, named colors resolve via colorMap:

| color prop | Resolves to | Use for |
|---|---|---|
| `primary` | `var(--joy-text-primary)` | Main content text, titles |
| `secondary` | `var(--joy-text-secondary)` | Page-level labels, navigation, timestamps |
| `block` | `var(--joy-block-text-color)` | Labels/descriptions inside cards with background |
| `success` | `var(--joy-success)` | Positive states |
| `error` | `var(--joy-error)` | Error states |
| `warning` | `var(--joy-warning)` | Warning states |
| Any other value | Passed as-is to `color: X` | Custom color values, CSS variables |

## When to Use `secondary` vs `block`

| Context | Use | Example |
|---|---|---|
| Text on page background (no card) | `secondary` | Navigation labels, tab descriptions, page-level timestamps |
| Text inside a card/surface/box with background | `block` | Activity detail labels, referral card description, membership card subtitle |
| Text in inline `custom-style` inside card | `var(--joy-block-text-color)` | `custom-style="color: var(--joy-block-text-color)"` |

## Components Using Block Text Color

| Component | Element | How |
|---|---|---|
| `joy-activity-detail` | Row labels (Activity, Points, Date, Status, etc.) | `color="block"` |
| `joy-wishlist-view` | Product price in list layout | `color="block"` |
| `joy-referral-card` | Description text, referral link | `custom-style="color: var(--joy-block-text-color)"` |
| `joy-profile` | Referral link, address lines | `custom-style="color: var(--joy-block-text-color)"` |
| `joy-membership-card` | "Next: [tier]" label | `custom-style="color: var(--joy-block-text-color)"` |

## Variable Independence

`--joy-text-secondary` and `--joy-block-text-color` are **independent**:
- Changing "Body text color" only affects `--joy-text-secondary`
- Changing "Paragraph color" only affects `--joy-block-text-color`
- They have separate defaults in tokens.css (both #666666 light / #AAAAAA dark)
- They do NOT fall back to each other
