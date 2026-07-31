"use client";

/** Phiên đăng nhập của giảng viên / chủ phòng. */
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  AUTH_SESSION_INVALID_EVENT,
  AUTH_TOKEN_STORAGE_KEY,
  ApiError,
  api,
  getToken,
  setToken,
  type UserOut,
} from "./api";

export { getToken, setToken };

export function logout() {
  setToken(null);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTH_SESSION_INVALID_EVENT));
  }
}

function tokenExpiresAt(token: string): number | null {
  try {
    const encoded = token.split(".")[1];
    if (!encoded) return null;
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const payload = JSON.parse(window.atob(padded)) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
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
    let disposed = false;
    let invalidated = false;
    let expiryTimer: number | null = null;

    const expireSession = () => {
      if (disposed || invalidated) return;
      invalidated = true;
      // Vô hiệu hóa luôn promise /auth/me đang pending để nó không thể khôi
      // phục user sau logout, hết hạn hoặc 401 từ một request khác.
      alive = false;
      setToken(null);
      setUser(null);
      setLoading(false);
      if (redirect) router.replace("/login");
    };
    const onStorage = (event: StorageEvent) => {
      if (
        (event.key === AUTH_TOKEN_STORAGE_KEY || event.key === null) &&
        !getToken()
      ) {
        expireSession();
      }
    };
    const onInvalidSession = () => expireSession();
    window.addEventListener("storage", onStorage);
    window.addEventListener(AUTH_SESSION_INVALID_EVENT, onInvalidSession);

    const token = getToken();
    if (!token) {
      setLoading(false);
      if (redirect) router.replace("/login");
      return () => {
        disposed = true;
        alive = false;
        window.removeEventListener("storage", onStorage);
        window.removeEventListener(AUTH_SESSION_INVALID_EVENT, onInvalidSession);
      };
    }

    const expiresAt = tokenExpiresAt(token);
    if (expiresAt !== null) {
      const remaining = expiresAt - Date.now();
      if (remaining <= 0) {
        expireSession();
        return () => {
          disposed = true;
          alive = false;
          window.removeEventListener("storage", onStorage);
          window.removeEventListener(AUTH_SESSION_INVALID_EVENT, onInvalidSession);
        };
      }
      expiryTimer = window.setTimeout(expireSession, remaining);
    }

    api
      .me()
      .then((u) => {
        if (alive) setUser(u);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          expireSession();
        } else if (redirect) {
          router.replace("/login");
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      disposed = true;
      alive = false;
      if (expiryTimer !== null) window.clearTimeout(expiryTimer);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(AUTH_SESSION_INVALID_EVENT, onInvalidSession);
    };
  }, [redirect, router]);

  return { user, loading };
}
