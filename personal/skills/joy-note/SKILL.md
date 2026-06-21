---
name: joy-note
description: Quickly capture a work note into the Joy Obsidian vault (personal/joy-vault) while coding — a gotcha, a latent/potential bug to watch, how something works, a decision, an open question, or a raw dump. Files it in the right domain folder with correct frontmatter so the vault's _MOC and 🐛 Watchlist auto-collect it. Use when asked to "note this", "ghi chú cái này", "lưu vào obsidian", "save a note", "remember this gotcha/bug", "/joy-note", or right after hitting something worth remembering mid-task.
---

# Joy Note — quick capture into the Obsidian vault

Capture knowledge into the Joy vault (`personal/joy-vault/`, junction-linked) in one step.
A Python script does the deterministic file write (frontmatter, correct folder, dedup);
you supply the intelligence (classify, title, pick domain, write a faithful body).

Script: `python ~/.claude/skills/joy-note/scripts/note.py`

## Parameters (all optional — provided wins, else auto)

The user MAY pass `key:value` tokens anywhere in the args; anything left over is the note body.
Whatever is given is authoritative — only **auto-detect/infer the params that are missing**.

| Param | Aliases | Values | If omitted |
|-------|---------|--------|------------|
| `type:` | `t:` | how-it-works · gotcha · potential-bug · decision · bug · confusion · raw | you infer from content |
| `domain:` | `d:` | a domain/area name (partial ok) | script auto-detects from text |
| `product:` | `p:` `app:` | wishlist · loyalty · shared | script auto-detects (keyword) |
| `title:` | — | explicit title | you craft a concept title |
| `severity:` | `sev:` | low · medium · high | medium (for bug/potential-bug) |
| `status:` | — | open · watching · resolved · investigating | sensible default per type |
| `links:` | — | comma list of `[[...]]` targets | none |

**Two apps live in this vault: Loyalty and Wishlist.** Every note carries `product:` so shared
domains (Storefront Widget, Customer Profiles, Integrations, Analytics...) stay distinguishable.
The script auto-detects product from keywords and prints `[auto] product = ...`; pass `-p loyalty`
(or `wishlist`/`shared`) to override. If detection is unsure it leaves it blank — set it when you can.
When the user states the app, or the current repo makes it obvious (e.g. avada/wishlist), pass it explicitly.

Also accept obvious inline hints even without `key:`: a leading type word (e.g. "gotcha: ...",
"bug ...") or "domain X". When unsure whether a word is a param, treat it as body.

**Examples**
- `/joy-note refund trừ point sai trong sandbox` → infer everything (likely `potential-bug` / Points Economy).
- `/joy-note type:gotcha widget v4 giữ cache theme cũ` → type fixed, domain auto (Storefront Widget).
- `/joy-note d:Referral t:decision title:"Dùng metafield thay tag" vì tag bị throttled` → all explicit.
- `/joy-note sev:high klaviyo miss event khi guest checkout` → potential-bug high, domain auto (Integrations).

## What to do when invoked

0. **Parse params first.** Pull any `key:value` tokens from the args (see Parameters table). For every
   field the user supplied, use it verbatim and **skip the matching inference step below**. Only the
   missing fields get auto-detected/inferred.

1. **Get the content.**
   - If the user gave text after the command, use it.
   - If not, take the thing **just encountered/discussed** in this conversation (the bug, gotcha,
     realization) and summarize it. Briefly restate what you're about to save so they can correct.
   - If there's genuinely nothing, ask one short question: "Note gì, thuộc mảng nào?"

2. **Classify the `type`:**
   - `potential-bug` — a latent risk / "cần để ý" (NOT yet a confirmed bug). Set `--severity` (low/medium/high). Auto-shows on 🐛 Watchlist.
   - `bug` — a bug actually being investigated (has real symptoms). Goes to `Technical/Bugs/`.
   - `gotcha` — a trap / easy-to-forget detail.
   - `how-it-works` — explanation of a mechanism (default).
   - `decision` — a choice made + why.
   - `confusion` — an open question / "chưa hiểu". Goes to `Confusion/`.
   - `raw` — a fast dump to process later (goes into `<domain>/raw/` or `Inbox/`).

3. **Domain is auto-detected — you usually don't pass it.** If you omit `--domain` (or pass `--domain auto`),
   the script keyword-detects the domain from title+body and prints `[auto] domain = X`. It fuzzy-matches too,
   so partials like "point" → "Points Economy" work.
   - Prefer letting auto run; only pass an explicit `--domain "Name"` when you're confident and want to override
     a likely-wrong guess.
   - To preview detection without writing: `python ~/.claude/skills/joy-note/scripts/note.py detect "<text>"`.
   - If auto finds nothing, the note goes to `Inbox/` (process later) — that's fine, don't block on it.
   - Valid names: `python ~/.claude/skills/joy-note/scripts/note.py list`.
   - (`bug`→Technical/Bugs and `confusion`→Confusion ignore domain entirely.)

4. **Craft a concept-based title** — short, like a wiki page name ("Refund Revoke", "Tier sync throttling"),
   not a sentence.

5. **Write a faithful body in Vietnamese.** Only what was actually observed/decided — do not invent.
   Match the type's shape:
   - potential-bug / bug: *Triệu chứng / vì sao đáng ngại* · *Nơi liên quan* · *Cần kiểm tra / hướng xử lý*
   - gotcha: *Cạm bẫy* · *Vì sao* · *Cách đúng*
   - decision: *Bối cảnh* · *Quyết định* · *Lý do*
   - how-it-works: prose / bullets.

6. **Run the script** (body via stdin heredoc; omit `--domain` to auto-detect):
   ```bash
   python ~/.claude/skills/joy-note/scripts/note.py add \
     --title "Refund Revoke" --type how-it-works \
     --links "Points Economy" <<'EOF'
   Khi refund đơn, point/reward đã phát phải được thu hồi...
   EOF
   ```
   The script prints `[auto] domain = ...` so you can see where it landed (mention it in your confirmation).
   - potential-bug/bug → add `--severity high|medium|low`.
   - `--links "A,B"` adds `Liên quan: [[A]] [[B]]` (use real domain/note names for graph links).
   - If a note with that title already exists, the script **appends a dated section** (good for accumulating).
     Use `--new` only if it's truly a different note.

7. **Confirm** with the created/appended path (the script prints `CREATED -> ...` / `APPENDED -> ...`).
   Offer nothing further unless asked.

## Speed first
This is a mid-work capture tool. Default to **infer + act + report** in a single turn. Don't interrogate;
a slightly-wrong domain is fine (easy to move). Reserve questions for when saving to the wrong place
would actually mislead later.

## Examples
- `/joy-note` (right after debugging) → summarize the bug just found as a `potential-bug` in the relevant domain.
- "lưu cái gotcha này: widget v4 cache theme..." → `gotcha` in `Storefront Widget`.
- "note: tại sao mình chọn dùng metafield thay vì tag" → `decision` in the relevant domain.
- "chưa hiểu afterCharge lifecycle chạy thế nào" → `confusion`.

## Setup note
The vault path defaults to this repo's `personal/joy-vault/`. Override with `JOY_VAULT` env var if it moves.
New skill: run `personal/link-skills.ps1` once so `~/.claude/skills/joy-note` is registered.
