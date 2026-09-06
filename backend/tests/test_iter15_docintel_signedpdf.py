"""Iter 15 regression suite:
  1) BUG FIX: GET /api/documents/{id}/signed-pdf returns 200 %PDF for UNSIGNED normal docs
  2) POST /api/aiw/ingest (text PDF) -> 200, method=pymupdf, chunks>=1
  3) POST /api/aiw/chat about ingested content -> reply references document
  4) GET /api/aiw/export/{download_id}?fmt=docx returns PK zip, ?fmt=html returns <!DOCTYPE
"""
import io
import os
import pytest
import requests

BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE}/api"

ALICE = {"email": "alice@bachein.com", "password": "Test1234!", "name": "Alice"}


def _login_or_signup(u):
    r = requests.post(f"{API}/auth/login", json={"email": u["email"], "password": u["password"]}, timeout=20)
    if r.status_code == 200:
        return r.json()["token"]
    r = requests.post(f"{API}/auth/signup", json=u, timeout=20)
    r.raise_for_status()
    return r.json()["token"]


def _auth(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def alice_token():
    return _login_or_signup(ALICE)


# --------- (1) UNSIGNED signed-pdf bug fix ---------
class TestUnsignedSignedPdf:
    def test_create_unsigned_and_get_signed_pdf_returns_valid_pdf(self, alice_token, shared):
        # Create a Normal PDF document (unsigned by default)
        payload = {
            "title": "TEST_iter15_unsigned",
            "content": "Line 1 of test unsigned doc.\nLine 2 with more text for the PDF.",
            "category": "Normal PDF",
            "mode": "secure",
            "recipient_email": "bob@bachein.com",
            "security_config": {
                "otp_verification": False, "face_verification": False,
                "voice_oath": False, "digital_signature": False
            },
        }
        r = requests.post(f"{API}/documents", headers=_auth(alice_token), json=payload, timeout=30)
        assert r.status_code in (200, 201), f"create doc failed: {r.status_code} {r.text[:300]}"
        doc = r.json()
        assert doc.get("signature_status") in (None, "pending"), f"expected unsigned, got {doc.get('signature_status')}"
        shared["unsigned_doc_id"] = doc["id"]

        # KEY BUG FIX: signed-pdf must return a valid PDF even for unsigned docs
        r2 = requests.get(f"{API}/documents/{doc['id']}/signed-pdf", headers=_auth(alice_token), timeout=30)
        assert r2.status_code == 200, f"expected 200, got {r2.status_code}: {r2.text[:300]}"
        assert r2.content[:4] == b"%PDF", f"expected PDF magic, got {r2.content[:10]!r}"
        assert len(r2.content) > 500, f"PDF too small: {len(r2.content)} bytes"


# --------- (2) & (3) Document Intelligence ingest + RAG chat ---------
def _make_text_pdf() -> bytes:
    import fitz
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    text = (
        "TEST INGEST DOCUMENT\n\n"
        "This Non-Disclosure Agreement is entered by Alice and Bob on 2026-01-15.\n"
        "Confidentiality: All information marked confidential must remain private for 5 years.\n"
        "Termination: This agreement may be terminated by either party with 30 days written notice.\n"
        "Governing Law: This agreement is governed by the laws of India.\n"
    )
    page.insert_textbox(fitz.Rect(50, 50, 545, 800), text, fontsize=12, fontname="helv", lineheight=1.5)
    return doc.tobytes()


class TestDocIntelIngestAndRag:
    def test_ingest_text_pdf_pymupdf(self, alice_token, shared):
        pdf_bytes = _make_text_pdf()
        files = {"file": ("test_iter15_nda.pdf", io.BytesIO(pdf_bytes), "application/pdf")}
        r = requests.post(f"{API}/aiw/ingest", headers=_auth(alice_token), files=files, timeout=90)
        assert r.status_code == 200, f"ingest failed: {r.status_code} {r.text[:400]}"
        body = r.json()
        assert body.get("method") == "pymupdf", f"expected method=pymupdf, got {body.get('method')}"
        assert body.get("chunks", 0) >= 1, f"expected chunks>=1, got {body.get('chunks')}"
        assert body.get("chars", 0) > 100, f"expected chars>100, got {body.get('chars')}"
        assert body.get("conversation_id"), "conversation_id missing"
        shared["ingest_conv_id"] = body["conversation_id"]

    def test_rag_chat_references_document(self, alice_token, shared):
        conv_id = shared.get("ingest_conv_id")
        assert conv_id, "no conv_id from ingest"
        # Ask about content that is uniquely in the ingested doc
        payload = {
            "message": "What is the termination notice period in my uploaded document?",
            "conversation_id": conv_id,
        }
        # First RAG call can be slow (chroma embed model download) — allow generous timeout
        r = requests.post(f"{API}/aiw/chat", headers=_auth(alice_token), json=payload, timeout=180)
        assert r.status_code == 200, f"chat failed: {r.status_code} {r.text[:400]}"
        body = r.json()
        reply = (body.get("reply") or "").lower()
        assert reply, "empty reply"
        # Answer should reference the doc content (30 days) — either exact number or 'termination' or 'according to'
        hit = any(k in reply for k in ["30 day", "thirty day", "30-day", "termination", "according to your document"])
        assert hit, f"reply does not reference ingested doc: {reply[:300]}"


# --------- (4) Droit artifact + DOCX/HTML export ---------
class TestArtifactExports:
    def test_generate_artifact_then_export_docx_and_html(self, alice_token, shared):
        payload = {"message": "Generate a two-line note titled TEST_iter15_export as a PDF."}
        r = requests.post(f"{API}/aiw/chat", headers=_auth(alice_token), json=payload, timeout=180)
        assert r.status_code == 200, f"chat failed: {r.status_code} {r.text[:400]}"
        body = r.json()
        art = body.get("artifact")
        assert art and art.get("download_id"), f"no artifact in reply: {body}"
        assert art.get("version") is not None, f"artifact missing version: {art}"
        did = art["download_id"]

        # DOCX export
        r_docx = requests.get(f"{API}/aiw/export/{did}", params={"fmt": "docx"}, headers=_auth(alice_token), timeout=30)
        assert r_docx.status_code == 200, f"docx export {r_docx.status_code} {r_docx.text[:200]}"
        assert r_docx.content[:2] == b"PK", f"expected PK zip header, got {r_docx.content[:10]!r}"
        assert len(r_docx.content) > 500

        # HTML export
        r_html = requests.get(f"{API}/aiw/export/{did}", params={"fmt": "html"}, headers=_auth(alice_token), timeout=30)
        assert r_html.status_code == 200, f"html export {r_html.status_code} {r_html.text[:200]}"
        assert r_html.text.lstrip().lower().startswith("<!doctype"), f"expected <!DOCTYPE, got {r_html.text[:80]!r}"

        # HTML export via ?token= query auth (mobile Share link path)
        r_html2 = requests.get(
            f"{API}/aiw/export/{did}", params={"fmt": "html", "token": alice_token}, timeout=30
        )
        assert r_html2.status_code == 200, f"html export via token qs {r_html2.status_code}"
        assert r_html2.text.lstrip().lower().startswith("<!doctype")
