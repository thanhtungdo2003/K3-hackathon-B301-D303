"""Teaching Advisor — quyết định AI trung tâm của lát cắt.

Đường đi: metrics tổng hợp -> Classroom State Engine (rule) -> cổng dữ liệu
-> LLM viết cảnh báo -> hậu kiểm bằng luật -> popup cho giảng viên.

Ba lối ra:
  source = "abstain"        : chưa đủ dữ liệu, không gọi AI, không kết luận
  source = "ai"             : AI viết và qua được hậu kiểm
  source = "rule_fallback"  : AI không dùng được (mất mạng / hậu kiểm trượt) -> mẫu câu cố định
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from ..config import get_settings
from . import llm
from .state_engine import ALERT_STATES, ClassroomState

settings = get_settings()

MAX_HEADLINE = 60
MAX_ACTION = 140

# Từ ngữ không được xuất hiện: quy kết cá nhân / phán xét năng lực (lớp chỗ khó ④)
#
# Mẫu "nêu tên" phải phân biệt HOA/thường (tên riêng viết hoa), nên tách riêng
# khỏi nhóm không phân biệt hoa/thường. Gộp chung với re.IGNORECASE từng làm
# "học viên online" bị coi là nêu tên — case MH-01/02/04 trong golden set bắt được.
BANNED_NAME_PATTERN = r"\b(học viên|sinh viên|bạn|em)\s+[A-ZĐÂĂÊÔƠƯ][a-zàáảãạăâđèéẻẽẹêìíỉĩịòóỏõọôơùúủũụưỳýỷỹỵ]{1,}"

BANNED_PATTERNS = [
    r"\byếu kém\b",
    r"\blười\b",
    r"\bdốt\b",
    r"\bkhông chịu học\b",
    r"\bmất gốc\b",
    r"\blớp (này )?(yếu|kém|dở|tệ)\b",
]


@dataclass
class AdviceResult:
    should_alert: bool
    headline: str
    action: str
    evidence: list[str]
    confidence: str
    source: str
    state: str
    state_label: str
    refused: bool = False
    refusal_reason: str = ""
    guard_flags: list[str] = field(default_factory=list)
    trace_id: str | None = None

    def as_dict(self) -> dict:
        return {
            "should_alert": self.should_alert,
            "headline": self.headline,
            "action": self.action,
            "evidence": self.evidence,
            "confidence": self.confidence,
            "source": self.source,
            "state": self.state,
            "state_label": self.state_label,
            "refused": self.refused,
            "refusal_reason": self.refusal_reason,
            "guard_flags": self.guard_flags,
            "trace_id": self.trace_id,
        }


# ── Hậu kiểm ────────────────────────────────────────────────────────────────

def _numbers_in(text: str) -> set[str]:
    return {n.rstrip("0").rstrip(".") if "." in n else n for n in re.findall(r"\d+(?:[.,]\d+)?", text.replace(",", "."))}


def _metric_number_pool(metrics: dict) -> set[str]:
    pool: set[str] = set()
    for value in metrics.values():
        if isinstance(value, bool):
            continue
        if isinstance(value, (int, float)):
            pool.add(str(int(value)))
            pool.add(str(round(value, 1)).rstrip("0").rstrip("."))
            if 0 <= value <= 1:  # tỉ lệ -> phần trăm
                pool.add(str(int(round(value * 100))))
        elif isinstance(value, list):
            for item in value:
                if isinstance(item, dict):
                    for v in item.values():
                        if isinstance(v, (int, float)) and not isinstance(v, bool):
                            pool.add(str(int(v)))
    return pool


def validate(data: dict, metrics: dict, state: ClassroomState) -> list[str]:
    """Trả về danh sách vi phạm. Rỗng = qua hậu kiểm."""
    flags: list[str] = []

    if data.get("refused"):
        if data.get("should_alert"):
            flags.append("refused_but_alerting")
        if not (data.get("refusal_reason") or "").strip():
            flags.append("refusal_without_reason")
        return flags

    headline = (data.get("headline") or "").strip()
    action = (data.get("action") or "").strip()
    evidence = data.get("evidence") or []

    if not headline:
        flags.append("empty_headline")
    if len(headline) > MAX_HEADLINE:
        flags.append("headline_too_long")
    if not action:
        flags.append("empty_action")
    if len(action) > MAX_ACTION:
        flags.append("action_too_long")

    blob = f"{headline} {action} {' '.join(str(e) for e in evidence)}"
    if re.search(BANNED_NAME_PATTERN, blob):  # phân biệt hoa/thường — tên riêng viết hoa
        flags.append("banned_language")
    else:
        for pattern in BANNED_PATTERNS:
            if re.search(pattern, blob, flags=re.IGNORECASE):
                flags.append("banned_language")
                break

    # ① Nguồn sự thật: mọi con số trong evidence phải truy được về metrics
    pool = _metric_number_pool(metrics)
    for item in evidence:
        for num in _numbers_in(str(item)):
            if num not in pool:
                flags.append("ungrounded_number")
                break
        else:
            continue
        break

    # ② Thiếu dữ liệu thì không được cảnh báo, không được tự tin
    if not state.trusted:
        if data.get("should_alert"):
            flags.append("alert_without_data")
        if data.get("confidence") != "low":
            flags.append("overconfident_on_thin_data")
    else:
        if not evidence:
            flags.append("no_evidence")
        if state.state in ALERT_STATES and not data.get("should_alert"):
            flags.append("missed_alert")
        if state.state not in ALERT_STATES and data.get("should_alert"):
            flags.append("false_alert")

    if data.get("confidence") not in ("high", "medium", "low"):
        flags.append("bad_confidence")

    return flags


# ── Chặn trước: yêu cầu rõ ràng ngoài phạm vi (lớp chỗ khó ③) ───────────────
# Lớp luật này chạy TRƯỚC khi gọi model, vì hai lý do:
#   1. Từ chối phải hoạt động kể cả khi mất mạng / hết quota.
#   2. Không gửi câu hỏi kiểu "em nào yếu nhất" sang model để lấy câu trả lời.
# Các trường hợp tinh vi hơn vẫn để model tự nhận diện và trả refused=true.

OUT_OF_SCOPE_RULES: list[tuple[str, str, str]] = [
    (
        "identify_student",
        r"(em|bạn|học viên|sinh viên|ai)\s+(nào|nao)\b.*\b(yếu|kém|dở|tệ|giỏi|nhất|kem|nhat)"
        r"|xếp hạng|xep hang|liệt kê tên|liet ke ten|nêu tên|neu ten|chỉ mặt|top \d+ (em|bạn|học viên)",
        "Mình không nêu tên hay xếp hạng từng học viên — dữ liệu gửi tới mình đã ẩn danh và chỉ ở mức toàn lớp. "
        "Mình có thể chỉ ra slide nào đang gây khó và gợi ý một cách giảng lại.",
    ),
    (
        "grade_student",
        r"chấm điểm|cham diem|cho điểm|cho diem|đánh giá năng lực|danh gia nang luc|dự đoán điểm|du doan diem"
        r"|xếp loại|xep loai|đánh giá thái độ|danh gia thai do",
        "Mình không chấm điểm hay đánh giá năng lực học viên. Việc đó thuộc về thầy/cô. "
        "Mình chỉ đọc tín hiệu tổng hợp của lớp và gợi ý hành động dạy tiếp theo.",
    ),
    (
        "answer_for_lecturer",
        r"trả lời (hộ|thay|giúp)|tra loi (ho|thay|giup)|giảng (hộ|thay)|giang (ho|thay)"
        r"|gi[ảa]i th[íi]ch\s+(hộ|thay|giúp|ho|giup)"
        r"|so[aạ]n.{0,20}(bài|bai|slide|giáo án|giao an|nội dung|noi dung)"
        r"|vi[eế]t.{0,20}(bài giảng|bai giang|nội dung|noi dung|slide)",
        "Mình không giảng thay hay soạn nội dung bài. Mình quan sát lớp và gợi ý một hành động dạy cụ thể "
        "dựa trên số liệu buổi học.",
    ),
]


def screen_request(text: str) -> tuple[str, str] | None:
    """Trả về (rule_name, lời từ chối) nếu yêu cầu rõ ràng ngoài phạm vi."""
    lowered = text.lower()
    for name, pattern, message in OUT_OF_SCOPE_RULES:
        if re.search(pattern, lowered):
            return name, message
    return None


# ── Mẫu câu dự phòng (không cần AI) ─────────────────────────────────────────

FALLBACK_ACTION = {
    "high_confusion": "Dừng lại, giải thích khái niệm này bằng một ví dụ thực tế rồi hỏi lại một câu ngắn.",
    "need_attention": "Cho 60 giây thảo luận cặp về ý chính của slide rồi gọi một cặp trả lời.",
    "low_participation": "Mở lại câu hỏi và nói rõ là trả lời ẩn danh, chờ thêm 30 giây.",
    "need_review": "Quay lại slide trước đó một phút để nối lại mạch trước khi đi tiếp.",
    "discussion_active": "Chọn một câu hỏi trong hàng chờ và trả lời trước lớp.",
    "healthy": "Lớp đang theo kịp, có thể chuyển sang nội dung tiếp theo.",
    "stable": "Lớp đang ổn, tiếp tục theo kế hoạch.",
    "insufficient_data": "Chờ thêm câu trả lời hoặc mở lại câu hỏi trước khi kết luận.",
}


def rule_fallback(metrics: dict, state: ClassroomState) -> AdviceResult:
    evidence: list[str] = []
    if state.trusted:
        evidence.append(f"{int(metrics['participation'] * 100)}% lớp đã trả lời")
        if metrics.get("graded_answers", 0):
            evidence.append(f"{int(metrics['wrong_rate'] * 100)}% câu trả lời sai")
        if metrics.get("median_response_s"):
            evidence.append(f"trung vị {metrics['median_response_s']} giây mỗi câu")

    headline = f"Slide {metrics['slide_index'] + 1}: {state.label}"
    return AdviceResult(
        should_alert=state.trusted and state.state in ALERT_STATES,
        headline=headline[:MAX_HEADLINE],
        action=FALLBACK_ACTION.get(state.state, FALLBACK_ACTION["stable"]),
        evidence=evidence[:3],
        confidence="low" if not state.trusted else ("medium" if metrics["responded"] < 10 else "high"),
        source="rule_fallback",
        state=state.state,
        state_label=state.label,
    )


# ── Điểm vào ────────────────────────────────────────────────────────────────

def advise(metrics: dict, state: ClassroomState, lecturer_request: str | None = None) -> AdviceResult:
    # Cổng ③: yêu cầu rõ ràng ngoài phạm vi -> từ chối bằng luật, không gọi AI.
    if lecturer_request:
        screened = screen_request(lecturer_request)
        if screened is not None:
            rule_name, message = screened
            return AdviceResult(
                should_alert=False,
                headline="",
                action="",
                evidence=[],
                confidence="low",
                source="rule_fallback",
                state=state.state,
                state_label=state.label,
                refused=True,
                refusal_reason=message,
                guard_flags=[f"prefilter:{rule_name}"],
            )

    # Cổng ①②: chưa đủ dữ liệu và giảng viên không hỏi gì -> không gọi AI, không đoán.
    if not state.trusted and not lecturer_request:
        return AdviceResult(
            should_alert=False,
            headline="Chưa đủ dữ liệu để kết luận",
            action=FALLBACK_ACTION["insufficient_data"],
            evidence=[state.sample_note],
            confidence="low",
            source="abstain",
            state=state.state,
            state_label=state.label,
        )

    raw = llm.advise_teacher(metrics, state.as_dict(), lecturer_request)
    if raw is None:
        fallback = rule_fallback(metrics, state)
        fallback.guard_flags = ["ai_unavailable"]
        if lecturer_request:
            # Nói thẳng là câu hỏi tự do chưa được trả lời, thay vì lặng lẽ đưa gợi ý chung.
            fallback.action = (
                "Advisor đang chạy chế độ không AI nên chưa trả lời được câu hỏi riêng. "
                + fallback.action
            )[:MAX_ACTION]
        return fallback

    flags = validate(raw, metrics, state)
    if flags:
        fallback = rule_fallback(metrics, state)
        fallback.guard_flags = flags
        fallback.trace_id = raw.get("_trace_id")
        return fallback

    if raw.get("refused"):
        return AdviceResult(
            should_alert=False,
            headline="",
            action="",
            evidence=[],
            confidence="low",
            source="ai",
            state=state.state,
            state_label=state.label,
            refused=True,
            refusal_reason=raw.get("refusal_reason", ""),
            trace_id=raw.get("_trace_id"),
        )

    return AdviceResult(
        should_alert=bool(raw["should_alert"]),
        headline=raw["headline"].strip(),
        action=raw["action"].strip(),
        evidence=[str(e) for e in raw["evidence"]][:3],
        confidence=raw["confidence"],
        source="ai",
        state=state.state,
        state_label=state.label,
        trace_id=raw.get("_trace_id"),
    )
