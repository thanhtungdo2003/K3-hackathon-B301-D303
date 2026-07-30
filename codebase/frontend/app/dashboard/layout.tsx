"use client";

/**
 * Khu quản trị của chủ phòng — Ant Design, bảng màu xanh dương đậm / đỏ / trắng.
 * Class `ai-shell` mở bộ biến màu riêng cho cả khu này (xem globals.css).
 */
import {
  AppstoreOutlined,
  BookOutlined,
  DesktopOutlined,
  LogoutOutlined,
  MoonOutlined,
  RobotOutlined,
  SunOutlined,
} from "@ant-design/icons";
import { Avatar, Button, Dropdown, Layout, Menu, Spin, Tooltip, Typography } from "antd";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo } from "react";
import { useTheme } from "@/app/providers";
import { logout, useAuth } from "@/lib/auth";

const { Header, Sider, Content } = Layout;

const NAV = [
  { key: "/dashboard", icon: <AppstoreOutlined />, label: "Trợ lý & tổng quan" },
  { key: "/dashboard/courses", icon: <BookOutlined />, label: "Khoá học" },
  { key: "/dashboard/rooms", icon: <DesktopOutlined />, label: "Phòng học" },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const { dark, toggle } = useTheme();
  const pathname = usePathname();
  const router = useRouter();

  const selected = useMemo(() => {
    const hit = NAV.filter((n) => pathname === n.key || pathname.startsWith(n.key + "/"))
      .sort((a, b) => b.key.length - a.key.length)
      .at(0);
    return hit ? [hit.key] : ["/dashboard"];
  }, [pathname]);

  if (loading || !user) {
    return (
      <div className="ai-shell grid min-h-screen place-items-center">
        <Spin size="large" />
      </div>
    );
  }

  const initials = user.full_name.trim().slice(0, 1).toUpperCase() || "?";

  return (
    <Layout className="ai-shell" style={{ minHeight: "100vh" }}>
      {/* Sider nền xanh dương đậm, chữ trắng — dùng theme="dark" của antd cho đúng tương phản. */}
      <Sider theme="dark" breakpoint="lg" width={230} collapsedWidth={64}>
        <Link
          href="/"
          className="flex h-16 items-center gap-2 px-4"
          style={{ borderBottom: "1px solid rgba(255,255,255,.12)", color: "#fff" }}
        >
          <span
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg"
            style={{ background: "var(--ai-red)" }}
          >
            <RobotOutlined style={{ fontSize: 16, color: "#fff" }} />
          </span>
          <span className="text-lg font-extrabold tracking-tight">AGORA</span>
        </Link>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={selected}
          items={NAV}
          onClick={({ key }) => router.push(key)}
          style={{ borderInlineEnd: "none", paddingTop: 8, background: "transparent" }}
        />
      </Sider>

      {/* minWidth: 0 — không có nó, bảng rộng (scroll.x) sẽ đẩy và bóp Sider lại. */}
      <Layout style={{ background: "var(--ai-bg)", minWidth: 0 }}>
        <Header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 12,
            paddingInline: 20,
            background: "var(--ai-card)",
            borderBottom: "1px solid var(--ai-line)",
          }}
        >
          <Tooltip title={dark ? "Giao diện sáng" : "Giao diện tối"}>
            <Button
              type="text"
              icon={dark ? <SunOutlined /> : <MoonOutlined />}
              onClick={toggle}
              aria-label="Đổi giao diện sáng tối"
            />
          </Tooltip>
          <Dropdown
            menu={{
              items: [
                {
                  key: "email",
                  label: <Typography.Text type="secondary">{user.email}</Typography.Text>,
                  disabled: true,
                },
                { type: "divider" },
                {
                  key: "logout",
                  icon: <LogoutOutlined />,
                  label: "Đăng xuất",
                  danger: true,
                  onClick: () => {
                    logout();
                    router.replace("/login");
                  },
                },
              ],
            }}
          >
            <button className="flex items-center gap-2">
              <Avatar style={{ backgroundColor: "var(--ai-navy)" }}>{initials}</Avatar>
              <span className="hidden font-bold sm:inline" style={{ color: "var(--ai-ink)" }}>
                {user.full_name}
              </span>
            </button>
          </Dropdown>
        </Header>

        <Content style={{ padding: 16, minWidth: 0 }}>
          <div style={{ maxWidth: 1440, margin: "0 auto", minWidth: 0 }}>{children}</div>
        </Content>
      </Layout>
    </Layout>
  );
}
