"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "@/app/providers";

export type SlideBlock =
  | { type: "kicker"; text: string }
  | { type: "title"; text: string }
  | { type: "lead"; text: string }
  | { type: "bullets"; items: string[] }
  | { type: "code"; lines: string[] }
  | { type: "table"; rows: string[][] }
  | { type: "note"; text: string };

/** Khung vẽ logic 1280x720; canvas tự co giãn theo bề ngang khung chứa. */
const W = 1280;
const H = 720;
const PAD = 84;

type Palette = {
  bg: string;
  ink: string;
  muted: string;
  accent: string;
  codeBg: string;
  codeInk: string;
  noteBg: string;
  line: string;
};

const LIGHT: Palette = {
  bg: "#ffffff",
  ink: "#1f2421",
  muted: "#6d7570",
  accent: "#58cc02",
  codeBg: "#f4f1e8",
  codeInk: "#2b3330",
  noteBg: "#fff6db",
  line: "#e2ddd0",
};

const DARK: Palette = {
  bg: "#1d2126",
  ink: "#f3f5f4",
  muted: "#9aa3a0",
  accent: "#7ee23a",
  codeBg: "#262b31",
  codeInk: "#dfe6e3",
  noteBg: "#3a3320",
  line: "#363c44",
};

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function draw(ctx: CanvasRenderingContext2D, blocks: SlideBlock[], p: Palette, pageLabel: string) {
  // Nền phẳng một màu — không gradient.
  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, W, H);

  const maxWidth = W - PAD * 2;
  let y = PAD;

  for (const block of blocks) {
    switch (block.type) {
      case "kicker": {
        ctx.font = "700 26px Nunito, Segoe UI, system-ui, sans-serif";
        ctx.fillStyle = p.accent;
        ctx.fillText(block.text.toUpperCase(), PAD, y + 26);
        y += 58;
        break;
      }
      case "title": {
        ctx.font = "800 72px Nunito, Segoe UI, system-ui, sans-serif";
        ctx.fillStyle = p.ink;
        for (const line of wrap(ctx, block.text, maxWidth)) {
          ctx.fillText(line, PAD, y + 66);
          y += 84;
        }
        // gạch chân khối, màu đặc
        ctx.fillStyle = p.accent;
        ctx.fillRect(PAD, y + 4, 120, 10);
        y += 46;
        break;
      }
      case "lead": {
        ctx.font = "600 36px Nunito, Segoe UI, system-ui, sans-serif";
        ctx.fillStyle = p.muted;
        for (const line of wrap(ctx, block.text, maxWidth)) {
          ctx.fillText(line, PAD, y + 34);
          y += 50;
        }
        y += 18;
        break;
      }
      case "bullets": {
        ctx.font = "600 34px Nunito, Segoe UI, system-ui, sans-serif";
        for (const item of block.items) {
          ctx.fillStyle = p.accent;
          ctx.beginPath();
          ctx.arc(PAD + 12, y + 20, 11, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = p.ink;
          for (const line of wrap(ctx, item, maxWidth - 56)) {
            ctx.fillText(line, PAD + 46, y + 32);
            y += 46;
          }
          y += 14;
        }
        y += 12;
        break;
      }
      case "code": {
        const lineH = 38;
        const boxH = block.lines.length * lineH + 40;
        ctx.fillStyle = p.codeBg;
        ctx.beginPath();
        ctx.roundRect(PAD, y, maxWidth, boxH, 20);
        ctx.fill();
        ctx.strokeStyle = p.line;
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.font = "500 27px ui-monospace, Consolas, monospace";
        ctx.fillStyle = p.codeInk;
        block.lines.forEach((line, i) => {
          ctx.fillText(line, PAD + 28, y + 46 + i * lineH);
        });
        y += boxH + 26;
        break;
      }
      case "table": {
        // Bảng lấy từ PPTX: hàng đầu coi là tiêu đề cột.
        const rows = block.rows.filter((r) => r.length > 0);
        if (rows.length === 0) break;
        const cols = Math.max(...rows.map((r) => r.length));
        const colW = maxWidth / cols;
        const rowH = 54;
        const boxH = rows.length * rowH;

        ctx.fillStyle = p.codeBg;
        ctx.beginPath();
        ctx.roundRect(PAD, y, maxWidth, boxH, 16);
        ctx.fill();

        ctx.strokeStyle = p.line;
        ctx.lineWidth = 2;
        for (let r = 1; r < rows.length; r += 1) {
          ctx.beginPath();
          ctx.moveTo(PAD, y + r * rowH);
          ctx.lineTo(PAD + maxWidth, y + r * rowH);
          ctx.stroke();
        }
        for (let c = 1; c < cols; c += 1) {
          ctx.beginPath();
          ctx.moveTo(PAD + c * colW, y);
          ctx.lineTo(PAD + c * colW, y + boxH);
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.roundRect(PAD, y, maxWidth, boxH, 16);
        ctx.stroke();

        rows.forEach((row, r) => {
          ctx.font =
            r === 0
              ? "800 27px Nunito, Segoe UI, system-ui, sans-serif"
              : "600 27px Nunito, Segoe UI, system-ui, sans-serif";
          ctx.fillStyle = r === 0 ? p.ink : p.codeInk;
          row.slice(0, cols).forEach((cell, c) => {
            // Ô hẹp nên cắt bớt thay vì xuống dòng, giữ bảng luôn cao đều nhau.
            let text = cell ?? "";
            while (text && ctx.measureText(text).width > colW - 28) {
              text = text.slice(0, -2);
            }
            if (text !== (cell ?? "")) text = `${text}…`;
            ctx.fillText(text, PAD + c * colW + 14, y + r * rowH + 36);
          });
        });
        y += boxH + 26;
        break;
      }
      case "note": {
        ctx.font = "700 30px Nunito, Segoe UI, system-ui, sans-serif";
        const lines = wrap(ctx, block.text, maxWidth - 100);
        const boxH = lines.length * 42 + 40;
        ctx.fillStyle = p.noteBg;
        ctx.beginPath();
        ctx.roundRect(PAD, y, maxWidth, boxH, 20);
        ctx.fill();
        // Dấu nhấn vẽ bằng hình khối, không dùng emoji hay ký tự đặc biệt.
        ctx.fillStyle = p.accent;
        ctx.beginPath();
        ctx.roundRect(PAD + 22, y + 18, 10, boxH - 36, 5);
        ctx.fill();
        ctx.fillStyle = p.ink;
        lines.forEach((line, i) => ctx.fillText(line, PAD + 60, y + 48 + i * 42));
        y += boxH + 24;
        break;
      }
    }
    if (y > H - PAD) break;
  }

  ctx.font = "700 24px Nunito, Segoe UI, system-ui, sans-serif";
  ctx.fillStyle = p.muted;
  ctx.fillText(pageLabel, PAD, H - 40);
}

interface SlideLike {
  index: number;
  title: string;
  blocks: unknown[];
}

/**
 * Truyền `slide` (dạng trả về từ API) là đủ; `blocks` + `pageLabel` chỉ dùng khi
 * cần vẽ nội dung tự tạo. Chủ đề sáng/tối lấy theo theme hiện tại nếu không chỉ định.
 */
export default function SlideCanvas({
  slide,
  blocks,
  pageLabel,
  dark,
  total,
  fill,
}: {
  slide?: SlideLike;
  blocks?: SlideBlock[];
  pageLabel?: string;
  dark?: boolean;
  total?: number;
  /** Chế độ trình chiếu: lấp đầy khung cha, bỏ viền và bo góc. */
  fill?: boolean;
}) {
  const theme = useTheme();
  const isDark = dark ?? theme.dark;
  const drawnBlocks = (blocks ?? (slide?.blocks as SlideBlock[]) ?? []) as SlideBlock[];
  const label =
    pageLabel ??
    (slide
      ? `Slide ${slide.index + 1}${total ? ` / ${total}` : ""}${slide.title ? ` — ${slide.title}` : ""}`
      : "");
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textBaseline = "alphabetic";
    draw(ctx, drawnBlocks, isDark ? DARK : LIGHT, label);
  }, [drawnBlocks, label, isDark]);

  if (fill) {
    return (
      <canvas
        ref={ref}
        role="img"
        aria-label={label}
        className="block h-full w-full"
        style={{ aspectRatio: `${W} / ${H}` }}
      />
    );
  }

  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={label}
      className="block w-full rounded-blk border-2 border-b-4 border-line"
      style={{ aspectRatio: `${W} / ${H}` }}
    />
  );
}
