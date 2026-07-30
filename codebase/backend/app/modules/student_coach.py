"""Gợi ý câu hỏi cho học viên đang bí.

LLM chỉ sinh CÂU HỎI, không sinh đáp án — học viên vẫn phải hỏi giảng viên.
Nếu LLM không dùng được, rơi về bộ câu mở sẵn theo tiêu đề slide.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from . import llm

MAX_LEN = 160

FALLBACK_TEMPLATES = [
    "Em chưa nắm được ý chính của phần {topic}, thầy/cô nói lại giúp em được không ạ?",
    "Thầy/cô cho em một ví dụ thực tế của {topic} được không ạ?",
    "Em đang hiểu {topic} theo cách này, không biết có sai chỗ nào không ạ?",
]

# Chặn trường hợp LLM lỡ viết ra câu trả lời thay vì câu hỏi
ANSWER_MARKERS = ("đáp án là", "câu trả lời là", "kết quả là", "chọn phương án", "đáp án đúng")


@dataclass
class HintResult:
    questions: list[str]
    source: str  # llm | rule_fallback
    note: str = ""
    guard_flags: list[str] = field(default_factory=list)
    trace_id: str | None = None

    def as_dict(self) -> dict:
        return {
            "questions": self.questions,
            "source": self.source,
            "note": self.note,
            "guard_flags": self.guard_flags,
            "trace_id": self.trace_id,
        }


def _fallback(slide_title: str) -> HintResult:
    topic = (slide_title or "phần này").strip().rstrip("?.!")
    return HintResult(
        questions=[t.format(topic=topic)[:MAX_LEN] for t in FALLBACK_TEMPLATES],
        source="rule_fallback",
    )


def validate(questions: list[str]) -> list[str]:
    """Hậu kiểm: phải là câu hỏi, đủ ngắn, và không phải câu trả lời trá hình."""
    flags: list[str] = []
    if not questions:
        flags.append("empty")
        return flags
    for q in questions:
        low = q.lower()
        if len(q) > MAX_LEN:
            flags.append("too_long")
        if "?" not in q:
            flags.append("not_a_question")
        if any(marker in low for marker in ANSWER_MARKERS):
            flags.append("contains_answer")
    return sorted(set(flags))


def suggest(slide_title: str, slide_text: str, signals: dict) -> HintResult:
    raw = llm.suggest_student_questions(slide_title, slide_text, signals)
    if raw is None:
        result = _fallback(slide_title)
        result.guard_flags = ["ai_unavailable"]
        return result

    questions = raw.get("questions") or []
    flags = validate(questions)
    if flags:
        result = _fallback(slide_title)
        result.guard_flags = flags
        result.trace_id = raw.get("_trace_id")
        result.note = raw.get("note", "")
        return result

    return HintResult(
        questions=questions,
        source="llm",
        note=raw.get("note", ""),
        trace_id=raw.get("_trace_id"),
    )
