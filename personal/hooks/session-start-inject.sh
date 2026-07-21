#!/usr/bin/env bash
# SessionStart hook (matcher: startup|resume|compact) — exit 0 + stdout = inject vào context.
# Trick của Superpowers: chạy CẢ SAU COMPACT — vì context injection thường "bốc hơi" lặng lẽ
# khi compact (nested CLAUDE.md không được re-inject; chỉ root CLAUDE.md là được).
# Giữ block này NGẮN (~15 dòng) — nó chiếm context mọi session.

cat <<'EOF'
[IRON LAWS — re-injected, sống sót qua compact]
- Bug: KHÔNG fix khi chưa có root cause chứng minh bằng RUNTIME (workflow.md B2). Kẹt thì đào, đừng đoán.
- UI fix: visual read (design-eye §A) trước diagnose; design-verify (§B, 5 dimension ≥8) trước khi đóng B8.
- Pattern library design-eye §D: ĐỌC trước khi diagnose bug UI, GHI sau khi fix xong.
- KHÔNG commit/push khi user chưa quyết. KHÔNG `git add .` / `git add -A`.
- 3-4 lần fix fail cùng 1 bug → DỪNG, báo user (liability tripwire). Sửa 2 lần cùng 1 lỗi → đề nghị /clear + prompt mới.
- Đang dở việc từ session trước? Đọc /my-worklog trước khi làm tiếp.
EOF
exit 0
