"use client";

import { io, type Socket } from "socket.io-client";
import { API_BASE } from "./api";

export interface StudentTrackingState {
  slide_index: number;
  following: boolean;
}

export interface SessionSocketHandle {
  socket: Socket;
  rejoin: () => void;
  dispose: () => void;
}


function createSessionHandle(
  payload: () => Record<string, unknown>,
): SessionSocketHandle {
  // Mỗi màn hình sở hữu một transport riêng. Nhờ vậy cleanup của route cũ chỉ
  // disconnect đúng socket đó, không thể xoá membership vừa join của route mới.
  const current = io(API_BASE, {
    path: "/socket.io",
    transports: ["websocket", "polling"],
    autoConnect: false,
  });
  let active = true;

  const rejoin = () => {
    if (!active) return;
    current.emit("join_session", payload());
  };

  current.on("connect", rejoin);
  current.connect();

  return {
    socket: current,
    rejoin,
    dispose: () => {
      if (!active) return;
      active = false;
      current.off("connect", rejoin);
      // Socket.IO tự rời toàn bộ room khi disconnect; backend cũng detach tracking.
      current.disconnect();
    },
  };
}

/**
 * Tracking chỉ bật khi token, slide hiện tại và following được gửi ngay lúc join.
 * Callback state được đọc lại mỗi lần reconnect để không dùng giá trị React đã cũ.
 */
export function joinStudentSession(
  sessionId: number,
  token: string,
  getState: () => StudentTrackingState,
): SessionSocketHandle {
  return createSessionHandle(() => ({
    session_id: sessionId,
    role: "student",
    token,
    ...getState(),
  }));
}

/** Room giảng viên chứa tín hiệu lớp nên backend bắt buộc JWT của chủ phòng. */
export function joinLecturerSession(
  sessionId: number,
  token: string,
): SessionSocketHandle {
  return createSessionHandle(() => ({
    session_id: sessionId,
    role: "lecturer",
    token,
  }));
}

/**
 * Màn hình chỉ xem — cửa sổ trình chiếu chiếu lên máy chiếu.
 *
 * Join role student nhưng KHÔNG gửi token: backend bỏ qua nhánh tracking và chỉ
 * cho vào room của buổi học, nên vẫn nhận được `slide_changed`. Cửa sổ này không
 * đại diện cho học viên nào nên cũng không được tính vào sĩ số hay tracking.
 */
export function joinPresentationView(sessionId: number): SessionSocketHandle {
  return createSessionHandle(() => ({
    session_id: sessionId,
    role: "student",
  }));
}
