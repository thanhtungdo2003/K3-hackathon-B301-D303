from __future__ import annotations

import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base
from app.models import (
    Answer,
    Checkpoint,
    Course,
    LearningEvent,
    Participant,
    Question,
    Room,
    Session,
    Slide,
    User,
    utcnow,
)
from app.modules.session_understanding import build_session_summary


class SessionUnderstandingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(
            bind=self.engine, autoflush=False, expire_on_commit=False
        )

    def tearDown(self) -> None:
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    def test_summary_uses_green_yellow_red_and_flags_returned_slide(self) -> None:
        with self.Session() as db:
            user = User(
                email="summary@example.test",
                password_hash="unused",
                full_name="Teacher",
            )
            db.add(user)
            db.flush()
            course = Course(owner_id=user.id, title="Vật lý", description="", subject="")
            db.add(course)
            db.flush()
            slides = [
                Slide(course_id=course.id, index=0, title="Lực", blocks=[]),
                Slide(course_id=course.id, index=1, title="Gia tốc", blocks=[]),
            ]
            db.add_all(slides)
            db.flush()
            checkpoints = [
                Checkpoint(slide_id=slide.id, label="", goal="") for slide in slides
            ]
            db.add_all(checkpoints)
            db.flush()
            questions = [
                Question(
                    checkpoint_id=checkpoint.id,
                    type="true_false",
                    prompt="Kiểm tra",
                    options=["Đúng", "Sai"],
                    answer={"value": "Đúng"},
                )
                for checkpoint in checkpoints
            ]
            db.add_all(questions)
            room = Room(owner_id=user.id, course_id=course.id, code="SUM001", name="Lớp")
            db.add(room)
            db.flush()
            session = Session(room_id=room.id, title="Buổi 1", ended_at=utcnow())
            db.add(session)
            db.flush()
            students = [
                Participant(
                    session_id=session.id,
                    token=f"student-{index}",
                    display_name=f"Student {index}",
                )
                for index in range(3)
            ]
            db.add_all(students)
            db.flush()
            db.add_all(
                [
                    Answer(
                        session_id=session.id,
                        participant_id=students[0].id,
                        question_id=questions[0].id,
                        slide_index=0,
                        payload={"value": "Đúng"},
                        correct=True,
                        confidence=3,
                    ),
                    Answer(
                        session_id=session.id,
                        participant_id=students[1].id,
                        question_id=questions[0].id,
                        slide_index=0,
                        payload={"value": "Đúng"},
                        correct=True,
                        confidence=3,
                    ),
                    Answer(
                        session_id=session.id,
                        participant_id=students[2].id,
                        question_id=questions[1].id,
                        slide_index=1,
                        payload={"value": "Sai"},
                        correct=False,
                        confidence=1,
                    ),
                    LearningEvent(
                        session_id=session.id,
                        participant_id=students[1].id,
                        slide_index=0,
                        type="return_slide",
                        payload={"from_slide_index": 1},
                    ),
                ]
            )
            db.commit()

            summary = build_session_summary(db, session)

        self.assertEqual(summary["classified_students"], 3)
        self.assertEqual(summary["understood"]["count"], 1)
        self.assertEqual(summary["temporary"]["count"], 1)
        self.assertEqual(summary["not_understood"]["count"], 1)
        self.assertEqual(summary["unclear_topics"][0]["title"], "Gia tốc")
        self.assertEqual(summary["unclear_topics"][0]["status"], "red")
        returned_topic = next(
            topic
            for topic in summary["unclear_topics"]
            if topic["title"] == "Lực"
        )
        self.assertEqual(returned_topic["status"], "yellow")


if __name__ == "__main__":
    unittest.main()
