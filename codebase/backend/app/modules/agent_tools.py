"""Bộ công cụ (tool) mà trợ lý AI được phép gọi trên tài khoản của chính người dùng.

Nguyên tắc:
- Mọi tool đều bị khoá theo `user` đang đăng nhập — LLM không cách nào chạm dữ liệu người khác.
- KHÔNG có tool xoá. Việc xoá khoá học / phòng / câu hỏi vẫn phải làm bằng tay trên giao diện.
- Tool trả về dict gọn, đủ để LLM nói lại cho người dùng và để giao diện làm mới đúng khu vực.
"""
from __future__ import annotations

import secrets
import string
from typing import Any, Callable

from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from ..models import (
    Answer,
    Checkpoint,
    Course,
    Participant,
    Question,
    Room,
    Session,
    Slide,
    User,
)
from . import llm
from .slide_import import slide_plain_text

CODE_ALPHABET = "".join(c for c in string.ascii_uppercase + string.digits if c not in "O0I1")


class ToolError(Exception):
    """Lỗi nghiệp vụ — trả thẳng cho LLM để nó nói lại cho người dùng, không phải lỗi hệ thống."""


# ── Tiện ích ────────────────────────────────────────────────────────────────

def _course(db: DbSession, user: User, course_id: int) -> Course:
    row = db.get(Course, int(course_id))
    if row is None or row.owner_id != user.id:
        raise ToolError(f"Không có khoá học id={course_id} trong tài khoản này.")
    return row


def _room(db: DbSession, user: User, room_id: int) -> Room:
    row = db.get(Room, int(room_id))
    if row is None or row.owner_id != user.id:
        raise ToolError(f"Không có phòng học id={room_id} trong tài khoản này.")
    return row


def _find_course_by_name(db: DbSession, user: User, name: str) -> Course:
    """Cho LLM gọi tên khoá học thay vì id — nó thường không nhớ id."""
    needle = (name or "").strip().lower()
    if not needle:
        raise ToolError("Cần nêu tên hoặc id khoá học.")
    rows = db.scalars(select(Course).where(Course.owner_id == user.id)).all()
    exact = [c for c in rows if c.title.lower() == needle]
    if exact:
        return exact[0]
    partial = [c for c in rows if needle in c.title.lower()]
    if len(partial) == 1:
        return partial[0]
    if len(partial) > 1:
        names = ", ".join(f"{c.id}:{c.title}" for c in partial[:5])
        raise ToolError(f"Tên khớp nhiều khoá học, hỏi lại người dùng chọn cái nào: {names}")
    raise ToolError(f"Không tìm thấy khoá học tên gần giống '{name}'.")


def _resolve_course(db: DbSession, user: User, args: dict) -> Course:
    if args.get("course_id"):
        return _course(db, user, args["course_id"])
    return _find_course_by_name(db, user, str(args.get("course_title") or ""))


def _generate_code(db: DbSession) -> str:
    for _ in range(40):
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(5))
        if db.scalar(select(Room).where(Room.code == code)) is None:
            return code
    raise ToolError("Không sinh được mã phòng, thử lại sau.")


def _rate(a: int, b: int) -> float:
    return round(a / b, 3) if b else 0.0


# ── Cài đặt từng tool ───────────────────────────────────────────────────────

def list_courses(db: DbSession, user: User, args: dict) -> dict:
    rows = db.scalars(
        select(Course).where(Course.owner_id == user.id).order_by(Course.created_at.desc())
    ).all()
    return {
        "courses": [
            {
                "id": c.id,
                "title": c.title,
                "subject": c.subject,
                "slides": len(c.slides),
                "checkpoints": len([s for s in c.slides if s.checkpoint]),
                "rooms": len(c.rooms),
            }
            for c in rows
        ]
    }


def create_course(db: DbSession, user: User, args: dict) -> dict:
    title = str(args.get("title") or "").strip()
    if len(title) < 2:
        raise ToolError("Tên khoá học phải có ít nhất 2 ký tự. Hỏi người dùng muốn đặt tên gì.")
    course = Course(
        owner_id=user.id,
        title=title[:160],
        subject=str(args.get("subject") or "").strip()[:80],
        description=str(args.get("description") or "").strip()[:2000],
    )
    db.add(course)
    db.commit()
    return {
        "created": True,
        "course_id": course.id,
        "title": course.title,
        "subject": course.subject,
        "next_step": "Khoá học chưa có slide. Nhắc giảng viên vào trang Khoá học bấm Tải PPTX lên — trợ lý không tải file thay được.",
    }


def update_course(db: DbSession, user: User, args: dict) -> dict:
    course = _resolve_course(db, user, args)
    changed = []
    if args.get("title"):
        course.title = str(args["title"]).strip()[:160]
        changed.append("title")
    if args.get("subject") is not None:
        course.subject = str(args["subject"]).strip()[:80]
        changed.append("subject")
    if args.get("description") is not None:
        course.description = str(args["description"]).strip()[:2000]
        changed.append("description")
    if not changed:
        raise ToolError("Không có trường nào để sửa.")
    db.commit()
    return {"updated": changed, "course_id": course.id, "title": course.title}


def list_slides(db: DbSession, user: User, args: dict) -> dict:
    course = _resolve_course(db, user, args)
    return {
        "course_id": course.id,
        "course_title": course.title,
        "slides": [
            {
                "index": s.index,
                "number": s.index + 1,
                "title": s.title,
                "has_checkpoint": s.checkpoint is not None,
                "questions": len(s.checkpoint.questions) if s.checkpoint else 0,
                "preview": slide_plain_text(s)[:220],
            }
            for s in course.slides
        ],
    }


def create_checkpoint(db: DbSession, user: User, args: dict) -> dict:
    course = _resolve_course(db, user, args)
    number = args.get("slide_number")
    if number is None:
        raise ToolError("Cần biết đặt checkpoint ở slide số mấy.")
    index = int(number) - 1
    slide = next((s for s in course.slides if s.index == index), None)
    if slide is None:
        raise ToolError(
            f"Khoá '{course.title}' chỉ có {len(course.slides)} slide, không có slide số {number}."
        )
    if slide.checkpoint is not None:
        return {
            "created": False,
            "reason": "Slide này đã có checkpoint.",
            "checkpoint_id": slide.checkpoint.id,
            "questions": len(slide.checkpoint.questions),
        }
    cp = Checkpoint(
        slide_id=slide.id,
        label=str(args.get("label") or f"Checkpoint slide {slide.index + 1}").strip()[:160],
        goal=str(args.get("goal") or "").strip()[:1000],
    )
    db.add(cp)
    db.commit()
    return {
        "created": True,
        "checkpoint_id": cp.id,
        "course_id": course.id,
        "slide_number": slide.index + 1,
        "slide_title": slide.title,
        "label": cp.label,
    }


def draft_questions(db: DbSession, user: User, args: dict) -> dict:
    cp = db.get(Checkpoint, int(args.get("checkpoint_id") or 0))
    if cp is None or cp.slide.course.owner_id != user.id:
        raise ToolError("Không tìm thấy checkpoint đó.")
    count = max(1, min(int(args.get("count") or 2), 5))
    result = llm.draft_checkpoint_questions(
        cp.slide.title, slide_plain_text(cp.slide), cp.goal, count
    )
    if result is None:
        raise ToolError("Lúc này không soạn nháp được câu hỏi. Người dùng có thể tự soạn tay.")

    saved = []
    position = len(cp.questions)
    for q in result["questions"]:
        row = Question(
            checkpoint_id=cp.id,
            position=position,
            type=q["type"],
            prompt=q["prompt"],
            options=q["options"],
            answer=q["answer"],
            origin="llm",
        )
        db.add(row)
        position += 1
        saved.append({"type": q["type"], "prompt": q["prompt"]})
    db.commit()
    return {
        "checkpoint_id": cp.id,
        "slide_number": cp.slide.index + 1,
        "saved": saved,
        "note": result.get("note", ""),
        "reminder": "Câu hỏi đã lưu dạng nháp. Nhắc giảng viên vào trang Khoá học duyệt lại trước khi dạy.",
    }


def list_rooms(db: DbSession, user: User, args: dict) -> dict:
    rows = db.scalars(
        select(Room).where(Room.owner_id == user.id).order_by(Room.created_at.desc())
    ).all()
    out = []
    for r in rows:
        live = db.scalar(
            select(Session)
            .where(Session.room_id == r.id, Session.ended_at.is_(None))
            .order_by(Session.started_at.desc())
        )
        out.append(
            {
                "id": r.id,
                "name": r.name,
                "code": r.code,
                "course_title": r.course.title,
                "live_session_id": live.id if live else None,
            }
        )
    return {"rooms": out}


def create_room(db: DbSession, user: User, args: dict) -> dict:
    course = _resolve_course(db, user, args)
    if not course.slides:
        raise ToolError(
            f"Khoá '{course.title}' chưa có slide nên chưa mở phòng được. "
            "Cần tải file .pptx lên trước."
        )
    name = str(args.get("name") or "").strip() or f"Phòng {course.title}"
    room = Room(owner_id=user.id, course_id=course.id, code=_generate_code(db), name=name[:120])
    db.add(room)
    db.commit()
    return {
        "created": True,
        "room_id": room.id,
        "name": room.name,
        "code": room.code,
        "course_title": course.title,
        "next_step": "Đọc mã này cho học viên. Nếu giảng viên muốn dạy ngay thì bắt đầu buổi học.",
    }


def _resolve_room(db: DbSession, user: User, args: dict) -> Room:
    """Nhận id, mã phòng hoặc tên phòng — LLM hay đoán sai id nên cho nó nhiều đường vào."""
    rooms = db.scalars(select(Room).where(Room.owner_id == user.id)).all()

    if args.get("room_id"):
        hit = next((r for r in rooms if r.id == int(args["room_id"])), None)
        if hit is not None:
            return hit
        # Không quy trách nhiệm cho người dùng: kể ra phòng thật để LLM tự sửa.
        available = ", ".join(f"{r.id}:{r.name} (mã {r.code})" for r in rooms) or "chưa có phòng nào"
        raise ToolError(
            f"Không có phòng id={args['room_id']}. Phòng thật của tài khoản này: {available}."
        )

    code = str(args.get("room_code") or "").strip().upper()
    if code:
        hit = next((r for r in rooms if r.code == code), None)
        if hit is not None:
            return hit
        raise ToolError(f"Không có phòng nào mã {code}.")

    name = str(args.get("room_name") or "").strip().lower()
    if name:
        partial = [r for r in rooms if name in r.name.lower()]
        if len(partial) == 1:
            return partial[0]
        if len(partial) > 1:
            raise ToolError(
                "Tên khớp nhiều phòng, hỏi lại người dùng: "
                + ", ".join(f"{r.name} (mã {r.code})" for r in partial[:5])
            )
        raise ToolError(f"Không có phòng nào tên gần giống '{args.get('room_name')}'.")

    raise ToolError("Cần nêu id, mã phòng hoặc tên phòng.")


def start_session(db: DbSession, user: User, args: dict) -> dict:
    room = _resolve_room(db, user, args)
    live = db.scalar(
        select(Session)
        .where(Session.room_id == room.id, Session.ended_at.is_(None))
        .order_by(Session.started_at.desc())
    )
    if live is not None:
        return {
            "started": False,
            "reason": "Phòng này đang có buổi mở sẵn.",
            "session_id": live.id,
            "room_code": room.code,
        }
    session = Session(room_id=room.id, title=room.name)
    db.add(session)
    db.commit()
    return {
        "started": True,
        "session_id": session.id,
        "room_code": room.code,
        "next_step": "Nhắc giảng viên mở Bục Giảng của buổi này.",
    }


def get_overview(db: DbSession, user: User, args: dict) -> dict:
    course_ids = list(db.scalars(select(Course.id).where(Course.owner_id == user.id)).all())
    room_ids = list(db.scalars(select(Room.id).where(Room.owner_id == user.id)).all())
    sessions = (
        db.scalars(select(Session).where(Session.room_id.in_(room_ids))).all() if room_ids else []
    )
    session_ids = [s.id for s in sessions]
    answers = (
        db.scalars(select(Answer).where(Answer.session_id.in_(session_ids))).all()
        if session_ids
        else []
    )
    graded = [a for a in answers if a.correct is not None and not a.skipped]
    return {
        "courses": len(course_ids),
        "rooms": len(room_ids),
        "sessions": len(session_ids),
        "live_sessions": len([s for s in sessions if s.ended_at is None]),
        "slides": (
            db.scalar(select(func.count(Slide.id)).where(Slide.course_id.in_(course_ids))) or 0
            if course_ids
            else 0
        ),
        "participants": (
            db.scalar(
                select(func.count(Participant.id)).where(Participant.session_id.in_(session_ids))
            )
            or 0
            if session_ids
            else 0
        ),
        "answers": len(answers),
        "correct_rate": _rate(len([a for a in graded if a.correct]), len(graded)),
    }


def course_quality(db: DbSession, user: User, args: dict) -> dict:
    """Slide nào đang gây khó nhất — dùng số liệu thật của các buổi đã dạy."""
    course = _resolve_course(db, user, args)
    room_ids = [r.id for r in course.rooms]
    session_ids = (
        list(db.scalars(select(Session.id).where(Session.room_id.in_(room_ids))).all())
        if room_ids
        else []
    )
    if not session_ids:
        return {
            "course_id": course.id,
            "course_title": course.title,
            "sessions": 0,
            "note": "Khoá này chưa dạy buổi nào nên chưa có số liệu chất lượng.",
            "slides": [],
        }
    answers = db.scalars(select(Answer).where(Answer.session_id.in_(session_ids))).all()
    rows = []
    for slide in course.slides:
        a = [x for x in answers if x.slide_index == slide.index]
        graded = [x for x in a if x.correct is not None and not x.skipped]
        if not a:
            continue
        rows.append(
            {
                "slide_number": slide.index + 1,
                "title": slide.title,
                "answers": len(a),
                "correct_rate": _rate(len([x for x in graded if x.correct]), len(graded)),
                "skip_rate": _rate(len([x for x in a if x.skipped]), len(a)),
            }
        )
    rows.sort(key=lambda r: r["correct_rate"])
    out = {
        "course_id": course.id,
        "course_title": course.title,
        "sessions": len(session_ids),
        "slides": rows[:8],
    }
    if not rows:
        out["note"] = "Đã có buổi học nhưng chưa slide nào thu được câu trả lời, nên chưa xếp hạng được."
    return out


# ── Khai báo schema cho Groq ────────────────────────────────────────────────

COURSE_REF = {
    "course_id": {"type": "integer", "description": "Id khoá học nếu đã biết."},
    "course_title": {
        "type": "string",
        "description": "Tên khoá học, dùng khi chưa biết id. Khớp gần đúng cũng được.",
    },
}


def _fn(name: str, description: str, properties: dict, required: list[str] | None = None) -> dict:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {
                "type": "object",
                "properties": properties,
                "required": required or [],
            },
        },
    }


TOOL_SCHEMAS: list[dict] = [
    _fn("get_overview", "Số tổng quan của tài khoản: bao nhiêu khoá học, phòng, buổi đã dạy, tỉ lệ đúng.", {}),
    _fn("list_courses", "Liệt kê các khoá học của người dùng kèm id, số slide, số checkpoint.", {}),
    _fn(
        "create_course",
        "Tạo khoá học mới. Chỉ gọi khi đã biết tên khoá học người dùng muốn.",
        {
            "title": {"type": "string", "description": "Tên khoá học."},
            "subject": {"type": "string", "description": "Môn hoặc lĩnh vực, ví dụ 'Trí tuệ nhân tạo'."},
            "description": {"type": "string", "description": "Mô tả ngắn về khoá học."},
        },
        ["title"],
    ),
    _fn(
        "update_course",
        "Sửa tên, môn hoặc mô tả của một khoá học đã có.",
        COURSE_REF
        | {
            "title": {"type": "string"},
            "subject": {"type": "string"},
            "description": {"type": "string"},
        },
    ),
    _fn(
        "list_slides",
        "Xem danh sách slide của một khoá học kèm số thứ tự, tiêu đề và trích đoạn nội dung.",
        COURSE_REF,
    ),
    _fn(
        "create_checkpoint",
        "Đặt checkpoint tại một slide để sau này mở câu hỏi cho lớp.",
        COURSE_REF
        | {
            "slide_number": {"type": "integer", "description": "Slide số mấy, đếm từ 1."},
            "label": {"type": "string", "description": "Tên checkpoint."},
            "goal": {"type": "string", "description": "Muốn kiểm tra điều gì tại đây."},
        },
        ["slide_number"],
    ),
    _fn(
        "draft_questions",
        "Soạn nháp câu hỏi cho một checkpoint từ nội dung slide và lưu lại dạng nháp.",
        {
            "checkpoint_id": {"type": "integer"},
            "count": {"type": "integer", "description": "Số câu, 1 đến 5."},
        },
        ["checkpoint_id"],
    ),
    _fn("list_rooms", "Liệt kê phòng học kèm mã lớp và buổi đang mở.", {}),
    _fn(
        "create_room",
        "Tạo phòng học cho một khoá học. Khoá học phải đã có slide.",
        COURSE_REF | {"name": {"type": "string", "description": "Tên phòng, ví dụ 'Lớp ML sáng thứ 3'."}},
    ),
    _fn(
        "start_session",
        "Bắt đầu buổi học trong một phòng để học viên vào được. "
        "Nêu một trong ba: room_id, room_code hoặc room_name. Đừng đoán id.",
        {
            "room_id": {"type": "integer", "description": "Chỉ dùng khi id lấy được từ kết quả tool trước."},
            "room_code": {"type": "string", "description": "Mã phòng 5 ký tự, ví dụ 'GNN7X'."},
            "room_name": {"type": "string", "description": "Tên phòng, khớp gần đúng cũng được."},
        },
    ),
    _fn(
        "course_quality",
        "Xem slide nào của khoá học đang gây khó nhất, dựa trên các buổi đã dạy.",
        COURSE_REF,
    ),
]

EXECUTORS: dict[str, Callable[[DbSession, User, dict], Any]] = {
    "get_overview": get_overview,
    "list_courses": list_courses,
    "create_course": create_course,
    "update_course": update_course,
    "list_slides": list_slides,
    "create_checkpoint": create_checkpoint,
    "draft_questions": draft_questions,
    "list_rooms": list_rooms,
    "create_room": create_room,
    "start_session": start_session,
    "course_quality": course_quality,
}

# Tool nào làm thay đổi dữ liệu — giao diện dựa vào đây để biết cần nạp lại chỗ nào.
MUTATING = {
    "create_course",
    "update_course",
    "create_checkpoint",
    "draft_questions",
    "create_room",
    "start_session",
}
