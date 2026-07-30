"use client";

/** Phiên đăng nhập của giảng viên / chủ phòng. */
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError, api, getToken, setToken, type UserOut } from "./api";

export { getToken, setToken };

export function logout() {
  setToken(null);
}

/**
 * Đọc tài khoản đang đăng nhập. `redirect = true` sẽ tự đẩy về trang đăng nhập
 * khi chưa có phiên hợp lệ — dùng cho mọi trang trong khu vực quản trị.
 */
export function useAuth(redirect = true) {
  const router = useRouter();
  const [user, setUser] = useState<UserOut | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    if (!getToken()) {
      setLoading(false);
      if (redirect) router.replace("/login");
      return;
    }
    api
      .me()
      .then((u) => {
        if (alive) setUser(u);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) setToken(null);
        if (redirect) router.replace("/login");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [redirect, router]);

  return { user, loading };
}
