"""Phía học viên — vào bằng mã phòng, không tài khoản."""
from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from .. import realtime
from ..db import get_db
from ..models import (
    Answer,
    LearningEvent,
    Participant,
    Question,
    Room,
    Session,
    Slide,
    StudentHint,
    SupportQuestion,
    utcnow,
)
from ..modules import assessment, question_support, student_coach
from ..modules.slide_import import page_image_url, slide_plain_text
from ..schemas import (
    AnswerRequest,
    AnswerResponse,
    AiSupportRequest,
    AiSupportResponse,
    EventRequest,
    HintPickRequest,
    HintRequest,
    HintResponse,
    JoinRequest,
    JoinResponse,
    SlideOut,
    StudentQuestionOut,
    SupportQuestionCreate,
    SupportQuestionOut,
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


def _open_questions(question: Question | None) -> list[Question]:
    if question is None:
        return []
    questions = list(question.checkpoint.questions)
    try:
        start = next(i for i, item in enumerate(questions) if item.id == question.id)
    except StopIteration:
        return [question]
    return questions[start : start + 2]


def _question_payload(question: Question) -> dict:
    return {
        "id": question.id,
        "type": question.type,
        "prompt": question.prompt,
        "options": question.options,
        "slide_index": question.checkpoint.slide.index,
    }


def _support_out(question: SupportQuestion) -> dict:
    return {
        "id": question.id,
        "slide_index": question.slide_index,
        "text": question.text,
        "confusion_score": question.confusion_score,
        "confusion_threshold": question_support.CONFUSION_THRESHOLD,
        "escalated": question.escalated,
        "status": question.status,
        "answer_text": question.answer_text,
        "answered_by": question.answered_by,
        "answer_disclaimer": question.answer_disclaimer,
        "created_at": question.created_at,
        "answered_at": question.answered_at,
    }


def _normalized_answer_key(question: Question) -> dict:
    answer = dict(question.answer) if isinstance(question.answer, dict) else {}
    if question.type in ("multiple_choice", "true_false"):
        value = str(answer.get("value", "")).strip()
        if value.isdigit() and int(value) < len(question.options):
            answer["value"] = question.options[int(value)]
    elif question.type == "multiple_select":
        values: list[str] = []
        for raw in answer.get("values", []):
            value = str(raw).strip()
            if value.isdigit() and int(value) < len(question.options):
                value = str(question.options[int(value)])
            values.append(value)
        answer["values"] = values
    return answer


def _correct_answer_text(question: Question) -> str | None:
    answer = _normalized_answer_key(question)
    if question.type in ("multiple_choice", "true_false"):
        value = answer.get("value")
        return str(value) if value not in (None, "") else None
    if question.type == "multiple_select":
        values = [str(value) for value in answer.get("values", []) if str(value).strip()]
        return ", ".join(values) or None
    if question.type == "ordering":
        values = [str(value) for value in answer.get("order", []) if str(value).strip()]
        return " → ".join(values) or None
    if question.type == "fill_blank":
        values = [str(value) for value in answer.get("accepted", []) if str(value).strip()]
        return " / ".join(values) or None
    return None


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
            page_image_url=page_image_url(s.page_image),
        )
        for s in _slides_of(db, session)
    ]


@router.get("/sessions/{session_id}/state")
def session_state(
    session_id: int,
    token: str | None = None,
    db: DbSession = Depends(get_db),
) -> dict:
    """Trạng thái công khai của buổi học — học viên đọc được, không cần token."""
    session = db.get(Session, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy buổi học.")
    question = db.get(Question, session.current_question_id) if session.current_question_id else None
    current_questions = _open_questions(question)
    if token:
        participant = db.scalar(
            select(Participant).where(
                Participant.token == token,
                Participant.session_id == session_id,
            )
        )
        if participant is not None and current_questions:
            answered_ids = set(
                db.scalars(
                    select(Answer.question_id).where(
                        Answer.session_id == session_id,
                        Answer.participant_id == participant.id,
                        Answer.question_id.in_([item.id for item in current_questions]),
                    )
                ).all()
            )
            current_questions = [
                item for item in current_questions if item.id not in answered_ids
            ]
    current_question = current_questions[0] if current_questions else None
    return {
        "session_id": session.id,
        "room_name": session.room.name,
        "course_title": session.room.course.title,
        "ended": session.ended_at is not None,
        "current_slide_index": session.current_slide_index,
        "current_question": _question_payload(current_question) if current_question else None,
        "current_questions": [_question_payload(item) for item in current_questions],
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
        answer_key = _normalized_answer_key(question)
        explanation = answer_key.get("explanation")
        return AnswerResponse(
            correct=existing.correct,
            score=existing.score,
            explanation=explanation,
            correct_answer=_correct_answer_text(question),
        )

    if payload.skipped:
        correct, score = None, 0.0
    else:
        correct, score = assessment.grade(
            question.type,
            _normalized_answer_key(question),
            {"value": payload.value},
        )

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

    explanation = _normalized_answer_key(question).get("explanation")
    return AnswerResponse(
        correct=correct,
        score=score,
        explanation=explanation,
        correct_answer=_correct_answer_text(question),
    )


@router.post("/sessions/{session_id}/events")
async def record_event(
    session_id: int, payload: EventRequest, db: DbSession = Depends(get_db)
) -> dict:
    participant = get_participant(db, payload.token, session_id)
    if payload.type == "ask_question":
        text = str(payload.payload.get("text", "")).strip()
        if not text:
            raise HTTPException(status_code=422, detail="Câu hỏi không được để trống.")
        return await ask_support_question(
            session_id,
            SupportQuestionCreate(
                token=payload.token,
                slide_index=payload.slide_index,
                text=text,
            ),
            db,
        )
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


@router.post(
    "/sessions/{session_id}/questions",
    response_model=SupportQuestionOut,
    status_code=201,
)
async def ask_support_question(
    session_id: int,
    payload: SupportQuestionCreate,
    db: DbSession = Depends(get_db),
) -> dict:
    participant = get_participant(db, payload.token, session_id)
    session = participant.session
    slide = db.scalar(
        select(Slide).where(
            Slide.course_id == session.room.course_id,
            Slide.index == payload.slide_index,
        )
    )
    if slide is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy slide.")

    text = payload.text.strip()
    slide_text = slide_plain_text(slide)
    classification = question_support.classify(text, slide.title, slide_text)
    escalated = classification.score >= question_support.CONFUSION_THRESHOLD
    pending_count = db.scalar(
        select(func.count(SupportQuestion.id)).where(
            SupportQuestion.session_id == session_id,
            SupportQuestion.status == "pending",
        )
    ) or 0
    use_ai = pending_count >= question_support.MAX_HUMAN_PENDING
    question = SupportQuestion(
        session_id=session_id,
        participant_id=participant.id,
        slide_index=payload.slide_index,
        text=text,
        confusion_score=classification.score,
        classifier_source=classification.source,
        escalated=escalated,
    )
    if use_ai:
        question.answer_text = question_support.answer(text, slide.title, slide_text)
        question.answered_by = "ai"
        question.answer_disclaimer = question_support.AI_DISCLAIMER
        question.status = "answered"
        question.answered_at = utcnow()
    db.add(question)
    db.flush()
    db.add(
        LearningEvent(
            session_id=session_id,
            participant_id=participant.id,
            slide_index=payload.slide_index,
            type="ask_question",
            payload={
                "text": text,
                "support_question_id": question.id,
                "confusion_score": classification.score,
                "escalated": escalated,
            },
        )
    )
    db.commit()

    event_payload = {
        "id": question.id,
        "type": "ask_question",
        "slide_index": question.slide_index,
        "avatar": participant.avatar,
        "name": participant.display_name,
        "text": question.text,
        "confusion_score": question.confusion_score,
        "confusion_threshold": question_support.CONFUSION_THRESHOLD,
        "escalated": question.escalated,
        "status": question.status,
    }
    if escalated:
        await realtime.to_teaching_team(session_id, "support_question", event_payload)
    else:
        await realtime.to_lecturer(session_id, "support_question", event_payload)
    if question.answered_by == "ai":
        await realtime.sio.emit(
            "support_answered",
            {
                "id": question.id,
                "answer_text": question.answer_text,
                "answered_by": "ai",
                "answer_disclaimer": question.answer_disclaimer,
            },
            room=realtime.participant_room(participant.id),
        )
    return _support_out(question)


@router.get("/sessions/{session_id}/questions", response_model=list[SupportQuestionOut])
def my_support_questions(
    session_id: int,
    token: str,
    db: DbSession = Depends(get_db),
) -> list[dict]:
    participant = get_participant(db, token, session_id)
    questions = db.scalars(
        select(SupportQuestion)
        .where(
            SupportQuestion.session_id == session_id,
            SupportQuestion.participant_id == participant.id,
        )
        .order_by(SupportQuestion.created_at.desc())
        .limit(20)
    ).all()
    return [_support_out(question) for question in questions]


@router.post("/sessions/{session_id}/ai-support", response_model=AiSupportResponse)
async def ai_support(
    session_id: int,
    payload: AiSupportRequest,
    db: DbSession = Depends(get_db),
) -> dict:
    """AI hỗ trợ trong phạm vi slide; chỉ chuyển người thật khi đạt ngưỡng bối rối."""
    participant = get_participant(db, payload.token, session_id)
    slide = db.scalar(
        select(Slide).where(
            Slide.course_id == participant.session.room.course_id,
            Slide.index == payload.slide_index,
        )
    )
    if slide is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy slide.")

    slide_text = slide_plain_text(slide)
    summary = question_support.summarize(slide.title, slide_text)
    message = payload.message.strip()
    if not message:
        return {
            "summary": summary,
            "answer": "",
            "confusion_score": 0.0,
            "confusion_threshold": question_support.CONFUSION_THRESHOLD,
            "escalated": False,
            "support_question": None,
            "disclaimer": question_support.AI_DISCLAIMER,
        }

    classification = question_support.classify(message, slide.title, slide_text)
    if classification.score < question_support.CONFUSION_THRESHOLD:
        lesson_slides = db.scalars(
            select(Slide)
            .where(Slide.course_id == participant.session.room.course_id)
            .order_by(Slide.index)
        ).all()
        lesson_outline = "\n".join(
            f"SLIDE {item.index + 1}: {item.title}"
            for item in lesson_slides
        )
        lesson_details = "\n\n".join(
            f"SLIDE {item.index + 1}:\n{slide_plain_text(item)}"
            for item in lesson_slides
        )
        lesson_text = (
            f"DANH SÁCH SLIDE:\n{lesson_outline}\n\n"
            f"NỘI DUNG CÁC SLIDE:\n{lesson_details}"
        )[:16000]
        return {
            "summary": summary,
            "answer": question_support.answer(
                message,
                slide.title,
                slide_text,
                lesson_text,
            ),
            "confusion_score": classification.score,
            "confusion_threshold": question_support.CONFUSION_THRESHOLD,
            "escalated": False,
            "support_question": None,
            "disclaimer": question_support.AI_DISCLAIMER,
        }

    support = await ask_support_question(
        session_id,
        SupportQuestionCreate(
            token=payload.token,
            slide_index=payload.slide_index,
            text=message,
        ),
        db,
    )
    # Giữ quyết định chuyển tuyến của chính lượt chat này làm nguồn sự thật, tránh
    # một lần phân loại LLM thứ hai dao động quanh ngưỡng 30%.
    support_row = db.get(SupportQuestion, support["id"])
    if support_row is not None:
        was_escalated = support_row.escalated
        support_row.confusion_score = classification.score
        support_row.classifier_source = classification.source
        support_row.escalated = True
        db.commit()
        support = _support_out(support_row)
        if not was_escalated:
            await realtime.to_teaching_team(
                session_id,
                "support_question",
                {
                    "id": support_row.id,
                    "type": "ask_question",
                    "slide_index": support_row.slide_index,
                    "avatar": participant.avatar,
                    "name": participant.display_name,
                    "text": support_row.text,
                    "confusion_score": support_row.confusion_score,
                    "confusion_threshold": question_support.CONFUSION_THRESHOLD,
                    "escalated": True,
                    "status": support_row.status,
                },
            )
    return {
        "summary": summary,
        "answer": (
            "Mức bối rối đã đạt ngưỡng 30%. Mình đã chuyển câu hỏi này đến "
            "giảng viên và trợ giảng để hỗ trợ chính xác hơn."
        ),
        "confusion_score": classification.score,
        "confusion_threshold": question_support.CONFUSION_THRESHOLD,
        "escalated": True,
        "support_question": support,
        "disclaimer": question_support.AI_DISCLAIMER,
    }


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
    db.commit()
    return await ask_support_question(
        session_id,
        SupportQuestionCreate(
            token=payload.token,
            slide_index=row.slide_index,
            text=text,
        ),
        db,
    )


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
