"use client";

/** Màn hình của học viên trong buổi học. */
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BlockButton, BlockCard } from "@/components/Blocks";
import SlideCanvas from "@/components/SlideCanvas";
import ThemeToggle from "@/components/ThemeToggle";
import { Icon, avatarIcon, avatarLabel } from "@/components/icons";
import { api, type SlideOut, type StudentState } from "@/lib/api";
import { joinRoom } from "@/lib/socket";
import { useLearner, useLearnerHydrated } from "@/lib/store";

type OpenQuestion = NonNullable<StudentState["current_question"]>;

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
  const [result, setResult] = useState<{ correct: boolean | null; explanation: string | null } | null>(
    null,
  );
  const [handRaised, setHandRaised] = useState(false);
  const [hints, setHints] = useState<{ id: number; questions: string[] } | null>(null);
  const [hintBusy, setHintBusy] = useState(false);
  const openedAt = useRef<number>(Date.now());

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

  useEffect(() => {
    if (!profile || profile.session_id !== sessionId) return;
    let alive = true;
    (async () => {
      const [list, state] = await Promise.all([
        api.studentSlides(sessionId).catch(() => [] as SlideOut[]),
        api.studentState(sessionId).catch(() => null),
      ]);
      if (!alive) return;
      setSlides(list);
      if (state) {
        setLecturerIndex(state.current_slide_index);
        setIndex(state.current_slide_index);
        setEnded(state.ended);
        applyQuestion(state.current_question);
      }
    })();
    return () => {
      alive = false;
    };
  }, [profile, sessionId, applyQuestion]);

  useEffect(() => {
    if (!profile || profile.session_id !== sessionId) return;
    const socket = joinRoom(sessionId, "student");
    const onSlide = (p: { slide_index: number }) => {
      setLecturerIndex(p.slide_index);
      setFollow((f) => {
        if (f) setIndex(p.slide_index);
        return f;
      });
    };
    const onOpen = (q: OpenQuestion) => applyQuestion(q);
    const onClose = () => applyQuestion(null);
    socket.on("slide_changed", onSlide);
    socket.on("question_opened", onOpen);
    socket.on("question_closed", onClose);
    return () => {
      socket.off("slide_changed", onSlide);
      socket.off("question_opened", onOpen);
      socket.off("question_closed", onClose);
    };
  }, [profile, sessionId, applyQuestion]);

  /* ------------------------------------------------------------------ hành vi */

  const sendEvent = useCallback(
    (type: string, payload: Record<string, unknown> = {}) => {
      if (!profile) return;
      api
        .recordEvent(sessionId, { token: profile.token, type, slide_index: index, payload })
        .catch(() => {});
    },
    [profile, sessionId, index],
  );

  function go(delta: number) {
    const next = Math.max(0, Math.min(slides.length - 1, index + delta));
    if (next === index) return;
    if (delta < 0) sendEvent("return_slide");
    setIndex(next);
    if (next !== lecturerIndex && follow) {
      setFollow(false);
      sendEvent("unfollow");
    }
  }

  function toggleFollow() {
    const next = !follow;
    setFollow(next);
    if (next) {
      setIndex(lecturerIndex);
      sendEvent("follow_lecturer");
    } else {
      sendEvent("unfollow");
    }
  }

  function raiseHand() {
    if (handRaised) return;
    setHandRaised(true);
    sendEvent("raise_hand");
    window.setTimeout(() => setHandRaised(false), 8000);
  }

  async function askForHints() {
    if (!profile || hintBusy) return;
    setHintBusy(true);
    try {
      const res = await api.requestHint(sessionId, { token: profile.token, slide_index: index });
      setHints({ id: res.id, questions: res.questions });
    } catch {
      setHints({ id: 0, questions: [] });
    } finally {
      setHintBusy(false);
    }
  }

  async function sendHint(text: string) {
    if (!profile || !hints?.id) return;
    await api.sendHint(sessionId, hints.id, { token: profile.token, question: text }).catch(() => {});
    setHints(null);
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
    setResult({ correct: res.correct, explanation: res.explanation });
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
    setResult({ correct: null, explanation: null });
  }

  function leave() {
    if (profile) api.leave(sessionId, profile.token).catch(() => {});
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
  const Avatar = avatarIcon(profile.avatar);
  const ResultIcon =
    result?.correct === true ? Icon.correct : result?.correct === false ? Icon.wrong : Icon.skip;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-4 px-4 py-5">
      <header className="flex items-center gap-3">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-blk border-2 border-line bg-sunken"
          title={avatarLabel(profile.avatar)}
        >
          <Avatar
            aria-label={`Ảnh đại diện ${avatarLabel(profile.avatar)}`}
            size={22}
            strokeWidth={2.4}
          />
        </span>
        <div className="h-4 flex-1 overflow-hidden rounded-full bg-sunken">
          <div
            className="h-full rounded-full bg-grass transition-[width] duration-300"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <span className="text-sm font-extrabold tabular-nums text-muted">
          {index + 1}/{slides.length || "–"}
        </span>
        <ThemeToggle />
        <BlockButton
          square
          tone="plain"
          aria-label="Rời lớp"
          title="Rời lớp"
          icon={Icon.exit}
          onClick={leave}
        />
      </header>

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
          {follow ? "Đang bám giảng viên" : "Tự đọc"}
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
                    className={`rounded-blk border-2 border-b-4 px-4 py-3 text-left text-base font-bold transition-transform active:translate-y-[3px] active:border-b-[1px] disabled:opacity-60 ${
                      on ? "border-sky-deep bg-sky/15 text-sky" : "border-line bg-sunken text-ink"
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
              className={`flex items-start gap-3 rounded-blk border-2 border-b-4 px-4 py-3 ${
                result.correct === true
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
                className={`mt-0.5 shrink-0 ${
                  result.correct === true
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
    </main>
  );
}

/** Xáo trộn các mục của câu sắp thứ tự để học viên không thấy sẵn đáp án. */
function shuffle(items: string[]): string[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
