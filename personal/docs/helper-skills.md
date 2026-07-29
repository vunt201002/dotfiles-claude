# Helper skills — cheatsheet (vunt)

> Tra nhanh các **skill/command cá nhân**: dùng cái nào cho việc gì, cú pháp, lưu ở đâu.
> Đây là mấy skill *phụ trợ* — không phải workflow code (cái đó xem `workflow.md`).
> Skill nằm ở `personal/skills/*`, command ở `personal/commands/*.md`; symlink vào
> `~/.claude/` (thiếu trên máy mới → chạy **/sync-skills**).
>
> **Nguyên tắc chung của mấy skill vault:** chỉ đọc web + ghi vào vault của nó, **không tự commit**
> (mình commit khi muốn). Vault đều nằm trong repo dotfiles nên sync qua git giữa các máy.

---

## 1. Ghi nhanh — "lưu lại kẻo quên" (4 skill, ĐỪNG nhầm)

Bốn skill này đều là "ghi cái gì đó", nhưng **khác vault, khác mục đích**. Chọn sai thì
note lạc chỗ. Quy tắc phân biệt:

| Ghi cái gì | Skill | Vault |
|---|---|---|
| **Học được** (concept, TIL, gotcha, snippet, câu hỏi) — kiến thức cá nhân | `/note` | `personal/brain-vault/` |
| **Kiến thức công việc Joy** (bug tiềm ẩn, cách hệ thống chạy, quyết định) | `/joy-note` | `personal/joy-vault/` |
| **Việc cần làm tiếp** (checklist, không cần context) | `/todo` | `~/.todo/` |
| **Trạng thái phiên làm việc** (đang dở ở đâu, resume lại) | `/my-worklog` | gstack checkpoints |
| **Task team thật** (assignee, status, board) | `/notion-task-personal` | Notion |

### `/note` — ghi kiến thức học được (Brain vault)
- **Khi nào:** "ghi lại cái vừa học", "TIL ...", một concept/gotcha/snippet/câu hỏi cá nhân.
- **KHÔNG dùng cho:** kiến thức công việc Joy → `/joy-note`. Không phải study tracker → `/learn`.
- Tự phân vào topic folder (Frontend, Backend, System Design, DSA, Databases, DevOps,
  Security, AI & LLM, CS Fundamentals, Career, Tools); không rõ → `Inbox`.
- Note kiểu `question` nổi trên ❓ Questions cho tới khi `status: answered`.

### `/joy-note` — ghi kiến thức công việc (Joy vault)
- **Khi nào:** đang code Joy, gặp gotcha / bug tiềm ẩn / cách một thứ hoạt động / quyết định.
- Mỗi note mang `product:` = `wishlist` | `loyalty` | `shared`. `type: potential-bug`
  tự lên 🐛 Watchlist; `bug`→`Technical/Bugs/`, `confusion`→`Confusion/`.
- Trùng title → thêm section theo ngày (dùng `--new` để tách hẳn).

### `/todo` — checklist việc, đọc lại theo ưu tiên
- **Khi nào:** cuối ngày jot mấy việc mai làm; sáng đọc lại theo P1→P2→P3. Việc chưa xong tự carry-over.
- **KHÔNG dùng cho:** cần context để resume → `/my-worklog`. Chi tiết ở `todo-workflow` bên dưới.

| Lệnh | Việc |
|---|---|
| `/todo` | Đọc — list việc mở, gộp P1→P2→P3, carry-over hiện `(từ ngày)` |
| `/todo <text>` | Thêm việc (text mở đầu `p1:`/`p2:`/`p3:`, mặc định p2) |
| `/todo notes` (hay `chi tiết`) | List kèm note chi tiết dưới từng việc |
| `/todo all` | List gồm cả việc đã xong |
| `/todo done <N>` | Tick xong việc #N |

### `/my-worklog` — standup + resume phiên làm việc
- **Khi nào:** "save my work", "sáng nay đang làm gì", "resume task". Một **task = một branch**.
- Tái dùng store checkpoint của gstack. Mỗi `save` ghi: `next_action` (việc kế tiếp),
  `in_flight` (cái đang dở giữa chừng), và **session log cộng dồn** — đã thử gì, kết quả
  ra sao, hướng nào đã loại trừ. File mới nhất tự đủ nên `resume` chỉ đọc 1 file.

| Lệnh | Việc |
|---|---|
| `/my-worklog` (hay `standup`) | Standup — mọi task đang dở, gộp theo ngày, kèm next action |
| `/my-worklog save [title]` | Lưu trạng thái task hiện tại (1 file mới) |
| `/my-worklog resume [branch\|title\|#]` | Nạp lại full context 1 task vào phiên |
| `/my-worklog done [branch]` | Đánh dấu task xong (khỏi hiện ở standup) |
| `/my-worklog --all` | Standup mọi project |

### `/notion-task-personal` — board Notion của team
- **Khi nào:** tạo/sửa/tra task thật trên Notion, comment/mention. Cần `NOTION_API_KEY`.

| Lệnh | Việc |
|---|---|
| `... list --status "Doing"` | Lọc task (`--overdue`, `--priority`, `--assignee`, `--search` — ghép được) |
| `... get <id\|url>` | Xem 1 task |
| `... create --title "..." [--status/--priority/--label/--due/--mr/--body]` | Tạo task |
| `... update <id> [--status/--priority/--mr/--body]` | Sửa task |
| `... comment <id> "text" [--mention <user_id>]` | Comment/mention |

---

## 2. Học — `/learn`

- **Khi nào:** 1-2 tiếng học ngoài giờ. Gợi ý học gì (bám career + việc + tin hot search thật),
  rồi **dạy** (nền tảng model tự tin) hoặc **lập roadmap + link nguồn** (tech mới/version-specific).
  Dạy tiếng Việt, thuật ngữ giữ tiếng Anh. Tiến độ lưu per-topic, resume đúng chỗ.
- **KHÁC `/note`:** `/note` ghi cái đã học (atomic); `/learn` là lộ trình + tiến độ có cấu trúc.

| Lệnh | Việc |
|---|---|
| `/learn` | Mặc định — có topic dở thì hỏi tiếp; chưa có thì gợi ý |
| `/learn suggest` | Chỉ gợi ý, chưa bắt đầu |
| `/learn <topic>` | Bắt đầu/tiếp topic (tự đề xuất teach hay plan) |
| `/learn teach <topic>` | Ép chế độ dạy |
| `/learn plan <topic>` | Ép chế độ roadmap + nguồn |
| `/learn list` | Các topic đang học dở |

Vault: `personal/learn/` (1 file / topic, có `next_start`).

---

## 3. Đọc tin — `/tech-digest`

- **Khi nào:** "tin công nghệ hôm nay", "reading list". Fetch HN + search có target các mảng mình
  theo, lọc mạnh còn ~10-15 bài, chia 🔥 hot / 💼 việc / 🌐 rộng, mỗi bài 1 dòng "vì sao đáng đọc"
  tiếng Việt + **link đọc luôn**. Không bịa — bài nào không có URL thật thì bỏ.
- **Save & Follow:** thấy bài hay thì lưu đọc sau; nguồn hay thì follow để digest sau ưu tiên.

| Lệnh | Việc |
|---|---|
| `/tech-digest` | Digest hôm nay (~10-15 bài, đánh số) |
| `/tech-digest --wide` | Quét rộng ~20-30 bài |
| `/tech-digest <topic>` | Digest 1 mảng (vd `security`, `ai`, `frontend`) |
| `/tech-digest save <N...>` | Lưu bài #N (theo số trong digest vừa ra) vào `saved.md`. Vd `save 1 3` |
| `/tech-digest saved` | Xem danh sách đã lưu (đọc sau) |
| `/tech-digest saved done <N>` | Tick đã đọc bài #N trong danh sách saved |
| `/tech-digest follow <url\|tên\|topic:...>` | Theo dõi 1 blog/tác giả/repo/chủ đề |
| `/tech-digest sources` | Xem các nguồn đang theo |
| `/tech-digest unfollow <tên>` | Bỏ theo dõi |
| `/tech-digest list` | Liệt kê các digest đã lưu theo ngày |

- **Save chạy theo SỐ trong digest** → phải chạy digest trước cho ra số, rồi mới `save`.
- **Follow độc lập** — gõ lúc nào cũng được. Bài mới từ nguồn follow lên section 📌 NỔI BẬT đầu digest.
- Vault: `personal/tech-digest/` (`YYYY-MM-DD.md` mỗi ngày, `saved.md`, `sources.md`, `seen-urls.txt`).

---

## 4. Ship code — commit / staging / tag / merge

### `/my-commit` — commit chỉ file của phiên này
- Chỉ commit file **phiên này đụng**, tách theo **logical unit × loại** conventional-commit.
  KHÔNG `git add -A`. **Luôn hỏi xác nhận trước khi commit** (im lặng ≠ đồng ý). Không push.

### `/deploy-staging <N>` — đẩy branch hiện tại lên staging N
- Sửa **chỉ `.gitlab-ci.yml`** (rewrite ref của staging N), commit `deploy: staging <N>`, push branch.
- Chặn: chỉ đụng job của staging N, không production/staging khác; không force-push; đang ở
  `main`/`master`/base → dừng hỏi.

### `/deploy-tag` — in ra lệnh cắt tag release kế tiếp
- Sau khi MR merge: đọc pattern tag của repo, tính tag kế, **in lệnh `git tag` + `git push` cho MÌNH chạy** (không tự chạy).
- Tag không nhất quán → hỏi, không đoán. Chỉ tự chạy nếu mình bảo "push luôn".

### `/merge-branch [a, b]` — gộp nhiều nhánh để test chung staging
- Update từng nhánh với main (rồi push, có cổng), tạo merge branch (hoặc fold nhánh mới vào branch đã có), 1 commit/nhánh, xong bàn giao `/deploy-staging`.
- `/merge-branch [a, b]` (mới) · `/merge-branch <tên> [a, b]` (đặt tên) · `/merge-branch <tên-cũ> [a]` (fold lần 2).
- Working tree phải sạch; assembly không push; không force-push.

---

## 5. Đọc code & browser

### `/my-explore` — hiểu codebase
- `/my-explore` (không args) → Full Picture: survey cả project.
- `/my-explore <pattern|file|câu hỏi>` → Deep Dive: 1 thứ, giải thích cách + vì sao. Vd
  `/my-explore repository pattern`, `/my-explore why webhooks use pubsub`.
- Bỏ qua nếu file đọc 30s là hiểu, hoặc đã có trong README.

### `/my-chrome` — test trên Chrome thật (mặc định bước test)
- Lái Chrome thật đã login (Admin/store sẵn, khỏi cookie). Protocol tab-group:
  check trước → có thì dùng, chưa có tạo 1 lần → xong đóng tab. Xem `workflow.md` § "Test trên browser".
- **Đừng nhầm** built-in `/chrome` của Claude Code (chỉ kết nối extension).

### `/qa-login` — (nước cuối) import cookie Chrome vào browse headless
- Chỉ khi `/my-chrome` không dùng được **và** đường rẻ khác đã thử. Import cookie storefront/admin
  vào session `browse`. **Không phải kho mật khẩu** (copy cookie sẵn có, không gõ pass).
  Admin device-bound có thể vẫn chặn — giới hạn đã biết. Prime login xong dùng `/qa`, `/browse`.

---

## 6. Bảo trì

### `/sync-skills` — link skill/command còn thiếu trên máy này
- Quét `personal/skills/*` + `personal/commands/*.md`, symlink cái chưa link, báo cái link hỏng
  (không tự xoá). Idempotent. Chạy sau khi pull repo có skill mới.
- **Không phải bộ cài lần đầu** (không tự link được chính nó trên máy trắng — dùng bootstrap trong SKILL).

### `/joy-point-assign` — ước lượng story point task Joy
- Ma trận Complexity × Uncertainty (calibrate trên 2,388 task). Đọc **code thật**, không đoán từ title.
- Đơn lẻ: `read-task.py` → `read-mr.py` → estimate → `write-points.py`. Batch: `export-unscored.py`
  → điền CSV → `apply-points.py --dry-run` → `apply-points.py`. Cần `NOTION_API_KEY` + `GITLAB_TOKEN`.

---

## Quy ước chung
- Skill vault: chỉ đọc web + ghi vault, **không tự commit** — mình chủ động `/my-commit`.
- Ngôn ngữ: nội dung tiếng Việt được; code/tên file/thuật ngữ giữ tiếng Anh.
- Máy mới thiếu skill → **/sync-skills** (skill vault báo điều này khi cần).
- Workflow code (feature/bug/batch, các bước A/B/C) → xem `workflow.md`, không phải file này.
