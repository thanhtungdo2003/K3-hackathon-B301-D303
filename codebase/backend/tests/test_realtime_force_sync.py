from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, patch

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import realtime
from app.db import Base
from app.models import Course, LearningEvent, Participant, Room, Session, User
from app.modules.slide_tracking import AutoSyncCommand


class ForceSyncAuditTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(
            bind=self.engine,
            autoflush=False,
            expire_on_commit=False,
        )
        with self.Session() as db:
            user = User(
                email="lecturer@example.test",
                password_hash="not-used",
                full_name="Lecturer",
            )
            db.add(user)
            db.flush()
            course = Course(
                owner_id=user.id,
                title="Course",
                description="",
                subject="",
            )
            db.add(course)
            db.flush()
            room = Room(
                owner_id=user.id,
                course_id=course.id,
                code="SYNC1",
                name="Room",
            )
            db.add(room)
            db.flush()
            session = Session(
                room_id=room.id,
                title="Session",
                current_slide_index=4,
            )
            db.add(session)
            db.flush()
            participant = Participant(
                session_id=session.id,
                token="participant-token",
                display_name="Student",
                avatar="paw",
                online=True,
            )
            db.add(participant)
            db.commit()
            self.session_id = session.id
            self.participant_id = participant.id

    async def asyncTearDown(self) -> None:
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    async def test_emit_retry_reuses_one_audit_event(self) -> None:
        command = AutoSyncCommand(
            participant_id=self.participant_id,
            session_id=self.session_id,
            from_slide_index=1,
            slide_index=4,
            mismatch_seconds=300,
            mismatch_id="mismatch-1",
        )
        emit = AsyncMock(
            side_effect=[RuntimeError("temporary socket failure"), None]
        )

        with (
            patch.object(realtime, "SessionLocal", self.Session),
            patch.object(realtime.sio, "emit", new=emit),
        ):
            with self.assertRaises(RuntimeError):
                await realtime._emit_force_sync(command)
            with self.Session() as db:
                pending = db.scalar(
                    select(LearningEvent).where(
                        LearningEvent.session_id == self.session_id,
                        LearningEvent.type == "auto_slide_sync",
                    )
                )
                self.assertEqual(
                    pending.payload["delivery_status"], "pending"
                )
            delivered = await realtime._emit_force_sync(command)

        self.assertEqual(delivered, 4)
        self.assertEqual(emit.await_count, 2)
        with self.Session() as db:
            audits = db.scalar(
                select(func.count(LearningEvent.id)).where(
                    LearningEvent.session_id == self.session_id,
                    LearningEvent.participant_id == self.participant_id,
                    LearningEvent.type == "auto_slide_sync",
                )
            )
            event = db.scalar(
                select(LearningEvent).where(
                    LearningEvent.session_id == self.session_id,
                    LearningEvent.type == "auto_slide_sync",
                )
            )

        self.assertEqual(audits, 1)
        self.assertEqual(event.payload["sync_id"], command.sync_id)
        self.assertEqual(event.payload["delivery_status"], "emitted")


if __name__ == "__main__":
    unittest.main()
