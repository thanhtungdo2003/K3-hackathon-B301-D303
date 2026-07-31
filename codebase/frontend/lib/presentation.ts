"use client";

/**
 * Kênh nói chuyện giữa Bục Giảng và cửa sổ trình chiếu.
 *
 * Hai cửa sổ cùng origin nên dùng BroadcastChannel: tin nhắn tới ngay lập tức,
 * không phải chờ vòng qua máy chủ. Socket.IO vẫn là nguồn đúng cuối cùng —
 * cửa sổ trình chiếu nghe cả hai, cái nào tới trước thì theo.
 */

export const PRESENT_CHANNEL = "agora-present";

export type PresentDirection = "next" | "prev" | "jump";

export type PresentMessage =
  /** Bục Giảng báo cho cửa sổ trình chiếu: đang ở slide này. */
  | { kind: "slide"; sessionId: number; index: number; dir: PresentDirection }
  /** Cửa sổ trình chiếu xin đổi slide — Bục Giảng mới là nơi gọi API. */
  | { kind: "request-slide"; sessionId: number; index: number; dir: PresentDirection }
  /** Cửa sổ trình chiếu vừa mở và cần biết đang ở đâu. */
  | { kind: "hello"; sessionId: number }
  /** Buổi học đã kết thúc. */
  | { kind: "ended"; sessionId: number };

/** Trả về null khi trình duyệt không hỗ trợ (khi đó chỉ còn socket lo việc đồng bộ). */
export function openPresentChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  return new BroadcastChannel(PRESENT_CHANNEL);
}

export function presentUrl(sessionId: number): string {
  return `/present/${sessionId}`;
}

/** Tên cửa sổ cố định để `window.open` lần sau tái dùng đúng cửa sổ đó. */
export function presentWindowName(sessionId: number): string {
  return `agora-present-${sessionId}`;
}
