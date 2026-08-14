# How I use LLMs to learn complex topics — Laurentiu Raducu (VIẾT LẠI tiếng Việt)

> Nguồn: https://laurentiugabriel.github.io/blog/articles/how-i-use-llms-to-learn/ (đăng 9/8/2026)
> Chế độ: VIẾT LẠI (1 đảo DỊCH SÁT: list 4 bước ở mục "Quy trình") — bài quan điểm, đọc một lần lấy ý; riêng 4 bước là thứ làm theo được nên khoá lại, cấm rút
> Xưng hô: mình
> Pass 2 (editor mù nguồn): 5 vòng · điểm vòng cuối: nhịp câu 9 · từ ngữ 9 · xưng hô 10 · mạch đoạn 9 · thuật ngữ 10
> Pass 3 (soát nghĩa): 12 finding · đã sửa 11 · 1 xử lý bằng chính header này (ghi nguồn) · còn lại: không còn
> Đóng vì: mọi dimension ≥9 và editor vòng cuối báo không sửa thực chất; soát nghĩa vòng cuối trả không còn finding

---

# Cách mình dùng LLM để học mấy chủ đề phức tạp

Giờ người ta dùng LLM vào đủ thứ việc, và học cái mới là kiểu hay gặp nhất nhì.

Dân engineer quanh mình xài generative AI vào khá nhiều việc: dựng PoC, làm tool nội bộ, làm dashboard, hay học cái mới. Riêng mình thì đọc LLM giải thích một hồi là lạc mất. Nó đơn giản hoá quá tay, mà rắc nhiều emoji quá thì đọc hơi khó chịu.

![Quy trình làm ra con chip, kể bằng simulation kiểu RollerCoaster Tycoon](https://laurentiugabriel.github.io/blog/images/ChipTycoon.png)

Có đợt mình ngồi phân tích mấy bottleneck mới của AI, tức mấy thứ có thể làm chậm chuyện dựng data center. Ngồi làm mới thấy sản xuất chip còn nhiều mảng mình không biết. Đang lướt web thì nảy ra ý: có hẳn một cái game dẫn mình đi hết quy trình làm chip trong fab thì sao? Học kiểu đó thì nhớ lâu, vì khái niệm bám được vào vật thể trong game. Mình thử, và ngon thật.

## Quy trình

Thay vì bảo AI giải thích chủ đề đó, mình làm thế này:

<!-- DỊCH SÁT -->
* Trong plan mode (dùng CC hoặc OpenCode), mình bảo model dựng phần kiến thức nền cho chủ đề X.
* Mình bảo nó kiểm lại knowledge base vừa dựng ở bước trên xem có đúng không.
* Rồi mình bảo nó dựng simulation cho chủ đề đó, dạng animation low-poly kiểu Rollercoaster Tycoon. Mình thêm vài yêu cầu UX nữa: trang phải xem được trên cả màn hình lớn lẫn nhỏ, có control để dừng luồng chạy bất cứ lúc nào, v.v.
* Xong thì mình push lên repo mới rồi bật GitHub Pages.
<!-- /DỊCH SÁT -->

## Kết quả

Làm xong là có animation đẹp, chính xác 100%, không hallucination. Với mình, cách này ăn đứt chuyện đọc mớ tài liệu vô tận trên Google, hay cố nuốt cái bulleted list model nhả ra.

Mình làm hẳn một cái để học chuyện sản xuất chip: [ChipTycoon](https://laurentiugabriel.github.io/ChipTycoon/). Vào đó là đi theo một chiếc xe goòng, từ lúc xúc cát lên cho tới lúc con chip hoàn thiện và giao tới data center.

Đi theo chiếc xe goòng là thấy nó đổi dạng dần. Low-poly nên chi tiết có thể thiếu, nhưng vẫn đủ để hình dung qua mỗi bước trong dây chuyền thì sản phẩm ra hình gì.

## Làm sao cho ngon hơn

Bản low-poly có khi bắt tưởng tượng hơi nhiều: nhìn đống cát quartz thì khó hình dung nó đã qua những gì sau khi rời lò. Muốn thật hơn thì lấy [skill biến ảnh thành object 3d](https://github.com/LaurentiuGabriel/unreal-game-assets-creation-skill) của mình, rồi map mấy object đó vào simulation. Nhìn sát thực tế hơn.

Thêm challenge vào simulation cũng được. Tự trả lời câu hỏi về một bước đã đi qua trong quy trình làm chip thì kiến thức bám lâu hơn hẳn. Nhét thêm mấy puzzle dễ hiểu nữa thì học càng vào.

Mấy trang khác mình làm:

* [Động cơ tên lửa được làm ra sao](https://laurentiugabriel.github.io/rocket-engine/)
* [LLM chạy thế nào](https://laurentiugabriel.github.io/token-town/)
* [Động cơ F1 được dựng ra sao](https://laurentiugabriel.github.io/engineworks/)
* [Cỗ máy EUV được dựng thế nào](https://laurentiugabriel.github.io/euv-lithography/)
