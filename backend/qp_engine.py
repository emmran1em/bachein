"""qp_engine — Board-exam-grade question paper generation helpers.

- Subject catalog per class
- Figure renderer (matplotlib → PNG) for graphs, geometry, charts, flowcharts
- Official CBSE-style PDF renderer (reportlab platypus): header, QP code, roll-no
  boxes, general instructions, sections, internal choices, embedded figures,
  page numbers + P.T.O. footers.
"""
import io
import math
import random
import string

# ── Options catalog ──
BOARDS = ["CBSE", "ICSE", "State", "IB"]
DIFFICULTIES = ["Easy", "Moderate", "Board Level", "Challenging"]
ACADEMIC_YEARS = ["2022-23", "2023-24", "2024-25", "2025-26", "2026-27"]

SUBJECTS_JUNIOR = [  # classes 6-10
    "Mathematics (Standard)", "Mathematics (Basic)", "Science", "Social Science",
    "English", "Tamil", "Information Technology (IT)",
]
SUBJECTS_SENIOR = [  # classes 11-12
    "Mathematics", "Physics", "Chemistry", "Biology", "Computer Science", "English", "Yoga",
]

def subjects_for_class(class_level: str):
    try:
        cl = int(class_level)
    except Exception:
        return SUBJECTS_JUNIOR
    return SUBJECTS_SENIOR if cl >= 11 else SUBJECTS_JUNIOR


def gen_series_code() -> str:
    return "".join(random.choices(string.ascii_uppercase, k=1)) + "".join(random.choices(string.digits, k=1)) + "".join(random.choices(string.ascii_uppercase, k=3))


# ══════════════════════ Figure renderer ══════════════════════

def render_figure(spec: dict):
    """Render a figure spec into PNG bytes via matplotlib. Returns None on failure."""
    if not spec or spec.get("kind") in (None, "", "none", "table"):
        return None
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        import numpy as np

        kind = spec.get("kind")
        fig, ax = plt.subplots(figsize=(4.6, 3.4), dpi=150)

        if kind in ("graph", "coordinate"):
            xr = spec.get("x_range") or [-10, 10]
            x = np.linspace(float(xr[0]), float(xr[1]), 400)
            ns = {"x": x, "np": np, "sin": np.sin, "cos": np.cos, "tan": np.tan,
                  "exp": np.exp, "log": np.log, "sqrt": np.sqrt, "abs": np.abs,
                  "pi": np.pi, "e": np.e}
            exprs = spec.get("expressions") or ([spec.get("expression")] if spec.get("expression") else [])
            plotted = False
            for ex in exprs[:4]:
                if not ex:
                    continue
                try:
                    y = eval(str(ex), {"__builtins__": {}}, ns)  # noqa: S307 — sandboxed namespace
                    ax.plot(x, y, linewidth=1.6, label=str(ex))
                    plotted = True
                except Exception:
                    pass
            pts = spec.get("points") or []
            for p in pts[:20]:
                try:
                    ax.plot(p[0], p[1], "ko", markersize=4)
                    if len(p) > 2:
                        ax.annotate(str(p[2]), (p[0], p[1]), textcoords="offset points", xytext=(5, 5), fontsize=8)
                    plotted = True
                except Exception:
                    pass
            if not plotted:
                raise ValueError("nothing plotted")
            ax.axhline(0, color="black", linewidth=0.8)
            ax.axvline(0, color="black", linewidth=0.8)
            ax.grid(True, linewidth=0.3, alpha=0.6)
            if len(exprs) > 1:
                ax.legend(fontsize=7)

        elif kind == "bar":
            labels = [str(v) for v in (spec.get("labels") or [])]
            values = [float(v) for v in (spec.get("values") or [])]
            if not labels or not values:
                raise ValueError("no data")
            ax.bar(labels, values, color="#5b7c99", width=0.55)
            ax.set_ylabel(spec.get("y_label", ""), fontsize=8)
            ax.set_xlabel(spec.get("x_label", ""), fontsize=8)
            ax.tick_params(labelsize=8)
            ax.grid(True, axis="y", linewidth=0.3, alpha=0.6)

        elif kind == "line":
            labels = spec.get("labels") or []
            values = [float(v) for v in (spec.get("values") or [])]
            if not values:
                raise ValueError("no data")
            xs = labels if labels and len(labels) == len(values) else list(range(1, len(values) + 1))
            ax.plot(xs, values, "o-", color="#334e68", linewidth=1.5)
            ax.set_ylabel(spec.get("y_label", ""), fontsize=8)
            ax.set_xlabel(spec.get("x_label", ""), fontsize=8)
            ax.tick_params(labelsize=8)
            ax.grid(True, linewidth=0.3, alpha=0.6)

        elif kind == "pie":
            labels = [str(v) for v in (spec.get("labels") or [])]
            values = [float(v) for v in (spec.get("values") or [])]
            if not values:
                raise ValueError("no data")
            ax.pie(values, labels=labels, autopct="%1.0f%%", textprops={"fontsize": 8})
            ax.axis("equal")

        elif kind in ("geometry", "diagram", "circuit", "map"):
            shapes = spec.get("shapes") or []
            if not shapes:
                raise ValueError("no shapes")
            for sh in shapes[:40]:
                t = sh.get("type")
                try:
                    if t == "polygon":
                        pts = sh.get("points") or []
                        xs = [p[0] for p in pts] + [pts[0][0]]
                        ys = [p[1] for p in pts] + [pts[0][1]]
                        ax.plot(xs, ys, "k-", linewidth=1.3)
                    elif t == "segment":
                        pts = sh.get("points") or []
                        ax.plot([pts[0][0], pts[1][0]], [pts[0][1], pts[1][1]],
                                sh.get("style", "k-"), linewidth=1.2)
                    elif t == "circle":
                        cc = sh.get("center") or [0, 0]
                        circ = plt.Circle((cc[0], cc[1]), float(sh.get("radius", 1)), fill=False, linewidth=1.3, color="black")
                        ax.add_patch(circ)
                    elif t == "arc":
                        from matplotlib.patches import Arc
                        cc = sh.get("center") or [0, 0]
                        th = sh.get("theta") or [0, 90]
                        r = float(sh.get("radius", 1))
                        ax.add_patch(Arc((cc[0], cc[1]), 2 * r, 2 * r, theta1=th[0], theta2=th[1], linewidth=1.1))
                    elif t == "point":
                        at = sh.get("at") or [0, 0]
                        ax.plot(at[0], at[1], "ko", markersize=3.5)
                        if sh.get("label"):
                            ax.annotate(sh["label"], (at[0], at[1]), textcoords="offset points", xytext=(6, 6), fontsize=10, fontweight="bold")
                    elif t == "text":
                        at = sh.get("at") or [0, 0]
                        ax.text(at[0], at[1], str(sh.get("label", "")), fontsize=9)
                    elif t == "rect":
                        from matplotlib.patches import Rectangle
                        at = sh.get("at") or [0, 0]
                        ax.add_patch(Rectangle((at[0], at[1]), float(sh.get("w", 1)), float(sh.get("h", 1)), fill=False, linewidth=1.2))
                        if sh.get("label"):
                            ax.text(at[0] + float(sh.get("w", 1)) / 2, at[1] + float(sh.get("h", 1)) / 2, sh["label"], fontsize=8, ha="center", va="center")
                    elif t == "arrow":
                        pts = sh.get("points") or [[0, 0], [1, 1]]
                        ax.annotate("", xy=(pts[1][0], pts[1][1]), xytext=(pts[0][0], pts[0][1]),
                                    arrowprops={"arrowstyle": "->", "linewidth": 1.1})
                except Exception:
                    continue
            ax.set_aspect("equal", adjustable="datalim")
            ax.autoscale()
            ax.margins(0.18)
            ax.axis("off")

        elif kind == "flowchart":
            nodes = spec.get("nodes") or []
            if not nodes:
                raise ValueError("no nodes")
            n = len(nodes)
            for i, label in enumerate(nodes[:8]):
                y = (n - 1 - i) * 1.4
                from matplotlib.patches import FancyBboxPatch
                txt = str(label if isinstance(label, str) else label.get("label", ""))
                ax.add_patch(FancyBboxPatch((-1.6, y - 0.4), 3.2, 0.8, boxstyle="round,pad=0.08", fill=False, linewidth=1.2))
                ax.text(0, y, txt[:38], ha="center", va="center", fontsize=8)
                if i < n - 1:
                    ax.annotate("", xy=(0, y - 1.0), xytext=(0, y - 0.42), arrowprops={"arrowstyle": "->", "linewidth": 1.1})
            ax.set_xlim(-2.2, 2.2)
            ax.set_ylim(-1, (n - 1) * 1.4 + 1)
            ax.axis("off")
        else:
            raise ValueError(f"unknown kind {kind}")

        if spec.get("title"):
            ax.set_title(str(spec["title"])[:70], fontsize=9)
        buf = io.BytesIO()
        fig.savefig(buf, format="png", bbox_inches="tight", facecolor="white")
        plt.close(fig)
        return buf.getvalue()
    except Exception:
        try:
            plt.close("all")  # noqa: F821
        except Exception:
            pass
        return None


# ══════════════════════ CBSE-style PDF renderer ══════════════════════

def render_cbse_pdf(paper: dict, params: dict) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import cm
    from reportlab.lib import colors
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY
    from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
                                    Image, KeepTogether)
    from reportlab.pdfgen import canvas as _canvas
    from xml.sax.saxutils import escape

    W, H = A4

    class NumberedCanvas(_canvas.Canvas):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self._saved = []

        def showPage(self):
            self._saved.append(dict(self.__dict__))
            self._startPage()

        def save(self):
            total = len(self._saved)
            for i, st in enumerate(self._saved):
                self.__dict__.update(st)
                self.setFont("Helvetica", 8)
                self.setFillColor(colors.HexColor("#333333"))
                self.drawCentredString(W / 2, 1.0 * cm, f"Page {i + 1} of {total}")
                self.drawString(1.5 * cm, 1.0 * cm, str(paper.get("qp_code", "")))
                if i < total - 1:
                    self.setFont("Helvetica-Bold", 8)
                    self.drawRightString(W - 1.5 * cm, 1.0 * cm, "P.T.O.")
                super().showPage()
            super().save()

    st_body = ParagraphStyle("body", fontName="Helvetica", fontSize=10, leading=15, alignment=TA_JUSTIFY)
    st_bold = ParagraphStyle("bold", parent=st_body, fontName="Helvetica-Bold")
    st_center = ParagraphStyle("center", parent=st_body, alignment=TA_CENTER)
    st_title = ParagraphStyle("title", fontName="Helvetica-Bold", fontSize=15, leading=19, alignment=TA_CENTER)
    st_small = ParagraphStyle("small", parent=st_body, fontSize=8.5, leading=11.5)
    st_instr = ParagraphStyle("instr", parent=st_body, fontName="Helvetica-Oblique", fontSize=9.5, leading=13)
    st_sec = ParagraphStyle("sec", fontName="Helvetica-Bold", fontSize=12, leading=16, alignment=TA_CENTER)
    st_opt = ParagraphStyle("opt", parent=st_body, fontSize=9.5, leading=13)

    def P(text, style=st_body):
        return Paragraph(escape(str(text)).replace("\n", "<br/>"), style)

    story = []
    content_w = W - 3 * cm

    # ── Page 1 header ──
    series = paper.get("series") or gen_series_code()
    set_no = paper.get("set_no") or params.get("set_no") or 1
    qp_code = paper.get("qp_code") or f"{random.randint(30, 99)}/{random.randint(1, 7)}/{set_no}"
    paper.setdefault("qp_code", qp_code)

    story.append(Table(
        [[P(f"Series  {series}", st_bold), P(f"SET-{set_no}", ParagraphStyle("sr", parent=st_bold, alignment=2))]],
        colWidths=[content_w / 2] * 2))
    qbox = Table([[P("Q.P. Code", st_center), ], [Paragraph(f"<b>{escape(str(qp_code))}</b>", ParagraphStyle("qc", parent=st_title, fontSize=13))]],
                 colWidths=[4.2 * cm])
    qbox.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 1, colors.black), ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                              ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
    roll_cells = [[""] * 8]
    roll = Table(roll_cells, colWidths=[0.62 * cm] * 8, rowHeights=[0.62 * cm])
    roll.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.8, colors.black)]))
    head = Table([[Table([[P("Roll No.", st_bold)], [roll], [P("Candidates must write the Q.P. Code on the title page of the answer-book.", st_small)]],
                         colWidths=[content_w - 5 * cm]),
                   qbox]], colWidths=[content_w - 4.6 * cm, 4.6 * cm])
    head.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    story.append(Spacer(1, 8))
    story.append(head)
    story.append(Spacer(1, 6))

    notes = paper.get("candidate_notes") or [
        "Please check that this question paper contains printed pages.",
        "Q.P. Code given on the right hand side of the question paper should be written on the title page of the answer-book by the candidate.",
        "Please check that this question paper contains the full number of questions.",
        "Please write down the serial number of the question in the answer-book before attempting it.",
        "15 minute time has been allotted to read this question paper. The question paper will be distributed 15 minutes prior to the commencement of the examination.",
    ]
    roman_u = ["I", "II", "III", "IV", "V", "VI"]
    note_rows = [[P("NOTE", st_bold)]] + [[P(f"({roman_u[i]}) {n}", st_small)] for i, n in enumerate(notes[:6])]
    nbox = Table(note_rows, colWidths=[content_w])
    nbox.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.9, colors.black),
                              ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                              ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]))
    story.append(nbox)
    story.append(Spacer(1, 12))

    title = paper.get("title") or params.get("subject", "").upper()
    story.append(Paragraph(escape(title.upper()), st_title))
    if params.get("academic_year"):
        story.append(Paragraph(escape(f"({params.get('board','CBSE')} Board Examination — {params['academic_year']})"),
                               ParagraphStyle("yr", parent=st_center, fontSize=9, textColor=colors.HexColor("#444444"))))
    story.append(Spacer(1, 8))
    tm = Table([[P(f"Time allowed : {paper.get('time_allowed', '3 hours')}", st_bold),
                 Paragraph(f"<b>Maximum Marks : {paper.get('max_marks', params.get('total_marks', 80))}</b>",
                           ParagraphStyle("mm", parent=st_bold, alignment=2))]],
               colWidths=[content_w / 2] * 2)
    story.append(tm)
    story.append(Spacer(1, 8))

    gi = paper.get("general_instructions") or []
    if gi:
        story.append(P("General Instructions :", st_bold))
        story.append(Spacer(1, 2))
        for i, ins in enumerate(gi):
            story.append(Paragraph(f"({_roman(i + 1)})&nbsp;&nbsp;{escape(str(ins))}", st_instr))
        story.append(Spacer(1, 10))

    # ── Sections ──
    def question_block(q, qno_label=True):
        cells = []
        cells.append(P(q.get("text", "")))
        fig_png = render_figure(q.get("figure") or {})
        if fig_png:
            img = Image(io.BytesIO(fig_png))
            iw, ih = img.imageWidth, img.imageHeight
            maxw = 8.6 * cm
            if iw > maxw:
                img.drawWidth = maxw
                img.drawHeight = ih * maxw / iw
            else:
                img.drawWidth, img.drawHeight = iw * 0.55, ih * 0.55
            img.hAlign = "CENTER"
            cells.append(Spacer(1, 4))
            cells.append(img)
            cap = (q.get("figure") or {}).get("caption")
            if cap:
                cells.append(Paragraph(escape(str(cap)), ParagraphStyle("cap", parent=st_center, fontSize=8, textColor=colors.HexColor("#555555"))))
        elif (q.get("figure") or {}).get("kind") == "table" and (q.get("figure") or {}).get("rows"):
            rows = [[P(str(cv), st_small) for cv in r] for r in q["figure"]["rows"][:12]]
            t = Table(rows, hAlign="CENTER")
            t.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.7, colors.black),
                                   ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#eeeeee")),
                                   ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6)]))
            cells.append(Spacer(1, 4))
            cells.append(t)
        opts = q.get("options") or []
        if opts:
            cells.append(Spacer(1, 3))
            orows = []
            for i in range(0, len(opts), 2):
                pair = [P(f"({chr(97 + i)}) {opts[i]}", st_opt)]
                pair.append(P(f"({chr(98 + i)}) {opts[i + 1]}", st_opt) if i + 1 < len(opts) else P("", st_opt))
                orows.append(pair)
            ot = Table(orows, colWidths=[(content_w - 1.9 * cm) / 2] * 2)
            ot.setStyle(TableStyle([("TOPPADDING", (0, 0), (-1, -1), 1.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5)]))
            cells.append(ot)
        for sq in (q.get("sub_questions") or []):
            label = sq.get("label", "") if isinstance(sq, dict) else ""
            text = sq.get("text", "") if isinstance(sq, dict) else str(sq)
            sqm = sq.get("marks") if isinstance(sq, dict) else None
            cells.append(Spacer(1, 2))
            cells.append(P(f"{label} {text}" + (f"   [{sqm}]" if sqm else ""), st_opt))
        oc = q.get("or_choice")
        if oc:
            cells.append(Spacer(1, 3))
            cells.append(Paragraph("<b>OR</b>", st_center))
            cells.append(Spacer(1, 3))
            cells.append(P(oc.get("text", "") if isinstance(oc, dict) else str(oc)))
            if isinstance(oc, dict):
                ofig = render_figure(oc.get("figure") or {})
                if ofig:
                    img = Image(io.BytesIO(ofig))
                    maxw = 8.0 * cm
                    if img.imageWidth > maxw:
                        img.drawHeight = img.imageHeight * maxw / img.imageWidth
                        img.drawWidth = maxw
                    else:
                        img.drawWidth, img.drawHeight = img.imageWidth * 0.55, img.imageHeight * 0.55
                    img.hAlign = "CENTER"
                    cells.append(img)
                for i, o in enumerate(oc.get("options") or []):
                    cells.append(P(f"({chr(97 + i)}) {o}", st_opt))
        return cells

    for sec in (paper.get("sections") or []):
        sec_flow = [Spacer(1, 8), Paragraph(escape(str(sec.get("name", "SECTION"))), st_sec)]
        if sec.get("description"):
            sec_flow.append(Paragraph(escape(str(sec["description"])) + (f"&nbsp;&nbsp;<b>{escape(str(sec.get('marks_line','')))}</b>" if sec.get("marks_line") else ""),
                                      ParagraphStyle("sd", parent=st_center, fontSize=9.5, textColor=colors.HexColor("#222222"))))
        sec_flow.append(Spacer(1, 6))
        story.append(KeepTogether(sec_flow))
        for q in (sec.get("questions") or []):
            block = question_block(q)
            row = Table([[Paragraph(f"<b>{escape(str(q.get('q_no','')))}.</b>", st_bold), block,
                          Paragraph(f"<b>{q.get('marks','')}</b>", ParagraphStyle("mk", parent=st_bold, alignment=2))]],
                        colWidths=[1.0 * cm, content_w - 1.9 * cm, 0.9 * cm])
            row.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"),
                                     ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 12)]))
            story.append(row)

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=1.5 * cm, rightMargin=1.5 * cm,
                            topMargin=1.5 * cm, bottomMargin=1.8 * cm,
                            title=str(paper.get("title", "Question Paper")))
    doc.build(story, canvasmaker=NumberedCanvas)
    return buf.getvalue()


def _roman(n: int) -> str:
    vals = [(10, "x"), (9, "ix"), (5, "v"), (4, "iv"), (1, "i")]
    out = ""
    for v, s in vals:
        while n >= v:
            out += s
            n -= v
    return out
