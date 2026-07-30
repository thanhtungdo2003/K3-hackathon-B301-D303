"""Phòng học và buổi học — chủ phòng tạo, học viên vào bằng mã."""
from __future__ import annotations

import secrets
import string

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from .. import realtime
from ..db import get_db
from ..models import Course, Participant, Room, Session, Slide, User, utcnow
from ..schemas import RoomCreate, RoomOut, SessionOut
from ..security import current_user

router = APIRouter(prefix="/rooms", tags=["rooms"])

# Bỏ các ký tự dễ đọc nhầm: 0/O, 1/I
CODE_ALPHABET = "".join(c for c in string.ascii_uppercase + string.digits if c not in "O0I1")


def generate_code(db: DbSession) -> str:
    for _ in range(40):
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(5))
        if db.scalar(select(Room).where(Room.code == code)) is None:
            return code
    raise HTTPException(status_code=503, detail="Không sinh được mã phòng, thử lại.")


def _owned_room(db: DbSession, room_id: int, user: User) -> Room:
    room = db.get(Room, room_id)
    if room is None or room.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Không tìm thấy phòng.")
    return room


def active_session(db: DbSession, room_id: int) -> Session | None:
    return db.scalar(
        select(Session)
        .where(Session.room_id == room_id, Session.ended_at.is_(None))
        .order_by(Session.started_at.desc())
    )


def _room_out(db: DbSession, room: Room) -> RoomOut:
    live = active_session(db, room.id)
    total = db.scalar(select(func.count(Session.id)).where(Session.room_id == room.id)) or 0
    return RoomOut(
        id=room.id,
        code=room.code,
        name=room.name,
        course_id=room.course_id,
        course_title=room.course.title,
        created_at=room.created_at,
        active_session_id=live.id if live else None,
        total_sessions=total,
    )


def session_out(db: DbSession, session: Session) -> SessionOut:
    room = session.room
    slide_count = (
        db.scalar(select(func.count(Slide.id)).where(Slide.course_id == room.course_id)) or 0
    )
    online = (
        db.scalar(
            select(func.count(Participant.id)).where(
                Participant.session_id == session.id, Participant.online.is_(True)
            )
        )
        or 0
    )
    return SessionOut(
        id=session.id,
        room_id=room.id,
        room_code=room.code,
        room_name=room.name,
        course_id=room.course_id,
        course_title=room.course.title,
        title=session.title,
        started_at=session.started_at,
        ended_at=session.ended_at,
        current_slide_index=session.current_slide_index,
        current_question_id=session.current_question_id,
        slide_count=slide_count,
        online_students=online,
    )


@router.get("", response_model=list[RoomOut])
def list_rooms(db: DbSession = Depends(get_db), user: User = Depends(current_user)) -> list[RoomOut]:
    rooms = db.scalars(
        select(Room).where(Room.owner_id == user.id).order_by(Room.created_at.desc())
    ).all()
    return [_room_out(db, r) for r in rooms]


@router.post("", response_model=RoomOut, status_code=201)
def create_room(
    payload: RoomCreate, db: DbSession = Depends(get_db), user: User = Depends(current_user)
) -> RoomOut:
    course = db.get(Course, payload.course_id)
    if course is None or course.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Không tìm thấy khoá học.")
    if not course.slides:
        raise HTTPException(
            status_code=409, detail="Khoá học chưa có slide. Tải PPTX lên trước khi mở phòng."
        )

    room = Room(
        owner_id=user.id,
        course_id=course.id,
        code=generate_code(db),
        name=payload.name.strip(),
    )
    db.add(room)
    db.commit()
    return _room_out(db, room)


@router.delete("/{room_id}", status_code=204, response_class=Response, response_model=None)
def delete_room(
    room_id: int, db: DbSession = Depends(get_db), user: User = Depends(current_user)
) -> None:
    db.delete(_owned_room(db, room_id, user))
    db.commit()


@router.post("/{room_id}/sessions", response_model=SessionOut, status_code=201)
def start_session(
    room_id: int, db: DbSession = Depends(get_db), user: User = Depends(current_user)
) -> SessionOut:
    """Bắt đầu buổi học. Nếu đang có buổi mở thì trả lại chính buổi đó."""
    room = _owned_room(db, room_id, user)
    live = active_session(db, room.id)
    if live is not None:
        return session_out(db, live)

    session = Session(room_id=room.id, title=room.name)
    db.add(session)
    db.commit()
    return session_out(db, session)


@router.post("/sessions/{session_id}/end", response_model=SessionOut)
async def end_session(
    session_id: int, db: DbSession = Depends(get_db), user: User = Depends(current_user)
) -> SessionOut:
    session = db.get(Session, session_id)
    if session is None or session.room.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Không tìm thấy buổi học.")
    ended_now = session.ended_at is None
    if session.ended_at is None:
        session.ended_at = utcnow()
        session.current_question_id = None
        for p in session.participants:
            p.online = False
        db.commit()
    if ended_now:
        await realtime.end_session_tracking(session_id)
        await realtime.broadcast(
            session_id,
            "session_ended",
            {"session_id": session_id, "slide_index": session.current_slide_index},
        )
    return session_out(db, session)


@router.get("/sessions/{session_id}", response_model=SessionOut)
def get_session(
    session_id: int, db: DbSession = Depends(get_db), user: User = Depends(current_user)
) -> SessionOut:
    session = db.get(Session, session_id)
    if session is None or session.room.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Không tìm thấy buổi học.")
    return session_out(db, session)
