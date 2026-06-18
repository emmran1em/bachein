"""PDF utilities: text extraction, password protection, audit report generation."""
import io
from typing import Optional
from pypdf import PdfReader, PdfWriter
from reportlab.lib.pagesizes import LETTER
from reportlab.pdfgen import canvas
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak
from reportlab.lib.units import inch


def extract_text_from_pdf(pdf_bytes: bytes, max_chars: int = 20000) -> str:
    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
        parts = []
        total = 0
        for page in reader.pages:
            t = (page.extract_text() or "").strip()
            if not t:
                continue
            parts.append(t)
            total += len(t)
            if total >= max_chars:
                break
        return ("\n\n".join(parts))[:max_chars]
    except Exception as e:
        return f"[Error reading PDF: {e}]"


def password_protect_pdf(pdf_bytes: bytes, password: str) -> bytes:
    reader = PdfReader(io.BytesIO(pdf_bytes))
    writer = PdfWriter()
    for page in reader.pages:
        writer.add_page(page)
    writer.encrypt(user_password=password, owner_password=password, use_128bit=True)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def text_to_pdf(title: str, body: str, watermark: Optional[str] = None) -> bytes:
    """Render a simple, professional PDF from plain text body."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=LETTER, leftMargin=54, rightMargin=54, topMargin=54, bottomMargin=54)
    styles = getSampleStyleSheet()
    story = []
    story.append(Paragraph(f"<b>{_escape(title)}</b>", styles["Title"]))
    story.append(Spacer(1, 0.2 * inch))
    for para in body.split("\n\n"):
        if para.strip():
            story.append(Paragraph(_escape(para).replace("\n", "<br/>"), styles["BodyText"]))
            story.append(Spacer(1, 0.12 * inch))

    def on_page(canv: canvas.Canvas, _doc):
        if watermark:
            canv.saveState()
            canv.setFont("Helvetica", 36)
            canv.setFillGray(0.85)
            canv.translate(LETTER[0] / 2, LETTER[1] / 2)
            canv.rotate(35)
            canv.drawCentredString(0, 0, watermark)
            canv.restoreState()
        canv.setFont("Helvetica", 8)
        canv.setFillGray(0.4)
        canv.drawString(54, 30, "bachein • secure · signed · verified")

    doc.build(story, onFirstPage=on_page, onLaterPages=on_page)
    return buf.getvalue()


def audit_report_pdf(doc: dict, audit_log: list) -> bytes:
    buf = io.BytesIO()
    pdf = SimpleDocTemplate(buf, pagesize=LETTER, leftMargin=54, rightMargin=54, topMargin=54, bottomMargin=54)
    styles = getSampleStyleSheet()
    story = []
    story.append(Paragraph("<b>Bachein — Audit Report</b>", styles["Title"]))
    story.append(Spacer(1, 0.2 * inch))
    fields = [
        ("Document ID", doc.get("id", "")),
        ("Title", doc.get("title", "")),
        ("Category", doc.get("category", "")),
        ("Sender", f'{doc.get("sender_name", "")} ({doc.get("sender_email", "")})'),
        ("Recipient", doc.get("recipient_email", "—")),
        ("Created", doc.get("created_at", "")),
        ("Status", doc.get("status", "")),
        ("OTP Verified", "Yes" if doc.get("otp_verified") else "No"),
        ("Face Verified", "Yes" if doc.get("face_verified") else "No"),
        ("Voice Oath Completed", "Yes" if doc.get("voice_oath_completed") else "No"),
        ("Agreement Read %", str(doc.get("agreement_read_pct", 0))),
        ("Signed At", doc.get("signed_at") or "—"),
    ]
    for k, v in fields:
        story.append(Paragraph(f"<b>{_escape(k)}:</b> {_escape(str(v))}", styles["BodyText"]))
    story.append(Spacer(1, 0.2 * inch))
    story.append(Paragraph("<b>Audit Log</b>", styles["Heading2"]))
    for entry in audit_log:
        line = f'[{entry.get("ts", "")}] {entry.get("event", "")} — by {entry.get("by", "")}'
        story.append(Paragraph(_escape(line), styles["BodyText"]))
    pdf.build(story)
    return buf.getvalue()


def _escape(s: str) -> str:
    return (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
