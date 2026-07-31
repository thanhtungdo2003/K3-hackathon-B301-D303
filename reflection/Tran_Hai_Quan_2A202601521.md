# Reflection — Trần Hải Quân (2A202601521)

> Mỗi thành viên copy file này thành `<ten-cua-ban>.md` rồi tự viết. **Chấm riêng.**
> Vibe-coding rule: bị hỏi ở CP5/CP6 mà không giải thích được phần có tên mình → 0 điểm phần cá nhân.
> Viết ngắn, cụ thể, có ví dụ. Đừng viết chung chung.

## 1. Vai trò của tôi trong nhóm

Tôi phụ trách phần **Evidence (mining + khảo sát)** — thu thập bằng chứng rằng pain "giảng viên phát hiện lớp mất mạch quá muộn" là có thật, theo hai đường: khảo sát giảng viên/TA và mining chatlog VLearn.

## 2. Phần tôi thực sự làm

- Thiết kế bộ 3 câu hỏi khảo sát hồi tưởng trong `validation/survey-log.md` — hỏi về **lần gần nhất** thay vì hỏi ý kiến chung, để tránh bias xác nhận. Ba câu: (1) có lúc nào nhận ra lớp không theo kịp không, nhận ra khi nào; (2) dựa vào dấu hiệu gì; (3) nếu biết sớm hơn 10 phút thì làm khác điều gì.
- Định nghĩa tiêu chí "xác nhận pain": người trả lời phải mô tả được **một lần cụ thể** nhận ra lớp không theo kịp **sau khi** đã giảng xong phần đó. Trả lời chung chung kiểu "cũng có khi" không tính.
- Tạo form khảo sát trên Google Forms (link trong `spec.md` §1).
- Viết mẫu log cho cả khảo sát (`validation/survey-log.md`) và mining (`validation/survey-log.md` phần Log mining — evidence chuẩn B), gồm cấu trúc bảng ghi câu trả lời nguyên văn, bảng ví dụ mining, và ô kết quả.
- Chuẩn bị phương pháp đếm cho mining chuẩn B: đếm số hội thoại có mẫu "hỏi lại khái niệm đã giảng ở buổi trước" trên chatlog VLearn.

**Điều chưa xong:** Tại thời điểm nộp, cả hai đường evidence đều **chưa có dữ liệu thật**. Đường B không chạy được vì nhóm không được cấp `data/vlearn-pack/`. Đường A (khảo sát ≥20 người) cần làm với người thật, chưa hoàn tất. Spec §1 ghi rõ trạng thái này, không điền số bịa.

## 3. Tôi giải thích phần của mình thế nào

**Chỗ này hoạt động thế nào?**
Khảo sát chuẩn A dùng 3 câu hỏi hồi tưởng — hỏi về buổi dạy gần nhất thay vì hỏi "bạn có cần tính năng X không". Kết quả đếm theo tiêu chí: phải mô tả được một lần cụ thể phát hiện muộn, không tính câu trả lời chung chung. Cần ≥20 người ngoài nhóm, ≥50% xác nhận, và log đầy đủ nguyên văn. Mining chuẩn B đếm trên chatlog VLearn số hội thoại có mẫu "hỏi lại khái niệm đã giảng ở buổi trước", kèm phương pháp đếm kiểm lại được và ≥5 ví dụ nguyên văn.

**Vì sao chọn cách này mà không chọn cách kia?**
Hỏi hồi tưởng thay vì hỏi ý kiến vì rubric yêu cầu evidence cho **pain thật**, không phải ý kiến về giải pháp. Nếu hỏi "Bạn có muốn một popup cảnh báo không?" thì ai cũng gật — nhưng điều đó không chứng minh pain tồn tại. Hỏi "lần gần nhất bạn nhận ra lớp mất mạch là khi nào" buộc người trả lời nhớ lại sự kiện thật.

**Nếu nó sai thì sai ra sao, và ai chịu hậu quả?**
Nếu evidence yếu hoặc bias, toàn bộ spec dựng trên nền không vững — nhóm có thể đang giải một vấn đề không tồn tại. Hậu quả: giám khảo hỏi "sao biết giảng viên thật có pain này?" mà không ai trả lời được. Cụ thể hơn: nếu câu hỏi khảo sát dẫn dắt , kết quả cao giả tạo, nhóm tưởng pain rõ ràng nhưng thật ra chỉ là bias xác nhận.

## 4. AI hỗ trợ tôi thế nào

- Dùng AI để **soạn nháp cấu trúc** bảng log trong `survey-log.md` — gồm cột nào, tiêu chí tính xác nhận, cách ghi kết quả. AI gợi ý thêm cột "Tính là xác nhận?" để đánh dấu ngay khi ghi log, tôi giữ lại vì nó giúp đếm nhanh hơn.
- AI gợi ý thêm câu hỏi thứ 4 ("Bạn có muốn một tính năng cảnh báo không?") — tôi **không dùng** vì đây là câu hỏi dẫn dắt, vi phạm nguyên tắc hỏi hồi tưởng thay vì hỏi ý kiến về giải pháp. Rubric cũng nói rõ: không hỏi "bạn có cần tính năng X không".
- AI giúp diễn đạt lại tiêu chí đếm cho mining chuẩn B cho rõ ràng hơn, nhưng logic phân loại (khi nào tính, khi nào không) là do tôi quyết định dựa trên đọc mẫu chatlog.

## 5. Một bài học từ case fail của chính nhóm

**Chuyện gì xảy ra:** Phần evidence là khoảng trống lớn nhất của bài nộp. Đường B (mining) không chạy được vì không có data pack. Đường A (khảo sát) chưa hoàn tất đủ 20 người trước deadline. Spec §1 phải ghi "Chưa có" thay vì có số liệu thật.

**Vì sao xảy ra:** Nhóm ưu tiên build code trước, để evidence sang sau vì nghĩ "có thể làm song song". Nhưng khảo sát người thật cần thời gian chờ phản hồi, không thể tăng tốc như code. Đường mining phụ thuộc data pack bên ngoài mà nhóm không kiểm soát được thời điểm nhận.

**Sửa thế nào:** Ghi trung thực trạng thái vào spec — không điền số bịa. Đẩy nhanh khảo sát bằng Google Forms (đã tạo link) thay vì phỏng vấn trực tiếp từng người.

**Lần sau làm khác:** Chạy khảo sát **ngay ngày đầu tiên**, trước cả khi bắt đầu code. Evidence cần thời gian đợi phản hồi, không nén được — phải bắt đầu sớm nhất có thể. Và chuẩn bị kế hoạch dự phòng cho mining nếu data pack không đến đúng lúc.

## 6. Nếu có thêm một tuần

1. **Hoàn tất khảo sát ≥20 người** — ưu tiên cao nhất vì đây là khoảng trống rõ ràng nhất trong spec, ảnh hưởng trực tiếp đến điểm evidence. Gửi form rộng hơn và follow up từng người.
2. **Chạy mining chuẩn B nếu có data pack** — đếm trên chatlog thật, điền kết quả vào `validation/survey-log.md` phần mining, gồm phương pháp đếm + ≥5 ví dụ nguyên văn.
3. **Tham gia vòng validation CP5** — log phản hồi người thử vào `validation/feedback-log.md`, đặc biệt xem giảng viên có tin kết quả popup không và vì sao.
