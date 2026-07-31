"""answer_engine — Topper-style evaluated answer booklet rendering.

Ruled board-exam booklet with examiner annotations: red ticks per step,
step-wise marks in the margin, circled per-question totals, remarks, and a
front-page total marks box. Figures embedded via qp_engine.render_figure.
"""
import io
import textwrap as _tw

from qp_engine import render_figure

RED = (0.82, 0.15, 0.15)
INK = (0.10, 0.12, 0.30)   # blue-ink handwriting colour
GREY = (0.45, 0.45, 0.5)


def render_evaluated_booklet(data: dict, params: dict) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import cm
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    W, H = A4
    left_edge = 1.1 * cm
    margin_x = 3.0 * cm
    red_x = margin_x - 0.45 * cm
    right = W - 1.4 * cm
    top = H - 2.4 * cm
    bottom = 1.8 * cm
    gap = 21
    state = {"y": top, "page": 0}

    def draw_page():
        state["page"] += 1
        c.setStrokeColorRGB(0.72, 0.82, 0.94)
        c.setLineWidth(0.7)
        y = top
        while y > bottom:
            c.line(left_edge, y - 5, right, y - 5)
            y -= gap
        c.setStrokeColorRGB(*RED)
        c.setLineWidth(1.1)
        c.line(red_x, H - 1.1 * cm, red_x, bottom - 0.6 * cm)
        c.setFillColorRGB(*GREY)
        c.setFont("Helvetica", 8)
        c.drawRightString(right, H - 1.3 * cm, f"Page {state['page']}")
        c.setFillColorRGB(*INK)
        state["y"] = top

    def next_line():
        state["y"] -= gap
        if state["y"] < bottom:
            c.showPage()
            draw_page()

    def ensure_lines(n):
        if state["y"] - n * gap < bottom:
            c.showPage()
            draw_page()

    def write(text, size=10.5, bold=False, indent=0, margin_label=None, tick=False,
              step_marks=None, color=INK):
        wrap_width = max(28, int((right - margin_x - indent - 26) / (size * 0.52)))
        chunks = _tw.wrap(str(text), width=wrap_width) or [""]
        for idx, chunk in enumerate(chunks):
            c.setFillColorRGB(*color)
            c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
            c.drawString(margin_x + indent, state["y"], chunk)
            if idx == 0 and margin_label:
                c.setFont("Helvetica-Bold", 10.5)
                c.setFillColorRGB(*RED)
                c.drawString(left_edge + 4, state["y"], str(margin_label)[:6])
                c.setFillColorRGB(*INK)
            if idx == len(chunks) - 1 and tick:
                tx = margin_x + indent + c.stringWidth(chunk, "Helvetica-Bold" if bold else "Helvetica", size) + 8
                c.setFont("Helvetica-Bold", 12)
                c.setFillColorRGB(*RED)
                c.drawString(min(tx, right - 30), state["y"] - 1, "\u2713")
                c.setFillColorRGB(*INK)
            if idx == 0 and step_marks is not None:
                c.setFont("Helvetica-Bold", 9)
                c.setFillColorRGB(*RED)
                c.drawRightString(right - 2, state["y"], f"+{step_marks}")
                c.setFillColorRGB(*INK)
            next_line()

    def circled_total(marks, of):
        # per-question total in a red circle in the margin
        ensure_lines(2)
        cx = margin_x + 30
        cy = state["y"] + 2
        c.setStrokeColorRGB(*RED)
        c.setLineWidth(1.3)
        c.ellipse(cx - 26, cy - 9, cx + 26, cy + 11)
        c.setFont("Helvetica-Bold", 10)
        c.setFillColorRGB(*RED)
        c.drawCentredString(cx, cy - 2, f"{marks} / {of}")
        c.setFillColorRGB(*INK)
        next_line()

    def draw_fig(spec):
        png = render_figure(spec or {})
        if not png:
            return
        try:
            img = ImageReader(io.BytesIO(png))
            iw, ih = img.getSize()
            maxw = 8.0 * cm
            dw = min(maxw, iw * 0.5)
            dh = ih * dw / iw
            n_lines = int(dh / gap) + 2
            ensure_lines(n_lines)
            c.drawImage(img, margin_x + 10, state["y"] - dh + gap - 6, width=dw, height=dh,
                        preserveAspectRatio=True, mask="auto")
            for _ in range(n_lines):
                next_line()
        except Exception:
            pass

    draw_page()

    # ── Front header ──
    title = data.get("title") or f"{params.get('subject') or 'Answer'} — Evaluated Answer Booklet"
    c.setFont("Helvetica-Bold", 14)
    c.drawCentredString((left_edge + right) / 2, state["y"], str(title)[:78])
    next_line()
    sub = " · ".join([x for x in [params.get("board"), f"Class {params.get('class_level')}" if params.get("class_level") else "", params.get("subject") or data.get("subject")] if x])
    if sub:
        c.setFont("Helvetica", 10)
        c.setFillColorRGB(*GREY)
        c.drawCentredString((left_edge + right) / 2, state["y"], sub[:100])
        c.setFillColorRGB(*INK)
        next_line()
    c.setFont("Helvetica-Bold", 9)
    c.setFillColorRGB(*RED)
    c.drawCentredString((left_edge + right) / 2, state["y"], "— TOPPER-STYLE ANSWER BOOKLET · EVALUATED —")
    c.setFillColorRGB(*INK)
    next_line()

    total_awarded = data.get("total_awarded")
    max_marks = data.get("max_marks") or params.get("max_marks")
    if total_awarded is not None:
        ensure_lines(3)
        bx = right - 4.6 * cm
        by = state["y"] - gap
        c.setStrokeColorRGB(*RED)
        c.setLineWidth(1.4)
        c.rect(bx, by - 8, 4.2 * cm, 2 * gap)
        c.setFont("Helvetica-Bold", 13)
        c.setFillColorRGB(*RED)
        c.drawCentredString(bx + 2.1 * cm, by + gap - 6, f"TOTAL: {total_awarded}" + (f" / {max_marks}" if max_marks else ""))
        c.setFillColorRGB(*INK)
        next_line(); next_line(); next_line()
    else:
        next_line()

    current_section = None
    for ans in (data.get("answers") or []):
        sec = ans.get("section")
        if sec and sec != current_section:
            current_section = sec
            ensure_lines(2)
            c.setFont("Helvetica-Bold", 11.5)
            c.drawCentredString((margin_x + right) / 2, state["y"], f"SECTION {str(sec).replace('SECTION', '').strip()}")
            next_line()
        qno = str(ans.get("q_no", ""))
        marks = ans.get("marks", "")
        ensure_lines(3)
        write(ans.get("question", ""), size=9, color=GREY, margin_label=f"Q{qno}.")
        for st in (ans.get("steps") or []):
            txt = st.get("text", "") if isinstance(st, dict) else str(st)
            m = st.get("marks") if isinstance(st, dict) else None
            write(txt, size=10.5, indent=6, tick=True, step_marks=(m if m else None))
        draw_fig(ans.get("figure"))
        fa = ans.get("final_answer")
        if fa:
            write(f"\u2234  {fa}", size=10.5, bold=True, indent=6, tick=True)
        awarded = ans.get("marks_awarded", marks)
        if marks != "" and marks is not None:
            circled_total(awarded if awarded is not None else marks, marks)
        remark = ans.get("examiner_remark") or ans.get("examiner_tip")
        if remark:
            write(f"Examiner: {remark}", size=8.5, indent=6, color=(0.62, 0.3, 0.12))
        next_line()

    sr = data.get("summary_remark")
    if sr:
        ensure_lines(4)
        write("— Examiner's overall remark —", size=9, bold=True, color=RED)
        write(str(sr), size=9.5, color=(0.62, 0.3, 0.12))

    c.showPage()
    c.save()
    return buf.getvalue()
