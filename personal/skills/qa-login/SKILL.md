---
name: qa-login
description: LAST-RESORT login primer for browser QA — copies cookies from your real Chrome into whichever browser session is in play (Playwright MCP storage-state, or the headless /browse session). Try cheaper paths first — a public page, an already-authenticated session, or /my-chrome (real logged-in Chrome, no import needed). Asks which store each run; copies existing cookies, never types passwords. Known limit — Shopify Admin is device-bound + Cloudflare-gated, so storefront usually carries but Admin may still challenge. Use when asked "qa login", "đăng nhập sẵn để test", "login the browser", "prime the session", "import shopify cookies", "/qa-login", or as the final fallback after other browser-verify paths fail.
---

# /qa-login — prime a browser session with your real Chrome logins

The problem this kills: every time Claude opens a fresh browser session — headless
`/browse` (`/qa`, `/design-review`), or a connected Playwright MCP when actually
available — it starts blank, so you re-login
Shopify storefront + admin + app embed by hand, step by step. This skill copies the
cookies from your **real, already-logged-in Chrome** into whichever session is
actually in play this run, so the test starts authenticated.

**Your real Chrome stays open and untouched.** This reads Chrome's cookie store on
disk; it does NOT launch a separate profile, does NOT use CDP on your real Chrome,
does NOT make you quit Chrome. Just log into the stores you care about in normal
Chrome once, then run this whenever you're about to test.

## What it canNOT do (say this honestly, don't oversell)

- It does **not** know your passwords and never types them. It copies cookies that
  already exist because *you* logged in in Chrome.
- Shopify **Admin** sessions are sometimes device-bound or SSO/2FA-gated. Those
  cookies don't always carry a working session. Storefront/customer cookies almost
  always do. If Admin still shows a login screen after import, that's the known limit
  of cookie-copying, not a bug.
- Cookies expire. When a session goes stale mid-test, just run `/qa-login` again.
- **Chrome DevTools MCP `--autoConnect`/deviceId path is UNVERIFIED.** Skill này
  không route hoặc prime target đó; đừng trình bày nó như solution.
- Prime login **không** giải quyết cross-origin iframe control. Embedded Admin sau
  login phải dùng `/browse` + `$B frame 'iframe[name="app-iframe"]'`; selector này đã
  đo trên live Shopify, nhưng full `browse --cdp` path chưa verify end-to-end.

## The browse binary

Regardless of target, cookies are always **read** from real Chrome via the browse
binary — it's the only piece here with OS Keychain access to decrypt Chrome's cookie
store. Resolve it once (it may be symlinked):

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
this skill can't do anything without it, even when the destination is an MCP target.
(Build it via the gstack/aov-lab `./setup`.)

## Step -1 — which session are we priming?

Hai destination được support: **`/browse`** (mặc định; `/qa`, `/qa-only`,
`/design-review` dùng target này) hoặc **Playwright MCP** chỉ khi tool thật sự có
trong workspace hiện tại. Không assume từ memory: Playwright MCP chỉ được biết là
configured ở `wishlist-3`, không có ở `wishlist`, `wishlist-2`, hay `joy`.

Decide by what's actually connected/relevant this session — don't ask if it's
already obvious from context:

1. Nếu task đang ở workspace `wishlist-3`, check **Playwright MCP** bằng
   `ToolSearch("playwright mcp browser storage cookie")`. Tool thật sự có → target
   Playwright (Step 0-pw). Không có tool → không retry/search tiếp.
2. Mọi trường hợp khác → target `/browse` (Step 0-browse).

If genuinely ambiguous (bare `/qa-login <store>` trong `wishlist-3`, Playwright tool
có mặt nhưng context chưa chỉ target), ask once: "Đang prime Playwright MCP hay
`/browse` (cho `/qa` sau)?"

## Step 0 — already authenticated? (short-circuit, per target)

### Step 0-browse (target = `/browse`)

```bash
"$B" status 2>/dev/null | grep -q "Mode: cdp" && echo "CDP=yes" || echo "CDP=no"
```

If `CDP=yes`: the session is already attached to your real browser, so every login
is already there. Tell the user "Already connected to your real browser — your
logins are live, nothing to import." and stop.

If `CDP=no` (the normal case): continue to Step 1, then Step 2-browse.

### Step 0-pw (target = Playwright MCP)

Playwright MCP contexts are launched isolated by default — no short-circuit check;
go straight to Step 1 then Step 2-pw to inject cookies.

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

**Two ways to import (target = `/browse` only) — pick based on how specific the user was:**

| Situation | Mode |
|-----------|------|
| User named the store / domains | **Direct mode** (Step 2-browse a) — no UI, just import each domain |
| User wants to eyeball/pick, or isn't sure which domains | **Picker mode** (Step 2-browse b) — open the UI |

(Target = Playwright MCP always uses direct mode — Step 2-pw — since it reads
through the same `cookie-import-browser` command under the hood, just re-exports
the result instead of leaving it in browse's own session.)

## Step 2 — import, per target

### Step 2-browse a — direct import (named domains, no UI)

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

### Step 2-browse b — UI picker (user wants to choose)

```bash
"$B" cookie-import-browser
```

This opens a picker UI in the user's default browser (it prints the URL, e.g.
`http://127.0.0.1:PORT/cookie-picker`). Tell the user:

> **Cookie picker opened — search and "+" the domains you want (storefront, admin.shopify.com, your store's .myshopify.com, accounts.shopify.com), then tell me when you're done.**

Then STOP and wait for the user to say they're done. Do not proceed to verify until
they confirm — they're clicking in another window.

### Step 2-pw — inject into a connected Playwright MCP session

Playwright's native cookie shape (`name`, `value`, `domain`, `path`, `expires`,
`httpOnly`, `secure`, `sameSite`) is **exactly** what `browse` already emits — browse
is itself built on Playwright — so no format conversion is needed, only wrapping.

1. Read cookies from real Chrome the same way as Step 2-browse a, but into browse's
   own throwaway session (this is just the read step, not the final destination):

   ```bash
   "$B" cookie-import-browser chrome --domain examplestore.com
   "$B" cookie-import-browser chrome --domain examplestore.myshopify.com
   "$B" cookie-import-browser chrome --domain admin.shopify.com
   "$B" cookie-import-browser chrome --domain accounts.shopify.com
   ```

2. Dump and wrap into a Playwright `storageState.json`:

   ```bash
   echo "{\"cookies\": $("$B" cookies), \"origins\": []}" > /tmp/qa-login-storage-state.json
   ```

3. Load it into the connected Playwright MCP session with its `browser_set_storage_state`
   tool, passing `path: "/tmp/qa-login-storage-state.json"`. This loads every cookie
   in one call — no MCP server restart needed.

   If `browser_set_storage_state` isn't available on that server (e.g. `--caps=storage`
   wasn't enabled), fall back to looping the MCP's `browser_cookie_set` tool once per
   cookie in the JSON (same fields, no file needed).

4. Clean up the throwaway browse session and temp file once the MCP session has the
   cookies loaded:

   ```bash
   "$B" stop 2>/dev/null
   rm -f /tmp/qa-login-storage-state.json
   ```

Report the same way as browse-direct mode: which domains landed, roughly how many
cookies each (from the wrapped JSON's length per domain) — not raw values.

## Step 3 — verify

### Target = `/browse`

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

### Target = Playwright MCP

Use the connected MCP's own navigate + read/snapshot tools instead of `"$B" goto`/
`"$B" text`: navigate to an authenticated page for one of the imported domains, read
the page, confirm it shows real content instead of a login form. Same "Admin may
still be blocked, storefront almost always works" caveat applies — say so plainly if
Admin still shows a login screen.

## Step 4 — hand off

Once verified, the session is primed. For `/browse` target: tell the user they can
now run `/qa`, `/browse`, `/design-review`, or whatever test. For Playwright MCP: tell
the user the connected session is now authenticated for the domains
imported — proceed with whatever verify step (e.g. workflow.md B8/A7) triggered this.
Cookies persist across commands for this session, so no need to re-run this until the
session restarts or a cookie expires.

## Cross-machine note

This skill hardcodes **no paths and no credentials**, so it runs on any machine that
has the browse binary — it reads cookies from *that* machine's Chrome. There's no
session syncing between machines by design (syncing live session tokens through git
would be a security problem). Log in once in Chrome on each machine; this skill does
the rest. The skill is symlinked into `~/.claude/skills/qa-login` — if it's missing
on a machine after pulling the repo, run **/sync-skills** to link it.

## Routing — don't confuse with neighbors

- This **primes login state**; it does not test. After it, use **/qa** (test + fix),
  **/qa-only** (report only), **/browse** (drive the browser), or **/design-review**
  — all of these expect the `/browse` target. Embedded Admin phải switch bằng
  `$B frame 'iframe[name="app-iframe"]'` trước khi snapshot/act; nếu frame path fail 2 lần thì
  stop + báo user, không coordinate-click hoặc thử tool thứ ba.
- It is **not** `/setup-browser-cookies` (the gstack/aov-lab built-in). This is a
  thin, Shopify-aware wrapper that knows the admin/accounts host set and asks which
  store. If the user wants the raw generic picker for a non-Shopify site, point them
  at `/setup-browser-cookies`.
- Read-only beyond the primed session: it never touches repo code, never commits.
