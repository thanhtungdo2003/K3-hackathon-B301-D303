/**
 * Khung của chế độ trình chiếu.
 *
 * Cố tình không có gì ngoài chỗ vẽ slide: không thanh điều hướng, không thông
 * báo, không hộp thoại, không số liệu. Màn hình này chiếu lên máy chiếu nên
 * mọi thứ khác đều là nhiễu.
 */
export const metadata = {
  title: "VINLEARN — Trình chiếu",
};

export default function PresentLayout({ children }: { children: React.ReactNode }) {
  return <div className="agora-present-root">{children}</div>;
}
