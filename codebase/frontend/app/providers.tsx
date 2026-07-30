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
              colorPrimary: "#1CB0F6",
              colorSuccess: "#58CC02",
              colorWarning: "#FF9600",
              colorError: "#FF4B4B",
              colorInfo: "#1CB0F6",
              borderRadius: 10,
              fontFamily:
                'ui-rounded, Nunito, "Segoe UI", system-ui, -apple-system, sans-serif',
              colorBgLayout: dark ? "#14171b" : "#fffdf6",
              colorBgContainer: dark ? "#1d2126" : "#ffffff",
            },
            components: {
              Layout: {
                headerBg: dark ? "#1d2126" : "#ffffff",
                siderBg: dark ? "#1d2126" : "#ffffff",
                bodyBg: dark ? "#14171b" : "#fffdf6",
              },
              Menu: { itemBg: "transparent" },
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
