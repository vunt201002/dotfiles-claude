---
name: read-vi
description: Turn ONE English tech article into Vietnamese that actually reads like Vietnamese — classify translate-closely vs rewrite, draft it, then hand the draft to a second editor pass that never sees the English, then a meaning check; banned constructions, term rulings and anchor paragraphs accumulate in references/ so today's ugly sentence never comes back. Invoked explicitly, never fires on its own. NOT a study session (/learn), NOT a news digest (/tech-digest), NOT a summarizer for arbitrary pasted text. Use when asked "dịch bài này", "dịch sang tiếng Việt", "đọc bài này bằng tiếng Việt", "viết lại bài này bằng tiếng Việt", "translate this article to Vietnamese", "/read-vi", or pointing at an item from a /tech-digest run.
---

# /read-vi — one English tech article, into Vietnamese that reads like Vietnamese

The user reads English tech articles and asks for them in Vietnamese. Technical terms are
not the problem — those stay in English on purpose (`vi-conventions.md §A`). The prose is
the problem: Vietnamese words arranged in English sentence architecture, which makes the
article **harder** to read than the original.

## ⚠️ The diagnosis this whole skill is built around

**The failure is syntax anchoring, not vocabulary.** While a model looks at the English
source and writes Vietnamese, the source's sentence shape leaks through — it substitutes
words but keeps the English clause structure. Telling a translator "write more naturally"
does not fix this, because the source is still in front of it.

So the fix is not a better instruction. The fix is **a pass that structurally cannot see
the English**. Everything below exists to make that blindness real and to keep it real
through the correction rounds.

Three levers, in order of importance:

1. **A second pass blind to the source** (Step 4). The core of the design, and the reason
   this is a skill and not a prompt.
2. **An accumulating conventions file** (`references/vi-conventions.md`). Banned
   constructions with rewrites, plus term rulings. It grows every run (Step 8).
3. **Anchor examples** (`references/anchors.md`). Style transfers by example far better
   than by rule.

---

## HARD GATES

1. **Pass 2 never sees English.** Its brief carries file paths and closed-vocabulary
   tokens, nothing else — never article text, never a URL, never a "here's what the piece
   is about" preamble. Step 4 runs a gate that must pass **before** the agent is spawned,
   and the agent's report must carry the blindness receipt or the round is void.
2. **After pass 2 writes, the main session never edits a sentence of the body.** You are
   holding the English in context; every word you touch is a re-anchoring risk. You may
   only add the header block and copy the file to the vault. Any body change goes back
   through a pass-2 round. This is the gate most likely to be broken by accident.
3. **Pass 3 may flag meaning, never style.** Style is pass 2's call; re-litigating it from
   a seat that can see the English re-introduces exactly the anchoring the design removes.
   Pass 3 runs as an `Explore` agent so it has no `Edit`/`Write` at all.
4. **Pass 3 findings are written in Vietnamese as facts, never as quoted English.** This is
   what keeps blindness intact through the fix loop. Bare tokens are allowed (a number, a
   proper name, an identifier) — a token has no clause shape. A sentence does.
5. **Never invent content.** Nothing in the output may come from your own knowledge of the
   topic. If a passage is unreadable or the fetch failed, say so — do not fill the gap.
6. **Read-only web + write only under the vault** (`$READ_VI_DIR`, = `personal/read-vi/`)
   and the run's temp dir. Never touch repo code. Never write into
   `personal/tech-digest/` (that vault belongs to `/tech-digest`; read it, don't write it).
   Never commit — the user commits the vault when they choose.
7. **One article per run.** Two articles = two runs.

---

## Detect mode

Parse input after `/read-vi`:

| Input | Behavior |
|---|---|
| `<url>` | **Translate run** — fetch, then Steps 1-8 |
| *(pasted article body)* | **Translate run** on the pasted text |
| `digest <N>` / `bài <N>` | Resolve item #N from the newest `/tech-digest` file, then translate run |
| *(nothing)* | Ask which article. Do not guess from whatever is on screen. |
| `list` | List saved translations in `$READ_VI_DIR`, newest first, then stop |
| `anchor <file> [<đoạn>]` | Add a passage to `references/anchors.md`, then stop |
| `ban "<cấu trúc>" -> "<viết lại>"` | Add a row to `vi-conventions.md §B1`, then stop |
| `term <English> [= <Việt>]` | Add a ruling to `vi-conventions.md §A`, then stop |

> **Routing note:** `list`, `anchor`, `ban`, `term` are **management sub-commands** — they
> do NOT run the pipeline. Handle them in "Sub-commands" below and STOP.

---

## Step 0 — Setup

The vault lives **inside the dotfiles repo** (`personal/read-vi/`) so translations sync
across machines via git, same as `/tech-digest` and `/learn`. Resolve its path from this
skill's real location (following the `~/.claude/skills/read-vi` symlink back to the repo).
`$READ_VI_DIR` overrides it.

```bash
SKILL_REAL=""
for d in "$HOME/.claude/skills/read-vi" "$HOME/Project/github/dotfiles-claude/personal/skills/read-vi"; do
  [ -e "$d/references/brief-editor.md" ] && { SKILL_REAL="$(cd "$d" && pwd -P)"; break; }
done
[ -n "$SKILL_REAL" ] || { echo "FATAL: không tìm thấy references của read-vi. Chạy /sync-skills để symlink skill, hoặc set READ_VI_DIR."; exit 1; }
READ_VI_DIR="${READ_VI_DIR:-$(cd "$SKILL_REAL/../.." && pwd)/read-vi}"
mkdir -p "$READ_VI_DIR"
RUN=$(date +%Y%m%d-%H%M%S)
WORK="${TMPDIR:-/tmp}/read-vi-$RUN"
mkdir -p "$WORK/en" "$WORK/vi"
echo "READ_VI_DIR=$READ_VI_DIR"
echo "TODAY=$(date +%Y-%m-%d)"
echo "WORK=$WORK"
echo "EN_DIR=$WORK/en      (English lives here — pass 2 is never told this path exists)"
echo "VI_DIR=$WORK/vi      (Vietnamese lives here — the only dir pass 2 is pointed at)"
echo "TEMPLATE=$SKILL_REAL/references/brief-editor.md"
```

Remember `READ_VI_DIR`, `WORK`, `SKILL_REAL` and today's date from this output and restate
them in prose for later steps — bash variables do not persist between code blocks.

**The two directories are the point.** English never lands in `$WORK/vi`, and the pass-2
brief never names `$WORK/en`. That separation is what the Step 4 gate checks.

Now read both reference files before writing a single Vietnamese word:
`$SKILL_REAL/references/vi-conventions.md` and `$SKILL_REAL/references/anchors.md`.

---

## Step 1 — Get the article

| Input form | What to do |
|---|---|
| URL | `WebFetch` it. If it comes back paywalled, truncated, or as nav-chrome soup, **say so and ask for a paste** — do not translate a broken fetch and do not reconstruct the article from memory. |
| Pasted body | Use it as-is. |
| `digest <N>` | `ls -t "$READ_VI_DIR/../tech-digest"/20[0-9][0-9]-[0-9][0-9]-[0-9][0-9].md \| head -1`, read that file (**read-only**), find item `N.`, take its URL, then fetch as above. Keep the digest date + item number for the output header. |

Write the English into `$WORK/en/source.md`. Record: title, author, publish date, URL.

If the fetch produced fewer than a couple of real paragraphs, stop and report it. A thin
fetch translated confidently is worse than no translation.

---

## Step 2 — Classify: `DỊCH SÁT` or `VIẾT LẠI`

**Not every article should be translated.** A faithful translation of rambling English
prose is harder to read than the original. State the mode and one line of why, out loud,
before drafting.

**The decision question — ask exactly this:** *dịch sai một từ thì người đọc có **làm** sai
không?*

- **Có** → `DỊCH SÁT`. Exact wording carries meaning.
- **Không, chỉ mất ý** → `VIẾT LẠI`. Only the ideas matter, so write them in Vietnamese,
  **shorter than the original**.

| Article kind | Signals | Mode |
|---|---|---|
| Reference · spec · API doc · RFC · changelog · security advisory · licence | consulted, not read; params, exact names | `DỊCH SÁT` |
| Tutorial with steps | the reader types along | `DỊCH SÁT` |
| Postmortem · benchmark | the numbers are the content | `DỊCH SÁT` |
| Opinion · essay · "why I think X" | read once for ideas; the argument survives paraphrase | `VIẾT LẠI` |
| Narrative · conference recap · newsletter | as above, and the English usually rambles | `VIẾT LẠI` |
| Marketing-shaped release note | few ideas, many words | `VIẾT LẠI` |

### When the article is genuinely mixed

1. **Reference-shaped blocks are always `DỊCH SÁT` islands, whatever the document mode:**
   code, commands, config, param tables, exact numbers with units, direct quotes attributed
   to a named person, version numbers, licence/advisory text. Code and identifiers stay
   verbatim English — never translated, never tidied.
2. **Islands ≤ ~1/4 of the article** → document mode is the prose's mode, islands as above.
   State it like `VIẾT LẠI (3 đảo DỊCH SÁT: bảng param, 2 block code)`.
3. **Roughly half and half across whole sections** → declare `HỖN HỢP`. Do NOT average the
   two into one mode. Mark each section's mode in the output header, and wrap the close-
   translated sections in the draft with `<!-- DỊCH SÁT -->` markers so pass 2 knows where
   it may not shorten.
4. **Genuinely unsure** → default `DỊCH SÁT`. The costs are asymmetric: an over-faithful
   translation is annoying, a rewrite that quietly drops a parameter is wrong.

Also pick the **address register** now — `mình` for `VIẾT LẠI` (narrative voice), `bạn` for
`DỊCH SÁT` (there are steps to follow) — and hold it for the whole piece. Drifting register
is `vi-conventions.md §B2b`.

---

## Step 3 — Pass 1: draft

Write `$WORK/vi/draft.md`, per the chosen mode, with `vi-conventions.md` and `anchors.md`
loaded. Keep every heading, every code block, every list, in source order.

You have the English in front of you here, and that is fine — this pass is allowed to
anchor. Getting the *content* across is its only job; pass 2 fixes the shape. Do not
over-polish. Do not spend the round trying to be natural, because from this seat you
cannot reliably tell whether you are.

Two things this pass must still get right, because pass 2 cannot fix them blind:

- **Nothing dropped** (in `DỊCH SÁT`) — every section, number, param, name.
- **Structure preserved** — headings, code blocks, list boundaries, `<!-- DỊCH SÁT -->`
  markers for `HỖN HỢP`.

---

## Step 4 — Pass 2: the Vietnamese editor, blind to the source

This is the lever. The agent receives **only** the Vietnamese draft, so it cannot anchor on
English syntax — the English is not reachable from where it sits.

### 4a. Compose the brief from the shipped template — verbatim

Read `$SKILL_REAL/references/brief-editor.md`. Substitute **only** these five placeholders,
each restricted to a closed vocabulary so no slot can carry a clause:

| Placeholder | Allowed values |
|---|---|
| `{{ROUND}}` | an integer, 1-3 |
| `{{DRAFT_PATH}}` | the absolute path `$WORK/vi/draft.md` |
| `{{MODE}}` | exactly one of `DỊCH SÁT` · `VIẾT LẠI` · `HỖN HỢP` |
| `{{REGISTER}}` | exactly one of `bạn` · `mình` · `chúng ta` · `chúng tôi` |
| `{{FINDINGS_PATH}}` | a path under `$WORK/vi/`, or the literal `KHÔNG CÓ` |

Write the result to `$WORK/vi/brief-sent.md`. **Add nothing of your own** — not a greeting,
not a summary of the article, not "this one is about React Server Components". That
explanation is the leak. The template already says everything the editor needs.

### 4b. The blind gate — run this BEFORE spawning anything

```bash
TMPL="$SKILL_REAL/references/brief-editor.md"
BRIEF="$WORK/vi/brief-sent.md"
echo "=== A. lines that differ from the shipped template ==="
diff "$TMPL" "$BRIEF" || true
echo "=== B. url / source-path leak scan ==="
grep -nE 'https?://|/en/|source\.(md|txt|html)' "$BRIEF" || echo "OK — no url, no source path"
echo "=== C. english-clause scan (6+ ascii words in a row) ==="
grep -nE '([A-Za-z][A-Za-z0-9._-]*[[:space:]]+){5}[A-Za-z]' "$BRIEF" || echo "OK — no english clause"
echo "=== D. english must not exist under the vi dir ==="
ls -1 "$WORK/vi"
```

Read the output and decide:

1. **A** must show **exactly six changed line-pairs, and nothing else** — the five
   placeholders, with `{{ROUND}}` appearing twice (the heading and the report format).
   Every `<` line must contain `{{`. Any other differing line, and any added line at all,
   means you wrote prose of your own into the brief → **STOP**, recompose from the
   template.
2. **B** and **C** must both print `OK`. A hit is a leak → **STOP**, remove it.
3. **D** must list only Vietnamese working files. If anything English is sitting in
   `$WORK/vi`, move it to `$WORK/en` before spawning.

Do not spawn on a failed gate, and do not "fix it in the prompt" by asking the editor to
ignore something. The gate is the mechanism; a request is not.

### 4c. Spawn

Spawn a background `Agent` (`general-purpose`, named `editor-vi-r<N>` so rounds don't
collide) whose prompt is **the contents of `$WORK/vi/brief-sent.md`, pasted verbatim**.
Nothing before it, nothing after it.

Why a subagent and not an inline step: a subagent starts with zero memory of this
conversation. That is the only mechanism available here that makes blindness structural
rather than promised. Inline, the English is in your context, and "don't look at it" is
not something you can actually comply with.

### 4d. Verify the receipt

The report's **first line** must be exactly:

```
MÙ NGUỒN: OK — brief chỉ có đường dẫn, không có văn bản tiếng Anh, không fetch/search gì.
```

- Missing or altered → **the round is void.** Discard it, re-run 4a-4c. Do not accept the
  edit "since it looks fine anyway".
- `MÙ NGUỒN: VỠ — …` → blindness actually broke. Find the leak channel, fix it, re-run from
  a fresh copy of the draft. Report the leak to the user; it means the gate has a hole
  worth closing permanently.

Keep the report's scores, the mechanical before→after counts, the `Sửa thực chất` flag, and
its proposed new `§B1` rows. Step 6 and Step 8 need them.

---

## Step 5 — Pass 3: meaning check

Spawn an **`Explore`** agent (`meaning-vi-r<N>`). `Explore` has no `Edit`, no `Write`, no
`NotebookEdit` — report-only is enforced by its toolset, not by its instructions, the same
way `/impact-review` and `/qa-only` are report-only. A judge that can edit is a judge that
grades its own work next round.

Prompt:

```
So bản tiếng Việt với bài tiếng Anh gốc, CHỈ để tìm sai lệch NGHĨA. Report-only.

Bản tiếng Việt: <$WORK/vi/draft.md>
Bài gốc:        <$WORK/en/source.md>
Chế độ:         <DỊCH SÁT | VIẾT LẠI | HỖN HỢP>

Chỉ tính những thứ này là finding:
- Số, đơn vị, version, tên riêng, tên người, tên hàm/biến/file, cờ dòng lệnh: sai hoặc mất.
- Nội dung trong code block: khác một byte so với gốc.
- Một claim tác giả đưa ra mà bản dịch làm mất, làm ngược, hoặc đảo nhân quả.
- Hedge bị bỏ: gốc nói "có thể / thường / trong trường hợp này", bản dịch khẳng định chắc.
- Attribution sai: gán câu nói cho nhầm người, nhầm tổ chức.
- (chỉ khi chế độ là DỊCH SÁT) một đoạn/mục bị bỏ hẳn.

TUYỆT ĐỐI KHÔNG tính là finding: văn phong, cách chọn từ, độ dài câu, xưng hô, thứ tự
câu, "đọc nghe hơi lạ". Đó là việc của vòng editor. Nêu ra ở đây là kéo cú pháp tiếng
Anh quay lại bản dịch, tức là phá đúng cái thứ quy trình này dựng lên để tránh.
Ở chế độ VIẾT LẠI, NGẮN HƠN LÀ ĐÚNG — bản dịch ngắn hơn gốc không phải finding.

Viết finding BẰNG TIẾNG VIỆT, dưới dạng SỰ THẬT, tuyệt đối không trích câu tiếng Anh.
Token trần thì được (một con số, một tên riêng, một identifier) — token không mang khung
câu; một câu thì có. Định dạng mỗi dòng:

  [Blocker|High|Medium] đoạn <n>, câu <n> — <thiếu/sai cái gì, nói bằng tiếng Việt>

Ví dụ đúng:  [Blocker] đoạn 3, câu 2 — thiếu con số: bài nói tiết kiệm 40%, bản dịch chỉ nói "tiết kiệm nhiều"
Ví dụ đúng:  [High] đoạn 5 — đảo nhân quả: bài nói A gây ra B, bản dịch viết B gây ra A
Ví dụ SAI:   [High] đoạn 5 — bài gốc viết "the cache invalidation causes the stall", nên sửa thành...

Severity: Blocker = người đọc sẽ làm sai. High = hiểu sai ý tác giả. Medium = mất sắc thái.

Trả toàn bộ finding trong report — bạn không ghi file, không sửa file nào.
Không có finding nào thì trả đúng một dòng: KHÔNG CÓ FINDING.
```

You (the main session) write the returned findings verbatim into `$WORK/vi/findings-r<N>.md`.
Before writing, run the same leak scan on them — the findings file becomes pass-2 input, so
it is a leak channel too:

```bash
F="$WORK/vi/findings-r<N>.md"
echo "=== url scan ==="
grep -nE 'https?://' "$F" || echo "OK"
echo "=== english-clause scan (6+ ascii words in a row) ==="
grep -nE '([A-Za-z][A-Za-z0-9._-]*[[:space:]]+){5}[A-Za-z]' "$F" || echo "OK"
```

A hit means pass 3 quoted the source. Rewrite that finding as a Vietnamese fact yourself
before it goes near pass 2 — or drop it and ask pass 3 to restate it.

---

## Step 6 — The round loop, and when to stop

Mirrors the builder + judge convention in `personal/global-CLAUDE.md`: the judge never
edits, findings go back grounded, **cap 3 rounds**, and nothing is silently dropped.

```
r=1: Step 3 draft → Step 4 editor E1 → Step 5 meaning check M1
r=2: Step 4 editor E2 (fresh agent, gets the edited file + findings-r1) → Step 5 M2
r=3: same, last round
```

**Close when both are true:**

1. The latest meaning check returns no `Blocker`/`High` findings.
2. The latest editor scored the text it *received* ≥9 on all five dimensions of
   `vi-conventions.md §C2`, and reported `Sửa thực chất: KHÔNG`.

Condition 2 is the honest one, and it is why each round spawns a **fresh** editor: round
N's editor grades round N-1's output. Nobody ever grades their own writing. An editor that
reads the text, scores it ≥9 everywhere, and finds nothing substantive to change **is** the
stopping signal — it is a blind Vietnamese reader who had no complaints.

**Cap: 3 rounds.** Out of rounds and not closed → stop. Report which dimensions are still
short and by how much, and which findings are unresolved. Do not run a fourth round.

**The only exit with a finding still open:** the finding genuinely cannot be fixed within
the task's constraints (a source sentence that is ambiguous in the original, a term with no
Vietnamese equivalent that also cannot stay English in that position). **Pass 3 decides
that, not the editor and not you** — the editor is the one being graded. The constraint has
to be named concretely, and the finding still travels up into the final report. Never
silently drop one.

Everything is `HỖN HỢP`-aware: an unresolved finding inside a `DỊCH SÁT` island is a
Blocker; the same shape inside `VIẾT LẠI` prose may be a Medium.

---

## Step 7 — Save

Copy the final Vietnamese file into the vault and prepend the header block. **Copy it —
do not retype it, do not "improve" a sentence on the way in** (HARD GATE 2).

```bash
READ_VI_DIR="${READ_VI_DIR:?run Step 0 first}"
TODAY=$(date +%Y-%m-%d)
RAW="${TITLE_RAW:-untitled}"
SLUG=$(printf '%s' "$RAW" | tr '[:upper:]' '[:lower:]' | tr -s ' \t' '-' | tr -cd 'a-z0-9.-' | cut -c1-60)
SLUG="${SLUG:-untitled}"
OUT="$READ_VI_DIR/$TODAY-$SLUG-vi.md"
[ -e "$OUT" ] && OUT="$READ_VI_DIR/$TODAY-$SLUG-$(date +%H%M)-vi.md"
echo "OUT=$OUT"
```

Compute the slug in bash, never in the prompt layer — a title from a fetched page must not
be able to inject shell metacharacters. Same allowlist as `/my-worklog`.

Header block (extends the shape already used by the one hand-made translation in
`personal/tech-digest/translations/`, plus the pass receipts):

```markdown
# <Title gốc> — <tác giả> (<chế độ> tiếng Việt)

> Nguồn: <url> (đăng <ngày nếu biết>)
> Chế độ: <DỊCH SÁT | VIẾT LẠI | HỖN HỢP> — <một dòng vì sao chọn chế độ này>
> Xưng hô: <bạn | mình>
> Pass 2 (editor mù nguồn): <k> vòng · điểm vòng cuối: nhịp câu _ · từ ngữ _ · xưng hô _ · mạch đoạn _ · thuật ngữ _
> Pass 3 (soát nghĩa): <n> finding · đã sửa <m> · còn lại: <liệt kê, hoặc "không còn">
> <Lưu từ digest <ngày>, bài số <N>.  — chỉ khi vào bằng `digest <N>`>
```

Then print a short close to the user:

```
READ-VI — <title>
────────────────────────────────
Chế độ:  <mode> — <vì sao>
Vòng:    <k>/3 · đóng vì <mọi dimension ≥9 và editor không sửa thực chất | hết cap>
Điểm:    nhịp câu _ · từ ngữ _ · xưng hô _ · mạch đoạn _ · thuật ngữ _
Nghĩa:   <n> finding · còn lại <m> <(liệt kê nếu >0)>
Lưu:     personal/read-vi/<file>
────────────────────────────────
Ghi vào conventions: <k> cấu trúc mới · <k> ruling thuật ngữ  (hoặc: không có gì mới)
Câu nào đọc gợn thì chỉ vào, anh ghi thẳng vào bảng cấm.
```

---

## Step 8 — Grow the conventions file (mandatory, not optional)

**This is a numbered step, not an aspiration.** The whole value of `vi-conventions.md` is
that today's ugly sentence never comes back. Do it in the same turn; do not save it for
later.

1. Take the editor rounds' `Cấu trúc mới đề xuất thêm vào §B1` lines. For each one **not
   already in the table**, append a row to `vi-conventions.md §B1`: the anchored form, the
   rewrite, and the English frame that caused it if you can name it. Merge near-duplicates
   into the existing row instead of adding a look-alike.
2. Any term you had to rule on this run that `§A` does not cover → append to `§A1`
   (stays English), `§A2` (accepted Vietnamese) or `§A3` (never translate it that way).
3. Anything **the user** called out as reading badly, this run or in the follow-up → a
   `§B1` row using the user's own sentence as column 1. User findings outrank everything;
   they are the ground truth the rest of the file is approximating.
4. If the user marked a passage as reading well → append an anchor per `anchors.md`, with
   its "vì sao nó thuận" block.
5. Nothing new this run → say so explicitly ("không có cấu trúc mới"), so it reads as a
   decision rather than a skipped step.

You (the main session) do the appending. The editor agents propose in their reports and do
not write — same reason `/fix-bugs-parallel` has the coordinator apply ratchets.

---

## Sub-commands (no pipeline run)

### `list`

```bash
SKILL_REAL=""
for d in "$HOME/.claude/skills/read-vi" "$HOME/Project/github/dotfiles-claude/personal/skills/read-vi"; do
  [ -e "$d/references/brief-editor.md" ] && { SKILL_REAL="$(cd "$d" && pwd -P)"; break; }
done
[ -n "$SKILL_REAL" ] || { echo "FATAL: không tìm thấy references của read-vi. Chạy /sync-skills."; exit 1; }
READ_VI_DIR="${READ_VI_DIR:-$(cd "$SKILL_REAL/../.." && pwd)/read-vi}"
ls -t "$READ_VI_DIR"/*.md 2>/dev/null || echo "(chưa dịch bài nào)"
```

Show date · title · mode for each, newest first.

### `anchor <file> [<đoạn>]`

Read the passage the user pointed at, append a new `## A<n>` entry to
`references/anchors.md` in that file's format, and **write the "vì sao nó thuận" block** —
an anchor without it is just a sample and teaches nothing. If A1/A2 are still labelled
`(TẠM)` and the user now has real anchors, offer to drop the provisional pair.

### `ban "<cấu trúc>" -> "<viết lại>"`

Append a row to `vi-conventions.md §B1`. Add the English frame if you can name it. Refuse a
vague entry: a row must be a construction a competent Vietnamese engineer would notice as
off, with a concrete rewrite. "Nghe hơi Tây" is not a row.

### `term <English> [= <Việt>]`

Append a ruling to `§A1`, `§A2` or `§A3`. Default for technical vocabulary is **stays
English** — only add to `§A2` when Vietnamese devs genuinely say the Vietnamese word, not
when a dictionary permits it.

---

## Important rules

- **Blindness is structural, not requested.** The Step 4b gate runs before the spawn, the
  brief is a shipped template you may not extend, and the receipt is checked afterwards.
  Three layers, because a polite "please don't look at the English" is the exact thing that
  degrades into being ignored.
- **You never restyle after pass 2.** Header block and file copy only.
- **Meaning findings travel as Vietnamese facts.** That is what keeps the fix loop blind.
- **Classify out loud.** Say which mode and why, every run, before drafting.
- **`VIẾT LẠI` should come out shorter.** If it did not, the rewrite did not happen.
- **Technical terms stay English** (`§A1`), same as `/learn`. Do not ask per-term.
- **No fabrication.** Failed fetch → say so. Unreadable passage → flag it. Never fill from
  your own knowledge of the topic.
- **The conventions file grows every run** (Step 8), or you say explicitly that it did not.
- **Read-only web + write only `personal/read-vi/` and the temp run dir.** Never write into
  `personal/tech-digest/`. No repo edits, no commits.
- **Integration with `/tech-digest`, from this side only.** `digest <N>` reads the newest
  digest file to resolve item N. `/tech-digest` itself is not modified and does not know
  about this skill; the user can chain them by hand (`/tech-digest` → pick a number →
  `/read-vi digest 7`). If it is ever worth having the digest footer suggest it, that is a
  change to `/tech-digest`, made deliberately, not a side effect of this skill.

---

## Why this design

- **The blind pass is the skill.** Everything else could be a prompt. "Write natural
  Vietnamese" fails not because the instruction is unclear but because the source is still
  on screen, and a model substituting words while reading English clause shapes will
  produce English clause shapes. Removing the source from the seat that judges naturalness
  is the only fix that survives contact with a long article.
- **Blindness is enforced at spawn time, not at read time.** A subagent's context is
  whatever you put in the prompt — so the gate belongs on the prompt, before it is sent.
  Hence: a shipped brief template, five closed-vocabulary slots, a `diff` against the
  template, a URL/English-clause scan, and a receipt line verified on return.
- **The fix loop is where blindness usually dies.** Pass 3 sees both texts, so if its
  findings quoted English, round 2's editor would read English and the whole design would
  collapse on the second lap. Findings-as-Vietnamese-facts is not politeness, it is the
  load-bearing part.
- **Classify first, because faithful is not always better.** A close translation of a
  rambling essay is harder to read than the English. A rewrite of an API reference is
  dangerous. One rule ("would a wrong word make the reader *do* the wrong thing") separates
  them, and the tie-break defaults to `DỊCH SÁT` because the costs are asymmetric.
- **A fresh editor each round is what makes the score mean anything.** Self-assessment is
  worthless — `personal/global-CLAUDE.md` says so about UI work and it is just as true
  here. Round N's editor grading round N-1's text is genuine cross-agent judging, and "a
  blind Vietnamese reader had nothing substantive to change" is a much better stop
  condition than any number an author gives itself.
- **Pass 3 is an `Explore` agent on purpose.** Report-only enforced by toolset beats
  report-only enforced by instruction, and it matches how `/impact-review`, `/tech-review`
  and `/qa-only` already work in this setup.
- **The conventions file is the compounding part.** The blind pass fixes today's article;
  the file is what makes next month's article start better. That is why Step 8 is numbered
  and why the editors propose while the main session writes — one writer, no near-duplicate
  rows, and the table stays worth reading.
- **Anchors exist because rules have a ceiling.** A banned-construction table catches what
  already has a name. It cannot teach rhythm. Two or three paragraphs that read well do
  that in one shot, which is why the file ships with provisional starters and a step for
  replacing them with real ones.
