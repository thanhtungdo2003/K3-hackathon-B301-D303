# Reflection — <<Tên bạn>> (<<Mã HV>>)

> Mỗi thành viên copy file này thành `<ten-cua-ban>.md` rồi tự viết. **Chấm riêng.**
> Vibe-coding rule: bị hỏi ở CP5/CP6 mà không giải thích được phần có tên mình → 0 điểm phần cá nhân.
> Viết ngắn, cụ thể, có ví dụ. Đừng viết chung chung.

## 1. Vai trò của tôi trong nhóm

<<Một câu: bạn phụ trách phần nào — khớp với bảng phân công trong README.md>>

## 2. Phần tôi thực sự làm

<<Liệt kê cụ thể: file nào, quyết định nào, thay đổi nào là của bạn.
Ví dụ tốt: "Tôi viết cổng dữ liệu trong state_engine.py — quyết định ngưỡng 5 câu trả lời và 30% lớp, vì dưới mức đó tỉ lệ sai dao động quá mạnh giữa các lần mô phỏng."
Ví dụ tệ: "Tôi làm backend.">>

## 3. Tôi giải thích phần của mình thế nào

<<Trả lời trước ba câu sẽ bị hỏi:
 - Chỗ này hoạt động thế nào?
 - Vì sao chọn cách này mà không chọn cách kia?
 - Nếu nó sai thì sai ra sao, và ai chịu hậu quả?>>

## 4. AI hỗ trợ tôi thế nào

<<Bạn dùng AI để làm gì. Chỗ nào AI làm tốt, chỗ nào bạn phải sửa lại vì AI làm sai hoặc làm thừa.
Nêu ít nhất một chỗ bạn KHÔNG dùng gợi ý của AI và nói lý do.>>

## 5. Một bài học từ case fail của chính nhóm

<<Chọn một failure có thật, không phải giả định. Ví dụ có sẵn trong spec.md §9 Changelog:
 - `MH-01/02/04` — regex chặn "nêu tên học viên" gộp chung với re.IGNORECASE nên "học viên online" bị coi là tên riêng
 - `NST-03` — sai 60% mà thiếu dữ liệu thời gian thì rơi về "stable", hệ thống im lặng đúng lúc đáng báo
 - `PV-03` — "giải thích hộ tôi" lọt qua lớp chặn ngoài phạm vi
Viết: chuyện gì xảy ra → vì sao xảy ra → bạn sửa thế nào → lần sau bạn làm khác đi ở đâu.>>

## 6. Nếu có thêm một tuần

<<2–3 việc, ưu tiên rõ, trỏ về feedback hoặc failure chưa xử.>>
