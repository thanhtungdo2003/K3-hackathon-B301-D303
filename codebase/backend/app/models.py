"""Mô hình dữ liệu.

Hai loại người dùng:
  - User      : chủ phòng / giảng viên — CÓ tài khoản (email + mật khẩu).
  - Participant: học viên — KHÔNG có tài khoản, vào phòng bằng mã lớp.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    """Chủ phòng / giảng viên."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(String(120))
    organization: Mapped[str | None] = mapped_column(String(160), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    courses: Mapped[list["Course"]] = relationship(back_populates="owner", cascade="all, delete-orphan")


class Course(Base):
    """Khoá học — chứa các bộ slide và checkpoint."""

    __tablename__ = "courses"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    subject: Mapped[str] = mapped_column(String(120), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)

    owner: Mapped[User] = relationship(back_populates="courses")
    slides: Mapped[list["Slide"]] = relationship(
        back_populates="course", order_by="Slide.index", cascade="all, delete-orphan"
    )
    rooms: Mapped[list["Room"]] = relationship(back_populates="course", cascade="all, delete-orphan")


class Slide(Base):
    """Một trang slide. `blocks` là mô tả để frontend vẽ lên HTML canvas."""

    __tablename__ = "slides"
    __table_args__ = (UniqueConstraint("course_id", "index", name="uq_slide_course_index"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id"), index=True)
    index: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(300), default="")
    blocks: Mapped[list] = mapped_column(JSON, default=list)
    source: Mapped[str] = mapped_column(String(16), default="manual")  # manual | pptx
    notes: Mapped[str] = mapped_column(Text, default="")  # ghi chú của người trình bày, lấy từ PPTX

    course: Mapped[Course] = relationship(back_populates="slides")
    checkpoint: Mapped["Checkpoint | None"] = relationship(
        back_populates="slide", uselist=False, cascade="all, delete-orphan"
    )


class Checkpoint(Base):
    """Điểm dừng gắn vào một slide.

    Giảng viên đặt trước checkpoint; trong lúc dạy, ở Bục Giảng giảng viên bấm
    "Mở câu hỏi" thì câu hỏi của checkpoint mới được phát cho học viên.
    """

    __tablename__ = "checkpoints"

    id: Mapped[int] = mapped_column(primary_key=True)
    slide_id: Mapped[int] = mapped_column(ForeignKey("slides.id"), unique=True, index=True)
    label: Mapped[str] = mapped_column(String(160), default="")
    goal: Mapped[str] = mapped_column(Text, default="")  # điều giảng viên muốn kiểm tra tại đây
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    slide: Mapped[Slide] = relationship(back_populates="checkpoint")
    questions: Mapped[list["Question"]] = relationship(
        back_populates="checkpoint", order_by="Question.position", cascade="all, delete-orphan"
    )


class Question(Base):
    __tablename__ = "questions"

    id: Mapped[int] = mapped_column(primary_key=True)
    checkpoint_id: Mapped[int] = mapped_column(ForeignKey("checkpoints.id"), index=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    # multiple_choice | multiple_select | true_false | ordering | fill_blank | poll
    type: Mapped[str] = mapped_column(String(32))
    prompt: Mapped[str] = mapped_column(Text)
    options: Mapped[list] = mapped_column(JSON, default=list)
    answer: Mapped[dict] = mapped_column(JSON, default=dict)
    origin: Mapped[str] = mapped_column(String(16), default="manual")  # manual | llm

    checkpoint: Mapped[Checkpoint] = relationship(back_populates="questions")


class Room(Base):
    """Phòng học — nơi học viên vào bằng mã."""

    __tablename__ = "rooms"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id"), index=True)
    code: Mapped[str] = mapped_column(String(8), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    course: Mapped[Course] = relationship(back_populates="rooms")
    sessions: Mapped[list["Session"]] = relationship(back_populates="room", cascade="all, delete-orphan")


class Session(Base):
    """Một buổi học đang chạy trong phòng."""

    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    room_id: Mapped[int] = mapped_column(ForeignKey("rooms.id"), index=True)
    title: Mapped[str] = mapped_column(String(200), default="")
    started_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    current_slide_index: Mapped[int] = mapped_column(Integer, default=0)
    current_question_id: Mapped[int | None] = mapped_column(ForeignKey("questions.id"), nullable=True)

    room: Mapped[Room] = relationship(back_populates="sessions")
    participants: Mapped[list["Participant"]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )


class Participant(Base):
    """Học viên — vào bằng mã phòng, không tài khoản, không email."""

    __tablename__ = "participants"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id"), index=True)
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(60))
    avatar: Mapped[str] = mapped_column(String(16), default="paw")
    joined_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    online: Mapped[bool] = mapped_column(Boolean, default=True)

    session: Mapped[Session] = relationship(back_populates="participants")


class Answer(Base):
    __tablename__ = "answers"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id"), index=True)
    participant_id: Mapped[int] = mapped_column(ForeignKey("participants.id"))
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id"), index=True)
    slide_index: Mapped[int] = mapped_column(Integer, default=0)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    correct: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    score: Mapped[float] = mapped_column(Float, default=0.0)
    response_ms: Mapped[int] = mapped_column(Integer, default=0)
    skipped: Mapped[bool] = mapped_column(Boolean, default=False)
    confidence: Mapped[int] = mapped_column(Integer, default=0)  # 0 = không khai, 1..3
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class LearningEvent(Base):
    __tablename__ = "learning_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id"), index=True)
    participant_id: Mapped[int | None] = mapped_column(ForeignKey("participants.id"), nullable=True)
    slide_index: Mapped[int] = mapped_column(Integer, default=0)
    type: Mapped[str] = mapped_column(String(32))
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Advice(Base):
    """Trace mỗi lượt Teaching Advisor chạy."""

    __tablename__ = "advices"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id"), index=True)
    slide_index: Mapped[int] = mapped_column(Integer, default=0)
    state: Mapped[str] = mapped_column(String(32))
    should_alert: Mapped[bool] = mapped_column(Boolean, default=False)
    headline: Mapped[str] = mapped_column(String(200), default="")
    action: Mapped[str] = mapped_column(Text, default="")
    evidence: Mapped[list] = mapped_column(JSON, default=list)
    confidence: Mapped[str] = mapped_column(String(16), default="low")
    source: Mapped[str] = mapped_column(String(24), default="rule_fallback")  # ai | rule_fallback | abstain
    metrics: Mapped[dict] = mapped_column(JSON, default=dict)
    raw: Mapped[dict] = mapped_column(JSON, default=dict)
    feedback: Mapped[str | None] = mapped_column(String(16), nullable=True)
    feedback_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class StudentHint(Base):
    """Gợi ý câu hỏi LLM sinh cho học viên đang bí (không phải đáp án)."""

    __tablename__ = "student_hints"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id"), index=True)
    participant_id: Mapped[int] = mapped_column(ForeignKey("participants.id"), index=True)
    slide_index: Mapped[int] = mapped_column(Integer, default=0)
    questions: Mapped[list] = mapped_column(JSON, default=list)
    source: Mapped[str] = mapped_column(String(16), default="rule_fallback")  # llm | rule_fallback
    picked: Mapped[str | None] = mapped_column(Text, nullable=True)  # câu học viên chọn gửi lên
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class SupportQuestion(Base):
    """Câu hỏi tự do của học viên và vòng đời hỗ trợ người thật/AI."""

    __tablename__ = "support_questions"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id"), index=True)
    participant_id: Mapped[int] = mapped_column(ForeignKey("participants.id"), index=True)
    slide_index: Mapped[int] = mapped_column(Integer, default=0)
    text: Mapped[str] = mapped_column(Text)
    confusion_score: Mapped[float] = mapped_column(Float, default=0.0)
    classifier_source: Mapped[str] = mapped_column(String(24), default="rule_fallback")
    escalated: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(24), default="pending")  # pending | answered
    answer_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    answered_by: Mapped[str | None] = mapped_column(String(24), nullable=True)  # lecturer | assistant | ai
    answer_disclaimer: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    answered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
