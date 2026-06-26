---
name: qa-login
description: LAST-RESORT login primer for browser QA — try cheaper paths first (public/storefront page, reuse an existing authenticated Playwright session, or bypass Admin via dev-preview URL / Admin API / theme preview). Only when none work, this imports cookies from your real Chrome (Chrome stays open, no separate profile, no CDP) into the headless browse session for the Shopify storefront, admin (admin.shopify.com / *.myshopify.com / accounts.shopify.com), or any app-embed/dev-store domains you name, then verifies. Asks which store each run (no hardcoded domains), works across stores and clients. NOT a credential store (copies existing cookies, never types passwords). Known limit, confirmed in practice: Shopify Admin sessions are device-bound + Cloudflare-gated, so even cookie-import can still hit a login/challenge screen — storefront/customer almost always carries, Admin may not. Use when asked to "qa login", "đăng nhập sẵn để test", "login the browser", "prime the session", "import shopify cookies", "/qa-login", or as the final fallback after other verify-on-browser paths fail. See personal/docs/workflow.md "Verify trên browser cần login" for the full fallback ladder.
---

# /qa-login — prime the headless browser with your real Chrome logins

The problem this kills: every time Claude opens the headless browser (`/browse`,
`/qa`, `/design-review`), it's a blank session, so you re-login Shopify storefront +
admin + app embed by hand, step by step. This skill copies the cookies from your
**real, already-logged-in Chrome** into the browse session, so the test starts
authenticated.

**Your real Chrome stays open and untouched.** This reads Chrome's cookie store on
disk; it does NOT launch a separate profile, does NOT use CDP, does NOT make you
quit Chrome. Just log into the stores you care about in normal Chrome once, then run
this whenever you're about to test.

## What it canNOT do (say this honestly, don't oversell)

- It does **not** know your passwords and never types them. It copies cookies that
  already exist because *you* logged in in Chrome.
- Shopify **Admin** sessions are sometimes device-bound or SSO/2FA-gated. Those
  cookies don't always carry a working session. Storefront/customer cookies almost
  always do. If Admin still shows a login screen after import, that's the known limit
  of cookie-copying, not a bug — fall back to logging into Admin once in the browse
  session, or use the UI picker mode and re-import.
- Cookies expire. When a session goes stale mid-test, just run `/qa-login` again.

## The browse binary

Every command below uses the browse binary. Resolve it once (it may be symlinked):

```bash
B=""
for c in "$HOME/.claude/skills/gstack/browse/dist/browse" \
         "$HOME/.claude/skills/aov-lab/browse/dist/browse" \
         "$HOME/Project/aov-lab/browse/dist/browse"; do
  if [ -x "$c" ]; then B="$c"; break; fi
done
[ -z "$B" ] && B="$(command -v browse 2>/dev/null)"
if [ -x "$B" ]; then echo "BROWSE: $B"; else echo "BROWSE: NOT FOUND — is gstack/aov-lab installed?"; fi
```

If `NOT FOUND`, tell the user the browse binary isn't installed/built and stop —
this skill can't do anything without it. (Build it via the gstack/aov-lab `./setup`.)

## Step 0 — already on your real browser? (CDP short-circuit)

```bash
"$B" status 2>/dev/null | grep -q "Mode: cdp" && echo "CDP=yes" || echo "CDP=no"
```

If `CDP=yes`: the session is already attached to your real browser, so every login
is already there. Tell the user "Already connected to your real browser — your
logins are live, nothing to import." and stop.

If `CDP=no` (the normal case): continue.

## Step 1 — which store / domains this run?

There are **no hardcoded domains** — ask, because the user tests different stores and
clients. Use AskUserQuestion (or just read it from what the user already typed after
`/qa-login`). Collect the set of domains to import. Typical Shopify set:

- **Storefront:** the shop's public domain, e.g. `examplestore.com` or
  `examplestore.myshopify.com`. Customer login + cart live here.
- **Admin:** `admin.shopify.com` (the unified admin) **and** the store's
  `<store>.myshopify.com` (legacy admin host), **and** `accounts.shopify.com`
  (the login/SSO host — important, this is what carries the auth session).
- **App embed / dev store:** whatever host your app or dev store runs on, if the user
  names one.

If the user already named a store (e.g. `/qa-login examplestore`), expand it to the
sensible set above without re-asking. If they said nothing, ask once: "Which store
are we testing? Give me the storefront domain (I'll add the Shopify admin + accounts
hosts automatically)." Keep tech terms/domains in English; talk to the user in their
language.

**Two ways to import — pick based on how specific the user was:**

| Situation | Mode |
|-----------|------|
| User named the store / domains | **Direct mode** (Step 2a) — no UI, just import each domain |
| User wants to eyeball/pick, or isn't sure which domains | **Picker mode** (Step 2b) — open the UI |

## Step 2a — direct import (named domains, no UI)

For each domain in the set, run:

```bash
"$B" cookie-import-browser chrome --domain <domain>
```

It prints `Imported N cookies for <domain> from chrome`. Run it once per domain. For
a typical Shopify store that's something like:

```bash
"$B" cookie-import-browser chrome --domain examplestore.com
"$B" cookie-import-browser chrome --domain examplestore.myshopify.com
"$B" cookie-import-browser chrome --domain admin.shopify.com
"$B" cookie-import-browser chrome --domain accounts.shopify.com
```

(Replace `examplestore` with the real store. Add the app-embed host if the user named
one.) `chrome` is the browser; the description confirms Chrome is the user's real
browser. On macOS the **first** import may pop a Keychain dialog — tell the user to
click "Always Allow" so it doesn't ask again.

Report the per-domain counts. A domain that imports `0 cookies` means the user isn't
logged into that host in Chrome (or never visited it) — call that out, don't hide it.

## Step 2b — UI picker (user wants to choose)

```bash
"$B" cookie-import-browser
```

This opens a picker UI in the user's default browser (it prints the URL, e.g.
`http://127.0.0.1:PORT/cookie-picker`). Tell the user:

> **Cookie picker opened — search and "+" the domains you want (storefront, admin.shopify.com, your store's .myshopify.com, accounts.shopify.com), then tell me when you're done.**

Then STOP and wait for the user to say they're done. Do not proceed to verify until
they confirm — they're clicking in another window.

## Step 3 — verify

After importing (either mode), confirm what landed:

```bash
"$B" cookies
```

This prints the imported cookies as JSON. Summarize for the user: which domains have
cookies now and roughly how many each. Don't dump raw cookie values at the user —
just domain + count (e.g. "admin.shopify.com: 7 cookies, examplestore.com: 12").

**Optional live check** (do this if the user wants proof, or if Admin is the worry):
navigate to an authenticated page and see if it's logged in.

```bash
"$B" goto https://admin.shopify.com/store/<store>
"$B" text | head -40
```

If the page shows the admin dashboard → logged in, done. If it shows a login form →
the Admin cookies didn't carry the session (the known limit above). Tell the user
plainly and offer: (a) log into Admin once in this browse session by hand, or (b) try
the picker mode to grab a fresher cookie set.

## Step 4 — hand off

Once verified, the session is primed. Tell the user they can now run `/qa`,
`/browse`, `/design-review`, or whatever test — the browser is logged in. The cookies
persist across browse commands for this session, so they don't need to re-run this
until the session is restarted or a cookie expires.

## Cross-machine note

This skill hardcodes **no paths and no credentials**, so it runs on any machine that
has the browse binary — it reads cookies from *that* machine's Chrome. There's no
session syncing between machines by design (syncing live session tokens through git
would be a security problem). Log in once in Chrome on each machine; this skill does
the rest. The skill is symlinked into `~/.claude/skills/qa-login` — if it's missing
on a machine after pulling the repo, run **/sync-skills** to link it.

## Routing — don't confuse with neighbors

- This **primes login state**; it does not test. After it, use **/qa** (test + fix),
  **/qa-only** (report only), **/browse** (drive the browser), or **/design-review**.
- It is **not** `/setup-browser-cookies` (the gstack/aov-lab built-in). This is a
  thin, Shopify-aware wrapper that knows the admin/accounts host set and asks which
  store. If the user wants the raw generic picker for a non-Shopify site, point them
  at `/setup-browser-cookies`.
- Read-only beyond the browse session: it never touches repo code, never commits.
