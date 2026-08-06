# Anchors — đoạn tiếng Việt đọc thuận, dùng làm few-shot

> **Vai:** `/read-vi` nạp file này cùng `vi-conventions.md` ở **pass 1** và **pass 2**.
> `vi-conventions.md` dạy bằng **luật** (cấm cái gì). File này dạy bằng **ví dụ** (nghe ra
> sao thì đúng). Văn phong truyền qua ví dụ tốt hơn qua luật rất nhiều — luật chặn được
> cái sai đã biết tên, ví dụ mới dạy được nhịp.

> **Cách dùng:** đọc 2-3 anchor gần chế độ đang làm (`VIẾT LẠI` hay `DỊCH SÁT`) ngay trước
> khi viết. Không copy câu chữ. Bắt lấy **nhịp**: câu dài bao nhiêu, ngắt ở đâu, xưng hô
> gì, thuật ngữ để tiếng Anh chỗ nào.

---

## Anchor được tính là tốt khi nào

Một đoạn chỉ vào file này khi **user nói nó đọc thuận**, hoặc nó vượt sạch `§C1` cơ học và
user không sửa chữ nào. Tiêu chí:

- Đọc lên nghe như dev Việt viết, không như bản dịch.
- Không có cấu trúc nào trong `vi-conventions.md §B1`.
- Thuật ngữ tiếng Anh nằm đúng chỗ, không bị dịch cho "thuần Việt".
- Có **nhịp**: câu ngắn xen câu vừa, không phải một chuỗi câu cùng độ dài.

Không đủ tiêu chuẩn: đoạn "không sai gì" nhưng nhạt. Anchor nhạt kéo cả bài về mức nhạt.

---

## A1 — VIẾT LẠI · giọng `mình` *(TẠM — do agent viết, chưa qua user duyệt)*

> Cache không làm code chạy nhanh hơn. Nó chỉ làm mình khỏi phải chạy lại. Khác biệt nghe
> nhỏ, nhưng nó quyết định chỗ đặt cache: sát nơi tính toán đắt nhất, chứ không phải sát
> nơi request đi vào. Hồi mình cache ở tầng HTTP, hit rate 90% mà p99 vẫn xấu. 10% miss
> vẫn phải đi hết đường cũ, và đường cũ mới là vấn đề.

**Vì sao nó thuận:** năm câu, dài ngắn xen nhau, câu mở chỉ 7 từ. Chủ ngữ là vật thật
(`cache`, `10% miss`), không phải danh từ hoá (`việc cache`, `sự gia tăng`). Không chữ
`của` nào. Không `rằng`. Thuật ngữ `cache` · `hit rate` · `p99` · `miss` để nguyên tiếng
Anh. Ý phản đề nằm ở dấu hai chấm chứ không phải em-dash.

---

## A2 — DỊCH SÁT · giọng `bạn` *(TẠM — do agent viết, chưa qua user duyệt)*

> Trước khi chạy migration, dump lại database. Lệnh dưới tạo file kèm timestamp nên chạy
> nhiều lần cũng không đè lên nhau:
>
> ```
> pg_dump -Fc mydb > backup-$(date +%s).dump
> ```
>
> Bảng lớn hơn 50GB thì thêm `--jobs=4`. Đừng dùng `--jobs` với format plain text: nó bị
> bỏ qua im lặng, bạn sẽ tưởng đang chạy song song mà thực ra không.

**Vì sao nó thuận:** chế độ `DỊCH SÁT` nên số (`50GB`), flag (`--jobs=4`), lệnh giữ nguyên
byte, nhưng câu vẫn là câu tiếng Việt. Câu điều kiện bỏ cặp `Nếu… thì… sẽ…` (`§B1 #19`),
còn lại `Bảng lớn hơn 50GB thì thêm…`. Cảnh báo đặt ở cuối vì đó là chỗ người đọc sắp
phạm lỗi, không phải vì bản gốc để nó ở đó.

---

## Cách thêm anchor mới

1. User chỉ vào một đoạn và nói nó đọc được (`/read-vi anchor <file> <đoạn>`), hoặc bài
   nào đi qua pass 2 mà user không sửa chữ nào.
2. Append một mục mới ở cuối file: tiêu đề `## A<n> — <chế độ> · giọng <xưng hô>`, đoạn
   trích trong blockquote, rồi **một khối "Vì sao nó thuận"**.
3. Khối "vì sao" là phần bắt buộc. Một đoạn hay mà không nói được nó hay ở đâu thì chỉ là
   văn mẫu; nói được thì nó dạy được.
4. Bỏ nhãn *(TẠM)* khỏi A1/A2 khi user đã duyệt, hoặc **thay hẳn** chúng bằng anchor thật
   của user. Hai cái đầu do agent tự viết, chúng là chỗ giữ chỗ chứ không phải chuẩn.

Giữ khoảng 6-10 anchor, chia đều hai chế độ. Nhiều hơn thì bỏ cái yếu nhất, đừng cộng dồn
vô hạn: anchor có tác dụng vì nó ít và sắc.
