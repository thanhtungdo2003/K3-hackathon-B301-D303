"use client";

/**
 * "Slidebox" — khối nội dung mô phỏng một trang slide.
 * Trang giới thiệu dùng các khối này thay cho đoạn văn dài: mỗi ý một khối,
 * đọc lướt được như đang lật slide. Nền phẳng, không gradient.
 */
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

type Tone = "grass" | "sky" | "sun" | "flame" | "cherry" | "grape" | "plain";

const BAR: Record<Tone, string> = {
  grass: "bg-grass",
  sky: "bg-sky",
  sun: "bg-sun",
  flame: "bg-flame",
  cherry: "bg-cherry",
  grape: "bg-grape",
  plain: "bg-muted",
};

const INK: Record<Tone, string> = {
  grass: "text-grass",
  sky: "text-sky",
  sun: "text-sun-deep",
  flame: "text-flame",
  cherry: "text-cherry",
  grape: "text-grape",
  plain: "text-muted",
};

export function Slidebox({
  icon: Glyph,
  tone = "sky",
  step,
  title,
  children,
  className = "",
}: {
  icon: LucideIcon;
  tone?: Tone;
  step?: string;
  title: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <article className={`blk-card overflow-hidden ${className}`}>
      <div className={`h-2 w-full ${BAR[tone]}`} />
      <div className="flex h-full flex-col gap-3 p-5">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-blk border-2 border-line bg-sunken">
            <Glyph aria-hidden size={24} strokeWidth={2.4} className={INK[tone]} />
          </span>
          {step ? (
            <span className="text-xs font-extrabold uppercase tracking-widest text-muted">
              {step}
            </span>
          ) : null}
        </div>
        <h3 className="text-lg font-extrabold leading-snug">{title}</h3>
        <div className="text-sm font-semibold leading-relaxed text-muted">{children}</div>
      </div>
    </article>
  );
}

/** Nhãn phần — icon dẫn đầu, chữ chỉ là phụ đề nhỏ. */
export function SectionLabel({
  icon: Glyph,
  children,
}: {
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <div className="mb-6 flex items-center gap-3">
      <span className="grid h-11 w-11 place-items-center rounded-blk border-2 border-b-4 border-line bg-surface">
        <Glyph aria-hidden size={22} strokeWidth={2.5} className="text-ink" />
      </span>
      <h2 className="text-xl font-extrabold tracking-tight sm:text-2xl">{children}</h2>
    </div>
  );
}
