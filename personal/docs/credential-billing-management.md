# Quản lý credential & billing cho nhiều project

> Ghi 2026-08-16, cập nhật cùng ngày. Bối cảnh: solo dev, Windows 11 + Mac, đang có
> hai project — kivora (Shopify app) và tienvu-bt — sẽ còn thêm. Tài liệu **cắt ngang
> mọi project** nên để ở `personal/docs/` của dotfiles-claude, không nằm trong repo app nào.
>
> **File này không bao giờ chứa secret.** Chỉ chứa cấu trúc, quy ước, và con trỏ.

---

## 0. Cái sai gốc: gom 3 loại secret vào một chỗ

Hầu hết dev solo quản credential bằng một password manager + vài file `.env`, rồi
vỡ khi số project tăng. Lý do là **ba thứ khác hẳn nhau bị coi như một**:

| Tầng | Là gì | Ai dùng | Mất thì sao |
|---|---|---|---|
| **1. Identity** | email đăng ký, 2FA, recovery code, domain | con người, một lần | **mất hết mọi thứ bên trên, không có đường kháng nghị** |
| **2. Human login** | user/pass Render, Neon, Brevo, Shopify Partner | mình, hằng ngày | reset được qua email → tức là phụ thuộc tầng 1 |
| **3. Machine secret** | API key, `DATABASE_URL`, webhook secret | app lúc runtime | rotate được, nhưng đang bị copy ra 3 nơi |

Ba tầng cần ba cách lưu khác nhau. Nhét chung vào một chỗ là lý do sau này
không trả lời được câu *"cái key này còn ai dùng không, sửa ở đâu cho đủ"*.

---

## 1. Chốt việc — thứ tự thực thi

Bảng này là **thứ tự**, không phải danh sách. Nó xếp theo **phụ thuộc** trước, rồi
mới tới tỉ lệ giảm-rủi-ro / công-bỏ-ra. Làm sai thứ tự thì phải làm lại — ví dụ lập
tài khoản vendor trước khi có mailbox thì lại phải đi đổi email từng cái.

Chi tiết từng bước, kèm bẫy và cách kiểm chứng: **§13 Runbook**.

| Giai đoạn | Việc | Thời gian | Phụ thuộc | Vì sao ở đây |
|---|---|---|---|---|
| **P0** | `gitleaks` pre-commit + quét lịch sử + **test bằng fake key** | 30p | — | Chặn loại sự cố duy nhất mà rotate không cứu được. Không phụ thuộc gì nên làm sớm nhất |
| **P0** | Sàn tối thiểu registrar: auto-renew · lock · 2FA · **kiểm chu trình recovery** · lịch nhắc | 20p | — | Mất domain là mất tất cả. Mục kiểm chu trình không hoãn được |
| **P0** | Chặn spoof `kivora.io.vn` (2 record TXT) | 5p | — | Domain chưa gửi mail là domain ai cũng giả mạo được |
| **P1** | Bitwarden free + **master password ra giấy** + app TOTP có backup đã test restore | 2h | — | Nơi cất credential phải có TRƯỚC khi lập tài khoản mới, không thì lại đi nhập lại |
| **P2** | Zoho Mail cho `kivora.io.vn` và `tienvujsc.com.vn` + địa chỉ per-vendor | 1–2h | P1 | Cần địa chỉ email khác nhau mới lập được tài khoản vendor riêng |
| **P3** | 3 Chrome profile + Bitwarden extension mỗi profile | 30p | P1, P2 | Tầng vận hành. Có nó rồi thì P4 làm trong đúng ngăn kéo, đỡ nhầm |
| **P4** | Tách tài khoản vendor theo project | 2–4h | P2, P3 | ⚠️ **Nguy hiểm nhất — kivora đang live.** Xem §13 P4 trước khi đụng |
| **P5** | `sops` + `age`, tách `dev.env` / `prod.env` | 1h | P1 | Sửa đúng cái gốc đã sinh ra "dev và prod chung một URL" (§4.1, T-114) |
| **P6** | Billing alert từng vendor + điền Phụ lục B | 1h | P4 | Có tài khoản tách rồi thì hoá đơn mới tách theo project |
| **P7** | `projects/kivora.md` · `projects/tienvu-bt.md` · `templates/new-project.md` | 1h | P6 | Biến project thứ 3, 4 thành **lặp lại** thay vì tự chế |

**Đang hoãn có chủ ý** (identity domain · YubiKey · mailbox trả phí · Bitwarden
Premium · thẻ ảo · Doppler/Infisical): xem **§12** — có bảng riêng, kèm điều kiện
mở khoá từng món.

---

## 2. Tầng 1 — Identity: làm trước, vì nó không sửa lại được

Hiện tại toàn bộ đế là `hoanglhavada@gmail.com`. Google khoá tài khoản đó (nhầm,
bot, bất kỳ lý do gì) thì Shopify Partner, Render, Neon, Brevo mất theo, và Google
**không có support người thật** cho tài khoản free. Đây là single point of failure
duy nhất mà tiền không mua lại được.

### 2.0 Bootstrap: phá vòng lặp gà-và-trứng

Câu hỏi tự nhiên khi đọc §2.1: muốn có email trên domain thì phải mua domain, mà
mua domain thì đã phải có sẵn một tài khoản với một email rồi. Vòng lặp ở đâu ra,
và tách hoàn toàn được không?

**Không tách hoàn toàn được, và cũng không nên cố.** Mọi chuỗi tin cậy đều kết
thúc ở một chỗ ngoài tầm kiểm soát: giấy tờ tuỳ thân, một phương tiện thanh toán
có lịch sử, và vật sở hữu vật lý (YubiKey, giấy in recovery code). Đuổi theo
"không phụ thuộc ai" chỉ sinh ra nhiều vendor hơn, tức nhiều mặt hỏng hơn.

Mục tiêu đúng, và kiểm chứng được: **đồ thị recovery không có chu trình.**

#### 2.0.1 Cái bẫy phải tránh

Hố mà rất nhiều người rơi, vì nó trông sạch sẽ:

> Registrar account của `<domain>` để recovery email là `admin@<domain>`.

Ngày domain hết hạn / bị suspend / DNS hỏng → mailbox chết theo → **không recover
được registrar account để đi sửa chính cái domain đó**. Deadlock kín. Đường thoát
duy nhất là ICANN dispute kèm giấy tờ tuỳ thân, tính bằng tuần.

Đây không phải giả thuyết. **Domain hết hạn là cách phổ biến nhất khiến solo dev
mất sạch**, phổ biến hơn bị tấn công.

#### 2.0.2 Luật: recovery chỉ trỏ XUỐNG, không trỏ NGANG

Hai anchor độc lập — **registrar giữ CÁI TÊN, mailbox provider giữ HỘP THƯ** —
phải là hai vendor khác nhau, và cả hai đều kết thúc ở tầng vật lý, không bao giờ
trỏ vào sản phẩm của nhau.

| Tài khoản | Recovery trỏ về | |
|---|---|---|
| Registrar | địa chỉ bootstrap (trên domain của provider) | ✅ trỏ xuống |
| Registrar | `admin@<domain của chính nó>` | ❌ **chu trình** |
| Mailbox provider | recovery code giấy + YubiKey | ✅ tầng vật lý |
| Mailbox provider | `admin@<domain>` | ❌ **chu trình** |
| Password manager | master password ra giấy + YubiKey | ✅ tầng vật lý |
| Render / Neon / Brevo / Shopify | `<project>-<vendor>@<domain>` | ✅ trỏ xuống |

Mỗi anchor chết một mình đều sống sót: registrar chết → transfer domain đi bằng
auth/EPP code; mailbox chết → trỏ MX chỗ khác, giữ nguyên mọi địa chỉ (đúng ý
§2.1); password manager chết → recovery kit giấy.

#### 2.0.3 Chọn địa chỉ bootstrap

Về cấu trúc, mailbox trả phí và Gmail **giống hệt nhau** — đều là một tài khoản
trên domain của nhà cung cấp, dùng để mua domain của mình. Không có phép màu nào
ở tên vendor. Khác biệt nằm ở hai trục mà người ta hay gộp làm một:

- **free ↔ trả phí** — quyết định *có kênh khiếu nại hay không*
- **daily-driver ↔ chuyên dụng** — quyết định *xác suất phải dùng tới kênh đó*

Trục thứ hai quan trọng hơn trục thứ nhất.

| Lựa chọn | Kênh khiếu nại | Bề mặt chính sách | Rủi ro nằm im | |
|---|---|---|---|---|
| Email đang dùng nhiều nhất | không | cả bundle Google | không | ❌ tệ nhất |
| Gmail riêng, chuyên dụng | không | cả bundle Google | có (xem dưới) | ⚠️ chấp nhận được |
| Mailbox trả phí, chuyên dụng | có | chỉ mail | không | ✅ |

Ba điều đáng biết, không phải marketing:

1. **Email dùng nhiều nhất là lựa chọn tệ nhất** — nằm trong nhiều breach dump
   nhất, bề mặt phishing lớn nhất.
2. **Gmail là một bundle.** YouTube, Drive, Photos, Play, Android chung một tài
   khoản; một strike bản quyền hay một file bị flag cũng suspend được cả tài
   khoản đang làm gốc identity. Fastmail/Proton chỉ làm mail — không có bề mặt
   chính sách nào ngoài mail để mà vi phạm.
3. **Google xoá tài khoản cá nhân không hoạt động 2 năm** (không áp dụng cho
   Workspace của tổ chức). Tài khoản break-glass thì *theo thiết kế là nằm im* —
   đúng hồ sơ bị thu hồi. Google có nhắc trước khoảng 8 tháng, nhưng nhắc vào
   chính hòm thư mình không bao giờ mở. Chỉ cần **đăng nhập** là reset đồng hồ.

Với tài khoản trả phí thì việc trả tiền chính là hoạt động, nên hố (3) không tồn
tại. Cũng đừng thổi phồng ô "có kênh khiếu nại": nhà cung cấp trả phí vẫn khoá
tài khoản được và khiếu nại không đảm bảo thắng. Khác biệt là **có một kênh** so
với **không có kênh nào**.

#### 2.0.4 Chốt (16/08/2026): Gmail cá nhân cũ, chuyên dụng

Chọn ô giữa, cụ thể là **tài khoản Gmail cá nhân lập đã lâu**, xưa nay chỉ dùng cho
việc quan trọng (ngân hàng, apply, đăng ký giấy tờ). Không phải tài khoản đăng nhập
test hằng ngày, và cũng **không phải tài khoản lập mới**. Nó là tài khoản cá nhân,
không phải tài khoản công ty cấp — điều kiện tiên quyết, vì tài khoản công ty thì
ngày nghỉ việc admin thu hồi mất.

Chọn tài khoản cũ **tốt hơn lập tài khoản mới**, ngược trực giác:

| | Gmail cũ, ít dùng, vẫn mở | Gmail lập mới cho riêng việc này |
|---|---|---|
| Chính sách xoá 2 năm | không dính — vẫn hoạt động | **dính**: break-glass theo thiết kế là nằm im |
| Cảnh báo Google gửi tới | có người đọc | vào hòm thư không ai mở |
| Lịch sử tài khoản | dài, ổn định | trắng |

Và đây vẫn là quyết định **sửa lại được**: nâng lên mailbox trả phí sau này chỉ là
đổi recovery email của registrar, một thao tác. Khác hẳn việc chọn domain.

**Vai của nó là vĩnh viễn, không phải tạm.** Sau khi identity domain chạy, mọi tài
khoản vendor chuyển sang alias `<project>-<vendor>@<identity>`; riêng **registrar
giữ nguyên recovery ở Gmail này** — chuyển nó lên identity domain là tự tay tạo chu
trình §2.0.1. Nghĩa là tài khoản này phải sống lâu bằng cả hệ thống.

Điều kiện đi kèm, thiếu cái nào thì lựa chọn này mất giá trị:

- [ ] **Không mở thêm bề mặt chính sách Google** trên tài khoản đó — không đăng
      video YouTube, không Play developer, không chia sẻ Drive công khai. Đăng ký
      ngân hàng / dịch vụ bên ngoài thì không sao: chúng không cho Google thêm lý
      do nào để khoá.
- [ ] **2FA bằng YubiKey**, không dừng ở SMS. Cân nhắc bật **Google Advanced
      Protection** — tài khoản gánh cả ngân hàng lẫn business thì xứng đáng.
- [ ] **Mật khẩu + 2FA của registrar nằm trong vault, độc lập với Gmail này.**
      Đây là thứ biến "Google khoá tài khoản" từ thảm hoạ thành phiền phức: mất
      đường recovery nhưng vẫn đăng nhập được.
- [ ] Giữ lịch nhắc đăng nhập nếu tần suất dùng giảm dần theo thời gian.
- [ ] Thêm mailbox trả phí làm recovery **thứ hai** cho registrar khi kivora có
      doanh thu — bổ sung, không thay thế.

**Hai món nợ vay có ý thức, không phải chỗ sót:**

1. **Không có kênh khiếu nại với con người.** Google khoá thì không có ai để gọi.
   Đổi lại: chi phí 0đ và một đường nâng cấp rẻ.
2. **Blast radius chồng nhau.** Tài khoản này gánh cả giấy tờ/ngân hàng cá nhân lẫn
   recovery của registrar; mất nó là mất lưới an toàn của hai hệ thống cùng lúc.
   Công bằng mà nói nó vốn đã là mục tiêu giá trị cao nhất rồi (ngân hàng), nên
   thêm registrar không làm nó hấp dẫn hơn bao nhiêu — nhưng phải biết là mình đang
   chấp nhận. Điều kiện 3 ở trên chính là cái bịt nó.

**Địa chỉ cụ thể cố ý KHÔNG ghi trong file này.** Nó là dữ liệu nhắm mục tiêu giá
trị cao nhất của cả hệ thống, mà repo này chưa xác định được public hay private
(`gh` chưa cài trên máy) → theo mặc-định-nghiêm thì coi như public. Ghi vào vault
`Identity / google / bootstrap` lúc lập vault (**§13 P1 bước 8**). Trước đó nó không
nằm ở đâu ngoài đầu vunt — đây là lỗ **có chủ ý**, không phải sót.

#### 2.0.5 Vận hành, bịt nốt các hố còn lại

- **Đăng ký domain nhiều năm một lần (5–10 năm), trả trước.** Xoá luôn vách gia
  hạn. Thẻ bị phát hành lại giữa chừng là chuyện thường, auto-renew fail âm thầm
  thì không ai báo.
- **Registrar lock + auto-renew ON + thẻ dự phòng**, kèm một reminder lịch **không
  đi qua email**.
- **Tắt SMS recovery** ở registrar lẫn mailbox nếu tắt được. Số điện thoại là root
  chung mà ai cũng quên, và SIM swap là đường tấn công thật.
- **Một mailbox trả phí thứ hai, để ngủ** (khác nhà cung cấp), chỉ làm recovery
  cho registrar + password manager. Redundancy thật rẻ nhất mua được. Chưa cần
  hôm nay.
- Nếu sau này tách pháp nhân (§6.4) hoặc tính bán app: đăng ký domain dưới **công
  ty** thay vì cá nhân đổi kênh recovery từ "email" sang "giấy tờ công ty" —
  mạnh hơn hẳn, và chuyển nhượng gọn hơn.

### 2.1 Sở hữu địa chỉ email, đừng đi thuê

Mua một domain cá nhân/công ty, đặt email trên đó:

- Google Workspace (~$6/user/tháng) — quen tay nhất
- Fastmail — rẻ hơn, alias tốt hơn
- Cloudflare Email Routing (free) forward về Gmail — đủ để bắt đầu

Điểm mấu chốt **không phải hộp thư, mà là sở hữu địa chỉ**: nhà cung cấp mail nào
chết thì trỏ MX đi chỗ khác, tài khoản vẫn còn.

### 2.2 Catch-all + một alias cho mỗi vendor mỗi project

**Không dùng `+alias` của Gmail** — nhiều dịch vụ chặn dấu `+`, và nó lộ luôn địa
chỉ gốc. Một địa chỉ riêng cho mỗi vendor mỗi project:

```
kivora-render@kivora.io.vn
kivora-neon@kivora.io.vn
kivora-brevo@kivora.io.vn
kivora-shopify@kivora.io.vn
tienvu-vps@tienvujsc.com.vn
```

Ba cái lợi thật, không phải sạch cho đẹp:

1. **Bán / chuyển giao app** sau này là chuyển domain — địa chỉ đi theo, không phải
   bóc tài khoản cá nhân ra khỏi 12 dịch vụ.
2. **Phát hiện rò rỉ**: spam đến `kivora-neon@` nghĩa là Neon rò dữ liệu, biết ngay
   nguồn.
3. **Filter hoá đơn theo project** tự động, phục vụ mục §6.

#### 2.2.1 Địa chỉ nằm trên domain NÀO — luật hai tầng

Bản đầu của tài liệu này viết "mọi alias nằm trên identity domain", nhưng lợi ích #1
ngay trên đầu lại là *"bán app là chuyển alias"* — mà alias trên identity domain thì
**không chuyển được**, phải đi đổi email ở từng vendor. Doc tự đá nhau. Sửa lại
(16/08/2026): chia theo **tầng**, không gom một chỗ.

| Tầng | Địa chỉ nằm ở | Vì sao |
|---|---|---|
| **Identity** — registrar, password manager, ngân hàng, chính Gmail identity | **identity Gmail / identity domain** | Không bao giờ bán, không bao giờ giao. Để trên product domain là giao hạ tầng recovery cho người mua |
| **Project** — Render, Neon, Brevo, Shopify, VPS | **product domain** (`kivora.io.vn`, `tienvujsc.com.vn`) | Đây chính là thứ được bán. Chuyển domain là chuyển nguyên khối |

Rủi ro của vế dưới — product domain chết thì mất đường recovery của vendor project
đó — chấp nhận được vì **registrar account không nằm trên domain đó** (nó ở identity
Gmail), nên luôn vào được registrar để cứu domain. Cộng auto-renew + lock ở §11.

Vế trên thì tuyệt đối: **không bao giờ** để địa chỉ tầng Identity trên product
domain. Đó là chu trình §2.0.1 mặc áo khác.

### 2.3 2FA phải sống sót khi mất điện thoại

Nguyên tắc, không phụ thuộc công cụ: **seed 2FA phải có bản sao nằm ngoài cái điện
thoại đang cầm.** Điện thoại rơi xuống nước là mất seed, mà mất seed là mất đường
vào mọi tài khoản — kể cả khi mật khẩu vẫn còn nguyên trong vault.

Hai cách đạt được, chọn một:

- **App TOTP có export mã hoá** (Ente Auth / 2FAS / Aegis) — đường đang dùng, 0đ.
  Xem §2.3.2.
- **Cất seed trong password manager** — cần bản trả phí (Bitwarden free đã bị cắt
  TOTP từ 2026). Đường nâng cấp, §12.

Cách thứ hai có một đánh đổi phải nói thẳng: cất seed chung vault thì 2FA gần như
tụt về một-yếu-tố nếu vault bị chiếm. Với solo dev, **rủi ro bị khoá ngoài lớn hơn
rủi ro bị tấn công có chủ đích**, nên vẫn là đánh đổi đúng — **với điều kiện**:

- chính cái vault đó dùng **hardware key (YubiKey) làm yếu tố hai**
- mua **hai cái**, một để ngăn kéo
- **recovery code in ra giấy**, cất offline

#### 2.3.1 Luật: 2FA của vault không được nằm TRONG vault

Nghe hiển nhiên nhưng rất dễ phạm, vì password manager mời anh làm đúng thế. Để
TOTP của chính cái vault vào trong vault là tự khoá mình ra ngoài: cần mã để mở
vault, mà mã lại nằm trong vault.

Nên app TOTP trên điện thoại **không bị bỏ đi** — nó có đúng một việc vĩnh viễn:

| Giữ ở đâu | Cái gì |
|---|---|
| **App TOTP** (Ente Auth / 2FAS / Aegis) | mọi seed 2FA, **gồm cả 2FA của chính vault** |
| **Vault** (Bitwarden free) | mật khẩu + recovery code + private key `age` (§4.2) |
| **Giấy, cất offline** | master password của vault + recovery code của Gmail identity |

Với Bitwarden bản free thì việc chia này là **bắt buộc chứ không phải chọn** — free
tier không sinh mã TOTP. Nếu sau này lên Premium và gộp TOTP vào vault, vẫn phải
chừa **2FA của chính vault** ở ngoài. Luật không đổi theo gói cước.

#### 2.3.2 Bẫy: app TOTP đồng bộ qua chính tài khoản Google identity

Google Authenticator đồng bộ seed qua tài khoản Google. Nếu tài khoản đó là **Gmail
identity**, thì nó đang giữ cùng lúc *recovery email của registrar* **và** *toàn bộ
seed 2FA*. Google khoá tài khoản → mất cả hai một lúc.

Đây là "blast radius chồng nhau" của §2.0.4, ở mức nặng hơn.

**Cách gỡ (chốt 16/08/2026): đổi sang một app TOTP không đồng bộ qua Google, có
export mã hoá.** Bitwarden bản free đã bị cắt TOTP từ 2026 nên seed không vào vault
được — nhưng điều đó không sao, vì §2.3.1 vốn đã bắt 2FA của vault nằm ngoài vault.
Thứ thật sự cần là seed **rời khỏi tài khoản Google** và **sống sót khi mất điện
thoại**:

| App | Nền tảng | Backup |
|---|---|---|
| **Ente Auth** | đa nền tảng | đồng bộ e2e, free |
| **2FAS** | đa nền tảng | export mã hoá |
| **Aegis** | chỉ Android | export mã hoá |

Bản sao file backup cất trong Bitwarden dạng ghi chú, hoặc để offline. **Chuyển hai
cái quan trọng nhất trước: registrar và Gmail identity.** Phần còn lại làm dần mỗi
khi đụng tới từng tài khoản, không cần migrate một lượt.

#### 2.3.3 Trạng thái tạm: hoãn YubiKey (16/08/2026)

Vunt hoãn mua YubiKey, dùng app TOTP trước. Nghĩa là **điều kiện đầu tiên ở trên
chưa đạt** — nói thẳng chứ không lờ đi. Thay thế tạm: vault dùng TOTP trên điện
thoại làm yếu tố hai. Yếu hơn hardware key, nhưng vẫn là một thiết bị riêng và vẫn
hơn SMS nhiều.

Hệ quả phải bù, hai thứ, cả hai miễn phí và làm ngay lúc lập vault:

1. **Master password của Bitwarden viết ra giấy**, cất offline. Bitwarden không có
   khái niệm Secret Key / Emergency Kit như 1Password — master password là thứ duy
   nhất mở được vault, và họ **không khôi phục hộ được**. Tờ giấy này là đường về
   duy nhất.
2. **App TOTP phải có backup mã hoá** và backup đó phải được kiểm là khôi phục
   được. Mất điện thoại mà backup chưa từng thử restore thì coi như không có.

Mua YubiKey khi kivora có doanh thu thì điều kiện của §2.3 mới đủ (§12).

---

## 3. Tầng 2 — Human login: một tool, cấu trúc cứng

**Bitwarden, bản free** (chốt 16/08/2026). **Đừng dùng Chrome password manager cho
việc này.**

Bản free lo đủ tầng 2: không giới hạn số mật khẩu, **đồng bộ không giới hạn thiết
bị** — điểm này bắt buộc vì repo và công việc chạy trên cả Windows lẫn Mac.

Cân nhắc đã làm và vì sao không chọn 1Password:

| | Giá | Ghi chú |
|---|---|---|
| **Bitwarden free** | **0đ** | Chốt. Cần thêm app TOTP riêng (§2.3) và `sops` (§4.2) |
| Bitwarden Premium | ~$19.80/năm | Gộp TOTP vào vault. Tháng 1/2026 tăng gần gấp đôi từ $9.99 |
| 1Password | ~1.8tr/năm | Gấp ~3.5 lần Premium. Đổi lại được `op run` và Emergency Kit |

Thứ duy nhất đáng kể mất khi không dùng 1Password là `op run --env-file` — §4.2 giải
cùng bài toán bằng `sops`. Emergency Kit thay bằng **viết master password ra giấy,
cất offline**; đơn giản hơn, yếu hơn một chút, nhưng chênh lệch nhỏ khi đang hoãn
YubiKey (§2.3.3).

**Bản free bị cắt TOTP từ 2026** (cùng đợt tăng giá) — nên seed 2FA nằm ở app riêng,
xem §2.3. Điều này hợp với luật §2.3.1 sẵn có: 2FA của vault vốn đã không được nằm
trong vault.

### 3.1 Một vault cho mỗi project

```
Private          — cá nhân, không dính project
Identity         — registrar (giữ cả 2 domain .vn), Gmail identity, GitHub,
                   thông tin ngân hàng nhận payout
                   (vault khoá chặt nhất, ít khi mở)
kivora           — Shopify Partner, Render, Neon, Brevo, peppol.sh
tienvu-bt        — VPS, DNS, và các vendor của tienvujsc.com.vn
app-3            — ...
```

Vault-per-project giải một bài toán quan trọng: **project trở thành đơn vị bàn
giao được**. Bán app, thuê người, hay chỉ là ngừng làm — chuyển/xoá đúng một vault.

> **Giới hạn của bản free:** Bitwarden free dùng **folder**, không phải vault tách
> biệt (collection/organization là tính năng trả phí). Cấu trúc trên vẫn dựng được
> bằng folder, nhưng ý "đơn vị bàn giao được" yếu đi: bán app là **export folder
> thủ công**, không phải giao nguyên một vault. Chấp nhận được lúc này; mở khoá
> bằng Premium (§12).

### 3.2 Quy ước đặt tên phải cứng

```
project / vendor / env
```

```
kivora / neon / prod
kivora / neon / dev
kivora / brevo / api
kivora / peppolsh / sandbox
kivora / peppolsh / prod
```

Ba tầng, **luôn luôn**. Lúc có 8 project, cái này là khác biệt giữa "gõ 3 chữ ra
ngay" và "mò 5 phút".

### 3.3 Tài khoản vendor tách theo project

Vault chia theo project rồi, nhưng nếu hai project vẫn dùng **chung một tài khoản
Render** thì việc chia đó chỉ là hình thức. Nguyên tắc "project là đơn vị" phải
xuống tới tầng tài khoản vendor mới trọn.

**Mỗi project một tài khoản riêng ở mỗi vendor.** Bốn lý do, không phải một:

1. **Thao tác nhầm** — xoá nhầm service, restart nhầm app. Lý do dễ thấy nhất và
   cũng là lý do gặp nhiều nhất.
2. **Blast radius** — tài khoản Render của kivora bị chiếm thì tienvu-bt không dính.
3. **Bàn giao** — bán kivora là giao nguyên tài khoản, không phải bóc một service ra
   khỏi account chung.
4. **Billing** — hoá đơn tách sẵn theo project. Đạt được mục tiêu §6.1 mà chưa cần
   thẻ ảo.

> **Kiểm ToS trước:** vài nhà cung cấp cấm một người lập nhiều tài khoản **free
> tier**. Có ít nhất một project trả tiền thì không thành vấn đề.
>
> **Lựa chọn nhẹ hơn:** Render có Workspaces — một login, nhiều workspace, billing
> tách. Ít việc hơn nhưng yếu hơn ở (2) và (3). Chọn tài khoản riêng.

#### 3.3.1 Mailbox thật cho mỗi project, không phải forward

Muốn hai tài khoản Render riêng thì cần hai địa chỉ email khác nhau. Forward về
identity Gmail là đủ để *lập* tài khoản, nhưng **không nên làm** — vì nó phá đúng
cái tính chất khiến identity Gmail có giá trị.

§2.0.4 chọn tài khoản đó *vì nó yên tĩnh, ít thư, và vẫn được đọc*. Đổ vào đó thông
báo của Render, Neon, Brevo, Shopify, VPS thì nó thành hòm thư ồn: nhiều bề mặt
phishing hơn, và cảnh báo bảo mật thật trôi lẫn giữa hàng chục mail "deployment
succeeded". **Hộp thư gốc của cả hệ thống mà thành hộp rác vendor là tự phá kiến
trúc.**

Bốn thứ mailbox thật cho mà forward không:

1. **Gửi được** — trả lời support, xác minh danh tính với vendor.
2. **Có kho để tìm** — "hoá đơn Neon tháng trước đâu" tìm trong hộp kivora.
3. **Bàn giao trọn** — người mua nhận cả lịch sử thư.
4. **Link xác minh nằm đúng profile** — không phải copy-paste qua lại giữa các
   Chrome profile.

| Nhà cung cấp | Giá | Ghi chú |
|---|---|---|
| **Zoho Mail free** | **0đ** | Chốt. Bản free thường **chỉ webmail** — đúng kiểu dùng ở §3.3.2. Kiểm lúc đăng ký: mỗi tài khoản free được mấy domain, và có nhận domain `.vn` không |
| Purelymail | ~$10/năm | Rẻ nhất nhưng webmail yếu, thực tế phải dùng mail client |
| Migadu | ~$19/năm | Không giới hạn địa chỉ và domain, một chỗ quản cả hai. Nâng cấp khi Zoho vướng |

Đổi nhà cung cấp sau này chỉ là trỏ lại MX — **địa chỉ giữ nguyên**, đúng ý §2.1.

**Rủi ro mới sinh ra, phải bù:** thư giờ rơi vào hộp ít mở hơn identity Gmail, nên
cảnh báo billing hay thanh toán lỗi dễ trôi. Lưới đã có: billing alert ở từng vendor
(§6.3), và **lịch nhắc không đi qua email** (§11). Cộng việc mở profile đó thường
xuyên thì rủi ro còn lại nhỏ.

#### 3.3.2 Một Chrome profile cho mỗi project

Tầng vận hành của cùng nguyên tắc. Mở profile là ra đúng bộ đồ nghề của project đó,
đã đăng nhập sẵn, không lẫn.

```
[Profile: Identity]     Gmail identity (địa chỉ: vault Identity/google/bootstrap)
                        registrar · Bitwarden · ngân hàng
                        → giữ YÊN TĨNH. Không dùng để lướt web, không nhận thư vendor

[Profile: kivora]       webmail @kivora.io.vn mở sẵn trong profile
                        Render · Neon · Brevo · Shopify Partner

[Profile: tienvu-bt]    webmail @tienvujsc.com.vn mở sẵn
                        VPS · DNS · vendor riêng
```

Ba điều dễ làm sai:

- **Chrome profile KHÔNG cần tài khoản Google.** Tạo profile local là xong. Mấy địa
  chỉ `kivora-render@` là hộp thư Zoho, không phải tài khoản Google — không có gì để
  "đăng nhập vào Chrome" cả.
- **Đừng bật Chrome sync cho profile project.** Bật là lại đẻ thêm một tài khoản
  Google phải quản, không được gì.
- **Profile là ranh giới chống nhầm lẫn của con người, không phải ranh giới bảo
  mật.** Malware trên máy đọc được mọi profile. Nó là *thêm*, không phải *thay* cho
  password manager.

**Ma sát phải biết trước:** Bitwarden free không tự điền mã TOTP trong trình duyệt,
nên mỗi lần vendor bắt nhập lại 2FA là phải cầm điện thoại. Với người mở 5 vendor để
soát billing thì đó là ma sát hằng ngày — và là lý do Bitwarden Premium có thể đáng
sớm hơn mốc "khi có doanh thu" ở §12. Ma sát vận hành, không phải vấn đề bảo mật.

---

## 4. Tầng 3 — Machine secret: chỗ đang chảy máu nhất

### 4.1 Hiện trạng và bằng chứng

Cùng một giá trị `DATABASE_URL` tồn tại ở `.env` trên laptop, ở dashboard Render,
và trong đầu. **Không bản nào là nguồn sự thật.**

Cụ thể hơn: `DATABASE_URL` của kivora đang làm **hai việc** — dev và prod chung một
URL (T-114 mới tách). Cái đó **không phải bug code**, nó là hệ quả trực tiếp của
việc không có nơi quản secret theo môi trường. Nếu dev và prod là hai config tách
bạch trong một secret manager, sự cố "chạy migrate vào production" đã **không tồn
tại về mặt cấu trúc** — chứ không phải chuyện nhớ hay quên.

### 4.2 Cách làm: `sops` + `age` — secret mã hoá, commit thẳng vào repo

Secret được mã hoá rồi commit cùng code; giải mã bằng một key duy nhất nằm trên máy.
Miễn phí, offline, không phụ thuộc nhà cung cấp nào.

**Hình dạng trong repo:**

```
kivora/
├── .sops.yaml           # file nào mã hoá bằng key nào
├── secrets/
│   ├── dev.env          # ĐÃ mã hoá — commit được
│   └── prod.env         # ĐÃ mã hoá — commit được
└── .env                 # không còn secret nào, hoặc xoá hẳn
```

`.sops.yaml`:

```yaml
creation_rules:
  - path_regex: secrets/.*\.env$
    age: age1<public key của anh>
```

**Chạy:**

```bash
sops exec-env secrets/dev.env 'npm run dev'
sops exec-env secrets/prod.env 'npm run migrate:deploy'
```

`sops exec-env` giải mã trong bộ nhớ và bơm biến vào process — **giá trị thật không
bao giờ nằm plaintext trên đĩa**. Đây là cái tương đương `op run --env-file` của
1Password, và là lý do bỏ 1Password không mất gì về bản chất.

**Điểm quan trọng nhất với hoàn cảnh hiện tại:** `dev.env` và `prod.env` là **hai
file tách bạch**. Đó chính là thứ §4.1 nói đang thiếu — sự cố "chạy migrate vào
production" biến mất về mặt cấu trúc, vì muốn chạm prod phải gõ đúng tên file
`prod.env`, không còn chuyện một `DATABASE_URL` làm hai việc.

Cái này đổi bản chất vấn đề:

- Máy mới chỉ cần cài `sops` + `age` và đặt key vào đúng chỗ là chạy được — không
  phải đi xin file `.env` từ máy cũ.
- Secret **không còn nằm plaintext trong thư mục project** — nơi mà mọi tool, mọi
  extension, mọi agent đều đọc được.
- Secret được **version cùng code**: trả lời được câu "tháng trước key này là gì".
- CI: nạp private key `age` làm repo secret, dùng chung một nguồn.

**Gỡ điểm yếu cố hữu của `sops`:** mất key `age` là mất sạch. Cách bịt — **cất bản
sao private key trong Bitwarden** (`Identity / age / sops-key`). Vault lo việc giữ
key, `sops` lo việc mã hoá. Hai thứ bù nhau đúng chỗ.

**Đường dẫn key khác nhau giữa hai máy** (đã bị đường-dẫn-cứng cắn một lần rồi, xem
§11 Notes):

| | Vị trí `keys.txt` |
|---|---|
| macOS / Linux | `~/.config/sops/age/keys.txt` |
| Windows | `%AppData%\sops\age\keys.txt` |

Tạo key: `age-keygen -o <đường dẫn ở trên>`. Public key in ra màn hình, dán vào
`.sops.yaml`. Private key nằm trong file đó — chép vào Bitwarden ngay.

**Đánh đổi phải biết:** rotate secret là phải commit lại. Với nhịp một người, hai
project thì không phải vấn đề.

> **Lưu ý vận hành:** hook đang **chặn Claude ghi vào `.env*`**. Phần chuyển đổi
> này tự chạy, hoặc gõ `!` rồi lệnh trong session.

### 4.3 Khi nào mới thêm Doppler / Infisical

Khi việc **đồng bộ tay lên hosting bắt đầu lệch**. Cụ thể:

- ≥3 project × ≥2 môi trường, **hoặc**
- lần đầu sửa env var trên Render mà quên sửa `secrets/prod.env`, rồi mất một buổi
  tối đi tìm

Doppler/Infisical có integration bơm thẳng vào Render/Fly/GitHub Actions — sửa một
chỗ, mọi nơi đổi theo. Infisical có free tier và lệnh `infisical run -- npm run dev`
gần y hệt `sops exec-env`, nên đường nâng cấp không phải học lại từ đầu.

**Đừng cài hôm nay**: hai project, mỗi cái một prod thì thêm hệ thống thứ hai chỉ
tốn công.

---

## 5. Chống rò rỉ: một hook rẻ, chặn thất bại đắt nhất

Secret lọt vào git là **loại sự cố duy nhất trong tài liệu này mà rotate xong vẫn
chưa xong** — nó nằm trong history, trong mọi clone, trong cache của GitHub.

```bash
scoop install gitleaks
gitleaks protect --staged --redact
```

Gắn vào pre-commit. Hạ tầng hook đã có sẵn nên chi phí gần bằng không.

> **Bắt buộc:** trước khi tin nó, cắm một fake key vào một file staged và xác nhận
> nó **chặn thật**. Một check chưa từng đỏ là một check chưa từng chạy.

---

## 6. Billing: biến nó thành sản phẩm phụ của cấu trúc trên

### 6.1 Một thẻ ảo cho mỗi project

- Sao kê cuối tháng **chính là P&L theo project** — không phải ngồi phân bổ tay.
- Dừng project = huỷ đúng một thẻ, không sợ chạm nhầm project khác.
- Vendor bị hack chỉ lộ một thẻ có hạn mức.

(Bên phát hành thẻ nào phù hợp thì tự chọn — cái đáng giữ là **mô hình
một-thẻ-một-project**.)

### 6.2 Một inventory cho tất cả project, ngoài repo app

Hình dạng đích là một repo private `ops/`:

```
ops/
├── projects/
│   ├── kivora.md         # vendor, plan, giá/tháng, ngày gia hạn, alias email,
│   │                     # vault item nào, link huỷ, huỷ thì hỏng cái gì
│   └── app-2.md
├── runbooks/
│   ├── render-down.md
│   └── mat-dien-thoai-2fa.md
└── templates/
    ├── new-project.md    # checklist bootstrap
    └── vendor-row.md
```

**File này tuyệt đối không chứa secret — chỉ chứa con trỏ.** Nó nằm ngoài repo
app vì cắt ngang mọi project; và để không đụng luật *"đúng hai tracker"* của
kivora — đây là **reference**, không phải tracker trạng thái.

**Chưa cần dựng repo riêng hôm nay.** Với một project thì inventory để cạnh file
này trong `personal/docs/` là đủ. Tách ra `ops/` khi có project thứ 3, hoặc sớm
hơn nếu cần chia sẻ cho người khác mà không muốn đưa cả dotfiles.

### 6.3 Cảnh báo trên vendor tính theo usage

Neon (compute hours), Render (bandwidth), Brevo (email volume), peppol.sh
(€0.10/document) đều là loại **nhảy vọt lặng lẽ**.

- Bật billing alert ở **từng vendor**
- Một reminder lịch mỗi tháng để rà

Với kivora cái này quan trọng hơn bình thường: per-document fee gắn thẳng vào doanh
thu $0.05/invoice. **Chi phí vượt giá bán mà không ai báo là chuyện có thật.**

### 6.4 Tách cá nhân / business ngay từ giờ

Gỡ ra sau khi đã lẫn 2 năm thì rất đau, nhất là lúc cần số liệu thuế.

### 6.5 Tiền khách trả — đường hoàn toàn khác

Shopify Managed Pricing thu hộ rồi payout về tài khoản Partner. Nghĩa là **thông
tin ngân hàng nhận tiền cũng là một credential**, và nó là cái duy nhất trong danh
sách mà bị chiếm thì **mất tiền trực tiếp**.

→ Thuộc vault `Identity`, khoá chặt nhất. **Không** để trong vault project.

---

## 7. Làm sao biết hệ thống này thật sự chạy

Phần hầu như ai cũng bỏ, và nó làm cả tài liệu trên thành vô nghĩa nếu thiếu.

### 7.1 Cold-start test — mỗi năm một lần, hoặc mỗi lần đổi máy

Dựng một project chạy được **từ số không**, chỉ dùng những gì có trong vault +
repo `ops/`.

Bất cứ thứ gì phải mở laptop cũ ra lấy đều là **một lỗ hổng** — và nó chính là thứ
sẽ thiếu vào đúng hôm laptop cũ chết.

### 7.2 Recovery drill

- Giả định **mất điện thoại**: từ vault, vào lại được Shopify Partner không?
  Không được → TOTP seed chưa vào vault.
- Giả định **mất registrar**: có recovery code in giấy không?
- **Vẽ đồ thị recovery, tìm chu trình.** Mỗi tài khoản một node, cạnh = "recover
  cái này bằng cái kia". Đây là dạng kiểm chứng được của luật §2.0.2, và nó bắt
  đúng hai lỗi mà đọc suông không thấy: bất kỳ **chu trình** nào cũng là một
  deadlock đang chờ ngày; bất kỳ node nào **không có đường xuống tầng vật lý**
  (giấy tờ, thẻ, YubiKey, giấy in) cũng vậy.

### 7.3 Rotation pass — mỗi năm một lần

Xoay hết key ở tầng 3. Không phải vì nghi bị lộ, mà vì **đó là lần duy nhất phát
hiện ra một key đang được dùng ở một chỗ đã quên mất**.

---

## 8. Phụ lục A — `templates/new-project.md`

Đây là thứ giải đúng câu *"mỗi project lại khác nhau"*. Mỗi app mới đi qua **cùng
một checklist theo cùng thứ tự**. Sau ba project, "mỗi cái một kiểu" thành "mọi
cái một kiểu", và không phải nhớ nữa.

```markdown
# Bootstrap project: <tên>

## Identity
- [ ] Tạo alias email cho từng vendor: <project>-<vendor>@<identity domain>
      (chưa có identity domain -> tạm dùng Gmail identity, ghi nợ vào §12)
- [ ] Tạo folder Bitwarden tên <project>

## Tài khoản (theo đúng thứ tự này, vì cái sau cần cái trước)
- [ ] GitHub repo (private)
- [ ] Shopify Partner app  -> lưu client_id / client_secret
- [ ] Dev store
- [ ] Neon: branch dev + branch prod (HAI connection string, không dùng chung)
- [ ] Render service       -> env var trỏ vào Neon prod
- [ ] Brevo                -> API key + xác thực sending domain (DNS)
- [ ] Vendor đặc thù (AP, payment, ...)

## Secret
- [ ] `.sops.yaml` trỏ vào public key age; secrets/dev.env + secrets/prod.env TÁCH BẠCH
- [ ] `sops exec-env secrets/dev.env 'npm run dev'` chạy được
- [ ] Private key age đã cất trong Bitwarden (Identity / age / sops-key)
- [ ] gitleaks pre-commit đã cài VÀ đã test bằng fake key

## Billing
- [ ] Thẻ ảo riêng cho project
- [ ] Billing alert trên mọi vendor tính theo usage
- [ ] Thêm dòng vào ops/projects/<project>.md

## Kiểm chứng
- [ ] Cold-start: clone repo mới ở thư mục khác, chạy được chỉ với vault
```

---

## 9. Phụ lục B — mẫu `projects/kivora.md`

Không secret, chỉ con trỏ.

```markdown
# kivora (repo vẫn tên eivno)

Shopify embedded app · UBL 2.1 Peppol e-invoice + PDF invoice · Belgium MVP
Repo: D:\Project\j\eivno · Domain: kivora.io.vn · Deploy: Render + Neon (live từ 2026-07-24)

| Vendor | Dùng làm gì | Plan / giá | Gia hạn | Alias email | Vault item | Huỷ thì hỏng gì |
|---|---|---|---|---|---|---|
| Shopify Partner | app + billing khách | free | — | kivora-shopify@ | kivora/shopify-app | mất app, mất payout |
| Render | hosting | ? | ? | kivora-render@ | kivora/render/login | app chết |
| Neon | Postgres | ? | ? | kivora-neon@ | kivora/neon/{dev,prod} | mất dữ liệu invoice |
| Brevo | gửi invoice email | ? | ? | kivora-brevo@ | kivora/brevo/api | B-13 ngừng gửi |
| peppol.sh | AP truyền Peppol | €0.10/doc | usage | kivora-peppolsh@ | kivora/peppolsh/{sandbox,prod} | không gửi được invoice |
| Domain | — | ? | ? | — | Identity/registrar | mất luôn mọi alias |

## Cảnh báo riêng
- `DATABASE_URL` đang trỏ CHUNG dev + prod -> mọi `prisma migrate` ghi DDL vào
  production. T-114 tách. Xem §4.1.
- peppol.sh tính €0.10/document trong khi bán $0.05/invoice -> theo dõi sát §6.3.
```

---

## 10. Liên hệ với kivora

**P5 (bảng §1, runbook §13)** trùng lợi ích với **T-114** (tách dev/prod DB) đang nằm
ở Stage 4.1 của `docs/LAUNCH-PLAN.md`. Thực ra không phải "trùng" — **chúng là cùng
một việc**: bước tạo `secrets/dev.env` và `secrets/prod.env` với hai `DATABASE_URL`
khác nhau **chính là** T-114, chỉ khác cái tên.

Làm P5 thì T-114 tự xong: chỉ còn tạo thêm một Neon branch + một item vào vault, chứ
không phải một cuộc phẫu thuật. Đừng lên lịch hai lần cho một việc.

**P4 thì ngược lại — cần thận trọng vì kivora đang live.** Xem cảnh báo ở §13 P4:
đừng migrate service đang chạy chỉ để cấu trúc cho đẹp.

---

## 11. Trạng thái & việc kế (bàn giao — đọc trước khi làm tiếp)

> Viết vào đây thay vì vào worklog, vì worklog nằm ở `~/.gstack/` — **máy-local,
> không đi theo repo**. Repo này dùng trên cả Windows lẫn Mac, nên chỉ file trong
> repo mới chắc chắn tới được máy kia. Cùng tiền lệ với
> `manager-layer-plan-2026-08-12.md` §11c.

**Đã xong 16/08/2026:** đúng tài liệu này, đặt tại `personal/docs/`, cộng thêm
**§2.0** (bootstrap identity) viết cùng ngày. Ngoài hai thứ đó ra **chưa làm gì
cả** — chưa mua domain, chưa lập vault, chưa cài gitleaks. Bảng §1 là thứ tự đề
nghị để bắt đầu.

**Đã quyết 16/08/2026 (§2.0.4):** địa chỉ bootstrap dùng **Gmail cá nhân cũ, chuyên
dụng cho việc quan trọng** (ngân hàng, apply) — không phải email đăng nhập test hằng
ngày, không phải tài khoản lập mới, không phải mailbox trả phí. Là tài khoản cá
nhân, không phải công ty cấp. Vai của nó **vĩnh viễn**: giữ recovery của registrar,
không bao giờ chuyển lên identity domain. Kèm 5 điều kiện và 2 món nợ đã ghi rõ ở
§2.0.4.

**Hiện trạng domain (16/08/2026):**

| Domain | Vai | Registry | Trạng thái |
|---|---|---|---|
| `tienvujsc.com.vn` | product — tienvu-bt | VNNIC | đang chạy, DNS trỏ VPS |
| `kivora.io.vn` | product — kivora | VNNIC | mới mua, **chưa cấu hình gì** |
| `vunt.click` | dev / scratch | gTLD | để nguyên, không dùng vào việc gì |
| — | **identity** | — | ❌ **chưa có** |

Trạng thái audit registrar (cả 2 domain `.vn` chung **một** registrar, nên kiểm một
lần là đủ): 2FA ✅ · auto-renew ✅ · ngày hết hạn ✅ đã biết · lock ⏸️ · **recovery
email ❓ chưa kiểm** · lịch nhắc ❓ chưa đặt.

Ba điều rút ra, ảnh hưởng tới quyết định sau:

- **`vunt.click` không làm identity được.** `.click` là TLD bị lạm dụng nặng nên thư
  đi từ nó bị lọc mạnh, mà nhiều vendor bắt gửi mail từ chính địa chỉ đăng ký để
  khôi phục tài khoản.
- **Domain sản phẩm không kiêm identity được.** Bán app là chuyển domain; và domain
  sản phẩm hết hạn không được phép khoá mình ra khỏi chỗ đi sửa nó.
- **Cả hai domain sản phẩm cùng registry (VNNIC) VÀ cùng registrar** → rủi ro dồn
  một chỗ. Nên khi mua domain identity, chọn **gTLD ở một registrar quốc tế khác**:
  khác registry, khác registrar, khác pháp lý. Độc lập thật, không phải độc lập hình
  thức.

Hai việc nhỏ đã xác định, chưa làm:

- [ ] **Đừng mua gói lock.** `clientTransferProhibited` là trạng thái EPP tiêu chuẩn,
      đa số registrar cho miễn phí. Nếu đang bị bán thành gói trả phí thì xem gói đó
      thực sự gồm gì.
- [ ] **Đừng mua WHOIS privacy cho domain `.vn`.** WHOIS Việt Nam chỉ hiện tên miền,
      thời hạn, tên chủ thể, nhà đăng ký, DNS — thông tin cá nhân chi tiết không công
      khai sẵn rồi.
- [ ] **Chặn spoof cho `kivora.io.vn` ngay** (2 phút, làm được trước cả khi có gì để
      trỏ tới): `@ TXT "v=spf1 -all"` + `_dmarc TXT "v=DMARC1; p=reject;"`. Domain
      chưa gửi mail mà không khai báo gì là domain ai cũng giả mạo được. Nới ra khi
      thật sự cấu hình gửi mail.

**Đã ghi nhận, chưa quyết:** `kivora.io.vn` là domain `.vn` nội địa, trong khi Kivora
bán e-invoice Peppol cho merchant Bỉ/EU — một sản phẩm compliance, nơi tín hiệu tin
cậy đáng giá hơn trung bình, và domain sẽ hiện trên listing Shopify App Store, trong
email gửi khách, trong invoice. Vunt chốt **tạm thời để vậy** (16/08). Thời điểm rẻ
nhất để đổi là BÂY GIỜ, lúc chưa dựng DNS/listing/email lên trên nó; đổi sau khi có
khách là đổi cả listing, cả email, cả link trong invoice đã gửi đi.

**Đã hoãn có chủ ý (16/08/2026):** vunt quyết **chưa** mua domain identity và **chưa**
đổi email đăng nhập của registrar account. `vunt.click` để nguyên, không dùng vào
việc gì. Dự định: **chuyển hết về Gmail identity khi domain hết hạn.**

**Đã chốt tầng 2 + tầng 3 (16/08/2026): bộ free, 0đ.** Vunt thử 1Password (~149k/tháng
≈ 1.8tr/năm) rồi quyết đổi hướng để tiết kiệm tối đa ở giai đoạn này. Ba mảnh:

| Tầng | Công cụ | Chi phí |
|---|---|---|
| 2 — human login | **Bitwarden free** (§3) | 0đ |
| 2FA | **app TOTP có backup mã hoá** — Ente Auth / 2FAS / Aegis (§2.3.2) | 0đ |
| 3 — machine secret | **`sops` + `age`** (§4.2) | 0đ |

Kèm theo: **hoãn YubiKey**, dùng app TOTP làm yếu tố hai (§2.3.3 — điều kiện của §2.3
chưa đạt, và hai thứ phải bù là master password ra giấy + backup TOTP đã thử restore).

Ba thay đổi dây chuyền đã áp vào doc, ghi ra để lần sau đọc không tưởng là mâu thuẫn:

- §3 đổi từ 1Password sang Bitwarden free, kèm giới hạn **folder thay vì vault**.
- §4.2 viết lại hoàn toàn: `op://` reference + `op run` → `sops exec-env` với
  `secrets/dev.env` và `secrets/prod.env` **tách bạch**. Bản chất không đổi (giá trị
  thật không nằm plaintext trên đĩa), và việc tách hai file giải đúng vấn đề §4.1.
- §2.3 đổi app TOTP: bỏ Google Authenticator vì nó đồng bộ seed qua chính tài khoản
  Gmail identity (§2.3.2).

Vunt nói rõ đây là **trạng thái hiện tại, không phải đích** — nâng cấp khi app có
doanh thu. Xem §12.

**Đã chốt tầng vận hành (16/08/2026): tách theo project xuống tận tài khoản vendor.**
Ba mảnh, đều 0đ, ghi ở §3.3:

- **Tài khoản vendor riêng cho mỗi project** — không dùng chung một account Render
  cho cả kivora lẫn tienvu-bt. Bốn lý do ở §3.3, không chỉ "sợ lẫn".
- **Mailbox thật cho mỗi product domain** (Zoho free), **không phải forward** về
  identity Gmail. Lý do quyết định: forward hết về đó sẽ biến hộp thư gốc thành hộp
  rác vendor, phá đúng tính chất "yên tĩnh và được đọc" mà §2.0.4 dựa vào.
- **Một Chrome profile cho mỗi project** + một cho Identity. Là tầng tiện dụng, và
  vunt nói rõ nó **thêm chứ không thay** password manager.

Kèm theo, §2.2 được sửa vì **tự mâu thuẫn**: nó viết "mọi alias trên identity domain"
trong khi lợi ích #1 của chính nó là "bán app là chuyển alias" — mà alias trên
identity domain thì không chuyển được. Luật mới ở §2.2.1: **địa chỉ tầng Identity ở
identity Gmail, địa chỉ tầng Project ở product domain.**

**Bảng §1 đã viết lại thành thứ tự thực thi P0→P7 có phụ thuộc**, và có **§13 Runbook**
chi tiết từng bước kèm bẫy + cách kiểm chứng. Ba thứ runbook lôi ra được mà bản kế
hoạch cũ không thấy:

1. **Hai record chặn spoof ở §11 sẽ chặn luôn Zoho gửi thư** nếu không sửa SPF lúc
   dựng mailbox. Bẫy tự tạo, xem §13 P0.3 — có hai đường đi, khuyến nghị đường A.
2. **`gitleaks protect --staged` không biết gì về history.** Phải chạy
   `gitleaks detect` một lần trên lịch sử cả hai repo trước, và nếu có phát hiện thì
   **rotate**, vì xoá history không gọi các clone đã tồn tại về.
3. **T-114 và P5 là cùng một việc**, không phải hai việc trùng lợi ích (§10).

Ghi lại phần phản biện để lần sau đọc còn thấy nó là lựa chọn, không phải sót:

- **"Khi hết hạn" không phải một trigger.** Auto-renew bật thì domain gia hạn im
  lặng, không bao giờ có sự kiện hết hạn, việc chuyển trôi vô hạn. Auto-renew tắt
  thì có sự kiện thật, nhưng đang lấy nguy cơ mất domain làm đồng hồ báo thức.
  Cách đúng: auto-renew **bật**, và nhắc lịch **riêng** cho việc chuyển — hai việc
  này không phụ thuộc nhau, đổi email đăng nhập lúc nào cũng được.
- **"Chưa có gì nhiều" là lý do làm sớm, không phải lý do hoãn.** Lúc kivora đã
  live, có khách và payout Shopify chạy qua, đổi gốc identity bên dưới là ca mổ;
  bây giờ nó là 10 phút. Cùng logic §1: làm cái khó sửa lại trước.
- Lo ngại **khoá chuyển registrar 60 ngày** (nếu có) chỉ chặn chuyển giữa các
  registrar. Không định chuyển thì nó không tốn gì.

**Sàn tối thiểu phải đúng để kế hoạch hoãn này sống được** — không đụng email đăng
nhập, 20 phút:

- [ ] Auto-renew ON + thẻ còn hạn, cả 2 domain
- [ ] Bật 2FA trên cả 2 registrar account
- [ ] Registrar lock ON
- [ ] **Kiểm recovery không trỏ về chính domain đó** — mục duy nhất không hoãn
      được; có là chu trình §2.0.1, deadlock kín
- [ ] Ngày hết hạn vào lịch, nhắc trước 60 ngày, **không đi qua email** (vunt không
      theo dõi hòm thư đó, nên cảnh báo qua email là cảnh báo không ai đọc)

Khi làm, ghi luôn kết quả **audit** vào Phụ lục B: registrar nào, đăng nhập bằng
email nào, recovery là gì, 2FA loại nào, ngày hết hạn, auto-renew, lock, WHOIS
privacy, DNS quản ở đâu.

**Năm lỗ cố ý trong chính file này**, chờ dữ liệu thật chứ không phải sót:

1. **Chưa có identity domain.** Placeholder `vunt.dev` đã gỡ khỏi §2.2 và Phụ lục B —
   giờ chúng dùng product domain thật, đúng luật hai tầng §2.2.1. Hệ quả: mọi địa chỉ
   **tầng Identity** tạm dùng thẳng Gmail identity thay vì alias. Đó là món **#2** của
   §12, và là thứ duy nhất trong cả tài liệu **không sửa lại được sau** khi đã mua.
2. **Cột `Plan / giá` và `Gia hạn` ở Phụ lục B đang để `?`** — phải mở dashboard từng
   vendor mới điền được. Thu thập trong §13 P0.2 và P6.
3. **Dòng Neon `{dev,prod}` ở Phụ lục B là trạng thái MONG MUỐN**, không phải hiện
   tại: kivora vẫn đang một `DATABASE_URL` chung cho dev lẫn prod. §13 P5 đóng lỗ này
   — và đó cũng chính là T-114 (§10).
4. **Địa chỉ bootstrap cụ thể (§2.0.4) cố ý không ghi** — đi vào vault
   `Identity / google / bootstrap` lúc lập vault (**§13 P1 bước 8**), không vào file
   này. Lý do ở cuối §2.0.4. Chỉ ghi vào file nếu xác nhận được repo là private.
5. **Recovery email của registrar chưa kiểm.** Là mục duy nhất trong sàn tối thiểu
   **không hoãn được** — nếu nó đang trỏ về một địa chỉ trên chính domain đó thì đang
   có chu trình §2.0.1. Xem §13 P0.2 bước 1.

---

## 12. Lộ trình nâng cấp — cái gì đang hoãn, mở khoá bằng gì

Toàn bộ hệ thống hiện tại chạy ở **0đ**. Đó là lựa chọn có chủ ý, không phải giới
hạn kỹ thuật. Bảng này gom mọi thứ đang hoãn vào một chỗ, để lần sau không phải đọc
lại cả tài liệu mới biết còn nợ gì.

**Điều kiện kích hoạt chung: kivora có doanh thu.** Xếp theo thứ tự đáng làm trước.

| # | Nâng cấp | Chi phí | Gỡ được gì | Ghi ở |
|---|---|---|---|---|
| 1 | **YubiKey ×2** | ~$100 một lần | Điều kiện §2.3 mới đủ; mất điện thoại thành phiền phức thay vì đau | §2.3.3 |
| 2 | **Domain identity** (gTLD, registrar quốc tế khác) | ~$10–15/năm | Vai identity đang trống; gỡ việc 2 domain dồn một registry + một registrar | §11 |
| 3 | **Mailbox trả phí** | vài $/tháng | Alias `<project>-<vendor>@`; có kênh khiếu nại với con người; thành recovery **thứ hai** cho registrar | §2.0.4, §2.2 |
| 4 | **Bitwarden Premium** | ~$19.80/năm | TOTP vào vault; collection thật thay vì folder → project lại là đơn vị bàn giao được | §3, §3.1 |
| 5 | **Thẻ ảo per-project** | tuỳ bên phát hành | Sao kê thành P&L theo project. Ít gấp hơn trước vì tài khoản vendor tách theo project đã cho hoá đơn tách sẵn (§3.3) | §6.1 |
| 6 | **Migadu** thay Zoho free | ~$19/năm | Không giới hạn địa chỉ và domain, một chỗ quản cả hai. Chỉ khi Zoho free vướng — đổi chỉ là trỏ lại MX, địa chỉ giữ nguyên | §3.3.1 |
| 7 | **Doppler / Infisical** | free tier | Chỉ khi đồng bộ tay lên Render bắt đầu lệch — có trigger riêng, không đi theo doanh thu | §4.3 |

**Một ngoại lệ về thứ tự:** món #4 (Bitwarden Premium) có thể đáng làm **sớm hơn mốc
doanh thu**, vì lý do khác với những món còn lại — bản free không tự điền mã TOTP
trong trình duyệt, nên mỗi lần soát billing qua 5 vendor là 5 lần cầm điện thoại. Đó
là **ma sát vận hành hằng ngày**, không phải rủi ro bảo mật. Nếu thấy bực thì mua,
đừng chờ (§3.3.2).

Ba thứ **không** nằm trong bảng này vì chúng miễn phí và không có lý do gì để hoãn:
`gitleaks` pre-commit (§5), chặn spoof `kivora.io.vn` bằng 2 record TXT (§11), và
master password viết ra giấy (§2.3.3).

---

## 13. Runbook thực thi — từng bước, kèm bẫy và cách kiểm chứng

Viết ra vì trong lúc làm rất dễ bỏ sót, và vài chỗ **sai là phải làm lại** chứ không
sửa được tại chỗ. Mỗi bước có ba phần: **làm gì** · ⚠️ **bẫy** · ✅ **kiểm chứng**.

Quy tắc chung: **không đánh dấu xong một bước cho tới khi phần ✅ chạy thật.** Một
check chưa từng đỏ là một check chưa từng chạy.

---

### P0.1 — gitleaks (30 phút, không phụ thuộc gì)

1. Cài: `scoop install gitleaks` (Windows) hoặc `brew install gitleaks` (Mac).
2. **Quét LỊCH SỬ trước, cho cả hai repo:**
   ```bash
   gitleaks detect --source . --redact
   ```
3. Nếu có phát hiện: **coi secret đó là đã lộ và rotate nó.** Đừng dừng ở việc xoá
   khỏi history — mọi clone và mọi cache đã có bản cũ, xoá history không gọi chúng về.
4. Gắn pre-commit hook chạy `gitleaks protect --staged --redact`.
5. Test: tạo một file chứa chuỗi trông như API key thật, `git add`, thử commit.

⚠️ **Bẫy:** `gitleaks protect --staged` **chỉ chặn commit mới**. Nó không biết gì về
những gì đã nằm trong history. Bỏ bước 2 là yên tâm giả.

✅ **Kiểm chứng:** commit ở bước 5 **bị chặn thật**. Xoá file test đi. Nếu nó không
chặn, hook chưa gắn đúng.

---

### P0.2 — Sàn tối thiểu registrar (20 phút)

Cả hai domain chung một registrar account, nên phần tài khoản làm **một lần**; phần
auto-renew / lock làm **cho từng domain**.

1. `Account Settings` → đọc **recovery email** đang là gì. Phân loại:
   - identity Gmail → ✅ đúng rồi
   - Gmail dùng nhiều nhất → ⚠️ cần đổi, không gấp
   - **địa chỉ trên chính `kivora.io.vn` hoặc `tienvujsc.com.vn`** → 🔴 **chu trình
     §2.0.1, đổi ngay sang identity Gmail**
2. Kiểm **loại 2FA**. Nếu đang là SMS → chuyển sang app TOTP.
3. Mỗi domain: **auto-renew ON** + kiểm thẻ còn hạn.
4. Mỗi domain: **registrar lock ON**.
5. Lịch nhắc **trước hạn 60 ngày**, báo bằng **thông báo điện thoại**, không phải email.
6. Ghi kết quả audit vào Phụ lục B (registrar, login email, recovery email, loại 2FA,
   ngày hết hạn, auto-renew, lock, WHOIS, DNS).

⚠️ **Bẫy 1:** đổi **registrant contact email** có thể kích hoạt **khoá chuyển
registrar 60 ngày**. Đổi **email đăng nhập / recovery** thì không. Không định chuyển
registrar thì khoá này vô hại, nhưng biết trước đỡ hoảng.

⚠️ **Bẫy 2:** **đừng mua** gói lock trả phí (`clientTransferProhibited` là trạng thái
EPP tiêu chuẩn, thường free) và **đừng mua** WHOIS privacy cho domain `.vn` (WHOIS
Việt Nam vốn đã không công khai thông tin cá nhân chi tiết).

✅ **Kiểm chứng:** mục 1 trả lời được bằng một câu, và nếu là 🔴 thì đã đổi xong.
Đây là mục duy nhất trong P0.2 **không hoãn được**.

---

### P0.3 — Chặn spoof `kivora.io.vn` (5 phút) — ĐỌC KỸ, có bẫy tự tạo

Domain chưa gửi mail mà không khai báo gì là domain **ai cũng giả mạo được**.

**Nhưng:** hai record dưới đây nói "domain này KHÔNG gửi mail". Đặt xong rồi dựng
Zoho ở P2 mà quên sửa thì **thư của chính anh bị từ chối**, và triệu chứng sẽ trông
như lỗi Zoho chứ không như lỗi DNS. Đây là loại lỗi mất nửa buổi để tìm.

Chọn **một** trong hai đường:

| Đường | Khi nào | Làm gì |
|---|---|---|
| **A — bỏ qua P0.3** | P2 làm trong vài ngày tới | Khai báo SPF/DKIM/DMARC **đúng một lần** lúc dựng Zoho ở P2. Ngắn gọn hơn, ít bẫy hơn. **Khuyến nghị** |
| **B — làm P0.3 ngay** | P2 còn xa | Đặt 2 record dưới, và **ghi vào lịch** rằng P2 bắt buộc phải sửa chúng |

Record của đường B:

```
@         TXT    v=spf1 -all
_dmarc    TXT    v=DMARC1; p=reject;
```

⚠️ **Với `tienvujsc.com.vn`: kiểm xem domain này ĐANG có mail chạy chưa** trước khi
đụng bất cứ record mail nào. Nó đang trỏ VPS và đã hoạt động — nếu VPS đang chạy mail
server thì sửa MX/SPF là cắt mail đang chạy.

✅ **Kiểm chứng:** dùng một công cụ tra DNS bất kỳ, xác nhận record đã lan (mất tới
vài giờ).

---

### P1 — Bitwarden + app TOTP (2 tiếng)

**Nền phải có trước P2/P4** — không thì lập tài khoản xong lại phải quay lại nhập
credential, và giai đoạn ở giữa là lúc credential nằm lung tung nhất.

1. Đăng ký **Bitwarden free**, email tài khoản = identity Gmail.
2. **Viết master password ra giấy NGAY**, cất offline. Không chụp ảnh, không lưu
   file, không để trong Drive. Bitwarden **không khôi phục hộ được** — tờ giấy này là
   đường về duy nhất (§2.3.3).
3. Cài app TOTP mới (**Ente Auth** / 2FAS / Aegis), bật **backup mã hoá**.
4. **Test restore backup** trên một thiết bị khác *trước khi* tin nó. Backup chưa
   từng restore là backup không tồn tại.
5. Bật 2FA cho chính Bitwarden, seed để trong **app TOTP** — **không** để trong
   Bitwarden (§2.3.1: 2FA của vault không nằm trong vault).
6. Chuyển **hai seed quan trọng nhất** khỏi Google Authenticator: **registrar** và
   **Gmail identity**.
7. Tạo 3 folder: `Identity` · `kivora` · `tienvu-bt`.
8. Nhập item đầu, đặt tên theo `project / vendor / env` (§3.2):
   - `Identity / registrar / <tên registrar>`
   - `Identity / google / bootstrap` ← **ghi địa chỉ Gmail identity ở đây**. Việc này
     đóng **lỗ #4** của §11.

⚠️ **Bẫy 1:** chuyển TOTP seed **không import được** — Google Authenticator export
theo định dạng riêng. Phải **tắt 2FA rồi bật lại** ở từng dịch vụ và quét QR mới. Lúc
tắt, tài khoản đang hở → làm từng cái một, ngồi yên, đừng làm lúc vội.

⚠️ **Bẫy 2:** **đừng xoá khỏi Google Authenticator ngay.** Giữ song song vài ngày,
xác nhận app mới sinh mã đăng nhập được rồi mới xoá.

⚠️ **Bẫy 3:** bật lại 2FA thường **sinh recovery code mới** — code cũ hết hiệu lực.
Lưu code mới vào đúng item Bitwarden, và với hai cái ở bước 6 thì **in ra giấy**.

✅ **Kiểm chứng:** đăng xuất Bitwarden hoàn toàn, đăng nhập lại **chỉ bằng những gì
có trên giấy + app TOTP**. Không vào được nghĩa là chưa xong.

---

### P2 — Zoho Mail cho hai domain (1–2 tiếng)

**Làm `kivora.io.vn` trước** (chưa có gì nên sai cũng không hỏng ai), `tienvujsc.com.vn` sau.

1. Đăng ký **Zoho Mail free**. Kiểm ngay hai điều: mỗi tài khoản free được **mấy
   domain**, và có nhận domain `.vn` không. Nếu chỉ một domain thì lập **hai tài
   khoản free**, mỗi domain một cái — vẫn 0đ, và hợp với việc tách profile.
2. Thêm domain, xác minh bằng record TXT Zoho cấp.
3. Đặt **MX** theo Zoho.
4. **Cập nhật SPF** — nếu đã đặt `v=spf1 -all` ở P0.3 thì **thay** nó bằng chuỗi Zoho
   cấp (dạng `v=spf1 include:zoho.com ~all`). Bỏ bước này là thư đi bị từ chối.
5. Thêm **DKIM** theo Zoho cấp.
6. **DMARC: bắt đầu ở `p=none`**, quan sát vài ngày, rồi siết `p=quarantine` →
   `p=reject`. Để `p=reject` ngay lúc SPF/DKIM chưa đúng là tự chặn thư của mình.
7. Tạo địa chỉ per-vendor: `kivora-render@` · `kivora-neon@` · `kivora-brevo@` ·
   `kivora-shopify@` (hoặc một hộp chính + alias, tuỳ Zoho free cho phép).
8. Lặp cho `tienvujsc.com.vn`.

⚠️ **Bẫy 1 — `tienvujsc.com.vn` đang chạy:** đổi MX **không** ảnh hưởng website (A
record riêng), nhưng **cắt mail đang chạy** nếu domain này đã có mail. Kiểm trước.

⚠️ **Bẫy 2:** DNS lan chậm. Đừng kết luận "Zoho hỏng" trong vài giờ đầu.

✅ **Kiểm chứng — cả hai chiều, cho mỗi domain:**
- Gửi một mail **từ ngoài vào** mỗi địa chỉ → phải nhận được.
- Gửi một mail **đi** từ địa chỉ đó tới một Gmail khác → phải vào **inbox, không phải
  spam**. Rơi spam nghĩa là SPF/DKIM chưa đúng.

---

### P3 — Chrome profile (30 phút)

1. Tạo **3 profile local**: `Identity` · `kivora` · `tienvu-bt`. Đặt tên và **màu
   khác nhau** — màu là thứ ngăn nhầm lẫn nhanh hơn tên.
2. Cài **Bitwarden extension** vào cả ba.
3. Profile `kivora`: mở webmail Zoho của `kivora.io.vn`, **ghim tab**.
4. Profile `tienvu-bt`: tương tự với `tienvujsc.com.vn`.
5. Profile `Identity`: chỉ registrar · Bitwarden web · ngân hàng. **Không dùng để
   lướt web**, không nhận thư vendor.

⚠️ **Bẫy:** **đừng bật Chrome sync** cho profile project. Không cần tài khoản Google
để tạo profile; bật sync là lại đẻ thêm một tài khoản Google phải quản.

✅ **Kiểm chứng:** đăng nhập **hai tài khoản Render khác nhau ở hai profile cùng
lúc**, không cái nào đá cái nào.

---

### P4 — Tách tài khoản vendor ⚠️ BƯỚC NGUY HIỂM NHẤT

**kivora đang LIVE.** Đây là bước duy nhất trong cả runbook có thể làm sập
production. Đọc hết mục này trước khi bấm gì.

**Bước 0 — kiểm kê trước, đừng làm gì cả.** Với mỗi vendor (Render, Neon, Brevo,
Shopify Partner, VPS, peppol.sh), ghi ra: tài khoản hiện tại đăng nhập bằng email
nào, đang chứa service của project nào, có đang chung hai project không.

Kiểm kê xong sẽ thấy hai loại việc **rất khác nhau**:

**Loại A — lập mới** (project đó chưa có tài khoản ở vendor này). Dễ, không rủi ro:

1. Mở **đúng Chrome profile** của project.
2. Lập tài khoản bằng địa chỉ `<project>-<vendor>@<product domain>`.
3. **Lưu credential vào Bitwarden folder tương ứng NGAY**, đừng để cuối buổi.
4. Bật 2FA, seed vào app TOTP.
5. Rồi mới dựng service.

**Loại B — tách một tài khoản đang chứa cả hai project.** Đây là chỗ nguy hiểm.

> **Khuyến nghị mạnh: đừng migrate cái đang live chỉ để cấu trúc cho đẹp.**
>
> - Áp cấu trúc mới cho **những gì lập mới từ giờ trở đi**.
> - Cái đang live thì migrate trong **một cửa sổ có chủ đích** — lúc rảnh, có backup,
>   có đường lùi — chứ không phải nhân tiện đang làm thì làm luôn.
> - Nếu vendor cho **transfer service giữa hai tài khoản** thì dùng đường đó, đừng
>   dựng lại từ đầu.
> - **Trước khi di chuyển bất cứ gì: export toàn bộ env var ra chỗ an toàn**
>   (Bitwarden). Env var là thứ mất nhiều nhất trong các ca migrate hỏng.
> - Xác nhận cái mới chạy được **rồi mới** đụng cái cũ. Đừng xoá trước.

⚠️ **Bẫy:** vài nhà cung cấp cấm một người lập nhiều tài khoản **free tier**. Kiểm
ToS nếu cả hai project đều định nằm trên gói free.

✅ **Kiểm chứng:** mở profile `kivora` → vào Render → **chỉ thấy service của
kivora**, không thấy gì của tienvu-bt. Và ngược lại.

---

### P5 — `sops` + `age` (1 tiếng)

1. Cài `sops` và `age` trên **cả hai máy**. Đường dẫn key khác nhau — xem bảng ở §4.2.
2. `age-keygen -o <đường dẫn theo bảng §4.2>` → public key in ra màn hình.
3. **Chép private key vào Bitwarden ngay**: `Identity / age / sops-key`. Đây là thứ
   bịt điểm yếu "mất key là mất sạch" của `sops`.
4. Tạo `.sops.yaml` ở gốc repo kivora, dán public key vào.
5. Tạo `secrets/dev.env` và `secrets/prod.env`. **Hai `DATABASE_URL` khác nhau** —
   cần một Neon branch dev riêng. Đây chính là **T-114**, và nó là mục đích của cả
   bước này, không phải việc phụ.
6. `sops -e -i secrets/dev.env` và `sops -e -i secrets/prod.env`.
7. Xoá giá trị thật khỏi `.env`; đảm bảo `.env` nằm trong `.gitignore`.
8. Đổi lệnh chạy: `sops exec-env secrets/dev.env 'npm run dev'`.
9. CI: nạp private key `age` làm repo secret.

⚠️ **Bẫy 1 — nguy hiểm nhất ở bước này:** commit `secrets/*.env` lúc **chưa** mã hoá.
Trước khi commit, mở file ra nhìn: nội dung phải là **rác mã hoá**, không đọc được.

⚠️ **Bẫy 2:** hook đang **chặn Claude ghi vào `.env*`**. Phần này tự làm, hoặc gõ `!`
rồi lệnh trong session.

✅ **Kiểm chứng, hai cái:**
- `git show HEAD:secrets/prod.env` → không đọc được nội dung.
- App chạy được qua `sops exec-env`, và `npm run dev` **không** còn chạy được nếu
  thiếu key — chứng tỏ giá trị thật đã rời khỏi đĩa.

---

### P6 — Billing (1 tiếng)

1. Bật **billing alert ở từng vendor tính theo usage**: Neon (compute hours), Render
   (bandwidth), Brevo (email volume), peppol.sh (per-document).
2. Reminder lịch **mỗi tháng** để rà.
3. Điền đủ Phụ lục B: giá, ngày gia hạn, alias email, item Bitwarden, **huỷ thì hỏng
   cái gì**. Cột cuối là cột hay bị bỏ và là cột có giá trị nhất lúc khủng hoảng.

⚠️ **Riêng kivora:** peppol.sh tính €0.10/document trong khi bán $0.05/invoice. Chi
phí vượt giá bán mà không ai báo là chuyện có thật (§6.3).

---

### P7 — Template (1 tiếng)

Viết `templates/new-project.md` từ Phụ lục A. Project thứ ba đi qua đúng checklist
này là toàn bộ giá trị của cả tài liệu.

---

### Kiểm chứng toàn hệ thống — làm sau khi xong P0→P5

Ba bài ở §7, làm một lượt:

1. **Vẽ đồ thị recovery, tìm chu trình** (§7.2). Mỗi tài khoản một node, cạnh =
   "recover cái này bằng cái kia". Chu trình = deadlock đang chờ ngày. Node không có
   đường xuống tầng vật lý = cũng vậy.
2. **Cold-start** (§7.1): clone repo ở thư mục khác, dựng lại chỉ bằng Bitwarden +
   Phụ lục B. Thứ gì phải mở máy cũ ra lấy là một lỗ.
3. **Recovery drill** (§7.2): giả định mất điện thoại — từ giấy + Bitwarden có vào
   lại được registrar không?

---

## Nguồn của mấy con số

Giá cả trong tài liệu này là **ước lượng tại thời điểm ghi (2026-08-16)** và có
thể đã đổi. Kiểm lại trên trang pricing của từng vendor trước khi quyết:
Bitwarden, 1Password, Doppler, Infisical, Google Workspace, Ente Auth.

Chính sách xoá tài khoản không hoạt động 2 năm (§2.0.3) tra ngày 2026-08-16 tại
[Inactive Google Account Policy](https://support.google.com/accounts/answer/12418290)
và [thông báo gốc trên blog Google](https://blog.google/innovation-and-ai/technology/safety-security/updating-our-inactive-account-policies/).
Chính sách đổi được — kiểm lại trước khi dựa vào nó.
