"use client";

/** Khoá học — lưới Bento, mỗi khoá một ô. */
import {
  BookOutlined,
  DeleteOutlined,
  FileTextOutlined,
  FlagOutlined,
  PlusOutlined,
  QuestionCircleOutlined,
  ReloadOutlined,
  RightOutlined,
  WarningFilled,
} from "@ant-design/icons";
import { Alert, App, Button, Form, Input, Modal, Spin, Tag, Tooltip, Typography } from "antd";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BentoCard, BentoGrid, BentoStat } from "@/components/ai/Bento";
import { api, type CourseOut } from "@/lib/api";

export default function CoursesPage() {
  const { message, modal } = App.useApp();
  const [courses, setCourses] = useState<CourseOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<{ title: string; subject?: string; description?: string }>();

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setCourses(await api.courses());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được khoá học.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await api.createCourse(values);
      message.success("Đã tạo khoá học.");
      setOpen(false);
      form.resetFields();
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Không tạo được khoá học.");
    } finally {
      setSaving(false);
    }
  }

  function remove(course: CourseOut) {
    modal.confirm({
      title: `Xoá khoá học “${course.title}”?`,
      content: "Toàn bộ slide, checkpoint, phòng học và dữ liệu buổi dạy của khoá này sẽ mất.",
      okText: "Xoá",
      okButtonProps: { danger: true },
      cancelText: "Huỷ",
      onOk: async () => {
        await api.deleteCourse(course.id);
        message.success("Đã xoá.");
        await load();
      },
    });
  }

  const totals = courses.reduce(
    (acc, c) => ({
      slides: acc.slides + c.slide_count,
      checkpoints: acc.checkpoints + c.checkpoint_count,
      questions: acc.questions + c.question_count,
    }),
    { slides: 0, checkpoints: 0, questions: 0 },
  );
  const noSlides = courses.filter((c) => c.slide_count === 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Typography.Text style={{ color: "var(--ai-muted)", fontWeight: 700, fontSize: 12 }}>
            NỘI DUNG GIẢNG DẠY
          </Typography.Text>
          <Typography.Title level={3} style={{ margin: 0, color: "var(--ai-ink)" }}>
            Khoá học
          </Typography.Title>
        </div>
        <div className="flex gap-2">
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading} />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
            Khoá học mới
          </Button>
        </div>
      </div>

      {error ? <Alert type="error" showIcon title={error} /> : null}

      {loading ? (
        <div className="grid place-items-center py-24">
          <Spin size="large" />
        </div>
      ) : courses.length === 0 ? (
        <BentoGrid>
          <BentoCard span={6} tone="navy">
            <div className="flex flex-wrap items-center justify-between gap-4 py-2">
              <div>
                <div className="text-xl font-extrabold">Chưa có khoá học nào</div>
                <div className="text-sm font-semibold" style={{ opacity: 0.78 }}>
                  Tạo khoá học rồi tải file PPTX lên. Hoặc nhờ trợ lý ở trang tổng quan tạo giúp.
                </div>
              </div>
              <Button
                type="primary"
                danger
                size="large"
                icon={<PlusOutlined />}
                onClick={() => setOpen(true)}
              >
                Tạo khoá học đầu tiên
              </Button>
            </div>
          </BentoCard>
        </BentoGrid>
      ) : (
        <BentoGrid>
          {/* hàng số liệu gộp */}
          <BentoStat label="Khoá học" value={courses.length} icon={<BookOutlined />} />
          <BentoStat label="Slide" value={totals.slides} icon={<FileTextOutlined />} />
          <BentoStat
            label="Checkpoint"
            value={totals.checkpoints}
            hint={`${totals.questions} câu hỏi`}
            icon={<FlagOutlined />}
          />

          {noSlides.length > 0 ? (
            <BentoCard span={6} tone="red" title="Chưa mở phòng được">
              <div className="flex items-start gap-2 text-sm font-semibold">
                <WarningFilled style={{ color: "var(--ai-red)", marginTop: 3 }} />
                <span>
                  {noSlides.length} khoá chưa có slide: {noSlides.map((c) => c.title).join(", ")}. Mở
                  khoá học và bấm Tải PPTX lên.
                </span>
              </div>
            </BentoCard>
          ) : null}

          {/* mỗi khoá học một ô */}
          {courses.map((c) => (
            <BentoCard key={c.id} span={3}>
              <div className="flex items-start justify-between gap-2">
                <Link href={`/dashboard/courses/${c.id}`} className="min-w-0 flex-1">
                  <div
                    className="truncate text-lg font-extrabold"
                    style={{ color: "var(--ai-ink)" }}
                    title={c.title}
                  >
                    {c.title}
                  </div>
                </Link>
                <Tooltip title="Xoá khoá học">
                  <Button
                    type="text"
                    danger
                    size="small"
                    icon={<DeleteOutlined />}
                    aria-label="Xoá khoá học"
                    onClick={() => remove(c)}
                  />
                </Tooltip>
              </div>

              {c.subject ? (
                <div>
                  <Tag color="blue" style={{ marginInlineEnd: 0 }}>
                    {c.subject}
                  </Tag>
                </div>
              ) : null}

              <p
                className="m-0 line-clamp-2 min-h-[36px] text-xs font-semibold"
                style={{ color: "var(--ai-muted)" }}
              >
                {c.description || "Chưa có mô tả."}
              </p>

              {/* ba số liệu trong một dải phẳng */}
              <div
                className="grid grid-cols-3 gap-2 rounded-xl px-2 py-2 text-center"
                style={{ background: "var(--ai-bg)" }}
              >
                {[
                  { icon: <FileTextOutlined />, value: c.slide_count, label: "slide" },
                  { icon: <FlagOutlined />, value: c.checkpoint_count, label: "checkpoint" },
                  { icon: <QuestionCircleOutlined />, value: c.question_count, label: "câu hỏi" },
                ].map((cell) => (
                  <div key={cell.label}>
                    <div
                      className="text-lg font-extrabold tabular-nums"
                      style={{ color: cell.value === 0 ? "var(--ai-muted)" : "var(--ai-navy-soft)" }}
                    >
                      {cell.value}
                    </div>
                    <div className="bento-label" style={{ fontSize: 10 }}>
                      {cell.label}
                    </div>
                  </div>
                ))}
              </div>

              <Link href={`/dashboard/courses/${c.id}`} className="mt-auto">
                <Button block type={c.slide_count === 0 ? "primary" : "default"}>
                  {c.slide_count === 0 ? "Tải slide lên" : "Mở khoá học"}{" "}
                  <RightOutlined style={{ fontSize: 10 }} />
                </Button>
              </Link>
            </BentoCard>
          ))}
        </BentoGrid>
      )}

      <Modal
        title="Khoá học mới"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={create}
        confirmLoading={saving}
        okText="Tạo"
        cancelText="Huỷ"
        destroyOnHidden
      >
        <Form form={form} layout="vertical" requiredMark={false}>
          <Form.Item
            name="title"
            label="Tên khoá học"
            rules={[{ required: true, message: "Nhập tên khoá học." }]}
          >
            <Input placeholder="Nhập môn Machine Learning" maxLength={160} />
          </Form.Item>
          <Form.Item name="subject" label="Môn / lĩnh vực">
            <Input placeholder="Trí tuệ nhân tạo" maxLength={80} />
          </Form.Item>
          <Form.Item name="description" label="Mô tả ngắn">
            <Input.TextArea rows={3} maxLength={600} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
