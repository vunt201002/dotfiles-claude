---
name: slack-thread
description: Đọc một Slack thread (kèm ảnh/log đính kèm) ngay trong terminal, không mở browser — trả về tóm tắt tiếng Việt + transcript đầy đủ. Chỉ đọc, không bao giờ gửi/reply vào Slack. NOT /read-vi (dịch bài tiếng Anh), NOT /tech-digest (tin tức), NOT /notion-task-personal (task board). Dùng khi được nhắc "đọc thread này", "đọc slack thread", "thread này nói gì", "context vụ này trong slack", "/slack-thread", hoặc khi user chỉ dán một link `<workspace>.slack.com/archives/...`.
---

# /slack-thread — đọc một Slack thread mà không rời terminal

User đang debug, có link Slack chứa context của bug. Mở browser để đọc là đứt mạch làm
việc. Skill này lấy nguyên thread qua **Slack Web API**, tải kèm file đính kèm về máy, rồi
đưa thẳng vào session: **tóm tắt tiếng Việt + transcript đầy đủ**.

**Chia việc — đây là điểm mấu chốt của thiết kế.** Script làm mọi thứ có đáp án đúng-sai rõ
ràng: parse URL, load env, gọi API, phân trang, retry, resolve user ID thành tên, render
mrkdwn, tải file. Agent làm mọi thứ cần phán đoán: **mở file ảnh/log ra xem thật** và
**viết tóm tắt tiếng Việt**. Script không bao giờ tóm tắt; agent không bao giờ tự tính lại
timestamp hay tự đoán tên người từ user ID.

---

## HARD GATES

1. **Không browser, không fallback sang browser.** Script fail thì báo lỗi, hết. Không mở
   `/my-chrome`, không `WebFetch` link Slack (Slack chặn, và có fetch được cũng là trang
   login).
2. **Read-only tuyệt đối.** Skill này chỉ đọc. Không gửi tin nhắn, không reply, không thả
   reaction, không join channel — kể cả khi user bảo "trả lời giúp anh". Token có
   `chat:write` nhưng skill này không dùng, và không được dùng.
3. **Không bịa.** Mọi câu trong tóm tắt phải truy được về một message có thật trong
   transcript. Thread không đủ dữ kiện cho một mục thì **bỏ hẳn mục đó**, không viết
   "chưa rõ" cho đủ khung.
4. **Không ghi ra file.** Output đi thẳng vào session. Script tự cache file đính kèm vào
   `~/.cache/slack-thread/` — đó là cache, không phải sản phẩm bàn giao.
5. **Không đọc thì đừng đoán.** Script trả về đường dẫn file ảnh mà agent không mở ra xem
   thì coi như chưa làm xong Bước 3 — ảnh screenshot thường mới là chỗ chứa thông tin thật.

---

## Cách chạy

```bash
python3 ~/.claude/skills/slack-thread/scripts/slack-thread.py <url> [<url> ...] \
  [--no-files] [--max-file-mb N] [--out-dir DIR] [--json]
```

| Flag | Ý nghĩa |
|---|---|
| *(mặc định)* | In markdown: header + transcript, có tải file đính kèm |
| `--no-files` | Không tải file (thread dài toàn ảnh, hoặc user chỉ cần chữ) |
| `--max-file-mb N` | Bỏ qua file lớn hơn N MB (mặc định 20) |
| `--out-dir DIR` | Đổi chỗ lưu file tải về |
| `--json` | Trả JSON có cấu trúc thay vì markdown |

Nhiều URL thì chạy tuần tự trong một lần gọi. URL nào hỏng thì báo lỗi URL đó và vẫn xử lý
tiếp các URL còn lại; exit code khác 0 nếu có bất kỳ URL nào fail.

**Về `.env.agent`:** script tự đi ngược từ thư mục hiện tại lên để tìm `.env.agent` (giống
`/notion-task-personal`). File này chỉ có trong các project dưới `~/Project/gitlab/`
(joy, joy-2, joy-3, wishlist, wishlist-2, wishlist-3) — **không có** trong repo dotfiles.
Nếu script báo không tìm thấy `SLACK_TOKEN`, chạy lại với `cwd` là một project có
`.env.agent`. (Hoặc đặt token một lần vào `~/.config/slack/token` rồi khỏi lo cwd.)

---

## Quy trình

### Bước 1 — chạy script

Lấy URL từ prompt của user. User chỉ dán link trần cũng tính là gọi skill này.

Chạy script với URL đó. Không sửa URL, không tự thêm `thread_ts` — script tự xử lý cả
trường hợp link trỏ vào một reply giữa thread (nó tự tìm ngược về message gốc).

### Bước 2 — script fail thì DỪNG

Exit code khác 0 → **báo nguyên văn lỗi cho user**, không thêm suy đoán. Không chạy lại với
URL đoán mò, không đổi channel ID, không chuyển sang browser.

Lỗi hay gặp và câu trả lời đúng:

| Script báo | Nói lại với user |
|---|---|
| `avada_bot is not a member of #X` | Bot chưa được mời vào channel đó. Vào channel `#X` trong Slack gõ `/invite @avada_bot` rồi chạy lại. Bot **không tự join được** — app không có scope `channels:join`. |
| `Channel ... is not visible to this token` | Channel private mà bot chưa từng được mời, hoặc link thuộc workspace khác với token. |
| `multi-person group DM` | Token thiếu scope `mpim:history` → group DM nhiều người **không đọc được**, đây là trần cứng. Nhờ người kia forward thread vào một channel, hoặc paste tay. |
| `SLACK_TOKEN not found` | Chạy lại với cwd là project có `.env.agent` (xem mục trên). |
| `token is missing the ... scope` | Thiếu scope, phải admin workspace thêm vào app `avada_bot`. Không phải thứ tự sửa được. |

Đừng bọc lỗi trong giọng lạc quan. "Không đọc được vì bot chưa ở trong channel" là câu trả
lời đúng và hữu ích; "để em thử cách khác" thì không.

### Bước 3 — mở TỪNG file tải về

Script in ra đường dẫn local của mỗi file: `↳ file: tên (mime, size) → /Users/.../tên.png`.

- **Ảnh** (`image/*`): mở bằng **Read tool** để thật sự **nhìn thấy** nó. Screenshot bug,
  ảnh chụp màn hình lỗi, ảnh design — phần lớn thông tin thật nằm ở đây chứ không nằm ở
  chữ. Đọc cả text hiện trong ảnh (message lỗi, số liệu, tên field).
- **Text / log / JSON / CSV**: Read nội dung.
- **File script bỏ qua** (quá lớn, hoặc `--no-files`): nói rõ là bỏ qua và vì sao. Không
  đoán nội dung.

Mỗi file rút ra **một quan sát ngắn, cụ thể**, gắn ngay vào dòng file đó trong transcript:

```
↳ file: error.png (image/png, 245.3 KB) → /Users/.../error.png
   → Console Chrome, đỏ: "Cannot read properties of undefined (reading 'variants')" tại joy-widget.js:412
```

Quan sát phải là thứ nhìn thấy được. "Ảnh chụp màn hình lỗi" là vô nghĩa — nói lỗi gì.

### Bước 4 — viết câu trả lời tiếng Việt

Đúng thứ tự này, không thêm bớt phần:

```
## <#channel> — <N> tin nhắn, <khoảng thời gian>
<permalink>

**Tóm tắt**
- **Vấn đề:** ...
- **Quyết định:** ...
- **Còn treo:** ...

---

<transcript đầy đủ, kèm quan sát file inline>
```

Về block **Tóm tắt**:

- **Vấn đề** — chuyện gì đang hỏng / đang bàn.
- **Quyết định** — chốt được gì, ai chốt.
- **Còn treo** — câu hỏi chưa ai trả lời, việc chưa ai nhận.

**Thread không có mục nào thì bỏ hẳn dòng đó.** Thread chỉ là một câu hỏi chưa ai trả lời
thì chỉ có "Vấn đề" và "Còn treo" — bịa ra một "Quyết định" là làm hỏng chính thứ user cần.
Thread quá ngắn để tóm tắt (1-2 message) thì bỏ luôn cả block, in transcript là đủ; script
cũng đã tự đánh dấu `> Standalone message — no replies`.

Giữ **transcript đầy đủ** phía dưới, không cắt bớt. User đọc tóm tắt để nắm nhanh, đọc
transcript để biết chính xác ai nói gì. Cắt transcript là bỏ mất lý do skill này tồn tại.

Thuật ngữ kỹ thuật, tên người, tên channel, tên biến, message lỗi: **giữ nguyên**, không
dịch.

---

## Token này thấy được những gì

Điều cần nói thẳng với user khi có gì đó không đọc được:

`SLACK_TOKEN` trong `.env.agent` là **bot token dùng chung của `avada_bot`** (workspace
Avada Group), **không phải quyền Slack cá nhân của user**. Hệ quả:

- Skill chỉ đọc được **những channel `avada_bot` đã được mời vào**. User đọc được một
  channel trong Slack của họ không có nghĩa skill đọc được.
- **Public channel, private channel, DM với bot**: đọc được (có `channels:history`,
  `groups:history`, `im:history`).
- **Group DM nhiều người (mpim)**: **không** đọc được — thiếu `mpim:history`.
- Bot **không tự join channel được** (thiếu `channels:join`). Cách duy nhất là người trong
  channel gõ `/invite @avada_bot`.

Đây là trần cứng của token, không phải bug để đi sửa vòng vèo.

---

## Script làm sẵn những gì (đừng làm lại)

Để khỏi mất công tự xử lý:

- **Parse permalink**, kể cả `?thread_ts=...&cid=...`, và cả link trỏ vào reply giữa thread
  (tự tìm ngược về root, đúng một lần, không lặp vô hạn).
- **Phân trang** `conversations.replies` đến hết thread (đã test với thread 105 message).
- **Retry khi bị rate limit**, tôn trọng header `Retry-After`, tối đa 3 lần rồi fail to.
- **Resolve user ID → tên**, cache ở `~/.cache/slack-thread/users-<team>.json` nên lần sau
  gần như không tốn API call. Resolve fail thì in ID gốc — không bịa tên.
- **Render mrkdwn**: `<@U123>` → `@Tên`, `<#C1|dev>` → `#dev`, `<url|text>` →
  `text (url)`, unescape `&amp; &lt; &gt;`. Giữ nguyên `*bold*`, `_italic_`, code fence.
- **Reaction** in dạng `:thumbsup: ×3` — dùng đúng tên emoji của Slack, kể cả custom emoji
  của workspace. Đừng đổi sang ký tự emoji: map thiếu sẽ gán nhầm tên custom emoji.
- **Tải file đính kèm** kèm header `Authorization` (thiếu header thì Slack trả trang HTML
  login chứ không trả file — script phát hiện và báo, không lưu rác).
- **Timestamp** theo timezone máy; thread kéo dài qua nhiều ngày thì tự thêm ngày vào mỗi
  dòng.
