"""Assessment Engine — Rule-based First.

Mọi loại câu hỏi trong prototype đều chấm bằng luật. Không gọi LLM ở đây:
sai một câu chấm điểm là học viên mất điểm trực tiếp (lớp chỗ khó ④),
nên phần này cố tình giữ deterministic và kiểm chứng được.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Any

RULE_TYPES = {"multiple_choice", "multiple_select", "true_false", "ordering", "fill_blank"}
NO_SCORE_TYPES = {"poll"}


def _normalize(text: Any) -> str:
    s = unicodedata.normalize("NFC", str(text)).strip().lower()
    return re.sub(r"\s+", " ", s)


def grade(question_type: str, answer_key: dict, payload: dict) -> tuple[bool | None, float]:
    """Trả về (correct, score). correct=None nghĩa là câu không có đúng/sai (poll)."""
    if question_type in NO_SCORE_TYPES:
        return None, 0.0

    value = payload.get("value")

    if question_type in ("multiple_choice", "true_false"):
        correct = value is not None and str(value) == str(answer_key.get("value"))
        return correct, 1.0 if correct else 0.0

    if question_type == "multiple_select":
        expected = {str(v) for v in answer_key.get("values", [])}
        got = {str(v) for v in (value or [])}
        if not expected:
            return None, 0.0
        correct = expected == got
        # điểm từng phần: đúng - sai, chặn dưới 0
        hit = len(expected & got)
        miss = len(got - expected)
        partial = max(0.0, (hit - miss) / len(expected))
        return correct, 1.0 if correct else round(partial, 3)

    if question_type == "ordering":
        expected = [str(v) for v in answer_key.get("order", [])]
        got = [str(v) for v in (value or [])]
        correct = expected == got
        if not expected:
            return None, 0.0
        inplace = sum(1 for i, v in enumerate(got[: len(expected)]) if v == expected[i])
        return correct, 1.0 if correct else round(inplace / len(expected), 3)

    if question_type == "fill_blank":
        accepted = [_normalize(v) for v in answer_key.get("accepted", [])]
        correct = _normalize(value) in accepted if accepted else False
        return correct, 1.0 if correct else 0.0

    # short_text / essay / whiteboard: prototype KHÔNG chấm (xem non-goals trong spec)
    return None, 0.0
