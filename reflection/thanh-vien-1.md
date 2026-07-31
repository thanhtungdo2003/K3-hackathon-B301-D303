# Reflection - Do Thanh Tung (thanhtungdo2003)

> Mỗi thành viên copy file này thành `<ten-cua-ban>.md` rồi tự viết. Chấm riêng.
> Vibe-coding rule: bị hỏi ở CP5/CP6 mà không giải thích được phần có tên mình -> 0 điểm phần cá nhân.
> Viết ngắn, cụ thể, có ví dụ. Đừng viết chung chung.

## 1. Vai trò của tôi trong nhóm

Tôi phụ trách phần trải nghiệm frontend chính của VinLearn và một phần backend liên quan trực tiếp tới luồng dạy live: dashboard giảng viên, màn học viên, Bục Giảng, Trợ giảng AI, đồng bộ slide realtime, chế độ trình chiếu và upload slide PDF/PPTX.

## 2. Phần tôi thực sự làm

Từ lịch sử commit của `thanhtungdo2003`, phần việc của tôi tập trung ở các PR `feat/update-ui`, `feature/auto-sync-student-slide` và `upload_PDF`.

Cụ thể, tôi làm lại nhiều màn hình frontend trong `codebase/frontend/app/dashboard/*`, `codebase/frontend/app/teach/[sessionId]/page.tsx`, `codebase/frontend/app/learn/[sessionId]/page.tsx` và `codebase/frontend/app/join/page.tsx` để giảng viên tạo lớp, vào Bục Giảng, học viên nhập mã lớp và theo dõi slide ổn định hơn. Tôi cũng chỉnh `globals.css`, các component block/slide và `SlideCanvas.tsx` để slide hiển thị nhất quán trên canvas thay vì chỉ là dữ liệu thô.

Tôi xây phần Trợ giảng/AI trên giao diện và API liên quan: `components/ai/ChatPanel.tsx`, `components/ai/Bento.tsx`, `backend/app/routers/assistant.py`, `assistant_chat.py`, `backend/app/modules/agent_tools.py`, `backend/app/modules/llm.py` và các schema trong `schemas.py`. Mục tiêu là Trợ giảng chỉ đọc dữ liệu tổng hợp của lớp, gợi ý hành động cho giảng viên, không tự điều khiển buổi học.

Tôi làm phần tự đồng bộ slide bằng `backend/app/modules/slide_tracking.py`, tích hợp với `realtime.py`, `student.py`, `teaching.py` và thêm test như `test_slide_tracking.py`, `test_realtime_force_sync.py`, `test_realtime_contract.py`. Quyết định chính là backend giữ timer lệch slide và chỉ gửi `force_slide_sync` tới đúng học viên khi lệch liên tục đủ lâu, thay vì để frontend tự đoán.

Tôi thêm chế độ trình chiếu riêng qua `frontend/app/present/[sessionId]/page.tsx`, `frontend/lib/usePresentation.ts`, `frontend/lib/presentation.ts`, `frontend/lib/desktop.ts` và Electron `main.js`/`preload.js`. Cửa sổ trình chiếu chỉ hiển thị slide, còn quyền đổi slide thật vẫn đi qua Bục Giảng để lớp không bị lệch trạng thái.

Tôi cũng hoàn thiện luồng upload PDF/PPTX ở `backend/app/modules/slide_import.py`, `backend/app/routers/courses.py`, `frontend/app/dashboard/courses/[id]/page.tsx` và `frontend/lib/api.ts`. Với PDF, tôi dùng PyMuPDF để vừa trích text làm ngữ cảnh cho Advisor, vừa render ảnh trang để frontend hiển thị giống file gốc hơn.

## 3. Tôi giải thích phần của mình thế nào

Phần đồng bộ slide hoạt động theo hướng backend là nguồn sự thật. Khi học viên đổi slide hoặc bật/tắt chế độ theo giảng viên, frontend gửi event lên socket. Backend lưu trạng thái theo từng socket/học viên, so với slide hiện tại của giảng viên, bắt đầu timer nếu học viên lệch và không following. Nếu lệch liên tục quá ngưỡng, backend tạo lệnh `force_slide_sync` có `sync_id` để tránh gửi lặp và ghi audit.

Tôi chọn cách đặt logic ở backend vì nếu mỗi tab frontend tự đếm thời gian thì rất dễ sai khi reload, mở nhiều tab, mất socket hoặc giảng viên đổi slide giữa chừng. Backend nhìn được trạng thái của cả session, biết slide mới nhất trong DB và gửi đúng event tới đúng participant room. Đổi lại backend phức tạp hơn và phải có test cho các case lệch slide, đổi slide, disconnect, nhiều tab.

Phần trình chiếu hoạt động bằng một cửa sổ riêng. `usePresentation` mở cửa sổ, canh vị trí theo khung preview, dùng `BroadcastChannel` để đẩy slide hiện tại sang cửa sổ present. Nếu cửa sổ present nhận thao tác next/prev, nó không tự gọi API mà gửi yêu cầu ngược về Bục Giảng; Bục Giảng mới đổi slide chính thức. Nếu BroadcastChannel lỗi hoặc trang reload, socket vẫn bám theo `slide_changed` để lấy lại trạng thái đúng.

Nếu phần này sai, hậu quả là cả lớp có thể nhìn khác slide với giảng viên hoặc màn chiếu chuyển trước khi backend ghi trạng thái. Vì vậy phần chịu trách nhiệm chính là code realtime/trình chiếu của tôi; khi debug phải kiểm tra socket event, `current_slide_index` trong DB, và event `slide_changed`/`force_slide_sync` trước khi kết luận lỗi UI.

Phần upload PDF/PPTX hoạt động bằng cách parse file thành danh sách slide có `title`, `blocks`, `notes` và với PDF có thêm `page_image`. Tôi không chỉ lưu file rồi nhúng iframe, vì Advisor cần text để hiểu ngữ cảnh slide. Với PDF, ảnh trang dùng để nhìn đúng bản gốc, còn text block dùng cho tìm kiếm/câu hỏi/Advisor. Nếu parse lỗi, người dùng có thể thấy slide thiếu nội dung hoặc AI thiếu ngữ cảnh; vì vậy upload phải fail rõ ràng với PDF có mật khẩu hoặc file không đọc được.

## 4. AI hỗ trợ tôi thế nào

Tôi dùng AI để phác thảo nhanh cấu trúc component, kiểm tra edge case cho realtime, viết test case ban đầu và rà lại wording tiếng Việt trong popup/Trợ giảng. AI hữu ích nhất ở các phần cần liệt kê nhiều tình huống, ví dụ tự đồng bộ slide phải xét học viên lệch, giảng viên đổi slide, học viên quay lại đúng slide, disconnect socket và nhiều tab.

Tôi phải sửa lại khá nhiều chỗ vì AI hay viết logic frontend quá tự tin, ví dụ để cửa sổ trình chiếu tự gọi API đổi slide. Tôi không dùng hướng đó vì nó tạo hai nguồn điều khiển: present window và Bục Giảng đều có thể đổi slide. Tôi giữ nguyên nguyên tắc Bục Giảng/backend là nguồn quyết định, cửa sổ trình chiếu chỉ gửi yêu cầu.

Một chỗ khác tôi không dùng gợi ý của AI là render PDF chỉ bằng text block. Cách đó nhanh nhưng mất layout gốc, khi chiếu lên lớp nhìn không giống tài liệu thật. Tôi chuyển sang render ảnh từng trang bằng PyMuPDF, đồng thời vẫn trích text để Advisor có ngữ cảnh.

## 5. Một bài học từ case fail của chính nhóm

Case fail tôi chọn là `NST-03`: lớp sai khoảng 60% nhưng thiếu dữ liệu thời gian trả lời nên hệ thống rơi về trạng thái `stable` và im lặng đúng lúc đáng báo.

Lỗi xảy ra vì rule ban đầu phụ thuộc quá nhiều vào tín hiệu thời gian như median response time. Khi median bằng 0 hoặc thiếu dữ liệu, nhánh đánh giá không đủ điều kiện bật `need_attention`, dù wrong rate đã cho thấy lớp đang có vấn đề. Đây là lỗi thiết kế rule: thiếu dữ liệu ở một chiều bị hiểu nhầm thành không có vấn đề.

Cách sửa là tách wrong rate thành tín hiệu độc lập hơn và hạ điều kiện `need_attention` xuống `wrong_rate >= 0.35`, không chặn trên 0.5. Như vậy nếu lớp sai nhiều, hệ thống vẫn cảnh báo dù chưa có dữ liệu thời gian đủ tốt. Phần lời khuyên vẫn phải nói theo căn cứ có thật, không được bịa rằng lớp trả lời chậm nếu median không có.

Bài học của tôi là với Advisor, im lặng sai cũng nguy hiểm như nói sai. Lần sau khi thiết kế rule, tôi sẽ phân biệt rõ ba trạng thái: dữ liệu cho thấy ổn, dữ liệu cho thấy có vấn đề, và dữ liệu thiếu. Thiếu dữ liệu không được tự động biến thành `stable`.

## 6. Nếu có thêm một tuần

Tôi sẽ ưu tiên hoàn thiện frontend nhận `force_slide_sync` và `slide_tracking_summary` đầy đủ hơn, vì README hiện ghi backend đã xong nhưng frontend chưa tích hợp hết event. Việc này giúp học viên thấy rõ vì sao màn hình bị kéo về slide giảng viên và giảng viên thấy lớp đang lệch bao nhiêu.

Tôi sẽ thêm kiểm thử end-to-end cho luồng dạy live: giảng viên đổi slide, học viên trả lời câu hỏi, Advisor bật popup, cửa sổ trình chiếu bám đúng slide và upload PDF vẫn hiển thị đúng. Hiện test backend khá rõ nhưng phần browser/Electron vẫn có rủi ro UI.

Tôi cũng muốn cải thiện upload slide bằng preview trước khi tạo course chính thức: báo trang nào không trích được text, cho đổi title slide, và cảnh báo khi PDF chỉ là ảnh scan nên Advisor không có đủ ngữ cảnh.
