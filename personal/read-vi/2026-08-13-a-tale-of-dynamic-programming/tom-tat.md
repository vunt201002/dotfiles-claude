# A Tale of Dynamic Programming — tóm tắt (Iago Leal de Freitas)

> Nguồn: https://iagoleal.com/posts/dynamic-programming/ (đăng 25/6/2022)
> Bản dịch đầy đủ: [dich.md](dich.md)
> Loại: **tóm tắt + giải thích, do Claude viết** — KHÔNG phải lời tác giả, không phải bản dịch.
>   Chỗ nào cần nguyên văn thì đọc bản dịch, đừng trích file này.
> Viết: 13/8/2026

## Luận điểm của bài

Bài mở bằng một câu hỏi tu từ: thuật toán tìm đường đi ngắn nhất trên graph, thuật toán tính gradient khi train neural network, và thuật toán parse context-free grammar — ba thứ trông chẳng liên quan gì nhau — thực chất là cùng một nguyên lý. Nguyên lý đó là dynamic programming.

Tác giả thú nhận chính ông cũng mất rất lâu mới "click" ra chuyện này, vì gặp DP ở ba bối cảnh mà chẳng cái nào giống cái nào: (1) hồi học thuật toán, DP là một kỹ thuật memoization để tăng tốc; (2) đi làm, ông dùng *Stochastic Dual Dynamic Programming* cho bài toán điều độ thuỷ-nhiệt điện dài hạn; (3) trong model-based reinforcement learning lại có một thứ cũng tên là dynamic programming. Ba cái nhìn không ra họ hàng.

**Câu trả lời của bài, và cũng là đóng góp chính về mặt khái niệm:** phương trình Bellman là một **đặc tả đệ quy** cho lớp bài toán ra quyết định, còn dynamic programming là **bất kỳ cách cài đặt riêng nào giải được đặc tả đó**. Hiểu vậy thì ba thứ trên không còn là ba thuật toán trùng tên, mà là ba cách cài đặt của cùng một spec.

---

## 1. Dựng khung: decision process

Tác giả bắt đầu từ game platformer đời cũ (nhân vật có 4 state: đứng yên, bắn, nhảy, đi; chỉ bắn được khi đang đứng yên, và sau khi nhảy phải về đứng yên trước khi làm gì khác). Đó là một **state machine**. Tổng quát hoá lên:

| Thành phần | Ký hiệu | Ý nghĩa |
|---|---|---|
| state | `s ∈ S` | hệ đang ở đâu |
| action | `a ∈ A(s)` | làm được gì **tại state đó** |
| transition | `T : (s:S) × A(s) → S` | làm xong thì sang state nào |
| cost | `c : (s:S) × A(s) → ℝ` | trả giá bao nhiêu |

Để ý kiểu của `T` và `c` là **dependent type** — tập action phụ thuộc vào state hiện tại, không phải một tập cố định. `cost` tuỳ bối cảnh có thể là tiền, quãng đường, thời gian, hoặc **cost âm để biểu diễn phần thưởng** (đây là cầu nối sang reinforcement learning, vốn quen nói "reward" thay vì "cost").

Lặp `T` thì sinh ra một quỹ đạo `s_{t+1} = T(s_t, a_t)` — lúc này state machine được gọi là **controllable dynamical system** hay **decision process**.

**Một giả định nền quan trọng, dễ đọc lướt qua:** tác giả lập luận rằng một state gói trọn mọi thứ cần biết để chọn action, bất kể lịch sử lẫn time step. Nếu có thứ khác ảnh hưởng tới lựa chọn thì cứ nhét nó vào state, mô hình hoá thành một automaton lớn hơn, không mất tính tổng quát. Đây chính là tính chất Markov, và nó là lý do cả bộ máy phía sau chạy được.

**Policy** `π : (s:S) → A(s)` là việc chọn một action hợp lệ cho mỗi state (tên đặt theo kiểu "chính sách" của một chính quyền). Đi theo một policy cố định thì hệ thành tất định, không cần chọn gì nữa: `s_{t+1} = T(s_t, π(s_t))`.

**Discount factor `γ ∈ [0,1]`** được dẫn nhập bằng một câu hỏi đời thường: nếu phải vay tiền trả hoá đơn, bạn muốn trả nợ hôm nay hay sang năm? Lạm phát và lãi suất làm giá trị thật của một cost tương lai khác giá trị danh nghĩa.

**Value function** `v^π(s)` = tổng cost đã chiết khấu khi xuất phát tại `s` và đi theo `π`:

`v^π(s) = c(s₀,π(s₀)) + γc(s₁,π(s₁)) + γ²c(s₂,π(s₂)) + …`

**Vai trò thứ hai của `γ`, quan trọng hơn về mặt kỹ thuật:** nếu `|γ| < 1` và cost bị chặn đều (tồn tại `M > 0` với `|c(s,a)| ≤ M`), thì tổng bị chặn bởi một chuỗi hình học `≤ M/(1-γ)`, nên nó hội tụ. Không có điều kiện này thì `v^π` thậm chí không tồn tại. `γ` vừa là mô hình kinh tế, vừa là thứ làm cho định nghĩa well-defined.

---

## 2. Bài toán: optimal policy

Tìm `π` cho tổng cost nhỏ nhất **tính trên toàn bộ thời gian**, cả hiện tại lẫn hậu quả tương lai. Tác giả nhấn một điểm quan trọng: đôi khi policy có cost cao hơn ở bước đầu lại tốt hơn xét tổng thể, vì nó đưa bạn vào một state thuận lợi hơn. Tham lam từng bước là sai.

**Ví dụ shortest path** cho thấy cách dịch một bài toán quen thuộc sang khung này: state = node, action tại `s` = các cạnh đi ra từ `s`, transition = node đầu kia của cạnh, cost = trọng số cạnh. Tìm đường ngắn nhất từ `s` tới `z` = đặt initial state là `s` và cho `z` làm terminal state.

---

## 3. Bước then chốt: suy ra phương trình Bellman

Đây là phần đáng đọc kỹ nhất, vì nó là chỗ "đệ quy" xuất hiện từ hư không.

Nguyên lý tối ưu của Bellman, nói nôm na: một optimal policy có tính chất là dù state đầu và quyết định đầu là gì, **những quyết định còn lại buộc phải tạo thành một optimal policy đối với state sinh ra từ quyết định đầu tiên**.

Suy dẫn đi qua ba bước:

1. **Quan sát mấu chốt:** trong bài toán tối ưu, initial state chỉ được dùng đúng một chỗ — để chọn action đầu tiên. Các action sau không phụ thuộc trực tiếp vào nó, chỉ phụ thuộc vào *hệ quả* của nó.
2. Vậy tách được làm hai phần: **immediate cost** (chỉ phụ thuộc state đầu) và **future cost** (phụ thuộc mọi state kéo theo).
3. Tổng của future cost bắt đầu từ `t = 1`, nên rút được `γ` ra ngoài; đổi biến `l = t-1` thì phần trong ngoặc **chính xác là `v*(s')`** với `s' = T(s,a)`.

Kết quả:

> `v*(s) = min_a [ c(s,a) + γ·v*(s') ]`, với `s' = T(s,a)`, `a ∈ A(s)`

Đây là **phương trình Bellman**. Và đây là chỗ tác giả chốt luận điểm của cả bài: toàn bộ dynamic programming là các phương pháp giải phương trình này.

---

## 4. Từ đệ quy sang fixed point

Đệ quy và fixed point có quan hệ sâu, nên dùng cái nào tiện hơn thì dùng. Định nghĩa **Bellman operator** `B : (S→ℝ) → (S→ℝ)` — nó nhận một value function và trả về một value function:

> `(Bv)(s) = min_a [ c(s,a) + γ·v(s') ]`

Khi đó phương trình Bellman thành `v* = Bv*`, tức **`v*` là fixed point của `B`**. Câu hỏi tồn tại/duy nhất nghiệm được quy về câu hỏi tìm fixed point.

**Câu chuyện ông vua và quả cầu pha lê** — đây là đoạn giải thích hay nhất bài, đáng nhớ:

Bạn là quân chủ chuyên chế, ngân khố sắp cạn. Bạn thuê một pháp sư nhìn quả cầu pha lê, đóng vai oracle nói cho bạn biết mỗi tình thế sẽ tốn bao nhiêu **trong tương lai** — tức pháp sư đưa bạn một value function. Nhưng nhắm mắt nghe theo quả cầu pha lê thì không khôn, nên bạn **chỉ dùng nó để dự đoán tương lai, còn quyết định trước mắt thì dựa vào óc phán đoán của mình**.

Chính cái quá trình "đi từ dự đoán sang quyết định" đó **là** Bellman operator. `Bv` là cost của việc chọn action tốt nhất khi lấy `v` làm ước lượng tương lai. Hiểu được ẩn dụ này là hiểu được vì sao `B` biến value function thành value function.

---

## 5. Định lý Banach — và vì sao tác giả gọi nó là "định lý bazooka"

**Định lý điểm bất động Banach:** trong một metric space đầy đủ `(M,d)`, mọi ánh xạ liên tục `f : M → M` mà **co khoảng cách** — `d(f(v),f(w)) ≤ γ·d(v,w)` với `γ ∈ [0,1)` — đều có **đúng một** fixed point `v*`. Hơn nữa:

- Từ **bất kỳ** `v₀` nào cũng tới được `v*` bằng cách lặp `f`.
- Hội tụ **tuyến tính**, sai số sau `n` vòng bị chặn bởi `γⁿ/(1-γ) · d(v₀, f(v₀))`.

Trực giác: nếu một ánh xạ co mọi khoảng cách lại, thì cuối cùng ảnh của mọi điểm bị bóp về đúng một điểm.

**Không gian hàm được chọn:** các hàm liên tục bị chặn `C⁰_b(S,ℝ)` với chuẩn đều `d(v,w) = sup_s |v(s) - w(s)|`. Trong không gian (đầy đủ) này, `B` là contraction với hệ số **đúng bằng `γ`** — chính discount factor. Và với không gian state **hữu hạn** thì mọi hàm đều liên tục và bị chặn, nên điều kiện này bao trọn mọi thuật toán trong bài.

**Vì sao "bazooka":** định lý không chỉ bảo đảm `v*` tồn tại và duy nhất (kéo theo optimal policy tồn tại), mà còn **dạy luôn cách tính ra nó**. Đây là điểm sư phạm tác giả nhấn: chứng minh sự tồn tại ở đây là chứng minh *xây dựng*, nên mọi thuật toán ở nửa sau bài đều rơi thẳng ra từ định lý này. Đọc `v = f(v)` như một luật cập nhật `v ← f(v)`, lặp tới khi khoảng cách xuống dưới ngưỡng dung sai — thế là có thuật toán.

---

## 6. Một hiểu lầm được gỡ: memoization

Trước khi vào thuật toán, tác giả gỡ một hiểu lầm phổ biến.

Cách biểu diễn hàm tự nhiên nhất trong một ngôn ngữ lập trình là bằng thủ tục tính toán, nhưng ở đây thì kém hiệu quả, vì **sửa một thủ tục để cải tiến nó thì tốn kém**. Nên người ta biểu diễn policy và value function bằng **cấu trúc dữ liệu** (array, hash map) thay vì bằng hàm.

> **Cái "memoization" mà người ta hay gắn với dynamic programming nằm trọn trong mẹo này.** Và nó thuần tuý là chuyện *biểu diễn hàm*, **hoàn toàn trực giao với thiết kế thuật toán**. Trong một ngôn ngữ có first-class function, bạn làm DP chỉ bằng function composition cũng được — chỉ là nó không nhanh như mong muốn.

Đây là chỗ chỉnh lại cách hiểu của phần lớn người học DP qua lớp thuật toán: memoization không *phải* là dynamic programming, nó chỉ là một lựa chọn cài đặt.

Một quyết định thiết kế nữa: mọi thuật toán chỉ tương tác với process qua **tổng cost** `total_cost(v,s,a) = c(s,a) + γ·v[next(s,a)]`, không bao giờ đụng riêng lẻ vào các thành phần. Chi tiết này nhìn nhỏ nhưng là thứ làm nên toàn bộ phần mở rộng sang bất định ở mục 8.

---

## 7. Bốn thuật toán

Từ đây giả sử `S` và `A(s)` đều **hữu hạn**.

### 7.1. Value iteration

Lặp `v ← Bv` từ `v₀` bất kỳ, dừng khi `||v - Bv||_∞` nhỏ hơn dung sai, rồi tính policy bằng `argmin` trên value function đã hội tụ.

- Tên "value iteration" vì **chỉ value function tham gia vào vòng cập nhật**; policy tính ra sau, không đóng vai trò gì.
- Hội tụ tuyến tính (thẳng từ định lý Banach). Mỗi vòng tốn `O(|S|·|A|)`.
- Phép cực tiểu hoá tại mỗi state là độc lập → **embarrassingly parallel** theo state.

### 7.2. In-place value iteration

**Vấn đề:** bản trên chờ duyệt hết mọi state rồi mới cập nhật, chạy tuần tự thì ì.
**Cách chữa:** cập nhật ngay tại chỗ, để thông tin vừa cải thiện lan sang các state khác sớm.
**Đánh đổi:** mất luôn khả năng song song hoá.

Thay đổi duy nhất là viết lại vòng lặp fixed point để tính tại chỗ và theo dõi sai số theo từng thành phần. Bài minh hoạ bằng animation giải mê cung (state = ô lưới, action = hướng đi không bị tường chắn, mục tiêu là góc dưới phải).

### 7.3. Policy iteration

**Vấn đề của value iteration:** mọi tính toán về policy đều ngầm. Bạn có thể **đã** tới optimal policy rồi mà vẫn lặp tiếp, chỉ vì value function chưa hội tụ.

Policy iteration xen kẽ hai bước:

**Policy evaluation** — cho trước `π`, tính `v^π`. Nó thoả một đệ quy giống phương trình Bellman **nhưng không có bước min**. Định nghĩa `B^π` tương ứng. Vì `B^π` chính là cost của một decision process mà tập action tại mỗi state co lại còn đúng một lựa chọn, nó cũng có fixed point duy nhất dưới cùng giả thiết. Lặp là ra.

**Policy improvement** — áp `B` lên một value function chưa tối ưu thì luôn cho kết quả tốt hơn:

`(Bv^π)(s) = min_a [c(s,a) + v^π(T(s,a))] ≤ c(s,π(s)) + v^π(T(s,π(s))) = v^π(s)`

Lấy `argmin` là ra policy mới, **tốt hơn ngặt** (trừ khi `π` vốn đã tối ưu).

**Xen kẽ:** `π₀ → v^{π₀} → π₁ → v^{π₁} → …`. Value function giảm đơn điệu, policy tốt lên ngặt.

**Điểm ăn tiền:** vì chỉ có **hữu hạn** policy và mỗi vòng đều thu được một policy tốt hơn ngặt, thuật toán **bảo đảm hội tụ sau hữu hạn bước** — khác hẳn value iteration vốn chỉ hội tụ tiệm cận. Cả hai bước đều embarrassingly parallel. Tác giả khuyên coi nó là một *nguyên lý thuật toán* hơn là một thuật toán cứng.

### 7.4. Backward induction (horizon hữu hạn)

**Terminal state `■`:** mọi action trên nó có cost bằng không và không chuyển đi đâu (`T(■,a) = ■`). Vẽ không có mũi tên.

**Finite horizon:** mọi policy đều chạm terminal state sau hữu hạn bước → graph nền **phi chu trình**, mọi quỹ đạo ghé một state không-terminal nhiều nhất một lần.

**Ý tưởng:** ở mọi thuật toán trước, thứ tự duyệt state là tự do (nên mới song song hoá được), và cũng vì thế không có bảo đảm nào sinh ra từ thứ tự. Nhưng ở bản in-place, **thứ tự khác nhau cho luồng thông tin khác nhau**. Khai thác tính phi chu trình để chọn **thứ tự tô-pô** thì value iteration hội tụ trong **đúng một lượt**.

Sắp xếp tô-pô tính được trong `O(|S| + |A|)`. Chỉ số sớm nhất rơi vào terminal state rồi rải *ngược* theo mũi tên — tên "backwards induction" từ đó ra.

**Chứng minh quy nạp:** cơ sở là terminal state (`v*(■) = 0`). Bước quy nạp: tại `s` không-terminal, giả sử `v` đã tối ưu với mọi state chỉ số nhỏ hơn; vì mọi transition từ `s` đều đi tới chỉ số nhỏ hơn, `v(T(s,a))` đã tối ưu sẵn, nên gán `v(s) ← (Bv)(s)` cho ra giá trị tối ưu ngay.

**Hệ quả tinh tế nhưng rất đáng giá:** chứng minh này **không dùng định lý Banach**, nên **không cần giả thiết nào về `γ`**. Backwards induction chạy được cho cả process **không có chiết khấu**. (Footnote nói thêm: nó cũng không cần cost phải là số thực — Semiring nào cũng được.)

**Stagewise states:** trường hợp đặc biệt rất phổ biến — state tiến tuần tự theo thời gian, horizon cố định `N` bước, state space chia theo bước `t`. Luôn phi chu trình, sắp tô-pô = duyệt từng cụm ngược thời gian, nên **khỏi cần sắp xếp gì cả**. Công sức đúng bằng `|S|·|A|`, và **vòng lặp trong lại embarrassingly parallel** vì không có phụ thuộc trong cùng một stage.

---

## 8. Mở rộng sang bất định — chỗ thanh lịch nhất của bài

Đời thật không bảo đảm làm một action là tới đúng một state. Sửa kiểu của transition:

> `T : (s:S) × A(s) → M·S`

trong đó `M` bọc một kiểu vào một **bối cảnh bất định**. Bốn ví dụ:

| `M` | Cho ra | Ghi chú |
|---|---|---|
| tập lũy thừa `P` | automaton bất định | liệt kê mọi state kế tiếp khả dĩ |
| phân phối xác suất | hệ stochastic | thêm khái niệm **mỗi state kế tiếp khả dĩ tới mức nào** |
| ánh xạ đồng nhất | `M·S = S` | cho thấy trường hợp tất định nằm trọn trong bất định |
| action của người khác | `A(s) → S` | tình huống game nhiều người chơi |

(Footnote: kỹ thuật mà nói, `M` phải là một **Monad**.)

Cần thêm một hàm gộp `ρ : (S→ℝ) × M·S → ℝ` để bóp cái tương lai bất định về một số thực. Bellman operator mới: `(Bv)(s) = min_a [ c(s,a) + γ·ρ(v,s') ]`.

**Và đây là chỗ trả công cho toàn bộ cách dựng khung ở mục 6:**

> Với vài điều kiện nhẹ trên `ρ`, mọi suy dẫn về tồn tại và duy nhất **vẫn đúng**. Hơn nữa, **mọi thuật toán — value iteration, policy iteration, backwards induction — đều chỉ dùng tổng cost của hệ, mà cái đó vẫn là hàm tất định.** Nên chúng áp được vào bối cảnh bất định **mà không cần sửa một dòng nào**.

Chính vì mục 6 đã ép mọi thuật toán đi qua `total_cost` chứ không đụng vào `c` và `T` riêng lẻ, nên toàn bộ bất định bị nhốt gọn trong `ρ` và không rò ra thuật toán. Đó là một bài học thiết kế, không chỉ là một kết quả toán.

---

## 9. Fibonacci — dựng một recurrence thành decision process

Tác giả thừa nhận dùng cả bộ máy này cho Fibonacci là quá tay, nhưng làm vì đó là ví dụ đầu tiên ai học DP cũng gặp.

Một quan hệ truy hồi: `f(n) = c_n` khi `n < k`, và `= g(n, f(n-1), …, f(n-k))` khi `n ≥ k`. Tính thẳng theo định nghĩa có thể chậm theo hàm mũ; DP đưa về tuyến tính theo `n`.

Cách dựng:
- **State** = các số `0..N`; **action** = đúng một action giả `◆` (nên phép `min` là thừa).
- **Transition** dùng **tập lũy thừa** làm nguồn bất định: `T(s,◆) = ∅` khi `s < k`, `= {s-1, …, s-k}` khi `s ≥ k`.
- **Immediate cost** = các trường hợp cơ sở `c_n` cho `k` stage đầu, còn lại bằng 0.
- **Hàm gộp**: `ρ(v,s') = g(s, {v(n) | n ∈ s'})` — **dùng chính quan hệ truy hồi `g` làm hàm gộp**. Đây là chỗ khéo nhất của cách dựng.

Kết quả: phương trình Bellman của hệ này *chính là* quan hệ truy hồi ban đầu. Vì horizon hữu hạn nên giải được bằng value iteration hoặc backwards induction **kể cả khi không có `γ`**. Với backwards induction, mỗi stage đúng một state (initial state là `N`, cuối là `0`), nên tính Fibonacci trong **đúng `n` bước**.

---

## 10. Stochastic dynamic programming / MDP

Cho transition trả về phân phối xác suất → **Markov Decision Process**. Tên "Markov" vì state mới chỉ phụ thuộc state và action hiện tại, độc lập với lịch sử — y như Markov chain, vốn chỉ là MDP với đúng một action.

Trực giác chuẩn: **actor ↔ environment**. Environment ở state `s` (actor biết), actor chọn `a ∈ A(s)` với một cost nhất định; action tác động lên environment theo cách nằm ngoài tầm với của actor (nên mới stochastic), state đổi thành `s'`. Trước khi transition xảy ra, chỉ ước lượng được `s'` kèm bất định.

**Ứng dụng được nêu:** robot chơi video game — state là state nội bộ game hoặc phần quan sát được, action là các nút trên tay cầm, cost gắn với thắng/thua. Tác giả dẫn bài *Playing Atari with Deep Reinforcement Learning* (Mnih và cộng sự, 2013) và nói toàn bộ phần mô hình hoá ở đó làm qua MDP theo đúng cách vừa bàn.

Hàm gộp thường dùng là **kỳ vọng**: `ρ(v,S) = E[v(S)]`. (Footnote đáng chú ý: trung bình còn lâu mới là lựa chọn duy nhất — nhiều tình huống thực tế cần né rủi ro, và DP với *coherent risk measure* chạy tốt y như vậy.)

Vì kỳ vọng là tuyến tính, suy dẫn giống hệt trường hợp tất định. Với state space hữu hạn, cùng tính chất contraction, nên value/policy iteration dùng ngay được.

**Cái giá phải trả:** độ phức tạp tệ hơn — phép tính trung bình làm `v ← Bv` tốn `O(|S|²·|A|)` thay vì `O(|S|·|A|)`.

---

## 11. Phụ lục: chứng minh `B` là monotone contraction

Ba bước, mỗi bước dùng bước trước:

1. **Đơn điệu.** Đặt thứ tự bộ phận `v ≤ w ⟺ ∀s, v(s) ≤ w(s)`. Khi đó `v ≤ w ⟹ Bv ≤ Bw`. Chứng minh: giả thiết cho `c(s,a) + γv(T(s,a)) ≤ c(s,a) + γw(T(s,a))` với **mọi** `a`; lấy min hai vế thì bất đẳng thức được bảo toàn.

2. **Tịnh tiến đều.** `B(v + k) = Bv + γk` với `k` là hằng số. Chứng minh: `γk` không phụ thuộc `a` nên rút được ra khỏi phép tối ưu. (Để ý: ra `γk` chứ không phải `k` — chính hệ số này tạo ra contraction ở bước sau.)

3. **Contraction.** `||Bv - Bw||_∞ ≤ γ·||v - w||_∞`. Chứng minh: từ chuẩn đều có `v(s) ≤ w(s) + ||v-w||_∞`; áp `B` hai vế (bước 1 bảo toàn); rút hằng số ra (bước 2, sinh hệ số `γ`); làm đối xứng cho `w - v` để có bất đẳng thức trị tuyệt đối; lấy supremum.

Kết luận: `γ < 1` thì `B` có fixed point duy nhất, nên **mọi decision process có chiết khấu đều giải được và có đúng một optimal value function**.

---

## Rút lại

Đường đi của bài rất gọn, và đáng nhớ theo đúng thứ tự này:

**state machine → decision process → phương trình Bellman (đệ quy) → fixed point của một operator → định lý Banach → thuật toán.**

Mỗi mũi tên đổi bài toán sang một dạng khó hơn một chút về mặt trừu tượng nhưng dễ hơn nhiều về mặt công cụ, và mũi tên cuối cùng **rơi thẳng ra thuật toán** vì định lý Banach là định lý xây dựng.

Ba thứ đáng mang đi nhất:

1. **Memoization không phải là DP** — nó chỉ là một lựa chọn biểu diễn hàm, trực giao hoàn toàn với thiết kế thuật toán. Đây là chỗ chỉnh lại hiểu lầm phổ biến nhất về DP.
2. **Cấu trúc bài toán quyết định thuật toán, không phải ngược lại.** Không biết gì thêm thì value iteration. Muốn dừng sau hữu hạn bước thì policy iteration. Biết graph phi chu trình thì backwards induction, một lượt là xong và **vứt luôn được điều kiện về `γ`**. Biết thêm cấu trúc theo stage thì khỏi cần sắp xếp tô-pô.
3. **Trừu tượng đúng chỗ thì bất định thành miễn phí.** Vì mọi thuật toán chỉ nói chuyện với process qua `total_cost`, nhét bất định vào `ρ` là xong — không thuật toán nào phải sửa.

Tác giả cũng nói rõ những gì bài **không** đụng tới: ước lượng value function thay vì tính thẳng, không gian state vô hạn, thời gian liên tục, và phần lớn mối nối với reinforcement learning (bài mới chạm bề mặt). Ngoài ra bài cảm ơn Pedro Xavier (các cuộc trò chuyện làm nảy ra bài) và Ivani Ivanova (soát lỗi chính tả).
