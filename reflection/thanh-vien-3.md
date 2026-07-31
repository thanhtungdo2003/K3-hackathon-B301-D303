# Reflection — <<Nguyễn Thành Long>> (<<2A202601443>>)

> Mỗi thành viên copy file này thành `<ten-cua-ban>.md` rồi tự viết. **Chấm riêng.**
> Vibe-coding rule: bị hỏi ở CP5/CP6 mà không giải thích được phần có tên mình → 0 điểm phần cá nhân.
> Viết ngắn, cụ thể, có ví dụ. Đừng viết chung chung.

## 1. Vai trò của tôi trong nhóm

Tôi phụ trách backend và frontend, realtime và chấm bài, đồng thời tích hợp luồng Trợ giảng, đồng bộ slide và hỗ trợ học viên lên giao diện.
## 2. Phần tôi thực sự làm

- Tôi xây dựng cơ chế theo dõi slide trong backend/app/modules/slide_tracking.py và tích hợp vào realtime.py. Mỗi tab/socket được theo dõi riêng để một tab đúng slide không che mất tab đang lệch, nhưng mỗi học viên chỉ có một bộ đếm. Sau 300 giây lệch liên tục, hệ thống tự đưa học viên về slide của giảng viên. Tôi bổ sung sync_id chống xử lý lặp và revision để tránh gửi lệnh theo một slide đã lỗi thời.

- Tôi xây dựng API tổng hợp cho trợ giảng trong backend/app/routers/assistant.py, đồng thời phát triển giao diện frontend/app/teaching-assistant/[sessionId]/page.tsx. Dashboard hiển thị nhịp hiểu bài, khái niệm có vấn đề, chẩn đoán, hàng đợi hỗ trợ và tình trạng đồng bộ slide. Tôi chỉ trả dữ liệu tổng hợp, không đưa tên, token hay mã học viên vào response.

- Tôi triển khai phía học viên và giảng viên trong learn/[sessionId]/page.tsx và teach/[sessionId]/page.tsx: gửi trạng thái slide qua Socket.IO, cho phép chuyển giữa chế độ “bám giảng viên” và “tự đọc”, hiển thị thời gian còn lại trước khi đồng bộ, xử lý lệnh ép đồng bộ và cập nhật dashboard theo thời gian thực. Tôi cũng bổ sung polling dự phòng khi kết nối realtime bị gián đoạn.

- Tôi xây dựng luồng tự sinh tối đa hai câu hỏi khi giảng viên chuyển slide trong auto_questions.py, llm.py và teaching.py. Tôi loại các câu hỏi AI quá chung chung như “đã hiểu chưa”, kiểm tra đáp án có hợp lệ, và dùng câu đúng/sai lấy trực tiếp từ nội dung slide khi AI không tạo được câu phù hợp. Dữ liệu câu hỏi cũ được giữ lại để không làm mất lịch sử.

- Tôi xây dựng hệ thống hỗ trợ học viên trong question_support.py, student.py, teaching.py và model SupportQuestion. Câu hỏi được phân loại theo mức độ bối rối với ngưỡng 60%; câu đạt ngưỡng được chuyển tới đội ngũ giảng dạy. Khi hàng đợi người hỗ trợ đạt 5 câu, hệ thống có thể dùng AI trả lời kèm cảnh báo về độ chính xác. Tôi cũng triển khai vòng đời pending/answered và gửi câu trả lời về đúng học viên qua realtime.

- Trong commit sửa AI, tôi mở rộng ngữ cảnh trả lời từ slide hiện tại sang toàn bộ bài học nhưng vẫn ưu tiên slide đang xem. Tôi bổ sung bước kiểm tra câu hỏi sinh ra, chuẩn hóa đáp án, hiển thị đáp án đúng sau khi học viên trả lời sai và kéo dài thời gian xem phản hồi trước khi chuyển sang câu tiếp theo.

- Tôi viết session_understanding.py để tổng hợp mức hiểu của lớp thành ba trạng thái: hiểu bài, tạm hiểu và chưa hiểu. Quy tắc sử dụng câu trả lời mới nhất, độ tự tin, hành vi quay lại slide, yêu cầu gợi ý, giơ tay và đặt câu hỏi. Khi chưa có đủ tín hiệu, học viên được giữ ở trạng thái chưa phân loại thay vì suy diễn. Kết quả được hiển thị cho cả buổi hiện tại và buổi học trước, đồng thời chỉ cung cấp số liệu ẩn danh.

- Tôi bổ sung các bộ kiểm thử cho đồng bộ slide, hợp đồng realtime, API trợ giảng, tự sinh câu hỏi, phân luồng hỗ trợ và tổng hợp mức hiểu trong thư mục backend/tests.

## 3. Tôi giải thích phần của mình thế nào

<<Trả lời trước ba câu sẽ bị hỏi:
 - Chỗ này hoạt động thế nào?
 Dashboard nhận sự kiện realtime và tải lại dữ liệu khi có câu trả lời, tín hiệu hỗ trợ hoặc thay đổi slide. Các lần cập nhật được gom lại để tránh gọi API quá nhiều. Nếu Socket.IO mất kết nối, giao diện chuyển sang polling định kỳ.

 - Vì sao chọn cách này mà không chọn cách kia?
 Realtime cho phản hồi nhanh, còn polling giúp hệ thống vẫn sử dụng được khi kết nối socket không ổn định. Backend vẫn là nguồn dữ liệu chính thay vì để frontend tự tính số liệu lớp.
 - Nếu nó sai thì sai ra sao, và ai chịu hậu quả?>>

 Dashboard có thể hiển thị dữ liệu chậm hoặc tạm thời lỗi thời, khiến trợ giảng phản ứng muộn. Việc này ảnh hưởng trợ giảng và gián tiếp ảnh hưởng học viên đang chờ hỗ trợ. Giao diện phải thông báo trạng thái mất kết nối; tôi chịu trách nhiệm kiểm tra cơ chế refresh, polling và hợp đồng API/realtime.

## 4. AI hỗ trợ tôi thế nào

- Tôi dùng AI để tạo bản nháp code, gợi ý cấu trúc API/Socket.IO, sinh các trường dữ liệu TypeScript và đề xuất test cho những trường hợp như mất kết nối, nhiều tab hoặc câu trả lời AI sai định dạng. AI làm tốt các phần lặp lại và tạo khung ban đầu, nhờ đó tôi triển khai nhanh hơn.

- Tôi đã không dùng AI để thiết kế form chat của sinh viên với AI, lý do tôi không dùng AI là bởi vì tôi muốn tự thiết kế UI UX để đảm bảo theo hệ thống 

## 5. Một bài học từ case fail của chính nhóm

- Chuyện gì xảy ra: Khi giảng viên chuyển slide, hệ thống có thể phát câu như “Bạn đã nắm được ý chính đến mức nào?” dưới dạng poll. Một số câu khác có answer.value là chỉ số như "0" hoặc "1" trong khi phần chấm và giao diện sử dụng nguyên văn phương án. Vì vậy câu hỏi nhìn có vẻ hợp lệ nhưng không kiểm tra được kiến thức hoặc có thể chấm sai.

- Vì sao xảy ra: Prompt ban đầu cho phép AI tạo kiểu câu quá rộng, còn bước hậu kiểm chỉ kiểm tra có type và prompt, chưa kiểm tra câu có bám nội dung slide hay đáp án có thật sự thuộc danh sách phương án. Fallback của nhóm cũng ưu tiên “luôn có câu hỏi” hơn chất lượng của câu hỏi.

- Tôi sửa thế nào: Tôi không chỉ chỉnh prompt mà thêm lớp kiểm tra bằng code. Tôi loại các mẫu như “đã hiểu”, “mức độ hiểu” và “muốn giải thích phần nào”; kiểm tra phương án trùng, kiểm tra đáp án, chuẩn hóa chỉ số thành nguyên văn đáp án và yêu cầu nội dung sinh ra có liên hệ với slide. Tôi thay fallback poll bằng câu đúng/sai lấy trực tiếp từ nội dung slide. Các câu cũ không đạt chuẩn bị ẩn nhưng không bị xóa để giữ lịch sử, đồng thời tôi bổ sung test trong test_auto_questions_and_support.py.

- Lần sau tôi làm khác: Tôi sẽ định nghĩa hợp đồng output và tiêu chí chất lượng trước khi tích hợp LLM, sau đó viết test cho output sai định dạng, câu không bám nguồn, slide quá ít nội dung và AI không khả dụng. Tôi cũng sẽ cho phép hệ thống trả về “không tạo được câu phù hợp” thay vì xem việc luôn tạo đủ số lượng là mục tiêu. Bài học chính là output đúng JSON chưa có nghĩa là đúng nghiệp vụ; mọi kết quả AI ảnh hưởng tới việc chấm hoặc quyết định hỗ trợ đều cần lớp kiểm tra xác định.

## 6. Nếu có thêm một tuần

- Tôi sẽ tối ưu lại AI đọc slide và gen câu hỏi
- Thêm phần tổng quát lại buổi học gần đây nhất để giảng viên buổi sau có thể biết được buổi trước sinh viên đang bị mắc ở phần nào tỷ lệ bao nhiêu sinh viên hiểu bài, bao nhiêu sinh viên chưa hiểu
