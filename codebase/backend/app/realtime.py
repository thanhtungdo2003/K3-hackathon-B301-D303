"""Socket.IO — đồng bộ slide, tracking học viên và popup advisor realtime."""
from __future__ import annotations

from typing import Any

import jwt
import socketio
from sqlalchemy import select

from .config import get_settings
from .db import SessionLocal
from .models import LearningEvent, Participant, Session, Slide, User
from .modules.slide_tracking import AutoSyncCommand, SlideTrackingService

sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")
settings = get_settings()


def room(session_id: int) -> str:
    return f"session:{session_id}"


def lecturer_room(session_id: int) -> str:
    return f"lecturer:{session_id}"


def assistant_room(session_id: int) -> str:
    return f"teaching-assistant:{session_id}"


def participant_room(participant_id: int) -> str:
    return f"participant:{participant_id}"


async def _emit_tracking_summary(session_id: int) -> None:
    await sio.emit(
        "slide_tracking_summary",
        tracking.session_summary(session_id),
        room=assistant_room(session_id),
    )


async def _emit_force_sync(command: AutoSyncCommand) -> int | None:
    """Ghi audit idempotent rồi phát lệnh riêng cho mọi tab của học viên."""
    audit_id: int
    already_emitted = False
    with SessionLocal() as db:
        session = db.get(Session, command.session_id)
        if session is None or session.ended_at is not None:
            return None
        participant = db.get(Participant, command.participant_id)
        if (
            participant is None
            or participant.session_id != command.session_id
            or not participant.online
        ):
            return None
        latest_slide_index = session.current_slide_index
        if latest_slide_index == command.from_slide_index:
            return latest_slide_index
        command = AutoSyncCommand(
            participant_id=command.participant_id,
            session_id=command.session_id,
            from_slide_index=command.from_slide_index,
            slide_index=latest_slide_index,
            mismatch_seconds=command.mismatch_seconds,
            mismatch_id=command.mismatch_id,
        )
        audit = db.scalar(
            select(LearningEvent).where(
                LearningEvent.session_id == command.session_id,
                LearningEvent.participant_id == command.participant_id,
                LearningEvent.type == "auto_slide_sync",
                LearningEvent.payload["sync_id"].as_string() == command.sync_id,
            )
        )
        if audit is None:
            audit = LearningEvent(
                session_id=command.session_id,
                participant_id=command.participant_id,
                slide_index=command.slide_index,
                type="auto_slide_sync",
                payload={
                    "from_slide_index": command.from_slide_index,
                    "mismatch_seconds": command.mismatch_seconds,
                    "reason": "slide_mismatch_timeout",
                    "sync_id": command.sync_id,
                    "delivery_status": "pending",
                },
            )
            db.add(audit)
            db.commit()
        else:
            already_emitted = audit.payload.get("delivery_status") == "emitted"
        audit_id = audit.id

    if not already_emitted:
        await sio.emit(
            "force_slide_sync",
            command.as_payload(),
            room=participant_room(command.participant_id),
        )
        with SessionLocal() as db:
            audit = db.get(LearningEvent, audit_id)
            if audit is not None:
                audit.payload = {
                    **audit.payload,
                    "delivery_status": "emitted",
                }
                db.commit()
    return command.slide_index


tracking = SlideTrackingService(
    settings.slide_sync_timeout_seconds,
    on_force_sync=_emit_force_sync,
    on_change=_emit_tracking_summary,
)


async def _error(sid: str, code: str, message: str) -> dict:
    payload = {"ok": False, "code": code, "message": message}
    await sio.emit("slide_tracking_error", payload, to=sid)
    return payload


def _strict_bool(value: Any, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    raise ValueError("Giá trị boolean phải là true hoặc false.")


def _authorized_lecturer_slide(session_id: int, token: str | None) -> int | None:
    if not token:
        return None
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, KeyError, TypeError, ValueError):
        return None
    with SessionLocal() as db:
        user = db.get(User, user_id)
        session = db.get(Session, session_id)
        if (
            user is None
            or session is None
            or session.ended_at is not None
            or session.room.owner_id != user.id
        ):
            return None
        return session.current_slide_index


def _student_context(
    session_id: int, token: str, slide_index: int | None
) -> tuple[int, int, int] | str:
    """Xác thực token và slide trước khi tin dữ liệu tracking từ socket."""
    with SessionLocal() as db:
        participant = db.scalar(
            select(Participant).where(
                Participant.token == token,
                Participant.session_id == session_id,
            )
        )
        session = db.get(Session, session_id)
        if participant is None or session is None:
            return "Mã tham gia không hợp lệ cho buổi học này."
        if session.ended_at is not None:
            return "Buổi học đã kết thúc."
        if not participant.online:
            return "Học viên đã rời buổi học."

        resolved_slide = session.current_slide_index if slide_index is None else slide_index
        valid_slide = db.scalar(
            select(Slide.id).where(
                Slide.course_id == session.room.course_id,
                Slide.index == resolved_slide,
            )
        )
        if valid_slide is None:
            return "Slide không tồn tại trong khoá học."

        return participant.id, session.current_slide_index, resolved_slide


@sio.event
async def connect(sid, environ, auth):  # noqa: ANN001, D103
    return True


@sio.event
async def join_session(sid, data):  # noqa: ANN001
    """Join tương thích cũ; tracking bật khi học viên gửi thêm token.

    Student payload mới:
      {session_id, role: "student", token, slide_index, following}
    """
    try:
        session_id = int(data["session_id"])
    except (KeyError, TypeError, ValueError):
        return await _error(sid, "invalid_session", "session_id không hợp lệ.")

    role = data.get("role")
    if role not in ("student", "lecturer"):
        return await _error(sid, "invalid_role", "role phải là student hoặc lecturer.")

    participant_id: int | None = None
    tracking_authorized = False
    reported_slide: int | None = None
    lecturer_slide_index: int | None = None
    following = False
    joined_payload: dict[str, Any] = {
        "ok": True,
        "session_id": session_id,
        "role": role,
        "tracking_enabled": False,
    }

    if role == "student" and data.get("token"):
        try:
            reported_slide = (
                int(data["slide_index"]) if data.get("slide_index") is not None else None
            )
        except (TypeError, ValueError):
            return await _error(sid, "invalid_slide", "slide_index không hợp lệ.")

        context = _student_context(session_id, str(data["token"]), reported_slide)
        if isinstance(context, str):
            return await _error(sid, "unauthorized_tracking", context)
        participant_id, lecturer_slide_index, reported_slide = context
        try:
            following = _strict_bool(
                data.get("following"),
                reported_slide == lecturer_slide_index,
            )
        except ValueError as exc:
            return await _error(sid, "invalid_following", str(exc))
    elif role == "lecturer":
        lecturer_slide_index = _authorized_lecturer_slide(
            session_id, data.get("token")
        )
        if lecturer_slide_index is None:
            return await _error(
                sid,
                "unauthorized_lecturer",
                "Socket giảng viên cần JWT hợp lệ của chủ phòng.",
            )
        tracking_authorized = True

    # Chỉ rời membership cũ sau khi payload mới đã được xác thực.
    try:
        previous = await sio.get_session(sid)
    except KeyError:
        previous = None
    if previous:
        previous_session_id = int(previous["session_id"])
        await sio.leave_room(sid, room(previous_session_id))
        if previous.get("role") == "lecturer":
            await sio.leave_room(sid, lecturer_room(previous_session_id))
        if previous.get("tracking_authorized"):
            await sio.leave_room(sid, assistant_room(previous_session_id))
        if previous.get("participant_id") is not None:
            await sio.leave_room(
                sid, participant_room(int(previous["participant_id"]))
            )
        await tracking.detach_socket(sid)

    if (
        role == "student"
        and participant_id is not None
        and reported_slide is not None
        and lecturer_slide_index is not None
    ):
        await sio.enter_room(sid, participant_room(participant_id))
        snapshot = await tracking.track_student(
            participant_id=participant_id,
            session_id=session_id,
            slide_index=reported_slide,
            following_lecturer=following,
            lecturer_slide_index=lecturer_slide_index,
            socket_id=sid,
        )
        joined_payload.update({"tracking_enabled": True, "tracking": snapshot})

    await sio.enter_room(sid, room(session_id))
    if role == "lecturer":
        await sio.enter_room(sid, lecturer_room(session_id))
        if lecturer_slide_index is not None:
            await sio.enter_room(sid, assistant_room(session_id))
            await tracking.lecturer_changed(session_id, lecturer_slide_index)
            joined_payload.update(
                {
                    "tracking_enabled": True,
                    "slide_tracking": tracking.session_summary(
                        session_id, lecturer_slide_index
                    ),
                }
            )

    await sio.save_session(
        sid,
        {
            "session_id": session_id,
            "role": role,
            "participant_id": participant_id,
            "tracking_authorized": tracking_authorized,
        },
    )
    await sio.emit("joined", joined_payload, to=sid)
    return joined_payload


@sio.event
async def student_slide_changed(sid, data):  # noqa: ANN001
    """Heartbeat/event từ FE mỗi khi slide đang xem hoặc chế độ follow thay đổi."""
    try:
        socket_session = await sio.get_session(sid)
    except KeyError:
        return await _error(sid, "not_joined", "Socket chưa tham gia buổi học.")

    participant_id = socket_session.get("participant_id")
    session_id = socket_session.get("session_id")
    if socket_session.get("role") != "student" or participant_id is None:
        return await _error(
            sid,
            "tracking_not_enabled",
            "Hãy join_session bằng token học viên trước khi gửi tracking.",
        )

    try:
        slide_index = int(data["slide_index"])
    except (KeyError, TypeError, ValueError):
        return await _error(sid, "invalid_slide", "slide_index không hợp lệ.")
    if data.get("session_id") is not None:
        try:
            payload_session_id = int(data["session_id"])
        except (TypeError, ValueError):
            return await _error(sid, "invalid_session", "session_id không hợp lệ.")
        if payload_session_id != session_id:
            return await _error(sid, "session_mismatch", "Sai buổi học đang tracking.")
    try:
        following = _strict_bool(data.get("following"), False)
    except ValueError as exc:
        return await _error(sid, "invalid_following", str(exc))

    with SessionLocal() as db:
        participant = db.get(Participant, participant_id)
        session = db.get(Session, session_id)
        if (
            participant is None
            or session is None
            or participant.session_id != session_id
            or not participant.online
            or session.ended_at is not None
        ):
            return await _error(sid, "inactive_session", "Buổi học không còn hoạt động.")
        valid_slide = db.scalar(
            select(Slide.id).where(
                Slide.course_id == session.room.course_id,
                Slide.index == slide_index,
            )
        )
        if valid_slide is None:
            return await _error(sid, "invalid_slide", "Slide không tồn tại trong khoá học.")
        lecturer_slide_index = session.current_slide_index

    snapshot = await tracking.track_student(
        participant_id=participant_id,
        session_id=session_id,
        slide_index=slide_index,
        following_lecturer=following,
        lecturer_slide_index=lecturer_slide_index,
        socket_id=sid,
    )

    with SessionLocal() as db:
        db.add(
            LearningEvent(
                session_id=session_id,
                participant_id=participant_id,
                slide_index=snapshot["slide_index"],
                type="slide_view",
                payload={
                    "following_lecturer": snapshot["following_lecturer"],
                    "lecturer_slide_index": snapshot["lecturer_slide_index"],
                    "out_of_sync": snapshot["out_of_sync"],
                    "mismatch_started_at": snapshot["mismatch_started_at"],
                },
            )
        )
        db.commit()

    payload = {"ok": True, **snapshot}
    await sio.emit("slide_tracking_updated", payload, to=sid)
    return payload


@sio.event
async def leave_session(sid, data):  # noqa: ANN001
    try:
        socket_session = await sio.get_session(sid)
    except KeyError:
        return {"ok": True}
    if not socket_session:
        return {"ok": True}

    session_id = int(socket_session["session_id"])
    role = socket_session.get("role")
    participant_id = socket_session.get("participant_id")
    await sio.leave_room(sid, room(session_id))
    if role == "lecturer":
        await sio.leave_room(sid, lecturer_room(session_id))
    if socket_session.get("tracking_authorized"):
        await sio.leave_room(sid, assistant_room(session_id))
    if participant_id is not None:
        await sio.leave_room(sid, participant_room(participant_id))
    await tracking.detach_socket(sid)
    await sio.save_session(sid, {})
    return {"ok": True}


@sio.event
async def disconnect(sid, reason=None):  # noqa: ANN001
    await tracking.detach_socket(sid)


async def broadcast(session_id: int, event: str, payload: dict) -> None:
    await sio.emit(event, payload, room=room(session_id))


async def to_lecturer(session_id: int, event: str, payload: dict) -> None:
    await sio.emit(event, payload, room=lecturer_room(session_id))


async def to_teaching_team(session_id: int, event: str, payload: dict) -> None:
    """Ping cả kênh giảng viên và dashboard trợ giảng."""
    # Mọi socket giảng viên đã được đưa vào assistant_room khi xác thực.
    # Chỉ emit một lần để cùng một tab không nhận trùng sự kiện.
    await sio.emit(event, payload, room=assistant_room(session_id))


async def lecturer_slide_changed(session_id: int, slide_index: int) -> None:
    await tracking.lecturer_changed(session_id, slide_index)


async def end_session_tracking(session_id: int) -> None:
    await tracking.end_session(session_id)


async def stop_student_tracking(participant_id: int) -> None:
    await tracking.stop_student(participant_id)


async def shutdown() -> None:
    await tracking.close()


def slide_tracking_summary(
    session_id: int, lecturer_slide_index: int | None = None
) -> dict:
    return tracking.session_summary(session_id, lecturer_slide_index)
