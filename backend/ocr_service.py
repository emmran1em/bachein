"""Modular OCR service for Bachein.

The OCR engine sits behind this module so it can be swapped without touching
routes (current engine: vision-LLM document parsing via the Emergent LLM key —
Gemini multimodal; pluggable for PaddleOCR / other engines later).
"""
import os

OCR_ENGINE = os.environ.get("OCR_ENGINE", "vision-llm")

_SYSTEM = (
    "You are a professional document OCR and parsing engine. You transcribe documents EXACTLY. "
    "You NEVER invent, guess or 'fix' content. If a token is unclear, transcribe your best reading "
    "and wrap it in <mark>…</mark> to flag it for human verification (e.g. \u221a144 vs \u221a14 — "
    "if unsure output <mark>\u221a144</mark>). Preserve mathematical content as written."
)

_PROMPT = (
    "Transcribe ALL pages of this document into clean structured HTML:\n"
    "- Headings → <h2>/<h3>, paragraphs → <p>, lists → <ul>/<ol>, tables → <table> with <tr><td>\n"
    "- Keep the original reading order, question numbers, marks, and layout structure\n"
    "- Multi-page: separate pages with <hr data-page=\"N\"/>\n"
    "- Uncertain/unreadable tokens: wrap in <mark>…</mark> (validation layer)\n"
    "- Do NOT add commentary. Output ONLY the HTML body content."
)


async def ocr_images_to_html(page_images_b64: list, filename: str = "") -> dict:
    """Run OCR over up to 6 page images in a single multimodal call.

    Returns {html, text, warnings, engine}.
    """
    if OCR_ENGINE == "vision-llm":
        from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent
        key = os.environ.get("EMERGENT_LLM_KEY", "")
        chat = LlmChat(api_key=key, session_id=f"ocr-{filename[:20]}", system_message=_SYSTEM) \
            .with_model("gemini", "gemini-3.1-pro-preview")
        msg = UserMessage(text=_PROMPT, file_contents=[ImageContent(image_base64=b) for b in page_images_b64[:6]])
        html = await chat.send_message(msg) or ""
        html = html.strip()
        if html.startswith("```"):
            html = html.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
        import re
        text = re.sub(r"<[^>]+>", " ", html)
        text = re.sub(r"\s+", " ", text).strip()
        warnings = len(re.findall(r"<mark>", html))
        return {"html": html, "text": text, "warnings": warnings, "engine": "vision-llm (gemini)"}
    raise RuntimeError(f"Unknown OCR engine: {OCR_ENGINE}")


def pdf_to_page_images(raw: bytes, max_pages: int = 6, dpi: int = 140) -> list:
    """Render PDF pages to base64 JPEGs for the OCR engine."""
    import base64
    import fitz
    pdf = fitz.open(stream=raw, filetype="pdf")
    out = []
    for pg in list(pdf)[:max_pages]:
        pix = pg.get_pixmap(dpi=dpi)
        out.append(base64.b64encode(pix.tobytes("jpeg")).decode())
    return out
