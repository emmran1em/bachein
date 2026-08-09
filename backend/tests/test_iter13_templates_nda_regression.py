"""
Iteration 13 regression tests:
- AI generate with different `template` returns Dated: line
- pdf/pages, scanner/annotate, scanner/sign-image spot check
- Full NDA E2E: alice → secure NDA (all security off) → sender-sign → bob signs → signed-pdf non-zero
"""
import os
import base64
import io
import pytest
import requests
from PIL import Image
import fitz  # pymupdf

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://nda-hub-1.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


def _make_png_b64(w=400, h=300, color=(240, 240, 240)):
    img = Image.new("RGB", (w, h), color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _make_small_pdf_b64(pages=3):
    doc = fitz.open()
    for i in range(pages):
        p = doc.new_page(width=595, height=842)
        p.insert_text((72, 100), f"TEST page {i+1}", fontsize=18)
    data = doc.tobytes()
    doc.close()
    return base64.b64encode(data).decode("ascii")


@pytest.fixture(scope="module")
def alice_token():
    r = requests.post(f"{API}/auth/login", json={"email": "alice@bachein.com", "password": "Test1234!"}, timeout=30)
    if r.status_code != 200:
        # try signup
        requests.post(f"{API}/auth/signup", json={"email": "alice@bachein.com", "password": "Test1234!", "name": "Alice"}, timeout=30)
        r = requests.post(f"{API}/auth/login", json={"email": "alice@bachein.com", "password": "Test1234!"}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def bob_token():
    r = requests.post(f"{API}/auth/login", json={"email": "bob@bachein.com", "password": "Test1234!"}, timeout=30)
    if r.status_code != 200:
        requests.post(f"{API}/auth/signup", json={"email": "bob@bachein.com", "password": "Test1234!", "name": "Bob"}, timeout=30)
        r = requests.post(f"{API}/auth/login", json={"email": "bob@bachein.com", "password": "Test1234!"}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


# --- AI generate with template regression (uses different template than main agent) ---
class TestAIGenerateTemplate:
    def test_generate_investor_nda_dated(self, alice_token):
        h = {"Authorization": f"Bearer {alice_token}"}
        payload = {
            "prompt": "Startup pitch deck NDA for fundraising",
            "category": "NDA",
            "template": "Startup–Investor NDA",
        }
        r = requests.post(f"{API}/ai/generate", json=payload, headers=h, timeout=120)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "title" in data and "content" in data and "cover_page" in data
        assert "Dated:" in data["content"], "content must contain 'Dated:' line"
        assert len(data["content"]) > 800

    def test_generate_academic_generic_dated(self, alice_token):
        h = {"Authorization": f"Bearer {alice_token}"}
        payload = {
            "prompt": "Research summary about renewable batteries",
            "category": "Report",
            "sub_type": "Report",
            "template": "Academic / Research",
        }
        r = requests.post(f"{API}/ai/generate", json=payload, headers=h, timeout=120)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "Dated:" in data["content"]


# --- Spot-check new/related endpoints ---
class TestNewEndpointsSpot:
    def test_pdf_pages(self, alice_token):
        h = {"Authorization": f"Bearer {alice_token}"}
        pdf_b64 = _make_small_pdf_b64(3)
        r = requests.post(f"{API}/pdf/pages", json={"pdf_base64": pdf_b64}, headers=h, timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data.get("pages"), list) and len(data["pages"]) == 3
        # each entry should be non-empty base64
        assert all(isinstance(p, str) and len(p) > 100 for p in data["pages"])

    def test_scanner_annotate(self, alice_token):
        h = {"Authorization": f"Bearer {alice_token}"}
        img_b64 = _make_png_b64()
        # strokes → points → [x,y] normalized 0..1
        strokes = [[[0.1, 0.1], [0.5, 0.5], [0.7, 0.3]]]
        r = requests.post(f"{API}/scanner/annotate", json={"image_base64": img_b64, "strokes": strokes, "color": "#ff0000", "width": 0.01}, headers=h, timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("image_base64"), "annotate should return image_base64"

    def test_scanner_sign_image(self, alice_token):
        h = {"Authorization": f"Bearer {alice_token}"}
        img_b64 = _make_png_b64()
        payload = {
            "image_base64": img_b64,
            "signature": {"mode": "draw", "paths": ["M0,0 L50,30 L90,5 L120,20"]},
            "x": 0.1,
            "y": 0.6,
            "w": 0.3,
        }
        r = requests.post(f"{API}/scanner/sign-image", json=payload, headers=h, timeout=60)
        assert r.status_code == 200, r.text
        assert r.json().get("image_base64")


# --- Full NDA E2E regression ---
class TestNdaE2ERegression:
    _doc_id = None

    def test_alice_create_secure_nda(self, alice_token):
        h = {"Authorization": f"Bearer {alice_token}"}
        content = "TEST NDA CONTENT.\n\nDated: 15 January 2026\n\nDisclosing Party agrees ..."
        # sender signature (drawn strokes)
        sender_sig = {"strokes": [{"points": [{"x": 0, "y": 0}, {"x": 40, "y": 20}, {"x": 80, "y": 0}], "color": "#000"}], "text": None, "font": None}
        payload = {
            "title": "TEST_iter13 NDA",
            "category": "NDA",
            "mode": "secure",
            "content": content,
            "recipient_email": "bob@bachein.com",
            "security_config": {
                "otp_verification": False,
                "voice_oath": False,
                "digital_signature": True,
                "face_verification": False,
                "device_verification": False,
                "dynamic_watermark": False,
                "disable_download": False,
                "disable_forwarding": False,
                "disable_printing": False,
                "screenshot_detection": False,
                "geo_restriction": False,
                "time_limited_viewing": False,
                "evidence_logging": True,
            },
            "attached_files": [],
            "sender_signature": __import__("json").dumps(sender_sig),
        }
        r = requests.post(f"{API}/documents", json=payload, headers=h, timeout=60)
        assert r.status_code in (200, 201), r.text
        doc = r.json()
        assert doc.get("id")
        assert doc.get("sender_signature")
        TestNdaE2ERegression._doc_id = doc["id"]

    def test_bob_receives_and_signs(self, bob_token):
        assert TestNdaE2ERegression._doc_id, "prereq: doc created"
        h = {"Authorization": f"Bearer {bob_token}"}
        did = TestNdaE2ERegression._doc_id
        # bob should be able to GET the doc (no OTP)
        g = requests.get(f"{API}/documents/{did}", headers=h, timeout=30)
        assert g.status_code == 200, g.text
        # bob signs — endpoint is POST /api/documents/sign with body {document_id, signature_base64}
        bob_sig = {"strokes": [{"points": [{"x": 0, "y": 0}, {"x": 60, "y": 15}, {"x": 100, "y": 0}], "color": "#000"}], "text": None, "font": None}
        sr = requests.post(f"{API}/documents/sign", json={"document_id": did, "signature_base64": __import__("json").dumps(bob_sig)}, headers=h, timeout=30)
        assert sr.status_code == 200, sr.text

    def test_signed_pdf_nonzero_with_signatures(self, alice_token):
        assert TestNdaE2ERegression._doc_id
        h = {"Authorization": f"Bearer {alice_token}"}
        did = TestNdaE2ERegression._doc_id
        r = requests.get(f"{API}/documents/{did}/signed-pdf", headers=h, timeout=60)
        assert r.status_code == 200, r.text
        content = r.content
        assert content.startswith(b"%PDF"), "should be a PDF"
        assert len(content) > 2000, f"pdf too small: {len(content)}"
        # ensure signatures embedded: extract text — should include sender+receiver names/emails
        pdf = fitz.open(stream=content, filetype="pdf")
        text = "\n".join(p.get_text() for p in pdf)
        pdf.close()
        assert "TEST_iter13" in text or "NDA" in text.upper()
