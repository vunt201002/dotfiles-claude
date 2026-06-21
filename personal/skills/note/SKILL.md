---
name: note
description: Quickly capture a PERSONAL LEARNING note into the Brain vault (personal/brain-vault) — something you learned, a concept, a TIL, a gotcha, an open question, a code snippet, or a resource link. NOT for Joy work knowledge (use /joy-note for that) and NOT a study tracker (use /learn for roadmaps/progress). Files the note in the right topic folder (Frontend, Backend, System Design, DSA, Databases, DevOps, Security, AI & LLM, CS Fundamentals, Career, Tools) with correct frontmatter so the vault's _MOC and Questions index auto-collect it. Use when asked to "note this", "save what I learned", "ghi lại cái vừa học", "TIL ...", "/note", or right after learning something worth keeping.
---

# /note — quick capture into the personal Brain (learning) vault

Capture a learning into `personal/brain-vault/` in one step. A Python script writes the
frontmatter and files the note in the right topic folder; you classify, title, and write
a faithful body. This vault is for PERSONAL LEARNING, separate from Joy work knowledge.

- Joy work knowledge → **/joy-note** (different vault). Don't put work notes here.
- Studying a topic with a roadmap / progress tracking → **/learn**. This is for atomic capture.

Script: `python ~/.claude/skills/note/scripts/note.py`

## Parameters (all optional — provided wins, else auto)

| Param | Aliases | Values | If omitted |
|-------|---------|--------|------------|
| `type:` | `t:` | concept · til · gotcha · question · snippet · resource · raw | you infer (default concept) |
| `topic:` | `area:` | a topic name (partial ok) | script auto-detects from text |
| `title:` | — | explicit title | you craft a concept title |
| `status:` | — | open · answered (for question) | open (for question) |
| `links:` | — | comma list of `[[...]]` targets | none |

Topics: Frontend, Backend, System Design, DSA, Databases, DevOps & Infra, Security,
AI & LLM, CS Fundamentals, Career & Soft Skills, Tools. Unmatched → `Inbox/`.

## When invoked
1. **Parse params** from the args; use what's given, infer the rest.
2. **Get content** — from the args, or summarize the thing just learned/discussed; if nothing, ask "Học được gì, mảng nào?".
3. **Classify type:** `til` (quick "today I learned"), `concept` (an explanation, default), `gotcha` (a trap), `question` (open question → auto-listed in ❓ Questions), `snippet` (code), `resource` (a link to read), `raw` (dump for later).
4. **Topic auto-detects** — omit `--topic` and the script keyword-detects + prints `[auto] topic = ...`; pass `--topic` only to override. Preview: `note.py detect "<text>"`.
5. **Title** = concise concept name. **Body** in Vietnamese (keep terms/code in English), faithful to what was actually learned — don't invent; for new/version-specific tech prefer linking the real source (like /learn does).
6. **Run** (body via stdin heredoc; omit topic to auto):
   ```bash
   python ~/.claude/skills/note/scripts/note.py add \
     --title "Debounce vs throttle" --type concept --links "Frontend" <<'EOF'
   Debounce: gom nhiều lần gọi thành 1 sau khoảng lặng...
   EOF
   ```
   Existing title → appends a dated section (use `--new` to force a separate note).
7. **Confirm** with the `CREATED -> ...` path the script prints.

## Speed first
Mid-learning capture — default to infer + act + report in one turn. A slightly-wrong topic is fine (easy to move). `question` notes surface on ❓ Questions until you set `status: answered`.

## Setup note
Vault defaults to `personal/brain-vault/` (override with `BRAIN_VAULT`). New skill: run
`personal/link-skills.ps1` once so `~/.claude/skills/note` is registered.
