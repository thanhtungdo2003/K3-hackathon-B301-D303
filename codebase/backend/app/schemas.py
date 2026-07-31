"""Pydantic schema cho REST API."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, EmailStr, Field

QuestionType = Literal[
    "multiple_choice", "multiple_select", "true_false", "ordering", "fill_blank", "poll"
]


# ── Auth ────────────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str = Field(min_length=1, max_length=120)
    organization: str | None = Field(default=None, max_length=160)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: int
    email: str
    full_name: str
    organization: str | None


class AuthResponse(BaseModel):
    token: str
    user: UserOut


# ── Khoá học ────────────────────────────────────────────────────────────────

class CourseCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    subject: str = Field(default="", max_length=120)
    description: str = Field(default="", max_length=2000)


class CourseUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    subject: str | None = Field(default=None, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    archived: bool | None = None


class CourseOut(BaseModel):
    id: int
    title: str
    subject: str
    description: str
    archived: bool
    created_at: datetime
    slide_count: int
    checkpoint_count: int
    question_count: int
    room_count: int


# ── Slide ───────────────────────────────────────────────────────────────────

class SlideOut(BaseModel):
    id: int
    index: int
    title: str
    blocks: list[dict[str, Any]]
    notes: str
    source: str
    checkpoint_id: int | None
    question_count: int


class SlideCreate(BaseModel):
    title: str = Field(default="", max_length=300)
    blocks: list[dict[str, Any]] = Field(default_factory=list)
    notes: str = Field(default="", max_length=2000)


class SlideUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=300)
    blocks: list[dict[str, Any]] | None = None
    notes: str | None = Field(default=None, max_length=2000)


# ── Checkpoint & câu hỏi ────────────────────────────────────────────────────

class CheckpointCreate(BaseModel):
    label: str = Field(default="", max_length=160)
    goal: str = Field(default="", max_length=1000)


class CheckpointUpdate(BaseModel):
    label: str | None = Field(default=None, max_length=160)
    goal: str | None = Field(default=None, max_length=1000)
    active: bool | None = None


class QuestionIn(BaseModel):
    type: QuestionType
    prompt: str = Field(min_length=1, max_length=600)
    options: list[str] = Field(default_factory=list)
    answer: dict[str, Any] = Field(default_factory=dict)
    origin: Literal["manual", "llm"] = "manual"


class QuestionOut(BaseModel):
    id: int
    position: int
    type: str
    prompt: str
    options: list[Any]
    answer: dict[str, Any]
    origin: str


class CheckpointOut(BaseModel):
    id: int
    slide_id: int
    slide_index: int
    label: str
    goal: str
    active: bool
    questions: list[QuestionOut]


class DraftRequest(BaseModel):
    count: int = Field(default=3, ge=1, le=5)


class DraftResponse(BaseModel):
    questions: list[QuestionIn]
    source: Literal["llm", "unavailable"]
    note: str = ""


# ── Phòng & buổi học ────────────────────────────────────────────────────────

class RoomCreate(BaseModel):
    course_id: int
    name: str = Field(min_length=1, max_length=200)


class RoomOut(BaseModel):
    id: int
    code: str
    name: str
    course_id: int
    course_title: str
    created_at: datetime
    active_session_id: int | None
    total_sessions: int


class SessionOut(BaseModel):
    id: int
    room_id: int
    room_code: str
    room_name: str
    course_id: int
    course_title: str
    title: str
    started_at: datetime
    ended_at: datetime | None
    current_slide_index: int
    current_question_id: int | None
    slide_count: int
    online_students: int


# ── Học viên (không tài khoản) ──────────────────────────────────────────────

class JoinRequest(BaseModel):
    code: str = Field(min_length=4, max_length=8)
    display_name: str = Field(min_length=1, max_length=40)
    avatar: str = Field(default="paw", max_length=16, pattern=r"^[a-z]+$")


class JoinResponse(BaseModel):
    token: str
    participant_id: int
    session_id: int
    room_name: str
    course_title: str
    lecturer_name: str
    display_name: str
    avatar: str
    slide_count: int
    current_slide_index: int


class StudentQuestionOut(BaseModel):
    id: int
    slide_index: int
    type: str
    prompt: str
    options: list[Any]


class AnswerRequest(BaseModel):
    token: str
    question_id: int
    value: Any = None
    response_ms: int = 0
    skipped: bool = False
    confidence: Literal[0, 1, 2, 3] = 0


class AnswerResponse(BaseModel):
    correct: bool | None
    score: float
    explanation: str | None = None


class EventRequest(BaseModel):
    token: str
    type: Literal["raise_hand", "return_slide", "follow_lecturer", "unfollow", "ask_question"]
    slide_index: int = 0
    payload: dict[str, Any] = Field(default_factory=dict)


class HintRequest(BaseModel):
    token: str
    slide_index: int = 0


class HintResponse(BaseModel):
    id: int
    questions: list[str]
    source: str
    note: str = ""
    guard_flags: list[str] = Field(default_factory=list)


class HintPickRequest(BaseModel):
    token: str
    question: str = Field(min_length=1, max_length=300)


class SupportQuestionCreate(BaseModel):
    token: str
    slide_index: int = Field(ge=0)
    text: str = Field(min_length=1, max_length=600)


class SupportAnswerRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    answered_by: Literal["lecturer", "assistant"] = "lecturer"


class SupportQuestionOut(BaseModel):
    id: int
    slide_index: int
    text: str
    confusion_score: float
    confusion_threshold: float = 0.60
    escalated: bool
    status: Literal["pending", "answered"]
    answer_text: str | None = None
    answered_by: Literal["lecturer", "assistant", "ai"] | None = None
    answer_disclaimer: str | None = None
    created_at: datetime
    answered_at: datetime | None = None


class AiSupportRequest(BaseModel):
    token: str
    slide_index: int = Field(ge=0)
    message: str = Field(default="", max_length=600)


class AiSupportResponse(BaseModel):
    summary: str
    answer: str
    confusion_score: float
    confusion_threshold: float = 0.60
    escalated: bool
    support_question: SupportQuestionOut | None = None
    disclaimer: str


# ── Dữ liệu cho giao diện Trợ giảng (chỉ aggregate/ẩn danh) ─────────────────

class CountRateOut(BaseModel):
    count: int
    rate: float


class AssistantPulseOut(BaseModel):
    total_students: int
    classified_students: int
    on_track: CountRateOut
    needs_follow_up: CountRateOut
    struggling: CountRateOut
    unclassified: CountRateOut
    rule_version: str
    rules: dict[str, str]


class ConceptEvidenceOut(BaseModel):
    online_students: int
    responded: int
    graded_answers: int
    wrong_rate: float
    skip_rate: float
    low_confidence_rate: float
    return_visits: int
    questions_asked: int


class AssistantConceptOut(BaseModel):
    slide_index: int
    title: str
    source: Literal["slide_title"]
    understanding: float | None
    status: Literal["green", "yellow", "red", "insufficient_data"]
    state: str
    state_label: str
    severity: int
    trusted: bool
    sample_note: str
    evidence: ConceptEvidenceOut


class AssistantAdviceOut(BaseModel):
    id: int
    slide_index: int
    headline: str
    action: str
    evidence: list[Any]
    confidence: str
    source: str
    created_at: datetime


class AssistantDiagnosticOut(BaseModel):
    slide_index: int
    state: str
    state_label: str
    severity: int
    reasons: list[str]
    trusted: bool
    sample_note: str
    latest_advice: AssistantAdviceOut | None


class AssistantSupportItemOut(BaseModel):
    key: str
    type: Literal["raise_hand", "ask_question"]
    question_id: int | None = None
    slide_index: int
    text: str
    confusion_score: float | None = None
    escalated: bool = False
    status: Literal["pending", "answered"] | None = None
    answer_text: str | None = None
    answered_by: Literal["lecturer", "assistant", "ai"] | None = None
    answer_disclaimer: str | None = None
    created_at: datetime
    age_seconds: int


class SlideTrackingAggregateOut(BaseModel):
    session_id: int
    lecturer_slide_index: int
    timeout_seconds: int
    online_students: int
    tracked_students: int
    connected_students: int
    aligned_students: int
    out_of_sync_students: int
    unknown_students: int
    tracking_coverage: float
    auto_synced_total: int


class AssistantSessionOut(BaseModel):
    id: int
    title: str
    course_title: str
    current_slide_index: int
    ended: bool


class AssistantPrivacyOut(BaseModel):
    identity_fields_omitted: bool
    free_text_may_contain_self_identification: bool
    note: str


class AssistantDashboardOut(BaseModel):
    session: AssistantSessionOut
    generated_at: datetime
    pulse: AssistantPulseOut
    concepts: list[AssistantConceptOut]
    hot_concepts: list[AssistantConceptOut]
    diagnostic: AssistantDiagnosticOut
    support_queue: list[AssistantSupportItemOut]
    slide_sync: SlideTrackingAggregateOut
    privacy: AssistantPrivacyOut


# ── Điều khiển buổi học ─────────────────────────────────────────────────────

class SlideChangeRequest(BaseModel):
    slide_index: int = Field(ge=0)


class TriggerQuestionRequest(BaseModel):
    question_id: int | None = None


class AdviceRequest(BaseModel):
    slide_index: int | None = None
    lecturer_request: str | None = Field(default=None, max_length=500)


class FeedbackRequest(BaseModel):
    feedback: Literal["up", "down", "dismissed", "applied"]
    note: str | None = Field(default=None, max_length=500)


# ── Trợ lý AI của dashboard ─────────────────────────────────────────────────

class AssistantMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=4000)


class AssistantRequest(BaseModel):
    messages: list[AssistantMessage] = Field(min_length=1, max_length=40)


class ToolCallOut(BaseModel):
    tool: str
    label: str
    args: dict[str, Any] = Field(default_factory=dict)
    ok: bool = True
    error: str = ""
    result: dict[str, Any] = Field(default_factory=dict)


class AssistantResponse(BaseModel):
    reply: str
    calls: list[ToolCallOut] = Field(default_factory=list)
    source: Literal["llm", "rule_fallback", "unavailable"]
    changed: bool = False
    trace_id: str | None = None
