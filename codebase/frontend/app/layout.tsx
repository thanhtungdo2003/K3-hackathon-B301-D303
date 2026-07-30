import type { Metadata, Viewport } from "next";
import Providers from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "AGORA — Dạy học theo thời gian thực",
  description:
    "Nền tảng giảng dạy trực tiếp: trình chiếu slide, checkpoint câu hỏi và cảnh báo lớp đang mắc ở đâu.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fffdf6" },
    { media: "(prefers-color-scheme: dark)", color: "#14171b" },
  ],
};

/**
 * Đặt class theme trước khi React hydrate để tránh nháy sáng/tối.
 * Mặc định là chủ đề sáng; chỉ bật tối khi người dùng đã tự chọn.
 */
const THEME_BOOT = `
try {
  if (localStorage.getItem('agora-theme') === 'dark') {
    document.documentElement.classList.add('dark');
  }
} catch (e) {}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="min-h-screen bg-canvas text-ink" suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
