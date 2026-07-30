# codebase/ — hệ thống AGORA

Không còn dữ liệu mô phỏng: mọi số liệu trên dashboard đều sinh ra từ buổi dạy thật.

## Chạy

```bash
# backend
cd backend
python -m venv .venv && .venv/Scripts/pip install -r requirements.txt
cp .env.example .env          # điền GROQ_API_KEY nếu muốn bật phần AI
.venv/Scripts/python -m uvicorn app.main:app --port 8000

# frontend
cd frontend
npm install
npm run dev                   # http://localhost:3000
```

Bảng dữ liệu tự tạo khi backend khởi động. Không có bước seed — hệ thống bắt đầu từ
trạng thái rỗng, người dùng tự đăng ký và tải slide lên.

Không có khoá Groq thì hệ thống vẫn chạy: phần gợi ý rơi về mẫu theo luật và đánh dấu
`guard_flags: ["ai_unavailable"]`.

## Bản đồ thư mục

```
backend/                    FastAPI + Socket.IO + SQLAlchemy (SQLite)
  app/
    main.py                 khởi tạo app, mount Socket.IO
    config.py  db.py  models.py  schemas.py  realtime.py  security.py
    routers/
      auth.py               đăng ký / đăng nhập giảng viên (JWT)
      courses.py            khoá học, upload PPTX, checkpoint, câu hỏi, soạn nháp bằng LLM
      rooms.py              phòng học (mã 5 ký tự), bắt đầu / kết thúc buổi
      teaching.py           Bục Giảng: chuyển slide, mở câu hỏi, dashboard, Advisor
      insights.py           tổng quan chủ phòng + chất lượng theo từng slide
      student.py            học viên vào bằng mã, trả lời, tín hiệu, xin gợi ý
    modules/
      slide_import.py       đọc file .pptx thật thành block để vẽ lên canvas
      assessment.py         [RULE] chấm câu trả lời
      analytics.py          [RULE] tổng hợp + ẩn danh thành metrics toàn lớp
      state_engine.py       [RULE] chốt nhãn trạng thái lớp + cổng dữ liệu
      advisor.py            [RULE] chặn ngoài phạm vi, hậu kiểm, mẫu dự phòng
      student_coach.py      [RULE] hậu kiểm gợi ý câu hỏi cho học viên
      llm.py                [AI]   gọi Groq, ép JSON, ghi trace
  uploads/                  file PPTX đã tải lên (tạo khi chạy, không commit)
  traces/                   trace từng lượt gọi AI (tạo khi chạy, không commit)

frontend/                   Next.js App Router + Tailwind + Ant Design
  app/page.tsx              trang giới thiệu, nội dung chia thành slidebox
  app/register  app/login   tài khoản giảng viên
  app/dashboard/            khu quản trị bằng Ant Design
    page.tsx                tổng quan
    courses/                khoá học, upload PPTX, checkpoint, câu hỏi, chất lượng
    rooms/                  phòng học, mã lớp, bắt đầu buổi
  app/teach/[sessionId]/    Bục Giảng
  app/join  app/learn/[sessionId]/   phía học viên
  components/SlideCanvas.tsx  vẽ slide lên HTML canvas (title, bullets, code, bảng, note)
  components/AdviceAlert.tsx  popup cảnh báo cho giảng viên
  components/Blocks.tsx     nút / ô nhập / thẻ dạng khối (phía học viên)
  components/icons.tsx      toàn bộ icon lấy từ lucide-react (SVG), không dùng emoji
```

## Ranh giới RULE / AI

```
Câu trả lời của học viên
   -> Assessment Engine        [RULE]  chấm đúng/sai
   -> Learning Analytics       [RULE]  tổng hợp + ẩn danh
   -> Classroom State Engine   [RULE]  chốt nhãn trạng thái
   -> cổng dữ liệu             [RULE]  thiếu mẫu thì DỪNG, không gọi AI
   -> chặn ngoài phạm vi       [RULE]  từ chối yêu cầu rõ ràng ngoài thẩm quyền
   -> Teaching Advisor         [AI]    viết cảnh báo + chọn MỘT hành động
   -> hậu kiểm                 [RULE]  không qua thì rơi về mẫu cố định
   -> popup cho giảng viên
```

Ba chỗ gọi AI, đều ở `backend/app/modules/llm.py`, đều dùng Groq
(`llama-3.3-70b-versatile`, `response_format=json_object`, trace ghi ra `backend/traces/`):

| Hàm | Dùng ở đâu | Nếu không gọi được |
|---|---|---|
| `suggest_student_questions` | học viên bấm gợi ý câu để hỏi | mẫu câu theo luật |
| `draft_checkpoint_questions` | giảng viên bấm "Soạn nháp bằng AI" | trả `source: "unavailable"` |
| `advise_teacher` | Bục Giảng xin gợi ý | gợi ý theo luật |

AI không bao giờ nhận danh tính học viên hay câu trả lời thô — chỉ nhận metrics đã gộp
và nhãn trạng thái do luật quyết định.

## Ghi chú thiết kế giao diện

- Nền **phẳng một màu**, không gradient ở bất kỳ đâu — kể cả trên canvas slide.
- Có **nút đổi sáng/tối**; theme lưu ở `localStorage` và gắn vào `<html>` trước khi React
  hydrate để không nháy màu. Ant Design dùng chung state này qua `app/providers.tsx`.
- Phía học viên dùng nút/ô nhập dạng khối. Phía giảng viên (dashboard, Bục Giảng) dùng
  Ant Design với tông nghiêm túc hơn.
- Popup cảnh báo ở Bục Giảng tự ẩn sau 5 giây, bấm ra ngoài hoặc Esc cũng ẩn, đưa chuột
  vào thì dừng đếm.
- Toàn bộ icon lấy từ **lucide-react** (phía học viên) và **@ant-design/icons** (phía
  giảng viên). Không dùng emoji hay ký tự đặc biệt làm icon.
- Nút chỉ có icon đều kèm `aria-label`.
