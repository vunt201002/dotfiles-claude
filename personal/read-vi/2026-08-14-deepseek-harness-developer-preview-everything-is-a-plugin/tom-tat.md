# DeepSeek Harness developer preview: Everything is a plugin — tóm tắt (DeepSeek)

> Nguồn: https://deepseek.com/harness/en/ (trang không ghi ngày đăng)
> Bản dịch đầy đủ: [dich.md](dich.md)
> Loại: **tóm tắt + giải thích, do Claude viết** — KHÔNG phải lời tác giả, không phải bản dịch.
>   Chỗ nào cần nguyên văn thì đọc bản dịch, đừng trích file này.
> Viết: 2026-08-14

## Mọi thứ đều là plugin

DeepSeek Harness vào developer preview, ra kèm source code. Thứ được ra không phải model, mà là
lớp harness quanh model.

## Harness giữ cho agent làm được việc

Công thức đặt giữa trang: `Agent = Model + Harness`. Model là "linh hồn"; harness lo phần cho
agent hiểu môi trường nó đang chạy, dùng tool, làm việc liên tục ngoài thực tế. Một dòng đó là
chỗ giải thích gọn nhất bài.

Ba trụ: **Cordis kernel** lo mount, unmount plugin và dependency, nhưng không giữ năng lực nào.
**Capabilities as plugins** — năng lực đều đến từ plugin, gồm cả model, tool, skill, session,
sandbox, storage, loop, scheduling và UI; plugin phối hợp qua service và event của Cordis.
**Compose with configuration** — chọn, thay, mở rộng ngay trong config, không đụng source code.

Cơ chế đáng nhớ: kernel rỗng, năng lực nằm ngoài, ghép bằng config.

## Lần chạy nào cũng truy lại được

Phần này nhắc lại ba trụ trên, ý mới nằm ở tính truy vết. Session log dạng append-only ghi mọi
thứ model thấy: system prompt, reasoning, tool call và kết quả, lịch chạy subagent, từng lần nhét
context vào. Trajectory view cho soi theo từng nguồn.

Đáng chú ý: resume, fork, search, replay chạy trên cùng một event stream — không phải bốn tính
năng rời, mà bốn cách đọc cùng một dòng sự kiện.

## Nhiều runtime mode

Phần cụ thể nhất bài:

| Mode | Có gì |
|---|---|
| Standard | coding agent đầy đủ: sửa file, shell, search file/web, skill, planning, goal, subagent, workflow |
| Code | đúng năng lực Standard, khác ở chỗ tool expose qua Code Mode SDK để model gộp nhiều bước vào một chương trình TypeScript |
| Minimal | hai tool: bash chạy xuyên suốt và `str_replace_editor`, để benchmark model trong môi trường tối giản |
| Creator | Standard cộng soi runtime, thử plugin trong memory, hướng dẫn viết preset tuỳ chỉnh |

## Tuỳ biến

Một video demo, chỉnh element trên trang, tool và preset agent ngay lúc chạy.

## Dùng thử hoặc cài từ source

Cài Node.js rồi chạy `npx @deepseek-ai/dsh web`, hoặc clone repo rồi làm theo hướng dẫn setup.

## Vào hệ sinh thái plugin DSH

Vẫn ở developer preview, plugin lõi và API còn thay đổi tiếp. Mã nguồn mở, licence MIT.

## Rút lại

Ra harness kèm source → kernel rỗng (Cordis) + năng lực đóng thành plugin → ghép bằng config →
mọi lần chạy đọc lại được từ một event stream duy nhất.

1. Thứ được ra là lớp harness quanh model, kèm source, không phải model.
2. Kernel không giữ năng lực nào, nên đổi hành vi bằng config chứ không phải sửa source.
3. Một session log append-only là nền chung cho resume, fork, search, replay.
4. Bốn mode khác nhau ở bộ tool chứ không ở model; Minimal dựng riêng để benchmark.
