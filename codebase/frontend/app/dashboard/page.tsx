"use client";

/** Tổng quan: mọi số đều lấy từ các buổi đã dạy thật, không có dữ liệu mô phỏng. */
import {
  ArrowRightOutlined,
  BookOutlined,
  DesktopOutlined,
  MessageOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Progress,
  Row,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from "antd";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, type Overview, type SessionSummary } from "@/lib/api";

const pct = (v: number) => `${Math.round(v * 100)}%`;

export default function DashboardHome() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [o, s] = await Promise.all([api.overview(), api.recentSessions(8)]);
      setOverview(o);
      setSessions(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được dữ liệu.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const empty = overview !== null && overview.sessions === 0;

  return (
    <Space orientation="vertical" size="large" style={{ width: "100%" }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Typography.Title level={3} style={{ margin: 0 }}>
          Tổng quan
        </Typography.Title>
        <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>
          Làm mới
        </Button>
      </div>

      {error ? <Alert type="error" showIcon title={error} /> : null}

      {empty ? (
        <Alert
          type="info"
          showIcon
          title="Chưa có buổi dạy nào"
          description="Tạo khoá học, tải slide PPTX lên rồi mở phòng. Số liệu ở đây chỉ xuất hiện sau khi có buổi dạy thật."
          action={
            <Link href="/dashboard/courses">
              <Button type="primary">Tạo khoá học</Button>
            </Link>
          }
        />
      ) : null}

      <Row gutter={[16, 16]}>
        <Col xs={12} md={6}>
          <Card loading={loading}>
            <Statistic
              title="Khoá học"
              value={overview?.courses ?? 0}
              prefix={<BookOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card loading={loading}>
            <Statistic
              title="Phòng học"
              value={overview?.rooms ?? 0}
              prefix={<DesktopOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card loading={loading}>
            <Statistic
              title="Buổi đã dạy"
              value={overview?.sessions ?? 0}
              prefix={<PlayCircleOutlined />}
              suffix={
                overview?.live_sessions ? (
                  <Tag color="green" style={{ marginInlineStart: 8 }}>
                    {overview.live_sessions} đang mở
                  </Tag>
                ) : null
              }
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card loading={loading}>
            <Statistic
              title="Lượt tham gia"
              value={overview?.participants ?? 0}
              prefix={<TeamOutlined />}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={8}>
          <Card title="Chất lượng trả lời" loading={loading}>
            <div className="flex items-center gap-6">
              <Progress
                type="dashboard"
                size={120}
                percent={Math.round((overview?.correct_rate ?? 0) * 100)}
                strokeColor="#58CC02"
              />
              <Space orientation="vertical" size={4}>
                <Typography.Text type="secondary">
                  {overview?.answers ?? 0} lượt trả lời
                </Typography.Text>
                <Typography.Text type="secondary">
                  Bỏ qua: {pct(overview?.skip_rate ?? 0)}
                </Typography.Text>
                <Typography.Text type="secondary">
                  Slide: {overview?.slides ?? 0}
                </Typography.Text>
              </Space>
            </div>
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card title="Học viên chủ động" loading={loading}>
            <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
              <Statistic
                title="Câu hỏi gửi lên"
                value={overview?.questions_asked ?? 0}
                prefix={<MessageOutlined />}
              />
              <Statistic title="Lượt xin gợi ý" value={overview?.hints_requested ?? 0} />
            </Space>
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card title="Teaching Advisor" loading={loading}>
            {overview && overview.advisor.total > 0 ? (
              <Space orientation="vertical" size="small" style={{ width: "100%" }}>
                <div className="flex items-center justify-between">
                  <Typography.Text type="secondary">Lượt gợi ý</Typography.Text>
                  <Typography.Text strong>{overview.advisor.total}</Typography.Text>
                </div>
                <div className="flex items-center justify-between">
                  <Typography.Text type="secondary">Có cảnh báo</Typography.Text>
                  <Typography.Text strong>{overview.advisor.alerts}</Typography.Text>
                </div>
                <div className="flex items-center justify-between">
                  <Typography.Text type="secondary">Bạn thấy hữu ích</Typography.Text>
                  <Typography.Text strong>{pct(overview.advisor.useful_rate)}</Typography.Text>
                </div>
                <div className="flex items-center justify-between">
                  <Typography.Text type="secondary">Bị bỏ qua</Typography.Text>
                  <Typography.Text strong>{pct(overview.advisor.dismiss_rate)}</Typography.Text>
                </div>
                <Space wrap size={4} style={{ marginTop: 8 }}>
                  <Tag color="blue">AI {overview.advisor.by_source.ai ?? 0}</Tag>
                  <Tag>Luật {overview.advisor.by_source.rule_fallback ?? 0}</Tag>
                  <Tag color="default">Im lặng {overview.advisor.by_source.abstain ?? 0}</Tag>
                </Space>
              </Space>
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="Chưa có gợi ý nào được ghi lại"
              />
            )}
          </Card>
        </Col>
      </Row>

      <Card
        title="Buổi học gần đây"
        extra={
          <Link href="/dashboard/rooms">
            Phòng học <ArrowRightOutlined />
          </Link>
        }
      >
        <Table<SessionSummary>
          rowKey="id"
          loading={loading}
          dataSource={sessions}
          pagination={false}
          scroll={{ x: 720 }}
          locale={{ emptyText: <Empty description="Chưa có buổi nào" /> }}
          columns={[
            {
              title: "Buổi",
              dataIndex: "title",
              render: (title: string, r) => (
                <Space orientation="vertical" size={0}>
                  <Typography.Text strong>{title}</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {r.course_title}
                  </Typography.Text>
                </Space>
              ),
            },
            {
              title: "Mã phòng",
              dataIndex: "room_code",
              width: 110,
              render: (code: string) => <Tag style={{ letterSpacing: 1 }}>{code}</Tag>,
            },
            {
              title: "Bắt đầu",
              dataIndex: "started_at",
              width: 160,
              render: (v: string) => new Date(v).toLocaleString("vi-VN"),
            },
            {
              title: "Tham gia",
              dataIndex: "participants",
              width: 100,
              align: "right",
            },
            {
              title: "Trả lời",
              dataIndex: "answers",
              width: 100,
              align: "right",
            },
            {
              title: "Đúng",
              dataIndex: "correct_rate",
              width: 110,
              align: "right",
              render: (v: number, r) =>
                r.answers ? (
                  <Typography.Text type={v >= 0.6 ? "success" : v >= 0.4 ? "warning" : "danger"}>
                    {pct(v)}
                  </Typography.Text>
                ) : (
                  <Typography.Text type="secondary">—</Typography.Text>
                ),
            },
            {
              title: "",
              key: "action",
              width: 120,
              render: (_, r) =>
                r.live ? (
                  <Link href={`/teach/${r.id}`}>
                    <Button size="small" type="primary">
                      Vào Bục Giảng
                    </Button>
                  </Link>
                ) : (
                  <Tag>đã kết thúc</Tag>
                ),
            },
          ]}
        />
      </Card>
    </Space>
  );
}
