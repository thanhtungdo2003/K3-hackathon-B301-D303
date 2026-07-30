"use client";

/** Phòng học — lưới Bento: mã lớp là thứ to nhất trên mỗi ô. */
import {
  DeleteOutlined,
  DesktopOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  PoweroffOutlined,
  RadarChartOutlined,
  ReloadOutlined,
  WarningFilled,
} from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { BentoCard, BentoGrid, BentoStat } from "@/components/ai/Bento";
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
  const liveCount = rooms.filter((r) => r.active_session_id).length;

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

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      message.success(`Đã chép mã ${code}.`);
    } catch {
      message.info(`Mã phòng: ${code}`);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Typography.Text style={{ color: "var(--ai-muted)", fontWeight: 700, fontSize: 12 }}>
            LỚP ĐANG MỞ
          </Typography.Text>
          <Typography.Title level={3} style={{ margin: 0, color: "var(--ai-ink)" }}>
            Phòng học
          </Typography.Title>
        </div>
        <div className="flex gap-2">
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading} />
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setOpen(true)}
            disabled={ready.length === 0}
          >
            Phòng mới
          </Button>
        </div>
      </div>

      {error ? <Alert type="error" showIcon title={error} /> : null}

      {loading ? (
        <div className="grid place-items-center py-24">
          <Spin size="large" />
        </div>
      ) : (
        <BentoGrid>
          {!loading && ready.length === 0 ? (
            <BentoCard span={6} tone="red" title="Chưa mở phòng được">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-start gap-2 text-sm font-semibold">
                  <WarningFilled style={{ color: "var(--ai-red)", marginTop: 3 }} />
                  <span>
                    Phòng học phải gắn với một khoá học đã có slide. Hãy tạo khoá học và tải file
                    PPTX lên trước.
                  </span>
                </div>
                <Link href="/dashboard/courses">
                  <Button type="primary">Tới khoá học</Button>
                </Link>
              </div>
            </BentoCard>
          ) : null}

          {rooms.length > 0 ? (
            <>
              <BentoStat label="Phòng học" value={rooms.length} icon={<DesktopOutlined />} />
              <BentoStat
                label="Đang mở"
                value={liveCount}
                hint={liveCount ? "học viên vào được" : "chưa có buổi nào mở"}
                tone={liveCount ? "navy" : "plain"}
                icon={<PlayCircleOutlined />}
              />
              <BentoStat
                label="Buổi đã dạy"
                value={rooms.reduce((n, r) => n + r.total_sessions, 0)}
              />
            </>
          ) : null}

          {rooms.length === 0 && ready.length > 0 ? (
            <BentoCard span={6} tone="navy">
              <div className="flex flex-wrap items-center justify-between gap-4 py-2">
                <div>
                  <div className="text-xl font-extrabold">Chưa có phòng học nào</div>
                  <div className="text-sm font-semibold" style={{ opacity: 0.78 }}>
                    Mỗi phòng có một mã 5 ký tự để học viên vào lớp.
                  </div>
                </div>
                <Button
                  type="primary"
                  danger
                  size="large"
                  icon={<PlusOutlined />}
                  onClick={() => setOpen(true)}
                >
                  Tạo phòng
                </Button>
              </div>
            </BentoCard>
          ) : null}

          {/* mỗi phòng một ô; phòng đang mở được tô nền xanh đậm */}
          {rooms.map((room) => {
            const live = Boolean(room.active_session_id);
            return (
              <BentoCard key={room.id} span={3} tone={live ? "navy" : "plain"}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-base font-extrabold" title={room.name}>
                      {room.name}
                    </div>
                    <div className="bento-label">{room.course_title}</div>
                  </div>
                  <Tooltip title="Xoá phòng">
                    <Button
                      type="text"
                      danger
                      size="small"
                      icon={<DeleteOutlined />}
                      aria-label="Xoá phòng"
                      onClick={() => remove(room)}
                    />
                  </Tooltip>
                </div>

                {/* mã lớp — thứ giảng viên đọc to cho cả lớp */}
                <button
                  onClick={() => copyCode(room.code)}
                  title="Bấm để chép mã"
                  className="w-full rounded-xl py-3 text-center text-3xl font-extrabold transition-opacity hover:opacity-85"
                  style={{
                    letterSpacing: 8,
                    background: live ? "rgba(255,255,255,.14)" : "var(--ai-bg)",
                    border: live ? "1px solid rgba(255,255,255,.2)" : "1px solid var(--ai-line)",
                    color: live ? "#fff" : "var(--ai-navy)",
                  }}
                >
                  {room.code}
                </button>

                <div className="flex flex-wrap items-center gap-2">
                  <Tag style={{ marginInlineEnd: 0 }}>{room.total_sessions} buổi</Tag>
                  {live ? (
                    <Tag color="red" style={{ marginInlineEnd: 0 }}>
                      đang mở
                    </Tag>
                  ) : null}
                </div>

                <div className="mt-auto flex flex-wrap gap-2">
                  {live ? (
                    <>
                      <Link href={`/teach/${room.active_session_id}`} className="flex-1">
                        <Button block type="primary" danger icon={<PlayCircleOutlined />}>
                          Vào Bục Giảng
                        </Button>
                      </Link>
                      <Button
                        href={`/teaching-assistant/${room.active_session_id}`}
                        className="flex-1"
                        target="_blank"
                        rel="noreferrer"
                        icon={<RadarChartOutlined />}
                      >
                        Trợ giảng
                      </Button>
                      <Button icon={<PoweroffOutlined />} onClick={() => end(room)}>
                        Kết thúc
                      </Button>
                    </>
                  ) : (
                    <Button
                      block
                      type="primary"
                      icon={<PlayCircleOutlined />}
                      loading={starting === room.id}
                      onClick={() => start(room)}
                    >
                      Bắt đầu buổi học
                    </Button>
                  )}
                </div>
              </BentoCard>
            );
          })}
        </BentoGrid>
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
    </div>
  );
}
