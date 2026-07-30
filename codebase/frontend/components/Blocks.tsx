"use client";

import type { LucideIcon } from "lucide-react";
import { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, Ref, forwardRef } from "react";

type Tone = "grass" | "sky" | "sun" | "flame" | "cherry" | "grape" | "plain" | "warning" | "error" | "success";

const TONE: Record<Tone, string> = {
  grass: "bg-grass border-grass-deep text-white",
  sky: "bg-sky border-sky-deep text-white",
  sun: "bg-sun border-sun-deep text-[#3b2f00]",
  flame: "bg-flame border-flame-deep text-white",
  cherry: "bg-cherry border-cherry-deep text-white",
  grape: "bg-grape border-grape-deep text-white",
  plain: "bg-surface border-line text-ink",
  warning: "bg-[#cb4343] border-[#ffadad] text-white",
  error: "bg-error border-error-deep text-white",
  success: "bg-success border-success-deep text-white",
};

interface BlockButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: Tone;
  /** Component icon từ lucide-react, ví dụ Icon.rocket */
  icon?: LucideIcon;
  /** Nút chỉ có icon — bắt buộc kèm aria-label để trình đọc màn hình hiểu được. */
  square?: boolean;
  /** React 19 cho phép truyền ref thẳng qua props, không cần forwardRef. */
  ref?: Ref<HTMLButtonElement>;
}

export function BlockButton({
  tone = "grass",
  icon: Glyph,
  square,
  className = "",
  children,
  ref,
  ...rest
}: BlockButtonProps) {
  return (
    <button
      {...rest}
      ref={ref}
      className={`blk border-2 ${TONE[tone]} ${square ? "h-14 w-14 px-0" : ""} ${className}`}
    >
      {Glyph ? <Glyph aria-hidden size={square ? 24 : 20} strokeWidth={2.6} /> : null}
      {children}
    </button>
  );
}

export const BlockInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function BlockInput({ className = "", ...rest }, ref) {
    return <input ref={ref} {...rest} className={`blk-input ${className}`} />;
  },
);

export function BlockCard({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={`blk-card ${className}`}>{children}</div>;
}

/** Thanh tiến trình phẳng, không gradient. */
export function BlockBar({ value, tone = "grass" }: { value: number; tone?: Tone }) {
  const fill: Record<Tone, string> = {
    grass: "bg-grass",
    sky: "bg-sky",
    sun: "bg-sun",
    flame: "bg-flame",
    cherry: "bg-cherry",
    grape: "bg-grape",
    plain: "bg-muted",
    warning: "bg-warning",
    error: "bg-error",
    success: "bg-success",
  };
  return (
    <div className="h-4 w-full overflow-hidden rounded-full bg-sunken">
      <div
        className={`h-full rounded-full ${fill[tone]} transition-[width] duration-300`}
        style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }}
      />
    </div>
  );
}

/** Ô số liệu: icon dẫn đầu, chữ chỉ là nhãn phụ nhỏ. */
export function StatTile({
  icon: Glyph,
  value,
  label,
  tone = "plain",
}: {
  icon: LucideIcon;
  value: string;
  label: string;
  tone?: Tone;
}) {
  const ring: Record<Tone, string> = {
    grass: "border-grass",
    sky: "border-sky",
    sun: "border-sun",
    flame: "border-flame",
    cherry: "border-cherry",
    grape: "border-grape",
    plain: "border-line",
    warning: "border-warning",
    error: "border-error",
    success: "border-success",
  };
  const ink: Record<Tone, string> = {
    grass: "text-grass",
    sky: "text-sky",
    sun: "text-sun-deep",
    flame: "text-flame",
    cherry: "text-cherry",
    grape: "text-grape",
    plain: "text-muted",
    warning: "text-warning",
    error: "text-error",
    success: "text-success",
  };
  return (
    <div className={`blk-card ${ring[tone]} flex flex-col items-center gap-1 px-3 py-4`}>
      <Glyph aria-hidden size={28} strokeWidth={2.4} className={ink[tone]} />
      <span className="text-2xl font-extrabold tabular-nums">{value}</span>
      <span className="text-center text-xs font-bold uppercase tracking-wide text-muted">{label}</span>
    </div>
  );
}
