"use client";

/** Chi tiết khoá học — Bento: slide, checkpoint, câu hỏi và chất lượng sau các buổi dạy. */
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  FileTextOutlined,
  FlagOutlined,
  InboxOutlined,
  PlusOutlined,
  QuestionCircleOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
  WarningFilled,
} from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Empty,
  Form,
  Modal,
  Space,
  Spin,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from "antd";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import SlideCanvas from "@/components/SlideCanvas";
import QuestionForm, {
  QUESTION_TYPES,
  toQuestionIn,
  type QuestionFormValues,
} from "@/components/QuestionForm";
import {
  BentoBar,
  BentoCard,
  BentoGrid,
  BentoStat,
} from "@/components/ai/Bento";
import {
  api,
  type CheckpointOut,
  type CourseOut,
  type CourseQuality,
  type QuestionIn,
  type SlideOut,
  type SlideQuality,
} from "@/lib/api";

const pct = (v: number) => `${Math.round(v * 100)}%`;
const typeLabel = (t: string) =>
  QUESTION_TYPES.find((x) => x.value === t)?.label ?? t;

export default function CourseDetailPage() {
  const params = useParams<{ id: string }>();
  const courseId = Number(params.id);
  const { message, modal } = App.useApp();

  const [course, setCourse] = useState<CourseOut | null>(null);
  const [slides, setSlides] = useState<SlideOut[]>([]);
  const [checkpoints, setCheckpoints] = useState<CheckpointOut[]>([]);
  const [quality, setQuality] = useState<CourseQuality | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [active, setActive] = useState(0);
  const [uploading, setUploading] = useState(false);

  const [qOpen, setQOpen] = useState(false);
  const [qSaving, setQSaving] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [qForm] = Form.useForm<QuestionFormValues>();

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [c, s, cp, q] = await Promise.all([
        api.course(courseId),
        api.slides(courseId),
        api.checkpoints(courseId),
        api.courseQuality(courseId),
      ]);
      setCourse(c);
      setSlides(s);
      setCheckpoints(cp);
      setQuality(q);
      setActive((i) => Math.min(i, Math.max(0, s.length - 1)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được khoá học.");
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    if (Number.isFinite(courseId)) void load();
  }, [courseId, load]);

  const slide = slides[active] ?? null;
  const checkpoint = useMemo(
    () =>
      slide ? (checkpoints.find((c) => c.slide_id === slide.id) ?? null) : null,
    [checkpoints, slide],
  );

  const uploadHandler =
    (
      uploadFn: (
        courseId: number,
        file: File,
        replace?: boolean,
      ) => Promise<SlideOut[]>,
    ) =>
    async (opt: any) => {
      const file = opt.file as File;
      setUploading(true);
      try {
        const created = await uploadFn(courseId, file, true);
        message.success(`Đã nhập ${created.length} slide từ ${file.name}.`);
        opt.onSuccess?.({}, new XMLHttpRequest());
        setActive(0);
        await load();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Không tải được file.";
        message.error(msg);
        opt.onError?.(new Error(msg));
      } finally {
        setUploading(false);
      }
    };

  async function addCheckpoint() {
    if (!slide) return;
    try {
      await api.createCheckpoint(slide.id, {
        label: `Checkpoint slide ${slide.index + 1}`,
        goal: "",
      });
      message.success("Đã tạo checkpoint.");
      await load();
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Không tạo được checkpoint.",
      );
    }
  }

  async function toggleCheckpoint(cp: CheckpointOut, activeState: boolean) {
    try {
      await api.updateCheckpoint(cp.id, { active: activeState });
      await load();
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Không đổi được trạng thái.",
      );
    }
  }

  function removeCheckpoint(cp: CheckpointOut) {
    modal.confirm({
      title: "Xoá checkpoint này?",
      content: `Toàn bộ ${cp.questions.length} câu hỏi trong checkpoint sẽ mất.`,
      okText: "Xoá",
      okButtonProps: { danger: true },
      cancelText: "Huỷ",
      onOk: async () => {
        await api.deleteCheckpoint(cp.id);
        message.success("Đã xoá checkpoint.");
        await load();
      },
    });
  }

  async function saveQuestion() {
    if (!checkpoint) return;
    const values = await qForm.validateFields();
    setQSaving(true);
    try {
      await api.addQuestions(checkpoint.id, [toQuestionIn(values)]);
      message.success("Đã thêm câu hỏi.");
      setQOpen(false);
      qForm.resetFields();
      await load();
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Không lưu được câu hỏi.",
      );
    } finally {
      setQSaving(false);
    }
  }

  async function draft() {
    if (!checkpoint) return;
    setDrafting(true);
    try {
      const res = await api.draftQuestions(checkpoint.id, 2);
      if (res.source === "unavailable" || res.questions.length === 0) {
        modal.info({
          title: "Chưa soạn nháp được",
          content:
            res.note ||
            "Chưa cấu hình khoá Groq trên máy chủ. Đặt GROQ_API_KEY trong .env của backend rồi thử lại.",
        });
        return;
      }
      modal.confirm({
        title: `Mô hình đề xuất ${res.questions.length} câu hỏi`,
        width: 640,
        content: (
          <ul className="m-0 list-none space-y-2 p-0">
            {res.questions.map((q: QuestionIn, i: number) => (
              <li
                key={i}
                className="rounded-xl px-3 py-2"
                style={{ background: "var(--ai-bg)" }}
              >
                <Typography.Text strong>{q.prompt}</Typography.Text>
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {typeLabel(q.type)}
                    {q.options?.length ? ` · ${q.options.join(" / ")}` : ""}
                  </Typography.Text>
                </div>
              </li>
            ))}
          </ul>
        ),
        okText: "Lưu vào checkpoint",
        cancelText: "Bỏ qua",
        onOk: async () => {
          await api.addQuestions(
            checkpoint.id,
            res.questions.map((q) => ({ ...q, origin: "llm" as const })),
          );
          message.success("Đã lưu câu hỏi nháp.");
          await load();
        },
      });
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Không gọi được mô hình.",
      );
    } finally {
      setDrafting(false);
    }
  }

  async function removeQuestion(id: number) {
    await api.deleteQuestion(id);
    message.success("Đã xoá câu hỏi.");
    await load();
  }

  if (loading && !course) {
    return (
      <div className="grid place-items-center py-24">
        <Spin size="large" />
      </div>
    );
  }

  if (error && !course) {
    return <Alert type="error" showIcon title={error} />;
  }

  const questionTotal = checkpoints.reduce((n, c) => n + c.questions.length, 0);
  const emptyCheckpoints = checkpoints.filter((c) => c.questions.length === 0);

  return (
    <div className="space-y-4">
      {/* ── đầu trang ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/courses">
            <Button
              icon={<ArrowLeftOutlined />}
              aria-label="Quay lại danh sách khoá học"
            />
          </Link>
          <div className="min-w-0">
            <Typography.Text
              style={{
                color: "var(--ai-muted)",
                fontWeight: 700,
                fontSize: 12,
              }}
            >
              {course?.subject?.toUpperCase() || "CHƯA ĐẶT MÔN"}
            </Typography.Text>
            <Typography.Title
              level={3}
              style={{ margin: 0, color: "var(--ai-ink)" }}
            >
              {course?.title}
            </Typography.Title>
          </div>
        </div>
        <div className="flex gap-2">
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading} />
          <Space size={8}>
            <Upload
              accept=".pptx"
              showUploadList={false}
              customRequest={uploadHandler(api.uploadPptx)}
              disabled={uploading}
            >
              <Button
                type="primary"
                danger
                icon={<InboxOutlined />}
                loading={uploading}
              >
                Tải file .pptx lên
              </Button>
            </Upload>
            <Upload
              accept=".pdf"
              showUploadList={false}
              customRequest={uploadHandler(api.uploadPdf)}
              disabled={uploading}
            >
              <Button
                type="primary"
                danger
                icon={<InboxOutlined />}
                loading={uploading}
              >
                Tải file .pdf lên
              </Button>
            </Upload>
          </Space>
        </div>
      </div>

      {error ? <Alert type="error" showIcon title={error} closable /> : null}

      <Tabs
        defaultActiveKey="slides"
        items={[
          {
            key: "slides",
            label: `Slide & checkpoint (${slides.length})`,
            children:
              slides.length === 0 ? (
                <BentoGrid>
                  <BentoCard span={6} tone="navy">
                    <div className="flex flex-wrap items-center justify-between gap-4 py-2">
                      <div>
                        <div className="text-xl font-extrabold">
                          Khoá học chưa có slide
                        </div>
                        <div
                          className="text-sm font-semibold"
                          style={{ opacity: 0.78 }}
                        >
                          Tải file .pptx lên, hệ thống đọc thành từng trang vẽ
                          trên canvas.
                        </div>
                      </div>
                      <Space size={8}>
                        <Upload
                          accept=".pptx"
                          showUploadList={false}
                          customRequest={uploadHandler(api.uploadPptx)}
                        >
                          <Button
                            type="primary"
                            danger
                            size="large"
                            icon={<InboxOutlined />}
                            loading={uploading}
                          >
                            Tải file .pptx lên
                          </Button>
                        </Upload>
                        <Upload
                          accept=".pdf"
                          showUploadList={false}
                          customRequest={uploadHandler(api.uploadPdf)}
                        >
                          <Button
                            type="primary"
                            danger
                            size="large"
                            icon={<InboxOutlined />}
                            loading={uploading}
                          >
                            Tải file .pdf lên
                          </Button>
                        </Upload>
                      </Space>
                    </div>
                  </BentoCard>
                </BentoGrid>
              ) : (
                <BentoGrid>
                  {/* số liệu nội dung */}
                  <BentoStat
                    label="Slide"
                    value={slides.length}
                    icon={<FileTextOutlined />}
                  />
                  <BentoStat
                    label="Checkpoint"
                    value={checkpoints.length}
                    hint={`${checkpoints.filter((c) => c.active).length} đang bật`}
                    icon={<FlagOutlined />}
                  />
                  <BentoStat
                    label="Câu hỏi"
                    value={questionTotal}
                    hint={`${checkpoints.reduce((n, c) => n + c.questions.filter((q) => q.origin === "llm").length, 0)} nháp AI`}
                    icon={<QuestionCircleOutlined />}
                  />

                  {emptyCheckpoints.length > 0 ? (
                    <BentoCard span={6} tone="red" title="Checkpoint rỗng">
                      <div className="flex items-start gap-2 text-sm font-semibold">
                        <WarningFilled
                          style={{ color: "var(--ai-red)", marginTop: 3 }}
                        />
                        <span>
                          Slide{" "}
                          {emptyCheckpoints
                            .map((c) => c.slide_index + 1)
                            .join(", ")}{" "}
                          có checkpoint nhưng chưa có câu hỏi — khi dạy sẽ không
                          mở được gì.
                        </span>
                      </div>
                    </BentoCard>
                  ) : null}

                  {/* danh sách slide */}
                  <BentoCard span={2} title="Slide" className="!p-0">
                    <div className="max-h-[520px] overflow-y-auto p-2">
                      {slides.map((s, i) => {
                        const cp = checkpoints.find((c) => c.slide_id === s.id);
                        const on = i === active;
                        return (
                          <button
                            key={s.id}
                            onClick={() => setActive(i)}
                            className="mb-1 flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors"
                            style={{
                              background: on ? "var(--ai-navy)" : "transparent",
                              color: on ? "#fff" : "var(--ai-ink)",
                            }}
                          >
                            <span
                              className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-xs font-extrabold tabular-nums"
                              style={{
                                background: on
                                  ? "rgba(255,255,255,.18)"
                                  : "var(--ai-bg)",
                                color: on ? "#fff" : "var(--ai-muted)",
                              }}
                            >
                              {i + 1}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-xs font-bold">
                              {s.title || `Slide ${i + 1}`}
                            </span>
                            {cp ? (
                              <span
                                className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-extrabold"
                                style={{
                                  background: cp.active
                                    ? "var(--ai-red)"
                                    : "var(--ai-line)",
                                  color: cp.active ? "#fff" : "var(--ai-muted)",
                                }}
                                title={
                                  cp.active
                                    ? `${cp.questions.length} câu hỏi`
                                    : "checkpoint đang tắt"
                                }
                              >
                                {cp.questions.length}
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </BentoCard>

                  {/* xem trước slide */}
                  <BentoCard
                    span={4}
                    title={
                      slide
                        ? `Xem trước · slide ${slide.index + 1}`
                        : "Xem trước"
                    }
                  >
                    {slide ? (
                      <SlideCanvas slide={slide} total={slides.length} />
                    ) : null}
                    {slide?.notes ? (
                      <p
                        className="m-0 text-xs font-semibold"
                        style={{ color: "var(--ai-muted)" }}
                      >
                        <strong>Ghi chú của bạn:</strong> {slide.notes}
                      </p>
                    ) : null}
                  </BentoCard>

                  {/* checkpoint của slide đang chọn */}
                  <BentoCard
                    span={6}
                    tone={checkpoint?.active ? "red" : "plain"}
                    title={
                      slide
                        ? `Checkpoint tại slide ${slide.index + 1}`
                        : "Checkpoint"
                    }
                    extra={
                      checkpoint ? (
                        <div className="flex items-center gap-2">
                          <Tooltip title="Tắt thì câu hỏi không mở được khi đang dạy">
                            <Switch
                              size="small"
                              checked={checkpoint.active}
                              onChange={(v) => toggleCheckpoint(checkpoint, v)}
                            />
                          </Tooltip>
                          <Button
                            type="text"
                            danger
                            size="small"
                            icon={<DeleteOutlined />}
                            onClick={() => removeCheckpoint(checkpoint)}
                            aria-label="Xoá checkpoint"
                          />
                        </div>
                      ) : null
                    }
                  >
                    {!checkpoint ? (
                      <div className="flex flex-wrap items-center justify-between gap-3 py-2">
                        <span
                          className="text-sm font-semibold"
                          style={{ color: "var(--ai-muted)" }}
                        >
                          Slide này chưa có checkpoint. Đặt một cái nếu đây là
                          chỗ dễ hiểu sai.
                        </span>
                        <Button
                          type="primary"
                          icon={<FlagOutlined />}
                          onClick={addCheckpoint}
                        >
                          Đặt checkpoint tại đây
                        </Button>
                      </div>
                    ) : (
                      <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
                        <div className="min-w-0">
                          {checkpoint.questions.length === 0 ? (
                            <Alert
                              type="warning"
                              showIcon
                              title="Checkpoint chưa có câu hỏi nào."
                            />
                          ) : (
                            <ul className="m-0 list-none space-y-2 p-0">
                              {checkpoint.questions.map((q, i) => (
                                <li
                                  key={q.id}
                                  className="flex items-start gap-3 rounded-xl px-3 py-2.5"
                                  style={{ background: "var(--ai-bg)" }}
                                >
                                  <span
                                    className="grid h-6 w-6 shrink-0 place-items-center rounded-lg text-[11px] font-extrabold"
                                    style={{
                                      background: "var(--ai-navy)",
                                      color: "#fff",
                                    }}
                                  >
                                    {i + 1}
                                  </span>
                                  <div className="min-w-0 flex-1">
                                    <div className="text-sm font-bold">
                                      {q.prompt}
                                    </div>
                                    <div className="mt-1 flex flex-wrap gap-1">
                                      <Tag style={{ marginInlineEnd: 0 }}>
                                        {typeLabel(q.type)}
                                      </Tag>
                                      {q.origin === "llm" ? (
                                        <Tag
                                          color="purple"
                                          style={{ marginInlineEnd: 0 }}
                                        >
                                          nháp AI
                                        </Tag>
                                      ) : null}
                                    </div>
                                  </div>
                                  <Button
                                    type="text"
                                    danger
                                    size="small"
                                    icon={<DeleteOutlined />}
                                    onClick={() => removeQuestion(q.id)}
                                    aria-label="Xoá câu hỏi"
                                  />
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>

                        <div className="space-y-3">
                          <div>
                            <div className="bento-label mb-1">
                              Mục tiêu kiểm tra
                            </div>
                            <Typography.Paragraph
                              editable={{
                                onChange: async (v) => {
                                  await api.updateCheckpoint(checkpoint.id, {
                                    goal: v,
                                  });
                                  await load();
                                },
                              }}
                              type={checkpoint.goal ? undefined : "secondary"}
                              style={{ marginBottom: 0, fontSize: 13 }}
                            >
                              {checkpoint.goal || "Bấm để ghi mục tiêu"}
                            </Typography.Paragraph>
                          </div>
                          <Button
                            block
                            type="primary"
                            icon={<PlusOutlined />}
                            onClick={() => setQOpen(true)}
                          >
                            Thêm câu hỏi
                          </Button>
                          <Button
                            block
                            icon={<ThunderboltOutlined />}
                            loading={drafting}
                            onClick={draft}
                          >
                            Soạn nháp bằng AI
                          </Button>
                        </div>
                      </div>
                    )}
                  </BentoCard>
                </BentoGrid>
              ),
          },
          {
            key: "quality",
            label: "Chất lượng",
            children: <QualityTab quality={quality} />,
          },
        ]}
      />

      <Modal
        title="Câu hỏi mới"
        open={qOpen}
        onCancel={() => setQOpen(false)}
        onOk={saveQuestion}
        confirmLoading={qSaving}
        okText="Lưu"
        cancelText="Huỷ"
        width={640}
        destroyOnHidden
      >
        <Form
          form={qForm}
          layout="vertical"
          requiredMark={false}
          preserve={false}
        >
          <QuestionForm form={qForm} />
        </Form>
      </Modal>
    </div>
  );
}

function QualityTab({ quality }: { quality: CourseQuality | null }) {
  if (!quality) return <Spin />;

  if (quality.sessions === 0) {
    return (
      <BentoGrid>
        <BentoCard span={6}>
          <Empty description="Khoá học chưa được dạy buổi nào — chưa có số liệu chất lượng." />
        </BentoCard>
      </BentoGrid>
    );
  }

  const answered = quality.slides.reduce((n, s) => n + s.answers, 0);
  const graded = quality.slides.filter((s) => s.answers > 0);
  const overall = graded.length
    ? graded.reduce((sum, s) => sum + s.correct_rate * s.answers, 0) /
      (answered || 1)
    : 0;

  return (
    <BentoGrid>
      <BentoStat label="Buổi đã dạy" value={quality.sessions} />
      <BentoStat label="Lượt trả lời" value={answered} />
      <BentoStat
        label="Slide cần xem lại"
        value={quality.needs_attention.length}
        tone={quality.needs_attention.length ? "red" : "plain"}
      />

      <BentoCard span={3} title="Tỉ lệ đúng chung">
        {answered ? (
          <>
            <div className="bento-value">{pct(overall)}</div>
            <BentoBar value={overall} />
          </>
        ) : (
          <Typography.Text style={{ color: "var(--ai-muted)", fontSize: 13 }}>
            Chưa có lượt trả lời nào.
          </Typography.Text>
        )}
      </BentoCard>

      <BentoCard
        span={3}
        tone={quality.needs_attention.length ? "red" : "plain"}
        title="Gây khó nhất"
      >
        {quality.needs_attention.length === 0 ? (
          <Typography.Text style={{ color: "var(--ai-muted)", fontSize: 13 }}>
            Không có slide nào đáng lo.
          </Typography.Text>
        ) : (
          <ul className="m-0 list-none space-y-1.5 p-0">
            {quality.needs_attention.slice(0, 4).map((s) => (
              <li
                key={s.slide_index}
                className="flex items-center gap-2 text-xs font-bold"
              >
                <span
                  className="grid h-5 w-5 shrink-0 place-items-center rounded-md text-[10px] font-extrabold"
                  style={{ background: "var(--ai-red)", color: "#fff" }}
                >
                  {s.slide_index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {s.title || "(không tiêu đề)"}
                </span>
                {s.answers ? (
                  <span style={{ color: "var(--ai-red)" }}>
                    {pct(s.correct_rate)}
                  </span>
                ) : (
                  <span style={{ color: "var(--ai-muted)" }}>
                    {s.return_visits} lần quay lại
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </BentoCard>

      <BentoCard span={6} title="Chi tiết từng slide" className="!p-0">
        <div className="p-2">
          <Table<SlideQuality>
            rowKey="slide_index"
            dataSource={quality.slides}
            pagination={false}
            size="small"
            scroll={{ x: 860 }}
            columns={[
              {
                title: "#",
                dataIndex: "slide_index",
                width: 56,
                render: (v: number) => v + 1,
              },
              { title: "Tiêu đề", dataIndex: "title", ellipsis: true },
              {
                title: "Checkpoint",
                dataIndex: "has_checkpoint",
                width: 110,
                render: (v: boolean, r) =>
                  v ? (
                    <Tag color="red">{r.question_count} câu</Tag>
                  ) : (
                    <Typography.Text type="secondary">—</Typography.Text>
                  ),
              },
              {
                title: "Trả lời",
                dataIndex: "answers",
                width: 80,
                align: "right",
              },
              {
                title: "Đúng",
                dataIndex: "correct_rate",
                width: 130,
                render: (v: number, r) =>
                  r.answers ? (
                    <BentoBar value={v} />
                  ) : (
                    <Typography.Text type="secondary">chưa có</Typography.Text>
                  ),
              },
              {
                title: "Bỏ qua",
                dataIndex: "skip_rate",
                width: 84,
                align: "right",
                render: (v: number, r) => (r.answers ? pct(v) : "—"),
              },
              {
                title: "Quay lại",
                dataIndex: "return_visits",
                width: 92,
                align: "right",
              },
              {
                title: "Hỏi / gợi ý",
                key: "asks",
                width: 104,
                align: "right",
                render: (_, r) => `${r.questions_asked} / ${r.hints_requested}`,
              },
            ]}
          />
        </div>
      </BentoCard>
    </BentoGrid>
  );
}
