"use client";

/**
 * Cảnh báo của Teaching Advisor tại Bục Giảng.
 *
 * Giao diện dành cho giảng viên nên giữ tông nghiêm túc: khối chữ nhật, chữ
 * thường, không icon hoạt hoạ. Popup tự ẩn sau 5 giây, bấm ra ngoài cũng ẩn.
 * Đưa chuột vào thì dừng đếm — giảng viên đang đọc thì không giật mất.
 */
import {
  CloseOutlined,
  DislikeOutlined,
  LikeOutlined,
  WarningFilled,
} from "@ant-design/icons";
import { Button, Space, Tag, Tooltip, Typography } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Advice } from "@/lib/api";

const AUTO_HIDE_MS = 5000;
const TICK_MS = 50;

const CONFIDENCE_LABEL: Record<string, string> = {
  high: "độ tin cậy cao",
  medium: "độ tin cậy trung bình",
  low: "độ tin cậy thấp",
};

const SOURCE_LABEL: Record<string, string> = {
  ai: "AI Teaching Advisor",
  rule_fallback: "quy tắc dự phòng",
  abstain: "chưa đủ dữ liệu",
};

export default function AdviceAlert({
  advice,
  onClose,
  onFeedback,
}: {
  advice: Advice | null;
  onClose: () => void;
  onFeedback: (feedback: "up" | "down" | "dismissed") => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [remaining, setRemaining] = useState(AUTO_HIDE_MS);
  const [paused, setPaused] = useState(false);
  const [rated, setRated] = useState(false);

  const key = advice?.id ?? null;

  const dismiss = useCallback(
    (reason: "auto" | "outside" | "button") => {
      if (!rated && reason !== "button") onFeedback("dismissed");
      onClose();
    },
    [onClose, onFeedback, rated],
  );

  // Đồng hồ đếm ngược 5 giây, dừng khi con trỏ ở trong popup.
  useEffect(() => {
    if (!advice) return;
    setRemaining(AUTO_HIDE_MS);
    setRated(false);
  }, [advice, key]);

  useEffect(() => {
    if (!advice || paused) return;
    const timer = window.setInterval(() => {
      setRemaining((left) => {
        if (left <= TICK_MS) {
          window.clearInterval(timer);
          dismiss("auto");
          return 0;
        }
        return left - TICK_MS;
      });
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [advice, paused, dismiss]);

  // Bấm ra ngoài popup thì đóng.
  useEffect(() => {
    if (!advice) return;
    function onPointerDown(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) dismiss("outside");
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") dismiss("outside");
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [advice, dismiss]);

  if (!advice) return null;

  const progress = Math.max(0, Math.min(100, (remaining / AUTO_HIDE_MS) * 100));
  const accent = advice.confidence === "high" ? "#FF4B4B" : "#FF9600";

  function rate(value: "up" | "down") {
    setRated(true);
    onFeedback(value);
    onClose();
  }

  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-label="Gợi ý điều chỉnh cách dạy"
      className="fixed bottom-6 right-6 z-50 w-[min(420px,calc(100vw-3rem))]"
    >
      <div
        ref={panelRef}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        style={{
          background: "var(--c-surface)",
          border: "1px solid var(--c-line)",
          borderLeft: `4px solid ${accent}`,
          borderRadius: 8,
          boxShadow: "0 8px 28px rgba(0,0,0,.18)",
          overflow: "hidden",
        }}
      >
        <div className="flex items-start gap-3 px-4 pb-3 pt-4">
          <WarningFilled style={{ color: accent, fontSize: 18, marginTop: 2 }} />
          <div className="min-w-0 flex-1">
            <Typography.Text strong style={{ fontSize: 15, lineHeight: 1.4 }}>
              {advice.headline}
            </Typography.Text>
            <div className="mt-1">
              <Space size={4} wrap>
                <Tag style={{ marginInlineEnd: 0 }}>{advice.state_label}</Tag>
                <Tag style={{ marginInlineEnd: 0 }}>
                  {SOURCE_LABEL[advice.source] ?? advice.source}
                </Tag>
                <Tag style={{ marginInlineEnd: 0 }}>
                  {CONFIDENCE_LABEL[advice.confidence] ?? advice.confidence}
                </Tag>
              </Space>
            </div>
          </div>
          <Tooltip title="Đóng">
            <Button
              type="text"
              size="small"
              icon={<CloseOutlined />}
              onClick={() => dismiss("button")}
              aria-label="Đóng cảnh báo"
            />
          </Tooltip>
        </div>

        <div className="px-4 pb-3" style={{ paddingInlineStart: 43 }}>
          <Typography.Paragraph style={{ marginBottom: 8, fontSize: 14 }}>
            {advice.action}
          </Typography.Paragraph>
          {advice.evidence.length > 0 ? (
            <ul className="m-0 list-none p-0">
              {advice.evidence.map((e, i) => (
                <li key={i} className="mb-1 flex gap-2">
                  <span style={{ color: "var(--c-muted)" }}>—</span>
                  <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                    {e}
                  </Typography.Text>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div
          className="flex items-center justify-between gap-2 px-4 py-2"
          style={{ borderTop: "1px solid var(--c-line)" }}
        >
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {paused ? "Đang tạm dừng tự ẩn" : `Tự ẩn sau ${Math.ceil(remaining / 1000)}s`}
          </Typography.Text>
          <Space size={4}>
            <Button size="small" icon={<LikeOutlined />} onClick={() => rate("up")}>
              Hữu ích
            </Button>
            <Button size="small" icon={<DislikeOutlined />} onClick={() => rate("down")}>
              Không đúng
            </Button>
          </Space>
        </div>

        <div style={{ height: 3, background: "var(--c-sunken)" }}>
          <div
            style={{
              height: "100%",
              width: `${progress}%`,
              background: accent,
              transition: `width ${TICK_MS}ms linear`,
            }}
          />
        </div>
      </div>
    </div>
  );
}
