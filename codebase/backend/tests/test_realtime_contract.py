from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, patch

from app import realtime
from app.realtime import _strict_bool


class RealtimeContractTests(unittest.TestCase):
    def test_following_requires_real_json_boolean(self) -> None:
        self.assertTrue(_strict_bool(True, False))
        self.assertFalse(_strict_bool(False, True))
        self.assertTrue(_strict_bool(None, True))
        with self.assertRaises(ValueError):
            _strict_bool("false", False)


class RealtimeSessionLifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def test_leave_clears_socket_session_and_detaches_tracking(self) -> None:
        socket_session = {
            "session_id": 7,
            "role": "student",
            "participant_id": 11,
            "tracking_authorized": False,
        }
        with (
            patch.object(
                realtime.sio,
                "get_session",
                new=AsyncMock(return_value=socket_session),
            ),
            patch.object(realtime.sio, "leave_room", new=AsyncMock()) as leave_room,
            patch.object(realtime.sio, "save_session", new=AsyncMock()) as save_session,
            patch.object(
                realtime.tracking,
                "detach_socket",
                new=AsyncMock(),
            ) as detach_socket,
        ):
            result = await realtime.leave_session("student-sid", {})

        self.assertEqual(result, {"ok": True})
        self.assertEqual(leave_room.await_count, 2)
        detach_socket.assert_awaited_once_with("student-sid")
        save_session.assert_awaited_once_with("student-sid", {})

    async def test_invalid_rejoin_keeps_previous_membership(self) -> None:
        previous = {
            "session_id": 7,
            "role": "student",
            "participant_id": 11,
            "tracking_authorized": False,
        }
        with (
            patch.object(
                realtime.sio,
                "get_session",
                new=AsyncMock(return_value=previous),
            ) as get_session,
            patch.object(realtime.sio, "leave_room", new=AsyncMock()) as leave_room,
            patch.object(realtime.sio, "emit", new=AsyncMock()),
            patch.object(
                realtime.tracking,
                "detach_socket",
                new=AsyncMock(),
            ) as detach_socket,
            patch.object(
                realtime,
                "_student_context",
                return_value="Token không hợp lệ.",
            ),
        ):
            result = await realtime.join_session(
                "student-sid",
                {
                    "session_id": 8,
                    "role": "student",
                    "token": "invalid",
                    "slide_index": 0,
                    "following": False,
                },
            )

        self.assertFalse(result["ok"])
        self.assertEqual(result["code"], "unauthorized_tracking")
        get_session.assert_not_awaited()
        leave_room.assert_not_awaited()
        detach_socket.assert_not_awaited()

    async def test_lecturer_room_requires_owner_jwt(self) -> None:
        with (
            patch.object(realtime.sio, "enter_room", new=AsyncMock()) as enter_room,
            patch.object(realtime.sio, "emit", new=AsyncMock()),
            patch.object(
                realtime,
                "_authorized_lecturer_slide",
                return_value=None,
            ),
        ):
            result = await realtime.join_session(
                "attacker-sid",
                {"session_id": 7, "role": "lecturer"},
            )

        self.assertFalse(result["ok"])
        self.assertEqual(result["code"], "unauthorized_lecturer")
        enter_room.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
