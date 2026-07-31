from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, delete
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.main import api
from app.models import (
    Answer,
    Course,
    LearningEvent,
    Participant,
    Question,
    Room,
    Session,
    Slide,
    SupportQuestion,
    User,
)
from app.modules import auto_questions, llm
from app.modules.question_support import AI_DISCLAIMER, Classification
from app.security import current_user


class AutoQuestionAndSupportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(cls.engine)
        cls.Session = sessionmaker(bind=cls.engine, autoflush=False, expire_on_commit=False)
        with cls.Session() as db:
            user = User(
                email="teacher@example.test",
                password_hash="unused",
                full_name="Teacher",
            )
            db.add(user)
            db.flush()
            course = Course(owner_id=user.id, title="Course", description="", subject="")
            db.add(course)
            db.flush()
            db.add_all(
                [
                    Slide(course_id=course.id, index=0, title="Mở đầu", blocks=[]),
                    Slide(
                        course_id=course.id,
                        index=1,
                        title="Định luật Newton",
                        blocks=[{"type": "bullets", "items": ["F = ma"]}],
                    ),
                ]
            )
            room = Room(owner_id=user.id, course_id=course.id, code="AUTO1", name="Room")
            db.add(room)
            db.flush()
            session = Session(room_id=room.id, title="Live")
            db.add(session)
            db.flush()
            participant = Participant(
                session_id=session.id,
                token="student-token",
                display_name="Student",
            )
            db.add(participant)
            db.commit()
            cls.user = user
            cls.session_id = session.id
            cls.participant_id = participant.id

        def override_db():
            db = cls.Session()
            try:
                yield db
            finally:
                db.close()

        api.dependency_overrides[get_db] = override_db
        api.dependency_overrides[current_user] = lambda: cls.user
        cls.client = TestClient(api)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.client.close()
        api.dependency_overrides.clear()
        Base.metadata.drop_all(cls.engine)
        cls.engine.dispose()

    def setUp(self) -> None:
        with self.Session() as db:
            db.execute(delete(Answer).where(Answer.session_id == self.session_id))
            db.execute(
                delete(LearningEvent).where(LearningEvent.session_id == self.session_id)
            )
            db.execute(
                delete(SupportQuestion).where(
                    SupportQuestion.session_id == self.session_id
                )
            )
            session = db.get(Session, self.session_id)
            session.current_question_id = None
            session.current_slide_index = 0
            db.commit()

    def test_slide_change_opens_grounded_questions_only_once(self) -> None:
        with (
            patch("app.modules.llm.draft_checkpoint_questions", return_value=None),
            patch("app.realtime.lecturer_slide_changed", new=AsyncMock()),
            patch("app.realtime.broadcast", new=AsyncMock()) as broadcast,
        ):
            response = self.client.post(
                f"/teaching/sessions/{self.session_id}/slide",
                json={"slide_index": 1},
            )

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(len(body["questions"]), 1)
        self.assertTrue(body["current_question_id"])
        self.assertTrue(body["questions_presented"])
        self.assertIn("F = ma", body["questions"][0]["prompt"])
        self.assertEqual(body["questions"][0]["type"], "true_false")
        events = [call.args[1] for call in broadcast.await_args_list]
        self.assertIn("questions_opened", events)

        with (
            patch("app.realtime.lecturer_slide_changed", new=AsyncMock()),
            patch("app.realtime.broadcast", new=AsyncMock()) as revisit_broadcast,
        ):
            self.client.post(
                f"/teaching/sessions/{self.session_id}/slide",
                json={"slide_index": 0},
            )
            revisited = self.client.post(
                f"/teaching/sessions/{self.session_id}/slide",
                json={"slide_index": 1},
            )

        self.assertEqual(revisited.status_code, 200, revisited.text)
        self.assertFalse(revisited.json()["questions_presented"])
        self.assertIsNone(revisited.json()["current_question_id"])
        revisit_events = [
            call.args[1] for call in revisit_broadcast.await_args_list
        ]
        self.assertNotIn("questions_opened", revisit_events)

    def test_student_state_does_not_repeat_answered_questions(self) -> None:
        with (
            patch("app.modules.llm.draft_checkpoint_questions", return_value=None),
            patch("app.realtime.lecturer_slide_changed", new=AsyncMock()),
            patch("app.realtime.broadcast", new=AsyncMock()),
        ):
            changed = self.client.post(
                f"/teaching/sessions/{self.session_id}/slide",
                json={"slide_index": 1},
            )
        self.assertEqual(changed.status_code, 200, changed.text)
        question_ids = [item["id"] for item in changed.json()["questions"]]
        with self.Session() as db:
            legacy_question = db.get(Question, question_ids[0])
            legacy_question.answer = {
                "value": "0",
                "explanation": "Nội dung này có trên slide.",
            }
            db.commit()

        with patch("app.realtime.to_lecturer", new=AsyncMock()):
            answered = self.client.post(
                f"/sessions/{self.session_id}/answers",
                json={
                    "token": "student-token",
                    "question_id": question_ids[0],
                    "value": "Đã hiểu",
                    "response_ms": 500,
                    "confidence": 3,
                },
            )
        self.assertEqual(answered.status_code, 200, answered.text)
        self.assertFalse(answered.json()["correct"])
        self.assertEqual(answered.json()["correct_answer"], "Đúng")

        private_state = self.client.get(
            f"/sessions/{self.session_id}/state",
            params={"token": "student-token"},
        )
        self.assertEqual(private_state.status_code, 200, private_state.text)
        self.assertEqual(private_state.json()["current_questions"], [])
        self.assertIsNone(private_state.json()["current_question"])

        public_state = self.client.get(f"/sessions/{self.session_id}/state")
        self.assertEqual(len(public_state.json()["current_questions"]), 1)

        dashboard = self.client.get(
            f"/teaching/sessions/{self.session_id}/dashboard"
        )
        self.assertEqual(dashboard.status_code, 200, dashboard.text)
        results = dashboard.json()["question_results"]
        self.assertEqual(results["answered"], 1)
        self.assertEqual(results["correct_rate"], 0.0)
        self.assertEqual(results["wrong_rate"], 1.0)

    def test_question_at_thirty_percent_pings_teaching_team(self) -> None:
        with (
            patch(
                "app.modules.question_support.classify",
                return_value=Classification(score=0.30, source="llm"),
            ),
            patch("app.realtime.to_teaching_team", new=AsyncMock()) as ping,
        ):
            response = self.client.post(
                f"/sessions/{self.session_id}/questions",
                json={
                    "token": "student-token",
                    "slide_index": 1,
                    "text": "Em chưa hiểu vì sao F = ma?",
                },
            )

        self.assertEqual(response.status_code, 201, response.text)
        self.assertTrue(response.json()["escalated"])
        self.assertEqual(response.json()["confusion_threshold"], 0.30)
        ping.assert_awaited_once()

        with patch("app.realtime.sio.emit", new=AsyncMock()):
            answer = self.client.post(
                f"/teaching/sessions/{self.session_id}/support-questions/"
                f"{response.json()['id']}/answer",
                json={"text": "Giải thích từ định nghĩa trên slide.", "answered_by": "lecturer"},
            )
        self.assertEqual(answer.status_code, 200, answer.text)
        self.assertEqual(answer.json()["answered_by"], "lecturer")
        self.assertIsNone(answer.json()["answer_disclaimer"])

    def test_overflow_question_gets_ai_answer_and_disclaimer(self) -> None:
        with self.Session() as db:
            db.add_all(
                [
                    SupportQuestion(
                        session_id=self.session_id,
                        participant_id=self.participant_id,
                        slide_index=1,
                        text=f"pending {index}",
                        status="pending",
                    )
                    for index in range(5)
                ]
            )
            db.commit()

        with (
            patch(
                "app.modules.question_support.classify",
                return_value=Classification(score=0.80, source="llm"),
            ),
            patch("app.modules.question_support.answer", return_value="F bằng m nhân a."),
            patch("app.realtime.to_teaching_team", new=AsyncMock()),
            patch("app.realtime.sio.emit", new=AsyncMock()),
        ):
            response = self.client.post(
                f"/sessions/{self.session_id}/questions",
                json={
                    "token": "student-token",
                    "slide_index": 1,
                    "text": "Công thức này có nghĩa gì?",
                },
            )

        self.assertEqual(response.status_code, 201, response.text)
        body = response.json()
        self.assertEqual(body["answered_by"], "ai")
        self.assertEqual(body["answer_disclaimer"], AI_DISCLAIMER)
        self.assertEqual(body["status"], "answered")

    def test_ai_support_answers_below_threshold(self) -> None:
        with (
            patch("app.modules.question_support.summarize", return_value="Slide nói về F = ma."),
            patch(
                "app.modules.question_support.classify",
                return_value=Classification(score=0.20, source="llm"),
            ),
            patch("app.modules.question_support.answer", return_value="F là lực, m là khối lượng."),
        ):
            response = self.client.post(
                f"/sessions/{self.session_id}/ai-support",
                json={
                    "token": "student-token",
                    "slide_index": 1,
                    "message": "F là gì?",
                },
            )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertFalse(response.json()["escalated"])
        self.assertEqual(response.json()["answer"], "F là lực, m là khối lượng.")
        self.assertIsNone(response.json()["support_question"])

    def test_ai_support_can_answer_from_the_whole_lesson(self) -> None:
        with (
            patch("app.modules.question_support.summarize", return_value="Tóm tắt slide hiện tại."),
            patch(
                "app.modules.question_support.classify",
                return_value=Classification(score=0.20, source="llm"),
            ),
            patch(
                "app.modules.question_support.answer",
                return_value="Hôm nay học mở đầu và định luật Newton.",
            ) as answer,
        ):
            response = self.client.post(
                f"/sessions/{self.session_id}/ai-support",
                json={
                    "token": "student-token",
                    "slide_index": 1,
                    "message": "Hôm nay học gì?",
                },
            )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(
            response.json()["answer"],
            "Hôm nay học mở đầu và định luật Newton.",
        )
        lesson_text = answer.call_args.args[3]
        self.assertIn("SLIDE 1:", lesson_text)
        self.assertIn("SLIDE 2:", lesson_text)
        self.assertIn("F = ma", lesson_text)

    def test_ai_support_escalates_at_threshold(self) -> None:
        with (
            patch("app.modules.question_support.summarize", return_value="Slide nói về F = ma."),
            patch(
                "app.modules.question_support.classify",
                return_value=Classification(score=0.30, source="llm"),
            ),
            patch("app.realtime.to_teaching_team", new=AsyncMock()),
            patch("app.realtime.sio.emit", new=AsyncMock()),
            patch("app.modules.question_support.answer", return_value="AI fallback"),
        ):
            response = self.client.post(
                f"/sessions/{self.session_id}/ai-support",
                json={
                    "token": "student-token",
                    "slide_index": 1,
                    "message": "Em vẫn chưa hiểu công thức này.",
                },
            )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()["escalated"])
        self.assertIsNotNone(response.json()["support_question"])

    def test_question_draft_normalizes_answer_and_rejects_generic_prompt(self) -> None:
        raw = {
            "questions": [
                {
                    "type": "multiple_choice",
                    "prompt": "Theo định luật Newton, công thức nào xuất hiện trên slide?",
                    "options": ["E = mc²", "F = ma", "P = UI"],
                    "answer": {"value": "1"},
                    "explanation": "Slide nêu F = ma.",
                },
                {
                    "type": "poll",
                    "prompt": "Bạn đã hiểu bài chưa?",
                    "options": ["Rồi", "Chưa"],
                    "answer": {},
                },
            ]
        }
        with patch("app.modules.llm._chat_json", return_value=raw):
            drafted = llm.draft_checkpoint_questions(
                "Định luật Newton",
                "Định luật Newton\nF = ma",
                "Kiểm tra công thức",
                2,
            )

        self.assertIsNotNone(drafted)
        self.assertEqual(len(drafted["questions"]), 1)
        self.assertEqual(
            drafted["questions"][0]["answer"]["value"],
            "F = ma",
        )

        stale_generic = Question(
            checkpoint_id=1,
            position=0,
            type="poll",
            prompt="Bạn đã nắm được ý chính đến mức nào?",
            options=["Đã hiểu", "Chưa hiểu"],
            answer={},
            origin="llm",
        )
        self.assertFalse(auto_questions.is_meaningful(stale_generic))


if __name__ == "__main__":
    unittest.main()
