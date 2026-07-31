"""API dữ liệu cho giao diện Trợ giảng — tổng hợp thật, không lộ trường định danh."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from .. import realtime
from ..config import get_settings
from ..db import get_db
from ..models import (
    Advice,
    Answer,
    LearningEvent,
    Participant,
    Session,
    Slide,
    StudentHint,
    SupportQuestion,
    User,
)
from ..modules import analytics, state_engine
from ..modules.session_understanding import build_session_summary
from ..schemas import AssistantDashboardOut, SlideTrackingAggregateOut
from ..security import current_user

router = APIRouter(prefix="/teaching-assistant/sessions", tags=["teaching-assistant"])
settings = get_settings()
PULSE_WINDOW_SECONDS = 5 * 60
SUPPORT_ASSIGNED_EVENT = "support_assigned_assistant"


def _owned_session(db: DbSession, session_id: int, user: User) -> Session:
    session = db.get(Session, session_id)
    if session is None or session.room.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Không tìm thấy buổi học.")
    return session


def _rate(value: int, total: int) -> float:
    return round(value / total, 3) if total else 0.0


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _recent(value: datetime, now: datetime) -> bool:
    age = (now - _aware(value)).total_seconds()
    return 0 <= age <= PULSE_WINDOW_SECONDS


def _pulse(
    participants: list[Participant],
    answers: list[Answer],
    events: list[LearningEvent],
    hints: list[StudentHint],
    *,
    current_slide_index: int,
    now: datetime,
) -> dict:
    """Phân nhóm slide hiện tại; thiếu bằng chứng thì giữ nhóm unclassified."""
    online_ids = {participant.id for participant in participants if participant.online}
    latest_answers: dict[int, Answer] = {}
    for answer in sorted(answers, key=lambda row: row.created_at):
        if (
            answer.participant_id in online_ids
            and answer.slide_index == current_slide_index
        ):
            latest_answers[answer.participant_id] = answer

    signalled = {
        event.participant_id
        for event in events
        if event.participant_id in online_ids
        and (
            (
                event.slide_index == current_slide_index
                and event.type in ("raise_hand", "ask_question")
            )
            or event.type == "return_slide"
        )
        and _recent(event.created_at, now)
    }
    requested_hint = {
        hint.participant_id
        for hint in hints
        if hint.participant_id in online_ids
        and hint.slide_index == current_slide_index
        and _recent(hint.created_at, now)
    }

    counts = {
        "on_track": 0,
        "needs_follow_up": 0,
        "struggling": 0,
        "unclassified": 0,
    }
    for participant_id in online_ids:
        answer = latest_answers.get(participant_id)
        has_signal = participant_id in signalled or participant_id in requested_hint
        if answer is None and not has_signal:
            counts["unclassified"] += 1
        elif answer and (
            answer.skipped
            or (answer.correct is False and answer.confidence <= 1)
        ):
            counts["struggling"] += 1
        elif has_signal or (
            answer
            and (
                answer.correct is False
                or answer.confidence == 1
            )
        ):
            counts["needs_follow_up"] += 1
        elif answer and answer.correct is True and answer.confidence >= 2:
            counts["on_track"] += 1
        else:
            counts["unclassified"] += 1

    total = len(online_ids)
    return {
        "total_students": total,
        "classified_students": total - counts["unclassified"],
        **{
            key: {"count": value, "rate": _rate(value, total)}
            for key, value in counts.items()
        },
        "rule_version": "pulse-v1",
        "rules": {
            "scope": "Slide hiện tại; tín hiệu hỗ trợ trong 5 phút gần nhất.",
            "on_track": "Câu gần nhất đúng và độ tự tin từ mức 2.",
            "needs_follow_up": "Có tín hiệu xin hỗ trợ/quay lại hoặc câu gần nhất sai/chưa chắc.",
            "struggling": "Bỏ qua hoặc vừa sai vừa tự đánh giá chưa chắc.",
            "unclassified": "Chưa đủ tín hiệu cá nhân để phân nhóm.",
        },
    }


def _concepts(db: DbSession, session: Session, slides: list[Slide]) -> list[dict]:
    rows: list[dict] = []
    status_by_state = {
        "high_confusion": "red",
        "need_attention": "red",
        "low_participation": "yellow",
        "need_review": "yellow",
    }
    for slide in slides:
        metrics = analytics.collect(
            db,
            session.id,
            slide.index,
            slide.title or f"Slide {slide.index + 1}",
        )
        classroom_state = state_engine.evaluate(metrics)
        understanding_trusted = (
            classroom_state.trusted
            and metrics.graded_answers >= settings.min_responses
        )
        status = (
            status_by_state.get(classroom_state.state, "green")
            if understanding_trusted
            else "insufficient_data"
        )
        rows.append(
            {
                "slide_index": slide.index,
                "title": slide.title or f"Slide {slide.index + 1}",
                "source": "slide_title",
                "understanding": metrics.correct_rate if understanding_trusted else None,
                "status": status,
                "state": classroom_state.state,
                "state_label": classroom_state.label,
                "severity": classroom_state.severity,
                "trusted": understanding_trusted,
                "sample_note": classroom_state.sample_note,
                "evidence": {
                    "online_students": metrics.online_students,
                    "responded": metrics.responded,
                    "graded_answers": metrics.graded_answers,
                    "wrong_rate": metrics.wrong_rate,
                    "skip_rate": metrics.skip_rate,
                    "low_confidence_rate": metrics.low_confidence_rate,
                    "return_visits": metrics.return_slide_count,
                    "questions_asked": metrics.asked_questions,
                },
            }
        )
    return rows


def _support_queue(
    events: list[LearningEvent],
    now: datetime,
    support_questions: list[SupportQuestion] | None = None,
) -> list[dict]:
    rows: list[dict] = []
    support_by_id = {question.id: question for question in (support_questions or [])}
    assignments: dict[int, LearningEvent] = {}
    for event in events:
        if event.type != SUPPORT_ASSIGNED_EVENT:
            continue
        question_id = event.payload.get("support_question_id")
        if isinstance(question_id, int):
            assignments[question_id] = event
    for event in events:
        if event.type not in ("raise_hand", "ask_question"):
            continue
        text = (
            str(event.payload.get("text", "")).strip()[:300]
            if event.type == "ask_question"
            else "Học viên đang giơ tay xin hỗ trợ."
        )
        question_id = event.payload.get("support_question_id")
        support = support_by_id.get(question_id) if isinstance(question_id, int) else None
        assignment = assignments.get(support.id) if support else None
        rows.append(
            {
                "key": f"event-{event.id}",
                "type": event.type,
                "question_id": support.id if support else None,
                "slide_index": event.slide_index,
                "text": text,
                "confusion_score": support.confusion_score if support else None,
                "escalated": support.escalated if support else False,
                "status": support.status if support else None,
                "answer_text": support.answer_text if support else None,
                "answered_by": support.answered_by if support else None,
                "answer_disclaimer": support.answer_disclaimer if support else None,
                "assigned_to_assistant": assignment is not None,
                "assigned_at": _aware(assignment.created_at) if assignment else None,
                "created_at": _aware(event.created_at),
                "age_seconds": max(
                    0, int((now - _aware(event.created_at)).total_seconds())
                ),
            }
        )
    return sorted(
        rows,
        key=lambda row: (
            not row["assigned_to_assistant"],
            row["status"] == "answered",
            row["created_at"],
        ),
    )[:30]


def _tracking_aggregate(
    session: Session,
    participants: list[Participant],
    events: list[LearningEvent],
) -> dict:
    online_students = len(
        [participant for participant in participants if participant.online]
    )
    runtime = realtime.slide_tracking_summary(
        session.id, session.current_slide_index
    )
    tracked = min(runtime["tracked_students"], online_students)
    connected = min(runtime["connected_students"], tracked)
    aligned = min(runtime["aligned_students"], tracked)
    out_of_sync = min(runtime["out_of_sync_students"], tracked - aligned)
    now = datetime.now(timezone.utc)
    online_ids = {participant.id for participant in participants if participant.online}
    reviewing_previous_students = len(
        {
            event.participant_id
            for event in events
            if event.type == "return_slide"
            and event.participant_id in online_ids
            and _recent(event.created_at, now)
        }
    )
    return {
        "session_id": session.id,
        "lecturer_slide_index": session.current_slide_index,
        "timeout_seconds": runtime["timeout_seconds"],
        "online_students": online_students,
        "tracked_students": tracked,
        "connected_students": connected,
        "aligned_students": aligned,
        "out_of_sync_students": out_of_sync,
        "unknown_students": max(0, online_students - tracked),
        "tracking_coverage": _rate(tracked, online_students),
        "auto_synced_total": len(
            [
                event
                for event in events
                if event.type == "auto_slide_sync"
                and event.payload.get("delivery_status") == "emitted"
            ]
        ),
        "reviewing_previous_students": reviewing_previous_students,
    }


@router.get("/{session_id}/dashboard", response_model=AssistantDashboardOut)
def assistant_dashboard(
    session_id: int,
    db: DbSession = Depends(get_db),
    user: User = Depends(current_user),
) -> dict:
    """Một payload cho màn Trợ giảng; GET không tự gọi LLM hay tạo số liệu."""
    session = _owned_session(db, session_id, user)
    participants = list(
        db.scalars(
            select(Participant).where(Participant.session_id == session_id)
        ).all()
    )
    answers = list(
        db.scalars(select(Answer).where(Answer.session_id == session_id)).all()
    )
    events = list(
        db.scalars(
            select(LearningEvent).where(LearningEvent.session_id == session_id)
        ).all()
    )
    hints = list(
        db.scalars(
            select(StudentHint).where(StudentHint.session_id == session_id)
        ).all()
    )
    support_questions = list(
        db.scalars(
            select(SupportQuestion).where(SupportQuestion.session_id == session_id)
        ).all()
    )
    slides = list(
        db.scalars(
            select(Slide)
            .where(Slide.course_id == session.room.course_id)
            .order_by(Slide.index)
        ).all()
    )
    current_metrics = analytics.collect(
        db,
        session_id,
        session.current_slide_index,
        next(
            (
                slide.title
                for slide in slides
                if slide.index == session.current_slide_index
            ),
            f"Slide {session.current_slide_index + 1}",
        ),
    )
    current_state = state_engine.evaluate(current_metrics)
    latest_advice = db.scalar(
        select(Advice)
        .where(
            Advice.session_id == session_id,
            Advice.slide_index == session.current_slide_index,
        )
        .order_by(Advice.created_at.desc())
    )
    now = datetime.now(timezone.utc)
    concepts = _concepts(db, session, slides)
    hot_concepts = sorted(
        [
            row
            for row in concepts
            if row["trusted"]
            and row["state"] in state_engine.ALERT_STATES
        ],
        key=lambda row: (-row["severity"], row["slide_index"]),
    )[:4]
    previous_session = db.scalar(
        select(Session)
        .where(
            Session.room_id == session.room_id,
            Session.id != session.id,
            Session.ended_at.is_not(None),
        )
        .order_by(Session.ended_at.desc())
    )

    return {
        "session": {
            "id": session.id,
            "title": session.title or session.room.name,
            "course_title": session.room.course.title,
            "current_slide_index": session.current_slide_index,
            "ended": session.ended_at is not None,
        },
        "generated_at": now,
        "pulse": _pulse(
            participants,
            answers,
            events,
            hints,
            current_slide_index=session.current_slide_index,
            now=now,
        ),
        "concepts": concepts,
        "hot_concepts": hot_concepts,
        "diagnostic": {
            "slide_index": session.current_slide_index,
            "state": current_state.state,
            "state_label": current_state.label,
            "severity": current_state.severity,
            "reasons": current_state.reasons,
            "trusted": current_state.trusted,
            "sample_note": current_state.sample_note,
            "latest_advice": (
                {
                    "id": latest_advice.id,
                    "slide_index": latest_advice.slide_index,
                    "headline": latest_advice.headline,
                    "action": latest_advice.action,
                    "evidence": latest_advice.evidence,
                    "confidence": latest_advice.confidence,
                    "source": latest_advice.source,
                    "created_at": _aware(latest_advice.created_at),
                }
                if latest_advice
                else None
            ),
        },
        "support_queue": _support_queue(events, now, support_questions),
        "slide_sync": _tracking_aggregate(session, participants, events),
        "current_session_summary": build_session_summary(db, session),
        "previous_session_summary": (
            build_session_summary(db, previous_session)
            if previous_session is not None
            else None
        ),
        "privacy": {
            "identity_fields_omitted": True,
            "free_text_may_contain_self_identification": True,
            "note": (
                "Không trả tên, token, participant_id, avatar hoặc câu trả lời thô; "
                "nội dung câu hỏi tự do vẫn có thể do học viên tự nêu danh tính."
            ),
        },
    }


@router.get(
    "/{session_id}/slide-tracking",
    response_model=SlideTrackingAggregateOut,
)
def assistant_slide_tracking(
    session_id: int,
    db: DbSession = Depends(get_db),
    user: User = Depends(current_user),
) -> dict:
    session = _owned_session(db, session_id, user)
    participants = list(
        db.scalars(
            select(Participant).where(Participant.session_id == session_id)
        ).all()
    )
    events = list(
        db.scalars(
            select(LearningEvent).where(LearningEvent.session_id == session_id)
        ).all()
    )
    return _tracking_aggregate(session, participants, events)
