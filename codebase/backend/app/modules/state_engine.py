"""Classroom State Engine — rule-based, KHÔNG dùng LLM.

Đây là "nguồn sự thật" duy nhất về trạng thái lớp. Advisor (LLM) chỉ được
đọc kết quả của module này, không bao giờ tự kết luận lớp đang thế nào.
"""
from __future__ import annotations

from dataclasses import dataclass

from ..config import get_settings
from .analytics import SlideMetrics

settings = get_settings()

# Thứ tự ưu tiên khi nhiều luật cùng khớp (số càng lớn càng nghiêm trọng)
SEVERITY = {
    "insufficient_data": 0,
    "healthy": 1,
    "stable": 2,
    "discussion_active": 3,
    "need_review": 4,
    "low_participation": 5,
    "need_attention": 6,
    "high_confusion": 7,
}

STATE_LABEL = {
    "insufficient_data": "Chưa đủ dữ liệu",
    "healthy": "Lớp đang tốt",
    "stable": "Ổn định",
    "discussion_active": "Đang thảo luận sôi nổi",
    "need_review": "Cần ôn lại",
    "low_participation": "Ít người tham gia",
    "need_attention": "Cần chú ý",
    "high_confusion": "Nhiều người đang rối",
}


@dataclass
class ClassroomState:
    state: str
    label: str
    severity: int
    reasons: list[str]
    trusted: bool          # đủ dữ liệu để kết luận chưa (lớp chỗ khó ②)
    sample_note: str

    def as_dict(self) -> dict:
        return {
            "state": self.state,
            "label": self.label,
            "severity": self.severity,
            "reasons": self.reasons,
            "trusted": self.trusted,
            "sample_note": self.sample_note,
        }


def evaluate(m: SlideMetrics) -> ClassroomState:
    """Chấm trạng thái lớp từ metrics đã tổng hợp."""
    reasons: list[str] = []
    candidates: list[str] = []

    # ── Cổng dữ liệu: chưa đủ mẫu thì KHÔNG kết luận ─────────────────────────
    if m.online_students == 0:
        return ClassroomState(
            state="insufficient_data",
            label=STATE_LABEL["insufficient_data"],
            severity=SEVERITY["insufficient_data"],
            reasons=["Chưa có học viên nào online."],
            trusted=False,
            sample_note="0 học viên online",
        )

    enough_answers = m.responded >= settings.min_responses
    enough_share = m.participation >= settings.min_participation
    if not (enough_answers and enough_share):
        note = f"{m.responded}/{m.online_students} học viên đã trả lời"
        return ClassroomState(
            state="insufficient_data",
            label=STATE_LABEL["insufficient_data"],
            severity=SEVERITY["insufficient_data"],
            reasons=[
                f"Mới {note} — dưới ngưỡng tối thiểu "
                f"({settings.min_responses} câu trả lời và {int(settings.min_participation * 100)}% lớp)."
            ],
            trusted=False,
            sample_note=note,
        )

    sample_note = f"{m.responded}/{m.online_students} học viên đã trả lời"

    # ── Luật ────────────────────────────────────────────────────────────────
    if m.graded_answers >= settings.min_responses and m.wrong_rate >= 0.5 and (m.slow_rate >= 0.4 or m.skip_rate >= 0.3):
        candidates.append("high_confusion")
        reasons.append(f"{int(m.wrong_rate * 100)}% câu trả lời sai và nhiều người trả lời chậm/bỏ qua.")

    # Sai từ 35% trở lên đã đáng chú ý, kể cả khi không có tín hiệu thời gian.
    # (Bản đầu chỉ bắt khoảng 35–50%, nên case sai 60% mà thiếu dữ liệu thời gian
    #  rơi về "stable" — golden case NST-03 bắt được.)
    if m.graded_answers >= settings.min_responses and m.wrong_rate >= 0.35:
        candidates.append("need_attention")
        reasons.append(f"Tỉ lệ sai {int(m.wrong_rate * 100)}% — cao hơn mức bình thường.")

    if m.low_confidence_rate >= 0.4:
        candidates.append("need_attention")
        reasons.append(f"{int(m.low_confidence_rate * 100)}% tự đánh giá là chưa chắc chắn.")

    if m.return_slide_count >= max(3, round(m.online_students * 0.3)):
        candidates.append("need_review")
        reasons.append(f"{m.return_slide_count} lượt quay lại slide này.")

    if m.participation < 0.5:
        candidates.append("low_participation")
        reasons.append(f"Chỉ {int(m.participation * 100)}% lớp trả lời.")

    if m.raised_hands + m.asked_questions >= max(3, round(m.online_students * 0.25)):
        candidates.append("discussion_active")
        reasons.append(f"{m.raised_hands} lượt giơ tay, {m.asked_questions} câu hỏi gửi lên.")

    if m.correct_rate >= 0.8 and m.slow_rate <= 0.2 and m.participation >= 0.7:
        candidates.append("healthy")
        reasons.append(f"{int(m.correct_rate * 100)}% đúng, phần lớn trả lời nhanh.")

    if not candidates:
        candidates.append("stable")
        reasons.append(f"{int(m.correct_rate * 100)}% đúng, không có tín hiệu bất thường.")

    state = max(candidates, key=lambda s: SEVERITY[s])
    return ClassroomState(
        state=state,
        label=STATE_LABEL[state],
        severity=SEVERITY[state],
        reasons=reasons,
        trusted=True,
        sample_note=sample_note,
    )


# Trạng thái nào đáng bật popup cho giảng viên
ALERT_STATES = {"high_confusion", "need_attention", "low_participation", "need_review"}
