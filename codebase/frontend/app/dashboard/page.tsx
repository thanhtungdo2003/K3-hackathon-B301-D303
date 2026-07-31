"use client";

/**
 * AI Dashboard — lưới Bento bên trái, trợ lý gọi tool bên phải.
 * Mọi con số đều từ buổi dạy thật; không có dữ liệu mô phỏng.
 */
import {
  BookOutlined,
  DesktopOutlined,
  MessageOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  RightOutlined,
  TeamOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { Alert, Button, Empty, Tag, Typography } from "antd";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BentoBar, BentoCard, BentoGrid, BentoStat } from "@/components/ai/Bento";
import ChatPanel from "@/components/ai/ChatPanel";
import { api, type Overview, type SessionSummary } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const pct = (v: number) => `${Math.round(v * 100)}%`;

export default function AiDashboard() {
  const { user } = useAuth();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [chatOpen, setChatOpen] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [o, s] = await Promise.all([api.overview(), api.recentSessions(5)]);
      setOverview(o);
      setSessions(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được dữ liệu.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const live = sessions.find((s) => s.live) ?? null;
  const empty = overview !== null && overview.courses === 0;

  return (
    <>
    <div
      className={`grid min-h-0 gap-4 ${chatOpen ? "xl:grid-cols-[1fr_380px]" : "xl:grid-cols-1"}`}
      style={{ transition: "grid-template-columns 0.3s cubic-bezier(.4,0,.2,1)" }}
    >
      {/* ── cột trái: Bento ───────────────────────────────────────────── */}
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Typography.Text style={{ color: "var(--ai-muted)", fontWeight: 700, fontSize: 12 }}>
              XIN CHÀO
            </Typography.Text>
            <Typography.Title level={3} style={{ margin: 0, color: "var(--ai-ink)" }}>
              {user?.full_name ?? "…"}
            </Typography.Title>
          </div>
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>
            Làm mới
          </Button>
        </div>

        {error ? <Alert type="error" showIcon title={error} /> : null}

        {empty ? (
          <Alert
            type="info"
            showIcon
            title="Chưa có khoá học nào"
            description="Nói với trợ lý bên phải: “tạo khoá học Nhập môn Machine Learning”. Trợ lý sẽ tạo giúp, sau đó bạn tải file PPTX lên."
          />
        ) : null}

        <BentoGrid>
          {/* buổi đang mở — ô nhấn duy nhất */}
          {live ? (
            <BentoCard span={6} tone="navy" title="Đang dạy">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-xl font-extrabold">{live.title}</div>
                  <div className="text-sm font-semibold" style={{ opacity: 0.78 }}>
                    {live.course_title} · mã {live.room_code} · {live.participants} học viên
                  </div>
                </div>
                <Link href={`/teach/${live.id}`}>
                  <Button type="primary" danger size="large" icon={<PlayCircleOutlined />}>
                    Vào Bục Giảng
                  </Button>
                </Link>
              </div>
            </BentoCard>
          ) : null}

          <BentoStat
            label="Khoá học"
            value={overview?.courses ?? "—"}
            hint={`${overview?.slides ?? 0} slide`}
            icon={<BookOutlined />}
          />
          <BentoStat
            label="Phòng học"
            value={overview?.rooms ?? "—"}
            hint={`${overview?.live_sessions ?? 0} đang mở`}
            icon={<DesktopOutlined />}
          />
          <BentoStat
            label="Buổi đã dạy"
            value={overview?.sessions ?? "—"}
            hint={`${overview?.participants ?? 0} lượt tham gia`}
            icon={<TeamOutlined />}
          />

          {/* chất lượng trả lời */}
          <BentoCard span={3} title="Chất lượng trả lời">
            {overview && overview.answers > 0 ? (
              <>
                <div className="bento-value">{pct(overview.correct_rate)}</div>
                <BentoBar value={overview.correct_rate} />
                <div className="text-xs font-semibold" style={{ color: "var(--ai-muted)" }}>
                  {overview.answers} lượt trả lời · bỏ qua {pct(overview.skip_rate)}
                </div>
              </>
            ) : (
              <Typography.Text style={{ color: "var(--ai-muted)", fontSize: 13 }}>
                Chưa có lượt trả lời nào. Số liệu xuất hiện sau khi bạn mở câu hỏi cho lớp.
              </Typography.Text>
            )}
          </BentoCard>

          {/* teaching advisor */}
          <BentoCard
            span={3}
            tone={overview && overview.advisor.alerts > 0 ? "red" : "plain"}
            title="Teaching Advisor"
          >
            {overview && overview.advisor.total > 0 ? (
              <>
                <div className="flex items-baseline gap-2">
                  <span className="bento-value" style={{ color: "var(--ai-red)" }}>
                    {overview.advisor.alerts}
                  </span>
                  <span className="text-sm font-bold" style={{ color: "var(--ai-muted)" }}>
                    / {overview.advisor.total} lượt có cảnh báo
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Tag color="blue">AI {overview.advisor.by_source.ai ?? 0}</Tag>
                  <Tag>Luật {overview.advisor.by_source.rule_fallback ?? 0}</Tag>
                  <Tag>Im lặng {overview.advisor.by_source.abstain ?? 0}</Tag>
                </div>
                <div className="text-xs font-semibold" style={{ color: "var(--ai-muted)" }}>
                  Hữu ích {pct(overview.advisor.useful_rate)} · bị bỏ qua{" "}
                  {pct(overview.advisor.dismiss_rate)}
                </div>
              </>
            ) : (
              <Typography.Text style={{ color: "var(--ai-muted)", fontSize: 13 }}>
                Chưa có gợi ý nào được ghi lại.
              </Typography.Text>
            )}
          </BentoCard>

          {/* học viên chủ động */}
          <BentoStat
            label="Câu hỏi từ lớp"
            value={overview?.questions_asked ?? "—"}
            hint={`${overview?.hints_requested ?? 0} lượt xin gợi ý`}
            icon={<MessageOutlined />}
            span={2}
          />

          {/* lối đi nhanh */}
          <BentoCard span={4} title="Đi tới">
            <div className="flex flex-wrap gap-2">
              <Link href="/dashboard/courses">
                <Button icon={<BookOutlined />}>Khoá học & checkpoint</Button>
              </Link>
              <Link href="/dashboard/rooms">
                <Button icon={<DesktopOutlined />}>Phòng học & mã lớp</Button>
              </Link>
            </div>
            <Typography.Text style={{ color: "var(--ai-muted)", fontSize: 12 }}>
              Tải file PPTX và duyệt câu hỏi làm ở trang Khoá học — trợ lý không tải file thay được.
            </Typography.Text>
          </BentoCard>

          {/* buổi gần đây */}
          <BentoCard
            span={6}
            title="Buổi học gần đây"
            extra={
              <Link href="/dashboard/rooms" className="text-xs font-bold">
                Phòng học <RightOutlined style={{ fontSize: 10 }} />
              </Link>
            }
          >
            {sessions.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="Chưa có buổi nào"
                style={{ margin: "8px 0" }}
              />
            ) : (
              <ul className="m-0 list-none space-y-1 p-0">
                {sessions.map((s) => (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-3 py-2.5"
                    style={{ background: "var(--ai-bg)" }}
                  >
                    <span
                      className="rounded-lg px-2 py-0.5 text-xs font-extrabold tabular-nums"
                      style={{ background: "var(--ai-navy-surface)", color: "#fff", letterSpacing: 2 }}
                    >
                      {s.room_code}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-bold">
                      {s.title}
                      <span className="font-semibold" style={{ color: "var(--ai-muted)" }}>
                        {" "}
                        · {s.course_title}
                      </span>
                    </span>
                    <span className="text-xs font-semibold" style={{ color: "var(--ai-muted)" }}>
                      {s.participants} người · {s.answers} trả lời
                    </span>
                    {s.answers ? (
                      <span
                        className="text-xs font-extrabold tabular-nums"
                        style={{
                          color:
                            s.correct_rate >= 0.6
                              ? "#0F9D58"
                              : s.correct_rate >= 0.4
                                ? "#E08700"
                                : "var(--ai-red)",
                        }}
                      >
                        {pct(s.correct_rate)}
                      </span>
                    ) : null}
                    {s.live ? (
                      <Link href={`/teach/${s.id}`}>
                        <Button size="small" type="primary" danger>
                          Vào dạy
                        </Button>
                      </Link>
                    ) : (
                      <Tag style={{ marginInlineEnd: 0 }}>đã xong</Tag>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </BentoCard>

          <BentoCard span={6}>
            <div
              className="flex items-start gap-2 text-xs font-semibold"
              style={{ color: "var(--ai-muted)" }}
            >
              <ThunderboltOutlined style={{ color: "var(--ai-navy-soft)", marginTop: 2 }} />
              Trợ lý bên phải chạy trên Groq và thao tác qua công cụ có kiểm soát: tạo khoá học, đặt
              checkpoint, soạn nháp câu hỏi, mở phòng, bắt đầu buổi. Không xoá gì.
            </div>
          </BentoCard>
        </BentoGrid>
      </div>

      {/* ── cột phải: trợ lý ──────────────────────────────────────────── */}
      {chatOpen && (
        <div className="min-w-0 xl:sticky xl:top-4 xl:h-[calc(100vh-96px)]">
          <div className="h-[560px] xl:h-full">
            <ChatPanel onChanged={load} onOpenChange={setChatOpen} />
          </div>
        </div>
      )}
    </div>

    {/* nút floating nằm ngoài grid — luôn cố định góc dưới phải */}
    {!chatOpen && <ChatPanel onChanged={load} onOpenChange={setChatOpen} />}
    </>
  );
}
