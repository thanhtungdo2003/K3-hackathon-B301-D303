"""Tự chuẩn bị 1-2 câu hỏi từ nội dung slide khi giảng viên chuyển trang."""
from __future__ import annotations

from sqlalchemy.orm import Session as DbSession

from ..models import Checkpoint, Question, Slide
from . import llm
from .slide_import import slide_plain_text

AUTO_QUESTION_COUNT = 2


def _fallback(slide: Slide, position: int) -> Question:
    topic = (slide.title or f"slide {slide.index + 1}").strip()
    prompts = [
        f"Bạn đã nắm được ý chính của “{topic}” đến mức nào?",
        f"Phần nào trong “{topic}” bạn muốn được giải thích thêm?",
    ]
    options = [
        ["Đã hiểu", "Còn hơi chưa chắc", "Chưa hiểu"],
        ["Không có", "Một phần", "Phần lớn nội dung"],
    ]
    return Question(
        position=position,
        type="poll",
        prompt=prompts[min(position, 1)][:600],
        options=options[min(position, 1)],
        answer={},
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

    existing = list(checkpoint.questions)[:AUTO_QUESTION_COUNT]
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
                position=len(existing),
                type=item["type"],
                prompt=item["prompt"],
                options=item.get("options") or [],
                answer=item.get("answer") or {},
                origin="llm",
            )
            db.add(question)
            existing.append(question)

    while len(existing) < AUTO_QUESTION_COUNT:
        question = _fallback(slide, len(existing))
        question.checkpoint_id = checkpoint.id
        db.add(question)
        existing.append(question)

    db.flush()
    return existing[:AUTO_QUESTION_COUNT]
