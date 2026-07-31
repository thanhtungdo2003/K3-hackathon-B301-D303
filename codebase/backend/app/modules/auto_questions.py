"""Tự chuẩn bị 1-2 câu hỏi từ nội dung slide khi giảng viên chuyển trang."""
from __future__ import annotations

from sqlalchemy.orm import Session as DbSession

from ..models import Checkpoint, Question, Slide
from . import llm
from .slide_import import slide_plain_text

AUTO_QUESTION_COUNT = 2
GENERIC_PROMPT_MARKERS = (
    "đã hiểu",
    "đã nắm",
    "mức độ hiểu",
    "muốn được giải thích",
    "phần nào chưa",
)


def is_meaningful(question: Question) -> bool:
    """Ẩn câu AI cũ quá chung chung nhưng giữ nguyên dữ liệu/đáp án lịch sử."""
    if question.origin != "llm":
        return True
    prompt = question.prompt.casefold()
    if question.type == "poll" or any(marker in prompt for marker in GENERIC_PROMPT_MARKERS):
        return False
    answer = question.answer if isinstance(question.answer, dict) else {}
    if question.type in ("multiple_choice", "true_false"):
        value = str(answer.get("value", "")).strip()
        return value in question.options or (
            value.isdigit() and int(value) < len(question.options)
        )
    if question.type == "multiple_select":
        return bool(answer.get("values"))
    if question.type == "ordering":
        return bool(answer.get("order"))
    if question.type == "fill_blank":
        return bool(answer.get("accepted"))
    return False


def usable_questions(questions: list[Question]) -> list[Question]:
    return [question for question in questions if is_meaningful(question)]


def _fallback(slide: Slide, position: int) -> Question | None:
    topic = (slide.title or f"slide {slide.index + 1}").strip()
    seen: set[str] = set()
    content_lines: list[str] = []
    for raw in slide_plain_text(slide).splitlines():
        line = " ".join(raw.split()).strip()
        key = line.casefold()
        if not line or key == topic.casefold() or key in seen:
            continue
        seen.add(key)
        content_lines.append(line)
    if position >= len(content_lines):
        return None

    claim = content_lines[position][:220]
    return Question(
        position=position,
        type="true_false",
        prompt=f'Theo slide “{topic}”, nhận định sau đúng hay sai: “{claim}”?',
        options=["Đúng", "Sai"],
        answer={
            "value": "Đúng",
            "explanation": "Nhận định này được nêu trực tiếp trong nội dung slide.",
        },
        origin="llm",
    )


def ensure_for_slide(db: DbSession, slide: Slide) -> list[Question]:
    """Trả tối đa hai câu; tự tạo ngân hàng ẩn nếu slide chưa được soạn trước."""
    checkpoint = slide.checkpoint
    if checkpoint is None:
        checkpoint = Checkpoint(
            slide_id=slide.id,
            label=f"Câu hỏi tự động slide {slide.index + 1}",
            goal="Kiểm tra nhanh mức hiểu ngay khi chuyển slide.",
            active=True,
        )
        db.add(checkpoint)
        db.flush()
    elif not checkpoint.active:
        # Cờ checkpoint cũ không còn điều khiển việc phát câu hỏi.
        checkpoint.active = True

    all_existing = list(checkpoint.questions)
    existing = usable_questions(all_existing)[:AUTO_QUESTION_COUNT]
    next_position = max((question.position for question in all_existing), default=-1) + 1
    missing = AUTO_QUESTION_COUNT - len(existing)
    if missing > 0:
        drafted = llm.draft_checkpoint_questions(
            slide.title,
            slide_plain_text(slide),
            checkpoint.goal,
            missing,
        )
        for item in (drafted or {}).get("questions", [])[:missing]:
            question = Question(
                checkpoint_id=checkpoint.id,
                position=next_position,
                type=item["type"],
                prompt=item["prompt"],
                options=item.get("options") or [],
                answer=item.get("answer") or {},
                origin="llm",
            )
            db.add(question)
            existing.append(question)
            next_position += 1

    while len(existing) < AUTO_QUESTION_COUNT:
        question = _fallback(slide, len(existing))
        if question is None:
            break
        question.position = next_position
        question.checkpoint_id = checkpoint.id
        db.add(question)
        existing.append(question)
        next_position += 1

    db.flush()
    return existing[:AUTO_QUESTION_COUNT]
