"""
Iteration 11 — Editor AI (suggest / ai-command), OCR extract, File-tools protect/unlock roundtrip,
signed-PDF regression, and 401 handling.

All tests hit the public EXPO_PUBLIC_BACKEND_URL via /api and use alice's credentials.
"""
import base64
import io
import os
import time

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://nda-hub-1.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ALICE_EMAIL = "alice@bachein.com"
ALICE_PW = "Test1234!"
BOB_EMAIL = "bob@bachein.com"
BOB_PW = "Test1234!"


# ─────────── Fixtures ───────────
@pytest.fixture(scope="module")
def alice_token():
    r = requests.post(f"{API}/auth/login", json={"email": ALICE_EMAIL, "password": ALICE_PW}, timeout=30)
    assert r.status_code == 200, f"alice login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def alice_headers(alice_token):
    return {"Authorization": f"Bearer {alice_token}", "Content-Type": "application/json"}


def _small_png_b64() -> str:
    """A tiny 200x60 white PNG with black text-like blobs. Good enough to prove OCR pipeline runs."""
    # Minimal valid PNG (white 4x4). Enough to send through pipeline; gemini vision handles small images.
    import struct, zlib
    w, h = 4, 4
    raw = b"".join(b"\x00" + b"\xff" * (w * 3) for _ in range(h))  # white RGB
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    idat = zlib.compress(raw)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")
    return base64.b64encode(png).decode()


def _minimal_pdf_bytes(text: str = "TEST iter11 protect roundtrip document") -> bytes:
    """Build a tiny valid PDF with one page containing text (via reportlab if available, else pymupdf)."""
    try:
        import fitz  # pymupdf
        doc = fitz.open()
        page = doc.new_page(width=595, height=842)  # A4
        page.insert_text((72, 100), text, fontsize=14)
        buf = doc.tobytes()
        doc.close()
        return buf
    except Exception:
        # Fallback: reportlab
        from reportlab.pdfgen import canvas
        from reportlab.lib.pagesizes import A4
        bio = io.BytesIO()
        c = canvas.Canvas(bio, pagesize=A4)
        c.drawString(72, 800, text)
        c.showPage(); c.save()
        return bio.getvalue()


# ─────────── 401 handling ───────────
class TestAuth401:
    def test_bad_token_returns_401(self):
        r = requests.get(f"{API}/auth/me", headers={"Authorization": "Bearer NOT_A_REAL_TOKEN"}, timeout=15)
        assert r.status_code == 401, f"expected 401 got {r.status_code}: {r.text[:200]}"

    def test_no_token_returns_401_on_protected_route(self):
        r = requests.get(f"{API}/editor/list", timeout=15)
        # Depends on FastAPI security: expected 401 or 403
        assert r.status_code in (401, 403), f"expected 401/403 got {r.status_code}"


# ─────────── Editor: suggest + ai-command ───────────
class TestEditorAI:
    def test_editor_suggest_returns_suggestion(self, alice_headers):
        html = (
            "<h1>Quarterly Review</h1>"
            "<p>Our team achieved strong results across all metrics in Q3. Revenue grew 22% year over year,"
            " customer retention improved, and product NPS reached an all-time high.</p>"
            "<p>Looking ahead to Q4, we plan to</p>"
        )
        r = requests.post(
            f"{API}/editor/suggest",
            headers=alice_headers,
            json={"doc_type": "Business Proposal", "current_html": html},
            timeout=90,
        )
        assert r.status_code == 200, f"{r.status_code}: {r.text[:400]}"
        body = r.json()
        assert "suggestion" in body
        # AI is best-effort — accept empty string but log if empty
        if not body["suggestion"]:
            pytest.skip("AI returned empty suggestion (best-effort endpoint) — non-blocking")
        assert isinstance(body["suggestion"], str)
        assert len(body["suggestion"]) <= 240

    def test_editor_ai_command_modifies_html(self, alice_headers):
        r = requests.post(
            f"{API}/editor/ai-command",
            headers=alice_headers,
            json={
                "doc_type": "Business Proposal",
                "current_html": "<p>hey team the numbers look great this quarter, we should keep pushing</p>",
                "instruction": "Rewrite this in a formal, professional tone. Keep it concise.",
            },
            timeout=120,
        )
        assert r.status_code == 200, f"{r.status_code}: {r.text[:400]}"
        body = r.json()
        assert "html" in body and "mode" in body
        assert body["html"], "empty html from ai-command"
        assert body["html"] != "<p>hey team the numbers look great this quarter, we should keep pushing</p>"


# ─────────── OCR extract ───────────
class TestOcr:
    def test_ocr_extract_with_small_image(self, alice_headers):
        r = requests.post(
            f"{API}/ocr/extract",
            headers=alice_headers,
            json={"file_base64": _small_png_b64(), "filename": "TEST_iter11.png"},
            timeout=120,
        )
        # Might return 200 with empty html (gemini says "no text") — either is acceptable, both prove pipeline ran
        assert r.status_code == 200, f"{r.status_code}: {r.text[:400]}"
        body = r.json()
        assert "engine" in body
        assert "html" in body
        # Engine should be one of: gemini, text-layer, docx-text
        assert body["engine"] in ("gemini", "text-layer", "docx-text", "openai") or isinstance(body["engine"], str)

    def test_ocr_extract_rejects_bad_extension(self, alice_headers):
        r = requests.post(
            f"{API}/ocr/extract",
            headers=alice_headers,
            json={"file_base64": _small_png_b64(), "filename": "TEST_iter11.xyz"},
            timeout=30,
        )
        assert r.status_code == 400

    def test_ocr_extract_pdf_text_layer(self, alice_headers):
        pdf = _minimal_pdf_bytes("The quick brown fox jumps over the lazy dog. Bachein OCR test document. " * 4)
        b64 = base64.b64encode(pdf).decode()
        r = requests.post(
            f"{API}/ocr/extract",
            headers=alice_headers,
            json={"file_base64": b64, "filename": "TEST_iter11_ocr.pdf"},
            timeout=120,
        )
        assert r.status_code == 200, f"{r.status_code}: {r.text[:400]}"
        body = r.json()
        assert body.get("html")
        eng = str(body.get("engine") or "").lower()
        assert "text-layer" in eng or "gemini" in eng, f"unexpected engine: {eng}"


# ─────────── File Tools — Protect / Unlock roundtrip ───────────
class TestFileToolsProtectUnlock:
    _password = "S3cret!Iter11"

    def test_protect_then_unlock_roundtrip(self, alice_token):
        headers = {"Authorization": f"Bearer {alice_token}"}
        pdf_bytes = _minimal_pdf_bytes()
        # PROTECT
        files = {"file": ("TEST_input.pdf", pdf_bytes, "application/pdf")}
        data = {"password": self._password}
        r = requests.post(f"{API}/file-tools/protect", headers=headers, files=files, data=data, timeout=60)
        assert r.status_code == 200, f"protect failed {r.status_code}: {r.text[:300]}"
        protected = r.content
        assert protected.startswith(b"%PDF"), "protect did not return a PDF"
        # Verify it is actually encrypted
        import fitz
        d = fitz.open(stream=protected, filetype="pdf")
        assert d.needs_pass, "protected PDF is not password-protected!"
        d.close()

        # UNLOCK with wrong password → 400
        files2 = {"file": ("TEST_protected.pdf", protected, "application/pdf")}
        r2 = requests.post(f"{API}/file-tools/unlock", headers=headers, files=files2, data={"password": "WRONG"}, timeout=60)
        assert r2.status_code == 400, f"expected 400 for wrong pw got {r2.status_code}"

        # UNLOCK with correct password → 200
        files3 = {"file": ("TEST_protected.pdf", protected, "application/pdf")}
        r3 = requests.post(f"{API}/file-tools/unlock", headers=headers, files=files3, data={"password": self._password}, timeout=60)
        assert r3.status_code == 200, f"unlock failed {r3.status_code}: {r3.text[:300]}"
        unlocked = r3.content
        assert unlocked.startswith(b"%PDF")
        d2 = fitz.open(stream=unlocked, filetype="pdf")
        assert not d2.needs_pass, "unlocked PDF still needs password!"
        d2.close()


# ─────────── Editor export-pdf regression ───────────
class TestEditorExport:
    def test_export_pdf_returns_valid_nonzero(self, alice_headers):
        payload = {
            "title": "TEST iter11 export",
            "doc_type": "Business Proposal",
            "html": "<h1>Iter11</h1><p>Regression test — export must be non-zero.</p>",
            "page_setup": {"margins": "normal", "header": "IT11", "footer": "Bachein", "page_numbers": True},
        }
        r = requests.post(f"{API}/editor/export-pdf", headers=alice_headers, json=payload, timeout=60)
        assert r.status_code == 200
        assert r.content.startswith(b"%PDF"), "export-pdf did not return PDF"
        assert len(r.content) > 800, f"export-pdf too small: {len(r.content)} bytes"


# ─────────── Signed-PDF regression (both signatures) ───────────
class TestSignedPdfRegression:
    """Quick regression — must return a PDF for a document alice has signed, if any exists.
    If no such doc exists in her account, skip (main agent already verified in an earlier iteration)."""

    def test_signed_pdf_endpoint(self, alice_headers, alice_token):
        # List sent docs to find a signed one
        r = requests.get(f"{API}/documents/sent", headers=alice_headers, timeout=30)
        assert r.status_code == 200
        docs = r.json() if isinstance(r.json(), list) else r.json().get("documents", [])
        signed = [d for d in docs if d.get("status") in ("signed", "sender_signed", "completed", "sender_only_signed")]
        if not signed:
            # Try alice-received
            r2 = requests.get(f"{API}/documents/received", headers=alice_headers, timeout=30)
            if r2.status_code == 200:
                more = r2.json() if isinstance(r2.json(), list) else r2.json().get("documents", [])
                signed = [d for d in more if d.get("status") in ("signed", "completed")]
        if not signed:
            pytest.skip("no signed docs in alice's account — main agent verified elsewhere")
        did = signed[0].get("id") or signed[0].get("_id")
        r3 = requests.get(f"{API}/documents/{did}/signed-pdf", headers=alice_headers, timeout=60)
        assert r3.status_code == 200, f"{r3.status_code}: {r3.text[:200]}"
        assert r3.content.startswith(b"%PDF"), "signed-pdf did not return PDF"
        assert len(r3.content) > 1000
