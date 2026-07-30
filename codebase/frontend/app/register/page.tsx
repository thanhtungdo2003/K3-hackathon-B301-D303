"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import AuthShell, { ErrorNote, Field } from "@/components/AuthShell";
import { BlockButton, BlockInput } from "@/components/Blocks";
import { Icon } from "@/components/icons";
import { api, setToken } from "@/lib/api";

export default function RegisterPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [organization, setOrganization] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const ready = fullName.trim().length >= 2 && email.includes("@") && password.length >= 8;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await api.register({
        full_name: fullName.trim(),
        email: email.trim().toLowerCase(),
        password,
        organization: organization.trim(),
      });
      setToken(res.token);
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không đăng ký được.");
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Tạo tài khoản"
      subtitle="Dành cho giảng viên và chủ phòng. Học viên không cần tài khoản."
      footer={
        <>
          Đã có tài khoản?{" "}
          <Link href="/login" className="font-extrabold text-sky underline">
            Đăng nhập
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-5">
        <Field icon={Icon.person} label="Họ và tên">
          <BlockInput
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Nguyễn Văn A"
            autoComplete="name"
            maxLength={80}
          />
        </Field>

        <Field icon={Icon.mail} label="Email">
          <BlockInput
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="giangvien@truong.edu.vn"
            autoComplete="email"
          />
        </Field>

        <Field icon={Icon.brand} label="Đơn vị (không bắt buộc)">
          <BlockInput
            value={organization}
            onChange={(e) => setOrganization(e.target.value)}
            placeholder="VinUniversity"
            maxLength={120}
          />
        </Field>

        <Field icon={Icon.key} label="Mật khẩu (tối thiểu 8 ký tự)">
          <div className="relative">
            <BlockInput
              type={show ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
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
          tone="grass"
          icon={Icon.signup}
          disabled={!ready || busy}
          className="w-full"
        >
          {busy ? "Đang tạo…" : "Đăng ký"}
        </BlockButton>
      </form>
    </AuthShell>
  );
}
