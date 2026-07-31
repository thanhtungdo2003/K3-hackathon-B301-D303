"use client";

import {
  ApartmentOutlined,
  AppstoreOutlined,
  ArrowLeftOutlined,
  BellOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  DisconnectOutlined,
  EyeOutlined,
  HistoryOutlined,
  LinkOutlined,
  MessageOutlined,
  MoonOutlined,
  QuestionCircleOutlined,
  RadarChartOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SunOutlined,
  SyncOutlined,
  TeamOutlined,
  WarningFilled,
} from "@ant-design/icons";
import {
  Alert,
  App,
  Badge,
  Button,
  Card,
  Col,
  Divider,
  Empty,
  Input,
  Layout,
  Menu,
  Progress,
  Row,
  Skeleton,
  Space,
  Statistic,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTheme } from "@/app/providers";
import {
  api,
  type AssistantConcept,
  type AssistantSupportItem,
  type CountRate,
  type SessionUnderstandingSummary,
  type TeachingAssistantDashboard,
} from "@/lib/api";
import { getToken, useAuth } from "@/lib/auth";
import { joinLecturerSession } from "@/lib/socket";

const { Header, Sider, Content } = Layout;

const PULSE_META: Array<{
  key: "on_track" | "needs_follow_up" | "struggling" | "unclassified";
  label: string;
  shortLabel: string;
  color: string;
  icon: ReactNode;
}> = [
  {
    key: "on_track",
    label: "Đang theo kịp",
    shortLabel: "Theo kịp",
    color: "#18A66A",
    icon: <CheckCircleFilled />,
  },
  {
    key: "needs_follow_up",
    label: "Cần theo dõi",
    shortLabel: "Cần theo dõi",
    color: "#E69A17",
    icon: <EyeOutlined />,
  },
  {
    key: "struggling",
    label: "Đang gặp khó",
    shortLabel: "Gặp khó",
    color: "#E5484D",
    icon: <WarningFilled />,
  },
  {
    key: "unclassified",
    label: "Chưa phân loại",
    shortLabel: "Chưa rõ",
    color: "#7C8AA5",
    icon: <QuestionCircleOutlined />,
  },
];

const CONCEPT_STATUS = {
  green: { label: "Ổn định", color: "success" },
  yellow: { label: "Cần theo dõi", color: "warning" },
  red: { label: "Đang gặp khó", color: "error" },
  insufficient_data: { label: "Chưa đủ dữ liệu", color: "default" },
} as const;

function clampRate(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function percent(value: number) {
  return Math.round(clampRate(value) * 100);
}

function formatMoment(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "không rõ";
  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function formatAge(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (seconds < 15) return "vừa xong";
  if (seconds < 60) return `${seconds} giây trước`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  return `${Math.floor(hours / 24)} ngày trước`;
}

function diagnosticColor(state: string, trusted: boolean) {
  if (!trusted || state === "insufficient_data") return "default";
  if (state === "healthy" || state === "stable") return "success";
  if (state === "discussion_active") return "processing";
  if (state === "need_review" || state === "low_participation") return "warning";
  if (state === "need_attention" || state === "high_confusion") return "error";
  return "default";
}

function formatTimeout(seconds: number) {
  if (seconds > 0 && seconds % 60 === 0) return `${seconds / 60} phút`;
  return `${Math.max(0, seconds)} giây`;
}

function belongsToSession(payload: unknown, sessionId: number) {
  if (!payload || typeof payload !== "object" || !("session_id" in payload)) return true;
  return Number((payload as { session_id?: unknown }).session_id) === sessionId;
}

function evidenceText(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value && typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "Bằng chứng bổ sung";
    }
  }
  return "";
}

function PulseDonut({
  total,
  values,
}: {
  total: number;
  values: Record<(typeof PULSE_META)[number]["key"], CountRate>;
}) {
  let offset = 0;
  const arcs = PULSE_META.map((item) => {
    const raw = total > 0 ? (values[item.key].count / total) * 100 : 0;
    const length = Math.max(0, raw - (raw > 2 ? 1.5 : 0));
    const arc = { ...item, dash: `${length} ${100 - length}`, offset: -offset };
    offset += raw;
    return arc;
  });

  return (
    <div className="relative mx-auto h-44 w-44 shrink-0" role="img" aria-label={`${total} học viên đang trực tuyến`}>
      <svg viewBox="0 0 120 120" className="h-full w-full" aria-hidden="true">
        <circle
          cx="60"
          cy="60"
          r="44"
          fill="none"
          stroke="var(--ai-line)"
          strokeWidth="11"
        />
        {arcs.map((arc) => (
          <circle
            key={arc.key}
            cx="60"
            cy="60"
            r="44"
            pathLength="100"
            fill="none"
            stroke={arc.color}
            strokeWidth="11"
            strokeLinecap="round"
            strokeDasharray={arc.dash}
            strokeDashoffset={arc.offset}
            transform="rotate(-90 60 60)"
          />
        ))}
      </svg>
      <div className="absolute inset-0 grid place-content-center text-center">
        <span
          className="text-4xl font-extrabold tabular-nums"
          style={{ color: "var(--ai-ink)", lineHeight: 1 }}
        >
          {total}
        </span>
        <span className="mt-1 text-[11px] font-bold" style={{ color: "var(--ai-muted)" }}>
          trực tuyến
        </span>
      </div>
    </div>
  );
}

function PulseStat({
  item,
  value,
}: {
  item: (typeof PULSE_META)[number];
  value: CountRate;
}) {
  return (
    <div
      className="flex min-h-28 flex-col justify-between rounded-2xl border p-4"
      style={{
        borderColor: "var(--ai-line)",
        background: "var(--ai-bg)",
        borderTop: `3px solid ${item.color}`,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold" style={{ color: "var(--ai-muted)" }}>
          {item.label}
        </span>
        <span aria-hidden="true" style={{ color: item.color }}>
          {item.icon}
        </span>
      </div>
      <div className="flex items-end justify-between gap-2">
        <span className="text-3xl font-extrabold tabular-nums" style={{ color: item.color }}>
          {percent(value.rate)}%
        </span>
        <span className="pb-1 text-xs font-semibold tabular-nums" style={{ color: "var(--ai-muted)" }}>
          {value.count} người
        </span>
      </div>
    </div>
  );
}

function ConceptRow({
  concept,
  current,
}: {
  concept: AssistantConcept;
  current: boolean;
}) {
  const meta = CONCEPT_STATUS[concept.status];
  const trusted = concept.trusted && concept.understanding !== null;

  return (
    <li
      className="rounded-2xl border p-4"
      style={{
        borderColor: current ? "var(--ai-blue)" : "var(--ai-line)",
        background: current ? "var(--ai-blue-tint)" : "var(--ai-card)",
      }}
    >
      <div className="flex flex-wrap items-start gap-3">
        <span
          className="grid h-9 min-w-9 place-items-center rounded-xl px-2 text-xs font-extrabold tabular-nums"
          style={{ background: "var(--ai-navy)", color: "#fff" }}
          aria-label={`Slide ${concept.slide_index + 1}`}
        >
          {concept.slide_index + 1}
        </span>
        <div className="min-w-0 flex-1 sm:min-w-52">
          <div className="flex flex-wrap items-center gap-2">
            <Typography.Text strong>{concept.title}</Typography.Text>
            {current ? <Tag color="blue">đang trình chiếu</Tag> : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Tag>{concept.evidence.graded_answers} câu đã chấm</Tag>
            {concept.evidence.return_visits > 0 ? (
              <Tag>{concept.evidence.return_visits} lượt xem lại</Tag>
            ) : null}
            {concept.evidence.questions_asked > 0 ? (
              <Tag>{concept.evidence.questions_asked} câu hỏi</Tag>
            ) : null}
          </div>
        </div>
        <div className="w-full sm:w-64">
          {trusted ? (
            <>
              <div className="mb-1 flex items-center justify-between gap-3">
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Mức hiểu
                </Typography.Text>
                <Typography.Text strong style={{ fontVariantNumeric: "tabular-nums" }}>
                  {percent(concept.understanding ?? 0)}%
                </Typography.Text>
              </div>
              <Progress
                percent={percent(concept.understanding ?? 0)}
                showInfo={false}
                strokeColor={
                  concept.status === "green"
                    ? "#18A66A"
                    : concept.status === "yellow"
                      ? "#E69A17"
                      : "#E5484D"
                }
              />
            </>
          ) : (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {concept.sample_note || "Chưa đủ dữ liệu để tính mức hiểu."}
            </Typography.Text>
          )}
        </div>
        <Tag color={meta.color} style={{ marginInlineEnd: 0 }}>
          {concept.state_label || meta.label}
        </Tag>
      </div>
    </li>
  );
}

function MetricTile({
  label,
  value,
  hint,
  tone = "normal",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "normal" | "success" | "warning" | "danger";
}) {
  const color = {
    normal: "var(--ai-ink)",
    success: "#18A66A",
    warning: "#E69A17",
    danger: "#E5484D",
  }[tone];

  return (
    <div
      className="rounded-2xl border p-3"
      style={{ borderColor: "var(--ai-line)", background: "var(--ai-bg)" }}
    >
      <Statistic
        title={label}
        value={value as string | number}
        valueStyle={{ color, fontSize: 24, fontWeight: 800 }}
      />
      {hint ? (
        <div className="mt-1 text-[11px] font-semibold" style={{ color: "var(--ai-muted)" }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

function UnderstandingSummaryCard({
  summary,
  title,
}: {
  summary: SessionUnderstandingSummary;
  title: string;
}) {
  const groups = [
    { label: "Hiểu bài", value: summary.understood, color: "#18A66A" },
    { label: "Tạm hiểu", value: summary.temporary, color: "#E69A17" },
    { label: "Chưa hiểu", value: summary.not_understood, color: "#E5484D" },
  ];
  return (
    <Card
      className="h-full"
      title={
        <Space>
          <HistoryOutlined />
          {title}
        </Space>
      }
      extra={<Tag>độ phủ {percent(summary.coverage_rate)}%</Tag>}
    >
      <div className="mb-3">
        <Typography.Text strong>{summary.session.title}</Typography.Text>
        <div className="text-xs font-semibold" style={{ color: "var(--ai-muted)" }}>
          {summary.session.course_title} · {summary.classified_students}/
          {summary.total_students} học viên đủ tín hiệu
        </div>
      </div>
      <Row gutter={[10, 10]}>
        {groups.map((group) => (
          <Col xs={24} sm={8} key={group.label}>
            <div
              className="rounded-2xl border p-3"
              style={{
                borderColor: "var(--ai-line)",
                borderTop: `3px solid ${group.color}`,
                background: "var(--ai-bg)",
              }}
            >
              <div className="text-xs font-bold" style={{ color: "var(--ai-muted)" }}>
                {group.label}
              </div>
              <div className="text-2xl font-extrabold" style={{ color: group.color }}>
                {percent(group.value.rate)}%
              </div>
              <div className="text-xs font-semibold">{group.value.count} học viên</div>
            </div>
          </Col>
        ))}
      </Row>
      <Divider titlePlacement="start" plain>
        Nội dung học viên chưa hiểu/cần xem lại
      </Divider>
      {summary.unclear_topics.length ? (
        <ul className="m-0 list-none space-y-2 p-0">
          {summary.unclear_topics.map((topic) => (
            <li
              key={topic.slide_index}
              className="rounded-xl border px-3 py-2"
              style={{ borderColor: "var(--ai-line)", background: "var(--ai-bg)" }}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Tag color={topic.status === "red" ? "red" : "gold"}>
                  slide {topic.slide_index + 1}
                </Tag>
                <Typography.Text strong>{topic.title}</Typography.Text>
              </div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {topic.reasons.join(" · ")}
              </Typography.Text>
            </li>
          ))}
        </ul>
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="Chưa ghi nhận nội dung cần xem lại"
        />
      )}
      <Typography.Text type="secondary" style={{ display: "block", marginTop: 10, fontSize: 11 }}>
        {summary.privacy_note}
      </Typography.Text>
    </Card>
  );
}

function SupportItem({
  item,
  elapsedSeconds,
  draft,
  busy,
  onDraftChange,
  onAnswer,
}: {
  item: AssistantSupportItem;
  elapsedSeconds: number;
  draft: string;
  busy: boolean;
  onDraftChange: (value: string) => void;
  onAnswer: () => void;
}) {
  const question = item.type === "ask_question";
  return (
    <li
      className="rounded-2xl border p-4"
      style={{ borderColor: "var(--ai-line)", background: "var(--ai-bg)" }}
    >
      <div className="flex items-start gap-3">
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl"
          style={{
            background: question ? "var(--ai-blue-tint)" : "var(--ai-red-tint)",
            color: question ? "var(--ai-blue)" : "var(--ai-red)",
          }}
          aria-hidden="true"
        >
          {question ? <MessageOutlined /> : <BellOutlined />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Typography.Text strong>
              {question
                ? "Câu hỏi không gắn hồ sơ"
                : "Yêu cầu hỗ trợ không gắn hồ sơ"}
            </Typography.Text>
            <Tag color={question ? "blue" : "red"}>slide {item.slide_index + 1}</Tag>
            {item.confusion_score !== null ? (
              <Tag color={item.escalated ? "red" : "default"}>
                bối rối {Math.round(item.confusion_score * 100)}%
              </Tag>
            ) : null}
            {item.assigned_to_assistant ? (
              <Tag color="purple">Giảng viên chuyển</Tag>
            ) : null}
          </div>
          <Typography.Paragraph style={{ margin: "6px 0 0", overflowWrap: "anywhere" }}>
            {item.text || "Học viên chưa nhập nội dung."}
          </Typography.Paragraph>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            <ClockCircleOutlined /> {formatAge(item.age_seconds + elapsedSeconds)}
          </Typography.Text>
          {question && item.status === "answered" ? (
            <Alert
              type={item.answered_by === "ai" ? "warning" : "success"}
              showIcon
              style={{ marginTop: 10 }}
              title={`Đã trả lời bởi ${
                item.answered_by === "ai"
                  ? "AI"
                  : item.answered_by === "assistant"
                    ? "trợ giảng"
                    : "giảng viên"
              }`}
              description={
                <>
                  {item.answer_text}
                  {item.answer_disclaimer ? (
                    <div style={{ marginTop: 4 }}>{item.answer_disclaimer}</div>
                  ) : null}
                </>
              }
            />
          ) : question && item.question_id !== null ? (
            <Space.Compact style={{ width: "100%", marginTop: 10 }}>
              <Input
                value={draft}
                onChange={(event) => onDraftChange(event.target.value)}
                onPressEnter={onAnswer}
                placeholder="Trợ giảng nhập câu trả lời…"
                maxLength={2000}
                disabled={busy}
              />
              <Button
                type="primary"
                onClick={onAnswer}
                loading={busy}
                disabled={!draft.trim()}
              >
                TA trả lời
              </Button>
            </Space.Compact>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function LoadingDashboard() {
  return (
    <div className="space-y-4">
      <Skeleton active paragraph={{ rows: 2 }} />
      <Row gutter={[16, 16]}>
        {Array.from({ length: 4 }).map((_, index) => (
          <Col xs={24} sm={12} xl={6} key={index}>
            <Card>
              <Skeleton active paragraph={{ rows: 2 }} title={false} />
            </Card>
          </Col>
        ))}
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={15}>
          <Card>
            <Skeleton active paragraph={{ rows: 8 }} />
          </Card>
        </Col>
        <Col xs={24} xl={9}>
          <Card>
            <Skeleton active paragraph={{ rows: 8 }} />
          </Card>
        </Col>
      </Row>
    </div>
  );
}

export default function TeachingAssistantPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = Number(params.sessionId);
  const validSessionId = Number.isInteger(sessionId) && sessionId > 0;
  const { user, loading: authLoading } = useAuth();
  const { dark, toggle } = useTheme();
  const { message } = App.useApp();

  const [dashboard, setDashboard] = useState<TeachingAssistantDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [connection, setConnection] = useState<"connecting" | "online" | "offline">(
    "connecting",
  );
  const [realtimeWarning, setRealtimeWarning] = useState("");
  const [lastSuccessfulAt, setLastSuccessfulAt] = useState<number | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const [collapsed, setCollapsed] = useState(false);
  const [activeSection, setActiveSection] = useState("overview");
  const [answerDrafts, setAnswerDrafts] = useState<Record<number, string>>({});
  const [answeringId, setAnsweringId] = useState<number | null>(null);
  const debounceRef = useRef<number | null>(null);
  const refreshGenerationRef = useRef(0);
  const refreshInFlightRef = useRef<number | null>(null);
  const refreshQueuedRef = useRef(false);

  const refresh = useCallback(
    async function runRefresh(silent = false) {
      if (!validSessionId) {
        setError("Mã buổi học không hợp lệ.");
        setLoading(false);
        return;
      }
      const generation = refreshGenerationRef.current;
      if (refreshInFlightRef.current === generation) {
        refreshQueuedRef.current = true;
        return;
      }
      refreshInFlightRef.current = generation;
      if (silent) setRefreshing(true);
      else setLoading(true);
      setError("");
      try {
        const next = await api.teachingAssistantDashboard(sessionId);
        if (generation !== refreshGenerationRef.current) return;
        setDashboard(next);
        setLastSuccessfulAt(Date.now());
        if (next.session.ended) {
          setConnection("offline");
          setRealtimeWarning("");
        }
      } catch (err) {
        if (generation !== refreshGenerationRef.current) return;
        setError(err instanceof Error ? err.message : "Không tải được dữ liệu trợ giảng.");
      } finally {
        if (refreshInFlightRef.current === generation) {
          refreshInFlightRef.current = null;
        }
        if (generation !== refreshGenerationRef.current) return;
        setLoading(false);
        setRefreshing(false);
        if (refreshQueuedRef.current) {
          refreshQueuedRef.current = false;
          queueMicrotask(() => void runRefresh(true));
        }
      }
    },
    [sessionId, validSessionId],
  );

  const answerSupportQuestion = useCallback(
    async (questionId: number) => {
      const text = answerDrafts[questionId]?.trim();
      if (!text || answeringId !== null) return;
      setAnsweringId(questionId);
      try {
        await api.answerSupportQuestion(sessionId, questionId, {
          text,
          answered_by: "assistant",
        });
        setAnswerDrafts((drafts) => ({ ...drafts, [questionId]: "" }));
        message.success("Đã gửi câu trả lời của trợ giảng.");
        await refresh(true);
      } catch (err) {
        message.error(err instanceof Error ? err.message : "Không gửi được câu trả lời.");
      } finally {
        setAnsweringId(null);
      }
    },
    [answerDrafts, answeringId, message, refresh, sessionId],
  );

  useEffect(() => {
    const generation = refreshGenerationRef.current + 1;
    refreshGenerationRef.current = generation;
    refreshQueuedRef.current = false;
    return () => {
      if (refreshGenerationRef.current === generation) {
        refreshGenerationRef.current += 1;
        refreshQueuedRef.current = false;
      }
    };
  }, [sessionId]);

  useEffect(() => {
    if (authLoading || !user) return;
    void refresh(false);
  }, [authLoading, user, refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 10000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!user || !validSessionId || dashboard?.session.ended) return;
    const token = getToken();
    if (!token) return;

    const handle = joinLecturerSession(sessionId, token);
    const { socket } = handle;
    setConnection("connecting");

    const scheduleRefresh = (payload?: unknown) => {
      if (!belongsToSession(payload, sessionId)) return;
      if (debounceRef.current !== null) return;
      debounceRef.current = window.setTimeout(() => {
        debounceRef.current = null;
        void refresh(true);
      }, 750);
    };
    const onConnect = () => {
      setConnection("connecting");
      setRealtimeWarning("");
    };
    const onDisconnect = () => {
      setConnection("offline");
      setRealtimeWarning("Mất kết nối realtime; dashboard đang dùng polling dự phòng.");
    };
    const onConnectError = () => {
      setConnection("offline");
      setRealtimeWarning("Không kết nối được Socket.IO; dashboard đang dùng polling dự phòng.");
    };
    const onJoined = (payload: {
      session_id?: number;
      role?: string;
      ok?: boolean;
      tracking_enabled?: boolean;
    }) => {
      if (
        payload.session_id !== sessionId ||
        payload.role !== "lecturer"
      ) {
        return;
      }
      if (payload.ok && payload.tracking_enabled) {
        setConnection("online");
        setRealtimeWarning("");
        scheduleRefresh(payload);
      } else {
        setConnection("offline");
        setRealtimeWarning("Socket đã kết nối nhưng chưa tham gia được kênh trợ giảng.");
      }
    };
    const onTrackingError = (payload: { message?: string }) => {
      setConnection("offline");
      setRealtimeWarning(
        payload.message || "Không xác thực được kênh realtime của buổi học.",
      );
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on("joined", onJoined);
    socket.on("slide_tracking_error", onTrackingError);
    socket.on("slide_tracking_summary", scheduleRefresh);
    socket.on("answer_received", scheduleRefresh);
    socket.on("signal", scheduleRefresh);
    socket.on("roster_changed", scheduleRefresh);
    socket.on("slide_changed", scheduleRefresh);
    socket.on("question_opened", scheduleRefresh);
    socket.on("question_closed", scheduleRefresh);
    socket.on("support_question", scheduleRefresh);
    socket.on("support_answered", scheduleRefresh);
    socket.on("support_assigned", scheduleRefresh);
    socket.on("session_ended", scheduleRefresh);

    return () => {
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.off("joined", onJoined);
      socket.off("slide_tracking_error", onTrackingError);
      socket.off("slide_tracking_summary", scheduleRefresh);
      socket.off("answer_received", scheduleRefresh);
      socket.off("signal", scheduleRefresh);
      socket.off("roster_changed", scheduleRefresh);
      socket.off("slide_changed", scheduleRefresh);
      socket.off("question_opened", scheduleRefresh);
      socket.off("question_closed", scheduleRefresh);
      socket.off("support_question", scheduleRefresh);
      socket.off("support_answered", scheduleRefresh);
      socket.off("support_assigned", scheduleRefresh);
      socket.off("session_ended", scheduleRefresh);
      handle.dispose();
    };
  }, [user, validSessionId, sessionId, dashboard?.session.ended, refresh]);

  useEffect(() => {
    if (!user || !validSessionId || dashboard?.session.ended) return;
    const timer = window.setInterval(() => void refresh(true), 12000);
    return () => window.clearInterval(timer);
  }, [user, validSessionId, dashboard?.session.ended, refresh]);

  const pulseValues = useMemo(() => {
    if (!dashboard) return null;
    return {
      on_track: dashboard.pulse.on_track,
      needs_follow_up: dashboard.pulse.needs_follow_up,
      struggling: dashboard.pulse.struggling,
      unclassified: dashboard.pulse.unclassified,
    };
  }, [dashboard]);

  const stale =
    dashboard !== null &&
    !dashboard.session.ended &&
    lastSuccessfulAt !== null &&
    clock - lastSuccessfulAt > 30000;
  const elapsedSinceRefresh =
    lastSuccessfulAt === null
      ? 0
      : Math.max(0, Math.floor((clock - lastSuccessfulAt) / 1000));

  const nav = [
    { key: "overview", icon: <AppstoreOutlined />, label: "Tổng quan lớp" },
    { key: "concepts", icon: <ApartmentOutlined />, label: "Bản đồ khái niệm" },
    { key: "support", icon: <BellOutlined />, label: "Hàng đợi hỗ trợ" },
    { key: "sync", icon: <LinkOutlined />, label: "Đồng bộ slide" },
  ];

  if (authLoading || (!user && !error)) {
    return (
      <div className="ai-shell grid min-h-screen place-items-center">
        <Skeleton active paragraph={{ rows: 4 }} style={{ width: 360 }} />
      </div>
    );
  }

  return (
    <Layout className="ai-shell" style={{ minHeight: "100vh" }}>
      <Sider
        theme="dark"
        breakpoint="lg"
        width={248}
        collapsedWidth={0}
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
      >
        <Link
          href="/dashboard"
          className="flex h-20 items-center gap-3 px-4"
          style={{ color: "#fff", borderBottom: "1px solid rgba(255,255,255,.12)" }}
        >
          <span
            className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl font-extrabold"
            style={{ background: "#1CB8E8", color: "#061428" }}
          >
            TA
          </span>
          {!collapsed ? (
            <span className="min-w-0">
              <span className="block font-extrabold">Trợ giảng</span>
              <span className="block text-[11px]" style={{ opacity: 0.7 }}>
                VINLEARN Console
              </span>
            </span>
          ) : null}
        </Link>

        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[activeSection]}
          items={nav}
          onClick={({ key }) => {
            setActiveSection(key);
            document
              .getElementById(key)
              ?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
          style={{ borderInlineEnd: "none", paddingTop: 12, background: "transparent" }}
        />

        {!collapsed ? (
          <div
            className="mx-3 mt-6 rounded-2xl border p-3 text-xs"
            style={{
              borderColor: "rgba(255,255,255,.16)",
              color: "rgba(255,255,255,.72)",
            }}
          >
            <SafetyCertificateOutlined /> Chỉ hiển thị dữ liệu tổng hợp và tín hiệu không
            gắn hồ sơ học viên.
          </div>
        ) : null}
      </Sider>

      <Layout style={{ minWidth: 0, background: "var(--ai-bg)" }}>
        <Header
          style={{
            height: "auto",
            minHeight: 68,
            padding: "10px 18px",
            background: "var(--ai-card)",
            borderBottom: "1px solid var(--ai-line)",
            position: "sticky",
            top: 0,
            zIndex: 20,
          }}
        >
          <div className="flex min-h-12 flex-wrap items-center gap-3">
            <Button
              href="/dashboard/rooms"
              type="text"
              icon={<ArrowLeftOutlined />}
              aria-label="Về danh sách phòng"
            />
            <div className="min-w-44 flex-1 leading-tight">
              <Typography.Text strong>{dashboard?.session.title ?? "Console trợ giảng"}</Typography.Text>
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {dashboard?.session.course_title ?? "Theo dõi lớp học theo thời gian thực"}
                </Typography.Text>
              </div>
            </div>
            {!dashboard ? (
              <Tag>chưa xác định trạng thái</Tag>
            ) : dashboard.session.ended ? (
              <Tag>đã kết thúc</Tag>
            ) : (
              <Badge status={connection === "online" ? "processing" : "warning"} text="đang diễn ra" />
            )}
            <Tooltip title={dark ? "Giao diện sáng" : "Giao diện tối"}>
              <Button
                type="text"
                icon={dark ? <SunOutlined /> : <MoonOutlined />}
                onClick={toggle}
                aria-label="Đổi giao diện sáng tối"
              />
            </Tooltip>
            <Button
              icon={<ReloadOutlined spin={refreshing} />}
              onClick={() => void refresh(true)}
              loading={refreshing}
              aria-label="Làm mới dữ liệu trợ giảng"
            >
              <span className="hidden sm:inline">Làm mới</span>
            </Button>
            <Button
              href={`/teach/${sessionId}`}
              type="primary"
              icon={<RadarChartOutlined />}
              aria-label="Mở Bục giảng"
            >
              <span className="hidden sm:inline">Bục giảng</span>
            </Button>
          </div>
        </Header>

        <Content style={{ padding: "clamp(14px, 2vw, 24px)", minWidth: 0 }}>
          <main className="mx-auto max-w-[1540px] space-y-4">
            {error ? (
              <Alert
                type={dashboard ? "warning" : "error"}
                showIcon
                title={
                  dashboard
                    ? `Chưa cập nhật được dữ liệu mới: ${error}`
                    : error
                }
                action={
                  <Button size="small" onClick={() => void refresh(true)}>
                    Thử lại
                  </Button>
                }
              />
            ) : null}

            {stale ? (
              <Alert
                type="warning"
                showIcon
                title="Dữ liệu đã quá 30 giây chưa được cập nhật."
                description="Kiểm tra kết nối backend hoặc tải lại trang trước khi ra quyết định hỗ trợ."
              />
            ) : null}

            {realtimeWarning && !dashboard?.session.ended ? (
              <Alert
                type="warning"
                showIcon
                title={realtimeWarning}
                description="Dữ liệu REST vẫn được tải lại mỗi 12 giây."
              />
            ) : null}

            {loading && !dashboard ? (
              <LoadingDashboard />
            ) : dashboard && pulseValues ? (
              <>
                <section id="overview" className="scroll-mt-24">
                  <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <Typography.Text
                        className="text-xs font-extrabold tracking-[0.16em]"
                        style={{ color: "var(--ai-blue)" }}
                      >
                        THEO DÕI KHÔNG GẮN ĐỊNH DANH HỆ THỐNG
                      </Typography.Text>
                      <Typography.Title level={2} style={{ margin: "4px 0 0", color: "var(--ai-ink)" }}>
                        Nhịp hiểu bài theo thời gian thực
                      </Typography.Title>
                      <Typography.Text type="secondary">
                        Slide {dashboard.session.current_slide_index + 1} đang trình chiếu
                      </Typography.Text>
                    </div>
                    <Space size={6} wrap>
                      {dashboard.session.ended ? (
                        <Tag>Ảnh chụp cuối · không còn cập nhật</Tag>
                      ) : (
                        <Tag icon={<SyncOutlined spin={connection === "connecting"} />}>
                          {connection === "online"
                            ? "Realtime đã xác thực"
                            : connection === "connecting"
                              ? "Đang xác thực kênh"
                              : "Polling dự phòng"}
                        </Tag>
                      )}
                      <Tag>
                        cập nhật {formatMoment(dashboard.generated_at)}
                      </Tag>
                    </Space>
                  </div>

                  {dashboard.session.ended ? (
                    <Alert
                      type="info"
                      showIcon
                      title="Buổi học đã kết thúc"
                      description="Các số liệu bên dưới là ảnh chụp cuối của buổi học và sẽ không còn cập nhật realtime."
                      style={{ marginBottom: 16 }}
                    />
                  ) : null}

                  <Card
                    title="Tình hình lớp trên slide hiện tại"
                    extra={
                      <Tooltip title={dashboard.pulse.rules.scope}>
                        <Tag>{dashboard.pulse.rule_version}</Tag>
                      </Tooltip>
                    }
                  >
                    <Row gutter={[16, 16]} align="middle">
                      <Col xs={24} md={7} xl={5}>
                        <PulseDonut
                          total={dashboard.pulse.total_students}
                          values={pulseValues}
                        />
                        <div className="mt-2 text-center text-xs font-semibold" style={{ color: "var(--ai-muted)" }}>
                          {dashboard.pulse.classified_students}/{dashboard.pulse.total_students} học viên
                          đã đủ tín hiệu phân nhóm
                        </div>
                      </Col>
                      <Col xs={24} md={17} xl={19}>
                        <Row gutter={[12, 12]}>
                          {PULSE_META.map((item) => (
                            <Col xs={24} sm={12} xl={6} key={item.key}>
                              <PulseStat item={item} value={pulseValues[item.key]} />
                            </Col>
                          ))}
                        </Row>
                      </Col>
                    </Row>
                  </Card>
                </section>

                <Row gutter={[16, 16]} align="stretch">
                  <Col xs={24} xl={12}>
                    <section className="h-full">
                      <UnderstandingSummaryCard
                        summary={dashboard.current_session_summary}
                        title="Tổng quan buổi học hiện tại"
                      />
                    </section>
                  </Col>
                  <Col xs={24} xl={12}>
                    <section className="h-full">
                      {dashboard.previous_session_summary ? (
                        <UnderstandingSummaryCard
                          summary={dashboard.previous_session_summary}
                          title="Tổng quan buổi học gần nhất"
                        />
                      ) : (
                        <Card className="h-full" title="Tổng quan buổi học gần nhất">
                          <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description="Chưa có buổi học trước đã kết thúc"
                          />
                        </Card>
                      )}
                    </section>
                  </Col>
                </Row>

                <Row gutter={[16, 16]} align="stretch">
                  <Col xs={24} xl={15}>
                    <section id="concepts" className="h-full scroll-mt-24">
                      <Card
                        className="h-full"
                        title={
                          <Space>
                            <ApartmentOutlined />
                            Bản đồ khái niệm
                          </Space>
                        }
                        extra={
                          dashboard.concepts.some(
                            (concept) =>
                              concept.trusted &&
                              (concept.status === "yellow" || concept.status === "red"),
                          ) ? (
                            <Tag color="warning">
                              {
                                dashboard.concepts.filter(
                                  (concept) =>
                                    concept.trusted &&
                                    (concept.status === "yellow" ||
                                      concept.status === "red"),
                                ).length
                              }{" "}
                              điểm nóng
                            </Tag>
                          ) : (
                            <Tag>chưa có điểm nóng đáng tin cậy</Tag>
                          )
                        }
                      >
                        <Typography.Paragraph type="secondary" style={{ marginTop: -4 }}>
                          Mỗi khái niệm lấy từ tiêu đề slide. Mức hiểu chỉ xuất hiện khi đủ số câu trả
                          lời được chấm để kết luận.
                        </Typography.Paragraph>
                        {dashboard.concepts.length ? (
                          <ul
                            className="m-0 list-none space-y-2 overflow-y-auto p-0 pr-1"
                            style={{ maxHeight: 660 }}
                          >
                            {dashboard.concepts.map((concept) => (
                              <ConceptRow
                                key={concept.slide_index}
                                concept={concept}
                                current={
                                  concept.slide_index ===
                                  dashboard.session.current_slide_index
                                }
                              />
                            ))}
                          </ul>
                        ) : (
                          <Empty description="Khoá học chưa có slide để phân tích" />
                        )}
                      </Card>
                    </section>
                  </Col>

                  <Col xs={24} xl={9}>
                    <section className="h-full">
                      <Card
                        className="h-full"
                        title="Chẩn đoán slide hiện tại"
                        extra={
                          <Tag
                            color={diagnosticColor(
                              dashboard.diagnostic.state,
                              dashboard.diagnostic.trusted,
                            )}
                          >
                            {dashboard.diagnostic.state_label}
                          </Tag>
                        }
                      >
                        <div
                          className="rounded-2xl border p-4"
                          style={{ borderColor: "var(--ai-line)", background: "var(--ai-bg)" }}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-xs font-bold" style={{ color: "var(--ai-muted)" }}>
                                ĐANG PHÂN TÍCH
                              </div>
                              <Typography.Title level={4} style={{ margin: "3px 0 0" }}>
                                Slide {dashboard.diagnostic.slide_index + 1}
                              </Typography.Title>
                            </div>
                            <span
                              className="grid h-11 w-11 place-items-center rounded-2xl text-xl"
                              style={{
                                color: dashboard.diagnostic.trusted
                                  ? "var(--ai-blue)"
                                  : "var(--ai-muted)",
                                background: "var(--ai-blue-tint)",
                              }}
                            >
                              <RadarChartOutlined />
                            </span>
                          </div>
                        </div>

                        {!dashboard.diagnostic.trusted ? (
                          <Alert
                            type="warning"
                            showIcon
                            title={
                              dashboard.diagnostic.sample_note ||
                              "Chưa đủ dữ liệu để chẩn đoán đáng tin cậy."
                            }
                            style={{ marginTop: 14 }}
                          />
                        ) : null}

                        {dashboard.diagnostic.reasons.length ? (
                          <>
                            <Divider titlePlacement="start" plain>
                              Nguồn bằng chứng
                            </Divider>
                            <ul className="m-0 space-y-2 pl-5">
                              {dashboard.diagnostic.reasons.map((reason, index) => (
                                <li key={`${reason}-${index}`}>
                                  <Typography.Text>{reason}</Typography.Text>
                                </li>
                              ))}
                            </ul>
                          </>
                        ) : null}

                        <Divider titlePlacement="start" plain>
                          Gợi ý gần nhất
                        </Divider>
                        {dashboard.diagnostic.latest_advice ? (
                          <div
                            className="rounded-2xl border p-4"
                            style={{
                              borderColor: "var(--ai-blue)",
                              background: "var(--ai-blue-tint)",
                            }}
                          >
                            <Typography.Title level={5} style={{ margin: 0 }}>
                              {dashboard.diagnostic.latest_advice.headline}
                            </Typography.Title>
                            <Typography.Paragraph style={{ margin: "8px 0" }}>
                              {dashboard.diagnostic.latest_advice.action}
                            </Typography.Paragraph>
                            {dashboard.diagnostic.latest_advice.evidence.length ? (
                              <ul className="m-0 space-y-1 pl-5">
                                {dashboard.diagnostic.latest_advice.evidence.map(
                                  (evidence, index) => {
                                    const text = evidenceText(evidence);
                                    return text ? <li key={index}>{text}</li> : null;
                                  },
                                )}
                              </ul>
                            ) : null}
                            <div className="mt-3 flex flex-wrap gap-2">
                              <Tag>{dashboard.diagnostic.latest_advice.source}</Tag>
                              <Tag>{dashboard.diagnostic.latest_advice.confidence}</Tag>
                            </div>
                          </div>
                        ) : (
                          <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description="Chưa có gợi ý được lưu cho slide này"
                          />
                        )}
                      </Card>
                    </section>
                  </Col>
                </Row>

                <Row gutter={[16, 16]} align="stretch">
                  <Col xs={24} xl={10}>
                    <section id="sync" className="h-full scroll-mt-24">
                      <Card
                        className="h-full"
                        title={
                          <Space>
                            <LinkOutlined />
                            Đồng bộ slide
                          </Space>
                        }
                        extra={
                          <Tag color={dashboard.slide_sync.out_of_sync_students ? "warning" : "success"}>
                            slide giảng viên: {dashboard.slide_sync.lecturer_slide_index + 1}
                          </Tag>
                        }
                      >
                        <div className="mb-4 flex items-end justify-between gap-3">
                          <div>
                            <div className="text-xs font-bold" style={{ color: "var(--ai-muted)" }}>
                              PHẠM VI TRACKING
                            </div>
                            <div className="text-3xl font-extrabold tabular-nums">
                              {percent(dashboard.slide_sync.tracking_coverage)}%
                            </div>
                          </div>
                          <Typography.Text type="secondary" style={{ textAlign: "right", fontSize: 12 }}>
                            {dashboard.slide_sync.tracked_students}/{dashboard.slide_sync.online_students} học viên
                            trực tuyến
                          </Typography.Text>
                        </div>
                        <Progress
                          percent={percent(dashboard.slide_sync.tracking_coverage)}
                          showInfo={false}
                          strokeColor="var(--ai-blue)"
                        />

                        <Row gutter={[10, 10]} style={{ marginTop: 14 }}>
                          <Col xs={24} sm={12}>
                            <MetricTile
                              label="Cùng slide"
                              value={dashboard.slide_sync.aligned_students}
                              tone="success"
                              hint="đã được tracking"
                            />
                          </Col>
                          <Col xs={24} sm={12}>
                            <MetricTile
                              label="Đang lệch"
                              value={dashboard.slide_sync.out_of_sync_students}
                              tone={
                                dashboard.slide_sync.out_of_sync_students ? "danger" : "normal"
                              }
                              hint="đang đếm thời gian"
                            />
                          </Col>
                          <Col xs={24} sm={12}>
                            <MetricTile
                              label="Chưa có telemetry"
                              value={dashboard.slide_sync.unknown_students}
                              tone="warning"
                              hint="không đồng nghĩa đang lệch"
                            />
                          </Col>
                          <Col xs={24} sm={12}>
                            <MetricTile
                              label="Lệnh đã phát"
                              value={dashboard.slide_sync.auto_synced_total}
                              hint="đã emit, chưa phải xác nhận từ client"
                            />
                          </Col>
                        </Row>

                        {dashboard.slide_sync.out_of_sync_students > 0 ? (
                          <Alert
                            type="warning"
                            showIcon
                            title={`${dashboard.slide_sync.out_of_sync_students} học viên đang xem slide khác`}
                            description={`Nếu vẫn lệch liên tục ${formatTimeout(
                              dashboard.slide_sync.timeout_seconds,
                            )}, backend sẽ đưa từng tab về slide mới nhất của giảng viên.`}
                            style={{ marginTop: 14 }}
                          />
                        ) : (
                          <Alert
                            type="success"
                            showIcon
                            title="Chưa ghi nhận học viên nào đang lệch slide"
                            style={{ marginTop: 14 }}
                          />
                        )}

                        {dashboard.slide_sync.reviewing_previous_students > 0 ? (
                          <Alert
                            type="warning"
                            showIcon
                            title={`${dashboard.slide_sync.reviewing_previous_students} học viên đang xem lại slide trước`}
                            description="Những học viên này được cắm cờ tổng hợp ở nhóm vàng “tạm hiểu”; không hiển thị danh tính."
                            style={{ marginTop: 10 }}
                          />
                        ) : null}

                        <Divider style={{ margin: "14px 0" }} />
                        <Space size={6} wrap>
                          <Tag icon={<TeamOutlined />}>
                            {dashboard.slide_sync.online_students} trực tuyến
                          </Tag>
                          <Tag icon={<LinkOutlined />}>
                            {dashboard.slide_sync.connected_students} học viên có kết nối tracking
                          </Tag>
                          <Tag icon={<ClockCircleOutlined />}>
                            ngưỡng {formatTimeout(dashboard.slide_sync.timeout_seconds)}
                          </Tag>
                        </Space>
                      </Card>
                    </section>
                  </Col>

                  <Col xs={24} xl={14}>
                    <section id="support" className="h-full scroll-mt-24">
                      <Card
                        className="h-full"
                        title={
                          <Space>
                            <BellOutlined />
                            Hàng đợi hỗ trợ không gắn hồ sơ
                          </Space>
                        }
                        extra={<Tag>{dashboard.support_queue.length} tín hiệu</Tag>}
                      >
                        <Alert
                          type="info"
                          showIcon
                          icon={<SafetyCertificateOutlined />}
                          title={
                            dashboard.privacy.identity_fields_omitted
                              ? "Đã loại bỏ tên, avatar, token và mã học viên khỏi payload."
                              : "Payload này chưa xác nhận đã loại bỏ mọi trường định danh."
                          }
                          description={
                            dashboard.privacy.free_text_may_contain_self_identification
                              ? `${dashboard.privacy.note} Không coi nội dung tự do là ẩn danh tuyệt đối.`
                              : dashboard.privacy.note
                          }
                          style={{ marginBottom: 14 }}
                        />
                        {dashboard.support_queue.length ? (
                          <ul
                            className="m-0 list-none space-y-2 overflow-y-auto p-0 pr-1"
                            style={{ maxHeight: 480 }}
                          >
                            {dashboard.support_queue.map((item) => (
                              <SupportItem
                                key={item.key}
                                item={item}
                                elapsedSeconds={elapsedSinceRefresh}
                                draft={
                                  item.question_id === null
                                    ? ""
                                    : (answerDrafts[item.question_id] ?? "")
                                }
                                busy={item.question_id === answeringId}
                                onDraftChange={(value) => {
                                  if (item.question_id === null) return;
                                  setAnswerDrafts((drafts) => ({
                                    ...drafts,
                                    [item.question_id!]: value,
                                  }));
                                }}
                                onAnswer={() => {
                                  if (item.question_id !== null) {
                                    void answerSupportQuestion(item.question_id);
                                  }
                                }}
                              />
                            ))}
                          </ul>
                        ) : (
                          <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description="Chưa có yêu cầu hỗ trợ hoặc câu hỏi từ lớp"
                          />
                        )}
                      </Card>
                    </section>
                  </Col>
                </Row>

                <footer className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    <SafetyCertificateOutlined /> Dữ liệu cấp lớp, không dùng để xếp hạng cá nhân.
                  </Typography.Text>
                  {dashboard.session.ended ? (
                    <Tag>Ảnh chụp cuối · không còn realtime hoặc polling</Tag>
                  ) : connection === "online" ? (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      Realtime Socket.IO · polling dự phòng mỗi 12 giây
                    </Typography.Text>
                  ) : (
                    <Tag
                      icon={
                        connection === "connecting" ? (
                          <SyncOutlined spin />
                        ) : (
                          <DisconnectOutlined />
                        )
                      }
                      color="warning"
                    >
                      Polling 12 giây đang làm kênh dự phòng
                    </Tag>
                  )}
                </footer>
              </>
            ) : (
              <Card>
                <Empty
                  description="Không có dữ liệu trợ giảng cho buổi học này"
                >
                  <Button href="/dashboard/rooms">Về danh sách phòng</Button>
                </Empty>
              </Card>
            )}
          </main>
        </Content>
      </Layout>
    </Layout>
  );
}
