"""Learning Analytics — gom tín hiệu thô thành các chỉ số tổng hợp cho một slide.

Đây là ranh giới bảo vệ dữ liệu học viên: mọi thứ đi tiếp về phía Advisor
đều đã ẩn danh và đã tổng hợp. Không có tên, không có id học viên.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from statistics import median

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from ..models import Answer, LearningEvent, Participant


@dataclass
class SlideMetrics:
    slide_index: int
    slide_title: str
    online_students: int
    responded: int
    participation: float          # responded / online
    correct_rate: float           # đúng / (đã trả lời, có chấm)
    wrong_rate: float
    skip_rate: float
    median_response_s: float
    slow_rate: float              # tỉ lệ trả lời > 45s
    low_confidence_rate: float    # tỉ lệ tự khai "chưa chắc"
    return_slide_count: int       # số lượt quay lại slide này
    raised_hands: int
    asked_questions: int
    graded_answers: int           # số câu có đúng/sai (mẫu dùng để tính correct_rate)
    top_wrong_options: list[dict] = field(default_factory=list)

    def as_dict(self) -> dict:
        return asdict(self)


SLOW_MS = 45_000


def collect(db: DbSession, session_id: int, slide_index: int, slide_title: str) -> SlideMetrics:
    online = db.scalars(
        select(Participant).where(Participant.session_id == session_id, Participant.online.is_(True))
    ).all()
    online_count = len(online)

    answers = db.scalars(
        select(Answer).where(Answer.session_id == session_id, Answer.slide_index == slide_index)
    ).all()

    events = db.scalars(
        select(LearningEvent).where(
            LearningEvent.session_id == session_id, LearningEvent.slide_index == slide_index
        )
    ).all()

    responded = len([a for a in answers if not a.skipped])
    skipped = len([a for a in answers if a.skipped])
    graded = [a for a in answers if a.correct is not None and not a.skipped]
    correct = len([a for a in graded if a.correct])

    times = [a.response_ms for a in answers if not a.skipped and a.response_ms > 0]
    slow = len([t for t in times if t > SLOW_MS])
    low_conf = len([a for a in answers if a.confidence == 1])

    # Phân bố đáp án sai để giảng viên biết học viên hiểu nhầm ở đâu
    wrong_counter: dict[str, int] = {}
    for a in graded:
        if not a.correct:
            key = str(a.payload.get("value"))
            wrong_counter[key] = wrong_counter.get(key, 0) + 1
    top_wrong = [
        {"option": k, "count": v}
        for k, v in sorted(wrong_counter.items(), key=lambda kv: -kv[1])[:3]
    ]

    def ratio(numerator: int, denominator: int) -> float:
        return round(numerator / denominator, 3) if denominator else 0.0

    return SlideMetrics(
        slide_index=slide_index,
        slide_title=slide_title,
        online_students=online_count,
        responded=responded,
        participation=ratio(responded, online_count),
        correct_rate=ratio(correct, len(graded)),
        wrong_rate=ratio(len(graded) - correct, len(graded)),
        skip_rate=ratio(skipped, online_count),
        median_response_s=round(median(times) / 1000, 1) if times else 0.0,
        slow_rate=ratio(slow, len(times)),
        low_confidence_rate=ratio(low_conf, len(answers)),
        return_slide_count=len([e for e in events if e.type == "return_slide"]),
        raised_hands=len([e for e in events if e.type == "raise_hand"]),
        asked_questions=len([e for e in events if e.type == "ask_question"]),
        graded_answers=len(graded),
        top_wrong_options=top_wrong,
    )
