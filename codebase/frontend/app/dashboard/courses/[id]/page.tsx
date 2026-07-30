"use client";

/** Chi tiết khoá học: slide, checkpoint, câu hỏi và chất lượng sau các buổi dạy. */
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  FlagOutlined,
  InboxOutlined,
  PlusOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App,
  Badge,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Progress,
  Row,
  Space,
  Spin,
  Statistic,
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
  api,
  type CheckpointOut,
  type CourseOut,
  type CourseQuality,
  type QuestionIn,
  type SlideOut,
  type SlideQuality,
} from "@/lib/api";

const pct = (v: number) => `${Math.round(v * 100)}%`;
const typeLabel = (t: string) => QUESTION_TYPES.find((x) => x.value === t)?.label ?? t;

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
    () => (slide ? (checkpoints.find((c) => c.slide_id === slide.id) ?? null) : null),
    [checkpoints, slide],
  );

  async function upload(opt: any) {
    const file = opt.file as File;
    setUploading(true);
    try {
      const created = await api.uploadPptx(courseId, file, true);
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
  }

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
      message.error(err instanceof Error ? err.message : "Không tạo được checkpoint.");
    }
  }

  async function toggleCheckpoint(cp: CheckpointOut, activeState: boolean) {
    try {
      await api.updateCheckpoint(cp.id, { active: activeState });
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Không đổi được trạng thái.");
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
      message.error(err instanceof Error ? err.message : "Không lưu được câu hỏi.");
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
          <List
            size="small"
            dataSource={res.questions}
            renderItem={(q: QuestionIn) => (
              <List.Item>
                <Space orientation="vertical" size={2}>
                  <Typography.Text strong>{q.prompt}</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {typeLabel(q.type)}
                    {q.options?.length ? ` · ${q.options.join(" / ")}` : ""}
                  </Typography.Text>
                </Space>
              </List.Item>
            )}
          />
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
      message.error(err instanceof Error ? err.message : "Không gọi được mô hình.");
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

  return (
    <Space orientation="vertical" size="large" style={{ width: "100%" }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Space align="center">
          <Link href="/dashboard/courses">
            <Button icon={<ArrowLeftOutlined />} aria-label="Quay lại danh sách khoá học" />
          </Link>
          <div>
            <Typography.Title level={3} style={{ margin: 0 }}>
              {course?.title}
            </Typography.Title>
            <Typography.Text type="secondary">
              {course?.subject || "Chưa đặt môn"} · {slides.length} slide · {checkpoints.length}{" "}
              checkpoint
            </Typography.Text>
          </div>
        </Space>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading} />
          <Upload
            accept=".pptx"
            showUploadList={false}
            customRequest={upload}
            disabled={uploading}
          >
            <Button type="primary" icon={<InboxOutlined />} loading={uploading}>
              Tải PPTX lên
            </Button>
          </Upload>
        </Space>
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
                <Card>
                  <Empty description="Khoá học chưa có slide nào">
                    <Upload accept=".pptx" showUploadList={false} customRequest={upload}>
                      <Button type="primary" icon={<InboxOutlined />} loading={uploading}>
                        Tải file .pptx lên
                      </Button>
                    </Upload>
                  </Empty>
                </Card>
              ) : (
                <Row gutter={[16, 16]}>
                  {/* danh sách slide */}
                  <Col xs={24} lg={6}>
                    <Card
                      title="Slide"
                      styles={{ body: { padding: 0, maxHeight: 620, overflowY: "auto" } }}
                    >
                      <List
                        dataSource={slides}
                        renderItem={(s, i) => {
                          const cp = checkpoints.find((c) => c.slide_id === s.id);
                          return (
                            <List.Item
                              onClick={() => setActive(i)}
                              style={{
                                cursor: "pointer",
                                paddingInline: 16,
                                background:
                                  i === active ? "var(--c-sunken)" : undefined,
                              }}
                            >
                              <List.Item.Meta
                                avatar={
                                  <Badge
                                    count={cp ? cp.questions.length : 0}
                                    size="small"
                                    color={cp?.active ? "#FF4B4B" : "#bbb"}
                                  >
                                    <span className="grid h-8 w-8 place-items-center rounded-md border border-line text-xs font-bold">
                                      {i + 1}
                                    </span>
                                  </Badge>
                                }
                                title={
                                  <Typography.Text
                                    ellipsis
                                    strong={i === active}
                                    style={{ maxWidth: 180 }}
                                  >
                                    {s.title || `Slide ${i + 1}`}
                                  </Typography.Text>
                                }
                                description={
                                  cp ? (
                                    <Tag
                                      color={cp.active ? "red" : "default"}
                                      icon={<FlagOutlined />}
                                      style={{ marginTop: 2 }}
                                    >
                                      checkpoint
                                    </Tag>
                                  ) : null
                                }
                              />
                            </List.Item>
                          );
                        }}
                      />
                    </Card>
                  </Col>

                  {/* xem trước slide */}
                  <Col xs={24} lg={10}>
                    <Card
                      title={slide ? `Slide ${slide.index + 1}` : "Slide"}
                      styles={{ body: { padding: 12 } }}
                    >
                      {slide ? <SlideCanvas slide={slide} /> : null}
                      {slide?.notes ? (
                        <Typography.Paragraph
                          type="secondary"
                          style={{ marginTop: 12, marginBottom: 0, fontSize: 13 }}
                        >
                          <strong>Ghi chú của bạn:</strong> {slide.notes}
                        </Typography.Paragraph>
                      ) : null}
                    </Card>
                  </Col>

                  {/* checkpoint của slide */}
                  <Col xs={24} lg={8}>
                    <Card
                      title="Checkpoint"
                      extra={
                        checkpoint ? (
                          <Space>
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
                          </Space>
                        ) : null
                      }
                    >
                      {!checkpoint ? (
                        <Empty
                          image={Empty.PRESENTED_IMAGE_SIMPLE}
                          description="Slide này chưa có checkpoint"
                        >
                          <Button icon={<FlagOutlined />} onClick={addCheckpoint}>
                            Đặt checkpoint tại đây
                          </Button>
                        </Empty>
                      ) : (
                        <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
                          <Typography.Paragraph
                            editable={{
                              onChange: async (v) => {
                                await api.updateCheckpoint(checkpoint.id, { goal: v });
                                await load();
                              },
                            }}
                            type={checkpoint.goal ? undefined : "secondary"}
                            style={{ marginBottom: 0 }}
                          >
                            {checkpoint.goal || "Mục tiêu kiểm tra (bấm để sửa)"}
                          </Typography.Paragraph>

                          {checkpoint.questions.length === 0 ? (
                            <Alert
                              type="warning"
                              showIcon
                              title="Checkpoint chưa có câu hỏi nào."
                            />
                          ) : (
                            <List
                              size="small"
                              dataSource={checkpoint.questions}
                              renderItem={(q) => (
                                <List.Item
                                  actions={[
                                    <Button
                                      key="del"
                                      type="text"
                                      danger
                                      size="small"
                                      icon={<DeleteOutlined />}
                                      onClick={() => removeQuestion(q.id)}
                                      aria-label="Xoá câu hỏi"
                                    />,
                                  ]}
                                >
                                  <List.Item.Meta
                                    title={
                                      <Typography.Text style={{ fontSize: 13 }}>
                                        {q.prompt}
                                      </Typography.Text>
                                    }
                                    description={
                                      <Space size={4} wrap>
                                        <Tag>{typeLabel(q.type)}</Tag>
                                        {q.origin === "llm" ? (
                                          <Tag color="purple">nháp AI</Tag>
                                        ) : null}
                                      </Space>
                                    }
                                  />
                                </List.Item>
                              )}
                            />
                          )}

                          <Space wrap>
                            <Button
                              type="primary"
                              icon={<PlusOutlined />}
                              onClick={() => setQOpen(true)}
                            >
                              Thêm câu hỏi
                            </Button>
                            <Button
                              icon={<ThunderboltOutlined />}
                              loading={drafting}
                              onClick={draft}
                            >
                              Soạn nháp bằng AI
                            </Button>
                          </Space>
                        </Space>
                      )}
                    </Card>
                  </Col>
                </Row>
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
        <Form form={qForm} layout="vertical" requiredMark={false} preserve={false}>
          <QuestionForm form={qForm} />
        </Form>
      </Modal>
    </Space>
  );
}

function QualityTab({ quality }: { quality: CourseQuality | null }) {
  if (!quality) return <Spin />;
  if (quality.sessions === 0) {
    return (
      <Card>
        <Empty description="Khoá học chưa được dạy buổi nào — chưa có số liệu chất lượng." />
      </Card>
    );
  }

  return (
    <Space orientation="vertical" size="large" style={{ width: "100%" }}>
      <Row gutter={[16, 16]}>
        <Col xs={12} md={6}>
          <Card>
            <Statistic title="Buổi đã dạy" value={quality.sessions} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic title="Slide" value={quality.slides.length} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic
              title="Lượt trả lời"
              value={quality.slides.reduce((n, s) => n + s.answers, 0)}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic
              title="Slide cần xem lại"
              value={quality.needs_attention.length}
              valueStyle={{ color: quality.needs_attention.length ? "#FF9600" : undefined }}
            />
          </Card>
        </Col>
      </Row>

      {quality.needs_attention.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          title="Những slide này đang gây khó nhất"
          description={
            <List
              size="small"
              dataSource={quality.needs_attention}
              renderItem={(s) => (
                <List.Item>
                  <Typography.Text>
                    Slide {s.slide_index + 1} — {s.title || "(không tiêu đề)"}
                  </Typography.Text>
                  <Space>
                    {s.answers ? <Tag color="red">đúng {pct(s.correct_rate)}</Tag> : null}
                    {s.return_visits ? <Tag>quay lại {s.return_visits}</Tag> : null}
                    {s.hints_requested ? <Tag>xin gợi ý {s.hints_requested}</Tag> : null}
                  </Space>
                </List.Item>
              )}
            />
          }
        />
      ) : null}

      <Card title="Chi tiết từng slide">
        <Table<SlideQuality>
          rowKey="slide_index"
          dataSource={quality.slides}
          pagination={false}
          scroll={{ x: 860 }}
          columns={[
            {
              title: "#",
              dataIndex: "slide_index",
              width: 60,
              render: (v: number) => v + 1,
            },
            { title: "Tiêu đề", dataIndex: "title", ellipsis: true },
            {
              title: "Checkpoint",
              dataIndex: "has_checkpoint",
              width: 120,
              render: (v: boolean, r) =>
                v ? <Tag color="red">{r.question_count} câu</Tag> : <Typography.Text type="secondary">—</Typography.Text>,
            },
            { title: "Trả lời", dataIndex: "answers", width: 90, align: "right" },
            {
              title: "Đúng",
              dataIndex: "correct_rate",
              width: 150,
              render: (v: number, r) =>
                r.answers ? (
                  <Progress
                    percent={Math.round(v * 100)}
                    size="small"
                    strokeColor={v >= 0.6 ? "#58CC02" : v >= 0.4 ? "#FF9600" : "#FF4B4B"}
                  />
                ) : (
                  <Typography.Text type="secondary">chưa có</Typography.Text>
                ),
            },
            {
              title: "Bỏ qua",
              dataIndex: "skip_rate",
              width: 90,
              align: "right",
              render: (v: number, r) => (r.answers ? pct(v) : "—"),
            },
            {
              title: "Quay lại",
              dataIndex: "return_visits",
              width: 100,
              align: "right",
            },
            {
              title: "Hỏi / gợi ý",
              key: "asks",
              width: 110,
              align: "right",
              render: (_, r) => `${r.questions_asked} / ${r.hints_requested}`,
            },
          ]}
        />
      </Card>
    </Space>
  );
}
