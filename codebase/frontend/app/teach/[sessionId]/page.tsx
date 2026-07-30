"use client";

/**
 * Bục Giảng — màn hình điều khiển buổi dạy.
 * Giao diện dành cho giảng viên: Ant Design, tông nghiêm túc, mật độ thông tin cao.
 */
import {
  ArrowLeftOutlined,
  BulbOutlined,
  CloseCircleOutlined,
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
  Card,
  Col,
  Descriptions,
  Empty,
  Layout,
  Progress,
  Row,
  Space,
  Spin,
  Statistic,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import AdviceAlert from "@/components/AdviceAlert";
import SlideCanvas from "@/components/SlideCanvas";
import { STATE_COLOR } from "@/components/icons";
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
            <Space orientation="vertical" size={8}>
              <Typography.Text>{advice.action}</Typography.Text>
              {advice.evidence.map((e, i) => (
                <Typography.Text key={i} type="secondary">
                  — {e}
                </Typography.Text>
              ))}
            </Space>
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

  return (
    <Layout className="ai-shell" style={{ minHeight: "100vh" }}>
      <Header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          paddingInline: 20,
          borderBottom: "1px solid var(--c-line)",
          backgroundColor: "var(--ai-card)",
        }}
      >
        <Link href="/dashboard/rooms">
          <Button type="text" icon={<ArrowLeftOutlined />} aria-label="Về danh sách phòng" />
        </Link>
        <Space orientation="vertical" size={0} style={{ lineHeight: 1.3 }}>
          <Typography.Text strong>{session?.room_name}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {session?.course_title}
          </Typography.Text>
        </Space>
        <Tag style={{ letterSpacing: 3, fontWeight: 700, marginInlineStart: 8 }}>
          {session?.room_code}
        </Tag>
        {ended ? <Tag color="default">đã kết thúc</Tag> : <Badge status="processing" text="đang dạy" />}

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
            <Tag icon={<TeamOutlined />}>{metrics?.online_students ?? 0}</Tag>
          </Tooltip>
          <Button
            icon={<BulbOutlined />}
            loading={asking}
            onClick={askAdvisor}
            disabled={ended}
          >
            Xin gợi ý
          </Button>
          <Button danger icon={<PoweroffOutlined />} onClick={endSession} disabled={ended}>
            Kết thúc
          </Button>
        </Space>
      </Header>

      <Content style={{ padding: 20 }}>
        {ended ? (
          <Alert
            type="info"
            showIcon
            title="Buổi học đã kết thúc"
            description="Bạn vẫn xem lại được số liệu, nhưng không điều khiển lớp được nữa."
            style={{ marginBottom: 16 }}
          />
        ) : null}

        <Row gutter={[16, 16]}>
          {/* trình chiếu */}
          <Col xs={24} xl={15}>
            <Card
              styles={{ body: { padding: 16 } }}
              title={
                <Space>
                  <Typography.Text strong>
                    Slide {index + 1} / {slides.length}
                  </Typography.Text>
                  {slide?.checkpoint_id ? (
                    <Tag color="red">checkpoint · {slide.question_count} câu</Tag>
                  ) : null}
                </Space>
              }
              extra={
                <Space>
                  <Button
                    icon={<LeftOutlined />}
                    onClick={() => goto(index - 1)}
                    disabled={index === 0 || ended}
                    aria-label="Slide trước"
                  />
                  <Button
                    icon={<RightOutlined />}
                    onClick={() => goto(index + 1)}
                    disabled={index >= slides.length - 1 || ended}
                    aria-label="Slide sau"
                  />
                </Space>
              }
            >
              {slide ? (
                <SlideCanvas slide={slide} total={slides.length} />
              ) : (
                <Empty description="Khoá học chưa có slide" />
              )}

              {slide?.notes ? (
                <Alert
                  type="info"
                  style={{ marginTop: 12 }}
                  title={
                    <Typography.Text style={{ fontSize: 13 }}>
                      <strong>Ghi chú:</strong> {slide.notes}
                    </Typography.Text>
                  }
                />
              ) : null}
            </Card>

            {/* điều khiển checkpoint */}
            <Card
              title="Checkpoint tại slide này"
              style={{ marginTop: 16 }}
              extra={
                openQuestionId ? (
                  <Button
                    danger
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
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={
                    slide?.checkpoint_id
                      ? "Checkpoint đang tắt hoặc chưa có câu hỏi."
                      : "Slide này không có checkpoint."
                  }
                >
                  {session ? (
                    <Link href={`/dashboard/courses/${session.course_id}`}>
                      <Button>Sửa trong khoá học</Button>
                    </Link>
                  ) : null}
                </Empty>
              ) : (
                <ul className="m-0 list-none space-y-2 p-0">
                  {questions.map((q) => {
                    const live = openQuestionId === q.id;
                    return (
                      <li
                        key={q.id}
                        className="flex flex-wrap items-center gap-3 rounded-xl px-3 py-3"
                        style={{
                          background: "var(--ai-bg)",
                          border: live
                            ? "1px solid var(--ai-red)"
                            : "1px solid var(--ai-line)",
                        }}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Typography.Text strong={live}>{q.prompt}</Typography.Text>
                            {live ? <Badge status="processing" text="lớp đang thấy" /> : null}
                          </div>
                          <Space size={4} wrap style={{ marginTop: 6 }}>
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
                          </Space>
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
            </Card>
          </Col>

          {/* bảng số liệu */}
          <Col xs={24} xl={9}>
            <Space orientation="vertical" size={16} style={{ width: "100%" }}>
              <Card
                title="Tình hình lớp"
                extra={
                  state ? (
                    <Tag color={STATE_COLOR[state.state] ?? "default"}>{state.label}</Tag>
                  ) : null
                }
              >
                {state && !state.trusted ? (
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 16 }}
                    title={state.sample_note || "Chưa đủ dữ liệu để kết luận."}
                  />
                ) : null}

                <Row gutter={[12, 12]}>
                  <Col span={12}>
                    <Statistic
                      title="Đã trả lời"
                      value={metrics?.responded ?? 0}
                      suffix={`/ ${metrics?.online_students ?? 0}`}
                    />
                  </Col>
                  <Col span={12}>
                    <Statistic
                      title="Thời gian trả lời"
                      value={metrics?.median_response_s ?? 0}
                      suffix="s"
                      precision={1}
                    />
                  </Col>
                </Row>

                <div style={{ marginTop: 16 }}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    TỈ LỆ ĐÚNG
                  </Typography.Text>
                  <Progress
                    percent={Math.round((metrics?.correct_rate ?? 0) * 100)}
                    strokeColor={
                      (metrics?.correct_rate ?? 0) >= 0.6
                        ? "#58CC02"
                        : (metrics?.correct_rate ?? 0) >= 0.4
                          ? "#FF9600"
                          : "#FF4B4B"
                    }
                  />
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    THAM GIA
                  </Typography.Text>
                  <Progress
                    percent={Math.round((metrics?.participation ?? 0) * 100)}
                    strokeColor="#1CB0F6"
                  />
                </div>

                <Descriptions
                  size="small"
                  column={2}
                  style={{ marginTop: 12 }}
                  items={[
                    { key: "skip", label: "Bỏ qua", children: pct(metrics?.skip_rate ?? 0) },
                    {
                      key: "unsure",
                      label: "Không chắc",
                      children: pct(metrics?.low_confidence_rate ?? 0),
                    },
                    { key: "hand", label: "Giơ tay", children: metrics?.raised_hands ?? 0 },
                    {
                      key: "back",
                      label: "Quay lại slide",
                      children: metrics?.return_slide_count ?? 0,
                    },
                  ]}
                />

                {metrics?.top_wrong_options?.length ? (
                  <>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      PHƯƠNG ÁN SAI PHỔ BIẾN
                    </Typography.Text>
                    <ul className="m-0 mt-1 list-none space-y-1 p-0">
                      {metrics.top_wrong_options.map((o, i) => (
                        <li
                          key={i}
                          className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5"
                          style={{ background: "var(--ai-bg)" }}
                        >
                          <Typography.Text style={{ fontSize: 13 }}>{o.option}</Typography.Text>
                          <Tag color="red" style={{ marginInlineEnd: 0 }}>
                            {o.count}
                          </Tag>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </Card>

              <Card
                title={
                  <Space>
                    <MessageOutlined />
                    Học viên hỏi
                  </Space>
                }
              >
                {board?.inbox?.length ? (
                  <ul className="m-0 list-none space-y-2 p-0">
                    {board.inbox.map((item, i) => (
                      <li
                        key={i}
                        className="rounded-xl px-3 py-2"
                        style={{ background: "var(--ai-bg)" }}
                      >
                        <Typography.Text style={{ fontSize: 13 }}>{item.text}</Typography.Text>
                        <div>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            slide {item.slide_index + 1} ·{" "}
                            {new Date(item.at).toLocaleTimeString("vi-VN")}
                          </Typography.Text>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="Chưa có câu hỏi nào từ lớp"
                  />
                )}
              </Card>
            </Space>
          </Col>
        </Row>
      </Content>

      <AdviceAlert advice={popup} onClose={() => setPopup(null)} onFeedback={rateAdvice} />
    </Layout>
  );
}
