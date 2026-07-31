"""Phân luồng câu hỏi học viên theo ngưỡng bối rối và tải hàng đợi."""
from __future__ import annotations

from dataclasses import dataclass

from ..config import get_settings
from . import llm

CONFUSION_THRESHOLD = get_settings().confusion_threshold
MAX_HUMAN_PENDING = 5
AI_DISCLAIMER = "Câu trả lời do AI tạo ra, có thể không hoàn toàn chính xác."


@dataclass
class Classification:
    score: float
    source: str


def classify(text: str, slide_title: str, slide_text: str) -> Classification:
    raw = llm.assess_student_confusion(text, slide_title, slide_text)
    if raw is not None:
        try:
            score = min(1.0, max(0.0, float(raw.get("confusion_score", 0))))
            return Classification(score=score, source="llm")
        except (TypeError, ValueError):
            pass

    markers = (
        "không hiểu",
        "chưa hiểu",
        "không rõ",
        "bối rối",
        "vì sao",
        "tại sao",
        "khác nhau",
        "giải thích",
        "giúp em",
        "sai ở đâu",
    )
    lowered = text.casefold()
    score = 0.75 if any(marker in lowered for marker in markers) else 0.45
    return Classification(score=score, source="rule_fallback")


def answer(
    text: str,
    slide_title: str,
    slide_text: str,
    lesson_text: str = "",
) -> str:
    raw = llm.answer_student_question(text, slide_title, slide_text, lesson_text)
    if raw and str(raw.get("answer", "")).strip():
        return str(raw["answer"]).strip()[:2000]
    return (
        "AI chưa đủ dữ liệu để trả lời chắc chắn câu này. Bạn nên đối chiếu lại nội dung "
        "slide và xác nhận với giảng viên hoặc trợ giảng."
    )


def summarize(slide_title: str, slide_text: str) -> str:
    raw = llm.summarize_slide(slide_title, slide_text)
    if raw and str(raw.get("summary", "")).strip():
        return str(raw["summary"]).strip()[:1200]
    compact = " ".join(slide_text.split())
    if compact:
        return compact[:600] + ("…" if len(compact) > 600 else "")
    return f"Slide này giới thiệu nội dung “{slide_title}”."
