"use client";

/** Màn hình của học viên trong buổi học. */
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BlockConfirm from "@/components/BlockConfirm";
import type { Socket } from "socket.io-client";
import { BlockButton, BlockCard } from "@/components/Blocks";
import SlideCanvas from "@/components/SlideCanvas";
import ThemeToggle from "@/components/ThemeToggle";
import { Icon, avatarIcon, avatarLabel } from "@/components/icons";
import { api, type SlideOut, type StudentState, type SupportQuestion } from "@/lib/api";
import { joinStudentSession } from "@/lib/socket";
import { useLearner, useLearnerHydrated } from "@/lib/store";

type OpenQuestion = NonNullable<StudentState["current_question"]>;
type AiMessage = {
  role: "student" | "ai";
  text: string;
  score?: number;
  escalated?: boolean;
};

interface TrackingSnapshot {
  session_id: number;
  slide_index: number;
  lecturer_slide_index: number;
  following_lecturer: boolean;
  out_of_sync: boolean;
  remaining_seconds: number | null;
  timeout_seconds: number;
}

interface SyncNotice {
  text: string;
  kind: "synced" | "warning";
}

interface ForceSyncPayload {
  session_id: number;
  slide_index: number;
  sync_id: string;
}

export default function LearnPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = Number(params.sessionId);
  const router = useRouter();
  const profile = useLearner((s) => s.profile);
  const setProfile = useLearner((s) => s.setProfile);
  const hydrated = useLearnerHydrated();

  const [slides, setSlides] = useState<SlideOut[]>([]);
  const [index, setIndex] = useState(0);
  const [lecturerIndex, setLecturerIndex] = useState(0);
  const [follow, setFollow] = useState(true);
  const [ended, setEnded] = useState(false);
  const [question, setQuestion] = useState<OpenQuestion | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [ordering, setOrdering] = useState<string[]>([]);
  const [typed, setTyped] = useState("");
  const [result, setResult] = useState<{
    correct: boolean | null;
    explanation: string | null;
    correctAnswer: string | null;
  } | null>(null);
  const [handRaised, setHandRaised] = useState(false);
  const [hints, setHints] = useState<{ id: number; questions: string[] } | null>(null);
  const [hintBusy, setHintBusy] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [trackingReady, setTrackingReady] = useState(false);
  const [trackingActive, setTrackingActive] = useState<boolean | null>(null);
  const [syncDeadline, setSyncDeadline] = useState<number | null>(null);
  const [syncClock, setSyncClock] = useState(() => Date.now());
  const [syncTimeoutSeconds, setSyncTimeoutSeconds] = useState<number | null>(null);
  const [syncNotice, setSyncNotice] = useState<SyncNotice | null>(null);
  const [askText, setAskText] = useState("");
  const [askBusy, setAskBusy] = useState(false);
  const [myQuestions, setMyQuestions] = useState<SupportQuestion[]>([]);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiTab, setAiTab] = useState<"ai" | "human">("ai");
  const [aiSummary, setAiSummary] = useState("");
  const [aiMessages, setAiMessages] = useState<AiMessage[]>([]);
  const [aiInput, setAiInput] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const openedAt = useRef<number>(Date.now());
  const questionQueueRef = useRef<OpenQuestion[]>([]);
  const questionAdvanceTimer = useRef<number | null>(null);
  const indexRef = useRef(0);
  const lecturerIndexRef = useRef(0);
  const followRef = useRef(true);
  const endedRef = useRef(false);
  const joinedRef = useRef(false);
  const slideStateRevisionRef = useRef(0);
  const correctionAckRevisionRef = useRef<number | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const seenSyncIds = useRef(new Set<string>());
  const noticeTimer = useRef<number | null>(null);

  /* --------------------------------------------------------------- vào phiên */

  useEffect(() => {
    // Chỉ xét sau khi store đã đọc xong localStorage, tránh đá nhầm người đang học.
    if (!hydrated) return;
    if (!profile || profile.session_id !== sessionId) router.replace("/join");
  }, [hydrated, profile, sessionId, router]);

  const applyQuestion = useCallback((q: OpenQuestion | null) => {
    setQuestion(q);
    setPicked([]);
    setTyped("");
    setOrdering(q?.type === "ordering" ? shuffle(q.options) : []);
    setResult(null);
    openedAt.current = Date.now();
  }, []);

  const applyQuestions = useCallback(
    (questions: OpenQuestion[]) => {
      if (questionAdvanceTimer.current !== null) {
        window.clearTimeout(questionAdvanceTimer.current);
        questionAdvanceTimer.current = null;
      }
      if (questions.length) setAiOpen(false);
      const queue = questions.slice(1);
      questionQueueRef.current = queue;
      applyQuestion(questions[0] ?? null);
    },
    [applyQuestion],
  );

  const applySlideState = useCallback((slideIndex: number, following: boolean) => {
    indexRef.current = slideIndex;
    followRef.current = following;
    setIndex(slideIndex);
    setFollow(following);
  }, []);

  const showSyncNotice = useCallback(
    (text: string, kind: SyncNotice["kind"], autoHide = false) => {
      if (noticeTimer.current !== null) {
        window.clearTimeout(noticeTimer.current);
        noticeTimer.current = null;
      }
      setSyncNotice({ text, kind });
      if (autoHide) {
        noticeTimer.current = window.setTimeout(() => {
          setSyncNotice(null);
          noticeTimer.current = null;
        }, 7000);
      }
    },
    [],
  );

  const applyTrackingSnapshot = useCallback(
    (snapshot: TrackingSnapshot, authoritative = false) => {
      if (
        endedRef.current ||
        snapshot.session_id !== sessionId ||
        !Number.isInteger(snapshot.slide_index) ||
        snapshot.slide_index < 0 ||
        !Number.isInteger(snapshot.lecturer_slide_index) ||
        snapshot.lecturer_slide_index < 0
      ) {
        return;
      }

      // Update thường là ACK cho telemetry vừa gửi. Bỏ snapshot cũ nếu người
      // học đã thao tác tiếp hoặc vừa nhận force-sync sau khi ACK đó được tạo.
      const matchesLocal =
        snapshot.slide_index === indexRef.current &&
        snapshot.following_lecturer === followRef.current &&
        snapshot.lecturer_slide_index === lecturerIndexRef.current;
      if (!authoritative && !matchesLocal) return false;

      lecturerIndexRef.current = snapshot.lecturer_slide_index;
      setLecturerIndex(snapshot.lecturer_slide_index);
      applySlideState(snapshot.slide_index, snapshot.following_lecturer);
      setSyncTimeoutSeconds(snapshot.timeout_seconds);
      setTrackingActive(true);
      if (
        snapshot.out_of_sync &&
        typeof snapshot.remaining_seconds === "number"
      ) {
        setSyncClock(Date.now());
        setSyncDeadline(Date.now() + Math.max(0, snapshot.remaining_seconds) * 1000);
      } else {
        setSyncDeadline(null);
      }
      return true;
    },
    [applySlideState, sessionId],
  );

  const reportSlide = useCallback(
    (slideIndex: number, following: boolean) => {
      const current = socketRef.current;
      if (endedRef.current || !joinedRef.current || !current?.connected) return;
      current.emit("student_slide_changed", {
        session_id: sessionId,
        slide_index: slideIndex,
        following,
      });
    },
    [sessionId],
  );

  useEffect(() => {
    if (!profile || profile.session_id !== sessionId) return;
    let alive = true;
    let retryTimer: number | null = null;
    joinedRef.current = false;
    slideStateRevisionRef.current = 0;
    correctionAckRevisionRef.current = null;
    setTrackingReady(false);
    setTrackingActive(null);
    setSyncDeadline(null);

    const recoverState = async () => {
      if (endedRef.current) return;
      try {
        const fresh = await api.studentState(sessionId, profile.token);
        if (!alive) return;
        // `ended` là trạng thái terminal; response active cũ không được làm
        // sống lại session sau khi event kết thúc đã tới.
        if (endedRef.current && !fresh.ended) return;
        endedRef.current = fresh.ended;
        setEnded(fresh.ended);
        applyQuestions(
          fresh.ended
            ? []
            : fresh.current_questions?.length
              ? fresh.current_questions
              : fresh.current_question
                ? [fresh.current_question]
                : [],
        );
        if (fresh.ended) {
          joinedRef.current = false;
          setTrackingActive(false);
          setTrackingReady(false);
        }
      } catch {
        if (alive) retryTimer = window.setTimeout(recoverState, 2500);
      }
    };

    const bootstrap = async () => {
      const [slidesResult, stateResult] = await Promise.allSettled([
        api.studentSlides(sessionId),
        api.studentState(sessionId, profile.token),
      ]);
      if (!alive) return;

      if (slidesResult.status === "rejected") {
        showSyncNotice(
          "Mất kết nối khi tải slide. Hệ thống đang thử lại.",
          "warning",
        );
        retryTimer = window.setTimeout(bootstrap, 2000);
        return;
      }

      const list = slidesResult.value;
      setSlides(list);
      if (stateResult.status === "fulfilled") {
        const state = stateResult.value;
        lecturerIndexRef.current = state.current_slide_index;
        setLecturerIndex(state.current_slide_index);
        applySlideState(state.current_slide_index, true);
        endedRef.current = state.ended;
        setEnded(state.ended);
        applyQuestions(
          state.current_questions?.length
            ? state.current_questions
            : state.current_question
              ? [state.current_question]
              : [],
        );
        setTrackingReady(!state.ended && list.length > 0);
      } else if (list.length > 0) {
        // REST /state có thể lỗi thoáng qua. Vẫn join tracking ở slide hợp lệ
        // đầu tiên; snapshot `joined` sẽ reconcile về target mới nhất.
        endedRef.current = false;
        setEnded(false);
        applySlideState(0, true);
        setTrackingReady(true);
        showSyncNotice(
          "Đang khôi phục trạng thái lớp từ kênh realtime.",
          "warning",
        );
        retryTimer = window.setTimeout(recoverState, 1500);
      }
      const own = await api
        .myQuestions(sessionId, profile.token)
        .catch(() => [] as SupportQuestion[]);
      if (alive) setMyQuestions(own);
    };

    void bootstrap();
    return () => {
      alive = false;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [
    profile,
    sessionId,
    applyQuestions,
    applySlideState,
    showSyncNotice,
  ]);

  useEffect(() => {
    if (!profile || profile.session_id !== sessionId || !trackingReady) return;
    const handle = joinStudentSession(sessionId, profile.token, () => ({
      slide_index: indexRef.current,
      following: followRef.current,
    }));
    const { socket } = handle;
    socketRef.current = socket;
    let active = true;
    let pendingForce: ForceSyncPayload | null = null;

    const onConnect = () => {
      joinedRef.current = false;
      correctionAckRevisionRef.current = null;
      pendingForce = null;
      setTrackingActive(null);
      setSyncDeadline(null);
    };
    const onDisconnect = () => {
      joinedRef.current = false;
      correctionAckRevisionRef.current = null;
      pendingForce = null;
      setTrackingActive(false);
      setSyncDeadline(null);
      if (!endedRef.current) {
        showSyncNotice(
          "Mất kết nối realtime. Đồng hồ tự đồng bộ đã tạm dừng.",
          "warning",
        );
      }
    };
    const onConnectError = () => {
      joinedRef.current = false;
      correctionAckRevisionRef.current = null;
      pendingForce = null;
      setTrackingActive(false);
      setSyncDeadline(null);
      if (!endedRef.current) {
        showSyncNotice(
          "Không kết nối được kênh realtime. Bạn vẫn có thể tự xem slide.",
          "warning",
        );
      }
    };
    const onSlide = (payload: { session_id: number; slide_index: number }) => {
      if (
        endedRef.current ||
        payload.session_id !== sessionId ||
        !Number.isInteger(payload.slide_index) ||
        payload.slide_index < 0
      ) {
        return;
      }
      setAiOpen(false);
      setAiMessages([]);
      setAiSummary("");
      slideStateRevisionRef.current += 1;
      correctionAckRevisionRef.current = null;
      lecturerIndexRef.current = payload.slide_index;
      setLecturerIndex(payload.slide_index);
      if (followRef.current) {
        applySlideState(payload.slide_index, true);
        reportSlide(payload.slide_index, true);
      } else {
        reportSlide(indexRef.current, false);
      }
    };
    const finishSession = () => {
      endedRef.current = true;
      joinedRef.current = false;
      correctionAckRevisionRef.current = null;
      pendingForce = null;
      setEnded(true);
      setTrackingActive(false);
      setTrackingReady(false);
      setSyncDeadline(null);
      setSyncNotice(null);
      applyQuestions([]);
    };
    const onOpen = (payload: OpenQuestion & { session_id: number }) => {
      if (!endedRef.current && payload.session_id === sessionId) {
        applyQuestions([payload]);
      }
    };
    const onOpenMany = (payload: { session_id?: number; questions: OpenQuestion[] }) => {
      if (
        !endedRef.current &&
        (payload.session_id === undefined || payload.session_id === sessionId)
      ) {
        applyQuestions(payload.questions);
      }
    };
    const onClose = (payload: { session_id: number }) => {
      if (payload.session_id === sessionId) applyQuestions([]);
    };
    const onSupportAnswered = () => {
      void api.myQuestions(sessionId, profile.token).then(setMyQuestions).catch(() => {});
    };
    const onTracking = (payload: TrackingSnapshot) => {
      if (
        endedRef.current ||
        !joinedRef.current ||
        payload.session_id !== sessionId
      ) {
        return;
      }
      const correctionRevision = correctionAckRevisionRef.current;
      correctionAckRevisionRef.current = null;
      const acceptsCorrection =
        correctionRevision !== null &&
        correctionRevision === slideStateRevisionRef.current;
      if (applyTrackingSnapshot(payload, acceptsCorrection) && acceptsCorrection) {
        slideStateRevisionRef.current += 1;
      }
    };
    const applyForce = (payload: ForceSyncPayload) => {
      if (
        endedRef.current ||
        !joinedRef.current ||
        seenSyncIds.current.has(payload.sync_id)
      ) {
        return;
      }
      seenSyncIds.current.add(payload.sync_id);
      if (seenSyncIds.current.size > 100) {
        const oldest = seenSyncIds.current.values().next().value;
        if (oldest) seenSyncIds.current.delete(oldest);
      }

      slideStateRevisionRef.current += 1;
      correctionAckRevisionRef.current = null;
      lecturerIndexRef.current = payload.slide_index;
      setLecturerIndex(payload.slide_index);
      applySlideState(payload.slide_index, true);
      setAiOpen(false);
      setAiMessages([]);
      setAiSummary("");
      setTrackingActive(true);
      setSyncDeadline(null);
      reportSlide(payload.slide_index, true);
      showSyncNotice(
        `Đã tự quay lại slide ${payload.slide_index + 1} đang được giảng viên trình chiếu.`,
        "synced",
        true,
      );
    };
    const onJoined = (payload: {
      session_id: number;
      role: string;
      tracking_enabled: boolean;
      tracking?: TrackingSnapshot;
    }) => {
      if (
        payload.session_id !== sessionId ||
        payload.role !== "student"
      ) {
        return;
      }
      if (!payload.tracking_enabled || !payload.tracking) {
        joinedRef.current = false;
        setTrackingActive(false);
        setSyncDeadline(null);
        showSyncNotice(
          "Không bật được theo dõi slide. Hãy tải lại trang.",
          "warning",
        );
        return;
      }
      joinedRef.current = true;
      setSyncNotice(null);
      if (!applyTrackingSnapshot(payload.tracking, true)) {
        joinedRef.current = false;
        setTrackingActive(false);
        showSyncNotice("Snapshot tracking không hợp lệ.", "warning");
        return;
      }

      slideStateRevisionRef.current += 1;
      const queuedForce = pendingForce;
      pendingForce = null;
      if (queuedForce) {
        applyForce(queuedForce);
      } else {
        // Snapshot joined được tạo trước khi server hoàn tất handshake. Gửi
        // một heartbeat ngay sau join để lấy lại target authoritative mới nhất.
        correctionAckRevisionRef.current = slideStateRevisionRef.current;
        reportSlide(indexRef.current, followRef.current);
      }
    };
    const onForce = (payload: ForceSyncPayload) => {
      if (
        endedRef.current ||
        payload.session_id !== sessionId ||
        !Number.isInteger(payload.slide_index) ||
        payload.slide_index < 0 ||
        typeof payload.sync_id !== "string" ||
        !payload.sync_id ||
        seenSyncIds.current.has(payload.sync_id)
      ) {
        return;
      }
      if (!joinedRef.current) {
        pendingForce = payload;
        return;
      }
      applyForce(payload);
    };
    const onEnded = (payload: { session_id: number }) => {
      if (payload.session_id !== sessionId) return;
      finishSession();
    };
    const onTrackingError = (payload: { code?: string; message?: string }) => {
      const terminal = new Set([
        "unauthorized_tracking",
        "inactive_session",
        "tracking_not_enabled",
      ]).has(payload.code ?? "");
      if (!joinedRef.current || terminal) {
        joinedRef.current = false;
        correctionAckRevisionRef.current = null;
        setTrackingActive(false);
        setSyncDeadline(null);
      }
      showSyncNotice(
        payload.message || "Không cập nhật được trạng thái slide.",
        "warning",
      );
      if (terminal) {
        void api
          .studentState(sessionId, profile.token)
          .then((fresh) => {
            if (!active || endedRef.current) return;
            if (fresh.ended) finishSession();
            else {
              applyQuestions(
                fresh.current_questions?.length
                  ? fresh.current_questions
                  : fresh.current_question
                    ? [fresh.current_question]
                    : [],
              );
            }
          })
          .catch(() => {});
      }
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on("slide_changed", onSlide);
    socket.on("question_opened", onOpen);
    socket.on("questions_opened", onOpenMany);
    socket.on("question_closed", onClose);
    socket.on("joined", onJoined);
    socket.on("slide_tracking_updated", onTracking);
    socket.on("force_slide_sync", onForce);
    socket.on("session_ended", onEnded);
    socket.on("slide_tracking_error", onTrackingError);
    socket.on("support_answered", onSupportAnswered);
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.off("slide_changed", onSlide);
      socket.off("question_opened", onOpen);
      socket.off("questions_opened", onOpenMany);
      socket.off("question_closed", onClose);
      socket.off("joined", onJoined);
      socket.off("slide_tracking_updated", onTracking);
      socket.off("force_slide_sync", onForce);
      socket.off("session_ended", onEnded);
      socket.off("slide_tracking_error", onTrackingError);
      socket.off("support_answered", onSupportAnswered);
      active = false;
      joinedRef.current = false;
      correctionAckRevisionRef.current = null;
      socketRef.current = null;
      handle.dispose();
    };
  }, [
    profile,
    sessionId,
    trackingReady,
    applyQuestion,
    applySlideState,
    applyTrackingSnapshot,
    reportSlide,
    showSyncNotice,
    applyQuestions,
  ]);

  useEffect(
    () => () => {
      if (noticeTimer.current !== null) {
        window.clearTimeout(noticeTimer.current);
      }
      if (questionAdvanceTimer.current !== null) {
        window.clearTimeout(questionAdvanceTimer.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (syncDeadline === null) return;
    setSyncClock(Date.now());
    const timer = window.setInterval(() => setSyncClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [syncDeadline]);

  /* ------------------------------------------------------------------ hành vi */

  const sendEvent = useCallback(
    (type: string, payload: Record<string, unknown> = {}) => {
      if (!profile) return;
      api
        .recordEvent(sessionId, { token: profile.token, type, slide_index: index, payload })
        .catch(() => { });
    },
    [profile, sessionId, index],
  );

  function go(delta: number) {
    const next = Math.max(0, Math.min(slides.length - 1, index + delta));
    if (next === index) return;
    if (delta < 0) sendEvent("return_slide");
    setAiOpen(false);
    setAiMessages([]);
    setAiSummary("");
    slideStateRevisionRef.current += 1;
    correctionAckRevisionRef.current = null;
    const nextFollow = follow && next === lecturerIndex;
    applySlideState(next, nextFollow);
    reportSlide(next, nextFollow);
    if (next !== lecturerIndex && follow) {
      sendEvent("unfollow");
    }
  }

  function toggleFollow() {
    const next = !follow;
    slideStateRevisionRef.current += 1;
    correctionAckRevisionRef.current = null;
    if (next) {
      applySlideState(lecturerIndex, true);
      reportSlide(lecturerIndex, true);
      setSyncDeadline(null);
      sendEvent("follow_lecturer");
    } else {
      applySlideState(index, false);
      reportSlide(index, false);
      sendEvent("unfollow");
    }
  }

  function raiseHand() {
    if (handRaised) return;
    setHandRaised(true);
    sendEvent("raise_hand");
    window.setTimeout(() => setHandRaised(false), 8000);
  }

  async function openAiPanel() {
    if (!profile || hintBusy) return;
    setAiOpen(true);
    setAiTab("ai");
    setHintBusy(true);
    try {
      const [context, res] = await Promise.all([
        api.aiSupport(sessionId, { token: profile.token, slide_index: index }),
        api.requestHint(sessionId, { token: profile.token, slide_index: index }),
      ]);
      setAiSummary(context.summary);
      setHints({ id: res.id, questions: res.questions });
    } catch {
      setHints({ id: 0, questions: [] });
    } finally {
      setHintBusy(false);
    }
  }

  function askForHints() {
    void openAiPanel();
  }

  async function sendHint(text: string) {
    await sendAiMessage(text);
  }

  async function sendAiMessage(value?: string) {
    const text = (value ?? aiInput).trim();
    if (!profile || !text || aiBusy) return;
    setAiInput("");
    setAiMessages((items) => [...items, { role: "student", text }]);
    setAiBusy(true);
    try {
      const response = await api.aiSupport(sessionId, {
        token: profile.token,
        slide_index: index,
        message: text,
      });
      setAiSummary(response.summary);
      setAiMessages((items) => [
        ...items,
        {
          role: "ai",
          text: response.answer,
          score: response.confusion_score,
          escalated: response.escalated,
        },
      ]);
      if (response.support_question) {
        setMyQuestions((items) => [response.support_question!, ...items]);
      }
      if (response.escalated) setAiTab("human");
    } catch {
      setAiMessages((items) => [
        ...items,
        { role: "ai", text: "AI đang tạm gián đoạn. Bạn có thể chuyển sang tab Nhờ hỗ trợ." },
      ]);
    } finally {
      setAiBusy(false);
    }
  }

  async function askQuestion() {
    if (!profile || !askText.trim() || askBusy) return;
    setAskBusy(true);
    try {
      const created = await api.askQuestion(sessionId, {
        token: profile.token,
        slide_index: index,
        text: askText.trim(),
      });
      setMyQuestions((items) => [created, ...items]);
      setAskText("");
    } finally {
      setAskBusy(false);
    }
  }

  function nextQuestion() {
    const [next, ...rest] = questionQueueRef.current;
    questionQueueRef.current = rest;
    applyQuestion(next ?? null);
  }

  function finishCurrentQuestion() {
    questionAdvanceTimer.current = null;
    if (questionQueueRef.current.length > 0) nextQuestion();
    else applyQuestion(null);
  }

  function scheduleQuestionClose() {
    if (questionAdvanceTimer.current !== null) {
      window.clearTimeout(questionAdvanceTimer.current);
    }
    questionAdvanceTimer.current = window.setTimeout(finishCurrentQuestion, 3500);
  }

  const multi = question?.type === "multiple_select";

  function pick(value: string) {
    if (result) return;
    setPicked((prev) =>
      multi ? (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]) : [value],
    );
  }

  function moveItem(from: number, to: number) {
    if (result || to < 0 || to >= ordering.length) return;
    setOrdering((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }

  const answerReady = question
    ? question.type === "ordering"
      ? ordering.length > 0
      : question.type === "fill_blank"
        ? typed.trim().length > 0
        : picked.length > 0
    : false;

  async function submit(confidence: number) {
    if (!profile || !question) return;
    const value =
      question.type === "ordering"
        ? ordering
        : question.type === "fill_blank"
          ? typed.trim()
          : multi
            ? picked
            : picked[0];
    const res = await api.submitAnswer(sessionId, {
      token: profile.token,
      question_id: question.id,
      value,
      response_ms: Date.now() - openedAt.current,
      confidence,
    });
    setResult({
      correct: res.correct,
      explanation: res.explanation,
      correctAnswer: res.correct_answer,
    });
    scheduleQuestionClose();
  }

  async function skip() {
    if (!profile || !question) return;
    await api.submitAnswer(sessionId, {
      token: profile.token,
      question_id: question.id,
      value: null,
      response_ms: Date.now() - openedAt.current,
      skipped: true,
      confidence: 1,
    });
    setResult({ correct: null, explanation: null, correctAnswer: null });
    scheduleQuestionClose();
  }

  function leave() {
    if (profile) api.leave(sessionId, profile.token).catch(() => { });
    setProfile(null);
    router.replace("/join");
  }

  const progress = useMemo(
    () => (slides.length ? (index + 1) / slides.length : 0),
    [index, slides.length],
  );

  if (!hydrated || !profile) {
    return (
      <main className="grid min-h-screen place-items-center">
        <Icon.waiting aria-label="Đang mở lớp" size={40} strokeWidth={2.2} className="text-muted" />
      </main>
    );
  }

  const slide = slides[index];
  const behind = follow ? 0 : lecturerIndex - index;
  const syncRemaining =
    syncDeadline === null
      ? null
      : Math.max(0, Math.ceil((syncDeadline - syncClock) / 1000));
  const slideControlsLocked = !ended && trackingActive === null;
  const Avatar = avatarIcon(profile.avatar);
  const ResultIcon =
    result?.correct === true ? Icon.correct : result?.correct === false ? Icon.wrong : Icon.skip;
  const panelOpen = Boolean(question || aiOpen);
  const useLegacyStudentLayout = false;

  return (
    <main className={`student-classroom ${panelOpen ? "student-classroom--panel" : ""}`}>
      <header className="student-classroom__header flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-blk border-2 border-line bg-sunken" title={avatarLabel(profile.avatar)}>
          <Avatar aria-label={`Ảnh đại diện ${avatarLabel(profile.avatar)}`} size={22} strokeWidth={2.4} />
        </span>
        <div className="h-3 flex-1 overflow-hidden rounded-full bg-sunken">
          <div className="h-full rounded-full bg-grass transition-[width] duration-300" style={{ width: `${progress * 100}%` }} />
        </div>
        <span className="text-sm font-extrabold tabular-nums text-muted">{index + 1}/{slides.length || "–"}</span>
        <ThemeToggle />
        <BlockButton
          square
          tone="warning"
          aria-label="Rời lớp"
          title="Rời lớp"
          icon={Icon.exit}
          onClick={() => setConfirmLeave(true)}
        />
      </header>
      {useLegacyStudentLayout ? (
        <>
          <div className="flex gap-2">
            <div className="flex flex-1 flex-col gap-4">
              {ended ? (
                <BlockCard className="flex items-center gap-3 p-4">
                  <Icon.waiting aria-hidden size={24} strokeWidth={2.5} className="shrink-0 text-muted" />
                  <p className="text-sm font-bold">Buổi học đã kết thúc. Bạn vẫn xem lại slide được.</p>
                </BlockCard>
              ) : null}
          {slide ? (
            <SlideCanvas slide={slide} total={slides.length} />
          ) : (
            <BlockCard className="flex h-56 items-center justify-center text-muted">
              <Icon.waiting aria-label="Đang tải slide" size={40} strokeWidth={2.2} />
            </BlockCard>
          )}

          <div className="flex items-center gap-2">
            <BlockButton
              square
              tone="plain"
              aria-label="Slide trước"
              icon={Icon.prev}
              onClick={() => go(-1)}
            />
            <BlockButton
              square
              tone="plain"
              aria-label="Slide sau"
              icon={Icon.next}
              onClick={() => go(1)}
            />
            <BlockButton
              tone={follow ? "sky" : "plain"}
              onClick={toggleFollow}
              icon={follow ? Icon.link : Icon.unlink}
              aria-pressed={follow}
              className="flex-1 text-sm"
            >
              {follow ? "Đang theo dõi giảng viên" : "Tự đọc"}
            </BlockButton>
            <BlockButton
              square
              tone={handRaised ? "sun" : "plain"}
              aria-label="Giơ tay"
              title="Giơ tay"
              icon={Icon.hand}
              onClick={raiseHand}
            />
            <BlockButton
              square
              tone="grape"
              aria-label="Gợi ý câu để hỏi"
              title="Gợi ý câu để hỏi"
              icon={Icon.idea}
              onClick={askForHints}
              disabled={hintBusy}
            />
          </div>

          {behind !== 0 ? (
            <button
              onClick={toggleFollow}
              className="flex items-center justify-center gap-2 rounded-blk border-2 border-b-4 border-sky-deep bg-sky/10 px-4 py-3 text-sm font-extrabold text-sky"
            >
              <Icon.unlink aria-hidden size={18} strokeWidth={2.6} />
              Giảng viên đang ở slide {lecturerIndex + 1} — bấm để quay lại
            </button>
          ) : null}

          {hints ? (
            <BlockCard className="flex animate-pop flex-col gap-3 p-5">
              <div className="flex items-center gap-2">
                <Icon.idea aria-hidden size={22} strokeWidth={2.5} className="text-grape" />
                <p className="text-sm font-extrabold uppercase tracking-wide text-muted">
                  Chọn một câu để gửi giảng viên
                </p>
                <button
                  onClick={() => setHints(null)}
                  aria-label="Đóng gợi ý"
                  className="ml-auto text-muted"
                >
                  <Icon.close aria-hidden size={20} strokeWidth={2.6} />
                </button>
              </div>
              {hints.questions.length === 0 ? (
                <p className="text-sm font-bold text-muted">
                  Chưa gợi ý được lúc này. Bạn cứ tự viết câu hỏi và giơ tay nhé.
                </p>
              ) : (
                hints.questions.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => sendHint(q)}
                    className="rounded-blk border-2 border-b-4 border-line bg-sunken px-4 py-3 text-left text-sm font-bold transition-transform active:translate-y-[3px] active:border-b-[1px]"
                  >
                    {q}
                  </button>
                ))
              )}
            </BlockCard>
          ) : null}
        </div>

        {question ? (
          <BlockCard className="flex animate-pop flex-col gap-4 p-5">
            <div className="flex items-start gap-3">
              <Icon.question
                aria-hidden
                size={28}
                strokeWidth={2.4}
                className="mt-0.5 shrink-0 text-grape"
              />
              <p className="text-lg font-extrabold">{question.prompt}</p>
            </div>

            {question.type === "fill_blank" ? (
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                disabled={!!result}
                placeholder="Nhập câu trả lời"
                className="blk-input"
              />
            ) : question.type === "ordering" ? (
              <div className="flex flex-col gap-2">
                {ordering.map((item, i) => (
                  <div
                    key={item}
                    className="flex items-center gap-2 rounded-blk border-2 border-b-4 border-line bg-sunken px-3 py-2"
                  >
                    <span className="w-6 text-center text-sm font-extrabold text-muted">{i + 1}</span>
                    <span className="flex-1 text-sm font-bold">{item}</span>
                    <button
                      onClick={() => moveItem(i, i - 1)}
                      disabled={i === 0 || !!result}
                      aria-label="Đưa lên trên"
                      className="text-muted disabled:opacity-30"
                    >
                      <Icon.prev aria-hidden size={20} strokeWidth={2.6} className="-rotate-90" />
                    </button>
                    <button
                      onClick={() => moveItem(i, i + 1)}
                      disabled={i === ordering.length - 1 || !!result}
                      aria-label="Đưa xuống dưới"
                      className="text-muted disabled:opacity-30"
                    >
                      <Icon.next aria-hidden size={20} strokeWidth={2.6} className="rotate-90" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {question.options.map((opt) => {
                  const on = picked.includes(opt);
                  return (
                    <button
                      key={opt}
                      onClick={() => pick(opt)}
                      disabled={!!result}
                      aria-pressed={on}
                      className={`rounded-blk border-2 border-b-4 px-4 py-3 text-left text-base font-bold transition-transform active:translate-y-[3px] active:border-b-[1px] disabled:opacity-60 ${on ? "border-sky-deep bg-sky/15 text-sky" : "border-line bg-sunken text-ink"
                        }`}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            )}

            {result ? (
              <div
                className={`flex items-start gap-3 rounded-blk border-2 border-b-4 px-4 py-3 ${result.correct === true
                  ? "border-grass-deep bg-grass/10"
                  : result.correct === false
                    ? "border-cherry-deep bg-cherry/10"
                    : "border-line bg-sunken"
                  }`}
              >
                <ResultIcon
                  aria-hidden
                  size={24}
                  strokeWidth={2.6}
                  className={`mt-0.5 shrink-0 ${result.correct === true
                    ? "text-grass"
                    : result.correct === false
                      ? "text-cherry"
                      : "text-muted"
                    }`}
                />
                <p className="text-sm font-bold">
                  {result.explanation ??
                    (result.correct === true
                      ? "Chính xác."
                      : result.correct === false
                        ? "Chưa đúng — nghe giảng viên chốt lại nhé."
                        : result.correct === null
                          ? "Đã ghi nhận."
                        : "Đã bỏ qua.")}
                </p>
                {result.correct === false && result.correctAnswer ? (
                  <p className="mt-1 text-sm font-extrabold text-grass">
                    Đáp án đúng: {result.correctAnswer}
                  </p>
                ) : null}
              </div>
            ) : (
              <>
                <p className="text-center text-xs font-extrabold uppercase tracking-wide text-muted">
                  Bạn chắc chắn tới đâu?
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <BlockButton
                    tone="cherry"
                    icon={Icon.unsure}
                    disabled={!answerReady}
                    onClick={() => submit(1)}
                    className="text-xs"
                  >
                    Chưa chắc
                  </BlockButton>
                  <BlockButton
                    tone="sun"
                    icon={Icon.okay}
                    disabled={!answerReady}
                    onClick={() => submit(2)}
                    className="text-xs"
                  >
                    Tạm ổn
                  </BlockButton>
                  <BlockButton
                    tone="grass"
                    icon={Icon.sure}
                    disabled={!answerReady}
                    onClick={() => submit(3)}
                    className="text-xs"
                  >
                    Chắc chắn
                  </BlockButton>
                </div>
                <button
                  onClick={skip}
                  className="mx-auto flex items-center gap-1 text-xs font-extrabold uppercase tracking-wide text-muted underline-offset-4 hover:underline"
                >
                  <Icon.skip aria-hidden size={14} strokeWidth={2.6} /> Bỏ qua câu này
                </button>
              </>
            )}
          </BlockCard>
        ) : null}
      </div>

      <BlockConfirm
        open={confirmLeave}
        icon={Icon.exit}
        tone="cherry"
        title="Rời lớp bây giờ?"
        description={
          ended
            ? "Buổi học đã kết thúc, bạn rời lớp lúc nào cũng được."
            : "Lớp vẫn đang học. Rời xong muốn vào lại thì phải gõ mã phòng lần nữa."
        }
        confirmLabel="Rời lớp"
        confirmIcon={Icon.exit}
        cancelLabel="Ở lại học tiếp"
        onConfirm={leave}
        onCancel={() => setConfirmLeave(false)}
      />
        </>
      ) : (
        <>
      <div className="student-classroom__notice flex flex-col gap-3">
        {ended ? (
          <BlockCard className="flex items-center gap-3 p-4">
            <Icon.waiting aria-hidden size={24} className="text-muted" />
            <p className="text-sm font-bold">Buổi học đã kết thúc. Bạn vẫn xem lại slide được.</p>
          </BlockCard>
        ) : null}
        {behind !== 0 ? (
          <button onClick={toggleFollow} className="flex items-center justify-center gap-2 rounded-blk border-2 border-b-4 border-sky-deep bg-sky/10 px-4 py-3 text-sm font-extrabold text-sky">
            <Icon.unlink aria-hidden size={18} /> Giảng viên đang ở slide {lecturerIndex + 1} — bấm để quay lại
          </button>
        ) : null}
        {syncNotice ? (
          <BlockCard
            className={`flex items-center gap-3 p-3 ${
              syncNotice.kind === "warning" ? "border-sun-deep bg-sun/10" : "border-grass-deep bg-grass/10"
            }`}
          >
            <Icon.link aria-hidden size={20} className="shrink-0" />
            <p className="text-sm font-bold">{syncNotice.text}</p>
          </BlockCard>
        ) : null}
        {syncRemaining !== null ? (
          <BlockCard className="flex items-center justify-between gap-3 p-3">
            <span className="text-sm font-bold">
              Bạn đang tự đọc. Màn hình sẽ quay về slide của giảng viên sau{" "}
              {formatDuration(syncRemaining)}.
            </span>
            {syncTimeoutSeconds ? (
              <span className="text-xs font-extrabold text-muted">
                ngưỡng {formatDuration(syncTimeoutSeconds)}
              </span>
            ) : null}
          </BlockCard>
        ) : null}
      </div>

      <section className="student-classroom__stage">
        {slide ? <SlideCanvas slide={slide} total={slides.length} /> : (
          <BlockCard className="flex h-56 items-center justify-center text-muted">
            <Icon.waiting aria-label="Đang tải slide" size={40} />
          </BlockCard>
        )}
      </section>

      <div className="student-classroom__controls flex items-center gap-2">
        <BlockButton square tone="plain" aria-label="Slide trước" icon={Icon.prev} onClick={() => go(-1)} disabled={slideControlsLocked} />
        <BlockButton square tone="plain" aria-label="Slide sau" icon={Icon.next} onClick={() => go(1)} disabled={slideControlsLocked} />
        <BlockButton tone={follow ? "sky" : "plain"} onClick={toggleFollow} icon={follow ? Icon.link : Icon.unlink} aria-pressed={follow} className="text-sm" disabled={slideControlsLocked}>
          {follow ? "Đang bám giảng viên" : "Tự đọc"}
        </BlockButton>
        <BlockButton square tone={handRaised ? "sun" : "plain"} aria-label="Giơ tay" icon={Icon.hand} onClick={raiseHand} />
        {!aiOpen ? (
          <BlockButton tone="grape" aria-label="Hỏi AI về slide" icon={Icon.ai} onClick={openAiPanel} disabled={hintBusy || !!question} className="ml-auto -translate-x-20">
            Hỏi AI
          </BlockButton>
        ) : null}
      </div>

      {aiOpen && !question ? (
        <aside className="student-classroom__panel ai-help-panel animate-pop">
          <div className="ai-help-panel__head">
            <div>
              <p className="ai-help-panel__eyebrow">Hỗ trợ theo Slide {index + 1}</p>
              <h2>Hỏi khi bạn cần</h2>
            </div>
            <button onClick={() => setAiOpen(false)} aria-label="Đóng hỗ trợ AI" className="ai-help-panel__close"><Icon.close aria-hidden size={22} /></button>
          </div>
          <div className="ai-help-panel__tabs">
            <button className={aiTab === "ai" ? "is-active" : ""} onClick={() => setAiTab("ai")}>Hỏi AI</button>
            <button className={aiTab === "human" ? "is-active" : ""} onClick={() => setAiTab("human")}>Nhờ hỗ trợ</button>
          </div>

          {aiTab === "ai" ? (
            <>
              <div className="ai-help-panel__scope"><Icon.shield aria-hidden size={18} /> AI trả lời dựa trên toàn bộ bộ slide và ưu tiên slide hiện tại.</div>
              {aiSummary ? <div className="ai-help-panel__summary"><span>Tóm tắt slide</span><p>{aiSummary}</p></div> : null}
              <div className="ai-help-panel__messages">
                {aiMessages.map((message, messageIndex) => (
                  <div key={messageIndex} className={`ai-message ai-message--${message.role}`}>
                    <p>{message.text}</p>
                    {message.role === "ai" && message.score !== undefined ? (
                      <small>Mức bối rối {Math.round(message.score * 100)}%{message.escalated ? " · đã chuyển hỗ trợ" : ""}</small>
                    ) : null}
                  </div>
                ))}
                {aiMessages.length === 0 && hints?.questions.map((suggestion) => (
                  <button key={suggestion} className="ai-help-panel__suggestion" onClick={() => void sendHint(suggestion)}>{suggestion}</button>
                ))}
                {aiBusy ? <div className="ai-message ai-message--ai">AI đang đọc slide…</div> : null}
              </div>
              <div className="ai-help-panel__composer">
                <input value={aiInput} onChange={(event) => setAiInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void sendAiMessage(); }} placeholder="Nhập câu hỏi về slide này…" maxLength={600} />
                <button onClick={() => void sendAiMessage()} disabled={!aiInput.trim() || aiBusy} aria-label="Gửi cho AI"><Icon.send aria-hidden size={20} /></button>
              </div>
            </>
          ) : (
            <div className="ai-help-panel__human">
              <p>Gửi trực tiếp cho giảng viên và trợ giảng khi bạn cần người thật hỗ trợ.</p>
              <textarea value={askText} onChange={(event) => setAskText(event.target.value)} placeholder="Bạn đang vướng phần nào?" maxLength={600} />
              <button onClick={() => void askQuestion()} disabled={!askText.trim() || askBusy}><Icon.send aria-hidden size={18} /> Gửi yêu cầu hỗ trợ</button>
              {myQuestions.slice(0, 3).map((item) => (
                <div key={item.id} className="ai-help-panel__ticket">
                  <p>{item.text}</p>
                  <small>{item.status === "answered" ? `Đã trả lời bởi ${item.answered_by === "assistant" ? "trợ giảng" : item.answered_by === "ai" ? "AI" : "giảng viên"}` : "Đang chờ đội ngũ giảng dạy"}</small>
                  {item.answer_text ? <strong>{item.answer_text}</strong> : null}
                  {item.answer_disclaimer ? <em>{item.answer_disclaimer}</em> : null}
                </div>
              ))}
            </div>
          )}
        </aside>
      ) : null}

      {question ? (
        <BlockCard className="student-classroom__panel student-question-panel flex animate-pop flex-col gap-4 p-5">
          <div className="flex items-start gap-3">
            <Icon.question aria-hidden size={28} className="mt-0.5 shrink-0 text-grape" />
            <div><p className="text-xs font-extrabold uppercase tracking-wide text-muted">Câu hỏi nhanh · Slide {index + 1}</p><p className="mt-1 text-lg font-extrabold">{question.prompt}</p></div>
          </div>
          {question.type === "fill_blank" ? (
            <input value={typed} onChange={(event) => setTyped(event.target.value)} disabled={!!result} placeholder="Nhập câu trả lời" className="blk-input" />
          ) : question.type === "ordering" ? (
            <div className="flex flex-col gap-2">
              {ordering.map((item, itemIndex) => (
                <div key={item} className="flex items-center gap-2 rounded-blk border-2 border-line bg-sunken px-3 py-2">
                  <span className="w-6 text-center text-sm font-extrabold text-muted">{itemIndex + 1}</span>
                  <span className="flex-1 text-sm font-bold">{item}</span>
                  <button onClick={() => moveItem(itemIndex, itemIndex - 1)} disabled={itemIndex === 0 || !!result}><Icon.prev aria-hidden size={18} className="-rotate-90" /></button>
                  <button onClick={() => moveItem(itemIndex, itemIndex + 1)} disabled={itemIndex === ordering.length - 1 || !!result}><Icon.next aria-hidden size={18} className="rotate-90" /></button>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {question.options.map((option) => {
                const selected = picked.includes(option);
                return <button key={option} onClick={() => pick(option)} disabled={!!result} className={`rounded-blk border-2 border-b-4 px-4 py-3 text-left text-sm font-bold ${selected ? "border-sky-deep bg-sky/15 text-sky" : "border-line bg-sunken text-ink"}`}>{option}</button>;
              })}
            </div>
          )}
          {result ? (
            <div className={`flex items-start gap-3 rounded-blk border-2 px-4 py-3 ${result.correct === true ? "border-grass-deep bg-grass/10" : result.correct === false ? "border-cherry-deep bg-cherry/10" : "border-line bg-sunken"}`}>
              <ResultIcon aria-hidden size={22} className={result.correct === true ? "text-grass" : result.correct === false ? "text-cherry" : "text-muted"} />
              <div>
                <p className="text-sm font-bold">{result.explanation ?? (result.correct === true ? "Chính xác." : result.correct === false ? "Chưa đúng — nghe giảng viên chốt lại nhé." : "Đã ghi nhận.")}</p>
                {result.correct === false && result.correctAnswer ? (
                  <p className="mt-1 text-sm font-extrabold text-grass">Đáp án đúng: {result.correctAnswer}</p>
                ) : null}
                <small className="text-muted">Câu hỏi sẽ tự đóng…</small>
              </div>
            </div>
          ) : (
            <>
              <p className="text-center text-xs font-extrabold uppercase tracking-wide text-muted">Bạn chắc chắn tới đâu?</p>
              <div className="grid grid-cols-3 gap-2">
                <BlockButton tone="cherry" disabled={!answerReady} onClick={() => submit(1)} className="text-xs">Chưa chắc</BlockButton>
                <BlockButton tone="sun" disabled={!answerReady} onClick={() => submit(2)} className="text-xs">Tạm ổn</BlockButton>
                <BlockButton tone="grass" disabled={!answerReady} onClick={() => submit(3)} className="text-xs">Chắc chắn</BlockButton>
              </div>
              <button onClick={skip} className="mx-auto flex items-center gap-1 text-xs font-extrabold uppercase tracking-wide text-muted"><Icon.skip aria-hidden size={14} /> Bỏ qua</button>
            </>
          )}
        </BlockCard>
      ) : null}
        </>
      )}
      <BlockConfirm
        open={confirmLeave}
        icon={Icon.exit}
        tone="cherry"
        title="Rời lớp bây giờ?"
        description={
          ended
            ? "Buổi học đã kết thúc, bạn rời lớp lúc nào cũng được."
            : "Lớp vẫn đang học. Rời xong muốn vào lại thì phải gõ mã phòng lần nữa."
        }
        confirmLabel="Rời lớp"
        confirmIcon={Icon.exit}
        cancelLabel="Ở lại học tiếp"
        onConfirm={leave}
        onCancel={() => setConfirmLeave(false)}
      />
    </main>
  );
}

function shuffle(items: string[]): string[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
