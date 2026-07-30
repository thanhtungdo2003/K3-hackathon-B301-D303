from __future__ import annotations

import unittest

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.main import api
from app.models import Course, Room, Session, Slide, User
from app.security import current_user


class AssistantApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(cls.engine)
        cls.Session = sessionmaker(
            bind=cls.engine,
            autoflush=False,
            expire_on_commit=False,
        )
        with cls.Session() as db:
            user = User(
                email="owner@example.test",
                password_hash="not-used",
                full_name="Owner",
            )
            db.add(user)
            db.flush()
            course = Course(
                owner_id=user.id,
                title="Test course",
                description="",
                subject="",
            )
            db.add(course)
            db.flush()
            db.add(
                Slide(
                    course_id=course.id,
                    index=0,
                    title="Only one slide",
                    blocks=[],
                    notes="",
                )
            )
            room = Room(
                owner_id=user.id,
                course_id=course.id,
                code="TST22",
                name="Test room",
            )
            db.add(room)
            db.flush()
            session = Session(room_id=room.id, title="Test session")
            db.add(session)
            db.commit()
            cls.user = user
            cls.session_id = session.id

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

    def test_empty_dashboard_is_data_gated_and_identity_safe(self) -> None:
        response = self.client.get(
            f"/teaching-assistant/sessions/{self.session_id}/dashboard"
        )

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertIsNone(body["concepts"][0]["understanding"])
        self.assertEqual(body["concepts"][0]["status"], "insufficient_data")
        self.assertEqual(body["slide_sync"]["lecturer_slide_index"], 0)
        self.assertEqual(body["slide_sync"]["tracking_coverage"], 0.0)
        self.assertTrue(body["privacy"]["identity_fields_omitted"])

        forbidden_keys = {
            "participant_id",
            "display_name",
            "token",
            "avatar",
            "email",
            "payload",
        }

        def assert_safe(value):
            if isinstance(value, dict):
                self.assertTrue(forbidden_keys.isdisjoint(value))
                for nested in value.values():
                    assert_safe(nested)
            elif isinstance(value, list):
                for nested in value:
                    assert_safe(nested)

        assert_safe(body)


if __name__ == "__main__":
    unittest.main()
