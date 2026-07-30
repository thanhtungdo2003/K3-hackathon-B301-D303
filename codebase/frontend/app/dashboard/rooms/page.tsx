"use client";

/** Phòng học: mở mã lớp, bắt đầu / kết thúc buổi dạy. */
import {
  DeleteOutlined,
  DesktopOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  PoweroffOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, type CourseOut, type RoomOut } from "@/lib/api";

export default function RoomsPage() {
  const router = useRouter();
  const { message, modal } = App.useApp();
  const [rooms, setRooms] = useState<RoomOut[]>([]);
  const [courses, setCourses] = useState<CourseOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState<number | null>(null);
  const [form] = Form.useForm<{ course_id: number; name: string }>();

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [r, c] = await Promise.all([api.rooms(), api.courses()]);
      setRooms(r);
      setCourses(c);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được phòng học.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const ready = courses.filter((c) => c.slide_count > 0);

  async function create() {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await api.createRoom(values);
      message.success("Đã tạo phòng.");
      setOpen(false);
      form.resetFields();
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Không tạo được phòng.");
    } finally {
      setSaving(false);
    }
  }

  async function start(room: RoomOut) {
    setStarting(room.id);
    try {
      const session = await api.startSession(room.id);
      router.push(`/teach/${session.id}`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Không bắt đầu được buổi học.");
      setStarting(null);
    }
  }

  async function end(room: RoomOut) {
    if (!room.active_session_id) return;
    await api.endSession(room.active_session_id);
    message.success("Đã kết thúc buổi học.");
    await load();
  }

  function remove(room: RoomOut) {
    modal.confirm({
      title: `Xoá phòng “${room.name}”?`,
      content: "Mã phòng sẽ ngừng hoạt động và dữ liệu các buổi đã dạy trong phòng này sẽ mất.",
      okText: "Xoá",
      okButtonProps: { danger: true },
      cancelText: "Huỷ",
      onOk: async () => {
        await api.deleteRoom(room.id);
        message.success("Đã xoá phòng.");
        await load();
      },
    });
  }

  return (
    <Space orientation="vertical" size="large" style={{ width: "100%" }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Typography.Title level={3} style={{ margin: 0 }}>
          Phòng học
        </Typography.Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading} />
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setOpen(true)}
            disabled={ready.length === 0}
          >
            Phòng mới
          </Button>
        </Space>
      </div>

      {error ? <Alert type="error" showIcon title={error} /> : null}

      {!loading && ready.length === 0 ? (
        <Alert
          type="info"
          showIcon
          title="Chưa có khoá học nào đủ điều kiện mở phòng"
          description="Phòng học phải gắn với một khoá học đã có slide. Hãy tạo khoá học và tải file PPTX lên trước."
          action={
            <Link href="/dashboard/courses">
              <Button type="primary">Tới khoá học</Button>
            </Link>
          }
        />
      ) : null}

      {loading ? (
        <div className="grid place-items-center py-20">
          <Spin size="large" />
        </div>
      ) : rooms.length === 0 ? (
        <Card>
          <Empty description="Chưa có phòng học nào" />
        </Card>
      ) : (
        <Row gutter={[16, 16]}>
          {rooms.map((room) => (
            <Col key={room.id} xs={24} md={12} xl={8}>
              <Card
                title={
                  <Space>
                    <DesktopOutlined />
                    {room.name}
                  </Space>
                }
                extra={
                  <Button
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    aria-label="Xoá phòng"
                    onClick={() => remove(room)}
                  />
                }
              >
                <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
                  <div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      MÃ PHÒNG CHO HỌC VIÊN
                    </Typography.Text>
                    <div
                      className="mt-1 rounded-lg border-2 border-line bg-sunken px-4 py-3 text-center text-3xl font-extrabold"
                      style={{ letterSpacing: 6 }}
                    >
                      {room.code}
                    </div>
                  </div>

                  <Space size={4} wrap>
                    <Tag color="blue">{room.course_title}</Tag>
                    <Tag>{room.total_sessions} buổi</Tag>
                    {room.active_session_id ? <Tag color="green">đang mở</Tag> : null}
                  </Space>

                  <Space wrap>
                    {room.active_session_id ? (
                      <>
                        <Link href={`/teach/${room.active_session_id}`}>
                          <Button type="primary" icon={<PlayCircleOutlined />}>
                            Vào Bục Giảng
                          </Button>
                        </Link>
                        <Button danger icon={<PoweroffOutlined />} onClick={() => end(room)}>
                          Kết thúc
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="primary"
                        icon={<PlayCircleOutlined />}
                        loading={starting === room.id}
                        onClick={() => start(room)}
                      >
                        Bắt đầu buổi học
                      </Button>
                    )}
                  </Space>
                </Space>
              </Card>
            </Col>
          ))}
        </Row>
      )}

      <Modal
        title="Phòng học mới"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={create}
        confirmLoading={saving}
        okText="Tạo phòng"
        cancelText="Huỷ"
        destroyOnHidden
      >
        <Form form={form} layout="vertical" requiredMark={false}>
          <Form.Item
            name="course_id"
            label="Khoá học"
            rules={[{ required: true, message: "Chọn khoá học." }]}
          >
            <Select
              placeholder="Chọn khoá học đã có slide"
              options={ready.map((c) => ({
                value: c.id,
                label: `${c.title} (${c.slide_count} slide)`,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="name"
            label="Tên phòng"
            rules={[{ required: true, message: "Đặt tên phòng." }]}
          >
            <Input placeholder="Lớp ML sáng thứ 3" maxLength={120} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
