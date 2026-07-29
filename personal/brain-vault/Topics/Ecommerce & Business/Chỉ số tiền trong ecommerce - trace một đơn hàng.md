---
type: concept
created: 2026-07-29
updated: 2026-07-29
tags: [learn]
---
# Chỉ số tiền trong ecommerce - trace một đơn hàng

Cách hiểu nhanh nhất mấy chỉ số tiền: trace một đơn hàng từ đầu tới cuối, như debug
một request. Store ví dụ "Lumi" bán skincare trên Shopify. Số liệu là ví dụ dựng cho
dễ hiểu, không phải số thị trường — nhưng TỈ LỆ giữa chúng đúng với đời thật.

Nền chung -> [[Công thức tăng trưởng ecommerce và từ điển chỉ số]]

## Trace một đơn hàng

Khách mua serum $50, dùng mã giảm 10%.

```
Giá niêm yết                        $50,00   <- GMV / Gross sales
- Discount 10%                    -  $5,00
= Net Revenue                       $45,00   <- "doanh thu" thật sự

- COGS (chai, serum, nhãn, hộp)   - $12,00
= Gross Profit                      $33,00   -> Gross margin = 33/45 = 73%

- Ship (freeship, shop chịu)      -  $6,00
- Đóng gói, pick & pack           -  $1,50
- Phí thanh toán (2,9% + $0,30)   -  $1,60
= Contribution Margin              $23,90   <- trước tiền marketing
```

## Chỗ mọi thứ tách đôi

```
KHÁCH MỚI                      KHÁCH CŨ QUAY LẠI
Contribution     $23,90         Contribution     $23,90
- CAC          - $20,00         - CAC          -  $0,00
= LỜI            $3,90          = LỜI           $23,90
```

Cùng sản phẩm, cùng giá, cùng đơn hàng. Chênh HƠN 6 LẦN.
Đây là toàn bộ lý do ngành loyalty tồn tại, gói trong một con số. Không phải
marketing nói cho hay — nó là số học.

## P&L cả tháng (2.000 đơn)

```
Gross Sales (GMV)                  $100.000   2.000 đơn x $50
- Discounts                       - $10.000
- Returns (5%)                    -  $4.500
NET REVENUE                         $85.500

- COGS                            - $24.000
GROSS PROFIT                        $61.500   -> gross margin 72%

- Ship + đóng gói                 - $15.000
- Phí thanh toán                  -  $3.200
CONTRIBUTION trước marketing        $43.300   -> 50,6% doanh thu

- Marketing / ads                 - $25.000
CONTRIBUTION MARGIN                 $18.300

- Lương (3 người)                 - $12.000
- Shopify + apps + tools          -  $1.000
- Kho, mặt bằng, linh tinh        -  $3.000
NET PROFIT                        $  2.300   -> net margin 2,7%
```

**GMV $100.000 -> Net profit $2.300.** Store "làm 100 nghìn đô một tháng" thực lãi
2.300 đô. Đây KHÔNG phải ví dụ bi quan, đây là bình thường. Nhiều store còn âm.

## Net margin mỏng giải thích mọi hành vi của merchant

| Merchant làm gì | Vì sao |
|---|---|
| đắn đo mãi với app $49/tháng | $49 là 2% lợi nhuận cả tháng của họ |
| hoảng khi ads đắt lên 20% | +$5.000 chi phí -> lợi nhuận $2.300 thành ÂM $2.700 |
| ám ảnh tỉ lệ trả hàng | returns 5%->10% ăn mất $4.500, lợi nhuận bay sạch |
| cãi nhau về phí ship | $6 x 2.000 đơn = $12.000, gấp 5 lần lợi nhuận |
| không dám đụng gì tháng 11 | cả năm lãi mỏng, sai một cái là hết |

Dev hay nghĩ "$49 rẻ mà". Với merchant đó là 2% của tất cả những gì họ kiếm được
sau một tháng.

## Bẫy ROAS

Lumi chi $25.000 ads, kéo về $60.000 doanh thu -> ROAS = 2,4. Nghe lãi to.

```
Doanh thu từ ads                    $60.000
x Contribution margin 50,6%
Đóng góp thực                       $30.360
- Tiền ads                        - $25.000
CÒN LẠI                           $  5.360   <- chưa trả lương ai cả
```

**Công thức đáng thuộc lòng:**

```
ROAS hoà vốn = 1 / contribution margin %
```

| Ngành | Contribution margin | ROAS hoà vốn |
|---|---|---|
| Mỹ phẩm, phần mềm | ~65% | 1,5 |
| Thời trang | ~50% | 2,0 |
| Đồ gia dụng | ~35% | 2,9 |
| Điện tử | ~20% | 5,0 |

ROAS 3,0 là lãi đậm với mỹ phẩm (cần 1,5) nhưng ĐANG LỖ với điện tử (cần 5,0).
**ROAS không có "số tốt" chung.** Ai khoe ROAS mà không nói margin thì con số đó
vô nghĩa — đây là lỗi phổ biến nhất trong ngành.

## ROI khác ROAS

```
ROI  = (Lợi nhuận thu được - Chi phí) / Chi phí     <- tính trên LỢI NHUẬN
ROAS = Doanh thu từ ads / Tiền ads                  <- tính trên DOANH THU
```

Ví dụ ROI khi Lumi cài Joy (giả sử đẩy repeat rate 20% -> 24%, tức +80 đơn/tháng
từ khách cũ):

```
80 đơn x $23,90 contribution     = $1.912   <- khách cũ, CAC = 0
- Phí app                        -   $49
Lợi nhuận thêm                     $1.863
ROI = 1.863 / 49 = 38 lần (3.800%)
```

Lợi nhuận tháng nhảy $2.300 -> $4.163, gần gấp đôi, nhờ một app $49. Đây chính là
câu chuyện app cần kể được cho merchant.

## LTV / CAC / Payback

```
CAC = $20, contribution mỗi đơn = $23,90, khách mua 3 lần trong 2 năm
LTV = 3 x $23,90 = $71,70
LTV/CAC = 3,6   (lành mạnh, chuẩn >= 3)
```

**Lỗi phổ biến: tính LTV theo doanh thu**

```
SAI:  LTV = 3 x $45 doanh thu = $135    -> LTV/CAC = 6,75  "quá đẹp!"
ĐÚNG: LTV = 3 x $23,90 margin = $71,70  -> LTV/CAC = 3,6
```

Con số sai cao gần gấp đôi, khiến merchant tự tin đổ tiền vào ads tới lúc hết sạch
tiền mặt. LTV phải tính trên MARGIN vì nó dùng để so với CAC — mà CAC là tiền thật đi ra.

**Payback period** — chỗ giết dòng tiền:

```
CAC $20, đơn đầu đóng góp $23,90 -> hoàn vốn ngay đơn đầu. Khoẻ.

Nếu ads đắt lên, CAC = $40:
Đơn 1: -$40 + $23,90 = -$16,10   vẫn âm
Đơn 2: -$16,10 + $23,90 = +$7,80  hoà, nhưng có thể 4 tháng sau
```

Merchant phải bỏ tiền trước và đợi vài tháng mới thu hồi. Bán càng nhiều, lỗ tiền
mặt càng sâu trước khi có lãi. Đây là lý do có brand TĂNG TRƯỞNG ĐẸP MÀ VẪN PHÁ SẢN —
không phải làm ăn kém, chỉ là hết tiền mặt trước khi khách kịp mua lần 2. Và cũng là
lý do rút ngắn thời gian tới lần mua thứ 2 (đúng việc của loyalty) giá trị hơn vẻ ngoài.

## Bảng tra nhanh

| Chỉ số | Trả lời câu hỏi gì | Ai dùng |
|---|---|---|
| GMV | bán được bao nhiêu tiền hàng | đem đi khoe, gọi vốn. Shopify báo cáo bằng số này |
| Net Revenue | sau giảm giá + trả hàng còn bao nhiêu | kế toán, báo cáo thật |
| Gross Margin | hàng này có lời không | định giá, chọn sản phẩm |
| Contribution Margin | mỗi đơn thực đóng góp bao nhiêu | SỐ QUAN TRỌNG NHẤT để quyết định hằng ngày |
| Net Profit | cuối tháng còn gì | chủ shop, sống chết |
| ROAS | ads có ra tiền không | marketing. Vô nghĩa nếu không kèm margin |
| ROI | khoản đầu tư này đáng không | quyết định mua app, thuê người |
| CAC | kiếm 1 khách tốn bao nhiêu | marketing |
| LTV | 1 khách đáng bao nhiêu cả đời | chiến lược. Tính theo margin |
| Payback | bao lâu lấy lại vốn | dòng tiền, sống còn |

## Ba điều mang theo

1. Contribution margin là số đáng quan tâm nhất, không phải doanh thu. Nghe con số
   doanh thu thì phản xạ phải là "còn lại bao nhiêu?".
2. Khách cũ và khách mới không cùng một loại tiền ($23,90 vs $3,90). Feature giúp
   khách quay lại đáng gấp 6 lần feature kéo khách mới, với cùng số đơn.
3. Merchant sống trên biên lợi nhuận 2-3%. Họ không khó tính — họ đang đứng sát mép.
