"use client";

/**
 * Thanh chat trợ lý của dashboard.
 * Trợ lý không tự viết SQL hay gọi API bừa — nó gọi tool ở backend, và mỗi tool
 * đã chạy được hiện thành một dòng ngay dưới câu trả lời để giảng viên soát lại.
 */
import {
  ArrowUpOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  CloseOutlined,
  LoadingOutlined,
  MessageOutlined,
  RobotOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { Alert, Tooltip, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import { api, type AssistantStatus, type ToolCall } from "@/lib/api";

interface Turn {
  role: "user" | "assistant";
  content: string;
  calls?: ToolCall[];
  pending?: boolean;
}

const SUGGESTIONS = [
  "Tạo khoá học Nhập môn Machine Learning, môn Trí tuệ nhân tạo",
  "Khoá học của tôi đang có những gì?",
  "Đặt checkpoint ở slide 2 và soạn 2 câu hỏi",
  "Mở phòng cho khoá học đó rồi bắt đầu buổi học",
];

/** Rút gọn kết quả tool thành một dòng người đọc được. */
function callSummary(call: ToolCall): string {
  if (!call.ok) return call.error || "không chạy được";
  const r = call.result as Record<string, unknown>;
  const pick = (k: string) => (r[k] === undefined ? null : String(r[k]));

  if (call.tool === "create_course") return `${pick("title")} · id ${pick("course_id")}`;
  if (call.tool === "update_course") return `${pick("title")} · sửa ${String(r.updated ?? "")}`;
  if (call.tool === "create_room") return `${pick("name")} · mã ${pick("code")}`;
  if (call.tool === "start_session")
    return r.started ? `buổi ${pick("session_id")} đã mở` : `đang có buổi ${pick("session_id")}`;
  if (call.tool === "create_checkpoint")
    return r.created ? `slide ${pick("slide_number")} · id ${pick("checkpoint_id")}` : String(r.reason ?? "");
  if (call.tool === "draft_questions")
    return `${(r.saved as unknown[] | undefined)?.length ?? 0} câu vào checkpoint ${pick("checkpoint_id")}`;
  if (call.tool === "list_courses")
    return `${(r.courses as unknown[] | undefined)?.length ?? 0} khoá học`;
  if (call.tool === "list_rooms") return `${(r.rooms as unknown[] | undefined)?.length ?? 0} phòng`;
  if (call.tool === "list_slides")
    return `${(r.slides as unknown[] | undefined)?.length ?? 0} slide của ${pick("course_title")}`;
  return "xong";
}

export default function ChatPanel({ onChanged, onOpenChange }: { onChanged?: () => void; onOpenChange?: (open: boolean) => void }) {
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api
      .assistantStatus()
      .then(setStatus)
      .catch(() => setStatus({ available: false, model: null, tools: [] }));
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;

    const history = turns
      .filter((t) => !t.pending)
      .map((t) => ({ role: t.role, content: t.content }));
    setTurns((prev) => [
      ...prev,
      { role: "user", content: message },
      { role: "assistant", content: "", pending: true },
    ]);
    setDraft("");
    setBusy(true);

    try {
      const turn = await api.assistantChat([...history, { role: "user", content: message }]);
      setTurns((prev) => [
        ...prev.slice(0, -1),
        { role: "assistant", content: turn.reply, calls: turn.calls },
      ]);
      if (turn.changed) onChanged?.();
    } catch (err) {
      setTurns((prev) => [
        ...prev.slice(0, -1),
        {
          role: "assistant",
          content: err instanceof Error ? err.message : "Không gọi được trợ lý.",
        },
      ]);
    } finally {
      setBusy(false);
      box.current?.focus();
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => { setOpen(true); onOpenChange?.(true); }}
        aria-label="Mở trợ lý"
        className="flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-bold shadow-lg transition-all hover:scale-105 active:scale-95"
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          zIndex: 1000,
          background: "var(--ai-navy)",
          color: "#fff",
          border: "none",
          cursor: "pointer",
        }}
      >
        <MessageOutlined style={{ fontSize: 16 }} />
        Trợ lý
        {status?.available && (
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: "#37d67a" }}
          />
        )}
      </button>
    );
  }

  return (
    <section
      className="flex min-h-0 flex-col"
      style={{
        background: "var(--ai-card)",
        border: "1px solid var(--ai-line)",
        borderRadius: 18,
        overflow: "hidden",
      }}
    >
      {/* đầu thanh chat */}
      <header
        className="flex shrink-0 items-center gap-3 px-4 py-3"
        style={{ background: "var(--ai-navy-surface)", color: "#fff" }}
      >
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl"
          style={{ background: "rgba(255,255,255,.14)" }}
        >
          <RobotOutlined style={{ fontSize: 17 }} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-extrabold">Trợ lý dựng lớp</div>
          <div className="truncate text-xs" style={{ color: "rgba(255,255,255,.7)" }}>
            {status?.available
              ? `${status.tools.length} công cụ`
              : "chưa cấu hình khoá"}
          </div>
        </div>
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: status?.available ? "#37d67a" : "var(--ai-red)" }}
          aria-label={status?.available ? "Trợ lý đang hoạt động" : "Trợ lý chưa hoạt động"}
        />
        <button
          onClick={() => { setOpen(false); onOpenChange?.(false); }}
          aria-label="Đóng trợ lý"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg transition-colors hover:bg-white/20"
          style={{ background: "rgba(255,255,255,.1)", border: "none", color: "#fff", cursor: "pointer" }}
        >
          <CloseOutlined style={{ fontSize: 12 }} />
        </button>
      </header>

      {/* dòng hội thoại */}
      <div ref={scroller} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {status && !status.available ? (
          <Alert
            type="warning"
            showIcon
            title="Trợ lý chưa hoạt động"
            description="Máy chủ chưa có GROQ_API_KEY. Các trang Khoá học và Phòng học vẫn dùng bằng tay được."
          />
        ) : null}

        {turns.length === 0 ? (
          <div className="space-y-3">
            <Typography.Text style={{ color: "var(--ai-muted)", fontSize: 13 }}>
              Nói việc bạn muốn làm. Trợ lý sẽ tự gọi đúng công cụ trong hệ thống.
            </Typography.Text>
            <div className="flex flex-col gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  disabled={!status?.available || busy}
                  className="rounded-xl px-3 py-2 text-left text-[13px] font-semibold transition-colors disabled:opacity-45"
                  style={{
                    border: "1px solid var(--ai-line)",
                    background: "var(--ai-blue-tint)",
                    color: "var(--ai-navy-soft)",
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {turns.map((t, i) =>
          t.role === "user" ? (
            <div key={i} className="flex justify-end gap-2">
              <div
                className="max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm font-semibold"
                style={{ background: "var(--ai-navy-surface)", color: "#fff", borderBottomRightRadius: 6 }}
              >
                {t.content}
              </div>
              <span
                className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg"
                style={{ background: "var(--ai-blue-tint)", color: "var(--ai-navy-soft)" }}
              >
                <UserOutlined style={{ fontSize: 13 }} />
              </span>
            </div>
          ) : (
            <div key={i} className="flex gap-2">
              <span
                className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg"
                style={{ background: "var(--ai-navy-surface)", color: "#fff" }}
              >
                <RobotOutlined style={{ fontSize: 13 }} />
              </span>
              <div className="min-w-0 flex-1">
                {t.pending ? (
                  <div
                    className="inline-flex items-center gap-2 rounded-2xl px-3.5 py-2.5 text-sm font-semibold"
                    style={{
                      background: "var(--ai-blue-tint)",
                      color: "var(--ai-muted)",
                      borderBottomLeftRadius: 6,
                    }}
                  >
                    <LoadingOutlined />
                    Đang làm…
                  </div>
                ) : (
                  <div
                    className="whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm font-semibold"
                    style={{
                      background: "var(--ai-blue-tint)",
                      color: "var(--ai-ink)",
                      borderBottomLeftRadius: 6,
                    }}
                  >
                    {t.content}
                  </div>
                )}

                {t.calls?.length ? (
                  <ul className="mt-2 space-y-1">
                    {t.calls.map((c, k) => (
                      <li key={k} className="flex items-start gap-2 text-xs font-semibold">
                        {c.ok ? (
                          <CheckCircleFilled style={{ color: "#0F9D58", marginTop: 3 }} />
                        ) : (
                          <CloseCircleFilled style={{ color: "var(--ai-red)", marginTop: 3 }} />
                        )}
                        <Tooltip title={c.tool}>
                          <span style={{ color: "var(--ai-ink)" }}>{c.label}</span>
                        </Tooltip>
                        <span className="min-w-0 flex-1" style={{ color: "var(--ai-muted)" }}>
                          {callSummary(c)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          ),
        )}
      </div>

      {/* ô nhập */}
      <footer
        className="shrink-0 p-3"
        style={{ borderTop: "1px solid var(--ai-line)", background: "var(--ai-card)" }}
      >
        <div
          className="flex items-end gap-2 rounded-2xl px-3 py-2"
          style={{ border: "1px solid var(--ai-line)", background: "var(--ai-bg)" }}
        >
          <textarea
            ref={box}
            rows={1}
            value={draft}
            disabled={!status?.available || busy}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(draft);
              }
            }}
            placeholder={
              status?.available ? "Tạo khoá học, mở phòng, đặt checkpoint…" : "Trợ lý chưa hoạt động"
            }
            className="max-h-28 min-h-[24px] flex-1 resize-none bg-transparent text-sm font-semibold outline-none disabled:opacity-50"
            style={{ color: "var(--ai-ink)" }}
          />
          <button
            onClick={() => void send(draft)}
            disabled={!status?.available || busy || !draft.trim()}
            aria-label="Gửi"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-xl transition-opacity disabled:opacity-35"
            style={{ background: "var(--ai-red)", color: "#fff" }}
          >
            {busy ? <LoadingOutlined /> : <ArrowUpOutlined style={{ fontSize: 14 }} />}
          </button>
        </div>
        <p className="mt-2 text-center text-[11px] font-semibold" style={{ color: "var(--ai-muted)" }}>
          Trợ lý không tải file PPTX và không xoá dữ liệu — hai việc đó bạn tự làm.
        </p>
      </footer>
    </section>
  );
}
