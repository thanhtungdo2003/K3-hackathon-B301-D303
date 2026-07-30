"use client";

import { useEffect, useState } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { JoinResult } from "./api";

interface LearnerState {
  profile: JoinResult | null;
  setProfile: (p: JoinResult | null) => void;
}

/** Danh tính học viên chỉ nằm ở localStorage — không có tài khoản, không mật khẩu. */
export const useLearner = create<LearnerState>()(
  persist(
    (set) => ({
      profile: null,
      setProfile: (profile) => set({ profile }),
    }),
    { name: "agora-learner" },
  ),
);

/**
 * `true` khi store đã đọc xong localStorage.
 * Phải chờ mốc này rồi mới kết luận "chưa có profile" — nếu không, học viên
 * tải lại trang giữa buổi sẽ bị đẩy ngược về trang vào lớp.
 */
export function useLearnerHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (useLearner.persist.hasHydrated()) {
      setHydrated(true);
      return;
    }
    return useLearner.persist.onFinishHydration(() => setHydrated(true));
  }, []);

  return hydrated;
}
