# Reflection — Hoàng Hải Dương (2A202601337)

> Mỗi thành viên copy file này thành `<ten-cua-ban>.md` rồi tự viết. Chấm riêng.
> Vibe-coding rule: bị hỏi ở CP5/CP6 mà không giải thích được phần có tên mình → 0 điểm phần cá nhân.
> Viết ngắn, cụ thể, có ví dụ. Đừng viết chung chung.

## 1. Vai trò của tôi trong nhóm

Tôi phụ trách phần ingest slide và luồng upload tài liệu cho hệ thống: hỗ trợ upload `.pptx` và `.pdf`, chuyển file thành cấu trúc slide để frontend vẽ được và làm dữ liệu nền cho Advisor.

## 2. Phần tôi thực sự làm

Tôi là người làm chính cho phần upload slide trong các commit `Add PDF upload support`, `fix pdf file upload` và `upload_PDF`. Cụ thể, tôi chỉnh các file `codebase/backend/app/modules/slide_import.py`, `codebase/backend/app/routers/courses.py`, `codebase/frontend/app/dashboard/courses/[id]/page.tsx` và `codebase/frontend/lib/api.ts`.

Phần việc của tôi gồm ba hạng mục chính. Đầu tiên là xây logic đọc file thật từ `.pptx` và `.pdf`, không chỉ lưu file lên server. Thứ hai là trích text và tạo cấu trúc slide có `title`, `blocks`, `notes` để cả frontend lẫn Advisor đều có thể dùng. Thứ ba là xử lý PDF bằng PyMuPDF để render ảnh từng trang và vẫn giữ text cho tìm kiếm, vì chỉ dùng text thôi không đủ để hiển thị giống bản gốc.

Một quyết định quan trọng của tôi là không để frontend tự parse file. Tôi chọn làm ở backend vì parsing và render ảnh là việc nặng, dễ lỗi và cần dùng chung cho nhiều màn hình. Nếu backend đã chuẩn hóa dữ liệu đúng, frontend chỉ cần render và không phải tự suy đoán cấu trúc slide.

## 3. Tôi giải thích phần của mình thế nào

Phần upload hoạt động theo luồng: người dùng chọn file → backend lưu file tạm vào thư mục upload → gọi parser tương ứng (`parse_pptx` hoặc `parse_pdf`) → tạo danh sách slide và trả về cho frontend → frontend hiển thị slide trên canvas. Với PDF, tôi còn tạo `page_image` để giữ hình ảnh trang gốc, còn text thì dùng cho Advisor và câu hỏi gợi ý.

Tôi chọn cách này vì nó vừa đảm bảo dữ liệu đồng nhất, vừa giúp UI hiển thị đúng hơn. Nếu chỉ dùng text, lúc trình chiếu hoặc preview sẽ thiếu layout và người dùng sẽ thấy slide “thô” và không giống tài liệu thật. Nếu làm ở frontend, mỗi tab sẽ phải parse riêng, gây chênh lệch và khó debug.

Nếu phần này sai, hậu quả đầu tiên là slide không hiển thị đúng, hoặc hệ thống tưởng upload thành công nhưng frontend lại nhận dữ liệu không đủ để vẽ. Người chịu ảnh hưởng trực tiếp là giảng viên khi tạo khoá học và cả lớp khi vào buổi học vì slide không thể hiện đúng nội dung.

## 4. AI hỗ trợ tôi thế nào

Tôi dùng AI để phác thảo nhanh cấu trúc response của API upload, đề xuất các trường dữ liệu cho slide và viết các câu thông báo lỗi ban đầu. AI giúp tôi tiết kiệm thời gian khi phải nghĩ qua nhiều trường hợp như file hỏng, PDF có mật khẩu, PDF không có text, hoặc file quá lớn.

Tuy nhiên, tôi không dùng AI để quyết định logic parse PDF và cách render slide. Lý do là AI thường đưa ra giải pháp quá chung và dễ hiểu sai về thư viện xử lý PDF. Những chỗ cần đúng về format dữ liệu và khả năng tương thích với frontend thì tôi tự kiểm tra lại bằng thực tế, vì sai ở đây ảnh hưởng trực tiếp tới trải nghiệm người dùng.

## 5. Một bài học từ case fail của chính nhóm

Một case fail thực tế của tôi là lúc đầu PDF upload có vẻ thành công nhưng frontend vẫn hiển thị trống hoặc thiếu nội dung. Nguyên nhân là ban đầu tôi nghĩ chỉ cần trích text là đủ, nhưng với PDF thật thì nhiều file không có text sạch hoặc layout cần ảnh gốc để render đúng.

Sau khi kiểm tra, tôi nhận ra lỗi nằm ở chỗ backend chưa chuẩn hóa đủ dữ liệu cho frontend: không phải chỉ có text, mà còn cần ảnh trang và cấu trúc slide rõ ràng. Tôi sửa bằng cách dùng PyMuPDF để extract cả text lẫn ảnh trang, tạo `page_image` và trả về schema chuẩn cho frontend. Lần sau, khi làm với tài liệu dạng PDF, tôi sẽ luôn phân biệt rõ “nội dung để hiểu” và “nội dung để hiển thị”, thay vì dùng một nguồn dữ liệu cho cả hai.

## 6. Nếu có thêm một tuần

Tôi sẽ ưu tiên làm ba việc. Thứ nhất là thêm preview trước khi import, để người dùng thấy slide nào bị lỗi hoặc không trích được text. Thứ hai là cải thiện xử lý PDF scan/ảnh-only, vì đây là trường hợp thường gặp và hiện vẫn dễ bỏ sót. Thứ ba là bổ sung thông báo lỗi chi tiết hơn cho từng loại file, để người dùng biết ngay vì sao upload thất bại và cần làm gì tiếp theo.
