import type { Config } from "tailwindcss";

/**
 * Bảng màu tươi sáng, phẳng — KHÔNG dùng gradient ở bất kỳ nền nào.
 * Chiều sâu tạo bằng viền dưới dày (khối) chứ không phải đổ bóng mờ hay chuyển sắc.
 */
const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "var(--c-canvas)",
        surface: "var(--c-surface)",
        sunken: "var(--c-sunken)",
        line: "var(--c-line)",
        ink: "var(--c-ink)",
        muted: "var(--c-muted)",
        grass: { DEFAULT: "#58CC02", deep: "#3F9E00" },
        sky: { DEFAULT: "#1CB0F6", deep: "#1487BD" },
        sun: { DEFAULT: "#FFC800", deep: "#D9A800" },
        flame: { DEFAULT: "#FF9600", deep: "#D67C00" },
        cherry: { DEFAULT: "#FF4B4B", deep: "#D63A3A" },
        grape: { DEFAULT: "#CE82FF", deep: "#A863D6" },
      },
      borderRadius: { blk: "1.15rem" },
      fontFamily: {
        sans: ["ui-rounded", "Nunito", "Segoe UI", "system-ui", "sans-serif"],
      },
      keyframes: {
        pop: { "0%": { transform: "scale(.94)", opacity: "0" }, "100%": { transform: "scale(1)", opacity: "1" } },
        nudge: { "0%,100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-4px)" } },
      },
      animation: { pop: "pop .18s ease-out", nudge: "nudge 1.6s ease-in-out infinite" },
    },
  },
  plugins: [],
};

export default config;
