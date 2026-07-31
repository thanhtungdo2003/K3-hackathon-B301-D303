"use client";

/** Khung chung cho trang đăng ký / đăng nhập. */
import Link from "next/link";
import type { ReactNode } from "react";
import ThemeToggle from "./ThemeToggle";
import { Icon } from "./icons";

export default function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 py-6">
      <header className="mb-10 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-blk border-2 border-b-4 border-line bg-surface">
            <Icon.brand aria-hidden size={22} strokeWidth={2.5} className="text-sky" />
          </span>
          <span className="text-xl font-extrabold tracking-tight">VINLEARN</span>
        </Link>
        <ThemeToggle />
      </header>

      <div className="flex flex-1 flex-col justify-center">
        <h1 className="mb-1 text-3xl font-extrabold tracking-tight">{title}</h1>
        <p className="mb-8 text-sm font-semibold text-muted">{subtitle}</p>
        {children}
      </div>

      <footer className="mt-8 text-center text-sm font-bold text-muted">{footer}</footer>
    </main>
  );
}

/** Nhãn ô nhập: icon dẫn đầu, chữ nhỏ phía sau. */
export function Field({
  icon: Glyph,
  label,
  children,
}: {
  icon: typeof Icon.mail;
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 flex items-center gap-2 text-xs font-extrabold uppercase tracking-widest text-muted">
        <Glyph aria-hidden size={15} strokeWidth={2.8} />
        {label}
      </span>
      {children}
    </label>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p className="flex items-start gap-2 rounded-blk border-2 border-cherry bg-surface px-4 py-3 text-sm font-bold text-cherry">
      <Icon.warn aria-hidden size={18} strokeWidth={2.6} className="mt-0.5 shrink-0" />
      {children}
    </p>
  );
}
