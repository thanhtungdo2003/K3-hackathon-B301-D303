"""Bục Giảng — điều khiển buổi học, dashboard realtime, Teaching Advisor."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from .. import realtime
from ..db import get_db
from ..models import (
    Advice,
    Answer,
    LearningEvent,
    Question,
    Session,
    Slide,
    StudentHint,
    SupportQuestion,
    User,
    utcnow,
)
from ..modules import advisor, analytics, auto_questions, question_support, state_engine
from ..schemas import (
    AdviceRequest,
    FeedbackRequest,
    QuestionOut,
    SlideChangeRequest,
    SupportAnswerRequest,
    SupportQuestionOut,
    TriggerQuestionRequest,
)
from ..security import current_user

router = APIRouter(prefix="/teaching/sessions", tags=["teaching"])
AUTO_QUESTIONS_PRESENTED_EVENT = "auto_questions_presented"


def _owned_session(db: DbSession, session_id: int, user: User) -> Session:
    session = db.get(Session, session_id)
    if session is None or session.room.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Không tìm thấy buổi học.")
    return session


def _slide(db: DbSession, session: Session, index: int) -> Slide | None:
    return db.scalar(
        select(Slide).where(Slide.course_id == session.room.course_id, Slide.index == index)
    )


def _slide_title(db: DbSession, session: Session, index: int) -> str:
    slide = _slide(db, session, index)
    return slide.title if slide else f"Slide {index + 1}"


@router.post("/{session_id}/slide")
async def change_slide(
    session_id: int,
    payload: SlideChangeRequest,
    db: DbSession = Depends(get_db),
    user: User = Depends(current_user),
) -> dict:
    session = _owned_session(db, session_id, user)
    slide = _slide(db, session, payload.slide_index)
    if slide is None:
        raise HTTPException(status_code=404, detail="Slide không tồn tại trong khoá học.")

    questions = auto_questions.ensure_for_slide(db, slide)
    already_presented = (
        db.scalar(
            select(LearningEvent.id)
            .where(
                LearningEvent.session_id == session_id,
                LearningEvent.slide_index == payload.slide_index,
                LearningEvent.type == AUTO_QUESTIONS_PRESENTED_EVENT,
            )
            .limit(1)
        )
        is not None
    )
    should_present = bool(questions) and not already_presented
    session.current_slide_index = payload.slide_index
    session.current_question_id = questions[0].id if should_present else None
    if should_present:
        db.add(
            LearningEvent(
                session_id=session_id,
                slide_index=payload.slide_index,
                type=AUTO_QUESTIONS_PRESENTED_EVENT,
            )
        )
    db.commit()

    await realtime.lecturer_slide_changed(session_id, payload.slide_index)
    await realtime.broadcast(
        session_id,
        "slide_changed",
        {"session_id": session_id, "slide_index": payload.slide_index},
    )
    question_payloads = [
        {
            "id": question.id,
            "type": question.type,
            "prompt": question.prompt,
            "options": question.options,
            "slide_index": slide.index,
        }
        for question in questions
    ]
    if should_present:
        # Event đơn giữ tương thích client cũ; event cụm phát sau để client mới giữ đủ 1-2 câu.
        await realtime.broadcast(session_id, "question_opened", question_payloads[0])
        await realtime.broadcast(
            session_id,
            "questions_opened",
            {"session_id": session_id, "questions": question_payloads},
        )
    else:
        await realtime.broadcast(session_id, "question_closed", {"session_id": session_id})
    return {
        "slide_index": payload.slide_index,
        "current_question_id": session.current_question_id,
        "questions": question_payloads,
        "questions_presented": should_present,
    }


@router.get("/{session_id}/checkpoint", response_model=list[QuestionOut])
def current_checkpoint(
    session_id: int,
    slide_index: int | None = None,
    db: DbSession = Depends(get_db),
    user: User = Depends(current_user),
) -> list[QuestionOut]:
    """Câu hỏi của checkpoint gắn với slide đang trình bày (nếu có)."""
    session = _owned_session(db, session_id, user)
    index = session.current_slide_index if slide_index is None else slide_index
    slide = _slide(db, session, index)
    if slide is None or slide.checkpoint is None:
        return []
    questions = auto_questions.usable_questions(list(slide.checkpoint.questions))
    return [
        QuestionOut(
            id=q.id,
            position=q.position,
            type=q.type,
            prompt=q.prompt,
            options=q.options,
            answer=q.answer,
            origin=q.origin,
        )
        for q in questions
    ]


@router.post("/{session_id}/question")
async def trigger_question(
    session_id: int,
    payload: TriggerQuestionRequest,
    db: DbSession = Depends(get_db),
    user: User = Depends(current_user),
) -> dict:
    """Mở hoặc đóng câu hỏi của checkpoint. Học viên chỉ thấy câu hỏi sau bước này."""
    session = _owned_session(db, session_id, user)

    if payload.question_id is None:
        session.current_question_id = None
        db.commit()
        await realtime.broadcast(session_id, "question_closed", {"session_id": session_id})
        return {"current_question_id": None}

    question = db.get(Question, payload.question_id)
    if question is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy câu hỏi.")

    checkpoint = question.checkpoint
    if checkpoint.slide.course_id != session.room.course_id:
        raise HTTPException(status_code=403, detail="Câu hỏi không thuộc khoá học của buổi này.")
    if not checkpoint.active:
        raise HTTPException(status_code=409, detail="Checkpoint này đang bị tắt.")

    previous_slide_index = session.current_slide_index
    session.current_question_id = question.id
    session.current_slide_index = checkpoint.slide.index
    db.commit()

    await realtime.lecturer_slide_changed(session_id, checkpoint.slide.index)
    if previous_slide_index != checkpoint.slide.index:
        await realtime.broadcast(
            session_id,
            "slide_changed",
            {"session_id": session_id, "slide_index": checkpoint.slide.index},
        )
    await realtime.broadcast(
        session_id,
        "question_opened",
        {
            "session_id": session_id,
            "id": question.id,
            "type": question.type,
            "prompt": question.prompt,
            "options": question.options,
            "slide_index": checkpoint.slide.index,
        },
    )
    return {"current_question_id": question.id}


@router.get("/{session_id}/dashboard")
def dashboard(
    session_id: int, db: DbSession = Depends(get_db), user: User = Depends(current_user)
) -> dict:
    session = _owned_session(db, session_id, user)
    index = session.current_slide_index
    metrics = analytics.collect(db, session_id, index, _slide_title(db, session, index))
    state = state_engine.evaluate(metrics)

    latest = db.scalar(
        select(Advice).where(Advice.session_id == session_id).order_by(Advice.created_at.desc())
    )
    questions = db.scalars(
        select(SupportQuestion)
        .where(SupportQuestion.session_id == session_id)
        .order_by(SupportQuestion.created_at.desc())
        .limit(8)
    ).all()
    question_results = None
    if session.current_question_id is not None:
        current_answers = db.scalars(
            select(Answer).where(
                Answer.session_id == session_id,
                Answer.question_id == session.current_question_id,
            )
        ).all()
        graded = [
            answer
            for answer in current_answers
            if answer.correct is not None and not answer.skipped
        ]
        correct_count = len([answer for answer in graded if answer.correct])
        wrong_count = len(graded) - correct_count
        graded_count = len(graded)
        question_results = {
            "question_id": session.current_question_id,
            "answered": len([answer for answer in current_answers if not answer.skipped]),
            "graded": graded_count,
            "correct": correct_count,
            "wrong": wrong_count,
            "skipped": len([answer for answer in current_answers if answer.skipped]),
            "correct_rate": round(correct_count / graded_count, 3) if graded_count else 0.0,
            "wrong_rate": round(wrong_count / graded_count, 3) if graded_count else 0.0,
        }

    return {
        "slide_index": index,
        "slide_title": metrics.slide_title,
        "metrics": metrics.as_dict(),
        "state": state.as_dict(),
        "current_question_id": session.current_question_id,
        "question_results": question_results,
        "ended": session.ended_at is not None,
        "inbox": [
            {
                "id": question.id,
                "text": question.text,
                "slide_index": question.slide_index,
                "confusion_score": question.confusion_score,
                "confusion_threshold": question_support.CONFUSION_THRESHOLD,
                "escalated": question.escalated,
                "status": question.status,
                "answer_text": question.answer_text,
                "answered_by": question.answered_by,
                "answer_disclaimer": question.answer_disclaimer,
                "at": question.created_at.isoformat(),
            }
            for question in questions
        ],
        "latest_advice": (
            {
                "id": latest.id,
                "headline": latest.headline,
                "action": latest.action,
                "evidence": latest.evidence,
                "confidence": latest.confidence,
                "source": latest.source,
                "state": latest.state,
                "slide_index": latest.slide_index,
                "created_at": latest.created_at.isoformat(),
            }
            if latest
            else None
        ),
    }


@router.post(
    "/{session_id}/support-questions/{question_id}/answer",
    response_model=SupportQuestionOut,
)
async def answer_support_question(
    session_id: int,
    question_id: int,
    payload: SupportAnswerRequest,
    db: DbSession = Depends(get_db),
    user: User = Depends(current_user),
) -> SupportQuestion:
    _owned_session(db, session_id, user)
    question = db.get(SupportQuestion, question_id)
    if question is None or question.session_id != session_id:
        raise HTTPException(status_code=404, detail="Không tìm thấy câu hỏi hỗ trợ.")
    question.answer_text = payload.text.strip()
    question.answered_by = payload.answered_by
    question.answer_disclaimer = None
    question.status = "answered"
    question.answered_at = utcnow()
    db.commit()
    await realtime.sio.emit(
        "support_answered",
        {
            "id": question.id,
            "answer_text": question.answer_text,
            "answered_by": question.answered_by,
            "answer_disclaimer": None,
        },
        room=realtime.participant_room(question.participant_id),
    )
    return question


@router.post("/{session_id}/advice")
async def request_advice(
    session_id: int,
    payload: AdviceRequest,
    db: DbSession = Depends(get_db),
    user: User = Depends(current_user),
) -> dict:
    """Quyết định AI trung tâm: có nên cảnh báo, và gợi ý một hành động dạy nào."""
    session = _owned_session(db, session_id, user)
    index = payload.slide_index if payload.slide_index is not None else session.current_slide_index

    metrics = analytics.collect(db, session_id, index, _slide_title(db, session, index))
    state = state_engine.evaluate(metrics)
    result = advisor.advise(metrics.as_dict(), state, payload.lecturer_request)

    row = Advice(
        session_id=session_id,
        slide_index=index,
        state=result.state,
        should_alert=result.should_alert,
        headline=result.headline,
        action=result.action,
        evidence=result.evidence,
        confidence=result.confidence,
        source=result.source,
        metrics=metrics.as_dict(),
        raw=result.as_dict(),
    )
    db.add(row)
    db.commit()

    body = result.as_dict() | {"id": row.id, "slide_index": index, "metrics": metrics.as_dict()}
    if result.should_alert:
        await realtime.to_lecturer(session_id, "advice", body)
    return body


@router.post("/{session_id}/advice/{advice_id}/feedback")
def advice_feedback(
    session_id: int,
    advice_id: int,
    payload: FeedbackRequest,
    db: DbSession = Depends(get_db),
    user: User = Depends(current_user),
) -> dict:
    _owned_session(db, session_id, user)
    row = db.get(Advice, advice_id)
    if row is None or row.session_id != session_id:
        raise HTTPException(status_code=404, detail="Không tìm thấy gợi ý.")
    row.feedback = payload.feedback
    row.feedback_note = payload.note
    db.commit()
    return {"ok": True}


@router.get("/{session_id}/hints")
def session_hints(
    session_id: int, db: DbSession = Depends(get_db), user: User = Depends(current_user)
) -> list[dict]:
    """Các lượt học viên xin gợi ý câu hỏi — tín hiệu chỗ nào đang khó."""
    _owned_session(db, session_id, user)
    rows = db.scalars(
        select(StudentHint)
        .where(StudentHint.session_id == session_id)
        .order_by(StudentHint.created_at.desc())
        .limit(30)
    ).all()
    return [
        {
            "id": r.id,
            "slide_index": r.slide_index,
            "source": r.source,
            "picked": r.picked,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]
