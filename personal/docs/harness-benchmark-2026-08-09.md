# Harness benchmark 09/08/2026 — đối chiếu harness của mình với bên ngoài

> Tiếp nối [[claude-smarter-research-2026-07-20.md]]. Bài đó hỏi *"làm Claude thông minh hơn
> bằng cách nào"*; bài này hỏi *"so với thiên hạ thì mình đang thủng chỗ nào"*.
>
> Nguồn đọc trong ngày, cuối file. Case study Microsoft tách riêng:
> [[azure-sre-context-engineering-2026-08-09.md]].

## 1. Mặt bằng thật — mình đang ở đâu

Con số đáng giá nhất: một nghiên cứu quét **2.853 repo GitHub** trên 5 nền (Claude Code,
Copilot, Cursor, Gemini, Codex), phân loại 8 cơ chế cấu hình. Kết luận:

> Context Files chiếm áp đảo và **thường là cơ chế DUY NHẤT** trong một repo. Rất ít repo dùng
> Skills và Subagents, và **Skills phần lớn là chỉ dẫn tĩnh chứ không phải code chạy được**.

Mặt bằng chung = *một file CLAUDE.md*. Mình có 29 skill + 5 hook chặn + statusline + decision
log + gbrain + workflow.md với cổng bằng chứng + cặp builder/judge có rubric. **Không phải phân
vị trên của phân bố — mà là ngoài phân bố.** Nên phần còn lại không phải "học ai", mà là "chỗ
nào còn thủng".

Framework soi: **ETCLOVG** (Execution · Tooling · Context · Lifecycle · Observability ·
Verification · Governance). Survey đo mật độ dự án open-source theo tầng: Lifecycle 47,
Verification 21, Execution 20, **Observability 15, Governance 14** — và ghi nhận hai tầng cuối
*"mỏng trong open source, thường nằm trong sản phẩm thương mại"*. Đúng hai tầng mình cũng mỏng.

Câu đáng ghim: *"Harness over model — chỉnh kiến trúc harness cho lợi 5-20 điểm phần trăm, độc
lập với việc đổi model."*

## 2. Hơn ở đâu

| | Mình | Mặt bằng |
|---|---|---|
| Skill | chạy được, route xuống tool, có cổng | chỉ dẫn tĩnh |
| Luật | hook `exit 2` chặn thật | prose trong CLAUDE.md |
| Đóng task | spec-check bằng **agent fresh** chỉ nhận spec + diff | review chung chung |
| Chất lượng chủ quan | builder + judge, judge tự mở Chrome chấm | tự chấm |

**spec-check ở A8/B9** là thứ sắc nhất và hiếm nhất. Case study *"Cheap Code, Costly Judgment"*
đúc kết: code rẻ đi, **phán đoán mới là chỗ đắt**; cơ chế hiệu quả là *"lọc nhiều tầng để giảm
tải review phía sau"*, cơ chế thất bại là *"tin rằng chất lượng output của agent làm mất nhu cầu
soi"*. Mình đã cấu trúc hoá cả hai vế: fresh reviewer không được đọc lý luận lúc build, judge bị
cấm sửa code.

Repo `Chachamaru127/claude-code-harness` có `/harness-sync` bắt drift, nhưng so plan vs code
trong **cùng context** — bản của mình dùng context sạch nên bắt được lớp lỗi nó bỏ sót.

## 3. Kém ở đâu

**Governance — yếu nhất.** `pre-tool-use-guard.sh` là regex denylist trong bash. Đối chứng,
harness kia có **Runtime Floor**: 5 nhóm (billing, network egress, đọc secret, deploy prod, xoá
ngoài scope), phán xử **trước khi thực thi**, **không có công tắc tắt**, cộng **approval token
có hạn dùng và phạm vi**. Guard của mình nhị phân: chặn hoặc không. Một `git reset --hard` chính
đáng không có đường đi hợp lệ.

**Observability — thủng nhất, và thủng theo cách tự che.** Guard **không ghi log gì cả**.
Harness kia ghi mọi lần chặn ra JSONL kèm rule ID + category + verdict. Hệ quả cụ thể: 08/08
phát hiện guard chặn nhầm `echo "hướng dẫn: đừng dùng rm -rf ~"` — sẽ không bao giờ biết chuyện
đó xảy ra bao nhiêu lần. Mà README của chính mình viết *"mỗi hook chỉ thêm/siết SAU KHI quan sát
một failure THẬT"* — nguyên tắc đúng, nhưng không có cơ chế nào để quan sát.

**Số liệu trong workflow.md là số đi mượn.** *"spec-check bắt ~60-70% lỗi lớp này"*, *"prose
25-40% vs hook 95%"* — đến từ research 20/07, không phải dữ liệu của mình. Chạy vài tháng rồi
vẫn không biết cổng nào thật sự bắt được gì.

**Chi phí 29 skill không ai đo.** `harness-authoring.md` viết: *"`description:` nạp vào context
MỌI session, dù skill không được gọi"*. 29 skill cá nhân + ~40 skill gstack = mọi session đều
trả tiền. Không có gì đo skill nào chưa từng chạy.

**Giả định macOS.** 08/08 vỡ 4 chỗ trên Windows, đều là **lỗi câm**: jq thiếu → guard thành
no-op; `bash` trên PATH là WSL bash; `.js` bị `"type":"module"` biến thành ESM; `harness-check`
hardcode path Mac. Không phải giả thuyết — cả 4 sống trong repo suốt thời gian đó.

## 4. Năm việc nên làm, đã xếp thứ tự

1. **Ghi log mỗi lần guard chặn** (JSONL: thời điểm, rule khớp, lệnh, verdict). ~10 dòng bash.
   Biến việc tune denylist từ cảm tính thành dữ liệu, vá đúng tầng mỏng nhất. Làm trước vì rẻ
   nhất và mở đường cho mọi thứ sau.
2. **Chạy `/checkup`** — native Claude Code từ v2.1.205 (07/2026, `/doctor` viết lại, `/checkup`
   là alias). Dọn skill/MCP/plugin không dùng để tiết kiệm context, dedup CLAUDE.md, **tắt hook
   chậm**. Không trùng `harness-check.sh` (cái đó lo symlink) — **bổ sung**: cái của mình bắt
   "chưa link", cái kia bắt "link rồi nhưng chả ai gọi".
3. **Cross-platform doctor.** Một script chạy 5 hook với JSON fixture ngay trên máy hiện tại. Cả
   4 lỗi 08/08 đều bị nó bắt trong 2 giây. Fixture đã viết sẵn khi wire hook.
4. **Sổ kết quả cổng.** Mỗi lần B2 / spec-check / judge thật sự bắt được gì → một dòng. Sau 2
   tháng biết cổng nào đáng giữ, cổng nào chỉ tốn lượt.
5. **Approval token có phạm vi + hạn** (mượn Chachamaru). Thay vì chặn cứng, cho phép "duyệt cho
   task này, hết hạn sau X". **Chỉ làm sau bước 1** — log sẽ cho biết rule nào thật sự cần đường
   thoát.

## 5. Cái KHÔNG nên lấy

- **Runtime Floor viết bằng Go** — over-engineering cho một người.
- **Fleet 135 agent** (Everything Claude Code) — nghiên cứu cho thấy subagent ít ai dùng được tử
  tế; cặp builder/judge đã lấy phần giá trị nhất. Xem thêm vách 4-handoff của Microsoft.
- **HTML decision surface cho người không phải kỹ sư** — không có đối tượng đó.

## 6. Case study

**Microsoft Azure SRE Agent** → tách riêng: [[azure-sre-context-engineering-2026-08-09.md]].
Tóm một dòng: từ 100+ tool và 50+ sub-agent xuống 5 tool lõi và một nhúm generalist, **đáng tin
hơn**. Số GA (không nằm trong bài kỹ thuật): 35.000+ incident, App Service TTM 40,5 giờ → 3 phút.

**OpenAI, beta nội bộ 2026** — hơn **1 triệu dòng code, không dòng nào người gõ tay**, dưới ràng
buộc cứng *"no manual code"*. Ràng buộc đó chính là thứ **ép** họ xây harness tử tế. Cùng logic
với *"prove trước khi build"*: chất lượng bị chặn trên bởi ràng buộc mình tự đặt, không phải bởi
model.

---

## Nguồn

- [Awesome Harness Engineering](https://github.com/ai-boost/awesome-harness-engineering)
- [Agent Harness Engineering: A Survey](https://picrew.github.io/LLM-Harness/) — ETCLOVG
- [Harness Engineering for Agentic AI Coding Tools](https://arxiv.org/abs/2602.14690) — 2.853 repo.
  **Chỉ đọc được abstract**, PDF fetch ra binary.
- [Cheap Code, Costly Judgment](https://arxiv.org/pdf/2607.01087)
- [Chachamaru127/claude-code-harness](https://github.com/Chachamaru127/claude-code-harness)
- [Boris Cherny — /checkup](https://x.com/bcherny/status/2074997570317779038) ·
  [/checkup explained](https://mcp.directory/blog/claude-code-checkup-command-2026)
