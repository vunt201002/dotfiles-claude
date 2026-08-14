# NP-overrated — Niklas Gruhn (VIẾT LẠI tiếng Việt)

> Nguồn: https://gruhn.me/blog/2026-08-13/ (đăng 13/8/2026)
> Tóm tắt: [tom-tat.md](tom-tat.md)
> Chế độ: VIẾT LẠI (3 đảo DỊCH SÁT: 2 khối trích dẫn, list 5 bài toán) — essay quan điểm, không có bước làm, không param, không code; dịch lệch một từ thì mất ý chứ người đọc không làm sai.
> Xưng hô: mình
> Pass 2 (editor mù nguồn): 4 vòng — 3 vòng văn phong, cộng 1 vòng sửa nghĩa có mục tiêu
> Pass 3 (soát nghĩa): 4 finding · đã sửa 4 · còn lại: không còn.
> Điểm bản ĐANG LƯU (vòng 4 chấm, trước khi biết phạm vi bị khoá): nhịp câu 9 · từ ngữ 9 · xưng hô 10 · mạch đoạn 9 · thuật ngữ 10
> Vẫn không tính là đóng: vòng 4 chỉ được phép sửa một cụm từ, nên `Sửa thực chất: KHÔNG` của nó không phải phán quyết tự do. Điểm thì tự do — chấm xong mới biết phạm vi.
> Số, URL, tên riêng: đã đối chiếu với bản gốc (5/5 URL, 99.9% · 100% · 450 tỉ · 1991 · 2015, list 5 bài toán, 2 khối trích dẫn). Không có khối code.

# NP-overrated

13/8/2026

Ai học NP-hard hồi đại học thì chắc cũng đọng lại đúng ý này:

Bài toán NP-hard giải được trên lý thuyết, nhưng ngoài thực tế thì đắt tới mức vô vọng. *Coi như* đã chứng minh xong: không tồn tại thuật toán nào tử tế.

Ít nhất mình đọng lại như vậy. Gần như ai mình từng nói chuyện cùng cũng vậy. Lên mạng cũng thấy đầy người nghĩ thế. Mình gặp hoài mấy cuộc cãi nhau kiểu *"Không làm được đâu. NP-hard mà. Blah blah"*. Định kiến đó lan khắp nơi, mà mấy bài toán kia không hề vô phương.

Hồi đó ông giáo sư dạy mình chốt buổi cuối bằng một câu rất kịch tính (mình diễn đạt lại hơi khác một chút):

> Thế là các em học xong rồi đấy: gần như mọi bài toán thú vị đều undecidable, còn trong đám sót lại thì gần như tất cả là NP-hard.
> Đó là cái đinh cuối cùng đóng lên nắp quan tài của cả ngành khoa học máy tính.

Trời ạ. Không biết có phải ai cũng bị dạy theo cái khung ảm đạm cỡ đó không. Nếu đúng vậy thì lý giải được nhiều thứ.

Lý thuyết không sai, chỉ là ngoài thực tế nó thường chẳng ăn nhập gì. Ừ thì thuật toán nào nghĩ ra được cũng có một mớ input làm nó nổ. Nhưng nó vẫn có thể chạy nhanh trên 99.9% input. Hoặc trên 100% số input dính dáng tới việc đang làm, dù dính dáng ít tới đâu. Lý thuyết không loại trừ chuyện đó.

> Trên lý thuyết, lý thuyết với thực tế không khác gì nhau. Nhưng trên thực tế thì có.
>
> -- Benjamin Brewster

Vài bài toán NP-hard nổi tiếng:

1. Dependency resolution (trong package manager)
2. Type checking (không phải type system nào cũng vậy)
3. Scheduling
4. Traveling Salesman
5. Boolean Satisfiability (SAT)

Với (1) và (2), cái worst-case đó không xảy ra, thế thôi. Ý mình là cài package hay type check chậm thì có chậm thật. Nhưng ít nhất trong đời đi làm của mình, chưa lần nào thấy nó phình lên cỡ thiên hà.

(3) với (4) thì đúng ra là bài toán tối ưu. Ai cũng biết mấy bài đó xử được bằng heuristic, nhưng không nhất thiết phải hi sinh nghiệm tối ưu. Ngoài đời [có sẵn](https://www.gurobi.com/) [công cụ](https://github.com/scipopt/scip) [làm được](https://developers.google.com/optimization/introduction) chuyện đó: tìm ra nghiệm chứng minh được là tối ưu, trong thời gian chấp nhận được. Không có phép màu nào cả. Không có máy tính lượng tử nào cả. Chỉ là nghĩ kỹ hơn rồi tìm ra thuật toán tốt hơn. Người ta làm đúng vậy thật. Mấy chục năm qua, thuật toán tăng tốc còn nhanh hơn cả hardware. Gộp cả hai phần lại, [bài paper này](https://scispace.com/pdf/best-subset-selection-via-a-modern-optimization-lens-353jtit2ms.pdf) dẫn ra con số nhanh lên 450 tỉ lần, tính từ 1991 tới 2015.

Cuối cùng là (5), tức bài toán tiêu biểu của cả họ NP-hard. Người ta vẫn đều đặn giải nó ở quy mô lớn. Amazon giải [một tỉ bài toán SMT mỗi ngày](https://www.amazon.science/blog/a-billion-smt-queries-a-day). SMT là bản còn khó hơn của SAT. Thuật toán SAT giờ giỏi tới mức SAT bị coi là phần dễ.

Nhỡ đụng đúng cái worst-case thì sao? Thì cũng không phải ngồi đợi tới lúc vũ trụ chết nhiệt. HTTP request cũng có lúc đi mà không về. Thêm timeout, hiện cái báo lỗi ra... mấy chiêu đó quen rồi.
