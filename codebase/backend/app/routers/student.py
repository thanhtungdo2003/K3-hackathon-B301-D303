"""Phía học viên — vào bằng mã phòng, không tài khoản."""
from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from .. import realtime
from ..db import get_db
from ..models import Answer, LearningEvent, Participant, Question, Room, Session, Slide, StudentHint
from ..modules import assessment, student_coach
from ..modules.slide_import import slide_plain_text
from ..schemas import (
    AnswerRequest,
    AnswerResponse,
    EventRequest,
    HintPickRequest,
    HintRequest,
    HintResponse,
    JoinRequest,
    JoinResponse,
    SlideOut,
    StudentQuestionOut,
)

router = APIRouter(tags=["student"])


def get_participant(db: DbSession, token: str, session_id: int | None = None) -> Participant:
    participant = db.scalar(select(Participant).where(Participant.token == token))
    if participant is None:
        raise HTTPException(status_code=401, detail="Mã tham gia không hợp lệ. Hãy vào lại bằng mã lớp.")
    if session_id is not None and participant.session_id != session_id:
        raise HTTPException(status_code=403, detail="Mã tham gia không thuộc buổi học này.")
    if participant.session.ended_at is not None:
        raise HTTPException(status_code=410, detail="Buổi học đã kết thúc.")
    return participant


def _slides_of(db: DbSession, session: Session) -> list[Slide]:
    return list(
        db.scalars(
            select(Slide).where(Slide.course_id == session.room.course_id).order_by(Slide.index)
        ).all()
    )


@router.post("/join", response_model=JoinResponse)
async def join(payload: JoinRequest, db: DbSession = Depends(get_db)) -> JoinResponse:
    code = payload.code.strip().upper()
    room = db.scalar(select(Room).where(Room.code == code))
    if room is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy phòng với mã này.")

    session = db.scalar(
        select(Session)
        .where(Session.room_id == room.id, Session.ended_at.is_(None))
        .order_by(Session.started_at.desc())
    )
    if session is None:
        raise HTTPException(status_code=409, detail="Phòng chưa mở buổi học. Chờ giảng viên bắt đầu.")

    participant = Participant(
        session_id=session.id,
        token=secrets.token_urlsafe(24),
        display_name=payload.display_name.strip()[:40],
        avatar=payload.avatar or "paw",
    )
    db.add(participant)
    db.flush()
    db.add(LearningEvent(session_id=session.id, participant_id=participant.id, type="join"))
    db.commit()

    online = len([p for p in session.participants if p.online])
    await realtime.broadcast(session.id, "roster_changed", {"online": online})

    return JoinResponse(
        token=participant.token,
        participant_id=participant.id,
        session_id=session.id,
        room_name=room.name,
        course_title=room.course.title,
        lecturer_name=room.course.owner.full_name,
        display_name=participant.display_name,
        avatar=participant.avatar,
        slide_count=len(_slides_of(db, session)),
        current_slide_index=session.current_slide_index,
    )


@router.get("/sessions/{session_id}/slides", response_model=list[SlideOut])
def list_slides(session_id: int, db: DbSession = Depends(get_db)) -> list[SlideOut]:
    session = db.get(Session, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy buổi học.")
    return [
        SlideOut(
            id=s.id,
            index=s.index,
            title=s.title,
            blocks=s.blocks or [],
            notes="",  # ghi chú của giảng viên không gửi cho học viên
            source=s.source,
            checkpoint_id=s.checkpoint.id if s.checkpoint else None,
            question_count=len(s.checkpoint.questions) if s.checkpoint else 0,
        )
        for s in _slides_of(db, session)
    ]


@router.get("/sessions/{session_id}/state")
def session_state(session_id: int, db: DbSession = Depends(get_db)) -> dict:
    """Trạng thái công khai của buổi học — học viên đọc được, không cần token."""
    session = db.get(Session, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy buổi học.")
    question = db.get(Question, session.current_question_id) if session.current_question_id else None
    return {
        "session_id": session.id,
        "room_name": session.room.name,
        "course_title": session.room.course.title,
        "ended": session.ended_at is not None,
        "current_slide_index": session.current_slide_index,
        "current_question": (
            {
                "id": question.id,
                "type": question.type,
                "prompt": question.prompt,
                "options": question.options,
                "slide_index": question.checkpoint.slide.index,
            }
            if question
            else None
        ),
    }


@router.post("/sessions/{session_id}/answers", response_model=AnswerResponse)
async def submit_answer(
    session_id: int, payload: AnswerRequest, db: DbSession = Depends(get_db)
) -> AnswerResponse:
    participant = get_participant(db, payload.token, session_id)
    question = db.get(Question, payload.question_id)
    if question is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy câu hỏi.")

    slide_index = question.checkpoint.slide.index
    existing = db.scalar(
        select(Answer).where(
            Answer.session_id == session_id,
            Answer.participant_id == participant.id,
            Answer.question_id == question.id,
        )
    )
    if existing is not None:
        return AnswerResponse(correct=existing.correct, score=existing.score)

    if payload.skipped:
        correct, score = None, 0.0
    else:
        correct, score = assessment.grade(question.type, question.answer, {"value": payload.value})

    db.add(
        Answer(
            session_id=session_id,
            participant_id=participant.id,
            question_id=question.id,
            slide_index=slide_index,
            payload={"value": payload.value},
            correct=correct,
            score=score,
            response_ms=max(0, payload.response_ms),
            skipped=payload.skipped,
            confidence=payload.confidence,
        )
    )
    db.commit()

    await realtime.to_lecturer(
        session_id, "answer_received", {"question_id": question.id, "slide_index": slide_index}
    )

    explanation = question.answer.get("explanation") if isinstance(question.answer, dict) else None
    return AnswerResponse(correct=correct, score=score, explanation=explanation)


@router.post("/sessions/{session_id}/events")
async def record_event(
    session_id: int, payload: EventRequest, db: DbSession = Depends(get_db)
) -> dict:
    participant = get_participant(db, payload.token, session_id)
    db.add(
        LearningEvent(
            session_id=session_id,
            participant_id=participant.id,
            slide_index=payload.slide_index,
            type=payload.type,
            payload=payload.payload,
        )
    )
    db.commit()

    if payload.type in ("raise_hand", "ask_question"):
        await realtime.to_lecturer(
            session_id,
            "signal",
            {
                "type": payload.type,
                "slide_index": payload.slide_index,
                "avatar": participant.avatar,
                "name": participant.display_name,
                "text": str(payload.payload.get("text", ""))[:300],
            },
        )
    return {"ok": True}


# ── Gợi ý câu hỏi cho học viên đang bí (LLM: Groq) ──────────────────────────

@router.post("/sessions/{session_id}/hints", response_model=HintResponse)
def request_hint(
    session_id: int, payload: HintRequest, db: DbSession = Depends(get_db)
) -> HintResponse:
    participant = get_participant(db, payload.token, session_id)
    session = participant.session

    slide = db.scalar(
        select(Slide).where(
            Slide.course_id == session.room.course_id, Slide.index == payload.slide_index
        )
    )
    if slide is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy slide.")

    # Tín hiệu của riêng học viên này, dùng để chọn hướng đặt câu hỏi.
    answers = db.scalars(
        select(Answer).where(
            Answer.session_id == session_id,
            Answer.participant_id == participant.id,
            Answer.slide_index == payload.slide_index,
        )
    ).all()
    signals = {
        "da_tra_loi": len(answers),
        "so_cau_sai": len([a for a in answers if a.correct is False]),
        "da_bo_qua": len([a for a in answers if a.skipped]),
        "tu_danh_gia_chua_chac": any(a.confidence == 1 for a in answers),
    }

    result = student_coach.suggest(slide.title, slide_plain_text(slide), signals)

    row = StudentHint(
        session_id=session_id,
        participant_id=participant.id,
        slide_index=payload.slide_index,
        questions=result.questions,
        source=result.source,
    )
    db.add(row)
    db.commit()

    return HintResponse(
        id=row.id,
        questions=result.questions,
        source=result.source,
        note=result.note,
        guard_flags=result.guard_flags,
    )


@router.post("/sessions/{session_id}/hints/{hint_id}/send")
async def send_hint_question(
    session_id: int, hint_id: int, payload: HintPickRequest, db: DbSession = Depends(get_db)
) -> dict:
    """Học viên chọn một câu gợi ý và gửi thẳng cho giảng viên."""
    participant = get_participant(db, payload.token, session_id)
    row = db.get(StudentHint, hint_id)
    if row is None or row.participant_id != participant.id:
        raise HTTPException(status_code=404, detail="Không tìm thấy gợi ý.")

    text = payload.question.strip()[:300]
    row.picked = text
    db.add(
        LearningEvent(
            session_id=session_id,
            participant_id=participant.id,
            slide_index=row.slide_index,
            type="ask_question",
            payload={"text": text, "from_hint": True},
        )
    )
    db.commit()

    await realtime.to_lecturer(
        session_id,
        "signal",
        {
            "type": "ask_question",
            "slide_index": row.slide_index,
            "avatar": participant.avatar,
            "name": participant.display_name,
            "text": text,
        },
    )
    return {"ok": True}


@router.post("/sessions/{session_id}/leave")
async def leave(session_id: int, payload: HintRequest, db: DbSession = Depends(get_db)) -> dict:
    participant = get_participant(db, payload.token, session_id)
    participant.online = False
    participant_id = participant.id
    db.add(
        LearningEvent(session_id=session_id, participant_id=participant.id, type="leave")
    )
    db.commit()
    await realtime.stop_student_tracking(participant_id)
    online = len([p for p in participant.session.participants if p.online])
    await realtime.broadcast(session_id, "roster_changed", {"online": online})
    return {"ok": True}
