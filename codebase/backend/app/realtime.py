"""Socket.IO — đồng bộ slide, câu hỏi và popup advisor theo thời gian thực."""
from __future__ import annotations

import socketio

sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")


def room(session_id: int) -> str:
    return f"session:{session_id}"


def lecturer_room(session_id: int) -> str:
    return f"lecturer:{session_id}"


@sio.event
async def connect(sid, environ, auth):  # noqa: ANN001, D103
    return True


@sio.event
async def join_session(sid, data):  # noqa: ANN001
    """data = {session_id: int, role: 'student'|'lecturer'}"""
    session_id = int(data["session_id"])
    await sio.enter_room(sid, room(session_id))
    if data.get("role") == "lecturer":
        await sio.enter_room(sid, lecturer_room(session_id))
    await sio.emit("joined", {"session_id": session_id}, to=sid)


async def broadcast(session_id: int, event: str, payload: dict) -> None:
    await sio.emit(event, payload, room=room(session_id))


async def to_lecturer(session_id: int, event: str, payload: dict) -> None:
    await sio.emit(event, payload, room=lecturer_room(session_id))
