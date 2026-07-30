"use client";

/**
 * Bục Giảng — màn hình điều khiển buổi dạy.
 * Giao diện dành cho giảng viên: Ant Design, tông nghiêm túc, mật độ thông tin cao.
 */
import {
  ArrowLeftOutlined,
  BulbOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  ExpandOutlined,
  LeftOutlined,
  MessageOutlined,
  PoweroffOutlined,
  RadarChartOutlined,
  RightOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App,
  Badge,
  Button,
  Empty,
  Layout,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import AdviceAlert from "@/components/AdviceAlert";
import SlideCanvas from "@/components/SlideCanvas";
import { BentoBar, BentoCard, BentoGrid, BentoStat } from "@/components/ai/Bento";
import { usePresentation } from "@/lib/usePresentation";
import {
  api,
  type Advice,
  type QuestionOut,
  type SessionOut,
  type SlideOut,
  type TeachingDashboard,
} from "@/lib/api";
import { getToken, useAuth } from "@/lib/auth";
import { joinLecturerSession } from "@/lib/socket";

const { Header, Content } = Layout;
const pct = (v: number) => `${Math.round(v * 100)}%`;

export default function LecternPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = Number(params.sessionId);
  const router = useRouter();
  const { message, modal } = App.useApp();
  const { user, loading: authLoading } = useAuth();

  const [session, setSession] = useState<SessionOut | null>(null);
  const [slides, setSlides] = useState<SlideOut[]>([]);
  const [board, setBoard] = useState<TeachingDashboard | null>(null);
  const [questions, setQuestions] = useState<QuestionOut[]>([]);
  const [index, setIndex] = useState(0);
  const [popup, setPopup] = useState<Advice | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState("");
  const seenAdvice = useRef<number | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  /* ---------------------------------------------------------------- nạp dữ liệu */

  const refresh = useCallback(async () => {
    try {
      const data = await api.teachingDashboard(sessionId);
      setBoard(data);
      setIndex(data.slide_index);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mất kết nối với buổi học.");
    }
  }, [sessionId]);

  useEffect(() => {
    if (authLoading || !user || !Number.isFinite(sessionId)) return;
    let alive = true;
    (async () => {
      try {
        const s = await api.session(sessionId);
        if (!alive) return;
        setSession(s);
        setSlides(await api.slides(s.course_id));
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Không mở được buổi học.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [authLoading, user, sessionId, refresh]);

  // Câu hỏi của checkpoint gắn với slide đang trình bày.
  useEffect(() => {
    if (!session) return;
    let alive = true;
    api
      .checkpointQuestions(sessionId, index)
      .then((qs) => {
        if (alive) setQuestions(qs);
      })
      .catch(() => {
        if (alive) setQuestions([]);
      });
    return () => {
      alive = false;
    };
  }, [session, sessionId, index]);

  // Realtime: mỗi tín hiệu từ lớp đều kéo lại số liệu.
  useEffect(() => {
    if (!session || !user) return;
    const token = getToken();
    if (!token) return;
    const handle = joinLecturerSession(sessionId, token);
    const { socket } = handle;
    const bump = () => void refresh();
    const onAdvice = (payload: Advice) => {
      if (payload.should_alert) setPopup(payload);
      void refresh();
    };
    socket.on("answer_received", bump);
    socket.on("signal", bump);
    socket.on("roster_changed", bump);
    socket.on("advice", onAdvice);
    socket.on("session_ended", bump);
    return () => {
      socket.off("answer_received", bump);
      socket.off("signal", bump);
      socket.off("roster_changed", bump);
      socket.off("advice", onAdvice);
      socket.off("session_ended", bump);
      handle.dispose();
    };
  }, [session, user, sessionId, refresh]);

  // Nhịp nền: lớp đông thì socket đủ, nhưng vẫn đồng bộ lại mỗi 12s cho chắc.
  useEffect(() => {
    if (!session || !user || board?.ended) return;
    const timer = window.setInterval(() => void refresh(), 12000);
    return () => window.clearInterval(timer);
  }, [session, user, board?.ended, refresh]);

  // Cảnh báo mới sinh ra ở phía máy chủ (ví dụ do người khác kích hoạt).
  useEffect(() => {
    const latest = board?.latest_advice;
    if (!latest?.id || !latest.should_alert) return;
    if (seenAdvice.current === latest.id) return;
    seenAdvice.current = latest.id;
    setPopup(latest);
  }, [board?.latest_advice]);

  /* -------------------------------------------------------------------- hành vi */

  async function goto(next: number) {
    if (!slides.length) return;
    const clamped = Math.max(0, Math.min(slides.length - 1, next));
    if (clamped === index) return;
    setIndex(clamped);
    try {
      await api.changeSlide(sessionId, clamped);
      await refresh();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Không chuyển được slide.");
    }
  }

  // Cửa sổ trình chiếu: bám khung xem trước, nhận lệnh chuyển slide từ chính nó.
  const { open: presentOpen, openPresentation } = usePresentation({
    sessionId,
    slideIndex: index,
    anchorRef: previewRef,
    onRequestSlide: (next) => void goto(next),
    enabled: Boolean(session) && !board?.ended,
  });

  async function openQuestion(question: QuestionOut | null) {
    try {
      await api.triggerQuestion(sessionId, question?.id ?? null);
      message.success(question ? "Đã mở câu hỏi cho lớp." : "Đã đóng câu hỏi.");
      await refresh();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Không mở được câu hỏi.");
    }
  }

  async function askAdvisor() {
    setAsking(true);
    try {
      const advice = await api.advice(sessionId, { slide_index: index });
      seenAdvice.current = advice.id ?? null;
      if (advice.should_alert) {
        setPopup(advice);
      } else {
        modal.info({
          title: advice.headline,
          content: (
            <div className="space-y-2">
              <Typography.Text>{advice.action}</Typography.Text>
              {advice.evidence.map((e, i) => (
                <div key={i}>
                  <Typography.Text type="secondary">— {e}</Typography.Text>
                </div>
              ))}
            </div>
          ),
        });
      }
      await refresh();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Không lấy được gợi ý.");
    } finally {
      setAsking(false);
    }
  }

  async function rateAdvice(feedback: "up" | "down" | "dismissed") {
    const id = popup?.id;
    if (!id) return;
    try {
      await api.adviceFeedback(sessionId, id, feedback);
    } catch {
      /* phản hồi mất cũng không ảnh hưởng buổi dạy */
    }
  }

  function endSession() {
    modal.confirm({
      title: "Kết thúc buổi học?",
      content: "Học viên sẽ ngừng nhận slide và câu hỏi. Số liệu vẫn được giữ lại.",
      okText: "Kết thúc",
      okButtonProps: { danger: true },
      cancelText: "Huỷ",
      onOk: async () => {
        await api.endSession(sessionId);
        message.success("Đã kết thúc buổi học.");
        router.push("/dashboard/rooms");
      },
    });
  }

  /* ---------------------------------------------------------------------- render */

  if (authLoading || (!session && !error)) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Spin size="large" />
      </div>
    );
  }

  if (error && !session) {
    return (
      <div className="mx-auto max-w-lg p-8">
        <Alert type="error" showIcon title={error} />
        <Link href="/dashboard/rooms">
          <Button style={{ marginTop: 16 }} icon={<ArrowLeftOutlined />}>
            Về danh sách phòng
          </Button>
        </Link>
      </div>
    );
  }

  const slide = slides[index] ?? null;
  const metrics = board?.metrics;
  const state = board?.state;
  const openQuestionId = board?.current_question_id ?? null;
  const ended = board?.ended ?? false;

  const correct = metrics?.correct_rate ?? 0;
  const attention = Boolean(state && state.trusted && state.severity >= 2);

  return (
    <Layout className="ai-shell" style={{ minHeight: "100vh" }}>
      {/* Thanh trên nền xanh đậm — giảng viên nhìn một lượt là biết đang dạy phòng nào. */}
      <Header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          paddingInline: 20,
          background: "var(--ai-navy-surface)",
          borderBottom: "1px solid var(--ai-line)",
        }}
      >
        <Link href="/dashboard/rooms">
          <Button
            type="text"
            icon={<ArrowLeftOutlined />}
            aria-label="Về danh sách phòng"
            style={{ color: "#fff" }}
          />
        </Link>
        <div style={{ lineHeight: 1.3, minWidth: 0 }}>
          <div className="truncate text-sm font-extrabold" style={{ color: "#fff" }}>
            {session?.room_name}
          </div>
          <div className="truncate text-xs font-semibold" style={{ color: "rgba(255,255,255,.7)" }}>
            {session?.course_title}
          </div>
        </div>
        <span
          className="rounded-lg px-2.5 py-1 text-sm font-extrabold"
          style={{ background: "rgba(255,255,255,.16)", color: "#fff", letterSpacing: 4 }}
        >
          {session?.room_code}
        </span>
        {ended ? (
          <Tag style={{ marginInlineEnd: 0 }}>đã kết thúc</Tag>
        ) : (
          <span className="flex items-center gap-1.5 text-xs font-bold" style={{ color: "#fff" }}>
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: "#37d67a" }}
              aria-hidden
            />
            đang dạy
          </span>
        )}

        <span style={{ marginInlineStart: "auto" }} />
        <Space>
          <Button
            href={`/teaching-assistant/${sessionId}`}
            target="_blank"
            rel="noreferrer"
            icon={<RadarChartOutlined />}
          >
            Trợ giảng
          </Button>
          <Tooltip title="Học viên đang trong phòng">
            <span
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm font-extrabold"
              style={{ background: "rgba(255,255,255,.16)", color: "#fff" }}
            >
              <TeamOutlined />
              {metrics?.online_students ?? 0}
            </span>
          </Tooltip>
          <Button icon={<BulbOutlined />} loading={asking} onClick={askAdvisor} disabled={ended}>
            Xin gợi ý
          </Button>
          <Button
            type="primary"
            danger
            icon={<PoweroffOutlined />}
            onClick={endSession}
            disabled={ended}
          >
            Kết thúc
          </Button>
        </Space>
      </Header>

      <Content style={{ padding: 16, minWidth: 0 }}>
        <div className="flex gap-4">
          <div className="flex-[4]">
            {ended ? (
              <Alert
                type="info"
                showIcon
                title="Buổi học đã kết thúc"
                description="Bạn vẫn xem lại được số liệu, nhưng không điều khiển lớp được nữa."
                style={{ marginBottom: 16 }}
              />
            ) : null}

            {/* ── trình chiếu ─────────────────────────────────────────────── */}
            <BentoCard
              span={4}
              tone="navy"
              title={`Slide ${index + 1} / ${slides.length}`}
              extra={
                <div className="flex items-center gap-2">
                  {slide?.checkpoint_id ? (
                    <Tag color="red" style={{ marginInlineEnd: 0 }}>
                      checkpoint · {slide.question_count} câu
                    </Tag>
                  ) : null}
                  <Tooltip
                    title={
                      presentOpen
                        ? "Cửa sổ trình chiếu đang mở"
                        : "Mở lại cửa sổ trình chiếu ngay trên khung này"
                    }
                  >
                    <Button
                      size="small"
                      icon={<ExpandOutlined />}
                      onClick={openPresentation}
                      type={presentOpen ? "default" : "primary"}
                    >
                      {presentOpen ? "Trình chiếu" : "Mở lại trình chiếu"}
                    </Button>
                  </Tooltip>
                  <Button
                    size="small"
                    icon={<LeftOutlined />}
                    onClick={() => goto(index - 1)}
                    disabled={index === 0 || ended}
                    aria-label="Slide trước"
                  />
                  <Button
                    size="small"
                    icon={<RightOutlined />}
                    onClick={() => goto(index + 1)}
                    disabled={index >= slides.length - 1 || ended}
                    aria-label="Slide sau"
                  />
                </div>
              }
            >
              {/* Cửa sổ trình chiếu nằm chồng đúng lên khung này, nên phải đo được nó. */}
              <div ref={previewRef} className="relative">
                {slide ? (
                  <SlideCanvas slide={slide} total={slides.length} />
                ) : (
                  <Empty description="Khoá học chưa có slide" />
                )}
                {presentOpen ? (
                  <span
                    className="pointer-events-none absolute right-2 top-2 rounded-md px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-widest"
                    style={{ background: "var(--ai-red)", color: "#fff" }}
                  >
                    đang chiếu
                  </span>
                ) : null}
              </div>
              {slide?.notes ? (
                <p className="m-0 text-xs font-semibold" style={{ color: "var(--ai-muted)" }}>
                  <strong>Ghi chú:</strong> {slide.notes}
                </p>
              ) : null}
            </BentoCard>
          </div>
          <div className="flex flex-[2] flex-col gap-4">
            <div className="flex gap-2">
              {/* ── hàng số liệu nhanh ──────────────────────────────────────── */}
              <BentoCard span={2} tone={attention ? "red" : "navy"} title="Tình hình lớp">
                <div className="text-2xl font-extrabold leading-tight">
                  {state?.label ?? "Đang đo…"}
                </div>
                <div className="text-xs font-semibold" style={{ opacity: 0.8 }}>
                  {state && !state.trusted
                    ? state.sample_note || "Chưa đủ dữ liệu để kết luận."
                    : (state?.reasons?.[0] ?? "Chưa có tín hiệu đáng chú ý.")}
                </div>
              </BentoCard>

              <BentoStat
                label="Đã trả lời"
                value={`${metrics?.responded ?? 0}/${metrics?.online_students ?? 0}`}
                hint={`tham gia ${pct(metrics?.participation ?? 0)}`}
                icon={<TeamOutlined />}
              />
              <BentoStat
                label="Trung vị thời gian"
                value={`${(metrics?.median_response_s ?? 0).toFixed(1)}s`}
                hint={`chậm ${pct(metrics?.slow_rate ?? 0)}`}
                icon={<ClockCircleOutlined />}
              />
            </div>
            {/* ── chất lượng trả lời ──────────────────────────────────────── */}
            <BentoCard span={2} title="Chất lượng trả lời">
              <div className="bento-value">{pct(correct)}</div>
              <BentoBar value={correct} />
              <div className="grid grid-cols-2 gap-2 pt-1">
                {[
                  { label: "Bỏ qua", value: pct(metrics?.skip_rate ?? 0) },
                  { label: "Không chắc", value: pct(metrics?.low_confidence_rate ?? 0) },
                  { label: "Giơ tay", value: String(metrics?.raised_hands ?? 0) },
                  { label: "Quay lại slide", value: String(metrics?.return_slide_count ?? 0) },
                ].map((cell) => (
                  <div
                    key={cell.label}
                    className="rounded-xl px-2.5 py-2"
                    style={{ background: "var(--ai-bg)" }}
                  >
                    <div className="bento-label" style={{ fontSize: 10 }}>
                      {cell.label}
                    </div>
                    <div className="text-base font-extrabold tabular-nums">{cell.value}</div>
                  </div>
                ))}
              </div>

              {metrics?.top_wrong_options?.length ? (
                <>
                  <div className="bento-label pt-1">Phương án sai phổ biến</div>
                  <ul className="m-0 list-none space-y-1 p-0">
                    {metrics.top_wrong_options.map((o, i) => (
                      <li
                        key={i}
                        className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5"
                        style={{ background: "var(--ai-red-tint)" }}
                      >
                        <span className="min-w-0 flex-1 truncate text-xs font-bold">{o.option}</span>
                        <Tag color="red" style={{ marginInlineEnd: 0 }}>
                          {o.count}
                        </Tag>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </BentoCard>
          </div>
        </div>
      </Content>
      <div className="flex gap-4 px-4 pb-4">
        {/* ── điều khiển checkpoint ───────────────────────────────────── */}
        <BentoCard
          span={4}
          tone={openQuestionId ? "red" : "plain"}
          title="Checkpoint tại slide này"
          extra={
            openQuestionId ? (
              <Button
                danger
                size="small"
                icon={<CloseCircleOutlined />}
                onClick={() => openQuestion(null)}
                disabled={ended}
              >
                Đóng câu hỏi
              </Button>
            ) : null
          }
        >
          {questions.length === 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 py-1">
              <span className="text-sm font-semibold" style={{ color: "var(--ai-muted)" }}>
                {slide?.checkpoint_id
                  ? "Checkpoint đang tắt hoặc chưa có câu hỏi."
                  : "Slide này không có checkpoint."}
              </span>
              {session ? (
                <Link href={`/dashboard/courses/${session.course_id}`}>
                  <Button size="small">Sửa trong khoá học</Button>
                </Link>
              ) : null}
            </div>
          ) : (
            <ul className="m-0 list-none space-y-2 p-0">
              {questions.map((q) => {
                const live = openQuestionId === q.id;
                return (
                  <li
                    key={q.id}
                    className="flex flex-wrap items-center gap-3 rounded-xl px-3 py-3"
                    style={{
                      background: live ? "var(--ai-red-tint)" : "var(--ai-bg)",
                      border: live ? "1px solid var(--ai-red)" : "1px solid var(--ai-line)",
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Typography.Text strong={live}>{q.prompt}</Typography.Text>
                        {live ? <Badge status="processing" text="lớp đang thấy" /> : null}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {q.options.map((o, i) => (
                          <Tag key={i} style={{ marginInlineEnd: 0 }}>
                            {o}
                          </Tag>
                        ))}
                        {q.origin === "llm" ? (
                          <Tag color="purple" style={{ marginInlineEnd: 0 }}>
                            nháp AI
                          </Tag>
                        ) : null}
                      </div>
                    </div>
                    <Button
                      type={live ? "default" : "primary"}
                      danger={live}
                      disabled={ended}
                      onClick={() => openQuestion(live ? null : q)}
                    >
                      {live ? "Đang mở — đóng lại" : "Mở câu hỏi"}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </BentoCard>

        {/* ── học viên hỏi ────────────────────────────────────────────── */}
        <BentoCard
          span={2}
          title="Học viên hỏi"
          extra={
            board?.inbox?.length ? (
              <Tag style={{ marginInlineEnd: 0 }}>{board.inbox.length}</Tag>
            ) : null
          }
        >
          {board?.inbox?.length ? (
            <ul className="m-0 max-h-64 list-none space-y-2 overflow-y-auto p-0">
              {board.inbox.map((item, i) => (
                <li
                  key={i}
                  className="rounded-xl px-3 py-2"
                  style={{ background: "var(--ai-bg)" }}
                >
                  <div className="text-xs font-bold">{item.text}</div>
                  <div className="bento-label mt-1" style={{ fontSize: 10 }}>
                    slide {item.slide_index + 1} ·{" "}
                    {new Date(item.at).toLocaleTimeString("vi-VN")}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex items-center gap-2 py-2">
              <MessageOutlined style={{ color: "var(--ai-muted)" }} />
              <span className="text-sm font-semibold" style={{ color: "var(--ai-muted)" }}>
                Chưa có câu hỏi nào từ lớp
              </span>
            </div>
          )}
        </BentoCard>
      </div>
      <AdviceAlert advice={popup} onClose={() => setPopup(null)} onFeedback={rateAdvice} />
    </Layout>
  );
}
