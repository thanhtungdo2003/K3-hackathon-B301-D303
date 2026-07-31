"use client";

/**
 * Chế độ trình chiếu — chỉ có slide, không có gì khác.
 *
 * Trang này chạy trong một cửa sổ riêng (Electron hoặc window.open). Nó không
 * gọi antd, không hiện thông báo, không hộp thoại: mọi thứ hiện ở đây đều lên
 * máy chiếu cho cả lớp nhìn.
 *
 * Nguồn slide dùng endpoint công khai của học viên nên cửa sổ này chạy được cả
 * khi mở trên máy khác, không cần đăng nhập.
 */
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import SlideCanvas from "@/components/SlideCanvas";
import { api, type SlideOut } from "@/lib/api";
import {
  openPresentChannel,
  type PresentDirection,
  type PresentMessage,
} from "@/lib/presentation";
import { joinPresentationView } from "@/lib/socket";

type Zone = "left" | "center" | "right";

const IDLE_MS = 3000;
const ANIM_MS = 420;
/** Bề ngang mỗi vùng bấm hai bên, tính theo phần trăm cửa sổ. */
const EDGE = 0.25;

interface Anim {
  from: number;
  to: number;
  dir: PresentDirection;
  /** false ở khung hình đầu (đặt vị trí xuất phát), true ở khung sau (chạy). */
  running: boolean;
}

export default function PresentPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = Number(params.sessionId);
  const [slides, setSlides] = useState<SlideOut[]>([]);
  const [index, setIndex] = useState(0);
  const [anim, setAnim] = useState<Anim | null>(null);

  const [zone, setZone] = useState<Zone>("center");
  const [cursorOn, setCursorOn] = useState(false);
  const [pressed, setPressed] = useState(false);
  const cursorRef = useRef<HTMLDivElement>(null);
  const idleTimer = useRef<number | null>(null);

  const channel = useRef<BroadcastChannel | null>(null);
  const indexRef = useRef(0);
  const slidesRef = useRef<SlideOut[]>([]);

  useEffect(() => {
    indexRef.current = index;
  }, [index]);
  useEffect(() => {
    slidesRef.current = slides;
  }, [slides]);

  /* ── đổi slide + hiệu ứng trượt ─────────────────────────────────────── */

  const goTo = useCallback((next: number, dir: PresentDirection) => {
    const list = slidesRef.current;
    if (!list.length) return;
    const clamped = Math.max(0, Math.min(list.length - 1, next));
    const from = indexRef.current;
    if (clamped === from) return;

    const direction: PresentDirection =
      dir === "jump" ? (clamped > from ? "next" : "prev") : dir;

    setIndex(clamped);
    setAnim({ from, to: clamped, dir: direction, running: false });
  }, []);

  // Khung hình đầu đặt vị trí xuất phát, khung sau mới bật transition —
  // nếu đặt cả hai trong một lần vẽ thì trình duyệt bỏ qua hiệu ứng.
  useEffect(() => {
    if (!anim || anim.running) return;
    const id = requestAnimationFrame(() =>
      requestAnimationFrame(() => setAnim((a) => (a ? { ...a, running: true } : a))),
    );
    return () => cancelAnimationFrame(id);
  }, [anim]);

  useEffect(() => {
    if (!anim?.running) return;
    const id = window.setTimeout(() => setAnim(null), ANIM_MS + 60);
    return () => window.clearTimeout(id);
  }, [anim]);

  /* ── nạp slide và bám theo Bục Giảng ────────────────────────────────── */

  useEffect(() => {
    if (!Number.isFinite(sessionId)) return;
    let alive = true;
    (async () => {
      const [list, state] = await Promise.all([
        api.studentSlides(sessionId).catch(() => [] as SlideOut[]),
        api.studentState(sessionId).catch(() => null),
      ]);
      if (!alive) return;
      setSlides(list);
      if (state) {
        setIndex(Math.max(0, Math.min(list.length - 1, state.current_slide_index)));
      }
    })();
    return () => {
      alive = false;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!Number.isFinite(sessionId)) return;
    const bc = openPresentChannel();
    channel.current = bc;
    if (!bc) return;

    bc.onmessage = (event: MessageEvent<PresentMessage>) => {
      const msg = event.data;
      if (!msg || msg.sessionId !== sessionId) return;
      if (msg.kind === "slide") goTo(msg.index, msg.dir);
    };
    // Vừa mở thì xin Bục Giảng cho biết đang ở slide nào.
    bc.postMessage({ kind: "hello", sessionId } satisfies PresentMessage);

    return () => {
      bc.close();
      channel.current = null;
    };
  }, [sessionId, goTo]);

  // Socket là nguồn đúng cuối cùng: cửa sổ này vẫn bám đúng slide kể cả khi
  // BroadcastChannel không dùng được (tải lại trang, mở ở trình duyệt khác).
  useEffect(() => {
    if (!Number.isFinite(sessionId)) return;
    const handle = joinPresentationView(sessionId);
    const onSlide = (p: { slide_index: number }) => goTo(p.slide_index, "jump");
    handle.socket.on("slide_changed", onSlide);
    return () => {
      handle.socket.off("slide_changed", onSlide);
      handle.dispose();
    };
  }, [sessionId, goTo]);

  /* ── điều hướng từ chính cửa sổ này ─────────────────────────────────── */

  const navigate = useCallback(
    (dir: "next" | "prev") => {
      const target = indexRef.current + (dir === "next" ? 1 : -1);
      const list = slidesRef.current;
      if (target < 0 || target >= list.length || !Number.isFinite(sessionId)) return;

      goTo(target, dir);
      // Bục Giảng mới là nơi có quyền gọi API đổi slide cho cả lớp.
      channel.current?.postMessage({
        kind: "request-slide",
        sessionId,
        index: target,
        dir,
      } satisfies PresentMessage);
    },
    [goTo, sessionId],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (["ArrowRight", "PageDown", " ", "Enter"].includes(e.key)) {
        e.preventDefault();
        navigate("next");
      } else if (["ArrowLeft", "PageUp", "Backspace"].includes(e.key)) {
        e.preventDefault();
        navigate("prev");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  /* ── con trỏ ba vùng, tự ẩn sau 3 giây ──────────────────────────────── */

  const wake = useCallback(() => {
    setCursorOn(true);
    if (idleTimer.current) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setCursorOn(false), IDLE_MS);
  }, []);

  useEffect(() => () => {
    if (idleTimer.current) window.clearTimeout(idleTimer.current);
  }, []);

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    // Đặt bằng style trực tiếp: chuột di liên tục, đi qua React state sẽ giật.
    const el = cursorRef.current;
    if (el) el.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`;

    setZone(zoneAt(e.clientX));
    wake();
  }

  /** Tính vùng ngay từ toạ độ cú bấm — không tin state cũ. */
  function zoneAt(clientX: number): Zone {
    const ratio = clientX / window.innerWidth;
    return ratio < EDGE ? "left" : ratio > 1 - EDGE ? "right" : "center";
  }

  function onClick(e: React.MouseEvent<HTMLDivElement>) {
    // Chuột có thể bị đặt thẳng vào chỗ mới rồi bấm luôn (điều khiển từ xa,
    // bút trình chiếu, hoặc cú bấm đầu tiên) — lúc đó chưa có pointermove nào.
    const hit = zoneAt(e.clientX);
    if (hit === "left") navigate("prev");
    else if (hit === "right") navigate("next");
  }

  /* ── vẽ ─────────────────────────────────────────────────────────────── */

  const total = slides.length;
  const current = slides[index] ?? null;
  const outgoing = anim ? (slides[anim.from] ?? null) : null;

  // Slide đang đi ra trượt sang một bên; slide mới đi vào từ phía đối diện.
  const enterFrom = anim ? (anim.dir === "next" ? "100%" : "-100%") : "0%";
  const leaveTo = anim ? (anim.dir === "next" ? "-100%" : "100%") : "0%";

  return (
    <div
      className="agora-present-stage"
      onPointerMove={onPointerMove}
      onPointerDown={() => {
        setPressed(true);
        wake();
      }}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => {
        setPressed(false);
        setCursorOn(false);
      }}
      onClick={onClick}
    >
      {/* lớp slide đang đi ra */}
      {outgoing ? (
        <div
          className="agora-present-layer"
          data-animate={anim?.running ? "true" : "false"}
          style={{ transform: `translateX(${anim?.running ? leaveTo : "0%"})` }}
          aria-hidden
        >
          <Stage slide={outgoing} total={total} />
        </div>
      ) : null}

      {/* lớp slide đang hiện */}
      {current ? (
        <div
          className="agora-present-layer"
          data-animate={anim?.running ? "true" : "false"}
          style={{ transform: `translateX(${anim && !anim.running ? enterFrom : "0%"})` }}
        >
          <Stage slide={current} total={total} />
        </div>
      ) : null}

      {/* chevron bám chuột */}
      <div
        ref={cursorRef}
        className="agora-present-cursor"
        data-visible={cursorOn ? "true" : "false"}
        data-zone={zone}
        data-pressed={pressed ? "true" : "false"}
        aria-hidden
      >
        {zone === "left" ? <Chevron dir="left" /> : null}
        {zone === "right" ? <Chevron dir="right" /> : null}
      </div>
    </div>
  );
}

/** Khung 16:9 lớn nhất vừa cửa sổ — slide không bao giờ bị méo. */
function Stage({ slide, total }: { slide: SlideOut; total: number }) {
  return (
    <div
      style={{
        width: "min(100vw, calc(100vh * 16 / 9))",
        height: "min(100vh, calc(100vw * 9 / 16))",
      }}
    >
      <SlideCanvas slide={slide} total={total} dark={false} fill />
    </div>
  );
}

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg
      width="30"
      height="30"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points={dir === "left" ? "15 18 9 12 15 6" : "9 18 15 12 9 6"} />
    </svg>
  );
}
