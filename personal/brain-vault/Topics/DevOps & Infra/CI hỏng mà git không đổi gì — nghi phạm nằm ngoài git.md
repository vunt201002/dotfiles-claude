---
type: gotcha
created: 2026-08-20
updated: 2026-08-20
tags: [learn]
---
# CI hỏng mà git không đổi gì — nghi phạm nằm ngoài git

Một job CI đang chạy tốt bỗng đỏ, mà `git log` không có commit nào chạm vào nó.
Phản xạ đầu tiên là đổ tội cho thứ *nhìn thấy được* trong git đã đổi gần đó — và
phản xạ đó sai. Khi nội dung git bất biến, nguyên nhân **nằm ngoài git**: CI
variable, branch protection, runner image, hoặc project vừa được import sang
instance khác.

## Ca thật

Job deploy Shopify extension chết ở bước parse TOML:

```
Can't redefine existing key at row 55, col 16, pos 2068
54: application_url = "..."
55> embedded = true
```

Dòng gây lỗi trong `.gitlab-ci.yml`:

```
- echo "$PROD_APP_TOML" >> shopify.app.toml
```

`>>` là **nối thêm**. Runner `git clone` repo về nên `shopify.app.toml` là file
48 dòng đã commit, và nó **kết thúc bằng `[pos]`**. TOML **không có cú pháp quay
về bảng gốc**, nên mọi key top-level của biến bị hút vào trong `[pos]`, và
`embedded = true` định nghĩa lại `[pos].embedded`.

## Vì sao trước đó không lỗi — mấu chốt

`PROD_APP_TOML` là biến **duy nhất** trong nhóm được đánh `protected`. Biến
protected **chỉ được bơm vào job khi chạy trên protected branch**.

- Instance cũ: `master` **không** protected → biến không bao giờ được bơm →
  `echo` in ra **một dòng trống** → file vẫn hợp lệ → job xanh.
- Instance mới: `master` **là** protected → biến được bơm lần đầu → phá file.

**Giá trị biến chưa bao giờ đổi.** Thứ đổi là *nó có tới được job hay không*.
Cùng một dòng script, cùng một giá trị, hai kết quả.

## Cách lần ra

1. **So blob, đừng so ngày.** `git rev-parse <sha>:<file>` ở lần xanh cuối và
   lần đỏ đầu — giống hash nghĩa là file thật sự bất biến, không phải "chắc là
   không đổi".
2. **Kiểm tra job "xanh" có thật sự chạy không.** Job import từ instance cũ có
   `runner = NULL` và **log rỗng**. Project mới tạo ngày X mà pipeline ghi ngày
   trước X ⇒ đó là lịch sử import, chưa từng chạy ở đây.
3. **Số học tự nó bác giả thuyết.** Biến chỉ 34 dòng mà lỗi ở row 55 ⇒ file phải
   có sẵn ~48 dòng trước đó. Nếu file trống thật thì `>>` và `>` cho kết quả y
   hệt — sẽ chẳng có bug nào.
4. **Loại trừ bằng thực nghiệm, không bằng cảm giác.** Nghi version tool thì hạ
   version rồi chạy thật. Ra lỗi **byte-identical** ⇒ loại hẳn, đừng thử tiếp.
5. **In ra thứ tool thực sự đọc.** Thêm `wc -l` + `cat -n` quanh bước ghi file.
   Lỗi khó lần vì log không bao giờ cho thấy input thật.

## Đọng lại

- `.gitignore` **chỉ chặn file CHƯA được track**. File lỡ commit trước khi có
  luật thì luật đó vĩnh viễn vô hiệu với nó — phải `git rm --cached`. Đây là
  nguồn gốc của cả đống "sao file này lại có trong repo?".
- **Project import không mang CI variable theo.** Phải tạo lại tay, và bản tạo
  lại thường lệch bản gốc (khác giá trị, khác cờ `protected`). Cờ `protected`
  không đồng nhất giữa các biến cùng nhóm là **dấu vân tay** của việc tạo tay.
- Loại lỗi này **không có commit nào để `git blame`**, và có thể **ngủ hàng
  tuần** trước khi lộ — nó chỉ lộ khi có người chạy đúng job đó.
- Trong YAML, một script item chứa `": "` (hai chấm + dấu cách) mà không bọc
  nháy sẽ bị parse thành **mapping** chứ không phải string:
  `- echo "=== A: b ==="` → `{"echo \"=== A" => "b ===\""}`.

Liên quan: [[DevOps & Infra]]
