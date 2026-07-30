"use client";

/**
 * Soạn một câu hỏi checkpoint.
 * Đáp án lưu theo đúng hình dạng mà Assessment Engine ở backend chấm:
 *   multiple_choice / true_false -> {value}
 *   multiple_select              -> {values: []}
 *   ordering                     -> {order: []}
 *   fill_blank                   -> {accepted: []}
 *   poll                         -> {} (không chấm)
 */
import { MinusCircleOutlined, PlusOutlined } from "@ant-design/icons";
import { Alert, Button, Form, Input, Select, Space, Typography } from "antd";
import { useMemo } from "react";
import type { QuestionIn, QuestionType } from "@/lib/api";

export const QUESTION_TYPES: { value: QuestionType; label: string; hint: string }[] = [
  { value: "multiple_choice", label: "Trắc nghiệm một lựa chọn", hint: "Chọn đúng một phương án." },
  { value: "multiple_select", label: "Trắc nghiệm nhiều lựa chọn", hint: "Chọn nhiều phương án." },
  { value: "true_false", label: "Đúng / Sai", hint: "Hai phương án cố định." },
  { value: "ordering", label: "Sắp thứ tự", hint: "Kéo các mục về đúng trình tự." },
  { value: "fill_blank", label: "Điền khuyết", hint: "Nhập đáp án bằng chữ." },
  { value: "poll", label: "Thăm dò ý kiến", hint: "Không có đúng/sai, chỉ đếm lựa chọn." },
];

export interface QuestionFormValues {
  type: QuestionType;
  prompt: string;
  options: string[];
  correct?: string;
  corrects?: string[];
  accepted?: string;
}

/** Chuyển giá trị form thành payload gửi lên backend. */
export function toQuestionIn(v: QuestionFormValues, origin: "manual" | "llm" = "manual"): QuestionIn {
  const options = (v.options ?? []).map((o) => (o ?? "").trim()).filter(Boolean);
  let answer: Record<string, unknown> = {};

  if (v.type === "multiple_choice") answer = { value: v.correct ?? "" };
  else if (v.type === "true_false") answer = { value: v.correct ?? "Đúng" };
  else if (v.type === "multiple_select") answer = { values: v.corrects ?? [] };
  else if (v.type === "ordering") answer = { order: options };
  else if (v.type === "fill_blank") {
    answer = {
      accepted: (v.accepted ?? "")
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean),
    };
  }

  return {
    type: v.type,
    prompt: v.prompt.trim(),
    options: v.type === "true_false" ? ["Đúng", "Sai"] : v.type === "fill_blank" ? [] : options,
    answer,
    origin,
  };
}

export default function QuestionForm({
  form,
}: {
  form: ReturnType<typeof Form.useForm<QuestionFormValues>>[0];
}) {
  const type = Form.useWatch("type", form) ?? "multiple_choice";
  const options = Form.useWatch("options", form) ?? [];

  const picks = useMemo(
    () =>
      (options as string[])
        .map((o) => (o ?? "").trim())
        .filter(Boolean)
        .map((o) => ({ value: o, label: o })),
    [options],
  );

  const needsOptions = ["multiple_choice", "multiple_select", "ordering", "poll"].includes(type);
  const hint = QUESTION_TYPES.find((t) => t.value === type)?.hint;

  return (
    <>
      <Form.Item name="type" label="Kiểu câu hỏi" initialValue="multiple_choice">
        <Select options={QUESTION_TYPES.map(({ value, label }) => ({ value, label }))} />
      </Form.Item>
      {hint ? (
        <Typography.Paragraph type="secondary" style={{ marginTop: -12 }}>
          {hint}
        </Typography.Paragraph>
      ) : null}

      <Form.Item
        name="prompt"
        label="Nội dung câu hỏi"
        rules={[{ required: true, message: "Nhập nội dung câu hỏi." }]}
      >
        <Input.TextArea rows={2} maxLength={600} showCount placeholder="Câu hỏi cho học viên…" />
      </Form.Item>

      {needsOptions ? (
        <Form.List
          name="options"
          initialValue={["", ""]}
          rules={[
            {
              validator: async (_, value) => {
                const filled = (value ?? []).filter((v: string) => (v ?? "").trim());
                if (filled.length < 2) throw new Error("Cần ít nhất 2 phương án.");
              },
            },
          ]}
        >
          {(fields, { add, remove }, { errors }) => (
            <Form.Item label={type === "ordering" ? "Các mục (nhập theo đúng thứ tự)" : "Phương án"}>
              <Space orientation="vertical" style={{ width: "100%" }}>
                {fields.map((field, i) => (
                  <Space key={field.key} style={{ width: "100%" }} align="baseline">
                    <Typography.Text type="secondary" style={{ width: 24, display: "inline-block" }}>
                      {i + 1}.
                    </Typography.Text>
                    <Form.Item {...field} noStyle>
                      <Input style={{ width: 380 }} maxLength={200} />
                    </Form.Item>
                    {fields.length > 2 ? (
                      <Button
                        type="text"
                        icon={<MinusCircleOutlined />}
                        onClick={() => remove(field.name)}
                        aria-label="Bỏ phương án"
                      />
                    ) : null}
                  </Space>
                ))}
                <Button type="dashed" icon={<PlusOutlined />} onClick={() => add("")} block>
                  Thêm phương án
                </Button>
                <Form.ErrorList errors={errors} />
              </Space>
            </Form.Item>
          )}
        </Form.List>
      ) : null}

      {type === "multiple_choice" ? (
        <Form.Item
          name="correct"
          label="Đáp án đúng"
          rules={[{ required: true, message: "Chọn đáp án đúng." }]}
        >
          <Select options={picks} placeholder="Chọn một phương án ở trên" />
        </Form.Item>
      ) : null}

      {type === "true_false" ? (
        <Form.Item name="correct" label="Đáp án đúng" initialValue="Đúng">
          <Select
            options={[
              { value: "Đúng", label: "Đúng" },
              { value: "Sai", label: "Sai" },
            ]}
          />
        </Form.Item>
      ) : null}

      {type === "multiple_select" ? (
        <Form.Item
          name="corrects"
          label="Các đáp án đúng"
          rules={[{ required: true, message: "Chọn ít nhất một đáp án." }]}
        >
          <Select mode="multiple" options={picks} placeholder="Chọn các phương án đúng" />
        </Form.Item>
      ) : null}

      {type === "fill_blank" ? (
        <Form.Item
          name="accepted"
          label="Đáp án chấp nhận"
          extra="Nhiều cách viết thì ngăn nhau bằng dấu |, ví dụ: overfitting | quá khớp"
          rules={[{ required: true, message: "Nhập ít nhất một đáp án." }]}
        >
          <Input placeholder="overfitting | quá khớp" maxLength={300} />
        </Form.Item>
      ) : null}

      {type === "ordering" ? (
        <Alert
          type="info"
          showIcon
          title="Thứ tự bạn nhập ở trên chính là đáp án đúng. Học viên sẽ thấy các mục bị xáo trộn."
        />
      ) : null}

      {type === "poll" ? (
        <Alert type="info" showIcon title="Thăm dò ý kiến không có đúng/sai, chỉ đếm lựa chọn." />
      ) : null}
    </>
  );
}
