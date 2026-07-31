"""Tổng hợp mức hiểu theo buổi học, chỉ trả dữ liệu lớp đã ẩn danh."""
from __future__ import annotations

from collections import defaultdict
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from ..models import Answer, LearningEvent, Participant, Session, Slide, StudentHint

UnderstandingStatus = Literal["understood", "temporary", "not_understood"]


def _rate(value: int, total: int) -> float:
    return round(value / total, 3) if total else 0.0


def _status(
    answers: list[Answer],
    events: list[LearningEvent],
    hints: list[StudentHint],
) -> UnderstandingStatus | None:
    """Ưu tiên bằng chứng khó khăn; không suy diễn khi chưa có tín hiệu."""
    support_signal = any(event.type in ("raise_hand", "ask_question") for event in events)
    returned_to_slide = any(event.type == "return_slide" for event in events)
    requested_hint = bool(hints)
    skipped = any(answer.skipped for answer in answers)
    wrong_and_unsure = any(
        answer.correct is False and answer.confidence <= 1 for answer in answers
    )
    wrong = any(answer.correct is False for answer in answers)
    unsure = any(answer.confidence == 1 for answer in answers)
    confidently_correct = any(
        answer.correct is True and answer.confidence >= 2 for answer in answers
    )

    if support_signal or requested_hint or skipped or wrong_and_unsure:
        return "not_understood"
    if returned_to_slide or wrong or unsure:
        return "temporary"
    if confidently_correct:
        return "understood"
    return None


def build_session_summary(db: DbSession, session: Session) -> dict:
    participants = list(
        db.scalars(
            select(Participant).where(Participant.session_id == session.id)
        ).all()
    )
    answers = list(
        db.scalars(select(Answer).where(Answer.session_id == session.id)).all()
    )
    events = list(
        db.scalars(
            select(LearningEvent).where(LearningEvent.session_id == session.id)
        ).all()
    )
    hints = list(
        db.scalars(select(StudentHint).where(StudentHint.session_id == session.id)).all()
    )
    slides = list(
        db.scalars(
            select(Slide)
            .where(Slide.course_id == session.room.course_id)
            .order_by(Slide.index)
        ).all()
    )

    # Một học viên có thể trả lời lại; chỉ bằng chứng mới nhất trên mỗi slide được dùng.
    latest_answers: dict[tuple[int, int], Answer] = {}
    for answer in sorted(answers, key=lambda row: row.created_at):
        latest_answers[(answer.participant_id, answer.slide_index)] = answer

    events_by_student: dict[int, list[LearningEvent]] = defaultdict(list)
    events_by_student_slide: dict[tuple[int, int], list[LearningEvent]] = defaultdict(list)
    for event in events:
        if event.participant_id is None:
            continue
        events_by_student[event.participant_id].append(event)
        events_by_student_slide[(event.participant_id, event.slide_index)].append(event)

    hints_by_student: dict[int, list[StudentHint]] = defaultdict(list)
    hints_by_student_slide: dict[tuple[int, int], list[StudentHint]] = defaultdict(list)
    for hint in hints:
        hints_by_student[hint.participant_id].append(hint)
        hints_by_student_slide[(hint.participant_id, hint.slide_index)].append(hint)

    session_counts = {
        "understood": 0,
        "temporary": 0,
        "not_understood": 0,
        "unclassified": 0,
    }
    for participant in participants:
        participant_answers = [
            answer
            for (participant_id, _), answer in latest_answers.items()
            if participant_id == participant.id
        ]
        participant_status = _status(
            participant_answers,
            events_by_student[participant.id],
            hints_by_student[participant.id],
        )
        session_counts[participant_status or "unclassified"] += 1

    topics: list[dict] = []
    for slide in slides:
        counts = {
            "understood": 0,
            "temporary": 0,
            "not_understood": 0,
            "unclassified": 0,
        }
        for participant in participants:
            answer = latest_answers.get((participant.id, slide.index))
            slide_status = _status(
                [answer] if answer else [],
                events_by_student_slide[(participant.id, slide.index)],
                hints_by_student_slide[(participant.id, slide.index)],
            )
            counts[slide_status or "unclassified"] += 1

        classified = (
            counts["understood"]
            + counts["temporary"]
            + counts["not_understood"]
        )
        if not counts["temporary"] and not counts["not_understood"]:
            continue
        status = "red" if counts["not_understood"] else "yellow"
        reasons: list[str] = []
        if counts["not_understood"]:
            reasons.append(f'{counts["not_understood"]} học viên chưa hiểu')
        if counts["temporary"]:
            reasons.append(f'{counts["temporary"]} học viên tạm hiểu/cần xem lại')
        topics.append(
            {
                "slide_index": slide.index,
                "title": slide.title or f"Slide {slide.index + 1}",
                "status": status,
                "understood": counts["understood"],
                "temporary": counts["temporary"],
                "not_understood": counts["not_understood"],
                "classified_students": classified,
                "temporary_rate": _rate(counts["temporary"], classified),
                "not_understood_rate": _rate(
                    counts["not_understood"], classified
                ),
                "reasons": reasons,
            }
        )

    topics.sort(
        key=lambda row: (
            row["status"] != "red",
            -row["not_understood"],
            -row["temporary"],
            row["slide_index"],
        )
    )
    classified_students = (
        session_counts["understood"]
        + session_counts["temporary"]
        + session_counts["not_understood"]
    )
    return {
        "session": {
            "id": session.id,
            "title": session.title or session.room.name,
            "course_title": session.room.course.title,
            "started_at": session.started_at,
            "ended_at": session.ended_at,
        },
        "total_students": len(participants),
        "classified_students": classified_students,
        "coverage_rate": _rate(classified_students, len(participants)),
        "understood": {
            "count": session_counts["understood"],
            "rate": _rate(session_counts["understood"], classified_students),
        },
        "temporary": {
            "count": session_counts["temporary"],
            "rate": _rate(session_counts["temporary"], classified_students),
        },
        "not_understood": {
            "count": session_counts["not_understood"],
            "rate": _rate(
                session_counts["not_understood"], classified_students
            ),
        },
        "unclassified_students": session_counts["unclassified"],
        "unclear_topics": topics[:8],
        "rule_version": "session-understanding-v1",
        "privacy_note": (
            "Chỉ hiển thị số liệu tổng hợp; không trả tên, token hoặc mã học viên."
        ),
    }
