from __future__ import annotations

import json
import unittest
from datetime import datetime, timezone

from app.models import Answer, LearningEvent, Participant
from app.routers.assistant import _pulse, _support_queue


NOW = datetime(2026, 7, 30, 9, 0, tzinfo=timezone.utc)


def participant(participant_id: int) -> Participant:
    return Participant(
        id=participant_id,
        session_id=1,
        token=f"token-{participant_id}",
        display_name=f"Student {participant_id}",
        avatar="paw",
        online=True,
    )


def answer(
    participant_id: int,
    *,
    correct: bool | None,
    confidence: int,
    skipped: bool = False,
) -> Answer:
    return Answer(
        session_id=1,
        participant_id=participant_id,
        question_id=1,
        slide_index=0,
        payload={},
        correct=correct,
        score=1.0 if correct else 0.0,
        response_ms=1000,
        skipped=skipped,
        confidence=confidence,
        created_at=NOW,
    )


class AssistantAggregateTests(unittest.TestCase):
    def test_pulse_uses_evidence_and_preserves_unclassified_group(self) -> None:
        participants = [participant(index) for index in range(1, 5)]
        answers = [
            answer(1, correct=True, confidence=2),
            answer(2, correct=False, confidence=1),
        ]
        events = [
            LearningEvent(
                id=1,
                session_id=1,
                participant_id=3,
                slide_index=0,
                type="raise_hand",
                payload={},
                created_at=NOW,
            )
        ]

        pulse = _pulse(
            participants,
            answers,
            events,
            [],
            current_slide_index=0,
            now=NOW,
        )

        self.assertEqual(pulse["total_students"], 4)
        self.assertEqual(pulse["on_track"]["count"], 1)
        self.assertEqual(pulse["struggling"]["count"], 1)
        self.assertEqual(pulse["needs_follow_up"]["count"], 1)
        self.assertEqual(pulse["unclassified"]["count"], 1)

    def test_support_queue_does_not_expose_identity(self) -> None:
        event = LearningEvent(
            id=7,
            session_id=1,
            participant_id=42,
            slide_index=3,
            type="ask_question",
            payload={"text": "Em chưa hiểu ví dụ này.", "name": "Private Name"},
            created_at=NOW,
        )
        queue = _support_queue([event], NOW)
        serialized = json.dumps(queue, ensure_ascii=False, default=str)

        self.assertEqual(queue[0]["text"], "Em chưa hiểu ví dụ này.")
        self.assertNotIn("participant_id", serialized)
        self.assertNotIn("Private Name", serialized)


if __name__ == "__main__":
    unittest.main()
