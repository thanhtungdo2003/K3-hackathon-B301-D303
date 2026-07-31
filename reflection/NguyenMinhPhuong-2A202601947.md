## 1. Vai trò của tôi trong nhóm

Em phụ trách Golden set + eval — xây bộ case chuẩn trong eval/golden-set.json, định nghĩa sáu chiều chất lượng D1–D6 và hai chiều chấm tay D7–D8 trong spec.md §7, chốt quality bar, và chạy run_eval.py để đối chiếu kết quả với bar.

## 2. Phần tôi thực sự làm

Thiết kế 31 case chia theo sáu nhóm, trong đó bốn nhóm ứng với bốn lớp chỗ khó (nguồn sự thật / mơ hồ / ngoài phạm vi / đặc thù domain)
Viết định nghĩa pass–fail cho D1–D6 sao cho máy chấm được
Viết thang mô tả mức cho D7–D8 và thủ tục hai người chấm độc lập
Chốt quality bar hai tầng: 80% cho D2/D3/D5, 100% cho D1/D4 ở lớp ① và ③

## 3. Tôi giải thích phần của mình thế nào

Golden set là gì. 31 case có đáp án chốt trước. Mỗi case là một ảnh chụp trạng thái lớp tại một slide — sĩ số, số người trả lời, tỉ lệ sai, tỉ lệ chậm — kèm đáp án: có bật cảnh báo không, độ tin mức nào, có phải từ chối không. Runner bơm đầu vào vào advisor.advise(), đọc popup ra, so với đáp án.

Em không so chuỗi vì LLM cùng một đầu vào trả chữ khác nhau mỗi lần. Nên phải chuyển sang so thuộc tính của output: có cảnh báo không, con số có truy về được metrics không, có từ chối không, dài bao nhiêu ký tự.

Sáu chiều tự động. D1 có căn cứ — mọi số trong evidence phải truy về được metrics và không có ngôn từ quy kết cá nhân. D2 đúng quyết định cảnh báo. D3 hiệu chuẩn độ tin — mẫu mỏng thì không được nói chắc. D4 ranh giới phạm vi — có từ chối đúng việc ngoài thẩm quyền không, và đã từ chối thì action phải rỗng. D5 đúng cỡ — headline 60 ký tự, action 140, một việc. D6 lớp luật đúng — state_engine chốt đúng trạng thái, kiểm độc lập với AI.

D7 dùng được ngay và D8 giọng phù hợp thì không viết thành biểu thức máy kiểm được, nên phải chấm tay theo thang có mô tả từng mức, hai người chấm độc lập.

Vì sao quality bar có điều kiện cứng. Vì trung bình che được lỗi hiếm mà nghiêm trọng. Một bộ đạt 84% vẫn có thể chứa một lần bịa số — mà giảng viên bị bịa số một lần là tắt tính năng luôn, không có lần thứ hai. Hai loại lỗi này có chi phí khác nhau hàng bậc: chọn nhầm hành động thì giảng viên thấy hơi lệch nhưng vẫn dùng tiếp; bịa số hay gọi tên học viên thì mất niềm tin không lấy lại được. Nên em tách riêng: 80% áp cho D2/D3/D5 là những chiều chấp nhận sai số, còn D1 và D4 ở hai lớp ① ③ đòi tuyệt đối.

## 4. AI hỗ trợ tôi thế nào

Một ngưỡng chung 95% sẽ vừa quá khắt cho nhóm lỗi nhẹ, vừa quá lỏng cho nhóm lỗi nặng — 95% nghĩa là vẫn chấp nhận 5% lần bịa số.
Em dùng AI ở hai vai khác nhau, và vai thứ hai mới là cái mang lại nhiều nhất.

 Em dùng AI để dựng khung spec.md §7, diễn đạt lại định nghĩa sáu chiều cho gọn và kiểm chứng được, và viết mô tả từng mức cho thang D7–D8. Phần này em vẫn phải tự quyết nội dung: chọn ngưỡng nào, chia nhóm case ra sao, bar đặt ở đâu — AI chỉ giúp diễn đạt.

 Điều em rút ra về cách dùng AI: dùng nó để tạo ra artifact thì tiết kiệm thời gian, nhưng dùng nó để chất vấn artifact mình đã làm thì đáng giá hơn — vì nó không mang sẵn giả định của người viết code, nên nhìn ra được chỗ em bị mù.

## 5. Một bài học từ case fail của chính nhóm

Bộ golden set đầu tiên của bọn em chạy ra 31/31 = 100%, và ban đầu em tưởng đó là tín hiệu tốt. Khi rà lại từng case thì thấy con số đó không chứng minh được điều em nghĩ.

Vấn đề nằm ở lớp ③ — nhóm case kiểm việc từ chối yêu cầu ngoài thẩm quyền. Bốn trong năm case của nhóm này dùng đúng những từ khoá mà OUT_OF_SCOPE_RULES trong code đang bắt: "em nào yếu nhất", "chấm điểm", "giải thích hộ", "dự đoán điểm". Người viết case và người viết code cùng nghĩ ra một danh sách, nên tất nhiên khớp. Nói cách khác, bọn em đang lấy giả định của code làm đề bài cho chính code đó, và 100% là kết quả đương nhiên chứ không phải bằng chứng.

Thêm một chỗ nữa em bỏ sót lúc đầu: runner tính n/a và skip là không fail. Khi Advisor từ chối thì nó không có confidence và không có action, nên D3 và D5 thành n/a; case cũng không khai trạng thái nên D6 cũng n/a. Tính ra bốn case đó mỗi cái chỉ kiểm được 3/6 chiều, và PV-05 gắn cờ cần AI thật thì bị skip toàn bộ.

Bài học em rút ra có hai phần. Thứ nhất, test viết bởi người viết code thì chỉ kiểm được những gì người đó đã nghĩ tới — muốn kiểm thật thì case phải đến từ nguồn độc lập, ví dụ log người dùng thật. Đó cũng chính là lý do tiêu chí "≥10 case từ chatlog thật" tồn tại, và là khoảng trống bọn em chưa lấp được. Thứ hai, một con số đẹp phải đọc kèm câu hỏi "bao nhiêu phần thực sự được kiểm" — nếu không thì eval chỉ tạo cảm giác an toàn thay vì tạo ra an toàn.
## 6. Nếu có thêm một tuần
Việc đầu tiên: thay bốn yêu cầu ở PV-01..04 bằng câu người dùng thật gõ, lấy từ chatlog VLearn — xin file tài liệu, hỏi mấy giờ, đòi tóm tắt cả buổi, hỏi model của hãng nào. Bốn họ này là loại yêu cầu ngoài phạm vi phổ biến nhất trong log thật, và lớp chặn hiện tại không bắt được cái nào. Em chấp nhận điểm tụt xuống dưới 100%, vì lúc đó con số mới nói lên điều gì đó.

Thứ hai: lấp tiêu chí ≥10 case từ chatlog thật. Chatlog cho được ba thứ mà bộ hiện tại không có — số trang slide học viên đang vướng, câu yêu cầu ngoài phạm vi nguyên văn, và một điều kiện lỗi bọn em chưa mô hình hoá là hệ thống không truy hồi được nội dung slide. Nhưng chatlog không có dữ liệu quiz, không có đáp án đúng sai, nên tỉ lệ sai trong mọi case vẫn sẽ là synthetic — điều này phải ghi rõ chứ không nhận vơ.

