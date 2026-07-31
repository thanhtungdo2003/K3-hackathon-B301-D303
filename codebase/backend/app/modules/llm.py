"""Lớp gọi LLM — nhà cung cấp: Groq.

Bốn việc LLM được phép làm:
  1. suggest_student_questions  — sinh CÂU HỎI cho học viên đang bí (không sinh đáp án)
  2. draft_checkpoint_questions — soạn nháp câu hỏi cho một checkpoint, giảng viên duyệt
  3. advise_teacher             — viết cảnh báo + một hành động dạy cho Bục Giảng
  4. chat_with_tools            — trợ lý dashboard, gọi tool để dựng khoá học / phòng học

Mọi lượt gọi đều ghi trace ra ./traces/. Ba việc đầu ép JSON; việc thứ tư dùng tool calling.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from ..config import get_settings

settings = get_settings()

QUESTION_TYPES = ("multiple_choice", "multiple_select", "true_false", "fill_blank", "poll")


def _trace(kind: str, payload: dict) -> None:
    path = settings.trace_dir / f"{kind}-{datetime.now(timezone.utc):%Y%m%d}.jsonl"
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(payload, ensure_ascii=False) + "\n")


def _client():
    if not settings.ai_available:
        return None
    try:
        from groq import Groq
    except ImportError:
        return None
    return Groq(api_key=settings.groq_api_key, timeout=45.0, max_retries=2)


def _chat_json(kind: str, system: str, user: str, max_tokens: int = 1200) -> dict | None:
    """Gọi Groq ở chế độ JSON. Trả None nếu không gọi được hoặc kết quả không parse nổi."""
    client = _client()
    if client is None:
        return None

    trace_id = uuid.uuid4().hex[:12]
    base = {
        "trace_id": trace_id,
        "kind": kind,
        "ts": datetime.now(timezone.utc).isoformat(),
        "model": settings.groq_model,
    }

    try:
        response = client.chat.completions.create(
            model=settings.groq_model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            response_format={"type": "json_object"},
            temperature=0.3,
            max_tokens=max_tokens,
        )
    except Exception as exc:  # noqa: BLE001 — mạng/quota/khoá đều rơi về đường lùi
        _trace(kind, base | {"ok": False, "error": f"{type(exc).__name__}: {exc}", "input": user[:1500]})
        return None

    text = (response.choices[0].message.content or "").strip()
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        _trace(kind, base | {"ok": False, "error": "json_decode_error", "raw": text[:2000]})
        return None

    usage = getattr(response, "usage", None)
    _trace(
        kind,
        base
        | {
            "ok": True,
            "input": user[:2000],
            "output": data,
            "usage": {
                "prompt_tokens": getattr(usage, "prompt_tokens", None),
                "completion_tokens": getattr(usage, "completion_tokens", None),
            },
        },
    )
    data["_trace_id"] = trace_id
    return data


# ── 1. Gợi ý câu hỏi cho học viên đang bí ───────────────────────────────────

STUDENT_SYSTEM = """Bạn giúp một học viên đang bí trong lớp học trực tuyến ĐẶT CÂU HỎI cho giảng viên.

BẠN LÀM GÌ
- Đọc nội dung slide và tín hiệu cho thấy học viên đang vướng, rồi viết 3 câu hỏi mà học viên có thể gửi thẳng lên cho giảng viên.
- Câu hỏi viết ở ngôi thứ nhất, giọng học viên nói với thầy/cô, tiếng Việt, mỗi câu tối đa 120 ký tự.
- Ba câu phải khác nhau về hướng: một câu hỏi lại khái niệm, một câu xin ví dụ hoặc đối chiếu, một câu hỏi về chỗ mình đang hiểu sai.

BẠN KHÔNG LÀM GÌ
- KHÔNG trả lời câu hỏi. KHÔNG giải thích khái niệm. KHÔNG đưa đáp án của bài tập.
- KHÔNG bịa nội dung không có trong slide. Chỉ hỏi về những gì slide có nhắc tới.
- KHÔNG nhắc tên người, không đánh giá năng lực học viên.
- Nếu nội dung slide quá mỏng để đặt câu hỏi có nghĩa, trả về mảng rỗng và ghi lý do vào "note".

ĐỊNH DẠNG: trả về JSON đúng dạng
{"questions": ["...", "...", "..."], "note": ""}"""


def suggest_student_questions(slide_title: str, slide_text: str, signals: dict) -> dict | None:
    user = "\n".join(
        [
            f"TIÊU ĐỀ SLIDE: {slide_title}",
            "",
            "NỘI DUNG SLIDE:",
            slide_text or "(slide không có chữ)",
            "",
            "TÍN HIỆU CỦA HỌC VIÊN NÀY:",
            json.dumps(signals, ensure_ascii=False),
            "",
            "Viết 3 câu hỏi học viên có thể gửi cho giảng viên. Trả JSON đúng schema.",
        ]
    )
    data = _chat_json("student-hint", STUDENT_SYSTEM, user, max_tokens=700)
    if data is None:
        return None
    questions = [str(q).strip()[:160] for q in (data.get("questions") or []) if str(q).strip()]
    return {"questions": questions[:3], "note": str(data.get("note") or ""), "_trace_id": data.get("_trace_id")}


CONFUSION_SYSTEM = """Bạn phân loại mức độ bối rối thể hiện trong câu hỏi của học viên.
Chỉ dựa vào chính câu hỏi và nội dung slide. Trả JSON:
{"confusion_score": 0.0}
Trong đó 0 là câu hỏi thông tin đơn giản, 1 là đang mất mạch nghiêm trọng."""


def assess_student_confusion(question: str, slide_title: str, slide_text: str) -> dict | None:
    return _chat_json(
        "student-confusion",
        CONFUSION_SYSTEM,
        "\n".join(
            [
                f"TIÊU ĐỀ SLIDE: {slide_title}",
                f"NỘI DUNG SLIDE:\n{slide_text or '(không có chữ)'}",
                f"CÂU HỎI HỌC VIÊN: {question}",
            ]
        ),
        max_tokens=120,
    )


STUDENT_ANSWER_SYSTEM = """Bạn là trợ giảng AI trả lời câu hỏi học viên khi hàng đợi người thật quá tải.
Chỉ dùng thông tin có trong slide. Nếu slide không đủ dữ liệu, nói rõ là chưa đủ dữ liệu và
khuyên học viên xác nhận với giảng viên. Trả lời tiếng Việt, ngắn gọn, không bịa nguồn.
Trả JSON đúng dạng {"answer": "..."}."""


def answer_student_question(question: str, slide_title: str, slide_text: str) -> dict | None:
    return _chat_json(
        "student-answer",
        STUDENT_ANSWER_SYSTEM,
        "\n".join(
            [
                f"TIÊU ĐỀ SLIDE: {slide_title}",
                f"NỘI DUNG SLIDE:\n{slide_text or '(không có chữ)'}",
                f"CÂU HỎI HỌC VIÊN: {question}",
            ]
        ),
        max_tokens=500,
    )


SLIDE_SUMMARY_SYSTEM = """Bạn tóm tắt một slide để hỗ trợ học viên đặt và trả lời câu hỏi.
Chỉ dùng nội dung có trong slide, không bổ sung kiến thức ngoài. Viết tiếng Việt, 2-3 câu ngắn,
nêu ý chính và mối quan hệ quan trọng. Trả JSON đúng dạng {"summary": "..."}."""


def summarize_slide(slide_title: str, slide_text: str) -> dict | None:
    return _chat_json(
        "slide-summary",
        SLIDE_SUMMARY_SYSTEM,
        f"TIÊU ĐỀ: {slide_title}\nNỘI DUNG:\n{slide_text or '(không có chữ)'}",
        max_tokens=350,
    )


# ── 2. Soạn nháp câu hỏi cho checkpoint ─────────────────────────────────────

CHECKPOINT_SYSTEM = """Bạn soạn NHÁP câu hỏi kiểm tra hiểu bài cho một checkpoint trong bài giảng. Giảng viên sẽ duyệt lại từng câu trước khi dùng.

RÀNG BUỘC
- Chỉ hỏi về nội dung CÓ TRONG slide được đưa. Không thêm kiến thức ngoài slide.
- Mỗi câu kiểm tra một ý, trả lời được trong 30 giây.
- Phương án nhiễu phải hợp lý: là hiểu nhầm thường gặp, không phải phương án ngớ ngẩn.
- Tiếng Việt. Câu hỏi tối đa 200 ký tự, mỗi phương án tối đa 120 ký tự.
- Nếu slide quá mỏng để ra đề, trả "questions": [] và ghi lý do vào "note".

CÁC LOẠI ĐƯỢC DÙNG
- "multiple_choice": options 3-4 phương án, answer = {"value": "<chỉ số đúng, dạng chuỗi>"}
- "multiple_select": options 4 phương án, answer = {"values": ["<chỉ số>", "..."]}
- "true_false": options ["Đúng", "Sai"], answer = {"value": "0" hoặc "1"}
- "fill_blank": options [], answer = {"accepted": ["cách viết 1", "cách viết 2"]}

ĐỊNH DẠNG: trả về JSON đúng dạng
{"questions": [{"type": "...", "prompt": "...", "options": ["..."], "answer": {...}, "explanation": "..."}], "note": ""}"""


def draft_checkpoint_questions(slide_title: str, slide_text: str, goal: str, count: int = 3) -> dict | None:
    user = "\n".join(
        [
            f"TIÊU ĐỀ SLIDE: {slide_title}",
            "",
            "NỘI DUNG SLIDE:",
            slide_text or "(slide không có chữ)",
            "",
            f"ĐIỀU GIẢNG VIÊN MUỐN KIỂM TRA TẠI CHECKPOINT NÀY: {goal or '(không nêu rõ)'}",
            "",
            f"Soạn {count} câu. Trả JSON đúng schema.",
        ]
    )
    data = _chat_json("checkpoint-draft", CHECKPOINT_SYSTEM, user, max_tokens=1800)
    if data is None:
        return None

    cleaned: list[dict] = []
    for q in data.get("questions") or []:
        qtype = str(q.get("type", "")).strip()
        prompt = str(q.get("prompt", "")).strip()
        if qtype not in QUESTION_TYPES or not prompt:
            continue
        options = [str(o).strip()[:120] for o in (q.get("options") or [])][:6]
        answer = q.get("answer") if isinstance(q.get("answer"), dict) else {}
        if q.get("explanation"):
            answer = {**answer, "explanation": str(q["explanation"])[:300]}
        if qtype in ("multiple_choice", "multiple_select", "true_false") and len(options) < 2:
            continue
        cleaned.append({"type": qtype, "prompt": prompt[:400], "options": options, "answer": answer})

    return {"questions": cleaned[:count], "note": str(data.get("note") or ""), "_trace_id": data.get("_trace_id")}


# ── 3. Teaching Advisor ─────────────────────────────────────────────────────

ADVISOR_SYSTEM = """Bạn là Teaching Advisor — trợ lý quan sát lớp học, viết cho GIẢNG VIÊN đang đứng lớp.

PHẠM VI
- Bạn chỉ nhận số liệu tổng hợp toàn lớp và một nhãn trạng thái đã được rule engine chốt sẵn.
- Việc của bạn: viết một cảnh báo ngắn + MỘT hành động dạy học cụ thể, dựa đúng trên số liệu được đưa.

NGUỒN SỰ THẬT
- Chỉ dùng con số có trong khối METRICS. Không suy ra số mới, không bịa xu hướng theo thời gian.
- "evidence" phải trích lại con số có thật trong METRICS.
- Nhãn "state" do rule engine quyết định. KHÔNG được đổi nhãn.
- Bạn chỉ biết tiêu đề slide, không biết nội dung chi tiết. Đừng mô tả slide như đã đọc nó.

KHI THIẾU THÔNG TIN
- state = "insufficient_data": should_alert=false, confidence="low", headline nói rõ chưa đủ dữ liệu, action đề xuất cách thu thêm tín hiệu.
- Mẫu nhỏ nhưng đủ ngưỡng: confidence tối đa "medium" và nói rõ mẫu nhỏ.

NGOÀI PHẠM VI (đặt refused=true)
- Nêu tên / xếp hạng / chấm điểm / đánh giá năng lực từng học viên.
- Trả lời hộ câu hỏi chuyên môn, giảng bài thay, soạn nội dung bài giảng mới.
- Dự đoán điểm thi, đánh giá thái độ hay tính cách.
- Khi refused=true: should_alert=false, headline="" , action="", evidence=[], nêu lý do ngắn trong refusal_reason kèm một việc bạn LÀM ĐƯỢC thay thế.

AN TOÀN
- Không nhắc tên riêng hay mã học viên. Không kết luận "học viên yếu", "lớp kém".
- Nói về slide và hành động dạy, không nói về con người.
- Không khẳng định nguyên nhân chắc chắn; nói dưới dạng tín hiệu quan sát được.

GIỌNG VĂN: tiếng Việt, ngắn, chuyên nghiệp, không emoji. headline tối đa 60 ký tự, action tối đa 140 ký tự và là MỘT việc làm được trong 2 phút.

ĐỊNH DẠNG: trả về JSON đúng dạng
{"should_alert": true, "headline": "...", "action": "...", "evidence": ["..."], "confidence": "high|medium|low", "refused": false, "refusal_reason": ""}"""


def advise_teacher(metrics: dict, state: dict, lecturer_request: str | None = None) -> dict | None:
    parts = [
        "STATE (rule engine chốt, không được đổi):",
        json.dumps(state, ensure_ascii=False, indent=2),
        "",
        "METRICS (tổng hợp toàn lớp, đã ẩn danh):",
        json.dumps(metrics, ensure_ascii=False, indent=2),
    ]
    if lecturer_request:
        parts += [
            "",
            "YÊU CẦU THÊM TỪ GIẢNG VIÊN (kiểm tra có nằm trong phạm vi không):",
            lecturer_request.strip()[:500],
        ]
    parts += ["", "Trả JSON đúng schema."]
    return _chat_json("advisor", ADVISOR_SYSTEM, "\n".join(parts), max_tokens=900)


# ── 4. Trợ lý dashboard (tool calling) ──────────────────────────────────────

ASSISTANT_SYSTEM = """Bạn là trợ lý dựng lớp học trong hệ thống AGORA, làm việc cùng một giảng viên.

BẠN LÀM ĐƯỢC GÌ
- Tạo và sửa khoá học, xem danh sách slide, đặt checkpoint, soạn nháp câu hỏi, tạo phòng học, bắt đầu buổi học, đọc số liệu tổng quan và chất lượng từng slide.
- Làm những việc đó bằng cách GỌI TOOL. Không bao giờ nói là đã làm xong khi chưa gọi tool tương ứng.

BẠN KHÔNG LÀM ĐƯỢC GÌ
- Không tải file .pptx lên thay người dùng. Khi cần slide, hướng dẫn họ vào trang khoá học bấm "Tải PPTX lên".
- Không xoá bất cứ thứ gì. Nếu người dùng muốn xoá, chỉ họ vào trang tương ứng tự xoá.
- Không chấm điểm, xếp hạng hay nhận xét năng lực từng học viên. Không nêu tên học viên.

CHỈ LÀM ĐÚNG VIỆC ĐƯỢC NHỜ — ĐIỀU QUAN TRỌNG NHẤT
- Tool tạo mới hoặc thay đổi dữ liệu (tạo khoá học, sửa khoá học, đặt checkpoint, soạn câu hỏi, tạo phòng, bắt đầu buổi) CHỈ được gọi khi TIN NHẮN MỚI NHẤT của người dùng yêu cầu đúng việc đó.
- Một việc thay đổi dữ liệu đã thất bại ở lượt trước thì COI NHƯ BỎ. Tuyệt đối không tự làm lại ở lượt sau khi người dùng chưa nhắc lại. Nếu bạn nghĩ giờ làm được rồi, hãy HỎI người dùng có muốn làm không.
- Người dùng chỉ hỏi để xem (có gì, bao nhiêu, slide nào, chất lượng ra sao) thì chỉ dùng tool đọc. Không tạo gì thêm.
- Tên do người dùng đặt phải giữ nguyên từng chữ, kể cả dấu. Không sửa, không đoán lại chính tả.

CÁCH LÀM VIỆC
- Thiếu thông tin bắt buộc thì HỎI LẠI một câu ngắn, đừng tự đặt tên hộ. Ví dụ người dùng nói "tạo khoá học" mà chưa nói tên thì hỏi tên khoá học.
- Người dùng đã nói rõ tên rồi thì làm luôn, không hỏi lại cho đủ lệ.
- Một tin nhắn nhờ nhiều việc nối nhau (đặt checkpoint rồi soạn câu hỏi) thì làm hết trong lượt đó rồi báo cáo một lần.
- Tool trả lỗi vì thiếu điều kiện (chưa có slide chẳng hạn) thì DỪNG việc đó, nói thẳng vướng ở đâu và cần làm gì trước. Chỉ thử lại khi lỗi là do bạn truyền sai tham số.
- Không bịa id, tên khoá học hay mã phòng. Số nào cũng phải từ kết quả tool. Không nhớ id thì dùng tên hoặc mã, hoặc đọc lại danh sách trước.
- TUYỆT ĐỐI không báo là đã làm xong một việc mà tool trả về lỗi. Việc nào lỗi thì nói rõ là chưa làm được và vướng ở đâu.

TRẢ LỜI
- Tiếng Việt, ngắn, mỗi câu một việc. Không emoji. Không markdown bảng.
- Đã làm gì thì liệt kê gọn kèm số liệu thật (mã phòng, số câu hỏi, số slide).
- KHÔNG đọc id ra cho người dùng. Gọi bằng tên khoá học hoặc mã phòng.
- Nói với giảng viên ở ngôi thứ hai ("bạn"), không gọi họ là "người dùng".
- KHÔNG nhắc tên tool, tên hàm, tên tham số hay từ "tool" trong câu trả lời. Người dùng không biết những thứ đó. Nói việc, đừng nói cơ chế.
- Cần người dùng tự làm tiếp thì chỉ đường theo giao diện: "vào trang Khoá học bấm Tải PPTX lên", "mở Bục Giảng của buổi này".
- Cuối cùng nêu một bước tiếp theo cụ thể nếu có."""

MAX_TOOL_ROUNDS = 6


def chat_with_tools(
    messages: list[dict],
    tool_schemas: list[dict],
    run_tool,
    max_rounds: int = MAX_TOOL_ROUNDS,
) -> dict | None:
    """Vòng tool calling của trợ lý dashboard.

    `run_tool(name, args) -> dict` do lớp router truyền vào, đã khoá theo người dùng.
    Trả về {"reply", "calls": [...], "trace_id"} hoặc None nếu không gọi được Groq.
    """
    client = _client()
    if client is None:
        return None

    trace_id = uuid.uuid4().hex[:12]
    convo: list[dict[str, Any]] = [{"role": "system", "content": ASSISTANT_SYSTEM}] + list(messages)
    calls: list[dict] = []

    for round_index in range(max_rounds):
        try:
            response = client.chat.completions.create(
                model=settings.groq_model,
                messages=convo,
                tools=tool_schemas,
                tool_choice="auto",
                temperature=0.2,
                max_tokens=1400,
            )
        except Exception as exc:  # noqa: BLE001 — mạng/quota/khoá đều rơi về đường lùi
            _trace(
                "assistant",
                {
                    "trace_id": trace_id,
                    "kind": "assistant",
                    "ts": datetime.now(timezone.utc).isoformat(),
                    "model": settings.groq_model,
                    "ok": False,
                    "round": round_index,
                    "error": f"{type(exc).__name__}: {exc}",
                },
            )
            # Chạm giới hạn tốc độ là chuyện tạm thời — phải nói khác lỗi mất kết nối,
            # và nếu đã kịp làm được việc gì thì không được giấu.
            return {
                "reply": "",
                "calls": calls,
                "trace_id": trace_id,
                "failure": "rate_limit"
                if type(exc).__name__ == "RateLimitError"
                else "call_failed",
            }

        choice = response.choices[0].message
        tool_calls = getattr(choice, "tool_calls", None) or []

        if not tool_calls:
            reply = (choice.content or "").strip()
            _trace(
                "assistant",
                {
                    "trace_id": trace_id,
                    "kind": "assistant",
                    "ts": datetime.now(timezone.utc).isoformat(),
                    "model": settings.groq_model,
                    "ok": True,
                    "rounds": round_index + 1,
                    "calls": calls,
                    "reply": reply[:1500],
                },
            )
            return {"reply": reply, "calls": calls, "trace_id": trace_id}

        convo.append(
            {
                "role": "assistant",
                "content": choice.content or "",
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments,
                        },
                    }
                    for tc in tool_calls
                ],
            }
        )

        for tc in tool_calls:
            name = tc.function.name
            try:
                args = json.loads(tc.function.arguments or "{}")
                if not isinstance(args, dict):
                    args = {}
            except json.JSONDecodeError:
                args = {}
            result = run_tool(name, args)
            calls.append({"tool": name, "args": args, "result": result})
            convo.append(
                {
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "name": name,
                    "content": json.dumps(result, ensure_ascii=False, default=str)[:4000],
                }
            )

    # Hết vòng mà model vẫn muốn gọi tool: dừng lại và nói thật, không im lặng.
    _trace(
        "assistant",
        {
            "trace_id": trace_id,
            "kind": "assistant",
            "ts": datetime.now(timezone.utc).isoformat(),
            "model": settings.groq_model,
            "ok": True,
            "rounds": max_rounds,
            "calls": calls,
            "reply": "(hết số vòng gọi tool)",
        },
    )
    return {
        "reply": "Việc này cần nhiều bước hơn một lượt. Đã làm được phần ở trên, bạn nhắc tiếp bước còn lại nhé.",
        "calls": calls,
        "trace_id": trace_id,
    }
