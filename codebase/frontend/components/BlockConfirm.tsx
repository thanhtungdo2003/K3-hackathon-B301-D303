"use client";

/**
 * Hộp xác nhận cho phía học viên.
 *
 * Cố tình không dùng Modal của antd: khu học viên đi theo ngôn ngữ khối (viền
 * dưới dày, nút to, icon dẫn đầu) chứ không phải tông quản trị của giảng viên.
 *
 * Hành vi: Esc hoặc bấm ra ngoài là huỷ; mở lên thì đưa con trỏ vào nút an toàn
 * và khoá cuộn nền để không bấm nhầm vào slide phía sau.
 */
import type { LucideIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { BlockButton } from "./Blocks";
import { Icon } from "./icons";

type Tone = "grass" | "sky" | "sun" | "flame" | "cherry" | "grape";

export default function BlockConfirm({
  open,
  icon: Glyph = Icon.question,
  tone = "cherry",
  title,
  description,
  confirmLabel,
  confirmIcon,
  cancelLabel = "Ở lại",
  cancelIcon = Icon.close,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  icon?: LucideIcon;
  /** Tông của nút xác nhận — việc mất mát thì dùng đỏ, việc thường thì xanh. */
  tone?: Tone;
  title: string;
  description?: string;
  confirmLabel: string;
  confirmIcon?: LucideIcon;
  cancelLabel?: string;
  cancelIcon?: LucideIcon;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Esc để huỷ + khoá cuộn nền khi hộp đang mở.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    }
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    // Con trỏ vào nút huỷ trước: bấm Enter theo quán tính sẽ không lỡ tay thoát.
    const focus = window.setTimeout(() => cancelRef.current?.focus(), 30);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(focus);
    };
  }, [open, onCancel]);

  if (!open) return null;

  const TONE_TEXT: Record<Tone, string> = {
    grass: "text-grass",
    sky: "text-sky",
    sun: "text-sun-deep",
    flame: "text-flame",
    cherry: "text-cherry",
    grape: "text-grape",
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
      style={{ background: "rgba(15, 20, 25, 0.45)" }}
      onMouseDown={(e) => {
        // Chỉ tính khi nhấn chuột xuống ở ngoài tấm — kéo chữ trong tấm rồi thả
        // ra ngoài thì không được coi là muốn huỷ.
        if (panelRef.current && !panelRef.current.contains(e.target as Node)) onCancel();
      }}
    >
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="blk-confirm-title"
        aria-describedby={description ? "blk-confirm-desc" : undefined}
        className="blk-card w-full max-w-sm animate-pop p-6"
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="grid h-16 w-16 place-items-center rounded-blk border-2 border-b-4 border-line bg-sunken">
            <Glyph aria-hidden size={30} strokeWidth={2.4} className={TONE_TEXT[tone]} />
          </span>
          <h2 id="blk-confirm-title" className="text-xl font-extrabold leading-snug">
            {title}
          </h2>
          {description ? (
            <p id="blk-confirm-desc" className="text-sm font-semibold text-muted">
              {description}
            </p>
          ) : null}
        </div>

        <div className="mt-6 flex flex-col gap-2">
          <BlockButton tone={tone} icon={confirmIcon} onClick={onConfirm} className="w-full">
            {confirmLabel}
          </BlockButton>
          <BlockButton
            ref={cancelRef}
            tone="plain"
            icon={cancelIcon}
            onClick={onCancel}
            className="w-full"
          >
            {cancelLabel}
          </BlockButton>
        </div>
      </div>
    </div>
  );
}
