---
type: concept
created: 2026-08-17
updated: 2026-08-17
tags: [learn]
---
# GitLab self-hosted vs gitlab.com, và cái giá khi migrate

## Self-hosted là mô hình gốc, không phải cách lách

GitLab sinh ra là phần mềm cài trên máy chủ của chính mình; `gitlab.com` (SaaS) mới đến sau. Hai đường bán song song, self-host là first-class.

- **CE (Community Edition)** — open source, miễn phí, cài bao nhiêu cũng được.
- **EE (Enterprise Edition)** — cùng codebase, mở khoá tính năng theo tier Premium/Ultimate, tính tiền theo user. Không nhập license thì chạy như bản Free.

Cách cài thường gặp: gói **Omnibus** (`.deb`/`.rpm` lên một VM), **Docker**, hoặc **Helm chart trên Kubernetes**.

## Đọc dấu vết để đoán cách deploy

Gọi `GET /api/v4/version` trên instance sẽ thấy version + các service phụ. Ví dụ thật:

```json
{"version":"19.1.0","revision":"e7de9eeb811",
 "kas":{"enabled":true,
        "externalUrl":"wss://<host>/-/kubernetes-agent/",
        "externalK8sProxyUrl":"https://<host>/-/kubernetes-agent/k8s-proxy/"}}
```

KAS (GitLab Kubernetes Agent Server) bật + SSH nằm ở **host riêng** (`gitssh.<domain>` thay vì chung host với HTTPS) → **gợi ý** deploy trên Kubernetes. Lý do: trong K8s port 22 không dùng chung ingress với HTTPS được, nên SSH hay tách ra hostname/load balancer riêng. Đây là suy luận từ bên ngoài, không phải xác nhận.

## Hai instance KHÔNG chia sẻ gì cả

Đây là điều dễ quên nhất khi công ty migrate. Mỗi instance có riêng:

- **Access token** — token của instance này gọi API instance kia trả **401**.
- **SSH key** — phải add lại vào account trên instance mới.
- **Số MR/issue** — đếm độc lập (một bên đang !111, bên kia !98 cho cùng repo).
- **Runner, user account, CI variable, protected branch rule.**

## Gotcha thực tế khi migrate

**1. `glab` từ chối làm việc.** Nó bind theo host đã auth. Repo có remote trỏ host lạ thì báo *"None of the git remotes configured for this repository point to a known GitLab host"* — và ép `GITLAB_HOST=` cũng **không** cứu được, vì nó vẫn soi git remote local. Cách sửa đúng:

```bash
glab auth login --hostname git.avada.net
```

Chưa sửa thì fallback là gọi thẳng REST API (`POST /api/v4/projects/:id/merge_requests`).

**2. "Đã migrate" không có nghĩa là bản sao đầy đủ.** Instance mới có thể chỉ là **ảnh chụp tại một thời điểm**. Số liệu thật của một lần migrate:

| | cũ | mới |
|---|---|---|
| branch | 122 | 115 |
| tag | 226 | 198 |
| master | 14/08 | ảnh chụp 13/07 + 1 commit CI |

master bên mới **thiếu 341 commit**. Branch dựa trên master cũ đem sang sẽ cherry-pick ra conflict, và MR mở lên sẽ hiện cả tháng lịch sử phân kỳ thay vì đúng phần thay đổi.

**3. Protected branch chặn đường sửa nhanh.** `master` thường có `allow_force_push = false`. Khi hai history đã phân kỳ, force-push để đồng bộ là **không được** — chỉ còn đường **merge** bên cũ vào bên mới (hợp lệ vì commit mới có bên mới làm cha). Kiểm quyền trước:

```
GET /api/v4/projects/:id/protected_branches
```

## Bài học rút ra được

Trước khi push branch lên một remote vừa migrate, **kiểm quan hệ history đã**, đừng giả định cùng repo là cùng lịch sử:

```bash
git fetch <new-remote> master:refs/remotes/new/master
git merge-base --is-ancestor <base-cua-branch> refs/remotes/new/master \
  && echo "cung history, push duoc" \
  || echo "PHAN KY - dung push, xu ly truoc"
git merge-base <base> refs/remotes/new/master   # tìm tổ tiên chung
git rev-list --count <to-tien-chung>..<moi-ben>  # đo lệch bao nhiêu commit
```

Ba lệnh này mất 30 giây và tránh được một MR rác trên repo dùng chung.

Liên quan: [[DevOps & Infra]] [[Tools]]

---
_Cập nhật 2026-08-17_

## Case thật: Avada rời gitlab.com sang git.avada.net (08/2026)

**Động cơ: tiền, không phải kỹ thuật.** Bản SaaS của GitLab giới hạn số user và tính phí theo seat. Team đông lên thì chi phí per-seat tăng tuyến tính, trong khi self-host thì trả một lần cho hạ tầng rồi thêm user gần như miễn phí. Đây là lý do phổ biến nhất khiến công ty tự host — không phải vì thiếu tính năng.

Đánh đổi cần nhớ: cắt được phí seat thì gánh lại **vận hành** — nâng cấp, backup, uptime, vá bảo mật, dung lượng, sức chứa runner. GitLab.com sập thì chờ họ; instance của mình sập thì đội mình dậy sửa.

### Dòng thời gian quan sát được

```
05/08  project được tạo trên instance mới (git.avada.net, GitLab 19.1.0)
 ~13/07  nội dung seed từ trạng thái repo lúc đó — KHÔNG phải bản sao tại thời điểm tạo
12/08  một dev đổi .gitlab-ci.yml: clone artifact từ host mới thay vì gitlab.com
17/08  master bên mới vẫn thiếu 341 commit -> phải merge thủ công rồi mới làm việc tiếp được
```

Điểm đáng chú ý: giữa 05/08 và 17/08, **hai bên chạy song song** mà không ai đồng bộ. Người vẫn merge lên gitlab.com, người đã trỏ CI sang host mới. Một cái bẫy im lặng — nhìn bên ngoài thì cả hai đều "hoạt động bình thường".

### Cụ thể vỡ ra ở đâu

**Remote đổi giữa chừng mà không ai báo.** Đầu buổi `git remote -v` còn là `git@gitlab.com:...`, `git fetch` chạy thật. Đến lúc push thì thành `https://git.avada.net/...`. Worktree dùng chung `.git/config` với repo chính nên đổi một chỗ là cả hai đổi theo.

**Token trong file env là của instance MỚI.** Push HTTPS lên host mới báo `HTTP Basic: Access denied`, mà gọi API gitlab.com cũng 401 — vì đó là hai token khác nhau cho hai hệ thống khác nhau. Lúc đó tưởng token hỏng, thật ra là dùng nhầm cửa.

**Cách gỡ đúng thứ tự:**

1. `git ls-remote` cả hai host để xem host nào còn sống và master ở đâu.
2. Đối chiếu `master` bên mới với base của branch mình → phát hiện phân kỳ.
3. `git merge-base` tìm tổ tiên chung, `git rev-list --count` đo lệch bao nhiêu.
4. Kiểm `protected_branches` → thấy `allow_force_push=false` → loại phương án force-push.
5. Merge bên cũ vào bên mới (hợp lệ vì commit bên mới là cha của merge commit) → push → mới mở được MR sạch.

**Conflict lúc merge thường nằm ở `.gitlab-ci.yml`,** vì đó đúng là file mà bên mới đã sửa (đổi URL clone artifact sang host mới) còn bên cũ cũng sửa (tắt một job đang làm treo deploy). Giải bằng `-X theirs` để lấy bên cũ ở vùng conflict **nhưng giữ nguyên phần auto-merge** — nhờ vậy không mất thay đổi trỏ-host của người kia ở các job không conflict. Nếu dùng `git checkout --theirs <file>` thì lấy nguyên file và **mất** phần đó.

### Rút ra

- Migrate GitLab hiếm khi là một cú chuyển tức thời. Có một **giai đoạn hai bên cùng sống**, và đó là lúc dễ mất việc nhất.
- Đừng tin "đã migrate xong". Đo: số branch, số tag, và `master` có chứa commit mình cần không.
- Khi thấy auth lỗi trên repo vừa migrate, câu hỏi đầu tiên là **"token này của instance nào"**, không phải "token có hết hạn chưa".
