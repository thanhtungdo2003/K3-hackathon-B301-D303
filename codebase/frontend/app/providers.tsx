"use client";

/**
 * Một nơi duy nhất giữ chủ đề sáng/tối và cấu hình Ant Design.
 * Tailwind dùng class `dark` trên <html>; antd dùng algorithm tương ứng,
 * hai bên đọc chung một state nên không bao giờ lệch nhau.
 */
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { App as AntApp, ConfigProvider, theme as antTheme } from "antd";
import viVN from "antd/locale/vi_VN";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const KEY = "agora-theme";

interface ThemeCtx {
  dark: boolean;
  toggle: () => void;
}

const Ctx = createContext<ThemeCtx>({ dark: false, toggle: () => {} });

export function useTheme() {
  return useContext(Ctx);
}

export default function Providers({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const isDark = localStorage.getItem(KEY) === "dark";
    setDark(isDark);
    document.documentElement.classList.toggle("dark", isDark);
  }, []);

  const toggle = useCallback(() => {
    setDark((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle("dark", next);
      localStorage.setItem(KEY, next ? "dark" : "light");
      return next;
    });
  }, []);

  const value = useMemo(() => ({ dark, toggle }), [dark, toggle]);

  return (
    <Ctx.Provider value={value}>
      <AntdRegistry>
        <ConfigProvider
          locale={viVN}
          theme={{
            algorithm: dark ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
            token: {
              // Khu giảng viên: xanh dương đậm làm chính, đỏ để nhấn, trắng làm nền.
              colorPrimary: dark ? "#4D8BFF" : "#1D4ED8",
              colorInfo: dark ? "#4D8BFF" : "#1D4ED8",
              colorLink: dark ? "#7FADFF" : "#1D4ED8",
              colorSuccess: "#0F9D58",
              colorWarning: "#E08700",
              colorError: dark ? "#FF6B6B" : "#D92B2B",
              borderRadius: 12,
              fontFamily:
                'ui-rounded, Nunito, "Segoe UI", system-ui, -apple-system, sans-serif',
              colorBgLayout: dark ? "#0a1020" : "#f4f7fd",
              colorBgContainer: dark ? "#121b2e" : "#ffffff",
              colorBorderSecondary: dark ? "#24314c" : "#dde5f3",
            },
            components: {
              Layout: {
                headerBg: dark ? "#0b1424" : "#0b2e63",
                siderBg: dark ? "#0b1424" : "#0b2e63",
                bodyBg: dark ? "#0a1020" : "#f4f7fd",
              },
              Menu: {
                itemBg: "transparent",
                darkItemBg: "transparent",
                darkSubMenuItemBg: "transparent",
              },
              Card: { headerFontSize: 15 },
            },
          }}
        >
          <AntApp>{children}</AntApp>
        </ConfigProvider>
      </AntdRegistry>
    </Ctx.Provider>
  );
}
