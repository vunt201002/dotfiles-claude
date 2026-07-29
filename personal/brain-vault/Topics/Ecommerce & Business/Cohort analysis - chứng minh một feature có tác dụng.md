---
type: concept
created: 2026-07-29
updated: 2026-07-29
tags: [learn]
---
# Cohort analysis - chứng minh một feature có tác dụng

Kỹ năng để không phải đoán khi tuyên bố "app của em làm tăng doanh thu".
Dùng tiếp store "Lumi" ở [[Chỉ số tiền trong ecommerce - trace một đơn hàng]].

## Vấn đề: số tổng nói dối

Lumi cài Joy tháng 4. Ba tháng sau mở báo cáo:

```
Tháng    Repeat rate (% đơn từ khách đã từng mua)
Jan  22% | Feb 23% | Mar 22% | Apr 20% (cài Joy) | May 19% | Jun 18%
```

Kết luận hiển nhiên: cài Joy xong repeat rate tụt, app phá hoại. SAI HOÀN TOÀN.

Tháng 4 Lumi cũng tăng gấp 3 tiền ads: ~540 khách mới/tháng -> ~1.500. Đám khách mới
đó theo ĐỊNH NGHĨA mới mua đúng 1 lần. Đổ 1.500 người mới toanh vào mẫu số thì tỉ lệ
repeat bắt buộc phải giảm, kể cả khi chất lượng giữ chân đang tốt lên.

```
Repeat rate =  khách đã mua lại
              ─────────────────
              TỔNG khách   <- thằng này vừa phình gấp 3
```

Số tổng trộn lẫn hai thứ khác nhau: "kiếm được bao nhiêu khách" (hiệu quả marketing)
và "khách có quay lại không" (chất lượng retention). Trộn vào một số thì không đọc
được cái nào. Tệ hơn: tháng đẩy ads mạnh nhất lại làm chỉ số trông xấu nhất, khiến
người ta đi sửa đúng cái không hỏng.

## Cohort là gì

Nhóm khách theo THÁNG HỌ MUA LẦN ĐẦU, rồi theo dõi từng nhóm theo TUỔI, không theo
ngày tháng. Ví von: thay vì hỏi "hôm nay server thế nào", hỏi "deploy hôm 12/3 sau 5
ngày ra sao — so với deploy 20/3 sau 5 ngày".

Mỗi khách vào ĐÚNG MỘT cohort vĩnh viễn (tháng mua đầu tiên, không bao giờ đổi).
Nhờ vậy mẫu số bị ĐÓNG BĂNG: nhóm tháng 3 luôn có đúng 540 người, ads tăng gấp 10
cũng không đụng được vào con số đó.

## Bảng cohort

```
Cohort   Size    M+1    M+2    M+3    M+4    M+5
Jan       500    12%    18%    22%    25%    27%
Feb       520    12%    17%    21%    24%
Mar       540    13%    18%    22%
Apr      1500    18%    25%    30%          <- Joy bật từ đây
May      1600    19%    26%
Jun      1550    20%
```

Hàng = nhóm mua lần đầu tháng đó. Cột = sau bao nhiêu tháng. Ô = % đã mua lại.
Bảng khuyết góc là ĐÚNG, không phải thiếu data — nhóm tháng 6 mới sống 1 tháng.

## Ba chiều đọc

**NGANG ->** một cohort già đi: Jan 12% -> 18% -> 22% -> 25% -> 27%.
Cho biết bao lâu khách quay lại, đường cong bão hoà ở đâu. Dùng để dự báo LTV,
biết nên nhắc khách vào ngày thứ mấy.

**DỌC (chiều quan trọng nhất)** cột M+1: 12% -> 12% -> 13% -> 18% -> 19% -> 20%.
So các nhóm ở CÙNG ĐỘ TUỔI nên công bằng tuyệt đối, không bị ảnh hưởng bởi nhóm nào
to hơn hay vào mùa nào. ĐÂY LÀ CHIỀU DÙNG ĐỂ CHỨNG MINH MỘT THAY ĐỔI CÓ TÁC DỤNG.
Nhảy 13% -> 18% ở cùng mốc M+1 là tín hiệu thật; cột M+2 xác nhận (17-18% -> 25-26%).

**CHÉO** các ô cùng rơi vào một tháng dương lịch. Cả đường chéo nhô lên = có sự kiện
chung: sale, BFCM, viral, hoặc đứt hàng.

## Kết luận cho câu hỏi của sếp

```
SỐ TỔNG NÓI:              COHORT NÓI:
22% -> 18%                M+1: 13% -> 20%
"app làm tệ đi"           "giữ chân tốt lên ~54%"
```

Cùng một dữ liệu, chỉ một cái đúng. Số tổng tụt vì kiếm khách mới nhanh gấp 3 — tin
tốt bị hiển thị thành tin xấu.

## Cohort doanh thu -> nối thẳng vào LTV và payback

Đổi ô thành TIỀN TÍCH LUỸ trên mỗi khách (theo contribution margin, không phải doanh thu):

```
Cohort    M+0     M+1     M+2     M+3     M+4     M+5
Jan      $23,9   $26,8   $31,2   $36,0   $41,3   $45,1
Apr      $23,9   $28,2   $35,7   $43,0
```

1. **Payback**: CAC $20, nhóm Jan vượt ngay ở M+0. Nếu CAC $40 thì nhóm Jan mất ~M+3,
   nhóm Apr chỉ ~M+2.
2. **LTV thật (không phải đoán)**: nhóm Jan 5 tháng đạt $45,1, đường cong phẳng dần
   -> LTV cuối quanh $50-55.
3. **Trần chi CAC**: LTV ~$50, muốn giữ LTV/CAC = 3 thì CAC tối đa ~$17. Con số này
   quyết định được phép trả bao nhiêu cho một click.

Nhóm Apr chạy nhanh hơn Jan ở mọi mốc -> Lumi giờ có quyền chi CAC cao hơn để giành
thị phần. Đó là loại kết luận mà một app loyalty đáng tiền phải nói được cho merchant.

## SQL dựng cohort

```sql
WITH first_order AS (
  SELECT customer_id,
         DATE_TRUNC('month', MIN(created_at)) AS cohort_month
  FROM orders
  GROUP BY customer_id
),
activity AS (
  SELECT f.cohort_month,
         o.customer_id,
         (EXTRACT(YEAR FROM o.created_at) - EXTRACT(YEAR FROM f.cohort_month)) * 12
       + (EXTRACT(MONTH FROM o.created_at) - EXTRACT(MONTH FROM f.cohort_month))
           AS month_number
  FROM orders o
  JOIN first_order f USING (customer_id)
),
cohort_size AS (
  SELECT cohort_month, COUNT(DISTINCT customer_id) AS total_customers
  FROM first_order
  GROUP BY cohort_month
)
SELECT a.cohort_month,
       c.total_customers,
       a.month_number,
       COUNT(DISTINCT a.customer_id) AS returning_customers,
       ROUND(100.0 * COUNT(DISTINCT a.customer_id) / c.total_customers, 1) AS retention_pct
FROM activity a
JOIN cohort_size c USING (cohort_month)
WHERE a.month_number > 0
GROUP BY a.cohort_month, c.total_customers, a.month_number
ORDER BY a.cohort_month, a.month_number;
```

Cohort doanh thu: thay COUNT(DISTINCT customer_id) bằng SUM(contribution) rồi chia
total_customers, cộng dồn bằng SUM(...) OVER (PARTITION BY cohort_month ORDER BY month_number).

**Ba bẫy khi implement:**

| Bẫy | Hậu quả |
|---|---|
| tính month_number bằng trừ ngày rồi chia 30 | lệch mốc, tháng 28-31 ngày làm sai cột |
| quên DISTINCT customer_id | khách mua 3 lần/tháng bị đếm 3 -> retention vượt 100% |
| đưa cohort chưa đủ tuổi vào so sánh | nhóm mới chỉ có M+1, đem so M+5 là so sai |

## QUAN TRỌNG NHẤT: cohort KHÔNG tự chứng minh nhân quả

Bảng cohort cho thấy retention tăng SAU khi cài Joy. Nó không chứng minh Joy GÂY RA
điều đó. Tháng 4 có thể còn: đổi bao bì, ra sản phẩm mới, đổi agency ads (khách chất
lượng hơn), hoặc chỉ là mùa vụ.

**Bẫy chết người — so member vs non-member.** Câu quảng cáo quen thuộc của mọi app
loyalty: "khách tham gia loyalty chi tiêu gấp 3 lần khách thường!". Gần như luôn vô
nghĩa vì nhân quả chạy ngược:

```
SAI:   vào loyalty -> nên mua nhiều hơn
THẬT:  vốn đã mua nhiều -> nên mới thèm vào loyalty
```

Đây là SELECTION BIAS. Khách trung thành nhất là người tự tìm đến chương trình tích
điểm. Kể cả khi app không làm gì cả, số đó vẫn đẹp.

**Ba mức bằng chứng:**

| Mức | Cách làm | Độ tin |
|---|---|---|
| Yếu | so member vs non-member | dính selection bias, đừng dùng để tuyên bố |
| Khá | cohort trước/sau khi cài | tốt, nếu chứng minh được tháng đó không đổi gì khác |
| MẠNH | holdout test | bằng chứng thật |

## Holdout — cách làm đúng

Khách mới vào thì random giữ lại 10% KHÔNG cho vào chương trình. So hai nhóm trong
CÙNG một cohort:

```
Cohort Apr — 1.500 khách, chia ngẫu nhiên:
           Số người   M+1    M+2    M+3
Có Joy      1.350     18%    25%    30%
Holdout       150     13%    18%    22%
Chênh lệch            +5đ    +7đ    +8đ
```

Vì chia NGẪU NHIÊN, hai nhóm giống hệt nhau mọi mặt khác (cùng mùa, cùng nguồn ads,
cùng sản phẩm). Khác biệt duy nhất là có Joy hay không. Đây mới là bằng chứng.
Quy ra tiền: 1.350 x 8% x $23,90 = ~$2.580 lợi nhuận thêm, cho một app $49.

Merchant ban đầu hay ghét holdout ("sao lại tự bỏ 10% khách?"). Nhưng đó chính là thứ
giữ họ ở lại lâu dài — tới kỳ cắt giảm chi phí, họ có số thật để bảo vệ app.

## Áp dụng cho Joy

Dashboard nên trả lời đúng thứ tự:

| Ưu tiên | Hiện gì | Vì sao |
|---|---|---|
| 1 | bảng cohort retention trước/sau khi cài | merchant tự nhìn thấy chiều dọc |
| 2 | cohort doanh thu tích luỹ + LTV, payback | nối vào bài toán CAC họ đang đau |
| 3 | holdout so sánh (nếu có) | bằng chứng mạnh nhất, đối thủ không có |
| KHÔNG | "đã phát 40.000 điểm" | số của app, không phải số của merchant |

Về kỹ thuật, TỪ NGÀY ĐẦU phải lưu:

- customer_id + timestamp đơn hàng ĐẦU TIÊN (cohort gán một lần, không đổi)
- timestamp cài app (vạch phân chia trước/sau)
- cờ holdout gán lúc khách vào, ngẫu nhiên, BẤT BIẾN — đổi là hỏng thí nghiệm
- contribution margin mỗi đơn (hoặc ít nhất doanh thu + COGS); không có thì chỉ tính
  được LTV theo doanh thu, tức con số phóng đại

Ba thứ đầu PHẢI có từ lúc bắt đầu. Không dựng lại quá khứ được: khách đã vào chương
trình rồi thì không còn cách nào biết họ sẽ ra sao nếu không vào.
