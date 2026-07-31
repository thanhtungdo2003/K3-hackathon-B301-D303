"use client";

/**
 * Trang giới thiệu VINLEARN.
 * Nội dung chia thành các "slidebox" — mỗi ý một khối, không có đoạn văn dài.
 */
import Link from "next/link";
import { BlockButton } from "@/components/Blocks";
import { SectionLabel, Slidebox } from "@/components/Slidebox";
import ThemeToggle from "@/components/ThemeToggle";
import { Icon } from "@/components/icons";

export default function LandingPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-20 pt-6">
      <header className="mb-12 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-blk border-2 border-b-4 border-line bg-surface">
            <Icon.brand aria-hidden size={24} strokeWidth={2.5} className="text-sky" />
          </span>
          <span className="text-2xl font-extrabold tracking-tight">VINLEARN</span>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link href="/login">
            <BlockButton tone="plain" icon={Icon.key}>
              Đăng nhập
            </BlockButton>
          </Link>
        </div>
      </header>

      <section className="mb-16 grid gap-8 lg:grid-cols-[1.1fr_1fr] lg:items-center">
        <div>
          <p className="mb-3 inline-flex items-center gap-2 rounded-full border-2 border-line bg-surface px-4 py-1.5 text-xs font-extrabold uppercase tracking-widest text-muted">
            <Icon.radar aria-hidden size={16} strokeWidth={2.6} className="text-sky" />
            Dạy học theo thời gian thực
          </p>
          <h1 className="mb-4 text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
            Biết lớp đang mắc ở đâu,
            <br />
            <span className="text-sky">ngay khi còn đang dạy.</span>
          </h1>
          <p className="mb-8 max-w-xl text-base font-semibold leading-relaxed text-muted">
            Giảng viên tải slide lên, đặt checkpoint tại những chỗ dễ hiểu sai. Khi cần, mở câu hỏi
            từ Bục Giảng — hệ thống đo phản hồi của cả lớp và báo lại điểm đang tắc.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/register">
              <BlockButton tone="grass" icon={Icon.signup}>
                Tạo tài khoản giảng viên
              </BlockButton>
            </Link>
            <Link href="/join">
              <BlockButton tone="sky" icon={Icon.ticket}>
                Học viên vào lớp
              </BlockButton>
            </Link>
          </div>
          <p className="mt-4 flex items-center gap-2 text-sm font-bold text-muted">
            <Icon.shield aria-hidden size={16} strokeWidth={2.6} className="text-grass" />
            Học viên không cần tài khoản — chỉ cần mã phòng 5 ký tự.
          </p>
        </div>

        {/* minh hoạ: một slide đang trình chiếu */}
        <div className="blk-card overflow-hidden">
          <div className="flex items-center gap-2 border-b-2 border-line bg-sunken px-4 py-2.5">
            <Icon.slides aria-hidden size={16} strokeWidth={2.6} className="text-muted" />
            <span className="text-xs font-extrabold uppercase tracking-widest text-muted">
              Slide 7 / 24
            </span>
            <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-cherry px-3 py-1 text-xs font-extrabold uppercase tracking-wide text-white">
              <Icon.checkpoint aria-hidden size={13} strokeWidth={3} />
              Checkpoint
            </span>
          </div>
          <div className="space-y-3 p-6">
            <p className="text-xs font-extrabold uppercase tracking-widest text-sky">
              Machine Learning
            </p>
            <p className="text-2xl font-extrabold leading-snug">Overfitting nhận ra bằng gì?</p>
            <ul className="space-y-2 text-sm font-semibold text-muted">
              <li className="flex gap-2">
                <Icon.correct
                  aria-hidden
                  size={18}
                  strokeWidth={2.6}
                  className="mt-0.5 shrink-0 text-grass"
                />
                Sai số trên tập train rất thấp
              </li>
              <li className="flex gap-2">
                <Icon.wrong
                  aria-hidden
                  size={18}
                  strokeWidth={2.6}
                  className="mt-0.5 shrink-0 text-cherry"
                />
                Sai số trên tập test lại cao
              </li>
            </ul>
            <div className="mt-4 flex items-center gap-3 rounded-blk border-2 border-flame bg-sunken px-4 py-3">
              <Icon.warn aria-hidden size={22} strokeWidth={2.6} className="shrink-0 text-flame" />
              <p className="text-sm font-bold leading-snug">
                Phần lớn lớp chọn sai cùng một phương án — nên nói lại phần này.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="mb-16">
        <SectionLabel icon={Icon.compass}>Một buổi dạy chạy như thế nào</SectionLabel>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Slidebox icon={Icon.upload} tone="sky" step="Bước 1" title="Tải slide PPTX lên">
            Hệ thống đọc thẳng file .pptx của bạn, tách tiêu đề, gạch đầu dòng, bảng và ghi chú
            thành từng trang trình chiếu.
          </Slidebox>
          <Slidebox icon={Icon.checkpoint} tone="grape" step="Bước 2" title="Đặt checkpoint">
            Chọn những slide dễ hiểu sai và gắn câu hỏi vào đó. Câu hỏi nằm im cho tới khi bạn cho
            phép.
          </Slidebox>
          <Slidebox icon={Icon.room} tone="sun" step="Bước 3" title="Mở phòng, đọc mã">
            Mỗi phòng có một mã 5 ký tự. Học viên gõ mã là vào được — không email, không mật khẩu.
          </Slidebox>
          <Slidebox icon={Icon.teacher} tone="grass" step="Bước 4" title="Dạy tại Bục Giảng">
            Bạn chuyển slide, bấm mở câu hỏi khi thấy đúng lúc. Phản hồi của lớp hiện ngay trên màn
            hình điều khiển.
          </Slidebox>
        </div>
      </section>

      <section className="mb-16">
        <SectionLabel icon={Icon.checkpoint}>Checkpoint — câu hỏi mở khi bạn muốn</SectionLabel>
        <div className="grid gap-4 lg:grid-cols-3">
          <Slidebox icon={Icon.key} tone="cherry" title="Giảng viên giữ quyền mở">
            Học viên không tự thấy câu hỏi. Chỉ khi bạn bấm mở câu hỏi ở Bục Giảng thì câu hỏi mới
            hiện trên máy của họ.
          </Slidebox>
          <Slidebox icon={Icon.checklist} tone="sky" title="Sáu kiểu câu hỏi">
            Trắc nghiệm một lựa chọn, nhiều lựa chọn, đúng/sai, sắp thứ tự, điền khuyết và thăm dò ý
            kiến. Tất cả chấm bằng luật, không đưa cho AI chấm.
          </Slidebox>
          <Slidebox icon={Icon.ai} tone="grape" title="Soạn nháp bằng LLM">
            Bí ý tưởng thì bấm soạn nháp: mô hình đọc nội dung slide và đề xuất câu hỏi. Bạn vẫn là
            người duyệt trước khi lưu.
          </Slidebox>
        </div>
      </section>

      <section className="mb-16">
        <SectionLabel icon={Icon.radar}>Hệ thống cảnh báo lớp đang tắc</SectionLabel>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Slidebox icon={Icon.gauge} tone="sky" title="Đo bằng luật trước">
            Tỉ lệ đúng, tỉ lệ bỏ qua, thời gian trả lời, số lần quay lại slide cũ — tất cả tính bằng
            công thức cố định, kiểm chứng lại được.
          </Slidebox>
          <Slidebox icon={Icon.shield} tone="grass" title="AI không thấy danh tính">
            Mô hình chỉ nhận số liệu đã gộp và ẩn danh. Không có tên, không có câu trả lời thô của
            từng người.
          </Slidebox>
          <Slidebox icon={Icon.warn} tone="flame" title="Ít dữ liệu thì im lặng">
            Chưa đủ số lượt trả lời, hệ thống nói thẳng là chưa đủ dữ liệu thay vì đoán bừa một cảnh
            báo.
          </Slidebox>
          <Slidebox icon={Icon.checklist} tone="grape" title="Hậu kiểm mọi câu trả lời">
            Mỗi gợi ý đều bị soát lại: có bịa số không, có nêu đích danh học viên không, có tự tin
            quá mức không.
          </Slidebox>
          <Slidebox icon={Icon.pulse} tone="cherry" title="Mất mạng vẫn chạy">
            Khi không gọi được mô hình, hệ thống rơi về gợi ý theo luật chứ không tắt tính năng.
          </Slidebox>
          <Slidebox icon={Icon.up} tone="sun" title="Bạn chấm điểm gợi ý">
            Mỗi cảnh báo có nút hữu ích / không hữu ích. Tỉ lệ bị bỏ qua hiện thẳng trên dashboard.
          </Slidebox>
        </div>
      </section>

      <section className="mb-16">
        <SectionLabel icon={Icon.chart}>Sau buổi dạy</SectionLabel>
        <div className="grid gap-4 lg:grid-cols-3">
          <Slidebox icon={Icon.layers} tone="sky" title="Tổng quan khoá học">
            Bao nhiêu buổi đã dạy, bao nhiêu lượt trả lời, tỉ lệ đúng chung — trên một màn hình.
          </Slidebox>
          <Slidebox icon={Icon.gauge} tone="flame" title="Xếp hạng slide cần xem lại">
            Slide nào sai nhiều, bị bỏ qua nhiều hoặc bị quay lại nhiều sẽ nổi lên đầu danh sách.
          </Slidebox>
          <Slidebox icon={Icon.idea} tone="grass" title="Học viên hỏi gì">
            Những câu học viên gửi lên trong buổi được gom lại theo slide, biết ngay chỗ nào cần
            viết lại.
          </Slidebox>
        </div>
      </section>

      <section className="mb-16">
        <SectionLabel icon={Icon.people}>Phía học viên</SectionLabel>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Slidebox icon={Icon.ticket} tone="sky" title="Vào bằng mã">
            Gõ mã phòng, chọn tên hiển thị và một avatar. Xong.
          </Slidebox>
          <Slidebox icon={Icon.slides} tone="grass" title="Slide bám theo giảng viên">
            Slide tự chuyển theo Bục Giảng, nhưng vẫn lật lại được để xem chỗ vừa lỡ.
          </Slidebox>
          <Slidebox icon={Icon.idea} tone="grape" title="Gợi ý câu để hỏi">
            Không biết hỏi gì thì bấm gợi ý — mô hình đề xuất câu hỏi, tuyệt đối không trả lời hộ.
          </Slidebox>
          <Slidebox icon={Icon.hand} tone="sun" title="Giơ tay không lộ mặt">
            Tín hiệu gửi lên là số liệu gộp, giảng viên thấy lớp đang bí chứ không soi từng người.
          </Slidebox>
        </div>
      </section>

      <section className="blk-card flex flex-col items-center gap-5 px-6 py-12 text-center">
        <span className="grid h-16 w-16 place-items-center rounded-blk border-2 border-b-4 border-line bg-sunken">
          <Icon.rocket aria-hidden size={30} strokeWidth={2.4} className="text-grass" />
        </span>
        <h2 className="max-w-lg text-2xl font-extrabold leading-snug">
          Tạo khoá học đầu tiên trong vài phút
        </h2>
        <p className="max-w-md text-sm font-semibold text-muted">
          Đăng ký, tải một file PPTX lên và mở phòng. Không cần cài gì thêm.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link href="/register">
            <BlockButton tone="grass" icon={Icon.signup}>
              Đăng ký
            </BlockButton>
          </Link>
          <Link href="/login">
            <BlockButton tone="plain" icon={Icon.key}>
              Đã có tài khoản
            </BlockButton>
          </Link>
        </div>
      </section>

      <footer className="mt-12 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs font-bold uppercase tracking-widest text-muted">
        <span className="inline-flex items-center gap-2">
          <Icon.brand aria-hidden size={14} strokeWidth={2.8} />
          VINLEARN
        </span>
        <span>VinLearn — Batch 03 K4 AI Product Hackathon</span>
      </footer>
    </main>
  );
}
