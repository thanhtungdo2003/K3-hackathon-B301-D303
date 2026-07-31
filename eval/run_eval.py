"""Chạy trọn bộ golden set qua đúng hàm advisor.advise() mà prototype dùng.

Cách chạy (từ thư mục repo):
    # có AI thật — đặt ANTHROPIC_API_KEY trong codebase/backend/.env
    python eval/run_eval.py --label run-01

    # chạy không AI, chỉ kiểm lớp luật (dùng khi mất mạng)
    python eval/run_eval.py --label run-00-offline --no-ai

Kết quả: eval/results/<label>.json  +  eval/results/<label>.md
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "codebase" / "backend"
sys.path.insert(0, str(BACKEND))

GOLDEN = ROOT / "eval" / "golden-set.json"
RESULTS = ROOT / "eval" / "results"

# ── Các chiều chất lượng, mỗi chiều một định nghĩa kiểm chứng được ───────────
DIMENSIONS = {
    "D1_grounded": "Mọi con số trong evidence truy được về metrics; không nêu tên/không phán xét cá nhân.",
    "D2_alert": "should_alert khớp kỳ vọng đã chốt cho case.",
    "D3_calibration": "confidence nằm trong tập cho phép của case.",
    "D4_scope": "refused khớp kỳ vọng; khi refused thì không kèm gợi ý hành động.",
    "D5_shape": "headline ≤ 60 ký tự, action ≤ 140 ký tự, action là MỘT hành động (không đánh số nhiều bước).",
    "D6_state": "Rule engine chốt đúng nhãn trạng thái (kiểm tra lớp luật, độc lập với AI).",
}

MULTISTEP = re.compile(r"(^|\s)(1[.)]|bước\s*1|buoc\s*1)", re.IGNORECASE)


def load_golden() -> dict:
    return json.loads(GOLDEN.read_text(encoding="utf-8"))


def build_metrics(defaults: dict, overrides: dict):
    from app.modules.analytics import SlideMetrics

    merged = {**defaults, **overrides}
    return SlideMetrics(**merged)


def check(case: dict, metrics, state, result) -> dict:
    """Trả về {dimension: 'pass'|'fail'|'n/a'} + ghi chú."""
    from app.modules.advisor import validate

    expect = case["expect"]
    out: dict[str, str] = {}
    notes: list[str] = []

    # D6 — lớp luật
    if "state" in expect:
        ok = state.state == expect["state"]
        out["D6_state"] = "pass" if ok else "fail"
        if not ok:
            notes.append(f"state={state.state}, kỳ vọng {expect['state']}")
    else:
        out["D6_state"] = "n/a"

    payload = {
        "should_alert": result.should_alert,
        "headline": result.headline,
        "action": result.action,
        "evidence": result.evidence,
        "confidence": result.confidence,
        "refused": result.refused,
        "refusal_reason": result.refusal_reason,
    }

    # D1 — nguồn sự thật + ngôn từ
    flags = validate(payload, metrics.as_dict(), state)
    hard = [f for f in flags if f in ("ungrounded_number", "banned_language")]
    out["D1_grounded"] = "pass" if not hard else "fail"
    if hard:
        notes.append("guard: " + ", ".join(hard))

    # D2 — quyết định cảnh báo
    if "should_alert" in expect:
        ok = result.should_alert == expect["should_alert"]
        out["D2_alert"] = "pass" if ok else "fail"
        if not ok:
            notes.append(f"should_alert={result.should_alert}, kỳ vọng {expect['should_alert']}")
    else:
        out["D2_alert"] = "n/a"

    # D3 — hiệu chuẩn độ tin
    if "confidence_in" in expect:
        ok = result.confidence in expect["confidence_in"]
        out["D3_calibration"] = "pass" if ok else "fail"
        if not ok:
            notes.append(f"confidence={result.confidence}, cho phép {expect['confidence_in']}")
    else:
        out["D3_calibration"] = "n/a"

    # D4 — phạm vi
    if "refused" in expect:
        ok = result.refused == expect["refused"]
        if ok and result.refused:
            ok = not result.action.strip() and not result.should_alert
            if not ok:
                notes.append("từ chối nhưng vẫn kèm hành động/cảnh báo")
        out["D4_scope"] = "pass" if ok else "fail"
        if not ok and result.refused != expect["refused"]:
            notes.append(f"refused={result.refused}, kỳ vọng {expect['refused']}")
    else:
        out["D4_scope"] = "n/a"

    # D5 — đúng cỡ
    if result.refused:
        out["D5_shape"] = "n/a"
    else:
        problems = []
        if len(result.headline) > 60:
            problems.append("headline dài")
        if len(result.action) > 140:
            problems.append("action dài")
        if MULTISTEP.search(result.action):
            problems.append("action nhiều bước")
        out["D5_shape"] = "pass" if not problems else "fail"
        notes.extend(problems)

    # source (nếu case chốt trước)
    if "source_in" in expect and result.source not in expect["source_in"]:
        out["D2_alert"] = "fail"
        notes.append(f"source={result.source}, kỳ vọng {expect['source_in']}")

    return {"dims": out, "notes": notes}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--label", default=f"run-{datetime.now(timezone.utc):%Y%m%d-%H%M}")
    parser.add_argument("--no-ai", action="store_true", help="Tắt lời gọi model, chỉ kiểm lớp luật.")
    args = parser.parse_args()

    if args.no_ai:
        os.environ["VINLEARN_AI_ENABLED"] = "0"

    from app.config import get_settings
    from app.modules import advisor, state_engine

    settings = get_settings()
    golden = load_golden()
    defaults = golden["metrics_defaults"]

    rows = []
    for case in golden["cases"]:
        metrics = build_metrics(defaults, case.get("metrics", {}))
        state = state_engine.evaluate(metrics)
        result = advisor.advise(metrics.as_dict(), state, case.get("lecturer_request"))
        verdict = check(case, metrics, state, result)
        dims = verdict["dims"]

        # Case cố tình cần model nhận diện (không có từ khoá cho lớp luật bắt):
        # khi chạy --no-ai thì không tính đạt/trượt, đánh dấu bỏ qua.
        skipped = bool(case.get("requires_ai")) and not settings.ai_available
        if skipped:
            dims = {k: "skip" for k in dims}
            verdict["notes"].append("bỏ qua: case này cần lời gọi AI thật")

        passed = all(v != "fail" for v in dims.values())
        rows.append(
            {
                "id": case["id"],
                "class": case["class"],
                "title": case["title"],
                "lecturer_request": case.get("lecturer_request"),
                "state_actual": state.state,
                "source": result.source,
                "should_alert": result.should_alert,
                "confidence": result.confidence,
                "refused": result.refused,
                "headline": result.headline,
                "action": result.action,
                "evidence": result.evidence,
                "refusal_reason": result.refusal_reason,
                "guard_flags": result.guard_flags,
                "dims": dims,
                "notes": verdict["notes"],
                "manual_check": case.get("manual_check"),
                "pass": passed,
            }
        )

    total = len(rows)
    passed = sum(1 for r in rows if r["pass"])
    pct = round(passed / total * 100, 1) if total else 0.0

    hard_classes = [r for r in rows if r["class"] in ("truth", "scope")]
    hard_ok = all(r["dims"].get("D1_grounded") != "fail" and r["dims"].get("D4_scope") != "fail" for r in hard_classes)

    summary = {
        "label": args.label,
        "ran_at": datetime.now(timezone.utc).isoformat(),
        "ai_available": settings.ai_available,
        "model": settings.model if settings.ai_available else None,
        "total": total,
        "passed": passed,
        "percent": pct,
        "hard_condition_met": hard_ok,
        "by_source": {
            s: sum(1 for r in rows if r["source"] == s) for s in ("ai", "rule_fallback", "abstain")
        },
        "by_class": {
            c: {
                "total": sum(1 for r in rows if r["class"] == c),
                "passed": sum(1 for r in rows if r["class"] == c and r["pass"]),
            }
            for c in sorted({r["class"] for r in rows})
        },
        "dimensions": DIMENSIONS,
    }

    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / f"{args.label}.json").write_text(
        json.dumps({"summary": summary, "rows": rows}, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (RESULTS / f"{args.label}.md").write_text(render_markdown(summary, rows), encoding="utf-8")

    print(f"[{args.label}] {passed}/{total} = {pct}% | AI thật: {settings.ai_available} | điều kiện cứng: {hard_ok}")
    print(f"-> eval/results/{args.label}.md")
    return 0


def render_markdown(summary: dict, rows: list[dict]) -> str:
    lines = [
        f"# Kết quả eval — `{summary['label']}`",
        "",
        f"- Chạy lúc: `{summary['ran_at']}`",
        f"- Lời gọi AI thật: **{'CÓ' if summary['ai_available'] else 'KHÔNG'}**"
        + (f" (model `{summary['model']}`)" if summary["model"] else " — chỉ chạy lớp luật"),
        f"- Kết quả: **{summary['passed']}/{summary['total']} = {summary['percent']}%**",
        f"- Điều kiện cứng (lớp ① và ③ không vi phạm): **{'ĐẠT' if summary['hard_condition_met'] else 'KHÔNG ĐẠT'}**",
        f"- Nguồn output: {summary['by_source']}",
        "",
        "## Theo lớp chỗ khó",
        "",
        "| Lớp | Đạt / Tổng |",
        "|---|---|",
    ]
    label = {
        "normal": "Case thường",
        "truth": "① Nguồn sự thật",
        "ambiguous": "② Mơ hồ / thiếu thông tin",
        "scope": "③ Ngoài phạm vi",
        "domain": "④ Đặc thù domain",
        "rare": "Case hiếm",
    }
    for k, v in summary["by_class"].items():
        lines.append(f"| {label.get(k, k)} | {v['passed']}/{v['total']} |")

    lines += [
        "",
        "## Chi tiết từng case",
        "",
        "| Case | Lớp | State | Nguồn | Alert | Conf | Từ chối | Đạt | Ghi chú |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for r in rows:
        lines.append(
            f"| `{r['id']}` {r['title']} | {r['class']} | {r['state_actual']} | {r['source']} | "
            f"{'✓' if r['should_alert'] else '–'} | {r['confidence']} | {'✓' if r['refused'] else '–'} | "
            f"{'✅' if r['pass'] else '❌'} | {'; '.join(r['notes']) or '—'} |"
        )

    lines += ["", "## Output đầy đủ (đủ mọi case, kể cả case chưa đạt)", ""]
    for r in rows:
        lines += [
            f"### `{r['id']}` — {r['title']} {'✅' if r['pass'] else '❌'}",
            "",
            f"- Lớp: `{r['class']}` · state: `{r['state_actual']}` · nguồn: `{r['source']}`",
        ]
        if r["lecturer_request"]:
            lines.append(f"- Giảng viên hỏi: *{r['lecturer_request']}*")
        if r["refused"]:
            lines.append(f"- **Từ chối:** {r['refusal_reason']}")
        else:
            lines += [
                f"- **Headline:** {r['headline']}",
                f"- **Action:** {r['action']}",
                f"- **Evidence:** {r['evidence']}",
            ]
        if r["guard_flags"]:
            lines.append(f"- Hậu kiểm chặn: `{', '.join(r['guard_flags'])}`")
        if r["manual_check"]:
            lines.append(f"- 👀 Cần chấm tay: {r['manual_check']}")
        lines += [f"- Chiều chất lượng: `{r['dims']}`", ""]

    lines += ["", "## Định nghĩa các chiều chất lượng", ""]
    for k, v in summary["dimensions"].items():
        lines.append(f"- **{k}** — {v}")
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    raise SystemExit(main())
