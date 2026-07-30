"use client";

/** Các khối dựng lưới Bento cho dashboard. Nền phẳng, không gradient. */
import type { ReactNode } from "react";

type Span = 2 | 3 | 4 | 6;
type Tone = "plain" | "navy" | "red";

export function BentoGrid({ children }: { children: ReactNode }) {
  return <div className="bento">{children}</div>;
}

export function BentoCard({
  span = 2,
  tone = "plain",
  title,
  extra,
  children,
  className = "",
}: {
  span?: Span;
  tone?: Tone;
  title?: ReactNode;
  extra?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const toneClass = tone === "navy" ? "bento-card--navy" : tone === "red" ? "bento-card--red" : "";
  return (
    <section className={`bento-card span-${span} ${toneClass} ${className}`}>
      {title || extra ? (
        <div className="flex items-start justify-between gap-2">
          {title ? <div className="bento-label">{title}</div> : <span />}
          {extra}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Ô số liệu: nhãn nhỏ, số lớn, chú thích dưới. */
export function BentoStat({
  label,
  value,
  hint,
  icon,
  tone = "plain",
  span = 2,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: Tone;
  span?: Span;
}) {
  return (
    <BentoCard span={span} tone={tone}>
      <div className="flex items-start justify-between gap-2">
        <span className="bento-label">{label}</span>
        {icon ? (
          <span
            className="grid h-8 w-8 shrink-0 place-items-center rounded-xl"
            style={{
              background: tone === "navy" ? "rgba(255,255,255,.14)" : "var(--ai-blue-tint)",
              color: tone === "navy" ? "#fff" : "var(--ai-navy-soft)",
            }}
          >
            {icon}
          </span>
        ) : null}
      </div>
      <div className="bento-value">{value}</div>
      {hint ? (
        <div className="text-xs font-semibold" style={{ color: "var(--ai-muted)" }}>
          {hint}
        </div>
      ) : null}
    </BentoCard>
  );
}

/** Thanh tỉ lệ phẳng — xanh khi ổn, đỏ khi thấp. */
export function BentoBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  const color = value >= 0.6 ? "#0F9D58" : value >= 0.4 ? "#E08700" : "var(--ai-red)";
  return (
    <div className="flex items-center gap-3">
      <div
        className="h-2 flex-1 overflow-hidden rounded-full"
        style={{ background: "var(--ai-blue-tint)" }}
      >
        <div style={{ width: `${pct}%`, height: "100%", background: color }} />
      </div>
      <span className="text-sm font-extrabold tabular-nums" style={{ color }}>
        {pct}%
      </span>
    </div>
  );
}
