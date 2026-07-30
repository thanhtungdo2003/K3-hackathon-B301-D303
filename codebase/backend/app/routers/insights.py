"""Dashboard tổng quan cho chủ phòng — dữ liệu thật từ các buổi đã dạy."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from ..db import get_db
from ..models import Advice, Answer, Course, LearningEvent, Participant, Room, Session, Slide, StudentHint, User
from ..security import current_user

router = APIRouter(prefix="/insights", tags=["insights"])


def _rate(numerator: int, denominator: int) -> float:
    return round(numerator / denominator, 3) if denominator else 0.0


@router.get("/overview")
def overview(db: DbSession = Depends(get_db), user: User = Depends(current_user)) -> dict:
    """Số tổng quan trên trang dashboard chính."""
    course_ids = [
        c for c in db.scalars(select(Course.id).where(Course.owner_id == user.id)).all()
    ]
    room_ids = [r for r in db.scalars(select(Room.id).where(Room.owner_id == user.id)).all()]
    session_rows = (
        db.scalars(select(Session).where(Session.room_id.in_(room_ids))).all() if room_ids else []
    )
    session_ids = [s.id for s in session_rows]

    answers = (
        db.scalars(select(Answer).where(Answer.session_id.in_(session_ids))).all()
        if session_ids
        else []
    )
    graded = [a for a in answers if a.correct is not None and not a.skipped]
    participants = (
        db.scalar(
            select(func.count(Participant.id)).where(Participant.session_id.in_(session_ids))
        )
        or 0
        if session_ids
        else 0
    )
    slides = (
        db.scalar(select(func.count(Slide.id)).where(Slide.course_id.in_(course_ids))) or 0
        if course_ids
        else 0
    )
    hints = (
        db.scalar(select(func.count(StudentHint.id)).where(StudentHint.session_id.in_(session_ids)))
        or 0
        if session_ids
        else 0
    )
    questions_asked = (
        db.scalar(
            select(func.count(LearningEvent.id)).where(
                LearningEvent.session_id.in_(session_ids), LearningEvent.type == "ask_question"
            )
        )
        or 0
        if session_ids
        else 0
    )

    advices = (
        db.scalars(select(Advice).where(Advice.session_id.in_(session_ids))).all()
        if session_ids
        else []
    )
    alerts = [a for a in advices if a.should_alert]
    dismissed = [a for a in alerts if a.feedback == "dismissed"]
    thumbs_up = [a for a in alerts if a.feedback == "up"]

    return {
        "courses": len(course_ids),
        "rooms": len(room_ids),
        "sessions": len(session_ids),
        "live_sessions": len([s for s in session_rows if s.ended_at is None]),
        "slides": slides,
        "participants": participants,
        "answers": len(answers),
        "correct_rate": _rate(len([a for a in graded if a.correct]), len(graded)),
        "skip_rate": _rate(len([a for a in answers if a.skipped]), len(answers)),
        "questions_asked": questions_asked,
        "hints_requested": hints,
        "advisor": {
            "total": len(advices),
            "alerts": len(alerts),
            "by_source": {
                s: len([a for a in advices if a.source == s])
                for s in ("ai", "rule_fallback", "abstain")
            },
            "dismiss_rate": _rate(len(dismissed), len(alerts)),
            "useful_rate": _rate(len(thumbs_up), len(alerts)),
        },
    }


@router.get("/sessions")
def recent_sessions(
    limit: int = 10, db: DbSession = Depends(get_db), user: User = Depends(current_user)
) -> list[dict]:
    room_ids = [r for r in db.scalars(select(Room.id).where(Room.owner_id == user.id)).all()]
    if not room_ids:
        return []
    rows = db.scalars(
        select(Session)
        .where(Session.room_id.in_(room_ids))
        .order_by(Session.started_at.desc())
        .limit(max(1, min(limit, 50)))
    ).all()

    out = []
    for s in rows:
        answers = db.scalars(select(Answer).where(Answer.session_id == s.id)).all()
        graded = [a for a in answers if a.correct is not None and not a.skipped]
        joined = (
            db.scalar(select(func.count(Participant.id)).where(Participant.session_id == s.id)) or 0
        )
        out.append(
            {
                "id": s.id,
                "title": s.title or s.room.name,
                "room_code": s.room.code,
                "course_title": s.room.course.title,
                "started_at": s.started_at.isoformat(),
                "ended_at": s.ended_at.isoformat() if s.ended_at else None,
                "live": s.ended_at is None,
                "participants": joined,
                "answers": len(answers),
                "correct_rate": _rate(len([a for a in graded if a.correct]), len(graded)),
            }
        )
    return out


@router.get("/courses/{course_id}/quality")
def course_quality(
    course_id: int, db: DbSession = Depends(get_db), user: User = Depends(current_user)
) -> dict:
    """Chất lượng theo từng slide, gộp qua mọi buổi đã dạy của khoá học."""
    course = db.get(Course, course_id)
    if course is None or course.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Không tìm thấy khoá học.")

    room_ids = [r.id for r in course.rooms]
    session_ids = (
        [s for s in db.scalars(select(Session.id).where(Session.room_id.in_(room_ids))).all()]
        if room_ids
        else []
    )

    answers = (
        db.scalars(select(Answer).where(Answer.session_id.in_(session_ids))).all()
        if session_ids
        else []
    )
    events = (
        db.scalars(select(LearningEvent).where(LearningEvent.session_id.in_(session_ids))).all()
        if session_ids
        else []
    )
    hints = (
        db.scalars(select(StudentHint).where(StudentHint.session_id.in_(session_ids))).all()
        if session_ids
        else []
    )

    rows = []
    for slide in course.slides:
        a = [x for x in answers if x.slide_index == slide.index]
        graded = [x for x in a if x.correct is not None and not x.skipped]
        rows.append(
            {
                "slide_index": slide.index,
                "title": slide.title,
                "has_checkpoint": slide.checkpoint is not None,
                "question_count": len(slide.checkpoint.questions) if slide.checkpoint else 0,
                "answers": len(a),
                "correct_rate": _rate(len([x for x in graded if x.correct]), len(graded)),
                "skip_rate": _rate(len([x for x in a if x.skipped]), len(a)),
                "low_confidence_rate": _rate(len([x for x in a if x.confidence == 1]), len(a)),
                "return_visits": len(
                    [e for e in events if e.slide_index == slide.index and e.type == "return_slide"]
                ),
                "questions_asked": len(
                    [e for e in events if e.slide_index == slide.index and e.type == "ask_question"]
                ),
                "hints_requested": len([h for h in hints if h.slide_index == slide.index]),
            }
        )

    # Slide đáng xem lại nhất: sai nhiều, bỏ qua nhiều, hoặc bị quay lại nhiều
    def risk(r: dict) -> float:
        if not r["answers"]:
            return r["return_visits"] * 0.05 + r["hints_requested"] * 0.05
        return (
            (1 - r["correct_rate"]) * 0.5
            + r["skip_rate"] * 0.2
            + r["low_confidence_rate"] * 0.2
            + min(r["return_visits"] / 10, 1) * 0.1
        )

    ranked = sorted(rows, key=risk, reverse=True)
    return {
        "course": {"id": course.id, "title": course.title, "subject": course.subject},
        "sessions": len(session_ids),
        "slides": rows,
        "needs_attention": [r for r in ranked[:5] if risk(r) > 0.2],
    }
