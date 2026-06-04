# Estimation Rules & Heuristics

## Rule 1: Assess Complexity (Y-axis)

### Easy
- Single file or component change
- Known pattern — we've done this before
- No new dependencies or APIs
- Examples: CSS fix, config toggle, copy change, simple bug

### Medium
- Multiple files/components affected
- Some new patterns but within existing architecture
- May touch FE + BE but in predictable ways
- Examples: new settings section, notification template, form validation

### Hard
- Multi-service impact (webhook + PubSub + scheduled + Firestore)
- New architecture patterns or system design
- Complex business logic with edge cases
- Examples: new integration, rule engine, Shopify Functions, data migration

**Complexity signals that push UP:**
- Touches both frontend (assets/) AND backend (functions/)
- Requires new Shopify API (webhook, GraphQL, Functions)
- Needs Firestore schema changes (new collection, index)
- Involves PubSub/background processing
- Requires new UI page or major component
- Needs data migration
- Involves third-party API (Klaviyo, Fera, etc.)
- Requires Shopify Checkout Extensibility
- Needs Cloud Tasks or scheduled functions

**Complexity signals that push DOWN:**
- Config-only change (no logic)
- Copy/text change only
- Single file affected
- Similar task done before (pattern exists)
- Pure CSS/styling change

## Rule 2: Assess Uncertainty (X-axis)

### None
- Clear requirements with mockup/spec
- We've built something similar before
- No external dependency unknowns
- Known data model, known API

### A Little
- Requirements mostly clear, some details TBD
- Familiar domain but new variation
- May need to explore Shopify API docs
- Some edge cases to discover during dev

### A Lot
- Vague or evolving requirements
- New domain / unfamiliar territory
- External API we haven't used before
- Unclear data model or architecture approach
- Needs research/POC before implementation

## Rule 3: Joy-Specific Patterns

### Webhook handlers (apiHookV2)
- Add new webhook topic handler → **5-8 pts**
- Fix existing webhook bug → **3-5 pts**
- New webhook + PubSub + Firestore → **13 pts**

### Widget (scripttag/)
- Style/CSS fix → **1-3 pts**
- New widget section → **8-13 pts**
- Widget redesign → **21-34 pts**

### Loyalty page (assets/ + scripttag/)
- New block type → **13-21 pts**
- Full page customization → **34-55 pts**

### Integrations (apiIntegratev2)
- Simple webhook integration → **13 pts**
- Full bi-directional sync (Klaviyo-style) → **21-34 pts**

### Earning programs
- Modify existing program logic → **5-8 pts**
- New earning program type → **13-21 pts**
- Complex rule engine → **55-89 pts**

### Redemption programs
- Fix redemption bug → **3-5 pts**
- New redemption type → **13-21 pts**
- Shopify Functions redemption → **34-55 pts**

### VIP Tiers
- Tier display fix → **3-5 pts**
- New tier feature (perks, milestones) → **13-21 pts**
- Full VIP tier redesign → **34 pts**

### POS Extension
- Fix POS bug → **5-8 pts**
- New POS feature → **13-21 pts**

### Notifications (email/push)
- Fix template → **3 pts**
- New notification type → **5-8 pts**
- Notification system improvement → **13 pts**

## Rule 4: When Uncertain

- **Round up**, not down — underestimation causes more problems
- If between two levels, pick the higher one
- 55+ pts tasks should be broken into sub-tasks
- 0 pts = trivial (typo, already done, included in another task)

## Rule 5: Review Checklist

Before finalizing points, verify:
- [ ] Does the task description match the complexity of this point level?
- [ ] Are there similar historical tasks at this level?
- [ ] Have I accounted for testing effort?
- [ ] Is there a Shopify API dependency that could add complexity?
- [ ] Does this need staging environment setup?
