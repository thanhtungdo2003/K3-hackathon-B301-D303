/**
 * Lớp gọi API duy nhất của VINLEARN.
 * Không có dữ liệu mô phỏng — mọi số liệu đều đến từ backend thật.
 */
export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

export const AUTH_TOKEN_STORAGE_KEY = "agora-token";
export const AUTH_SESSION_INVALID_EVENT = "agora-auth-session-invalid";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
}

export function setToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
  else window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function parseError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    const detail = body?.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail) && detail[0]?.msg) return String(detail[0].msg);
  } catch {
    /* giữ thông báo mặc định */
  }
  if (res.status === 401) return "Phiên đăng nhập đã hết hạn.";
  return `Lỗi ${res.status}`;
}

async function request<T>(
  path: string,
  init: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  const { auth = true, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (rest.body !== undefined && !(rest.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const token = auth ? getToken() : null;
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers,
    cache: "no-store",
  });
  if (!res.ok) throw new ApiError(res.status, await parseError(res));
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const body = (v: unknown) => JSON.stringify(v);

/* ---------------------------------------------------------------- kiểu dữ liệu */

export interface UserOut {
  id: number;
  email: string;
  full_name: string;
  organization: string;
  created_at: string;
}

export interface AuthResponse {
  token: string;
  user: UserOut;
}

export interface CourseOut {
  id: number;
  title: string;
  subject: string;
  description: string;
  archived: boolean;
  created_at: string;
  slide_count: number;
  checkpoint_count: number;
  question_count: number;
  room_count: number;
}

export type SlideBlock =
  | { type: "title"; text: string }
  | { type: "kicker"; text: string }
  | { type: "lead"; text: string }
  | { type: "bullets"; items: string[] }
  | { type: "code"; text: string }
  | { type: "note"; text: string }
  | { type: "table"; rows: string[][] }
  | { type: string; [k: string]: unknown };

export interface SlideOut {
  id: number;
  index: number;
  title: string;
  blocks: SlideBlock[];
  notes: string;
  source: string;
  checkpoint_id: number | null;
  question_count: number;
  /** Ảnh trang PDF gốc (đường dẫn tương đối trên backend). Null thì vẽ từ `blocks`. */
  page_image_url?: string | null;
}

export type QuestionType =
  | "multiple_choice"
  | "multiple_select"
  | "true_false"
  | "ordering"
  | "fill_blank"
  | "poll";

export interface QuestionOut {
  id: number;
  position: number;
  type: QuestionType;
  prompt: string;
  options: string[];
  answer: Record<string, unknown>;
  origin: "manual" | "llm";
}

export interface CheckpointOut {
  id: number;
  slide_id: number;
  slide_index: number;
  slide_title: string;
  label: string;
  goal: string;
  active: boolean;
  questions: QuestionOut[];
}

export interface QuestionIn {
  type: QuestionType;
  prompt: string;
  options?: string[];
  answer?: Record<string, unknown>;
  origin?: "manual" | "llm";
}

export interface RoomOut {
  id: number;
  code: string;
  name: string;
  course_id: number;
  course_title: string;
  created_at: string;
  active_session_id: number | null;
  total_sessions: number;
}

export interface SessionOut {
  id: number;
  room_id: number;
  room_code: string;
  room_name: string;
  course_id: number;
  course_title: string;
  title: string;
  started_at: string;
  ended_at: string | null;
  current_slide_index: number;
  current_question_id: number | null;
  slide_count: number;
  online_students: number;
}

export interface Metrics {
  slide_index: number;
  slide_title: string;
  online_students: number;
  responded: number;
  participation: number;
  correct_rate: number;
  wrong_rate: number;
  skip_rate: number;
  median_response_s: number;
  slow_rate: number;
  low_confidence_rate: number;
  return_slide_count: number;
  raised_hands: number;
  asked_questions: number;
  graded_answers: number;
  top_wrong_options: { option: string; count: number }[];
}

export interface StateInfo {
  state: string;
  label: string;
  severity: number;
  reasons: string[];
  trusted: boolean;
  sample_note: string;
}

export interface Advice {
  id?: number;
  should_alert: boolean;
  headline: string;
  action: string;
  evidence: string[];
  confidence: "high" | "medium" | "low";
  source: "ai" | "rule_fallback" | "abstain";
  state: string;
  state_label: string;
  refused: boolean;
  refusal_reason: string;
  guard_flags: string[];
  trace_id: string | null;
  slide_index?: number;
  metrics?: Metrics;
  created_at?: string;
}

export interface TeachingDashboard {
  slide_index: number;
  slide_title: string;
  metrics: Metrics;
  state: StateInfo;
  current_question_id: number | null;
  question_results: {
    question_id: number;
    answered: number;
    graded: number;
    correct: number;
    wrong: number;
    skipped: number;
    correct_rate: number;
    wrong_rate: number;
  } | null;
  ended: boolean;
  inbox: SupportQuestion[];
  latest_advice: Advice | null;
}

export interface Overview {
  courses: number;
  rooms: number;
  sessions: number;
  live_sessions: number;
  slides: number;
  participants: number;
  answers: number;
  correct_rate: number;
  skip_rate: number;
  questions_asked: number;
  hints_requested: number;
  latest_session_summary: SessionUnderstandingSummary | null;
  advisor: {
    total: number;
    alerts: number;
    by_source: Record<string, number>;
    dismiss_rate: number;
    useful_rate: number;
  };
}

export interface UnclearTopic {
  slide_index: number;
  title: string;
  status: "red" | "yellow";
  understood: number;
  temporary: number;
  not_understood: number;
  classified_students: number;
  temporary_rate: number;
  not_understood_rate: number;
  reasons: string[];
}

export interface SessionUnderstandingSummary {
  session: {
    id: number;
    title: string;
    course_title: string;
    started_at: string;
    ended_at: string | null;
  };
  total_students: number;
  classified_students: number;
  coverage_rate: number;
  understood: CountRate;
  temporary: CountRate;
  not_understood: CountRate;
  unclassified_students: number;
  unclear_topics: UnclearTopic[];
  rule_version: string;
  privacy_note: string;
}

export interface SessionSummary {
  id: number;
  title: string;
  room_code: string;
  course_title: string;
  started_at: string;
  ended_at: string | null;
  live: boolean;
  participants: number;
  answers: number;
  correct_rate: number;
}

export interface SlideQuality {
  slide_index: number;
  title: string;
  has_checkpoint: boolean;
  question_count: number;
  answers: number;
  correct_rate: number;
  skip_rate: number;
  low_confidence_rate: number;
  return_visits: number;
  questions_asked: number;
  hints_requested: number;
}

export interface CourseQuality {
  course: { id: number; title: string; subject: string };
  sessions: number;
  slides: SlideQuality[];
  needs_attention: SlideQuality[];
}

export interface ToolCall {
  tool: string;
  label: string;
  args: Record<string, unknown>;
  ok: boolean;
  error: string;
  result: Record<string, unknown>;
}

export interface AssistantTurn {
  reply: string;
  calls: ToolCall[];
  source: "llm" | "rule_fallback" | "unavailable";
  /** true khi trợ lý vừa tạo/sửa dữ liệu — giao diện phải nạp lại số liệu. */
  changed: boolean;
  trace_id: string | null;
}

export interface AssistantStatus {
  available: boolean;
  model: string | null;
  tools: { name: string; label: string }[];
}

export interface CountRate {
  count: number;
  rate: number;
}

export interface AssistantPulse {
  total_students: number;
  classified_students: number;
  on_track: CountRate;
  needs_follow_up: CountRate;
  struggling: CountRate;
  unclassified: CountRate;
  rule_version: string;
  rules: Record<string, string>;
}

export interface AssistantConceptEvidence {
  online_students: number;
  responded: number;
  graded_answers: number;
  wrong_rate: number;
  skip_rate: number;
  low_confidence_rate: number;
  return_visits: number;
  questions_asked: number;
}

export interface AssistantConcept {
  slide_index: number;
  title: string;
  source: "slide_title";
  understanding: number | null;
  status: "green" | "yellow" | "red" | "insufficient_data";
  state: string;
  state_label: string;
  severity: number;
  trusted: boolean;
  sample_note: string;
  evidence: AssistantConceptEvidence;
}

export interface AssistantAdvice {
  id: number;
  slide_index: number;
  headline: string;
  action: string;
  evidence: unknown[];
  confidence: string;
  source: string;
  created_at: string;
}

export interface AssistantDiagnostic {
  slide_index: number;
  state: string;
  state_label: string;
  severity: number;
  reasons: string[];
  trusted: boolean;
  sample_note: string;
  latest_advice: AssistantAdvice | null;
}

export interface AssistantSupportItem {
  key: string;
  type: "raise_hand" | "ask_question";
  question_id: number | null;
  slide_index: number;
  text: string;
  confusion_score: number | null;
  escalated: boolean;
  status: "pending" | "answered" | null;
  answer_text: string | null;
  answered_by: "lecturer" | "assistant" | "ai" | null;
  answer_disclaimer: string | null;
  assigned_to_assistant: boolean;
  assigned_at: string | null;
  created_at: string;
  age_seconds: number;
}

export interface SlideTrackingAggregate {
  session_id: number;
  lecturer_slide_index: number;
  timeout_seconds: number;
  online_students: number;
  tracked_students: number;
  connected_students: number;
  aligned_students: number;
  out_of_sync_students: number;
  unknown_students: number;
  tracking_coverage: number;
  auto_synced_total: number;
  reviewing_previous_students: number;
}

export interface TeachingAssistantDashboard {
  session: {
    id: number;
    title: string;
    course_title: string;
    current_slide_index: number;
    ended: boolean;
  };
  generated_at: string;
  pulse: AssistantPulse;
  concepts: AssistantConcept[];
  hot_concepts: AssistantConcept[];
  diagnostic: AssistantDiagnostic;
  support_queue: AssistantSupportItem[];
  slide_sync: SlideTrackingAggregate;
  current_session_summary: SessionUnderstandingSummary;
  previous_session_summary: SessionUnderstandingSummary | null;
  privacy: {
    identity_fields_omitted: boolean;
    free_text_may_contain_self_identification: boolean;
    note: string;
  };
}

export interface JoinResult {
  token: string;
  participant_id: number;
  session_id: number;
  room_name: string;
  course_title: string;
  display_name: string;
  avatar: string;
  slide_count: number;
  current_slide_index: number;
}

export interface StudentState {
  session_id: number;
  room_name: string;
  course_title: string;
  ended: boolean;
  current_slide_index: number;
  current_question: {
    id: number;
    type: QuestionType;
    prompt: string;
    options: string[];
    slide_index: number;
  } | null;
  current_questions: {
    id: number;
    type: QuestionType;
    prompt: string;
    options: string[];
    slide_index: number;
  }[];
}

export interface SupportQuestion {
  id: number;
  slide_index: number;
  text: string;
  confusion_score: number;
  confusion_threshold: number;
  escalated: boolean;
  status: "pending" | "answered";
  answer_text: string | null;
  answered_by: "lecturer" | "assistant" | "ai" | null;
  answer_disclaimer: string | null;
  assigned_to_assistant?: boolean;
  assigned_at?: string | null;
  created_at?: string;
  answered_at?: string | null;
  at?: string;
}

export interface AiSupportResponse {
  summary: string;
  answer: string;
  confusion_score: number;
  confusion_threshold: number;
  escalated: boolean;
  support_question: SupportQuestion | null;
  disclaimer: string;
}

/* ------------------------------------------------------------------- endpoint */

export const api = {
  /* --- tài khoản giảng viên --- */
  register: (b: {
    email: string;
    password: string;
    full_name: string;
    organization?: string;
  }) =>
    request<AuthResponse>("/auth/register", {
      method: "POST",
      body: body(b),
      auth: false,
    }),
  login: (b: { email: string; password: string }) =>
    request<AuthResponse>("/auth/login", {
      method: "POST",
      body: body(b),
      auth: false,
    }),
  me: () => request<UserOut>("/auth/me"),

  /* --- khoá học --- */
  courses: () => request<CourseOut[]>("/courses"),
  course: (id: number) => request<CourseOut>(`/courses/${id}`),
  createCourse: (b: {
    title: string;
    subject?: string;
    description?: string;
  }) => request<CourseOut>("/courses", { method: "POST", body: body(b) }),
  updateCourse: (id: number, b: Record<string, unknown>) =>
    request<CourseOut>(`/courses/${id}`, { method: "PATCH", body: body(b) }),
  deleteCourse: (id: number) =>
    request<void>(`/courses/${id}`, { method: "DELETE" }),

  /* --- slide --- */
  slides: (courseId: number) =>
    request<SlideOut[]>(`/courses/${courseId}/slides`),
  uploadPptx: (courseId: number, file: File, replace = true) => {
    const form = new FormData();
    form.append("file", file);
    return request<SlideOut[]>(
      `/courses/${courseId}/slides/upload?replace=${replace}`,
      {
        method: "POST",
        body: form,
      },
    );
  },
  uploadPdf: (courseId: number, file: File, replace = true) => {
    const form = new FormData();
    form.append("file", file);
    return request<SlideOut[]>(
      `/courses/${courseId}/slides/upload-pdf?replace=${replace}`,
      {
        method: "POST",
        body: form,
      },
    );
  },
  updateSlide: (slideId: number, b: Record<string, unknown>) =>
    request<SlideOut>(`/courses/slides/${slideId}`, {
      method: "PATCH",
      body: body(b),
    }),

  /* --- checkpoint --- */
  checkpoints: (courseId: number) =>
    request<CheckpointOut[]>(`/courses/${courseId}/checkpoints`),
  createCheckpoint: (slideId: number, b: { label?: string; goal?: string }) =>
    request<CheckpointOut>(`/courses/slides/${slideId}/checkpoint`, {
      method: "POST",
      body: body(b),
    }),
  updateCheckpoint: (id: number, b: Record<string, unknown>) =>
    request<CheckpointOut>(`/courses/checkpoints/${id}`, {
      method: "PATCH",
      body: body(b),
    }),
  deleteCheckpoint: (id: number) =>
    request<void>(`/courses/checkpoints/${id}`, { method: "DELETE" }),
  addQuestions: (checkpointId: number, questions: QuestionIn[]) =>
    request<CheckpointOut>(`/courses/checkpoints/${checkpointId}/questions`, {
      method: "POST",
      body: body(questions),
    }),
  deleteQuestion: (id: number) =>
    request<void>(`/courses/questions/${id}`, { method: "DELETE" }),
  draftQuestions: (checkpointId: number, count = 2) =>
    request<{ questions: QuestionIn[]; source: string; note: string }>(
      `/courses/checkpoints/${checkpointId}/draft`,
      { method: "POST", body: body({ count }) },
    ),

  /* --- phòng học & buổi học --- */
  rooms: () => request<RoomOut[]>("/rooms"),
  createRoom: (b: { course_id: number; name: string }) =>
    request<RoomOut>("/rooms", { method: "POST", body: body(b) }),
  deleteRoom: (id: number) =>
    request<void>(`/rooms/${id}`, { method: "DELETE" }),
  startSession: (roomId: number) =>
    request<SessionOut>(`/rooms/${roomId}/sessions`, { method: "POST" }),
  endSession: (sessionId: number) =>
    request<SessionOut>(`/rooms/sessions/${sessionId}/end`, { method: "POST" }),
  session: (sessionId: number) =>
    request<SessionOut>(`/rooms/sessions/${sessionId}`),

  /* --- Bục Giảng --- */
  changeSlide: (sessionId: number, slide_index: number) =>
    request<{ slide_index: number; current_question_id: number | null }>(`/teaching/sessions/${sessionId}/slide`, {
      method: "POST",
      body: body({ slide_index }),
    }),
  checkpointQuestions: (sessionId: number, slideIndex?: number) =>
    request<QuestionOut[]>(
      `/teaching/sessions/${sessionId}/checkpoint` +
        (slideIndex === undefined ? "" : `?slide_index=${slideIndex}`),
    ),
  triggerQuestion: (sessionId: number, question_id: number | null) =>
    request<{ current_question_id: number | null }>(
      `/teaching/sessions/${sessionId}/question`,
      {
        method: "POST",
        body: body({ question_id }),
      },
    ),
  teachingDashboard: (sessionId: number) =>
    request<TeachingDashboard>(`/teaching/sessions/${sessionId}/dashboard`),
  answerSupportQuestion: (
    sessionId: number,
    questionId: number,
    b: { text: string; answered_by: "lecturer" | "assistant" },
  ) =>
    request<SupportQuestion>(
      `/teaching/sessions/${sessionId}/support-questions/${questionId}/answer`,
      {
        method: "POST",
        body: body(b),
      },
    ),
  assignSupportQuestionToAssistant: (sessionId: number, questionId: number) =>
    request<{
      question_id: number;
      assigned_to_assistant: boolean;
      assigned_at: string;
    }>(
      `/teaching/sessions/${sessionId}/support-questions/${questionId}/assign-assistant`,
      { method: "POST" },
    ),
  advice: (
    sessionId: number,
    b: { slide_index?: number; lecturer_request?: string },
  ) =>
    request<Advice>(`/teaching/sessions/${sessionId}/advice`, {
      method: "POST",
      body: body(b),
    }),
  adviceFeedback: (
    sessionId: number,
    adviceId: number,
    feedback: string,
    note = "",
  ) =>
    request<{ ok: boolean }>(
      `/teaching/sessions/${sessionId}/advice/${adviceId}/feedback`,
      {
        method: "POST",
        body: body({ feedback, note }),
      },
    ),

  /* --- trợ lý AI của dashboard --- */
  assistantStatus: () => request<AssistantStatus>("/assistant/status"),
  assistantChat: (
    messages: { role: "user" | "assistant"; content: string }[],
  ) =>
    request<AssistantTurn>("/assistant/chat", {
      method: "POST",
      body: body({ messages }),
    }),

  /* --- console Trợ giảng theo thời gian thực --- */
  teachingAssistantDashboard: (sessionId: number) =>
    request<TeachingAssistantDashboard>(
      `/teaching-assistant/sessions/${sessionId}/dashboard`,
    ),
  assistantSlideTracking: (sessionId: number) =>
    request<SlideTrackingAggregate>(
      `/teaching-assistant/sessions/${sessionId}/slide-tracking`,
    ),

  /* --- dashboard chủ phòng --- */
  overview: () => request<Overview>("/insights/overview"),
  recentSessions: (limit = 10) =>
    request<SessionSummary[]>(`/insights/sessions?limit=${limit}`),
  courseQuality: (courseId: number) =>
    request<CourseQuality>(`/insights/courses/${courseId}/quality`),

  /* --- học viên (không cần tài khoản, chỉ mã phòng) --- */
  join: (b: { code: string; display_name: string; avatar?: string }) =>
    request<JoinResult>("/join", {
      method: "POST",
      body: body(b),
      auth: false,
    }),
  studentSlides: (sessionId: number) =>
    request<SlideOut[]>(`/sessions/${sessionId}/slides`, { auth: false }),
  studentState: (sessionId: number, token?: string) =>
    request<StudentState>(
      `/sessions/${sessionId}/state${token ? `?token=${encodeURIComponent(token)}` : ""}`,
      { auth: false },
    ),
  submitAnswer: (
    sessionId: number,
    b: {
      token: string;
      question_id: number;
      value: unknown;
      response_ms: number;
      skipped?: boolean;
      confidence?: number;
    },
  ) =>
    request<{
      correct: boolean | null;
      score: number;
      explanation: string | null;
      correct_answer: string | null;
    }>(`/sessions/${sessionId}/answers`, {
      method: "POST",
      body: body(b),
      auth: false,
    }),
  recordEvent: (
    sessionId: number,
    b: {
      token: string;
      type: string;
      slide_index: number;
      payload?: Record<string, unknown>;
    },
  ) =>
    request<unknown>(`/sessions/${sessionId}/events`, {
      method: "POST",
      body: body(b),
      auth: false,
    }),
  requestHint: (sessionId: number, b: { token: string; slide_index: number }) =>
    request<{
      id: number;
      questions: string[];
      source: string;
      note: string;
      guard_flags: string[];
    }>(`/sessions/${sessionId}/hints`, {
      method: "POST",
      body: body(b),
      auth: false,
    }),
  sendHint: (
    sessionId: number,
    hintId: number,
    b: { token: string; question: string },
  ) =>
    request<unknown>(`/sessions/${sessionId}/hints/${hintId}/send`, {
      method: "POST",
      body: body(b),
      auth: false,
    }),
  askQuestion: (
    sessionId: number,
    b: { token: string; slide_index: number; text: string },
  ) =>
    request<SupportQuestion>(`/sessions/${sessionId}/questions`, {
      method: "POST",
      body: body(b),
      auth: false,
    }),
  myQuestions: (sessionId: number, token: string) =>
    request<SupportQuestion[]>(
      `/sessions/${sessionId}/questions?token=${encodeURIComponent(token)}`,
      { auth: false },
    ),
  aiSupport: (
    sessionId: number,
    b: { token: string; slide_index: number; message?: string },
  ) =>
    request<AiSupportResponse>(`/sessions/${sessionId}/ai-support`, {
      method: "POST",
      body: body(b),
      auth: false,
    }),
  leave: (sessionId: number, token: string) =>
    request<unknown>(`/sessions/${sessionId}/leave`, {
      method: "POST",
      body: body({ token }),
      auth: false,
    }),
};
