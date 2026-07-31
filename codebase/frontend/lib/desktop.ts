"use client";

/**
 * Cầu nối sang vỏ Electron.
 *
 * Khi chạy trong trình duyệt thường thì `getDesktop()` trả null và phía gọi rơi
 * về `window.open` — hệ thống vẫn dùng được, chỉ là cửa sổ trình chiếu không
 * khoá được kích thước và người dùng có thể đóng nó.
 */

export interface DesktopBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DesktopBridge {
  readonly isDesktop: true;
  /** Mở (hoặc đưa lên trước) cửa sổ trình chiếu, đặt đúng khung đã cho. */
  openPresentation(url: string, bounds: DesktopBounds): Promise<boolean>;
  /** Dán cửa sổ trình chiếu vào khung mới — gọi khi bố cục đổi. */
  setPresentationBounds(bounds: DesktopBounds): Promise<boolean>;
  /** Cửa sổ trình chiếu còn mở không. */
  isPresentationOpen(): Promise<boolean>;
  /** Đóng hẳn cửa sổ trình chiếu (dùng khi rời Bục Giảng). */
  closePresentation(): Promise<boolean>;
}

declare global {
  interface Window {
    agoraDesktop?: DesktopBridge;
  }
}

export function getDesktop(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  return window.agoraDesktop ?? null;
}

export function isDesktop(): boolean {
  return getDesktop() !== null;
}

/**
 * Đổi một khung trong trang thành toạ độ màn hình.
 *
 * Trong Electron, main process cộng thêm gốc của cửa sổ cha nên chỉ cần toạ độ
 * so với viewport. Trong trình duyệt thường phải tự ước lượng phần khung trình
 * duyệt (thanh địa chỉ, viền) — nên vị trí chỉ gần đúng.
 */
export function rectToScreenBounds(rect: DOMRect): DesktopBounds {
  const chromeTop = window.outerHeight - window.innerHeight;
  const chromeSide = Math.max(0, (window.outerWidth - window.innerWidth) / 2);
  return {
    x: Math.round(window.screenX + chromeSide + rect.left),
    y: Math.round(window.screenY + chromeTop + rect.top),
    width: Math.max(320, Math.round(rect.width)),
    height: Math.max(180, Math.round(rect.height)),
  };
}

/** Khung so với viewport — Electron dùng cái này. */
export function rectToViewportBounds(rect: DOMRect): DesktopBounds {
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.max(320, Math.round(rect.width)),
    height: Math.max(180, Math.round(rect.height)),
  };
}
