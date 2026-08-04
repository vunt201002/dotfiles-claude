---
paths:
  - "**/personal/skills/**/SKILL.md"
  - "**/personal/commands/*.md"
  - "**/personal/hooks/*.sh"
  - "**/personal/rules/*.md"
---

# Sửa harness — 3 điều dễ quên

**Skill mới không tự sống.** Tạo thư mục trong `personal/skills/` KHÔNG làm nó gọi được;
phải có symlink trong `~/.claude/skills/`. Đã có tiền lệ: `fix-bug-loop` viết xong nằm
chết 2 tuần. Thêm skill/command/rule mới → chạy **`/sync-skills`** ngay trong cùng
phiên. `harness-check.sh` sẽ nhắc ở session sau, nhưng đừng để nó phải nhắc.

**`description:` là WHEN, không phải WHAT.** Nó nạp vào context MỌI session, dù skill
không được gọi — nên nó trả tiền cho việc routing, không phải cho việc mô tả. Giữ:
trigger phrase (cả tiếng Việt lẫn tiếng Anh) + dòng phân biệt với skill hàng xóm gần
("NOT X — dùng /Y cho việc đó"). Bỏ: skill làm gì bên trong, các bước, lý do thiết kế —
những cái đó thuộc về body, chỉ đọc khi skill thật sự chạy.

**Hook: exit code là API.** `exit 2` + stderr = chặn (Claude đọc stderr và tự sửa);
`exit 0` + stdout = inject vào context (SessionStart). Repo lạ phải `exit 0` im lặng,
đừng giả bộ check. Sửa hook xong luôn test bằng cách pipe JSON giả vào — cả case bình
thường LẪN case phải kêu; một hook không bao giờ kêu và một hook hỏng nhìn giống hệt nhau.
