"""Sinh demo-slides.pdf — 6 trang theo 02-guide.md §5.1.

Chạy:
    pip install reportlab
    python docs/make_slides.py

Nền phẳng một màu, không gradient — cùng hệ thị giác với prototype.
"""
from __future__ import annotations

import sys
from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import landscape
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas as pdfcanvas

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "demo-slides.pdf"

W, H = landscape((720, 405))  # 16:9
PAD = 46

CANVAS = HexColor("#FFFDF6")
SURFACE = HexColor("#FFFFFF")
INK = HexColor("#1F2421")
MUTED = HexColor("#6D7570")
LINE = HexColor("#E2DDD0")
GRASS = HexColor("#58CC02")
SKY = HexColor("#1CB0F6")
FLAME = HexColor("#FF9600")
CHERRY = HexColor("#FF4B4B")
GRAPE = HexColor("#CE82FF")

FONT_CANDIDATES = [
    ("Body", r"C:\Windows\Fonts\segoeui.ttf", r"C:\Windows\Fonts\seguisb.ttf"),
    ("Body", r"C:\Windows\Fonts\arial.ttf", r"C:\Windows\Fonts\arialbd.ttf"),
    ("Body", "/System/Library/Fonts/Supplemental/Arial.ttf", "/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
    ("Body", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
]


def register_fonts() -> tuple[str, str]:
    for _, regular, bold in FONT_CANDIDATES:
        if Path(regular).exists() and Path(bold).exists():
            pdfmetrics.registerFont(TTFont("Body", regular))
            pdfmetrics.registerFont(TTFont("BodyBold", bold))
            return "Body", "BodyBold"
    sys.exit("Không tìm thấy font Unicode hỗ trợ tiếng Việt. Sửa FONT_CANDIDATES trong docs/make_slides.py.")


REG, BOLD = register_fonts()


def wrap(c: pdfcanvas.Canvas, text: str, font: str, size: float, max_w: float) -> list[str]:
    words, lines, cur = text.split(" "), [], ""
    for w in words:
        cand = f"{cur} {w}".strip()
        if c.stringWidth(cand, font, size) > max_w and cur:
            lines.append(cur)
            cur = w
        else:
            cur = cand
    if cur:
        lines.append(cur)
    return lines


class Slide:
    def __init__(self, c: pdfcanvas.Canvas, number: int, kicker: str, title: str, timing: str):
        self.c = c
        c.setFillColor(CANVAS)
        c.rect(0, 0, W, H, stroke=0, fill=1)

        # thanh chỉ mục 6 trang, khối đặc
        for i in range(6):
            c.setFillColor(GRASS if i == number - 1 else LINE)
            c.roundRect(PAD + i * 26, H - 26, 20, 7, 3, stroke=0, fill=1)

        c.setFont(BOLD, 10)
        c.setFillColor(GRASS)
        c.drawString(PAD, H - 52, kicker.upper())
        c.setFillColor(MUTED)
        c.drawRightString(W - PAD, H - 52, timing)

        c.setFont(BOLD, 27)
        c.setFillColor(INK)
        c.drawString(PAD, H - 84, title)
        c.setFillColor(GRASS)
        c.roundRect(PAD, H - 96, 54, 5, 2, stroke=0, fill=1)

        self.y = H - 122

    def bullet(self, text: str, color=INK, size: float = 12.5, dot=GRASS) -> None:
        c = self.c
        lines = wrap(c, text, REG, size, W - PAD * 2 - 22)
        c.setFillColor(dot)
        c.circle(PAD + 5, self.y + 4, 3.6, stroke=0, fill=1)
        c.setFillColor(color)
        c.setFont(REG, size)
        for ln in lines:
            c.drawString(PAD + 20, self.y, ln)
            self.y -= size + 5
        self.y -= 5

    def para(self, text: str, color=MUTED, size: float = 11.5, font=REG) -> None:
        c = self.c
        c.setFillColor(color)
        c.setFont(font, size)
        for ln in wrap(c, text, font, size, W - PAD * 2):
            c.drawString(PAD, self.y, ln)
            self.y -= size + 4
        self.y -= 6

    def stat_row(self, items: list[tuple[str, str, object]]) -> None:
        """items = [(số to, nhãn nhỏ, màu viền)]"""
        c = self.c
        n = len(items)
        gap, box_h = 12, 62
        box_w = (W - PAD * 2 - gap * (n - 1)) / n
        top = self.y - 4
        for i, (value, label, color) in enumerate(items):
            x = PAD + i * (box_w + gap)
            c.setFillColor(SURFACE)
            c.setStrokeColor(color)
            c.setLineWidth(2)
            c.roundRect(x, top - box_h, box_w, box_h, 10, stroke=1, fill=1)
            c.setFillColor(color)
            c.roundRect(x, top - box_h, box_w, 4, 2, stroke=0, fill=1)
            c.setFillColor(INK)
            c.setFont(BOLD, 21)
            c.drawCentredString(x + box_w / 2, top - 30, value)
            c.setFillColor(MUTED)
            c.setFont(REG, 8.5)
            for j, ln in enumerate(wrap(c, label, REG, 8.5, box_w - 12)[:2]):
                c.drawCentredString(x + box_w / 2, top - 44 - j * 10, ln)
        self.y = top - box_h - 16

    def callout(self, text: str, color=FLAME, height: float = 40) -> None:
        c = self.c
        c.setFillColor(SURFACE)
        c.setStrokeColor(color)
        c.setLineWidth(2)
        c.roundRect(PAD, self.y - height, W - PAD * 2, height, 10, stroke=1, fill=1)
        c.setFillColor(color)
        c.roundRect(PAD + 8, self.y - height + 8, 5, height - 16, 2, stroke=0, fill=1)
        c.setFillColor(INK)
        c.setFont(BOLD, 11)
        lines = wrap(c, text, BOLD, 11, W - PAD * 2 - 36)[:2]
        ty = self.y - height / 2 + (len(lines) - 1) * 7
        for ln in lines:
            c.drawString(PAD + 24, ty, ln)
            ty -= 14
        self.y -= height + 14

    def table(self, headers: list[str], rows: list[list[str]], widths: list[float]) -> None:
        c = self.c
        total = W - PAD * 2
        cols = [total * w for w in widths]
        rh = 20
        c.setFont(BOLD, 9)
        c.setFillColor(MUTED)
        x = PAD
        for h, cw in zip(headers, cols):
            c.drawString(x + 5, self.y, h.upper())
            x += cw
        self.y -= 6
        c.setStrokeColor(LINE)
        c.setLineWidth(1)
        c.line(PAD, self.y, W - PAD, self.y)
        self.y -= rh - 6
        for row in rows:
            x = PAD
            c.setFont(REG, 10)
            c.setFillColor(INK)
            for cell, cw in zip(row, cols):
                txt = wrap(c, cell, REG, 10, cw - 10)[:1]
                c.drawString(x + 5, self.y, txt[0] if txt else "")
                x += cw
            self.y -= 4
            c.setStrokeColor(LINE)
            c.line(PAD, self.y, W - PAD, self.y)
            self.y -= rh - 4
        self.y -= 6

    def todo(self, text: str) -> None:
        self.callout(f"[ĐIỀN TRƯỚC DEMO]  {text}", CHERRY, 34)


def build() -> None:
    c = pdfcanvas.Canvas(str(OUT), pagesize=(W, H))
    c.setTitle("VINLEARN — Teaching Advisor")

    # ── 1 · User & Job ──────────────────────────────────────────────────
    s = Slide(c, 1, "1 · User & Job", "Giảng viên biết lớp hổng khi đã quá muộn", '45"')
    s.para(
        "Job executor: giảng viên ĐANG DẠY LIVE một buổi VLearn có slide và câu hỏi tương tác. "
        "Không phải người soạn bài trước buổi, không phải TA đọc log sau buổi.",
    )
    s.callout(
        "Core JTBD: biết lớp vừa mất mạch ở chỗ nào để chỉnh cách giảng NGAY TRONG BUỔI, "
        "thay vì phát hiện sau khi buổi đã kết thúc.",
        GRASS,
        44,
    )
    s.bullet("Học online tắt camera — không đọc được nét mặt. Hỏi \"các em hiểu chưa?\" thì cả lớp im.", INK)
    s.bullet("Tín hiệu duy nhất là câu hỏi tự phát, mà học viên online hiếm khi hỏi.", INK)
    s.todo("Con số pain từ khảo sát/mining: \"__/__ giảng viên xác nhận\" + 1 quote nguyên văn")

    c.showPage()

    # ── 2 · Vì sao chọn tính năng này ───────────────────────────────────
    s = Slide(c, 2, "2 · Vì sao chọn", "Bốn ứng viên, chọn cái đúng thời điểm", '45"')
    s.table(
        ["Ứng viên", "Tần suất", "Mỗi lần tốn gì", "Chọn"],
        [
            ["Popup trạng thái lớp trong buổi", "nhiều lần / buổi", "5-15 phút giảng sai hướng", "CHỌN"],
            ["Bản tin cuối buổi cho giảng viên", "1 lần / buổi", "chỉ sửa được ở buổi sau", "loại"],
            ["Gợi ý câu hỏi cho học viên bí", "vài lần / buổi", "LLM sinh nội dung học thuật", "loại"],
            ["Chấm tự luận bằng AI", "sau buổi", "1-2 giờ giảng viên, sai là mất điểm", "loại"],
        ],
        [0.40, 0.16, 0.32, 0.12],
    )
    s.bullet(
        "Loại \"bản tin cuối buổi\" dù dễ build hơn: cùng dữ liệu nhưng SAI THỜI ĐIỂM — "
        "nó tái tạo đúng cái muộn mà ta đang muốn chữa.",
        INK,
    )
    s.bullet(
        "Loại \"gợi ý câu hỏi\" và \"chấm tự luận\": AI chạm trực tiếp vào kiến thức và điểm số, "
        "cost-of-error không kiểm soát nổi trong 1,5 ngày.",
        INK,
    )
    s.todo("Điền cột \"bao nhiêu người gặp\" bằng số từ evidence")

    c.showPage()

    # ── 3 · Giải pháp & demo live ───────────────────────────────────────
    s = Slide(c, 3, "3 · Giải pháp & demo live", "Một popup hai dòng, có số làm căn cứ", "2'")
    s.callout(
        "Lát cắt: giảng viên đang dạy live · biết lớp có mất mạch ở slide này không · "
        "AI quyết định có cảnh báo và chọn MỘT hành động · popup 2 dòng, bấm một nút là bỏ qua.",
        GRAPE,
        46,
    )
    s.para(
        "Augment, không automate. Sai thì giảng viên mất 30 giây và một nút bấm. "
        "Nếu AI tự đổi slide mà sai, cả lớp mất mạch và giảng viên phải sửa trước mặt học viên.",
        INK,
        11.5,
        BOLD,
    )
    s.bullet("RULE chấm bài, tổng hợp, chốt trạng thái lớp, chặn khi thiếu dữ liệu và khi yêu cầu ngoài thẩm quyền.", INK, 11.5, SKY)
    s.bullet("AI chỉ viết cảnh báo và chọn hành động — đọc số đã tổng hợp, không thấy tên hay câu trả lời của ai.", INK, 11.5, GRAPE)
    s.bullet("Hậu kiểm chặn bịa số và ngôn từ quy kết; không qua thì rơi về mẫu cố định, popup nói rõ nguồn.", INK, 11.5, FLAME)
    s.callout("DEMO LIVE: (1) case chuẩn — lớp rối, popup bật kèm chip số liệu.  (2) case chỗ khó — hỏi \"em nào yếu nhất?\", Advisor từ chối.", SKY, 42)

    c.showPage()

    # ── 4 · Kết quả đo ──────────────────────────────────────────────────
    s = Slide(c, 4, "4 · Kết quả đo", "31 case, quality bar có điều kiện cứng", '45"')
    s.callout(
        "Quality bar chốt 23:59 N1: đạt khi >= 80% golden set qua auto-check, VÀ 100% case lớp (1) và (3) "
        "không bịa số, không nêu tên, không trả lời ngoài thẩm quyền.",
        GRASS,
        44,
    )
    s.stat_row(
        [
            ("31", "case golden set", SKY),
            ("6", "chiều chất lượng tự động", GRASS),
            ("3", "lỗi thật eval bắt được", FLAME),
            ("100%", "lượt offline qua bộ", GRASS),
        ]
    )
    s.bullet(
        "Failure đáng kể nhất: sai 60% nhưng thiếu dữ liệu thời gian thì rule engine xếp \"stable\" — "
        "hệ thống IM LẶNG đúng lúc đáng báo. Case NST-03 bắt được, đã hạ ngưỡng need_attention.",
        INK,
    )
    s.todo("Điền % lượt run-01 (AI thật) và đối chiếu với bar. Chưa đạt thì phân tích nguyên nhân, đừng giấu.")

    c.showPage()

    # ── 5 · User thật nói gì ────────────────────────────────────────────
    s = Slide(c, 5, "5 · User thật nói gì", "Vòng validation với 5 người ngoài nhóm", '45"')
    s.para(
        "Task giao: \"Thầy/cô đang dạy slide này. Dùng màn hình này để quyết định có nên đi tiếp hay không.\" "
        "Im lặng quan sát, rồi hỏi đúng 3 câu.",
    )
    s.todo("Quote nguyên văn 1 (tên / vai)")
    s.todo("Quote nguyên văn 2 (tên / vai)")
    s.callout("Thay đổi đã làm từ feedback: [ĐIỀN] — trỏ về mẩu số mấy trong validation/feedback-log.md", SKY, 40)

    c.showPage()

    # ── 6 · Nếu có thêm 1 tuần ──────────────────────────────────────────
    s = Slide(c, 6, "6 · Nếu có thêm 1 tuần", "Ba việc, theo đúng thứ tự", '30"')
    s.bullet(
        "Mining data pack thật để thay 31 case tự dựng bằng >= 10 case lấy từ chatlog — "
        "golden set hiện tại chưa có case nào từ dữ liệu thật.",
        INK,
        12.5,
        CHERRY,
    )
    s.bullet(
        "Chạy trọn bộ eval với AI thật rồi lặp: chọn MỘT failure đau nhất, sửa prompt, chạy lại trọn bộ.",
        INK,
        12.5,
        FLAME,
    )
    s.bullet(
        "Đo báo động giả trong buổi thật: bao nhiêu popup bị bấm \"Bỏ qua\" — đây là chỉ số quyết định "
        "giảng viên có tắt tính năng sau hai lần hay không.",
        INK,
        12.5,
        SKY,
    )
    s.callout(
        "Bài học lớn nhất: golden set không phải thủ tục cho đủ điểm. Nó bắt được 3 lỗi thật mà đọc code không thấy — "
        "trong đó có một lỗi khiến hệ thống im lặng đúng lúc đáng báo.",
        GRASS,
        46,
    )

    c.showPage()
    c.save()
    print(f"Đã tạo {OUT}")


if __name__ == "__main__":
    build()
