"""Khoá học, slide (kể cả nhập từ PPTX) và checkpoint."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from ..config import get_settings
from ..db import get_db
from ..models import Checkpoint, Course, Question, Room, Slide, User
from ..modules import llm
from ..modules.slide_import import parse_pptx, parse_pdf, slide_plain_text
from ..schemas import (
    CheckpointCreate,
    CheckpointOut,
    CheckpointUpdate,
    CourseCreate,
    CourseOut,
    CourseUpdate,
    DraftRequest,
    DraftResponse,
    QuestionIn,
    QuestionOut,
    SlideCreate,
    SlideOut,
    SlideUpdate,
)
from ..security import current_user

settings = get_settings()
router = APIRouter(prefix="/courses", tags=["courses"])

MAX_UPLOAD_BYTES = 40 * 1024 * 1024


# ── Tiện ích ────────────────────────────────────────────────────────────────

def _owned_course(db: DbSession, course_id: int, user: User) -> Course:
    course = db.get(Course, course_id)
    if course is None or course.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Không tìm thấy khoá học.")
    return course


def _owned_slide(db: DbSession, slide_id: int, user: User) -> Slide:
    slide = db.get(Slide, slide_id)
    if slide is None or slide.course.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Không tìm thấy slide.")
    return slide


def _course_out(db: DbSession, course: Course) -> CourseOut:
    slide_ids = [s.id for s in course.slides]
    checkpoints = (
        db.scalars(select(Checkpoint).where(Checkpoint.slide_id.in_(slide_ids))).all()
        if slide_ids
        else []
    )
    question_count = (
        db.scalar(
            select(func.count(Question.id)).where(
                Question.checkpoint_id.in_([c.id for c in checkpoints])
            )
        )
        or 0
        if checkpoints
        else 0
    )
    room_count = db.scalar(select(func.count(Room.id)).where(Room.course_id == course.id)) or 0
    return CourseOut(
        id=course.id,
        title=course.title,
        subject=course.subject,
        description=course.description,
        archived=course.archived,
        created_at=course.created_at,
        slide_count=len(slide_ids),
        checkpoint_count=len(checkpoints),
        question_count=question_count,
        room_count=room_count,
    )


def _slide_out(slide: Slide) -> SlideOut:
    cp = slide.checkpoint
    return SlideOut(
        id=slide.id,
        index=slide.index,
        title=slide.title,
        blocks=slide.blocks or [],
        notes=slide.notes,
        source=slide.source,
        checkpoint_id=cp.id if cp else None,
        question_count=len(cp.questions) if cp else 0,
    )


def _checkpoint_out(cp: Checkpoint) -> CheckpointOut:
    return CheckpointOut(
        id=cp.id,
        slide_id=cp.slide_id,
        slide_index=cp.slide.index,
        label=cp.label,
        goal=cp.goal,
        active=cp.active,
        questions=[
            QuestionOut(
                id=q.id,
                position=q.position,
                type=q.type,
                prompt=q.prompt,
                options=q.options,
                answer=q.answer,
                origin=q.origin,
            )
            for q in cp.questions
        ],
    )


# ── Khoá học ────────────────────────────────────────────────────────────────

@router.get("", response_model=list[CourseOut])
def list_courses(
    include_archived: bool = False,
    db: DbSession = Depends(get_db),
    user: User = Depends(current_user),
) -> list[CourseOut]:
    stmt = select(Course).where(Course.owner_id == user.id)
    if not include_archived:
        stmt = stmt.where(Course.archived.is_(False))
    return [_course_out(db, c) for c in db.scalars(stmt.order_by(Course.created_at.desc())).all()]


@router.post("", response_model=CourseOut, status_code=201)
def create_course(
    payload: CourseCreate, db: DbSession = Depends(get_db), user: User = Depends(current_user)
) -> CourseOut:
    course = Course(
        owner_id=user.id,
        title=payload.title.strip(),
        subject=payload.subject.strip(),
        description=payload.description.strip(),
    )
    db.add(course)
    db.commit()
    return _course_out(db, course)


@router.get("/{course_id}", response_model=CourseOut)
def get_course(
    course_id: int, db: DbSession = Depends(get_db), user: User = Depends(current_user)
) -> CourseOut:
    return _course_out(db, _owned_course(db, course_id, user))


@router.patch("/{course_id}", response_model=CourseOut)
def update_course(
    course_id: int,
    payload: CourseUpdate,
    db: DbSession = Depends(get_db),
    user: User = Depends(current_user),
) -> CourseOut:
    course = _owned_course(db, course_id, user)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(course, field, value.strip() if isinstance(value, str) else value)
    db.commit()
    return _course_out(db, course)


@router.delete("/{course_id}", status_code=204, response_class=Response, response_model=None)
def delete_course(
    course_id: int, db: DbSession = Depends(get_db), user: User = Depends(current_user)
) -> None:
    course = _owned_course(db, course_id, user)
    if course.rooms:
        raise HTTPException(
            status_code=409,
            detail="Khoá học đang có phòng. Xoá phòng trước, hoặc lưu trữ khoá học.",
        )
    db.delete(course)
    db.commit()


# ── Slide ───────────────────────────────────────────────────────────────────

@router.get("/{course_id}/slides", response_model=list[SlideOut])
def list_slides(
    course_id: int, db: DbSession = Depends(get_db), user: User = Depends(current_user)
) -> list[SlideOut]:
    course = _owned_course(db, course_id, user)
    return [_slide_out(s) for s in course.slides]


@router.post("/{course_id}/slides/upload", response_model=list[SlideOut], status_code=201)
async def upload_pptx(
    course_id: int,
    file: UploadFile = File(...),
    replace: bool = True,
    db: DbSession = Depends(get_db),
    user: User = Depends(current_user),
) -> list[SlideOut]:
    """Nhận file .pptx thật, đọc nội dung chữ thành slide."""
    course = _owned_course(db, course_id, user)

    filename = (file.filename or "").lower()
    if not filename.endswith(".pptx"):
        raise HTTPException(
            status_code=415,
            detail="Chỉ nhận file .pptx. Nếu đang có .ppt, hãy lưu lại dưới dạng .pptx trước.",
        )

    dest = settings.upload_dir / f"course-{course.id}-{uuid.uuid4().hex[:8]}.pptx"
    size = 0
    try:
        with dest.open("wb") as out:
            while chunk := await file.read(1024 * 512):
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="File vượt quá 40 MB.")
                out.write(chunk)

        try:
            parsed = parse_pptx(dest)
        except Exception as exc:  # noqa: BLE001 — file hỏng / không đúng định dạng
            raise HTTPException(
                status_code=422, detail=f"Không đọc được file PPTX: {type(exc).__name__}"
            ) from exc
    finally:
        await file.close()

    if not parsed:
        dest.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail="File không có slide nào.")

    if replace:
        for old in list(course.slides):
            db.delete(old)
        db.flush()
        offset = 0
    else:
        offset = len(course.slides)

    created: list[Slide] = []
    for item in parsed:
        slide = Slide(
            course_id=course.id,
            index=offset + item["index"],
            title=item["title"],
            blocks=item["blocks"],
            notes=item["notes"],
            source="pptx",
        )
        db.add(slide)
        created.append(slide)
    db.commit()
    return [_slide_out(s) for s in created]


@router.post("/{course_id}/slides/upload-pdf", response_model=list[SlideOut], status_code=201)
async def upload_pdf(
    course_id: int,
    file: UploadFile = File(...),
    replace: bool = True,
    db: DbSession = Depends(get_db),
    user: User = Depends(current_user),
) -> list[SlideOut]:
    """Nhận file PDF thật và chuyển mỗi trang thành một slide."""
    course = _owned_course(db, course_id, user)

    filename = (file.filename or "").lower()
    if not filename.endswith(".pdf"):
        raise HTTPException(status_code=415, detail="Chỉ nhận file .pdf.")

    dest = settings.upload_dir / f"course-{course.id}-{uuid.uuid4().hex[:8]}.pdf"
    size = 0
    try:
        with dest.open("wb") as out:
            while chunk := await file.read(1024 * 512):
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="File vượt quá 40 MB.")
                out.write(chunk)
    finally:
        await file.close()

    try:
        parsed = parse_pdf(dest)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Không đọc được file PDF: {type(exc).__name__}") from exc

    if not parsed:
        dest.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail="File không có trang PDF nào.")

    if replace:
        for old in list(course.slides):
            db.delete(old)
        db.flush()
        offset = 0
    else:
        offset = len(course.slides)

    created: list[Slide] = []
    for item in parsed:
        slide = Slide(
            course_id=course.id,
            index=offset + item["index"],
            title=item["title"],
            blocks=item["blocks"],
            notes=item["notes"],
            source="pdf",
        )
        db.add(slide)
        created.append(slide)
    db.commit()
    return [_slide_out(s) for s in created]


@router.post("/{course_id}/slides", response_model=SlideOut, status_code=201)
def add_slide(
    course_id: int,
    payload: SlideCreate,
    db: DbSession = Depends(get_db),
    user: User = Depends(current_user),
) -> SlideOut:
    course = _owned_course(db, course_id, user)
    slide = Slide(
        course_id=course.id,
        index=len(course.slides),
        title=payload.title.strip() or f"Slide {len(course.slides) + 1}",
        blocks=payload.blocks,
        notes=payload.notes,
        source="manual",
    )
    db.add(slide)
    db.commit()
    return _slide_out(slide)


@router.patch("/slides/{slide_id}", response_model=SlideOut)
def update_slide(
    slide_id: int,
    payload: SlideUpdate,
    db: DbSession = Depends(get_db),
    user: User = Depends(current_user),
) -> SlideOut:
    slide = _owned_slide(db, slide_id, user)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(slide, field, value)
    db.commit()
    return _slide_out(slide)


# ── Checkpoint ──────────────────────────────────────────────────────────────

@router.get("/{course_id}/checkpoints", response_model=list[CheckpointOut])
def list_checkpoints(
    course_id: int, db: DbSession = Depends(get_db), user: User = Depends(current_user)
) -> list[CheckpointOut]:
    course = _owned_course(db, course_id, user)
    out = [_checkpoint_out(s.checkpoint) for s in course.slides if s.checkpoint]
    return sorted(out, key=lambda c: c.slide_index)


@router.post("/slides/{slide_id}/checkpoint", response_model=CheckpointOut, status_code=201)
def create_checkpoint(
    slide_id: int,
    payload: CheckpointCreate,
    db: DbSession = Depends(get_db),
    user: User = Depends(current_user),
) -> CheckpointOut:
    slide = _owned_slide(db, slide_id, user)
    if slide.checkpoint is not None:
        raise HTTPException(status_code=409, detail="Slide này đã có checkpoint.")
    cp = Checkpoint(
        slide_id=slide.id,
        label=payload.label.strip() or f"Checkpoint slide {slide.index + 1}",
        goal=payload.goal.strip(),
    )
    db.add(cp)
    db.commit()
    return _checkpoint_out(cp)


@router.patch("/checkpoints/{checkpoint_id}", response_model=CheckpointOut)
def update_checkpoint(
    checkpoint_id: int,
    payload: CheckpointUpdate,
    db: DbSession = Depends(get_db),
    user: User = Depends(current_user),
) -> CheckpointOut:
    cp = db.get(Checkpoint, checkpoint_id)
    if cp is None or cp.slide.course.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Không tìm thấy checkpoint.")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(cp, field, value.strip() if isinstance(value, str) else value)
    db.commit()
    return _checkpoint_out(cp)


@router.delete("/checkpoints/{checkpoint_id}", status_code=204, response_class=Response, response_model=None)
def delete_checkpoint(
    checkpoint_id: int, db: DbSession = Depends(get_db), user: User = Depends(current_user)
) -> None:
    cp = db.get(Checkpoint, checkpoint_id)
    if cp is None or cp.slide.course.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Không tìm thấy checkpoint.")
    db.delete(cp)
    db.commit()


# ── Câu hỏi trong checkpoint ────────────────────────────────────────────────

@router.post("/checkpoints/{checkpoint_id}/questions", response_model=CheckpointOut, status_code=201)
def add_questions(
    checkpoint_id: int,
    payload: list[QuestionIn],
    db: DbSession = Depends(get_db),
    user: User = Depends(current_user),
) -> CheckpointOut:
    cp = db.get(Checkpoint, checkpoint_id)
    if cp is None or cp.slide.course.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Không tìm thấy checkpoint.")

    start = len(cp.questions)
    for i, q in enumerate(payload):
        db.add(
            Question(
                checkpoint_id=cp.id,
                position=start + i,
                type=q.type,
                prompt=q.prompt.strip(),
                options=q.options,
                answer=q.answer,
                origin=q.origin,
            )
        )
    db.commit()
    db.refresh(cp)
    return _checkpoint_out(cp)


@router.delete("/questions/{question_id}", status_code=204, response_class=Response, response_model=None)
def delete_question(
    question_id: int, db: DbSession = Depends(get_db), user: User = Depends(current_user)
) -> None:
    q = db.get(Question, question_id)
    if q is None or q.checkpoint.slide.course.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Không tìm thấy câu hỏi.")
    db.delete(q)
    db.commit()


@router.post("/checkpoints/{checkpoint_id}/draft", response_model=DraftResponse)
def draft_questions(
    checkpoint_id: int,
    payload: DraftRequest,
    db: DbSession = Depends(get_db),
    user: User = Depends(current_user),
) -> DraftResponse:
    """LLM soạn NHÁP câu hỏi từ nội dung slide. Giảng viên duyệt rồi mới lưu."""
    cp = db.get(Checkpoint, checkpoint_id)
    if cp is None or cp.slide.course.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Không tìm thấy checkpoint.")

    slide = cp.slide
    result = llm.draft_checkpoint_questions(
        slide.title, slide_plain_text(slide), cp.goal, payload.count
    )
    if result is None:
        return DraftResponse(
            questions=[],
            source="unavailable",
            note="Chưa cấu hình GROQ_API_KEY hoặc không gọi được Groq. Bạn vẫn có thể tự soạn câu hỏi.",
        )

    return DraftResponse(
        questions=[QuestionIn(**q, origin="llm") for q in result["questions"]],
        source="llm",
        note=result.get("note", ""),
    )
