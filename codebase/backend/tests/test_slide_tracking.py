from __future__ import annotations

import asyncio
import unittest

from app.modules.slide_tracking import AutoSyncCommand, SlideTrackingService


class SlideTrackingServiceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.commands: list[AutoSyncCommand] = []
        self.changed_sessions: list[int] = []

        async def on_force(command: AutoSyncCommand) -> int:
            self.commands.append(command)
            return command.slide_index

        async def on_change(session_id: int) -> None:
            self.changed_sessions.append(session_id)

        self.service = SlideTrackingService(
            0.03,
            on_force_sync=on_force,
            on_change=on_change,
        )

    async def asyncTearDown(self) -> None:
        await self.service.close()

    async def test_forces_latest_lecturer_slide_after_timeout(self) -> None:
        await self.service.track_student(
            participant_id=10,
            session_id=4,
            slide_index=1,
            following_lecturer=False,
            lecturer_slide_index=3,
            socket_id="student-socket",
        )
        await self.service.lecturer_changed(4, 5)
        await asyncio.sleep(0.08)

        self.assertEqual(len(self.commands), 1)
        self.assertEqual(self.commands[0].from_slide_index, 1)
        self.assertEqual(self.commands[0].slide_index, 5)
        snapshot = self.service.student_snapshot(10)
        self.assertEqual(snapshot["slide_index"], 5)
        self.assertTrue(snapshot["following_lecturer"])
        self.assertFalse(snapshot["out_of_sync"])

    async def test_continuous_mismatch_keeps_original_deadline(self) -> None:
        first = await self.service.track_student(
            participant_id=11,
            session_id=4,
            slide_index=1,
            following_lecturer=False,
            lecturer_slide_index=3,
        )
        second = await self.service.track_student(
            participant_id=11,
            session_id=4,
            slide_index=2,
            following_lecturer=False,
            lecturer_slide_index=4,
        )
        await self.service.lecturer_changed(4, 5)
        third = self.service.student_snapshot(11)

        self.assertEqual(first["mismatch_started_at"], second["mismatch_started_at"])
        self.assertEqual(first["mismatch_started_at"], third["mismatch_started_at"])
        self.assertEqual(first["auto_sync_at"], third["auto_sync_at"])

    async def test_matching_slide_cancels_pending_force(self) -> None:
        await self.service.track_student(
            participant_id=12,
            session_id=4,
            slide_index=1,
            following_lecturer=False,
            lecturer_slide_index=3,
        )
        matched = await self.service.track_student(
            participant_id=12,
            session_id=4,
            slide_index=3,
            following_lecturer=False,
            lecturer_slide_index=3,
        )
        await asyncio.sleep(0.06)

        self.assertIsNone(matched["mismatch_started_at"])
        self.assertEqual(self.commands, [])

    async def test_following_student_moves_with_lecturer(self) -> None:
        await self.service.track_student(
            participant_id=13,
            session_id=4,
            slide_index=1,
            following_lecturer=True,
            lecturer_slide_index=1,
            socket_id="socket-a",
        )
        await self.service.lecturer_changed(4, 6)

        snapshot = self.service.student_snapshot(13)
        self.assertEqual(snapshot["slide_index"], 6)
        self.assertFalse(snapshot["out_of_sync"])
        self.assertIsNone(snapshot["remaining_seconds"])

    async def test_public_summary_is_anonymous(self) -> None:
        await self.service.track_student(
            participant_id=999,
            session_id=8,
            slide_index=2,
            following_lecturer=False,
            lecturer_slide_index=4,
            socket_id="socket-secret",
        )

        summary = self.service.session_summary(8)
        self.assertEqual(summary["tracked_students"], 1)
        self.assertNotIn("students", summary)
        self.assertNotIn("participant_id", summary)

    async def test_last_disconnect_cancels_pending_force(self) -> None:
        await self.service.track_student(
            participant_id=14,
            session_id=9,
            slide_index=1,
            following_lecturer=False,
            lecturer_slide_index=4,
            socket_id="only-socket",
        )
        await self.service.detach_socket("only-socket")
        await asyncio.sleep(0.06)

        self.assertEqual(self.commands, [])
        self.assertEqual(self.service.session_summary(9)["tracked_students"], 0)

    async def test_one_of_multiple_sockets_can_disconnect_without_reset(self) -> None:
        await self.service.track_student(
            participant_id=15,
            session_id=9,
            slide_index=1,
            following_lecturer=False,
            lecturer_slide_index=4,
            socket_id="socket-a",
        )
        await self.service.track_student(
            participant_id=15,
            session_id=9,
            slide_index=1,
            following_lecturer=False,
            lecturer_slide_index=4,
            socket_id="socket-b",
        )
        await self.service.detach_socket("socket-a")
        await asyncio.sleep(0.06)

        self.assertEqual(len(self.commands), 1)

    async def test_callback_failure_retries_without_losing_mismatch(self) -> None:
        attempts = 0
        commands: list[AutoSyncCommand] = []

        async def flaky_force(command: AutoSyncCommand) -> int:
            nonlocal attempts
            attempts += 1
            commands.append(command)
            if attempts == 1:
                raise RuntimeError("temporary socket failure")
            return command.slide_index

        service = SlideTrackingService(0.02, on_force_sync=flaky_force)
        try:
            await service.track_student(
                participant_id=16,
                session_id=10,
                slide_index=1,
                following_lecturer=False,
                lecturer_slide_index=4,
                socket_id="socket-c",
            )
            await asyncio.sleep(0.08)

            self.assertGreaterEqual(attempts, 2)
            self.assertFalse(service.student_snapshot(16)["out_of_sync"])
        finally:
            await service.close()

    async def test_lecturer_change_during_force_retries_latest_target(self) -> None:
        first_force_started = asyncio.Event()
        release_first_force = asyncio.Event()
        commands: list[AutoSyncCommand] = []

        async def delayed_force(command: AutoSyncCommand) -> int:
            commands.append(command)
            if len(commands) == 1:
                first_force_started.set()
                await release_first_force.wait()
            return command.slide_index

        service = SlideTrackingService(0.02, on_force_sync=delayed_force)
        try:
            await service.track_student(
                participant_id=17,
                session_id=11,
                slide_index=1,
                following_lecturer=False,
                lecturer_slide_index=4,
                socket_id="socket-race",
            )
            await asyncio.wait_for(first_force_started.wait(), timeout=0.2)
            await service.lecturer_changed(11, 5)
            release_first_force.set()
            await asyncio.sleep(0.08)

            self.assertEqual([command.slide_index for command in commands], [4, 5])
            snapshot = service.student_snapshot(17)
            self.assertEqual(snapshot["slide_index"], 5)
            self.assertEqual(snapshot["lecturer_slide_index"], 5)
            self.assertTrue(snapshot["following_lecturer"])
            self.assertFalse(snapshot["out_of_sync"])
            self.assertIsNone(snapshot["mismatch_started_at"])
        finally:
            await service.close()

    async def test_rest_leave_stops_student_and_pending_force(self) -> None:
        await self.service.track_student(
            participant_id=18,
            session_id=12,
            slide_index=1,
            following_lecturer=False,
            lecturer_slide_index=4,
            socket_id="socket-still-open",
        )

        await self.service.stop_student(18)
        await asyncio.sleep(0.06)

        self.assertEqual(self.commands, [])
        self.assertEqual(self.service.session_summary(12)["tracked_students"], 0)

    async def test_inactive_force_callback_removes_tracking_state(self) -> None:
        async def inactive_force(command: AutoSyncCommand) -> None:
            return None

        service = SlideTrackingService(0.02, on_force_sync=inactive_force)
        try:
            await service.track_student(
                participant_id=19,
                session_id=13,
                slide_index=1,
                following_lecturer=False,
                lecturer_slide_index=4,
                socket_id="socket-inactive",
            )
            await asyncio.sleep(0.05)

            self.assertEqual(service.session_summary(13)["tracked_students"], 0)
        finally:
            await service.close()

    async def test_summary_emit_failure_does_not_break_tracking(self) -> None:
        async def on_force(command: AutoSyncCommand) -> int:
            return command.slide_index

        async def broken_summary(session_id: int) -> None:
            raise RuntimeError("assistant socket unavailable")

        service = SlideTrackingService(
            0.02,
            on_force_sync=on_force,
            on_change=broken_summary,
        )
        try:
            with self.assertLogs(
                "app.modules.slide_tracking", level="ERROR"
            ) as captured:
                snapshot = await service.track_student(
                    participant_id=20,
                    session_id=14,
                    slide_index=2,
                    following_lecturer=False,
                    lecturer_slide_index=2,
                    socket_id="socket-summary-error",
                )

            self.assertFalse(snapshot["out_of_sync"])
            self.assertEqual(service.session_summary(14)["tracked_students"], 1)
            self.assertIn("slide_tracking_summary", captured.output[0])
        finally:
            await service.close()

    async def test_noop_force_does_not_enable_follow_mode(self) -> None:
        commands: list[AutoSyncCommand] = []

        async def force_or_noop(command: AutoSyncCommand) -> int:
            commands.append(command)
            if len(commands) == 1:
                # Mô phỏng DB cho biết giảng viên vừa chuyển đúng tới slide
                # học viên: callback không cần phát force_slide_sync.
                return command.from_slide_index
            return command.slide_index

        service = SlideTrackingService(0.02, on_force_sync=force_or_noop)
        try:
            await service.track_student(
                participant_id=21,
                session_id=15,
                slide_index=1,
                following_lecturer=False,
                lecturer_slide_index=4,
                socket_id="socket-noop",
            )
            await asyncio.sleep(0.05)

            aligned = service.student_snapshot(21, "socket-noop")
            self.assertEqual(aligned["slide_index"], 1)
            self.assertEqual(aligned["lecturer_slide_index"], 1)
            self.assertFalse(aligned["following_lecturer"])
            self.assertIsNone(aligned["mismatch_started_at"])

            await service.lecturer_changed(15, 5)
            await asyncio.sleep(0.05)

            self.assertEqual(len(commands), 2)
            forced = service.student_snapshot(21, "socket-noop")
            self.assertEqual(forced["slide_index"], 5)
            self.assertTrue(forced["following_lecturer"])
        finally:
            await service.close()

    async def test_aligned_tab_does_not_hide_another_mismatched_tab(self) -> None:
        await self.service.track_student(
            participant_id=22,
            session_id=16,
            slide_index=1,
            following_lecturer=False,
            lecturer_slide_index=4,
            socket_id="wrong-tab",
        )
        await self.service.track_student(
            participant_id=22,
            session_id=16,
            slide_index=4,
            following_lecturer=False,
            lecturer_slide_index=4,
            socket_id="aligned-tab",
        )
        before = self.service.session_summary(16)
        self.assertEqual(before["tracked_students"], 1)
        self.assertEqual(before["out_of_sync_students"], 1)
        self.assertEqual(before["aligned_students"], 0)

        await asyncio.sleep(0.08)

        self.assertEqual(len(self.commands), 1)
        for socket_id in ("wrong-tab", "aligned-tab"):
            snapshot = self.service.student_snapshot(22, socket_id)
            self.assertEqual(snapshot["slide_index"], 4)
            self.assertTrue(snapshot["following_lecturer"])
        after = self.service.session_summary(16)
        self.assertEqual(after["aligned_students"], 1)
        self.assertEqual(after["out_of_sync_students"], 0)


if __name__ == "__main__":
    unittest.main()
