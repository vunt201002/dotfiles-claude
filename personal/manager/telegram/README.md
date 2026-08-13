# Telegram bot — kênh điều khiển manager từ điện thoại

Transport thuần giữa Telegram và manager agent. Bot **không** biết task là gì,
không quyết định gì. Nó chuyển tin hai chiều và thi hành luật bảo mật ở §10.1
của [plan](../../docs/manager-layer-plan-2026-08-12.md).

## 1. Tạo bot với @BotFather

1. Mở Telegram, tìm **@BotFather**, gõ `/newbot`.
2. Đặt tên hiển thị (gì cũng được) rồi đặt username kết thúc bằng `bot`
   (ví dụ `vunt_manager_bot`).
3. BotFather trả về một dòng token dạng `8123456789:AAH...`. **Đây là chìa khoá
   vào máy này.** Ai cầm được nó là gõ được lệnh vào agent chạy bypass-permissions
   trên ~8 repo. Không dán vào chat, không commit, không đọc qua điện thoại người khác.
4. Vẫn trong BotFather: `/setjoingroups` → **Disable**, và `/setprivacy` → **Enable**.
   Bot này chỉ nói chuyện 1-1, không có lý do gì để vào group.

Lỡ lộ token thì `/revoke` trong BotFather, lấy token mới, sửa `.env`, chạy lại bot.

## 2. Lấy chat-id

Nhắn một câu bất kỳ cho bot vừa tạo, rồi chạy (thay `<TOKEN>`):

```bash
curl -s "https://api.telegram.org/bot<TOKEN>/getUpdates" | grep -o '"chat":{"id":[-0-9]*'
```

Số sau `"id":` là chat-id của bạn. Không thấy gì thì nhắn lại cho bot rồi gọi lại.

## 3. Env

Đặt trong `.env` ở gốc repo (bun tự nạp, đã nằm trong `.gitignore`):

```
TELEGRAM_BOT_TOKEN=8123456789:AAH...
TELEGRAM_ALLOWED_CHAT_IDS=424242
```

- `TELEGRAM_ALLOWED_CHAT_IDS` — danh sách chat-id, phân tách bằng dấu phẩy.
  **Rỗng nghĩa là chặn hết và bot từ chối khởi động**, không bao giờ có nghĩa
  "cho tất cả". Chat-id **đầu tiên** là chat nhận mọi tin đẩy về (report,
  question, approval); các chat-id còn lại vẫn gõ lệnh được.
- Chat-id lạ nhắn tới: bot **im lặng với người gửi** và ghi một dòng vào
  `~/.gstack/security/telegram-denied.jsonl` — chỉ chat-id + timestamp + lý do,
  **không ghi nội dung tin**.

Biến tuỳ chọn (bình thường không cần đụng):

| Biến | Mặc định | Để làm gì |
|---|---|---|
| `GSTACK_HOME` | `~/.gstack` | gốc của file port/token manager và state của bot |
| `TELEGRAM_API_BASE` | `https://api.telegram.org` | trỏ sang server Bot API khác — dùng cho test |
| `TELEGRAM_RATE_LIMIT` | `20` | số tin mỗi chat được xử lý trong một cửa sổ |
| `TELEGRAM_RATE_LIMIT_WINDOW_MS` | `60000` | độ dài cửa sổ rate limit |
| `TELEGRAM_QUESTION_BATCH_MS` | `3000` | gom câu hỏi trong bấy nhiêu ms rồi gửi một lô |
| `TELEGRAM_SEND_GAP_MS` | `1100` | giãn cách giữa hai tin, tránh 429 của Telegram |
| `MANAGER_MAX_RECONNECT_ATTEMPTS` | `20` | thử lại `/events` bấy nhiêu lần rồi dừng và báo |

## 4. Chạy

```bash
bun personal/manager/telegram/bot.ts            # chạy bot
bun personal/manager/telegram/bot.ts --check    # kiểm tra cấu hình rồi thoát
```

`--check` in ra username bot, số chat-id trong allowlist, thư mục state và
manager có đang chạy không. **Không bao giờ in token** — cả token bot lẫn token
manager đều bị lọc khỏi mọi dòng log, mọi thông báo lỗi, và mọi tin gửi lên Telegram.

Bot cần manager đang chạy để làm được việc, nhưng **không cần** manager để khởi
động: nó lên trước cũng được, thấy manager thì nối vào.

## 5. Lệnh (command surface v1)

| Lệnh | Làm gì |
|---|---|
| `/status` | liệt kê task đang có |
| `/run <project> <issue>` | giao một việc |
| `/report <project>` | báo cáo theo project |
| `/stop <task-id>` | dừng một task |
| `/stopall` | **kill switch** — dừng tất cả |
| `/cost` | chi phí hôm nay (`/cost all` cho tổng) |
| text tự do | hỏi manager, hoặc trả lời câu treo dạng `1: nội dung` |

`/stopall` không bao giờ bị rate limit chặn và không xếp hàng sau lệnh chậm khác.
Nó cũng là lệnh duy nhất chấp nhận chữ thừa phía sau — kill switch không được
từ chối nổ vì một ký tự lạc.

Các lệnh còn lại **đếm tham số chặt**: `/run kivora t 105` bị từ chối chứ không
âm thầm chạy issue `t`. Gõ nhầm thì bot bảo gõ lại, không tự đoán.

Trả lời câu hỏi **phải đánh số** (`1: ...`, `2. ...`, `3) ...`) đúng như tin hỏi
hướng dẫn. Text không đánh số luôn đi vào brainstorm — chọn vậy để không bao giờ
có chuyện một câu hỏi vu vơ âm thầm biến thành câu trả lời cho task đang treo.

## 6. Bảo mật — những chỗ cố ý làm chặt

- **Allowlist hai lớp.** Cả chat-id lẫn người gửi đều phải nằm trong allowlist.
  Trong chat 1-1 hai số này trùng nhau; trong group thì người lạ không bấm được
  nút duyệt của một chat vốn được tin.
- **Việc không đảo ngược được luôn phải bấm nút.** Không có trust mode, không có
  cờ bỏ qua. Manager gửi `approval`, bot hiện `[Gật] [Lắc] [Xem diff]`, chờ bấm.
  Bấm hai lần chỉ tính một lần.
- **Nội dung chuyển tiếp là dữ liệu, không phải mệnh lệnh.** Tin `forward` hoặc
  tin đi qua bot khác **không được parse như lệnh** (một tin forward chứa
  `/stopall` không dừng gì cả) và **không** route vào câu trả lời của task. Nó
  xuống manager trong khối `[UNTRUSTED-EXTERNAL-CONTENT ...]`, datamark từng
  dòng, marker bên trong bị escape để không thoát khối được.
- **Tên project / issue / task-id** phải khớp `[A-Za-z0-9._/-]{1,64}` và không
  chứa `..` trước khi ghép vào đường dẫn hay payload của manager.
- **Token không bao giờ ra ngoài.** Mọi tin gửi lên Telegram đi qua bộ lọc
  redact; lỗi từ Telegram chỉ mang tên method, không mang URL.

## 7. Khi có sự cố

- **Manager sập / chưa chạy** — lệnh vẫn trả lời, kèm lý do rõ ràng. Luồng
  `/events` thử lại theo backoff luỹ thừa (trần 60s), báo cho bạn một lần khi
  mất kết nối và một lần khi nối lại. Hết `MANAGER_MAX_RECONNECT_ATTEMPTS` lần
  thì **ngừng thử lại** và nói rõ: gõ `/status` để nối lại.
- **Telegram sập** — tin nằm trong `~/.gstack/manager/telegram/outbox.json`, gửi
  lại khi mạng lên. Hàng đợi đầy thì chỉ bỏ tin loại `report`/`notice`;
  `approval` và `question` không bao giờ bị bỏ, vì mất chúng là treo task.
- **Bot restart** — `updates.json` giữ `update_id` đã nhận, nên không xử lý lại
  lệnh cũ; `outbox.json` giữ tin chưa gửi, nên không mất tin. Update được đánh
  dấu **trước** khi chạy: chết giữa chừng thì mất một lệnh (gõ lại được) chứ
  không chạy `/run` hai lần.

**Khe hở còn lại, nói thẳng:** giữa lúc Telegram trả 200 và lúc bot ghi đĩa có
một khoảng ~1ms. Bot chết đúng khoảnh khắc đó thì tin ấy được gửi lại một lần
sau khi bật lên. Không có API idempotency phía Telegram để đóng hẳn khe này.

## 8. Test

```bash
bun test personal/manager/telegram/
```

Không gọi Telegram thật và không cần manager thật: integration test dựng cả
Bot API giả lẫn manager giả bằng `Bun.serve`.

## 9. File

| File | Việc |
|---|---|
| `bot.ts` | CLI + wiring: poll, dispatch, outbox flush, luồng sự kiện |
| `config.ts` | env, đường dẫn, fail-closed |
| `telegram-api.ts` | Bot API qua `fetch`, không dependency |
| `manager-client.ts` | HTTP + SSE tới `127.0.0.1`, đọc port/token mỗi lần gọi |
| `commands.ts` | parse lệnh (thuần) |
| `render.ts` | 4 loại tin → text cho điện thoại (thuần) |
| `security.ts` | allowlist, deny log, rate limit |
| `untrusted.ts` | đánh dấu nội dung ngoại lai |
| `outbox.ts` · `update-log.ts` · `pending.ts` · `store.ts` | state trên đĩa |
