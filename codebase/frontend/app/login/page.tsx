"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import AuthShell, { ErrorNote, Field } from "@/components/AuthShell";
import { BlockButton, BlockInput } from "@/components/Blocks";
import { Icon } from "@/components/icons";
import { api, setToken } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const ready = email.includes("@") && password.length > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await api.login({ email: email.trim().toLowerCase(), password });
      setToken(res.token);
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không đăng nhập được.");
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Đăng nhập"
      subtitle="Vào khu vực quản lý khoá học và phòng học."
      footer={
        <>
          Chưa có tài khoản?{" "}
          <Link href="/register" className="font-extrabold text-sky underline">
            Đăng ký
          </Link>
          {" · "}
          <Link href="/join" className="font-extrabold text-sky underline">
            Học viên vào lớp
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-5">
        <Field icon={Icon.mail} label="Email">
          <BlockInput
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="giangvien@truong.edu.vn"
            autoComplete="email"
          />
        </Field>

        <Field icon={Icon.key} label="Mật khẩu">
          <div className="relative">
            <BlockInput
              type={show ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              className="pr-16"
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-muted"
            >
              {show ? (
                <Icon.hide aria-hidden size={22} strokeWidth={2.4} />
              ) : (
                <Icon.show aria-hidden size={22} strokeWidth={2.4} />
              )}
            </button>
          </div>
        </Field>

        <ErrorNote>{error}</ErrorNote>

        <BlockButton
          type="submit"
          tone="sky"
          icon={Icon.key}
          disabled={!ready || busy}
          className="w-full"
        >
          {busy ? "Đang vào…" : "Đăng nhập"}
        </BlockButton>
      </form>
    </AuthShell>
  );
}
