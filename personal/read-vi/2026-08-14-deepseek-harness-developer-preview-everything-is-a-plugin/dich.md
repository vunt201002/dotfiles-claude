# DeepSeek Harness developer preview: Everything is a plugin — DeepSeek (DỊCH SÁT tiếng Việt)

> Nguồn: https://deepseek.com/harness/en/ (trang không ghi ngày đăng)
> Tóm tắt: [tom-tat.md](tom-tat.md)
> Chế độ: DỊCH SÁT — người đọc gõ lại đúng hai câu lệnh và chọn runtime mode theo tên, nên sai một chữ là chạy sai thứ; bài lại đã rất gọn, không có phần nào để rút.
> Xưng hô: bạn
> Pass 2 (editor mù nguồn): 3 vòng · điểm vòng cuối: nhịp câu 8 · từ ngữ 8 · xưng hô 10 · mạch đoạn 9 · thuật ngữ 9
> Pass 3 (soát nghĩa): 6 finding · đã sửa 4 · còn lại: không còn (2 finding còn lại là dòng tiêu đề + dòng nguồn, đã nằm ngay trong header này)

_Nhãn: DeepSeek Harness developer preview · badge: Developer preview_

## Mọi thứ đều là plugin

DeepSeek Harness giờ đã vào developer preview, mở cho dev khắp nơi đang làm agent harness. Kèm luôn source code.

Model, tool, skill, session, sandbox, storage, loop, scheduling, UI: năng lực nào cũng là một plugin, tháo ra lắp vào hay ghép lại kiểu khác đều được.

Link: View on GitHub -> https://github.com/deepseek-ai/deepseek-harness

Tab: Quick start

```
$ npx @deepseek-ai/dsh web
```

Tab: Install from source

```
$ git clone https://github.com/deepseek-ai/deepseek-harness
```

---

_Badge: Agent = Model + Harness_

## Harness giữ cho agent làm được việc trong môi trường thật

Model là linh hồn của agent.

Harness cho agent hiểu được môi trường nó đang chạy, dùng được tool và làm việc liên tục trong bối cảnh thực tế.

### Cordis kernel  _(nhãn: CORDIS KERNEL)_
  [Cordis kernel trỏ tới https://github.com/cordiverse/cordis]

Cordis kernel lo mount, unmount plugin và quản lý dependency. Năng lực của agent nằm hết trong plugin.

### Capabilities as plugins  _(nhãn: CAPABILITIES AS PLUGINS)_

Năng lực của agent đều đến từ plugin, gồm cả model, tool, skill, session, sandbox, storage, loop, scheduling và UI. Plugin phối hợp với nhau qua service và event của Cordis.

### Compose with configuration  _(nhãn: COMPOSE IN CONFIGURATION)_

Dev chọn, thay hoặc mở rộng năng lực nào cũng được, làm ngay trong config chứ không cần đụng vào source code của DeepSeek Harness.

---

_Nhãn: Design approach_

## Mọi thứ đều là plugin. Lần chạy nào cũng truy lại được.

### Mọi thứ đều là plugin

DeepSeek Harness dựng trên plugin system của Cordis. Năng lực của agent đều đến từ plugin, gồm cả model, tool, skill, session, sandbox, storage, loop, scheduling và UI. Plugin phối hợp với nhau qua service và event của Cordis. Dev chọn, thay hoặc mở rộng năng lực nào cũng được, làm ngay trong config chứ không cần đụng vào source code của DeepSeek Harness.

_Ảnh: Ghép model, tool, storage và agent loop lại với nhau bằng config của Cordis_
_Ảnh: Màn Settings của DeepSeek Harness, hiện danh sách plugin đã cài, kèm trạng thái từng cái_

### Lần chạy nào cũng truy lại được

Model thấy gì thì session log ghi lại hết theo kiểu append-only: system prompt, reasoning, tool call và kết quả trả về, lịch chạy subagent, từng lần nhét context vào. Ở Trajectory view, bạn soi lại đống bản ghi đó theo từng nguồn. Resume, fork, search, replay đều chạy trên cùng một event stream.

_Ảnh: Dựng lại nguyên một lần chạy chỉ từ một session log_

### Nhiều runtime mode

Standard mode có đủ bộ tool. Code mode dùng code do model sinh ra để điều phối nhiều vòng tool call. Minimal mode chỉ giữ một shell tool và một file editor để benchmark model trong môi trường tối giản. Creator mode cho bạn soi runtime đang chạy, test plugin Cordis ngay trong memory, rồi ghép chúng thành mode mới.

_Ảnh: Màn chọn mode lúc mở session mới, liệt kê Standard, Code, Minimal và Creator mode_

Màn chọn mode (danh sách trên UI, dòng gợi ý: "Describe what you want to build"):

- **Standard mode** là coding agent đầy đủ: sửa file, shell, search file và web, skill, planning, goal, subagent, workflow.
- **Code mode**: vẫn đúng bộ năng lực của Standard mode, chỉ khác ở chỗ tool được expose qua Code Mode SDK, để model gộp nhiều bước vào chung một chương trình TypeScript.
- **Minimal mode** là coding agent hai tool: bash chạy xuyên suốt và str_replace_editor.
- **Creator mode**: dựng riêng để tạo preset agent tuỳ chỉnh, có hết năng lực Standard mode, cộng thêm phần soi runtime, thử nghiệm plugin và hướng dẫn viết preset.

---

## Tuỳ biến DeepSeek Harness theo ý bạn

Xem cách tuỳ biến element trên trang, tool và preset agent ngay lúc đang chạy.

_Video: Video demo tính năng sản phẩm DeepSeek Harness_

---

_Nhãn: Get started_

## Dùng thử ngay hoặc cài từ source

### Quick start

Cài Node.js, rồi bật Web UI bằng npx.

```
$ npx @deepseek-ai/dsh web
```

_Ảnh: Web UI nền tối của DeepSeek Harness, đang phân tích một project, chuyển qua lại giữa Chat và Trajectory_

### Install from source

Clone toàn bộ source rồi làm theo hướng dẫn setup trong repository.

```
$ git clone https://github.com/deepseek-ai/deepseek-harness
```

_Ảnh: Clone, cài, build, rồi bật Web UI của DeepSeek Harness từ source_

---

_Nhãn: Developer preview_

## Vào hệ sinh thái plugin DSH

DeepSeek Harness vẫn ở developer preview, mấy dev làm agent harness đang thử nó. Plugin lõi và API của nó còn thay đổi tiếp. DeepSeek mong cùng dev khắp nơi khám phá giới hạn của trí tuệ, bằng hạ tầng mã nguồn mở, dùng lại và ghép lại đều được.

Link: View on GitHub -> https://github.com/deepseek-ai/deepseek-harness · Developer docs -> https://deepseek-harness.github.io/deepseek-harness/en/guide/quickstart · Community plugins -> https://github.com/topics/dsh-plugin
