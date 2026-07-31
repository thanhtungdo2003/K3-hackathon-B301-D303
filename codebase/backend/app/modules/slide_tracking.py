"""Theo dõi slide học viên và phát lệnh tự đồng bộ sau một khoảng lệch liên tục.

Module này không phụ thuộc Socket.IO hay SQLAlchemy để có thể kiểm thử độc lập.
`realtime.py` chịu trách nhiệm xác thực socket, lưu telemetry và chuyển lệnh
`AutoSyncCommand` thành event gửi tới đúng học viên.
"""
from __future__ import annotations

import asyncio
import logging
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

StateKey = tuple[int, str]


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


@dataclass(frozen=True)
class AutoSyncCommand:
    participant_id: int
    session_id: int
    from_slide_index: int
    slide_index: int
    mismatch_seconds: int
    mismatch_id: str

    @property
    def sync_id(self) -> str:
        """Idempotency key ổn định cho một mốc lệch và một target."""
        return f"{self.mismatch_id}:{self.slide_index}"

    def as_payload(self) -> dict:
        return {
            "session_id": self.session_id,
            "slide_index": self.slide_index,
            "from_slide_index": self.from_slide_index,
            "reason": "slide_mismatch_timeout",
            "mismatch_seconds": self.mismatch_seconds,
            "sync_id": self.sync_id,
        }


@dataclass
class StudentSlideTracking:
    """Trạng thái của một màn hình/tab, không phải toàn bộ participant."""

    participant_id: int
    session_id: int
    slide_index: int
    following_lecturer: bool
    socket_id: str | None = None
    mismatch_started_at: datetime | None = None
    mismatch_started_monotonic: float | None = None
    mismatch_id: str | None = None


ForceCallback = Callable[[AutoSyncCommand], Awaitable[int | None]]
ChangeCallback = Callable[[int], Awaitable[None]]


class SlideTrackingService:
    """Nguồn sự thật runtime cho trạng thái slide của học viên trong một worker.

    Mỗi socket có trạng thái riêng để một tab đang đúng slide không che mất tab
    khác đang lệch. Mỗi participant chỉ có một timer worker; khi force thành
    công, event được gửi tới participant room nên mọi tab đều được đánh dấu theo.
    """

    def __init__(
        self,
        timeout_seconds: float,
        on_force_sync: ForceCallback,
        on_change: ChangeCallback | None = None,
        *,
        monotonic: Callable[[], float] = time.monotonic,
        utc_clock: Callable[[], datetime] = utcnow,
    ) -> None:
        if timeout_seconds <= 0:
            raise ValueError("timeout_seconds phải lớn hơn 0")
        self.timeout_seconds = timeout_seconds
        self._on_force_sync = on_force_sync
        self._on_change = on_change
        self._monotonic = monotonic
        self._utc_clock = utc_clock
        self._states: dict[StateKey, StudentSlideTracking] = {}
        self._lecturer_slides: dict[int, int] = {}
        self._lecturer_revisions: dict[int, int] = {}
        self._tasks: dict[int, asyncio.Task[None]] = {}

    async def track_student(
        self,
        *,
        participant_id: int,
        session_id: int,
        slide_index: int,
        following_lecturer: bool,
        lecturer_slide_index: int,
        socket_id: str | None = None,
    ) -> dict:
        key = self._state_key(participant_id, socket_id)
        state = self._states.get(key)
        if state is None or state.session_id != session_id:
            self._states.pop(key, None)
            state = StudentSlideTracking(
                participant_id=participant_id,
                session_id=session_id,
                slide_index=slide_index,
                following_lecturer=following_lecturer,
                socket_id=socket_id,
            )
            self._states[key] = state

        state.slide_index = slide_index
        state.following_lecturer = following_lecturer

        # Sau khi session đã có target runtime, chỉ lecturer_changed được quyền
        # thay nó. Điều này tránh một request học viên đã đọc DB cũ ghi đè event
        # đổi slide mới hơn của giảng viên.
        if session_id not in self._lecturer_slides:
            self._set_lecturer_slide(session_id, lecturer_slide_index)
        effective_lecturer_slide = self._lecturer_slides[session_id]
        self._reconcile(state, effective_lecturer_slide)
        self._reconcile_participant_timer(participant_id)
        await self._notify_change(session_id)
        return self._snapshot(state)

    async def lecturer_changed(self, session_id: int, slide_index: int) -> None:
        """Giữ nguyên mốc nếu vẫn lệch; chỉ reset khi hai màn hình trùng nhau."""
        self._set_lecturer_slide(session_id, slide_index)
        participant_ids: set[int] = set()
        for state in self._session_states(session_id):
            self._reconcile(state, slide_index)
            participant_ids.add(state.participant_id)
        for participant_id in participant_ids:
            self._reconcile_participant_timer(participant_id)
        await self._notify_change(session_id)

    async def detach_socket(self, socket_id: str) -> None:
        keys = [
            key for key, state in self._states.items() if state.socket_id == socket_id
        ]
        changed_sessions: set[int] = set()
        participant_ids: set[int] = set()
        for key in keys:
            state = self._states.pop(key)
            changed_sessions.add(state.session_id)
            participant_ids.add(state.participant_id)
        for participant_id in participant_ids:
            self._reconcile_participant_timer(participant_id)
        for session_id in changed_sessions:
            await self._notify_change(session_id)

    async def stop_student(self, participant_id: int) -> None:
        """Dọn tracking khi học viên rời lớp qua REST nhưng socket còn kết nối."""
        states = self._participant_states(participant_id)
        if not states:
            return
        changed_sessions = {state.session_id for state in states}
        for key in self._participant_keys(participant_id):
            self._states.pop(key, None)
        self._cancel_timer(participant_id)
        for session_id in changed_sessions:
            await self._notify_change(session_id)

    async def end_session(self, session_id: int) -> None:
        states = self._session_states(session_id)
        participant_ids = {state.participant_id for state in states}
        for key, state in list(self._states.items()):
            if state.session_id == session_id:
                self._states.pop(key, None)
        for participant_id in participant_ids:
            self._cancel_timer(participant_id)
        self._lecturer_slides.pop(session_id, None)
        self._lecturer_revisions.pop(session_id, None)
        await self._notify_change(session_id)

    async def close(self) -> None:
        tasks = list(self._tasks.values())
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        self._tasks.clear()
        self._states.clear()
        self._lecturer_slides.clear()
        self._lecturer_revisions.clear()

    def student_snapshot(
        self, participant_id: int, socket_id: str | None = None
    ) -> dict:
        if socket_id is not None:
            state = self._states[self._state_key(participant_id, socket_id)]
        else:
            implicit = self._states.get(self._state_key(participant_id, None))
            states = self._participant_states(participant_id)
            state = implicit or (states[0] if states else None)
            if state is None:
                raise KeyError(participant_id)
        return self._snapshot(state)

    def session_summary(
        self, session_id: int, lecturer_slide_index: int | None = None
    ) -> dict:
        states = self._session_states(session_id)
        if lecturer_slide_index is None:
            lecturer_slide_index = self._lecturer_slides.get(session_id, 0)

        by_participant: dict[int, list[StudentSlideTracking]] = {}
        for state in states:
            by_participant.setdefault(state.participant_id, []).append(state)

        aligned = sum(
            all(view.slide_index == lecturer_slide_index for view in views)
            for views in by_participant.values()
        )
        mismatched = sum(
            any(view.slide_index != lecturer_slide_index for view in views)
            for views in by_participant.values()
        )
        connected = sum(
            any(view.socket_id is not None for view in views)
            for views in by_participant.values()
        )
        return {
            "session_id": session_id,
            "lecturer_slide_index": lecturer_slide_index,
            "timeout_seconds": int(self.timeout_seconds),
            "tracked_students": len(by_participant),
            "connected_students": connected,
            "aligned_students": aligned,
            "out_of_sync_students": mismatched,
        }

    def _snapshot(self, state: StudentSlideTracking) -> dict:
        lecturer_slide_index = self._lecturer_slides.get(
            state.session_id, state.slide_index
        )
        remaining = self._remaining_seconds(state)
        deadline = (
            state.mismatch_started_at + timedelta(seconds=self.timeout_seconds)
            if state.mismatch_started_at
            else None
        )
        return {
            "session_id": state.session_id,
            "slide_index": state.slide_index,
            "lecturer_slide_index": lecturer_slide_index,
            "following_lecturer": state.following_lecturer,
            "out_of_sync": state.slide_index != lecturer_slide_index,
            "mismatch_started_at": (
                state.mismatch_started_at.isoformat()
                if state.mismatch_started_at
                else None
            ),
            "auto_sync_at": deadline.isoformat() if deadline else None,
            "remaining_seconds": remaining,
            "timeout_seconds": int(self.timeout_seconds),
        }

    @staticmethod
    def _state_key(participant_id: int, socket_id: str | None) -> StateKey:
        suffix = f"socket:{socket_id}" if socket_id is not None else "implicit"
        return participant_id, suffix

    def _participant_keys(self, participant_id: int) -> list[StateKey]:
        return [key for key in self._states if key[0] == participant_id]

    def _participant_states(self, participant_id: int) -> list[StudentSlideTracking]:
        return [
            self._states[key]
            for key in self._participant_keys(participant_id)
        ]

    def _session_states(self, session_id: int) -> list[StudentSlideTracking]:
        return [
            state
            for state in self._states.values()
            if state.session_id == session_id
        ]

    def _reconcile(
        self, state: StudentSlideTracking, lecturer_slide_index: int
    ) -> None:
        if state.following_lecturer:
            state.slide_index = lecturer_slide_index

        if state.slide_index == lecturer_slide_index:
            self._clear_mismatch(state)
            return

        if state.mismatch_started_monotonic is None:
            state.mismatch_started_monotonic = self._monotonic()
            state.mismatch_started_at = self._utc_clock()
            state.mismatch_id = uuid.uuid4().hex

    @staticmethod
    def _clear_mismatch(state: StudentSlideTracking) -> None:
        state.mismatch_started_at = None
        state.mismatch_started_monotonic = None
        state.mismatch_id = None

    def _oldest_mismatch(
        self, participant_id: int
    ) -> StudentSlideTracking | None:
        candidates: list[StudentSlideTracking] = []
        for state in self._participant_states(participant_id):
            lecturer_slide_index = self._lecturer_slides.get(
                state.session_id, state.slide_index
            )
            if (
                not state.following_lecturer
                and state.slide_index != lecturer_slide_index
                and state.mismatch_started_monotonic is not None
            ):
                candidates.append(state)
        if not candidates:
            return None
        return min(
            candidates,
            key=lambda state: state.mismatch_started_monotonic or float("inf"),
        )

    def _reconcile_participant_timer(self, participant_id: int) -> None:
        if self._oldest_mismatch(participant_id) is None:
            self._cancel_timer(participant_id)
        else:
            self._ensure_timer(participant_id)

    def _ensure_timer(self, participant_id: int) -> None:
        task = self._tasks.get(participant_id)
        if task and not task.done():
            return
        self._tasks[participant_id] = asyncio.create_task(
            self._force_after_deadline(participant_id)
        )

    async def _force_after_deadline(self, participant_id: int) -> None:
        current_task = asyncio.current_task()
        retry_delay = min(5.0, max(0.01, self.timeout_seconds / 10))
        try:
            while True:
                state = self._oldest_mismatch(participant_id)
                if state is None or state.mismatch_started_monotonic is None:
                    return
                expected_started = state.mismatch_started_monotonic
                delay = max(
                    0.0,
                    self.timeout_seconds
                    - (self._monotonic() - expected_started),
                )
                await asyncio.sleep(delay)

                state = self._oldest_mismatch(participant_id)
                if state is None or state.mismatch_started_monotonic is None:
                    continue
                expected_started = state.mismatch_started_monotonic
                elapsed = self._monotonic() - expected_started
                if elapsed < self.timeout_seconds:
                    continue

                lecturer_slide_index = self._lecturer_slides.get(
                    state.session_id, state.slide_index
                )
                lecturer_revision = self._lecturer_revisions.get(
                    state.session_id, 0
                )
                command = AutoSyncCommand(
                    participant_id=state.participant_id,
                    session_id=state.session_id,
                    from_slide_index=state.slide_index,
                    slide_index=lecturer_slide_index,
                    mismatch_seconds=max(0, round(elapsed)),
                    mismatch_id=state.mismatch_id or uuid.uuid4().hex,
                )
                try:
                    delivered_slide_index = await self._on_force_sync(command)
                except asyncio.CancelledError:
                    raise
                except Exception:  # callback DB/socket lỗi: giữ mismatch và thử lại
                    await asyncio.sleep(retry_delay)
                    continue

                participant_states = self._participant_states(participant_id)
                if delivered_slide_index is None:
                    changed_sessions = {
                        view.session_id for view in participant_states
                    }
                    for key in self._participant_keys(participant_id):
                        self._states.pop(key, None)
                    for session_id in changed_sessions:
                        await self._notify_change(session_id)
                    return

                # Nếu giảng viên đổi slide trong lúc callback đang ghi DB/phát
                # event, target vừa giao có thể đã cũ. Revision giúp nhận cả
                # trường hợp A -> B -> A (không chỉ so giá trị slide).
                current_revision = self._lecturer_revisions.get(
                    command.session_id, 0
                )
                if current_revision == lecturer_revision:
                    self._set_lecturer_slide(
                        command.session_id, delivered_slide_index
                    )
                    current_lecturer_slide = delivered_slide_index
                else:
                    current_lecturer_slide = self._lecturer_slides.get(
                        command.session_id, delivered_slide_index
                    )

                force_was_sent = (
                    delivered_slide_index != command.from_slide_index
                )
                participant_states = [
                    view
                    for view in self._participant_states(participant_id)
                    if view.session_id == command.session_id
                ]

                if force_was_sent:
                    for view in participant_states:
                        view.slide_index = delivered_slide_index

                if delivered_slide_index != current_lecturer_slide:
                    # Lệnh vừa gửi đã lỗi thời. Không đánh dấu following; mọi
                    # tab vừa nhận lệnh tiếp tục mang mốc lệch và sẽ được force
                    # lại về target mới nhất.
                    for view in participant_states:
                        view.following_lecturer = False
                        self._reconcile(view, current_lecturer_slide)
                    await self._notify_change(command.session_id)
                    await asyncio.sleep(retry_delay)
                    continue

                if force_was_sent:
                    # Event được phát tới participant room, vì vậy mọi tab của
                    # participant đều được kéo về cùng target.
                    for view in participant_states:
                        view.slide_index = delivered_slide_index
                        view.following_lecturer = True
                        self._clear_mismatch(view)
                else:
                    # DB target đã chuyển tới đúng slide đang xem nên callback
                    # không phát event. Chỉ reconcile; tuyệt đối không tự bật
                    # following_lecturer.
                    for view in participant_states:
                        self._reconcile(view, current_lecturer_slide)

                await self._notify_change(command.session_id)
                if self._oldest_mismatch(participant_id) is None:
                    return
        except asyncio.CancelledError:
            raise
        finally:
            if self._tasks.get(participant_id) is current_task:
                self._tasks.pop(participant_id, None)

    def _remaining_seconds(self, state: StudentSlideTracking) -> int | None:
        if state.mismatch_started_monotonic is None:
            return None
        elapsed = self._monotonic() - state.mismatch_started_monotonic
        return max(0, int(self.timeout_seconds - elapsed + 0.999))

    def _cancel_timer(self, participant_id: int) -> None:
        task = self._tasks.pop(participant_id, None)
        if task and task is not asyncio.current_task() and not task.done():
            task.cancel()

    def _set_lecturer_slide(self, session_id: int, slide_index: int) -> None:
        previous = self._lecturer_slides.get(session_id)
        self._lecturer_slides[session_id] = slide_index
        if previous != slide_index:
            self._lecturer_revisions[session_id] = (
                self._lecturer_revisions.get(session_id, 0) + 1
            )

    async def _notify_change(self, session_id: int) -> None:
        if self._on_change is not None:
            try:
                await self._on_change(session_id)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception(
                    "Không phát được slide_tracking_summary cho session %s",
                    session_id,
                )
