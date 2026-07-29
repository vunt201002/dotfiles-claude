---
type: concept
created: 2026-07-29
updated: 2026-07-29
tags: [learn]
---
# Công thức tăng trưởng ecommerce và từ điển chỉ số

Nền tảng để một dev hiểu merchant đang lo gì. Ghi lại từ loạt hỏi đáp 2026-07-29,
xuất phát từ chuyện Shopify Hydrogen/headless rồi lan sang phía kinh doanh.

## Công thức gốc

```
Doanh thu = Traffic × Conversion Rate × AOV
```

Ví dụ: 100.000 session × 2% × $50/đơn = $100.000

Mọi thứ merchant làm, mọi app họ cài, đều đang đẩy MỘT trong ba số này. Không có cái thứ tư.

| Đòn bẩy | Nghĩa | Cách đẩy | App sống ở đây |
|---|---|---|---|
| Traffic | bao nhiêu người vào | ads, SEO, email, social | ad tools, SEO app, popup thu email |
| Conversion Rate (CVR) | bao nhiêu % mua | trang nhanh, review, trust, checkout mượt | review app, page builder, upsell |
| AOV | mỗi đơn đáng bao nhiêu | bundle, upsell, freeship trên $X | bundle app, upsell app |

## Tầng thứ hai: khách quay lại

```
LTV = AOV × số lần mua/năm × số năm gắn bó
CAC = tổng tiền marketing ÷ số khách MỚI
```

Luật sống còn: **LTV > CAC**, lành mạnh thì **LTV/CAC >= 3**.
Kiếm 1 khách tốn $40 mà khách chỉ mang lại $30 thì bán càng nhiều càng lỗ.

Vì sao loyalty app (Joy) sống ở đây: khách mới thì lần nào cũng trả CAC, khách cũ
quay lại gần như miễn phí. Đẩy repeat rate 20% -> 25% là lợi nhuận gần thuần.

## Từ điển, xếp theo đòn bẩy (không theo A-B-C)

**Traffic:** session, traffic source (organic/paid/direct/referral/email/social),
CPC, CPM, attribution (quy công cho kênh nào — luôn gây cãi nhau),
owned vs paid channel (email/SMS là tài sản, ads là đi thuê).

**Conversion:** CVR (~1-3% bình thường, >4% tốt), bounce rate, add-to-cart rate,
cart abandonment (~70%, cả một ngành app sống nhờ đây), checkout completion.

**Retention:** repeat purchase rate, purchase frequency, retention/churn rate,
cohort analysis, RFM (Recency - Frequency - Monetary).

**Vận hành:** SKU, inventory turnover (hàng nằm kho là tiền chết), fulfillment,
3PL, returns rate/RMA (thời trang 20-40%, giết margin), chargeback (nhiều quá
bị khoá cổng thanh toán).

Chỉ số về tiền tách riêng -> [[Chỉ số tiền trong ecommerce - trace một đơn hàng]]

## Merchant vận hành thế nào

| Quy mô/năm | Ai bấm nút | Quan tâm gì |
|---|---|---|
| $0-100k | chính chủ, làm mọi thứ | GIÁ app. Cài xong phải chạy ngay |
| $100k-1M | chủ + 1-2 người, thi thoảng freelancer | tiết kiệm thời gian, bắt đầu nhìn số |
| $1M-20M | có ecommerce manager, marketing, agency | DỮ LIỆU và attribution: "app này mang lại bao nhiêu?" |
| $20M+ (Plus) | agency + in-house + quy trình mua sắm | custom, SLA, security review — và đây là đám đi headless |

Nhịp: ngày (xem đơn, xử lý, trả lời khách) / tuần (báo cáo, campaign, email) /
tháng (chốt P&L, nhập kho, rà app nào đáng tiền) / mùa (bộ sưu tập, mùa cao điểm).

## BFCM — sự thật vận hành quan trọng nhất với Shopify app dev

Black Friday/Cyber Monday: với nhiều brand, vài ngày này bằng cả quý.

- Tháng 11 merchant KHÔNG cài app mới. Không ai đụng vào cỗ máy đang chạy tiền.
- Tháng 9-10 mới là mùa bán app (họ chuẩn bị cho BFCM).
- Bug tháng 11 là thảm hoạ, không phải phiền toái.
- Support tăng vọt, kiên nhẫn xuống đáy.

## Agency — kênh phân phối dev hay quên

Nhiều store từ $500k trở lên do agency dựng và vận hành. Agency chọn app thay
merchant, và chọn CÙNG một bộ app cho hàng chục client. Được một agency tin dùng =
được 30 store. Nhưng họ khắt khe: app xung đột theme là cấm cửa vĩnh viễn.

## Vì sao merchant huỷ app (xếp theo mức phổ biến thật)

1. Cài xong không set up nổi, bỏ giữa chừng rồi quên — nguyên nhân churn số 1.
2. KHÔNG CHỨNG MINH ĐƯỢC app mang lại gì.
3. Xung đột theme / làm chậm trang.
4. Giá tăng theo bậc tới mức thấy không đáng.
5. Có app khác gộp nhiều tính năng hơn.

Điểm 2 đáng nhớ nhất: merchant không quan tâm "đã phát 40.000 điểm" (số của app).
Họ hỏi "repeat rate của tôi có tăng không", "AOV khách loyalty có cao hơn không",
"trả $49 này có đáng không". App không tự trả lời được thì bị huỷ kể cả khi chạy
hoàn hảo — vì tới kỳ rà chi phí, họ nhìn dòng $49 và không nghĩ ra lý do giữ lại.

Cách chứng minh đúng chuẩn -> [[Cohort analysis - chứng minh một feature có tác dụng]]

## Mô hình kinh doanh đáng biết

- **D2C**: bán thẳng, margin cao, sở hữu dữ liệu khách, nhưng tự lo toàn bộ traffic.
- **Subscription**: doanh thu đoán trước được, LTV cao, sống chết theo churn.
- **B2B/Wholesale**: bảng giá riêng theo khách, công nợ, đặt số lượng lớn.
- **Omnichannel**: web + Amazon + TikTok Shop + POS. Đau nhất là đồng bộ tồn kho.

## Ba nỗi đau gần như merchant nào cũng dính

1. CAC tăng mỗi năm — lý do sâu xa khiến retention/loyalty/email thành mảng nóng.
   Không phải vì thời thượng, mà vì kênh mua traffic đang hỏng dần.
2. Dòng tiền — trả tiền hàng và ads TRƯỚC, tiền khách về SAU.
3. Phụ thuộc nền tảng — FB đổi thuật toán, iOS chặn tracking, doanh thu bốc hơi qua đêm.

## Cách nghĩ mang theo khi code

| Anh code | Merchant nghe thấy |
|---|---|
| widget hiện điểm ở trang sản phẩm | khách biết mua được thưởng -> đẩy CVR |
| đổi điểm lấy giảm giá | khách quay lại, không trả CAC lần nữa -> đẩy repeat rate |
| bậc VIP | khách mua thêm để lên hạng -> đẩy AOV + frequency |
| widget nhanh hơn 200ms | trang không chậm -> giữ CVR |

Câu hỏi vàng cho mọi feature: **"Cái này đẩy Traffic, CVR, AOV, hay Retention?
Và merchant nhìn thấy nó ở đâu trong số liệu của họ?"** Không trả lời được cả hai
vế thì nhiều khả năng là feature làm cho vui.
