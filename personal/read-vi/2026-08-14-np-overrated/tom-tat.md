# NP-overrated — tóm tắt (Niklas Gruhn)

> Nguồn: https://gruhn.me/blog/2026-08-13/ (đăng 13/8/2026)
> Bản dịch đầy đủ: [dich.md](dich.md)
> Loại: **tóm tắt + giải thích, do Claude viết** — KHÔNG phải lời tác giả, không phải bản dịch.
>   Chỗ nào cần nguyên văn thì đọc bản dịch, đừng trích file này.
> Viết: 14/8/2026

## Định kiến, và nó tới từ đâu

Học NP-hard xong thì phần đọng lại thường là: lý thuyết giải được, thực tế thì đắt tới mức
vô vọng, coi như đã chứng minh xong là không có thuật toán nào tử tế. Tác giả nhận chính ông
cũng vậy. Chỗ giải thích hay nhất bài là một mẩu ký ức chứ không phải lập luận: lời ông giáo
sư chốt buổi cuối, đại ý gần như mọi bài toán thú vị đều undecidable, phần sót lại gần như
đều NP-hard, thế là xong cho cả ngành. Nó đắt vì cho thấy định kiến này **được dạy**, chứ
không phải ai cũng tự suy ra.

## Lỗ hổng: lý thuyết chỉ nói về worst-case

Thuật toán nào rồi cũng nổ trên *một số* input. Điều đó không cấm nó chạy nhanh trên 99.9%
input, hay trên 100% số input có dính dáng tới thực tế dù chỉ chút xíu. Câu của Benjamin
Brewster được đặt đúng bản lề này.

## Bằng chứng, theo ba nhóm trong danh sách 5 bài toán

- **dependency resolution, type checking** — worst-case không xảy ra ngoài đời. Chậm thì có,
  nhưng cả đời đi làm tác giả chưa gặp vụ nổ nào cỡ thiên hà.
- **scheduling, Traveling Salesman** — bài toán tối ưu, và heuristic không phải đường duy
  nhất: có solver cho ra nghiệm **chứng minh được là tối ưu** trong thời gian chấp nhận được.
  Không phép màu, không máy tính lượng tử. Gộp cả phần tăng tốc do thuật toán lẫn phần do
  hardware, một paper được dẫn ghi nhận nhanh lên 450 tỉ lần trong quãng 1991 tới 2015; riêng
  phần thuật toán còn vượt hardware.
- **SAT** — mẫu mực của họ NP-hard mà vẫn được giải ở quy mô lớn, đều đặn. Amazon chạy
  một tỉ bài toán SMT mỗi ngày, mà SMT còn khó hơn SAT; SAT giờ bị coi là phần dễ.

Phép so sánh hay nhất bài ở câu chốt: đụng đúng worst-case thì xử y như một HTTP request
không thấy quay về, thêm timeout rồi hiện báo lỗi.

## Rút lại

NP-hard là phát biểu về worst-case trên **mọi** input → ngoài đời chỉ gặp một lát cắt rất hẹp
của tập đó → nên riêng chữ "NP-hard" không kết luận được gì về bài toán trước mặt.

1. Lấy "NP-hard" làm lý do bỏ cuộc là dùng sai định lý.
2. Với bài toán tối ưu, nghiệm chứng minh được là tối ưu là chuyện có thật, có tool làm được.
3. Worst-case là chuyện vận hành: timeout rồi báo lỗi, y như một request không về.
