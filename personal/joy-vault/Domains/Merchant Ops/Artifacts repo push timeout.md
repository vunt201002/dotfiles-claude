---
type: decision
product: wishlist
created: 2026-07-27
updated: 2026-07-27
tags: [joy, wishlist]
---
# Artifacts repo push timeout

**Bối cảnh**

Job push của pipeline wishlist fail. Log:

```
fatal: the remote end hung up unexpectedly
error: failed to push some refs to '.../wishlist-artifacts.git'
ERROR: Job failed: execution took longer than 1h0m0s seconds
```

Giả thuyết ban đầu của team: repo "quá đầy" nên không push được → xoá bớt artifact.

**Quyết định / kết luận**

Giả thuyết dung lượng SAI. Đo thực tế trên repo `avada/artifacts/wishlist-artifacts`:

| | Trước dọn | Sau rewrite |
|---|---|---|
| `static/` | 301 MB | 24 MB |
| file trong `assets` | 2731 | 268 |
| **`.git`** | **11 MB** | **10 MB** |
| commit | 120 | 5 |

Cây làm việc rụng 92% nhưng `.git` gần như không đổi (11→10 MB). Cách xử lý cuối cùng là **rewrite history + force-push** (cắt 120 commit còn 5).

**Lý do / bài học**

1. **Dung lượng chưa bao giờ là nguyên nhân.** GitLab quota mặc định 10 GB; repo mới 11 MB. Nếu thật sự vượt quota, lỗi trả về là `GitLab: You have exceeded the storage quota` / `pre-receive hook declined` — hiện thẳng trong log. `remote end hung up` + timeout là dấu hiệu push treo, khác hẳn bị từ chối.

2. **Xoá file trong working tree KHÔNG làm `.git` nhỏ đi.** Git nén các bundle JS gần giống nhau rất tốt, và lịch sử vẫn giữ mọi blob. Commit xoá còn làm `.git` to thêm. Muốn nhỏ thật thì phải rewrite history — đúng thứ cuối cùng đã làm.

3. **Gốc rễ: CI chỉ `A` (add) mà không bao giờ prune.** Mỗi lần deploy Vite sinh hash mới, `app-*.js` ~960 KB/bản, tích lại qua từng build. Chưa sửa bước prune trong CI của repo source thì artifacts sẽ phình lại như cũ.

4. **Giả thuyết chưa loại trừ: nhiều job push giành cùng một ref.** Trang job có `push-reset-artifacts` chạy song song. Khi 2 job cùng push, job thua phải fetch-rebase-thử lại; repo càng nặng mỗi vòng càng lâu → treo tới timeout. Nếu sau rewrite mà vẫn fail thì đây là nghi phạm chính → đặt `resource_group` cho các job push nối đuôi nhau.

**Cách xác định file nào xoá được (dùng lại khi áp cho repo khác)**

Đừng lọc theo ngày — file mới nhất chính là bản đang serve production, xoá là 404 asset thật. Truy từ entrypoint (`embed.html`, `standalone.html`) → lần chuỗi import → ra tập file thực sự đang serve. Trên repo này: 74 file live (~5 MB) / 2731 tổng. Giữ thêm file của 2-3 deploy gần nhất để còn đường rollback.

**Hệ quả cần báo team**

Lịch sử đã bị rewrite → ai còn clone cũ sẽ gặp phân kỳ (kiểu `local riêng 120 / remote riêng 5`, cùng nội dung khác hash). KHÔNG được merge/rebase — sẽ đẩy ngược 120 commit cũ lên, phình lại repo. Phải hard-reset local về `origin/main`.

Liên quan: [[Merchant Ops]]
