"use client";

/**
 * Phía Bục Giảng của chế độ trình chiếu.
 *
 * - Mở cửa sổ trình chiếu và dán nó đúng vào khung xem trước.
 * - Đẩy slide hiện tại sang cửa sổ đó mỗi khi giảng viên chuyển slide.
 * - Nhận yêu cầu chuyển slide do người dùng bấm ngay trong cửa sổ trình chiếu.
 *
 * Chạy trong Electron thì cửa sổ do main process quản (không viền, không kéo
 * được, chặn đóng). Chạy trong trình duyệt thường thì rơi về `window.open`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getDesktop,
  rectToScreenBounds,
  rectToViewportBounds,
  type DesktopBounds,
} from "./desktop";
import {
  openPresentChannel,
  presentUrl,
  presentWindowName,
  type PresentDirection,
  type PresentMessage,
} from "./presentation";

interface Options {
  sessionId: number;
  slideIndex: number;
  /** Khung xem trước trên Bục Giảng — cửa sổ trình chiếu sẽ nằm chồng lên đây. */
  anchorRef: React.RefObject<HTMLElement | null>;
  /** Người dùng bấm chuyển slide trong cửa sổ trình chiếu. */
  onRequestSlide: (index: number, dir: PresentDirection) => void;
  enabled: boolean;
}

export function usePresentation({
  sessionId,
  slideIndex,
  anchorRef,
  onRequestSlide,
  enabled,
}: Options) {
  const [open, setOpen] = useState(false);
  const channel = useRef<BroadcastChannel | null>(null);
  const popup = useRef<Window | null>(null);
  const indexRef = useRef(slideIndex);
  const requestRef = useRef(onRequestSlide);

  useEffect(() => {
    indexRef.current = slideIndex;
  }, [slideIndex]);
  useEffect(() => {
    requestRef.current = onRequestSlide;
  }, [onRequestSlide]);

  /* ── kênh nói chuyện ────────────────────────────────────────────────── */

  useEffect(() => {
    if (!enabled) return;
    const bc = openPresentChannel();
    channel.current = bc;
    if (!bc) return;

    bc.onmessage = (event: MessageEvent<PresentMessage>) => {
      const msg = event.data;
      if (!msg || msg.sessionId !== sessionId) return;
      if (msg.kind === "request-slide") {
        requestRef.current(msg.index, msg.dir);
      } else if (msg.kind === "hello") {
        // Cửa sổ trình chiếu vừa mở — nói ngay cho nó biết đang ở slide nào.
        bc.postMessage({
          kind: "slide",
          sessionId,
          index: indexRef.current,
          dir: "jump",
        } satisfies PresentMessage);
        setOpen(true);
      }
    };

    return () => {
      bc.close();
      channel.current = null;
    };
  }, [enabled, sessionId]);

  // Đẩy slide sang cửa sổ trình chiếu mỗi lần đổi.
  const lastSent = useRef<number | null>(null);
  useEffect(() => {
    if (!enabled || !channel.current) return;
    const previous = lastSent.current;
    const dir: PresentDirection =
      previous === null ? "jump" : slideIndex > previous ? "next" : "prev";
    lastSent.current = slideIndex;
    channel.current.postMessage({
      kind: "slide",
      sessionId,
      index: slideIndex,
      dir,
    } satisfies PresentMessage);
  }, [enabled, sessionId, slideIndex]);

  /* ── mở / dán vị trí ────────────────────────────────────────────────── */

  const measure = useCallback((): { screen: DesktopBounds; viewport: DesktopBounds } | null => {
    const el = anchorRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 40) return null;
    return { screen: rectToScreenBounds(rect), viewport: rectToViewportBounds(rect) };
  }, [anchorRef]);

  const openPresentation = useCallback(async () => {
    const box = measure();
    if (!box) return;

    const desktop = getDesktop();
    if (desktop) {
      await desktop.openPresentation(presentUrl(sessionId), box.viewport);
      setOpen(true);
      return;
    }

    // Trình duyệt thường: cùng tên cửa sổ nên lần sau sẽ tái dùng đúng cửa sổ đó.
    const { x, y, width, height } = box.screen;
    const features = [
      `popup=yes`,
      `width=${width}`,
      `height=${height}`,
      `left=${x}`,
      `top=${y}`,
      `menubar=no`,
      `toolbar=no`,
      `location=no`,
      `status=no`,
    ].join(",");
    const win = window.open(presentUrl(sessionId), presentWindowName(sessionId), features);
    if (win) {
      popup.current = win;
      win.focus();
      setOpen(true);
    }
  }, [measure, sessionId]);

  // Bố cục đổi thì kéo cửa sổ Electron theo cho khớp khung xem trước.
  useEffect(() => {
    if (!enabled) return;
    const desktop = getDesktop();
    if (!desktop) return;

    let frame = 0;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const box = measure();
        if (box) void desktop.setPresentationBounds(box.viewport);
      });
    };

    const observer = new ResizeObserver(sync);
    if (anchorRef.current) observer.observe(anchorRef.current);
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, true);
    sync();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, true);
    };
  }, [enabled, measure, anchorRef]);

  // Theo dõi cửa sổ popup của trình duyệt — người dùng đóng được nên phải hỏi lại.
  useEffect(() => {
    if (!enabled || getDesktop()) return;
    const timer = window.setInterval(() => {
      setOpen(Boolean(popup.current && !popup.current.closed));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [enabled]);

  // Rời Bục Giảng thì dọn cửa sổ trình chiếu theo.
  useEffect(() => {
    return () => {
      const desktop = getDesktop();
      if (desktop) void desktop.closePresentation();
      else popup.current?.close();
    };
  }, []);

  return { open, openPresentation, desktop: getDesktop() !== null };
}
