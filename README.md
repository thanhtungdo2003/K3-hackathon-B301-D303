# AGORA — hỗ trợ giảng dạy theo thời gian thực

Bài nộp Mini Hackathon AI · Batch 03 · **Hướng A — VLearn** · tính năng mới.

**Lát cắt được chấm:** giảng viên đang dạy live · cần biết lớp có mất mạch ở slide hiện tại không · AI quyết định có cảnh báo và chọn một hành động dạy tiếp theo · kết quả là một popup hai dòng kèm con số căn cứ.

Chi tiết thiết kế: [`spec.md`](spec.md).

---

## Thành viên & phân công

> ⚠️ Điền mã HV + tên thật trước khi nộp. Mỗi phần phải có đúng một người chịu trách nhiệm — CP5 kiểm ngẫu nhiên.

| Mã HV | Tên | Phần phụ trách | Phải giải thích được |
|---|---|---|---|
| `<<ĐIỀN>>` | `<<ĐIỀN>>` | Spec + thiết kế lát cắt | Vì sao chọn augment; 4 lớp chỗ khó ánh xạ vào đâu trong code |
| `<<ĐIỀN>>` | `<<ĐIỀN>>` | Evidence (mining + khảo sát) | Phương pháp đếm; ai đã trả lời gì |
| `<<ĐIỀN>>` | `<<ĐIỀN>>` | Prompt + hậu kiểm Advisor | Vì sao ép JSON schema; `validate()` chặn được gì |
| `<<ĐIỀN>>` | `<<ĐIỀN>>` | Backend (rule engine, realtime, chấm bài) | Ngưỡng 5 câu / 30% từ đâu; luật xếp trạng thái |
| `<<ĐIỀN>>` | `<<ĐIỀN>>` | Frontend (canvas, UI khối, popup) | Cách slide vẽ trên canvas; vì sao popup chỉ bật một lần |
| `<<ĐIỀN>>` | `<<ĐIỀN>>` | Golden set + eval + demo | Sáu chiều chất lượng; vì sao quality bar có điều kiện cứng |

---

## Cấu trúc repo

```
.
├── README.md              ← file này
├── spec.md                ← AI Spec §1–§9
├── demo-slides.pdf        ← slide 6 trang cho vòng demo
├── codebase/
│   ├── backend/           ← FastAPI + Socket.IO + SQLite + Teaching Advisor
│   └── frontend/          ← Next.js + Tailwind + canvas slide
├── eval/                  ← golden set 31 case + runner + kết quả từng lượt
├── validation/            ← mẫu log khảo sát & user test
└── reflection/            ← mỗi người một file
```

---


## Chạy thử

Cần **Python 3.10+** và **Node 20+**.

### 1. Backend

```bash
cd codebase/backend
python -m venv .venv
.venv/Scripts/activate          # Windows;  macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env            # rồi điền GROQ_API_KEY
python -m uvicorn app.main:app --reload --port 8000
```

Bảng dữ liệu tự tạo lúc khởi động. Không có bước seed — hệ thống bắt đầu rỗng.

Kiểm tra AI đã bật chưa:

```bash
curl http://localhost:8000/health
# {"ok":true,"llm_provider":"groq","ai_enabled":true,"ai_available":true,"model":"llama-3.3-70b-versatile"}
```

`ai_available: false` nghĩa là chưa có khoá — hệ thống vẫn chạy đủ chức năng, phần AI rơi về mẫu theo luật.

### 2. Frontend

```bash
cd codebase/frontend
npm install
npm run dev
```

### 3. Đi hết một vòng

1. <http://localhost:3000> → **Tạo tài khoản giảng viên**.
2. **Khoá học** → tạo khoá → **Tải PPTX lên**. File .pptx được đọc thật thành slide vẽ trên canvas.
3. Chọn một slide dễ hiểu sai → **Đặt checkpoint tại đây** → **Thêm câu hỏi** (hoặc **Soạn nháp bằng AI** nếu đã có khoá Groq).
4. **Phòng học** → tạo phòng → đọc **mã 5 ký tự** cho lớp → **Bắt đầu buổi học**.
5. Học viên mở <http://localhost:3000/join> trên máy khác, gõ mã + tên + chọn avatar. Không cần tài khoản.
6. Ở Bục Giảng: chuyển slide (lớp tự chuyển theo) → **Mở câu hỏi** khi thấy đúng lúc → học viên trả lời kèm mức tự tin.
7. Mở **Trợ giảng** từ Bục Giảng hoặc thẻ phòng đang hoạt động để theo dõi nhịp hiểu bài, yêu cầu hỗ trợ ẩn danh và trạng thái đồng bộ slide theo thời gian thực.
8. Khi học viên tự đọc ở slide khác liên tục quá 5 phút, backend phát lệnh đưa màn hình học viên về slide mới nhất của giảng viên.
9. Bấm **Xin gợi ý**: đủ dữ liệu và lớp đang tắc thì popup cảnh báo bật lên; thiếu dữ liệu thì hệ thống nói thẳng là chưa đủ dữ liệu.
10. **Tổng quan** và tab **Chất lượng** của khoá học tổng hợp lại sau buổi.

---

## Chạy eval

```bash
# từ thư mục gốc repo
codebase/backend/.venv/Scripts/python eval/run_eval.py --label run-01

# chạy không AI (chỉ kiểm lớp luật, dùng khi mất mạng)
codebase/backend/.venv/Scripts/python eval/run_eval.py --label run-00-offline --no-ai
```

Kết quả ghi ra `eval/results/<label>.md` và `.json`, gồm **đủ mọi case kể cả case chưa đạt**.

Quality bar đã chốt (xem `spec.md` §7):
> ≥ 80% golden set qua toàn bộ auto-check, **và** 100% case lớp ① và ③ không bịa số / không nêu tên / không trả lời ngoài thẩm quyền.

---

## Lời gọi AI thật nằm ở đâu

Tất cả trong `codebase/backend/app/modules/llm.py`, dùng **Groq** (`llama-3.3-70b-versatile`,
`response_format=json_object`, không streaming):

| Hàm | Dùng ở đâu | Nếu không gọi được |
|---|---|---|
| `advise_teacher` | Bục Giảng bấm **Xin gợi ý** | gợi ý theo luật |
| `suggest_student_questions` | học viên bấm gợi ý câu để hỏi | mẫu câu theo luật |
| `draft_checkpoint_questions` | giảng viên bấm **Soạn nháp bằng AI** | trả `source: "unavailable"` |

| | |
|---|---|
| Đầu vào của Advisor | Chỉ **metrics đã tổng hợp toàn lớp** + nhãn trạng thái do rule engine chốt. Không tên, không id, không câu trả lời nguyên văn. |
| Quyết định AI chịu trách nhiệm | Có cảnh báo hay không · viết tiêu đề · chọn **một** hành động dạy · chọn con số làm căn cứ · từ chối nếu ngoài phạm vi |
| Hậu kiểm | `modules/advisor.py::validate()` — chặn bịa số, ngôn từ quy kết, cảnh báo lệch trạng thái, tự tin quá mức |
| Trace | `codebase/backend/traces/*.jsonl` (mỗi lượt gọi một dòng, có cả lượt lỗi) |

**Phần nào là rule, phần nào là AI** — cố ý tách rõ:

```
Câu trả lời của học viên
   → Assessment Engine        [RULE]  chấm đúng/sai
   → Learning Analytics       [RULE]  tổng hợp + ẩn danh
   → Classroom State Engine   [RULE]  chốt nhãn trạng thái lớp
   → cổng dữ liệu             [RULE]  thiếu mẫu thì DỪNG, không gọi AI
   → chặn ngoài phạm vi       [RULE]  từ chối yêu cầu rõ ràng ngoài thẩm quyền
   → Teaching Advisor         [AI]    viết cảnh báo + chọn hành động
   → hậu kiểm                 [RULE]  không qua thì rơi về mẫu cố định
   → popup cho giảng viên
```

---

## Phạm vi đã build

| Thành phần | Trạng thái |
|---|---|
| Tài khoản giảng viên, khoá học, phòng học, buổi học | Thật |
| Upload .pptx và đọc thành slide vẽ trên canvas | Thật |
| Checkpoint + 6 kiểu câu hỏi, chấm bằng luật | Thật |
| Đồng bộ slide realtime, mở/đóng câu hỏi, tín hiệu học viên | Thật |
| Tracking lệch slide + lệnh tự đồng bộ sau 5 phút | **Backend đã hoàn tất; frontend chưa tích hợp event** |
| API dữ liệu cho dashboard Trợ giảng | **Backend đã hoàn tất; giao diện frontend chưa làm** |
| Analytics + State Engine + Advisor + hậu kiểm | Thật |
| Dashboard chủ phòng và chất lượng theo từng slide | Thật |
| Dữ liệu mô phỏng | **Đã bỏ hoàn toàn** — mọi số liệu đến từ buổi dạy thật |
| MinIO, Redis, Celery, vLLM, PaddleOCR, đọc PDF | **Không build** |

---

## Ràng buộc an toàn đã tuân thủ

- Không commit `.env` hay API key — cả hai thư mục đều có `.gitignore` chặn.
- Không dùng dữ liệu thật của người thật. Slide và câu hỏi dùng khi kiểm thử đều tự sinh.
- Không commit data pack. Học viên không có tài khoản, không lưu email; dữ liệu gửi tới model đã ẩn danh và tổng hợp ở mức toàn lớp.

---

## Điểm còn thiếu — ghi ra thay vì che

1. **Chưa có evidence chuẩn A hoặc B.** Không được cấp `data/vlearn-pack/` nên chưa mining được; khảo sát ≥20 người phải làm với người thật. `spec.md` §1 để ô trống, không điền số bịa.
2. **Golden set chưa có case nào từ chatlog thật** (tiêu chí yêu cầu ≥10). 31 case hiện tại do nhóm dựng.
3. **Lượt eval có AI thật (`run-01`) chưa chạy** vì môi trường build chưa có `GROQ_API_KEY`. Đường lùi khi model không dùng được đã kiểm end-to-end; đường model trả kết quả thật thì chưa.
4. **Chưa có vòng validation với người thật.** `validation/` mới có mẫu bảng.
5. **`reflection/` mới là khung** — mỗi người tự viết phần của mình.
