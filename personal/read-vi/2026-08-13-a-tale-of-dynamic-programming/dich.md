# A Tale of Dynamic Programming — Iago Leal de Freitas (DỊCH SÁT tiếng Việt)

> Nguồn: https://iagoleal.com/posts/dynamic-programming/ (đăng 25/6/2022)
> Tóm tắt: [tom-tat.md](tom-tat.md)
> Chế độ: DỊCH SÁT — bài toán có theorem, proof, điều kiện hội tụ và code Julia; dịch lệch một điều kiện là người đọc cài sai thuật toán.
> Xưng hô: bạn (người đọc) · tôi (tác giả) · ta (giọng toán)
> Pass 2 (editor mù nguồn): 3 vòng · điểm vòng cuối: nhịp câu 7 · từ ngữ 7 · xưng hô 10 · mạch đoạn 8 · thuật ngữ 9
> Pass 3 (soát nghĩa): 4 finding · đã sửa 3 · còn lại 1 — mục Lời cảm ơn, câu cuối bị hạ mức khen một nấc so với gốc
> Chưa đóng: hết cap 3 vòng. Điểm trên là chấm bản của vòng 2; bản đang lưu là output vòng 3, chưa ai chấm.
> Code, LaTeX, số, tên riêng: đã đối chiếu từng byte với bản gốc (12/12 khối code, 56/56 khối $$, 149/149 span inline).

# Chuyện về Dynamic Programming

25 tháng 6, 2022

Tôi nói thế này, bạn có tin không? Tìm đường đi ngắn nhất trên một graph, tính gradient khi train một neural network, parse context-free grammar. Mấy thuật toán được dùng nhiều nhất cho ba việc đó thực chất đều là hiện thân của cùng một nguyên lý. Nguyên lý đó tên là *dynamic programming*. Trong toán, đôi khi một nguyên lý đơn giản mở ra thành kết luận sâu sắc ở nhiều lĩnh vực khác nhau. Đây là một trường hợp như vậy. Thật ra ngay ở đoạn đầu này đã tóm được ý chính, bằng chính lời của Richard Bellman (người tạo ra Dynamic Programming):

> Một optimal policy có tính chất này: dù initial state và initial decision là gì đi nữa, những decision còn lại buộc phải tạo thành một optimal policy đối với state sinh ra từ decision đầu tiên.

Phải thừa nhận là dù gặp dynamic programming trong nhiều bối cảnh khác nhau, tôi mất khá lâu mới "click" ra được: chúng thực sự là cùng một thứ. Hồi học thuật toán và cấu trúc dữ liệu, nó là một kỹ thuật dựa trên memoization: giải mấy phần dễ trước rồi lưu lời giải lại để dùng sau. Nhờ vậy vài thuật toán chạy nhanh hơn. Rồi đi làm, công việc của tôi chủ yếu là giải rất nhiều linear program cho các bài toán scheduling dài hạn.[^1] Thuật toán chính bên tôi dùng tên là *Stochastic Dual Dynamic Programming*. Thoạt nhìn nó chẳng giống mấy với kỹ thuật lập trình hồi học thuật toán. Cuối cùng, một trong mấy phương pháp chính của model-based reinforcement learning cũng lại tên là dynamic programming, và nó cũng chẳng giống mấy với hai cái kia.

Vậy chuyện gì đang xảy ra? Có phải ai cũng chọn cái tên dynamic programming cho thuật toán của họ chỉ vì nghe ngầu?[^2] Thật ra thì có một số nguyên lý áp dụng được cho tất cả những trường hợp đó, từ hoạch định quỹ đạo tên lửa cho tới thuật toán ngắt dòng của TeX. Và danh sách còn dài nữa.

Tôi muốn mời bạn vào một chuyến đi qua nhiều vùng đất của toán học. Đường đi trải từ automata tới optimal control, ghé qua Markov chain, hệ động lực, linear programming và cả metric space. Ngồi vào chỗ và tận hưởng chuyến đi nhé!

## Về chuyện ra quyết định và state machine

Trước khi đi sâu vào chính dynamic programming, cần chốt vài khái niệm đã. Dù sao thì biết rõ bài toán bạn định giải trước khi học phương pháp giải nó vẫn hơn, đúng không?

Để tạo động lực, bắt đầu bằng một thứ tôi rất thích: game platformer đời cũ. Trong game giả định này (chắc chắn không phải game về một ông thợ sửa ống nước người Ý nào đó), mặc định thì nhân vật đứng yên không làm gì. Nhưng khi người chơi bấm một nút trên tay cầm, họ có thể ra lệnh cho nhân vật làm vài việc: bắn, nhảy, hoặc đi. Và tất nhiên, mỗi hành động đó kích hoạt animation tương ứng trên màn hình. Đúng chất Resident Evil, game này chỉ cho nhân vật bắn khi đang đứng yên, và bắt bạn phải về state đứng yên sau khi nhảy rồi mới làm được việc khác. Cứ coi đó là khoảng thời gian cần để lấy lại thăng bằng sau khi tiếp đất. Mô tả bằng chữ thì nghe rối rắm quá mức, nhưng may thay mấy anh chị bên khoa Comp Sci đã phát minh ra loại sơ đồ vẽ mấy transition này rất gọn.

![](https://iagoleal.com/posts/dynamic-programming/state-machine.svg)

Cách mô hình hoá ở trên là một trường hợp của *state machine*, hay *automata* nếu bạn khoái từ gốc Hy Lạp. Nhân vật ở được trong 4 state, và ở mỗi state lại có một tập action khả dụng để chuyển sang state khác. Nói trừu tượng hơn, một automaton là một hệ có thể ở một trong nhiều *state* $s \in \mathcal{S}$, và tại mỗi state, bạn chọn được trong một tập *action* $a \in \mathcal{A}(s)$. Mỗi lần thực hiện một action, hệ chuyển sang state mới theo một *transition function*

$$
T : (s : \mathcal{S})
 \times \mathcal{A}(s) \to \mathcal{S}.
$$

Tiếc là đời không có bữa trưa miễn phí. Nói chung, mỗi lần thực hiện action $a$ tại state $s$ thì phải trả một *cost* nhất định, mô hình hoá gọn nhất bằng một hàm nữa

$$
c : (s : \mathcal{S})
 \times \mathcal{A}(s) \to \mathbb{R}.
$$

Tuỳ chỗ dùng, cái này có thể là chi phí tiền bạc thật trong bối cảnh kinh tế. Khi hoạch định thì nó là tổng quãng đường hay thời gian trôi qua. Thậm chí có thể là một cost âm, biểu thị phần thưởng.

### Động lực học của việc ra quyết định

Lặp transition $T$ thì hệ có một dynamics: xuất phát từ một initial state $s_0$ và thực hiện một dãy action $\{a_t\}$, ta sinh ra một quỹ đạo trên không gian state.

$$
s_{t+1} = T(s_t, a_t).
$$

Nhìn dưới góc này, mấy state machine ở trên gọi là *controllable dynamical system*, hoặc *decision process*: thêm vài cái tên ngầu nữa để bạn nhớ.

Có thể coi một state gói trọn mọi thứ cần biết về hệ để chọn được action, bất kể lịch sử trước đó lẫn time step. Đúng vậy: có thứ gì khác ảnh hưởng tới lựa chọn thì bạn luôn mô hình hoá được quá trình đó thành một automaton lớn hơn. State của automaton mới mang thêm cả phần thông tin bổ sung ấy. Cách làm đó không mất tính tổng quát. Vậy điều khiển một hệ động lực rút lại là chọn một action hợp lệ cho mỗi state, tức là một hàm

$$
\pi : (s : \mathcal{S})
 \to \mathcal{A}(s).
$$

Trong tài liệu, cái này gọi là *policy*, ví như một chính quyền ra các quyết sách để điều khiển tình hình đất nước.

Xuất phát tại state $s_0$ và đi theo một policy $\pi$ thì sinh ra một hệ động lực tất định, không cần chọn control nữa:

$$
s_{t+1} = T(s_t, \pi(s_t)).
$$

Đổi lại, dynamics này sinh ra một cost $c(s_t, \pi(s_t))$ tại mỗi time step. Có thể định nghĩa tổng cost của $\pi$ là tổng các cost đó, nhưng còn một chi tiết nữa đáng để ý. Giả sử vì lý do nào đó bạn kẹt tiền và phải vay để trả hoá đơn. Trong hoàn cảnh chật vật ấy, bạn muốn trả nợ hôm nay hay sang năm?

Đôi khi có những yếu tố như lạm phát hay lãi suất làm giá trị thật của một cost trong tương lai lệch khỏi giá trị danh nghĩa. Vậy nên ta đưa vào một *discount factor* $\gamma \in [0, 1]$ tuỳ bài toán, biểu thị mức cost mất giá theo thời gian. Đi theo một policy $\pi$ thì tổng cost là toàn bộ cost sinh ra dọc đường cộng lại, mỗi cái chiết khấu đúng mức. Ta định nghĩa *value function* $v^\pi : \mathcal{S}\to \mathbb{R}$ ứng với $\pi$ là tổng cost khi xuất phát tại một state cho trước:

$$
\begin{array}{rl}
 v^\pi(s) = & c(s_0, \pi(s_0)) + \gamma c(s_1,
 \pi(s_1)) + \gamma^2 c(s_2, \pi(s_2)) + \ldots \\
 \textrm{where} & s_0 = s, \\
 & s_{t+1} = T(s_t, \pi(s_t)), \\
 \end{array}
$$

Ngoài ý nghĩa thực tiễn, discount factor $\gamma$ còn đóng vai trò quan trọng ở góc nhìn giải tích. Khi $|\gamma| < 1$ và các cost bị chặn đều (chẳng hạn không gian action hữu hạn thì đúng), chuỗi định nghĩa $v^\pi$ bảo đảm hội tụ với mọi lựa chọn action và mọi initial state. Cụ thể, giả sử tồn tại $M > 0$ sao cho

$$
\forall s \in \mathcal{S},
 a \in \mathcal{A}(s),\, |c(s, a)| \le M.
$$

Tổng cost khi đó bị chặn bởi một chuỗi hình học không thể bung ra vô hạn,

$$
\sum\limits_{t=0}^\infty \gamma^{t}|c(s_t, a_t)| \le
 \sum\limits_{t=0}^\infty \gamma^{t} M \le \frac{M}{1 -
 \gamma},
$$

Nhờ vậy value function mới well-defined.

### Quyết định tối ưu

Có nhiều cách hành động khả dĩ thì câu hỏi tự nhiên là cách nào tốt nhất. Khi lập trình một robot thoát mê cung, bạn muốn nó tốn ít thời gian nhất. Khi điều khiển một phi thuyền bay tới mặt trăng, phải bảo đảm nó tốn ít nhiên liệu nhất. Còn khi ẩu đả trong quán bar, bạn muốn hạ đối thủ mà chịu ít thương tích nhất. Trên hết, policy tốt nhất là policy có cost thấp nhất tính trên *toàn bộ thời gian*: cả hiện tại lẫn hậu quả tương lai của nó. Chẳng hạn, đôi khi một policy có cost cao hơn ở state đầu lại tốt hơn xét tổng thể, vì nó đưa ta vào một state thuận lợi hơn. Vậy bài toán ở đây tự nhiên phát biểu thành bài toán tìm *optimal policy*:

> Xuất phát tại state $s$, tìm một policy $\pi$ sinh ra tổng cost nhỏ nhất theo thời gian.

Hay nói tương đương bằng ngôn ngữ toán:

$$
\begin{array}{rl}
 \min\limits_\pi v^\pi(s) =
 \min\limits_{a_t} & \sum\limits_{t=0}^\infty
 \gamma^{t}c(s_t, a_t) \\
 \textrm{s.t.} & s_0 = s, \\
 & s_{t+1} = T(s_t, a_t), \\
 & a_t \in \mathcal{A}(s_t).
 \end{array}
$$

Nhìn thì nó giống một bài toán tối ưu to và đáng sợ, nhưng thật ra bên trong có rất nhiều cấu trúc khai thác được. Đó là nội dung mục sau. Nhưng trước khi đi tiếp, thử lạc đề một chút xem vài bài toán kinh điển phát biểu ra sao trong cách nhìn ra-quyết-định này.

#### Ví dụ: đường đi ngắn nhất trên graph

Giả sử bạn đang ở quê nhà và vừa nhận tin nhắn của một người bạn: có mấy con llama đang hát ở Cuzco, Peru, ngay lúc này. Vừa không tin vừa tò mò, bạn lôi chiếc xe đạp ruột ra và lên đường tới Cuzco. Tiếc là không có đường xe đạp nối thẳng từ nhà bạn tới Cuzco, nghĩa là bạn phải tìm một lộ trình đi vòng qua các thành phố khác. Ngoài ra, có rủi ro là mấy con llama ngừng hát bất cứ lúc nào rồi quay về thói quen thường ngày là gặm cỏ trên núi. Nên bạn quyết định đi đường ngắn nhất có thể tới Cuzco.

Mô tả trên là một trường hợp của bài toán tìm đường đi ngắn nhất trên graph. Mỗi thành phố là một node, còn tuyến đường trực tiếp giữa hai thành phố là một cạnh có trọng số, trọng số chính là khoảng cách. Đi từ nhà tới Cuzco rút lại là tìm đường nối hai node đó sao cho tổng khoảng cách nhỏ nhất.

Chuyển mô tả graph này sang một decision process khá dễ.

- **State**: các node của graph.

- **Action** tại state $s$: các cạnh đi từ $s$ tới một node khác.

- **Transition**: node ở đầu kia của cùng cạnh đó. Tức là, cho một cạnh $s \to s'$, ta có $T(s, s \to s') = s'$.

- **Cost**: $c(s, a)$ là trọng số của cạnh $a$, tức thời gian đi hết cạnh đó.

Tìm đường đi ngắn nhất từ $s$ tới $z$ cũng chính là đặt initial state là $s$ và cho $z$ làm một terminal state của dynamics.

## Dynamic Programming

Được rồi, cuối cùng cũng tới lúc tối ưu mấy bài toán quyết định này. Ý tưởng đơn giản nhất là duyệt vét cạn không gian mọi action để tìm lời giải tốt nhất. Để ý: ngay cả khi state và horizon đều hữu hạn, cách này vẫn có thể đắt tới mức không dùng được. Số ứng viên khả dĩ tăng theo hàm mũ với số time step. Mọi phương pháp thực dụng đều phải tính tới chuyện lớp bài toán này tự nhiên rã ra thành các stage riêng biệt.

Cách tiếp cận ở đây dựa trên *nguyên lý tối ưu của Bellman* trứ danh, nền móng cho dynamic programming. Lấy nguyên lời Richard E Bellman[^3]:

> Một optimal policy có tính chất này: dù initial state và initial decision là gì đi nữa, những decision còn lại buộc phải tạo thành một optimal policy đối với state sinh ra từ decision đầu tiên.

Được rồi, câu này nghĩa là gì? Nguyên lý tối ưu nói thế này: muốn tính được một optimal policy, ta nên biến cái vòng lặp thực hiện action rồi tính cost đó thành một thủ tục đệ quy. Cụ thể, thực hiện một action $a$ tại initial state $s$ thì ta sang một state mới $s' = T(s, a)$. Ở đó ta lại đối mặt với đúng cùng bài toán tìm optimal policy, chỉ khác là lần này xuất phát tại $s'$. Xem thử khai thác ý này thế nào.

Nhớ lại: value function $v^\pi$ là tổng cost khi đi theo policy $\pi$ mà xuất phát tại một state cho trước. Giờ định nghĩa *optimal value function* $v^\star$ là tổng cost khi chọn cách hành động tốt nhất mà xuất phát tại một state $s$ nào đó.

$$
\begin{array}{rl}
 v^\star(s) =
 \min\limits_{a_t} & \sum\limits_{t=0}^\infty
 \gamma^{t}c(s_t, a_t) \\
 \textrm{s.t.} & s_0 = s, \\
 & s_{t+1} = T(s_t, a_t), \\
 & a_t \in \mathcal{A}(s_t).
 \end{array}
$$

Để ý trong bài toán tối ưu ở trên, initial state chỉ được dùng đúng một chỗ là để chọn action đầu tiên. Các action sau không phụ thuộc trực tiếp vào nó mà chỉ phụ thuộc vào hệ quả của nó. Nghĩa là ta tách được bài toán làm hai phần: tính một *immediate cost* chỉ phụ thuộc initial state, và tính một *future cost* phụ thuộc mọi state kéo theo sau.

$$
\begin{array}{rl}
 v^\star(s) =
 \min\limits_{a,a_t} & {c(s, a)} + \left(
 \begin{array}{rl}
 \min\limits_{a_t} & \sum\limits_{t=1}^\infty
 \gamma^{t}c(s_t, a_t) \\
 \textrm{s.t.} & s_1 = s', \\
 & s_{t+1} = T(s_t, a_t), \\
 & a_t \in \mathcal{A}(s_t)
 \end{array}
 \right) \\
 \textrm{s.t.} & s' = T(s, a), \\
 & a \in \mathcal{A}(s).
 \end{array}
$$

Đã thấy cấu trúc đệ quy hé ra rồi đấy! Chỉ còn thiếu một chỗ: tổng trong future cost bắt đầu từ $t = 1$, nên rút $\gamma$ ra ngoài được. Đổi tên $l = t-1$ thì được

$$
\sum\limits_{t=2}^\infty \gamma^{t-1}c(s_t, a_t)
 = \gamma \sum\limits_{t=2}^\infty \gamma^{t-2}c(s_t,
 a_t)
 = \gamma \sum\limits_{l=1}^\infty \gamma^{l-1}c(s_l,
 a_l),
$$

và áp cái này vào biểu thức của $v^\star$,

$$
\begin{array}{rl}
 v^\star(s) =
 \min\limits_{a} & c(s, a) + \gamma\left(
 \begin{array}{rl}
 \min\limits_{a_l} & \sum\limits_{l=0}^\infty
 \gamma^{l}c(s_l, a_l) \\
 \textrm{s.t.} & s_0 = s', \\
 & s_{l+1} = T(s_l, a_l), \\
 & a_l \in \mathcal{A}(s_l)
 \end{array}
 \right) \\
 \textrm{s.t.} & s' = T(s, a), \\
 & a \in \mathcal{A}(s).
 \end{array}
$$

Biểu thức thì khổng lồ, nhưng thấy được ngay: phần future cost *chính xác* là optimal value $v^\star(s')$ khi khởi động dynamics tại $s' = T(s, a)$. Theo cách này, nguyên lý tối ưu tự viết ra bằng toán thành một phương trình đệ quy mà value của một optimal policy buộc phải thoả.

$$
\boxed{
 \begin{array}{rl}
 v^\star(s) =
 \min\limits_{a} & c(s, a) + \gamma
 v^\star(s') \\
 \textrm{s.t.} & s' = T(s, a), \\
 & a \in \mathcal{A}(s).
 \end{array}
 }
$$

Cái này gọi là *phương trình Bellman*, và toàn bộ dynamic programming là các phương pháp giải nó. Hơn nữa: coi phương trình Bellman như một đặc tả đệ quy cho các bài toán quyết định cũng được. Khi đó dynamic programming là mọi bản cài đặt riêng cho từng bài toán mà giải được nó.

### Tồn tại, duy nhất và fixed point

Đến lúc đi sâu vào giải tích rồi. Mỗi khi dân toán thấy một quan hệ đệ quy như phương trình Bellman, họ lập tức hỏi mấy câu kiểu: ta có bảo đảm gì về $v^\star$? Tin được là nó duy nhất không? Nó có tồn tại không đã? Đúng là dân toán như tôi nhìn có vẻ hơi quá lo với mấy câu hỏi này, nhưng lo là có lý do. Ngoài chuyện bảo đảm mọi thứ chạy được, ở đây chứng minh nghiệm tồn tại còn dạy luôn cho ta cách dựng ra nó! Nên chú ý nhé, vì ở mục sau ta sẽ biến mấy định lý trong đây thành thuật toán giải phương trình Bellman.

Đệ quy có quan hệ sâu với fixed point, nên tiện cái nào thì dùng cái đó. Để giải một bài toán bằng dynamic programming, bước đầu tiên là viết phương trình Bellman thành fixed point của một operator $\mathcal{B}: (\mathcal{S}\to \mathbb{R}) \to (\mathcal{S}\to \mathbb{R})$ tên là (đoán xem) *Bellman Operator*. Nó biến value function thành value function, định nghĩa thế này:

$$
\begin{array}{rl}
 (\mathcal{B}v)(s) =
 \min\limits_{a} & c(s, a) + \gamma v(s') \\
 \textrm{s.t.} & s' = T(s, a), \\
 & a \in \mathcal{A}(s).
 \end{array}
$$

Giờ, optimal value function $v^*$ chính là fixed point đó. Vậy ta quy câu hỏi tồn tại và duy nhất nghiệm cho phương trình Bellman về việc tìm fixed point của $\mathcal{B}$:

$$
v^* =
 \mathcal{B}v^*.
$$

Bạn chưa quen với fixed point thì bước chuyển từ phương trình Bellman sang operator ở trên nghe có vẻ lạ. Vậy nên thử một câu chuyện nhỏ để xây chút trực giác.

Tưởng tượng bạn là vua hoặc nữ hoàng của một vương quốc thần tiên. Bạn là quân chủ chuyên chế, bạn quyết làm gì thì thần dân theo nấy. Gần đây ngân khố vương quốc cạn dần. Các quan cố vấn khuyên bạn định ra một chính sách cai trị rõ ràng, kéo chi tiêu của vương quốc xuống mức thấp nhất. Ngoài chuyện là một kẻ cai trị tàn nhẫn, bạn còn là một nhà toán học cừ và là fan của blog này. Nên tới đây bạn biết phải làm gì để cứu vương quốc khỏi vỡ nợ: giải phương trình Bellman.

Tới đoạn này của bài bạn vẫn chưa biết cách giải nó, nên bạn tận dụng luôn cái thế giới thần tiên đang có: thuê một pháp sư nhìn vào quả cầu pha lê. Pháp sư đóng vai oracle, nói cho bạn biết mỗi tình thế sẽ tốn của vương quốc bao nhiêu trong tương lai. Sau có trời mới biết bao nhiêu nghi lễ và thần chú, pháp sư trao cho bạn một value function mới toanh sáng loáng $\char"1f52e: \mathcal{S}\to \mathbb{R}$.

Nhắm mắt nghe theo lời một quả cầu pha lê thì không bao giờ khôn. Nên bạn chỉ dùng nó để dự đoán tương lai, còn quyết định trước mắt thì tự phán đoán lấy. Nói cách khác, bạn cai trị vương quốc bằng cách giải bài toán tối ưu

$$
\begin{array}{rl}
 (\mathcal{B}\char"1f52e)(s) = \min\limits_{a}
 & c(s, a) + \gamma \char"1f52e(s') \\
 \textrm{s.t.} & s' = T(s, a), \\
 & a \in \mathcal{A}(s).
 \end{array}
$$

Vậy quá trình đi từ dự đoán tới quyết định chính xác là Bellman operator. Hàm $\mathcal{B}v$ là cost của việc chọn action tốt nhất khi lấy $v$ làm ước lượng cho tương lai.

#### Một định lý hữu dụng

Được rồi, ta đã biến bài toán tìm quyết định tối ưu thành giải phương trình Bellman, rồi biến tiếp thành tìm fixed point của Bellman operator,

$$
\mathcal{B}v^\star =
 v^\star.
$$

Cái này nghe vẫn phức tạp ngang chỗ xuất phát (chỉ là trừu tượng hơn) thì đừng sợ! Ta vừa tới đúng chỗ có thể triệu hồi một định lý mạnh từ giải tích để dẹp hết mọi vấn đề một lượt. Xin giới thiệu *Định lý điểm bất động Banach*!

**[Định lý: Banach Fixed Point]**

Trong một metric space đầy đủ $(M,\mathrm{d})$, mọi $f : M \to M$ liên tục mà làm giảm khoảng cách giữa các điểm:

$$
\mathrm{d}(f(v), f(w))
 \le \gamma \mathrm{d}(v, w),\; \textrm{for } \gamma \in
 [0, 1),
$$

đều có một fixed point $v^\star$ duy nhất.

Hơn nữa, từ bất kỳ giá trị ban đầu $v_0$ nào cũng tới được $v^\star$ bằng cách lặp $f$:

$$
\lim_{n \to \infty}
 f^n(v_0) = v^\star,\; \forall v_0 \in M.
$$

Thủ tục này hội tụ tuyến tính, với sai số tại mỗi vòng lặp bị chặn bởi

$$
\mathrm{d}(v_n, v^*) \le
 \frac{\gamma^n}{1 - \gamma} \mathrm{d}(v_0,
 f(v_0)).
$$

**[/]**

Chứng minh định lý này nằm ngoài phạm vi bài viết[^4]. Tuy vậy, có thể hiểu thế này: một ánh xạ co mọi khoảng cách lại thì cuối cùng ảnh của mọi điểm bị bóp về đúng một điểm.

Ở định lý này, chỗ đáng giá nhất là nó cho hẳn một công thức để dựng ra fixed point trên metric space. Chỉ cần hiểu phương trình fixed point như một luật cập nhật,

$$
v \gets f(v),
$$

rồi lặp nó cho tới khi khoảng cách hội tụ xuống dưới một ngưỡng dung sai nào đó. Từ mô tả trên viết ra thủ tục tính toán thì rất dễ.

```
function fixed_point(f; v0, tol)
 v = f(v0)
 while distance(v, v0) > tol
 v0 = v
 v = f(v) # Update rule
 end
 return v
end
```

#### Một metric space của các value function

Để áp định lý điểm bất động Banach cho Bellman operator, ta phải tìm một không gian hàm phù hợp mà trên đó $\mathcal{B}$ là một contraction. Một lựa chọn vừa vặn là các hàm liên tục bị chặn trên tập state, $C^0_b(\mathcal{S}, \mathbb{R})$, với khoảng cách cho bởi chuẩn đều

$$
\mathrm{d}(v, w) = \|v -
 w\|_\infty = \sup_{s \in \mathcal{S}} |v(s) -
 w(s)|.
$$

Trong metric space (đầy đủ) này, hoá ra $\mathcal{B}$ là một contraction với hệ số $\gamma$ (đúng vậy, chính là discount factor). Hơn nữa, với không gian state hữu hạn thì *mọi hàm đều liên tục và bị chặn*, nghĩa là cái trên bao trọn mọi thuật toán mà bài này quan tâm.

Tôi không muốn đi quá xa chủ đề chính của bài, cũng không muốn sa vào tiểu tiết toán học, nên đẩy phần chứng minh cần thiết xuống phụ lục.

**[Định lý: Tồn tại và duy nhất nghiệm]**

Mọi decision process với discount factor $\gamma < 1$ đều có một optimal value function $v^\star$ duy nhất thoả phương trình Bellman

$$
\begin{array}{rl}
 v^\star(s) =
 \min\limits_{a} & c(s, a) + \gamma
 v^\star(s') \\
 \textrm{s.t.} & s' = T(s, a), \\
 & a \in \mathcal{A}(s).
 \end{array}
$$

Hơn nữa, tính được optimal policy (không nhất thiết duy nhất) qua

$$
\begin{array}{rl}
 \pi^\star(s) =
 \argmin\limits_{a} & c(s, a) + \gamma
 v^\star(s') \\
 \textrm{s.t.} & s' = T(s, a), \\
 & a \in \mathcal{A}(s).
 \end{array}
$$

**[/]**

**[Chứng minh]**

Tất cả suy ra từ việc áp định lý điểm bất động Banach cho Bellman operator.

**[/]**

Kết quả trên là thứ tôi hay gọi là "định lý bazooka". Nó bảo đảm có đúng một optimal value function, kéo theo là một optimal policy. Rồi còn dạy luôn cách tính ra cái đó cho trường hợp state hữu hạn, như sẽ thấy ngay ở mục kế tiếp.

## Giải phương trình Bellman

Dynamic Programming là giải phương trình Bellman, và như mọi phương trình nổi tiếng, có nhiều hướng tiếp cận khả dĩ. Chọn hướng nào thì tuỳ bài toán và phần cứng đang có.

Từ đây trở đi, giả sử cả không gian state $\mathcal{S}$ lẫn không gian action $\mathcal{A}(s)$ đều *hữu hạn*. Nhờ vậy ta tập trung được vào các phương pháp vét cạn duyệt hết không gian state. Còn có những phương pháp khác tổng quát hoá được các ý ở đây sang không gian vô hạn, như Reinforcement Learning hay Dual Dynamic Programming. Nhưng đó là chuyện của một đêm khác…

Trước khi nhảy vào thuật toán, cũng đáng bàn qua vài quyết định kỹ thuật buộc phải chốt để cài đặt được chúng.

Điều đầu tiên phải để ý: trong một ngôn ngữ lập trình, cách biểu diễn hàm tự nhiên nhất là viết thành thủ tục tính toán[^5]. Nhưng làm vậy ở đây thì khá kém hiệu quả, vì sửa một thủ tục để cải tiến nó rất tốn tính toán. Vậy nên vì hiệu năng, người ta quen biểu diễn policy và value function không phải bằng hàm mà bằng một cấu trúc dữ liệu khác. Không gian state ở đây hữu hạn nên có rất nhiều cấu trúc dữ liệu biểu diễn chính xác được mấy hàm đó. Lựa chọn thường gặp là array hoặc hash map, nhưng thật ra cái gì lưu được hệ số thì đều dùng được. Dưới đây là vài ví dụ với mấy kiểu lưu trong bộ nhớ này.

```
# Storage with vector / array
# WARNING: This requires some method idx : States -> Int for later indexing
function asarray(f :: Function)
 return [f(s) for s in States]
end

# Storage with hash map / dictionary
function asdictionary(f :: Function)
 return Dict(s => f(s) for s in States)
end
```

Cái memoization mà người ta hay gắn với dynamic programming nằm trọn trong "mẹo" này. Tuy vậy, nên nhớ đây thuần tuý là chuyện biểu diễn hàm khi tính toán, hoàn toàn trực giao với mọi thiết kế thuật toán. Trong một ngôn ngữ có first-class function, làm dynamic programming chỉ bằng function composition là được. Chỉ là nó không nhanh như ta muốn thôi.

Trong các thuật toán, lựa chọn biểu diễn này viết thành hai kiểu opaque `Values{States}` và `Policy{States, Actions}`, coi như chúng lo hết phần boilerplate cần thiết.

Một điểm quan trọng nữa: ta chỉ tương tác với một process qua *tổng cost* của nó, không bao giờ đụng riêng lẻ vào các thành phần cấu thành[^6]. Vậy nên dựng sẵn luôn một hàm lo phần chuyển đổi đó.

```
# Turn a decision problem into its respective cost function.
function total_cost(p :: Process)
 return (v, s, a) -> p.cost(s, a) + p.γ * v[p.next(s, a)]
end
```

Để ý cách dùng ngoặc vuông để thể hiện ta đang truy cập một cấu trúc dữ liệu chứ không phải gọi một hàm.

### Value Iteration

Vậy là tới thuật toán đầu tiên: *value iteration*. Nhớ lại phần bàn trước: lặp Bellman operator trên bất kỳ đầu vào nào cũng hội tụ về optimal value function. Ý chính của thuật toán suy ra ngay từ đó: biến phương trình Bellman thành một luật cập nhật để tìm fixed point của nó.

$$
v \gets \mathcal{B}v.
$$

Vậy ta khởi đầu bằng một value function $v_0$ bất kỳ rồi lặp luật cập nhật trên. Nhờ phép màu của định lý điểm bất động Banach, cái này hội tụ về tối ưu. Thủ tục lặp lại cho tới khi sai số đều $\| v - \mathcal{B}v \|_\infty$ nhỏ hơn một ngưỡng dung sai đặt trước.

Mỗi vòng lặp của thuật toán đến từ việc đánh giá Bellman operator trong cách biểu diễn ta đã chọn. Vậy dùng `total_cost` để viết nó ra.

```
# The Bellman operator corresponding to a decision process.
# It uses a storage representation `Values` for the value function.
function bellman_operator(prob :: Process)
 return function(v)
 Bv = Values{States}() # Empty representation
 for s in States
 Bv[s] = minimum(a -> total_cost(prob)(v, s, a), Actions(s))
 end

 return Bv
 end
end
```

Cuối cùng, thuật toán là lặp thủ tục do `bellman` sinh ra cho tới khi nó hội tụ về fixed point. Sau đó, ta tính policy như nghiệm tối ưu ứng với value function đã xác định. Tên *value iteration* là vì nó chỉ dùng value function trong quá trình cập nhật, còn policy tính ra không đóng vai trò gì.

```
function value_iteration( prob :: Process # Data for decision process
 ; v0 = zeros(States) # Warm start --- all zeros if you don't know any better
 , tol) # Stopping tolerance
 # The optimal value function is the fixed point of the Bellman Operator
 v_opt = fixed_point(bellman_operator(prob); v0, tol)

 # The optimal policy is the choice of action for the total cost with the optimal value function.
 π_opt = Policy{States, Actions}()
 for s in States
 π[s] = argmin(a -> total_cost(p)(v_opt, s, a), Actions(s))
 end

 return π_opt, v_opt
end
```

Thuật toán trên chính là bản cài đặt trực tiếp của định lý điểm bất động, nên bảo đảm hội tụ tuyến tính về tối ưu. Tại mỗi vòng lặp, ta đánh giá Bellman operator một lần, tốn $\mathrm{O}(|\mathcal{S}|\cdot|\mathcal{A}|)$ phép tính. Dù vậy, trong một vòng lặp thì các thủ tục cực tiểu hoá diễn ra độc lập cho từng state, nên đánh giá $\mathcal{B}v$ là embarrassingly parallel theo state.

### Value Iteration tại chỗ

Bản cài đặt trước mở ra cơ hội song song hoá, nhưng chạy tuần tự thì nó có thể ì, vì nó chờ duyệt hết mọi state rồi mới cập nhật value function. Cách khác hợp với máy tuần tự hơn: cập nhật value function ngay tại chỗ, để thông tin vừa cải thiện lan sang các state khác cho sớm. Cái đánh đổi là cách này không còn rải việc tối ưu ra nhiều process song song được nữa.

Về thuật toán, thay đổi duy nhất cần làm là viết lại thủ tục lặp fixed point để tính tại chỗ.

```
function fixed_point_inplace!(f, v; tol)
 maxerr = Inf
 while maxerr > tol
 maxerr = 0 # Start with smallest error possible
 for s in States
 prev = v[s]
 v[s] = f(v)[s]
 # Estimate ||f(v) - v||_∞ component by component
 maxerr = max(maxerr, abs(v[s] - prev))
 end
 end

 return v
end

function value_iteration_inplace!(prob, v0 = zeros(States) ; tol)
 v_opt = fixed_point_inplace!(bellman_operator(prob), v0 ; tol)

 π_opt = Policy{States, Actions}()
 for s in States
 π[s] = argmin(a -> total_cost(p)(v_opt, s, a), Actions(s))
 end

 return π_opt, v_opt
end
```

Trong animation dưới đây, ta thấy value iteration tại chỗ chạy thật cho bài toán thoát mê cung. Trong mô hình này, mỗi state là một ô trên lưới, còn action là các hướng đi được tại ô đó (các ô kề mà không bị tường chắn). Mục tiêu là tới được cạnh dưới bên phải trong ít bước nhất có thể. Ta làm vậy bằng cách khởi đầu với value đồng nhất bằng không và một policy ngẫu nhiên. Bên trái là value function tại mỗi vòng lặp, bên phải là policy tương ứng.

[video: https://iagoleal.com/posts/dynamic-programming/labyrinth-value-iteration.webm]

Mấy bản cài đặt ở trên thật ra chỉ là các biến thể của cùng một ý: lặp Bellman operator để hội tụ về optimal value function. Còn nhiều chỗ tinh chỉnh khác nữa mà ta làm được, nhưng chúng không đụng tới bản chất thuật toán. Chọn warm start tốt, song song hoá, đổi thứ tự duyệt state ở bản tại chỗ, v.v. Cách nào tốt nhất thường tuỳ bài toán.

### Policy Iteration

Một vấn đề của value iteration là mọi tính toán về policy đều ngầm, vì ta chỉ làm việc với value function. Vì vậy, có thể đã tới được một optimal policy rồi mà vẫn lặp tiếp thuật toán, chỉ vì value function chưa hội tụ. Ở mục này, ta làm quen với *policy iteration*, một thuật toán dùng policy để tính value function và dùng value function để tính policy, cho tới khi hội tụ về tối ưu. Cái ăn tiền của nó là tính thẳng ra được một optimal policy sau hữu hạn bước.

#### Policy Evaluation

Giả sử ai đó đưa cho bạn một policy $\pi$ và không nói gì thêm về nó. Làm sao tính được value function $v^\pi$ ứng với nó? Một cách là để ý nó thoả một đệ quy giống phương trình Bellman, chỉ thiếu bước cực tiểu hoá.

$$
\begin{array}{rl}
 v^\pi(s) =
 & c(s, a) + \gamma v^\pi(s') \\
 & \quad\textrm{where}\; s' = T(s, \pi(s)).
 \end{array}
$$

Cũng biến được phương trình này thành một bài toán fixed point bằng cách định nghĩa một operator

$$
\begin{array}{rl}
 (\mathcal{B}^\pi v)(s) =
 & c(s, a) + \gamma v(s') \\
 & \quad\textrm{where}\; s' = T(s, \pi(s)).
 \end{array}
$$

Cái trên viết thành thủ tục tính toán được ngay:

```
function policy_bellman_operator(prob :: Process, pi :: Policy)
 return function(v)
 Bv = Values{States}() # Empty representation
 for s in States
 Bv[s] = total_cost(prob)(v, s, pi[s])
 end
 return Bv
 end
end
```

Giờ có thể nhìn $\mathcal{B}^\pi$ như cost của một decision process mà tập action tại mỗi state bị co lại còn đúng một lựa chọn. Vậy nên dưới cùng những giả thiết như trước, ta biết nó có một fixed point duy nhất.

Hơn nữa, biến nó thành thủ tục cập nhật thì hội tụ về $v^\pi$ với mọi value function ban đầu. Theo hướng này, ta tới một thuật toán đánh giá cost của một policy, đặt tên chẳng chút sáng tạo là *policy evaluation*.

```
function policy_evaluation(prob :: Process
 , π :: Policy
 ; v0 = zeros(States)
 , tol)
 return fixed_point(policy_bellman_operator(prob, pi); v0, tol)
end
```

Để ý chỗ giống với value iteration. Khác nhau đúng một chỗ: ta truyền operator nào vào fixed point. Thay vì chọn một action tối ưu, nó chỉ đi theo policy. Hơn nữa, toàn bộ phần bàn ở trên về các biến thể của value iteration cũng đúng cho policy evaluation. Sửa y như vậy thì cũng được đúng những hiệu quả đó.

#### Policy Improvement

Sau khi đã biết value function của một policy, câu hỏi tiếp theo là làm sao cập nhật nó thành một policy tốt hơn. Tức là, dùng thông tin này thế nào để tiến gần tối ưu hơn.

Nhớ lại mấy phần bàn trước: áp Bellman operator $\mathcal{B}$ lên bất kỳ value function không tối ưu nào cũng cho ra kết quả tốt hơn hẳn. Vậy nên nó cải thiện được value function của một policy.

$$
(\mathcal{B}v^\pi)(s) =
 \min_{a \in \mathcal{A}(s)} c(s, a) + v^\pi(T(s, a)) \le
 c(s, \pi(s)) + v^\pi(T(s, \pi(s))) =
 v^\pi(s).
$$

Value function $\mathcal{B}v^\pi$ mã hoá cost của việc chọn action tốt nhất ngay lúc này trong khi đi theo $\pi$ ở mọi bước tương lai. Ta rút ra được một policy từ nó bằng cách lấy nghiệm của bài toán tối ưu.

$$
\begin{array}{rl}
 \pi'(s) =
 \argmin\limits_{a} & c(s, a) + \gamma
 v^\pi(s') \\
 \textrm{s.t.} & s' = T(s, a), \\
 & a \in \mathcal{A}(s).
 \end{array}
$$

Trừ khi $\pi$ vốn đã tối ưu, phương trình trên sinh ra một policy tốt hơn hẳn. Từ đó định nghĩa được một thủ tục, gọi là *policy_improvement*, biến một value function $v$ thành một policy $\pi$ tốt hơn bất kỳ policy nào mà v biểu diễn.

```
function policy_improvement(prob :: Process, v :: Values)
 π = Policy{States, Actions}()
 for s in States
 π[s] = argmin(a -> total_cost(v_π, s, a), Actions(s))
 end
 return π
end
```

#### Xen kẽ evaluation và improvement

Khởi đầu từ một policy ngẫu nhiên $\pi_0$ bất kỳ, rồi chạy xen kẽ policy evaluation và improvement, ta sinh ra một dãy policy và value function

$$
\pi_0 \xrightarrow{\textrm{evaluation}} v^{\pi_0}
 \xrightarrow{\textrm{improvement}}
 \pi_1 \xrightarrow{\textrm{evaluation}} v^{\pi_1}
 \xrightarrow{\textrm{improvement}}
 \ldots
$$

Các value function giảm đơn điệu trong khi các policy tốt lên ngặt, cho tới khi hội tụ về tối ưu.

Vậy là tới một thuật toán dynamic programming nữa: *policy iteration*. Nó lặp đi lặp lại thế này: lấy một policy $\pi$, tìm value function $v^\pi$ của nó qua policy evaluation, rồi cuối cùng dùng policy improvement để tới một policy tốt hơn. Chỉ có hữu hạn policy, mà lần nào ta cũng thu được một policy tốt hơn ngặt, nên thuật toán này bảo đảm hội tụ về một optimal policy sau hữu hạn bước.

```
function policy_iteration(prob :: Process
 ; v0 = zeros(States)
 , π0 = rand(Policy{States, Actions)
 , tol)
 v = policy_evaluation(prob, π_0 ; v0 = v_0, tol = tol)
 π = policy_improvement(prob, v)

 while π != π0
 π0 = π
 # Use previous v as warm start
 v = policy_evaluation(prob, π ; v0 = v, tol = tol)
 π = policy_improvement(prob, v)
 end
 return π, v
end
```

Y như value iteration, policy iteration cũng có nhiều biến thể về cách duyệt state. Bản cài đặt ở trên bám sát lý thuyết và là embarrassingly parallel ở cả bước evaluation lẫn improvement. Dù vậy, coi policy iteration như một nguyên lý thuật toán thì có ích hơn là coi nó như một thuật toán cụ thể. Coi vậy rồi thì chỉnh các bước cho hợp với bất kỳ thông tin riêng nào của bài toán mà ta có thể có sẵn.

### Backward Induction trên horizon hữu hạn

Tới giờ, ta luôn làm việc với các decision process tổng quát chạy vô thời hạn. Dù vậy, có những process nhiều cấu trúc hơn thế. Thử nhìn kỹ hơn vào một trường hợp: ta khai thác được cấu trúc không gian state của bài toán để chỉnh mấy thuật toán này cho nhanh hơn hẳn. Ở mục này ta xử lý các *bài toán horizon hữu hạn*, và sẽ thấy: với chúng, ta làm cho value iteration hội tụ trong đúng một vòng lặp được!

**[Định nghĩa]**

Một state $\blacksquare$ trong một decision process là **terminal** nếu mọi action thực hiện được trên nó đều có cost bằng không và không chuyển sang state nào khác.

$$
\forall a \in
 \mathcal{A}(s),\,c(\blacksquare, a) = 0\,\text{ and }\,
 T(\blacksquare, a) = \blacksquare.
$$

**[/]**

Dynamics coi như kết thúc mỗi khi process chạm tới một terminal state. Về cơ bản, có việc phải làm cho tới khi chạm được $\blacksquare$; tới đó thì ta cứ nghỉ ngơi không làm gì suốt quãng vĩnh cửu còn lại. Cái tên từ đó mà ra. Ngoài ra, vì mọi action của nó đều nhạt nên người ta quen vẽ nó không có mũi tên.

Khi bảo đảm được là với mọi policy, dynamics đều chạm một terminal state sau hữu hạn bước, ta nói nó có *horizon hữu hạn*. Khi đó, graph nền của state machine là phi chu trình. Tức là, mọi quỹ đạo ghé một state không phải terminal nhiều nhất một lần.

![](https://iagoleal.com/posts/dynamic-programming/dd24e4b1f40dbafb4b8d0e6b3ef4569bc611c79e.svg)

#### Thuật toán Backwards Induction

Ta cải thiện được các thuật toán Dynamic Programming bằng cách duyệt state khôn khéo hơn. Ở mọi thuật toán đã thấy, không có giả thiết nào về thứ tự duyệt không gian state tại mỗi vòng lặp. Ta còn để ý là nhiều cái trong số đó chạy song song được. Nên cũng không có bảo đảm nào sinh ra từ thứ tự này. Dù vậy, trong thuật toán tại chỗ, các thứ tự khác nhau làm thông tin lan đi theo những đường khác nhau.

Trong một bài toán horizon hữu hạn, ta khai thác được cấu trúc phi chu trình để có một thứ tự tối ưu, sao cho value iteration hội tụ trong đúng một vòng lặp! Đó là thứ tự tô-pô của graph: gán cho mỗi state một nhãn số tự nhiên, sao cho $s$ đứng trước mọi state chuyển được sang nó. Nghe thì có vẻ khó, nhưng đã có các phương pháp chuẩn để tính nó tuyến tính theo cỡ của process, tức là tốn $\mathrm{O}(|\mathcal{S}| + |\mathcal{A}|)$ bước. Ở dưới là một thứ tự tô-pô cho ví dụ trước.

![](https://iagoleal.com/posts/dynamic-programming/446baca9fe5e41b97db5d60ec90f32eb712fcfb3.svg)

Để ý là nó không duy nhất. Cũng để ý là các chỉ số sớm nhất rơi vào các terminal state rồi rải "ngược" theo các mũi tên. Tên thuật toán tiếp theo từ đó mà ra: *Backwards Induction*.

Backwards Induction là một biến thể của Value Iteration dùng sắp xếp tô-pô để duyệt không gian state khéo hơn. Nó y hệt thuật toán tại chỗ nhưng hội tụ chính xác trong đúng một vòng lặp. Cải tiến gì mà ghê vậy!

Chứng minh bằng quy nạp là ra: cái này quả thật hội tụ trong một lượt. Trường hợp cơ sở là các terminal state: cost của chúng bằng không và automaton không bao giờ rời khỏi chúng, kéo theo $v^\star(\blacksquare) = (\mathcal{B}v^\star)(\blacksquare) = 0$.

Trên một state $s$ không phải terminal, giả thiết quy nạp: value function $v$ ta tính được là tối ưu với mọi state có chỉ số nhỏ hơn. Mà ta chỉ chuyển từ $s$ sang một state có chỉ số nhỏ hơn, nên ước lượng hiện tại $v(T(s, a))$ đã là tối ưu rồi. Khi đó, phép gán cục bộ $v(s) \gets (\mathcal{B}v)(s)$ là well-defined và cho ra giá trị tối ưu tại state này.

$$
\begin{array}{rl}
 v(v) \gets (\mathcal{B}v)(s) =
 \min\limits_{a} & c(s, a) + \gamma v(s') \\
 \textrm{s.t.} & s' = T(s, a)\quad
 \color{red}{\Longleftarrow \text{ already solved}} \\
 & a \in \mathcal{A}(s).
 \end{array}
$$

Phần bàn ở trên chứng minh nó hội tụ trong một lượt. Giờ chỉ còn xếp phần chứng minh đó lại thành một thuật toán. Nó chạy y như value iteration, khác ở chỗ nó sắp xếp các state trước và chỉ chạy đúng một lượt.

```
# Value Iteration tuned for a DAG
function backward_induction(p :: Process)
 v = Values{States}()
 π = Policy{States, Actions}()

 # Traverse from terminal to initial states
 for s in topological_sort(States, Actions)
 v[s], π[s] = minimize(a -> total_cost(p)(v, s, a), Actions(s))
 end

 return π, v
end
```

Tôi khuyên bạn đem cái này so với value iteration tổng quát để thấy ta được gì. Có một điểm cần rõ: backward induction làm đúng cùng phép toán như value iteration cho mỗi state, nhưng chỉ cần đúng một lượt trên không gian state. Nhờ vậy nó hiệu quả hơn nhiều. Tôi biết câu này tôi lặp lại nhiều lần rồi, nhưng nó *đủ quan trọng để đáng được vậy*.

Một chi tiết tinh tế hơn: vì trong dynamics có nhiều cấu trúc để khai thác hơn, thuật toán không phải giả định nhiều tới thế về Bellman operator. Chẳng hạn, chứng minh hội tụ ở trên không phụ thuộc gì vào định lý điểm bất động Banach, nghĩa là ta không cần bất kỳ giả thiết nào về discount factor $\gamma$. Cụ thể là backwards induction chạy được cho cả những process không có chiết khấu![^7]

#### State theo từng stage

Có một dạng process horizon hữu hạn phổ biến tới mức đáng có riêng một mục. Nó gồm các state và action tiến tuần tự theo thời gian. Ở dạng này, có một horizon cố định gồm $N$ bước, còn không gian state chia theo bước $t$.

![](https://iagoleal.com/posts/dynamic-programming/finite-horizon.svg)

Không gian state của một process như vậy có cấu trúc rất rõ, và đặc biệt là luôn phi chu trình. Ta sắp xếp tô-pô nó được bằng cách duyệt từng cụm ngược theo thời gian. Hình dưới minh hoạ backwards induction chạy cho loại process này.

![](https://iagoleal.com/posts/dynamic-programming/backward-induction.svg)

Khi có sẵn cấu trúc theo stage này, ta nhét luôn nó vào thuật toán để khỏi phải nhọc công sắp xếp các state.

```
function backward_induction_in_time(p :: Process)
 v = Values{States}()
 π = Policy{States, Actions}()

 for t in N:1 # <-- Equivalent to a topological sort
 for s in States(t) # <-- Embarassingly parallel
 v[s], π[s] = minimize(a -> total_cost(p)(v, s, a), Actions(s))
 end
 end

 return π, v
end
```

Cái trên chẳng qua là một phiên bản chuyên biệt hoá của mấy thuật toán trước. Công sức tính toán của nó đúng bằng $|\mathcal{S}|\cdot|\mathcal{A}|$, vì nó rút lại là một lượt Value Iteration duy nhất mà không cần tiền xử lý gì. Khác với backwards induction thông thường, nó còn là embarrassingly parallel ở vòng lặp trong, vì không có phụ thuộc nào trong cùng một stage. Bạn khai thác chỗ này để tăng tốc thêm được.

## Bất định: không ai biết hết mọi thứ

Được rồi, tới lúc tóm tắt lại một chút. Chuyến đi này khởi đầu bằng automata và các dynamics điều khiển được, rồi chỉ ra cách biểu diễn tập action tốt nhất. Chúng là những tập thoả một quan hệ đệ quy nhất định trên value function tương ứng, quan hệ đó tên là phương trình Bellman. Rồi ta khảo sát vài cách giải phương trình này qua các phương pháp tìm fixed point. Có một chi tiết chạy suốt tất cả những cái đó: ta luôn có thông tin hoàn hảo về hệ đang xét.

Trong thế giới thật, không có bảo đảm nào là thực hiện một action sẽ đưa bạn vào một state xác định. Nói chung, có vô số state khả dĩ (có khi là tất cả) mà hệ có thể chuyển sang. Mô hình hoá chuyện này bằng cách sửa kiểu của transition function thành

$$
T : (s : \mathcal{S})
 \times \mathcal{A}(s) \to M \mathcal{S}
$$

trong đó $M$ chuyển một kiểu sang một bối cảnh bất định nào đó.[^8] Ví dụ thường gặp của mấy operator này là

- $M$ là tập lũy thừa $\mathcal{P}$. Khi đó, đầu ra của transition liệt kê mọi state kéo theo khả dĩ, định nghĩa nên một automaton bất định.

- $M$ đưa các tập sang phân phối xác suất trên chúng. Theo cách này, ta có các hệ stochastic với nhiều tương lai khả dĩ. Tuy vậy, khác với ví dụ trước, ở đây có khái niệm mỗi state kế tiếp khả dĩ tới mức nào.

- M là ánh xạ đồng nhất. Theo cách này, $M \mathcal{S}= \mathcal{S}$. Cái này để chỉ ra trường hợp tất định cũng nằm trọn trong trường hợp bất định.

- $M$ biểu diễn các action do người khác thực hiện. Trong nhiều tình huống (chẳng hạn một ván game), còn có những người chơi khác ngoài bạn, và họ cũng thực hiện được action làm đổi state. Vì action của họ cũng ảnh hưởng tới kết cục, transition chỉ trả về được một hàm $\mathcal{A}(s) \to \mathcal{S}$.

Để xử lý các transition bất định, ta cần lấy một value function rồi gộp mọi cost khả dĩ của cái tương lai bất định đó lại thành một số thực duy nhất,

$$
\rho : (\mathcal{S}\to
 \mathbb{R}) \times M \mathcal{S}\to \mathbb{R}.
$$

Hàm $\rho$ phụ thuộc vào bối cảnh bất định mà ta đang xử lý, và ngay sau đây ta sẽ thấy vài ví dụ của nó. Dùng nó, ta định nghĩa được một Bellman operator

$$
\begin{array}{rl}
 (\mathcal{B}v)(s) =
 \min\limits_{a} & c(s, a) + \gamma \rho(v, s')
 \\
 \textrm{s.t.} & s' = T(s, a), \\
 & a \in \mathcal{A}(s).
 \end{array}
$$

Khá giống cái ta có trước đó, bạn thấy vậy không? Với vài điều kiện nhẹ trên $\rho$, mọi suy dẫn ở [phụ lục](#phụ-lục-hội-tụ-trên-horizon-vô-hạn) về tồn tại và duy nhất nghiệm vẫn đúng trong bối cảnh này. Hơn nữa, mọi thuật toán ở trên (value iteration, policy iteration, backwards induction) đều chỉ dùng tổng cost của hệ, mà cái đó vẫn là một hàm tất định. Vậy nên ta áp chúng vào bối cảnh này được *mà chẳng cần sửa gì cả*. Ngầu chứ hả?

### Ví dụ: phương trình truy hồi và Fibonacci

Một bài hướng dẫn dynamic programming mà không tính dãy Fibonacci quen thuộc thì còn ra gì nữa, đúng không? Ví dụ này thật ra khá đơn giản, và đem toàn bộ sức mạnh ta đã dựng ra dùng thì đúng là quá tay. Dù vậy, nó là ví dụ đầu tiên khá thường gặp khi học dynamic programming trong các lớp khoa học máy tính. Nên cũng đáng nhìn lại loại bài toán này bằng bộ máy hình thức ta vừa dựng.

Một quan hệ truy hồi là một hàm bất kỳ $\N \to \mathbb{R}$, trong đó số hạng thứ n được định nghĩa đệ quy qua các số hạng trước.

$$
f(n) = \begin{cases}
 c_n, & n < k \\
 g(n, f(n-1), \ldots, f(n-k)), & n \ge k.
 \end{cases}
$$

Các $c_n$ là hằng số ứng với trường hợp cơ sở của đệ quy, còn các giá trị $f(n)$ khác phụ thuộc trực tiếp vào $k$ số hạng trước đó.

Ví dụ nổi tiếng có cấu trúc này là hàm giai thừa và hàm Fibonacci:

$$
\begin{align*}
 \mathrm{fat}(n) &= \begin{cases}
 1, & n = 0 \\
 n \cdot \mathrm{fat}(n-1), & n \ge 1.
 \end{cases} \\

 \mathrm{fib}(n) &= \begin{cases}
 0, & n = 0 \\
 1, & n = 1 \\
 \mathrm{fib}(n-1) + \mathrm{fib}(n-2), & n \ge
 2.
 \end{cases} \\
 \end{align*}
$$

Nói chung, tính thẳng $f(n)$ theo định nghĩa có thể chậm theo hàm mũ. Nhưng với dynamic programming, bạn tính nó trong thời gian tuyến tính theo $n$ được.

Ý tưởng là định nghĩa một decision process bất định mà phương trình Bellman của nó chính xác là quan hệ truy hồi. Khi đó, optimal value function bằng $f$ tại mọi giá trị cho tới cái $N$ ta muốn tính. Các state là các số $0,\ldots, N$, còn chỉ có đúng một action giả $\blacklozenge$. Với transition, ta đi theo truy hồi của các chỉ số, dùng tập lũy thừa làm nguồn bất định. Để ý: đây là một process horizon hữu hạn.

$$
T(s, \blacklozenge) = \begin{cases}
 \emptyset, & s < k \\
 \{s-1, s-2, \ldots, s-k\}, & s \ge k.
 \end{cases}
$$

Với immediate cost, ta dùng các trường hợp cơ sở $c_n$ cho $k$ stage đầu, còn lại đều bằng không.

$$
c(s, \blacklozenge) = \begin{cases}
 c_s, & s < k \\
 0, & s \ge k.
 \end{cases}
$$

Còn để gộp trên tập các chỉ số tương lai, có lựa chọn nào tốt hơn chính quan hệ $g$?

$$
\rho(v, s') = g(s, \{
 v(n) \mid n \in s' \}).
$$

Với cách dựng này, phương trình Bellman của hệ nhìn rất giống truy hồi ban đầu.

$$
v(s) = \min_{a \in \{\blacklozenge\}} \begin{cases}
 c_s, & s < k \\
 g(s, v(s-1), \ldots, v(s-k)), & s \ge k.
 \end{cases}
$$

Chỉ có đúng một action nên phép cực tiểu hoá là thừa, và fixed point của nó thoả truy hồi ban đầu. Vì bài toán đang xét có horizon hữu hạn, ta giải nó bằng Value Iteration hoặc Backwards Induction được, kể cả khi không có discount factor $\gamma$.

Ví dụ, thử tính 15 số Fibonacci đầu tiên. Video sau cho thấy các bước của value iteration.

[video: https://iagoleal.com/posts/dynamic-programming/fibonacci-value-iteration.webm]

Vì horizon hữu hạn, ta cải thiện thêm được nữa bằng Backwards Induction! Process ta vừa dựng có đúng một state mỗi stage, trong đó ta coi initial state là $N$ còn state cuối là $0$ (nghĩa là ở đây ta đi ngược lại). Vậy nên ta dùng backwards induction để tính phương trình Fibonacci trong đúng $n$ bước được.

[video: https://iagoleal.com/posts/dynamic-programming/fibonacci-backward-induction.webm]

### Stochastic Dynamic Programming

Là một ngành ứng dụng tử tế, dynamic programming ngay từ đầu đã luôn để mắt tới tính ngẫu nhiên. Thế giới thật đầy bất định, mà còn gì mô hình hoá chuyện không biết trước tương lai tốt hơn chính xác suất?

Để một automaton thành stochastic, transition phải trả về một phân phối xác suất trên tập state. Trong tài liệu, bạn thấy mấy hệ này dưới tên *Markov Decision Process* (viết tắt MDP). Tên này đến từ chỗ state mới chỉ phụ thuộc state và action hiện tại, độc lập với lịch sử của process; y như một Markov chain, vốn là MDP với đúng một action. Trực giác thường dùng cho loại process này là coi nó như tương tác giữa một actor và một environment. Tại mỗi time step, environment ở một state $s$ (mà actor biết được). Actor chọn được trong nhiều action khác nhau $a \in \mathcal{A}(s)$ để tương tác với nó, mỗi cái tốn một cost nhất định. Action này tác động lên environment theo cách actor không với tới được (nên mới stochastic / bất định), làm state của nó đổi thành $s' = T(s, a)$. Trước khi transition đó xảy ra, ta chỉ ước lượng được $s'$ sẽ là gì, kèm bất định. Sơ đồ dưới minh hoạ chuyện này.[^9]

![](https://iagoleal.com/posts/dynamic-programming/mdp.svg)

Cho phép có tính ngẫu nhiên thì mô hình hoá được thêm rất nhiều tình huống thú vị. Chẳng hạn, robot chơi video game! State có thể là state nội bộ của game, hoặc phần game quan sát được mà người chơi với tới, còn action là các nút trên tay cầm. Transition nằm bên trong game, còn cost thì liên quan tới một yếu tố thắng/thua nào đó. Bạn từng nghe tới bài *Playing Atari with Deep Reinforcement Learning* của Volodymyr Mnih và cộng sự[^10] chưa? Trong đó, họ dùng reinforcement learning để train một robot chơi được game Atari 2600. Toàn bộ phần mô hình hoá làm qua Markov decision process, theo cách rất giống phần bàn ở đoạn này. Tôi rất khuyên bạn ngó qua.

Vì không biết được tương lai, công cụ thường dùng là lấy mọi kết cục khả dĩ rồi tính trung bình cost của chúng. Cái này cho ta một hàm gộp để rút một giá trị tất định ra từ một transition stochastic.[^11]

$$
\rho(v, S) =
 \mathbb{E}[v(S)].
$$

*Stochastic dynamic programming* là ngành chuyên tối ưu kỳ vọng tổng cost của một Markov Decision Process trên mọi policy khả dĩ.

$$
v^\star(s) = \min_\pi v^\pi(s) = \min_{a_t}
 \mathbb{E}\left[ \sum\limits_{t=0}^\infty
 \gamma^{t}c(s_t, a_t) \,\middle|\, s_0 = s,\, s_{t+1} =
 T(s_t, a_t) \right]
$$

Chắc bạn cũng đoán ra, cái trên tương đương một phương trình Bellman. Vì kỳ vọng là tuyến tính, cách suy dẫn khá giống cái ta đã làm cho các process tất định.

$$
\begin{array}{rl}
 v^\star(s) =
 \min\limits_{a} & c(s, a) + \gamma
 \mathbb{E}\left[v^\star(s') \right] \\
 \textrm{s.t.} & s' = T(s, a), \\
 & a \in \mathcal{A}(s).
 \end{array}
$$

Với không gian state hữu hạn, phương trình này có cùng tính chất contraction như phương trình tất định. Vậy nên bộ công cụ value iteration và policy iteration cũng dùng ngay được để giải MDP. Độ phức tạp tính toán của chúng thì tệ hơn, vì phép tính trung bình làm luật cập nhật $v \gets \mathcal{B}v$ tốn $\mathrm{O}(|\mathcal{S}|^2|\cdot|\mathcal{A}|)$ phép tính.

## Kết thúc chuyến đi

Vậy là cuối cùng ta cũng đi hết phần tổng quan về dynamic programming. Tôi thật lòng mong bạn đọc bài này thấy vui bằng lúc tôi viết nó. Và mong DP có được chỗ danh dự nó xứng đáng trong bộ đồ nghề giải quyết vấn đề của bạn![^12]

Tất nhiên, một bài blog thì quá bé để bao trọn một chủ đề rộng như DP. Vẫn còn chuyện ước lượng value function thay vì tính thẳng ra nó, chuyện không gian state vô hạn, chuyện thời gian liên tục, và cả đống thứ hay ho khác ta làm được. Cũng còn rất nhiều mối nối với reinforcement learning, mà bài này mới chỉ chạm tới bề mặt. Tiếc là mấy cái đó phải để dành làm chuyện của một đêm khác.

Tạm biệt, hẹn gặp lại lần sau!

## Lời cảm ơn

Bài này ra đời sau một loạt buổi trò chuyện với Pedro Xavier. Giải thích một thứ gì đó cho người thông minh có cái hay: chính người giải thích cũng học được rất nhiều trong lúc đó. Đôi khi học đủ nhiều tới mức viết được hẳn một bài blog về nó.

Tôi cũng mắc nợ Ivani Ivanova, một thợ săn lỗi chính tả tuyệt vời. Còn sót lỗi chính tả nào thì là tại tôi lười… Cô ấy đã làm rất tốt.

## Phụ lục (hội tụ trên horizon vô hạn)

Trong phụ lục này ta chỉ ra Bellman Operator

$$
\begin{array}{rl}
 (\mathcal{B}v)(s) =
 \min\limits_{a} & c(s, a) + \gamma v(s') \\
 \textrm{s.t.} & s' = T(s, a), \\
 & a \in \mathcal{A}(s)
 \end{array}
$$

là một *monotone contraction* trên không gian các hàm liên tục bị chặn.

Bắt đầu chứng minh bằng *tính đơn điệu*. Để làm vậy, đưa vào một thứ tự bộ phận trên không gian các value function $\mathcal{S}\to \mathbb{R}$, cho bởi thứ tự đều trên mọi state,

$$
v \le w \iff \forall s
 \in \mathcal{S},\, v(s) \le w(s).
$$

**[Định lý: Tính đơn điệu]**

Bellman Operator bảo toàn thứ tự đều của các value function:

$$
v \le w \implies
 \mathcal{B}v \le \mathcal{B}w.
$$

**[/]**

**[Chứng minh]**

Với mọi state $s$ và action $a$, giả thiết $v \le w$ kéo theo

$$
c(s, a) + \gamma
 v(T(s,a)) \le c(s, a) + \gamma w(T(s,a)).
$$

Vì cái này đúng với mọi $a$, lấy cực tiểu hai vế thì bất đẳng thức được bảo toàn.

$$
\min_{a \in \mathcal{A}(s)} c(s, a) + v(T(s,a)) \le
 \min_{a \in \mathcal{A}(s)} c(s, a) + w(T(s, a)) \\
 (\mathcal{B}v)(s) \le (\mathcal{B}w)(s).
$$

Dòng trên đúng với mọi state, khép lại chứng minh.

**[/]**

Một tính chất quan trọng nữa của $\mathcal{B}$: tịnh tiến đều đầu vào $v$ thì đầu ra cũng tịnh tiến đều.

**[Định lý]**

Với mọi hằng số $k,\,\mathcal{B}(v + k) = \mathcal{B}v + \gamma k$.

**[/]**

**[Chứng minh]**

$$
\begin{array}{rlll}
 \mathcal{B}(v + k)(s) &= &\min\limits_{a}
 & c(s, a) + \gamma (v(s') + k) \\
 &&\textrm{s.t.} & s' = T(s, a),
 \\
 && & a \in
 \mathcal{A}(s) \\
 &=& \min\limits_{a} & c(s, a) +
 \gamma v(s') + \gamma k\\
 &&\textrm{s.t.} & s' = T(s, a),
 \\
 && & a \in
 \mathcal{A}(s).
 \end{array}
$$

Vì số hạng $\gamma k$ không phụ thuộc action $a$, ta rút nó ra khỏi phép tối ưu được,

$$
\mathcal{B}(v + k)(s) =
 \mathcal{B}(v)(s) + \gamma k.
$$

Vậy là xong định lý.

**[/]**

Giờ chứng minh Bellman operator co không gian các hàm liên tục bị chặn lại theo discount factor.

**[Định lý: Contraction]**

Bellman Operator liên tục với hằng số Lipschitz $\gamma$, $$
\|\mathcal{B}v -
 \mathcal{B}w\|_\infty \le \gamma \|v -
 w\|_\infty.
$$ Khi $\gamma < 1$, nó là một contraction.

**[/]**

**[Chứng minh]**

Từ định nghĩa chuẩn đều, với mọi state $s$ ta có

$$
v(s) - w(s) \le \|v - w\|_\infty \\
 v(s) \le w(s) + \|v - w\|_\infty.
$$

Từ tính đơn điệu vừa chứng minh, áp $\mathcal{B}$ lên hai vế thì bất đẳng thức này được bảo toàn:

$$
(\mathcal{B}v)(s) \le
 \mathcal{B}(w + \|v - w\|_\infty)(s).
$$

Và vì vế phải ở trên có một phép tịnh tiến đều, ta rút hằng số ra được:

$$
\begin{aligned}
 (\mathcal{B}v)(s) &\le (\mathcal{B}w)(s) +
 \gamma \|v - w\|_\infty \\
 (\mathcal{B}v)(s) - (\mathcal{B}w)(s) &\le
 \gamma \|v - w\|_\infty.
 \end{aligned}
$$

Dùng tính đối xứng của chuẩn, ta lặp lại đúng cách suy dẫn đó theo chiều ngược lại (cho $w - v$) để có một bất đẳng thức cho giá trị tuyệt đối. Lấy supremum thì nó thành kết quả ta muốn.

$$
\begin{aligned}
 |(\mathcal{B}v)(s) - (\mathcal{B}w)(s)| &\le
 \gamma \|v - w\|_\infty \\
 \sup_{s\in\mathcal{S}} |(\mathcal{B}v)(s) -
 (\mathcal{B}w)(s)| &\le \gamma \|v - w\|_\infty \\
 \|\mathcal{B}v - \mathcal{B}w\|_\infty &\le
 \gamma \|v - w\|_\infty.
 \end{aligned}
$$

**[/]**

Cuối cùng, từ định lý điểm bất động Banach và những điều trên, ta kết luận: mỗi khi $\gamma < 1$, operator $\mathcal{B}$ có một fixed point duy nhất. Vậy nên mọi decision process có discount factor đều giải được và có một optimal value function $v^\star$ duy nhất.

---

[^1]: Nói chính xác hơn, bên tôi làm với các bài toán điều độ thuỷ-nhiệt điện. Phải quyết định giữa nhiều nguồn năng lượng (thuỷ điện, nhiệt điện, tái tạo) để đáp ứng một nhu cầu công suất nhất định. Và phải tính tới các bất định của tương lai. Ví dụ: thuỷ điện rẻ và sạch, nhưng dùng hết nước thì rủi ro cạn nếu tháng sau khô hạn bất thường. Và một lần nữa, tìm phương án điều độ năng lượng tốt nhất lại giải bằng dynamic programming.

[^2]: Ngay cả Richard Bellman cũng thừa nhận ông đặt tên nó dựa trên độ ngầu của cái tên.

[^3]: *Dynamic Programming*, Princeton Landmarks in Mathematics and Physics (Princeton, NJ: Princeton University Press, 1957), ch 3, p. 83.

[^4]: Nó ngoài phạm vi bài vì nó lạc đề nhiều hơn là vì chứng minh khó. Bạn thích giải tích thì tôi rất khuyên bạn thử tự chứng minh. Ý chính là dùng tính chất contraction để chỉ ra khoảng cách giữa các vòng lặp của $f$ buộc phải hội tụ về không.

[^5]: Ở phần lớn ngôn ngữ lập trình chúng còn được gọi luôn là *function*.

[^6]: Có thể bạn thắc mắc: vậy dynamic programming có chạy được cho các decision process mà cost thoả những loại phương trình Bellman khác không (cost không cộng tính, chẳng hạn)? Câu trả lời là có! Một chỗ tốt để bắt đầu là sách của Dimitri P. Bertsekas, *Abstract Dynamic Programming* (Belmont, Mass: Athena Scientific, 2013). Chỉ là phải cảnh báo trước: mấy trường hợp đó có rất nhiều tiểu tiết kỹ thuật phải xử lý.

[^7]: Trái với value iteration, nó cũng không phụ thuộc vào chuyện cost phải là số thực: semiring nào cũng được. Nhưng tôi lạc đề mất rồi… Cái này ngoài phạm vi bài viết.

[^8]: Định nghĩa kỹ thuật là $M$ phải là một Monad. Nhưng bàn mấy chi tiết đó thì ngoài phạm vi ở đây. Xem [bài viết khác về automata với context](https://iagoleal.com/posts/automata-monads) để có phần bàn về cấu trúc này trong một bối cảnh tương tự.

[^9]: Phỏng theo (khá lỏng) sơ đồ trong Richard S. Sutton và Andrew G. Barto, *Reinforcement Learning: An Introduction*, Second edition, Adaptive Computation and Machine Learning Series (Cambridge, Massachusetts: The MIT Press, 2018).

[^10]: "Playing Atari with Deep Reinforcement Learning," tháng 12 năm 2013, https://doi.org/10.48550/ARXIV.1312.5602.

[^11]: Tuy trung bình là lựa chọn phổ biến nhất, nó còn lâu mới là lựa chọn duy nhất. Nhiều tình huống ngoài đời đòi hỏi né rủi ro, và dynamic programming với các coherent risk measure cũng chạy tốt y như vậy.

[^12]: Thật ra, fixed point và đệ quy nói chung mới xứng chỗ đó. Chúng ở khắp nơi!
