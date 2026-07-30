"use client";

import { DeleteOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import {
  App,
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  Modal,
  Row,
  Space,
  Spin,
  Statistic,
  Tag,
  Typography,
} from "antd";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
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

  return (
    <Space orientation="vertical" size="large" style={{ width: "100%" }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Typography.Title level={3} style={{ margin: 0 }}>
          Khoá học
        </Typography.Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading} />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
            Khoá học mới
          </Button>
        </Space>
      </div>

      {error ? <Alert type="error" showIcon title={error} /> : null}

      {loading ? (
        <div className="grid place-items-center py-20">
          <Spin size="large" />
        </div>
      ) : courses.length === 0 ? (
        <Card>
          <Empty description="Chưa có khoá học nào">
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
              Tạo khoá học đầu tiên
            </Button>
          </Empty>
        </Card>
      ) : (
        <Row gutter={[16, 16]}>
          {courses.map((c) => (
            <Col key={c.id} xs={24} md={12} xl={8}>
              <Card
                title={
                  <Link href={`/dashboard/courses/${c.id}`} className="font-bold">
                    {c.title}
                  </Link>
                }
                extra={
                  <Button
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    aria-label="Xoá khoá học"
                    onClick={() => remove(c)}
                  />
                }
                actions={[
                  <Link key="open" href={`/dashboard/courses/${c.id}`}>
                    Mở khoá học
                  </Link>,
                ]}
              >
                <Space orientation="vertical" size="small" style={{ width: "100%" }}>
                  {c.subject ? <Tag color="blue">{c.subject}</Tag> : null}
                  <Typography.Paragraph
                    type="secondary"
                    ellipsis={{ rows: 2 }}
                    style={{ marginBottom: 8, minHeight: 44 }}
                  >
                    {c.description || "Chưa có mô tả."}
                  </Typography.Paragraph>
                  <Row gutter={8}>
                    <Col span={8}>
                      <Statistic
                        title="Slide"
                        value={c.slide_count}
                        valueStyle={{ fontSize: 20 }}
                      />
                    </Col>
                    <Col span={8}>
                      <Statistic
                        title="Checkpoint"
                        value={c.checkpoint_count}
                        valueStyle={{ fontSize: 20 }}
                      />
                    </Col>
                    <Col span={8}>
                      <Statistic
                        title="Câu hỏi"
                        value={c.question_count}
                        valueStyle={{ fontSize: 20 }}
                      />
                    </Col>
                  </Row>
                </Space>
              </Card>
            </Col>
          ))}
        </Row>
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
    </Space>
  );
}
