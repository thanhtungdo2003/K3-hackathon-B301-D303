"""Trợ lý AI của dashboard — LLM gọi tool để dựng khoá học, checkpoint, phòng học."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session as DbSession

from ..config import get_settings
from ..db import get_db
from ..models import User
from ..modules import agent_tools, llm
from ..schemas import AssistantRequest, AssistantResponse, ToolCallOut
from ..security import current_user

settings = get_settings()
router = APIRouter(prefix="/assistant", tags=["assistant"])

# Nhãn tiếng Việt cho từng tool — giao diện hiện đúng chữ này thay vì tên hàm.
TOOL_LABEL = {
    "get_overview": "Đọc số tổng quan",
    "list_courses": "Xem danh sách khoá học",
    "create_course": "Tạo khoá học",
    "update_course": "Sửa khoá học",
    "list_slides": "Xem slide",
    "create_checkpoint": "Đặt checkpoint",
    "draft_questions": "Soạn nháp câu hỏi",
    "list_rooms": "Xem danh sách phòng",
    "create_room": "Tạo phòng học",
    "start_session": "Bắt đầu buổi học",
    "course_quality": "Xem chất lượng khoá học",
}

UNAVAILABLE = (
    "Trợ lý chưa hoạt động vì máy chủ chưa có GROQ_API_KEY. "
    "Bạn vẫn tạo khoá học, đặt checkpoint và mở phòng bằng tay ở các trang bên cạnh được."
)


@router.get("/status")
def status() -> dict:
    """Giao diện hỏi trước để biết có nên hiện ô chat hay không."""
    return {
        "available": settings.ai_available,
        "model": settings.groq_model if settings.ai_available else None,
        "tools": [
            {
                "name": schema["function"]["name"],
                "label": TOOL_LABEL.get(
                    schema["function"]["name"],
                    schema["function"]["name"],
                ),
            }
            for schema in agent_tools.TOOL_SCHEMAS
        ],
    }


@router.post("/chat", response_model=AssistantResponse)
def chat(
    payload: AssistantRequest,
    db: DbSession = Depends(get_db),
    user: User = Depends(current_user),
) -> AssistantResponse:
    if not settings.ai_available:
        return AssistantResponse(
            reply=UNAVAILABLE,
            calls=[],
            source="unavailable",
            changed=False,
        )

    # Chỉ giữ 16 lượt cuối để prompt không phình theo buổi làm việc.
    history = [
        {"role": message.role, "content": message.content.strip()[:4000]}
        for message in payload.messages[-16:]
        if message.content.strip()
    ]
    if not history:
        return AssistantResponse(
            reply="Bạn muốn dựng gì? Ví dụ: tạo khoá học Nhập môn Machine Learning.",
            calls=[],
            source="rule_fallback",
            changed=False,
        )

    def run_tool(name: str, args: dict) -> dict:
        executor = agent_tools.EXECUTORS.get(name)
        if executor is None:
            return {"error": f"Không có tool tên {name}."}
        try:
            return executor(db, user, args)
        except agent_tools.ToolError as exc:
            db.rollback()
            return {"error": str(exc)}
        except Exception as exc:  # noqa: BLE001 — lỗi hệ thống cũng quay lại cho LLM
            db.rollback()
            return {"error": f"Lỗi khi chạy {name}: {type(exc).__name__}"}

    result = llm.chat_with_tools(
        history,
        agent_tools.TOOL_SCHEMAS,
        run_tool,
    )
    if result is None:
        return AssistantResponse(
            reply=(
                "Lúc này không gọi được Groq. Bạn thử lại sau, "
                "hoặc làm bằng tay ở các trang bên cạnh."
            ),
            calls=[],
            source="unavailable",
            changed=False,
        )

    failure = result.get("failure")
    if failure and not result.get("reply"):
        # Gọi hụt giữa đường: vẫn báo những việc đã kịp làm, không được im.
        result["reply"] = (
            "Đang bị giới hạn tốc độ của Groq. Chờ vài giây rồi nhắc lại giúp tôi."
            if failure == "rate_limit"
            else "Lượt này gọi Groq bị lỗi. Bạn nhắc lại giúp tôi."
        )

    calls = [
        ToolCallOut(
            tool=call["tool"],
            label=TOOL_LABEL.get(call["tool"], call["tool"]),
            args=call["args"],
            ok="error" not in (call["result"] or {}),
            error=str((call["result"] or {}).get("error") or ""),
            result=call["result"] or {},
        )
        for call in result["calls"]
    ]
    changed = any(
        call.tool in agent_tools.MUTATING and call.ok for call in calls
    )

    return AssistantResponse(
        reply=_guarded_reply(result["reply"], calls),
        calls=calls,
        source="llm",
        changed=changed,
        trace_id=result.get("trace_id"),
    )


def _guarded_reply(reply: str, calls: list[ToolCallOut]) -> str:
    """Không tin lời model nếu tool thay đổi dữ liệu thực tế đã thất bại."""
    text = (reply or "").strip() or "Xong."

    succeeded = {
        call.tool
        for call in calls
        if call.ok and call.tool in agent_tools.MUTATING
    }
    failed = [
        call
        for call in calls
        if not call.ok and call.tool in agent_tools.MUTATING
    ]
    unresolved = [call for call in failed if call.tool not in succeeded]
    if not unresolved:
        return text

    # Gộp theo tool, giữ lỗi đầu tiên để câu cảnh báo không dài dòng.
    seen: dict[str, str] = {}
    for call in unresolved:
        seen.setdefault(call.label, call.error or "không rõ lý do")

    lines = [f"- {label}: {reason}" for label, reason in seen.items()]
    return text + "\n\nChưa làm được:\n" + "\n".join(lines)
