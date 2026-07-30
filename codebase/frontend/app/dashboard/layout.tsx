"use client";

/** Khu vực quản trị của chủ phòng — dựng bằng Ant Design. */
import {
  AppstoreOutlined,
  BookOutlined,
  BulbOutlined,
  DesktopOutlined,
  LogoutOutlined,
  MoonOutlined,
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
  { key: "/dashboard", icon: <AppstoreOutlined />, label: "Tổng quan" },
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
      <div className="grid min-h-screen place-items-center">
        <Spin size="large" />
      </div>
    );
  }

  const initials = user.full_name.trim().slice(0, 1).toUpperCase() || "?";

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider
        breakpoint="lg"
        width={220}
        collapsedWidth={64}
        style={{ borderRight: "1px solid var(--c-line)" }}
      >
        <Link
          href="/"
          className="flex h-16 items-center gap-2 px-4"
          style={{ borderBottom: "1px solid var(--c-line)" }}
        >
          <BulbOutlined style={{ fontSize: 20, color: "#1CB0F6" }} />
          <span className="text-lg font-extrabold tracking-tight">AGORA</span>
        </Link>
        <Menu
          mode="inline"
          selectedKeys={selected}
          items={NAV}
          onClick={({ key }) => router.push(key)}
          style={{ borderInlineEnd: "none", paddingTop: 8 }}
        />
      </Sider>

      <Layout>
        <Header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 12,
            paddingInline: 20,
            borderBottom: "1px solid var(--c-line)",
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
              <Avatar style={{ backgroundColor: "#1CB0F6" }}>{initials}</Avatar>
              <span className="hidden font-bold sm:inline">{user.full_name}</span>
            </button>
          </Dropdown>
        </Header>

        <Content style={{ padding: 24 }}>
          <div style={{ maxWidth: 1200, margin: "0 auto" }}>{children}</div>
        </Content>
      </Layout>
    </Layout>
  );
}
