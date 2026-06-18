"""V3 tests: Google OAuth, Face enroll/status, real face match, real voice transcript, mandatory recipient_email, File Kit tools."""
import io
import os
import base64
import uuid
import pytest
import requests
import numpy as np
import cv2
from PIL import Image, ImageDraw
from docx import Document as DocxDocument
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.lib.pagesizes import LETTER

BASE = None
ALICE = {"email": "alice@bachein.com", "password": "Test1234!", "name": "Alice"}


def _url(p): return f"{BASE}{p}"
def _auth(t): return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


@pytest.fixture(scope="module", autouse=True)
def _set_base(base_url):
    global BASE
    BASE = f"{base_url}/api"


@pytest.fixture(scope="module")
def alice_token(api_client):
    r = api_client.post(_url("/auth/signup"), json=ALICE)
    if r.status_code != 200:
        r = api_client.post(_url("/auth/login"), json={"email": ALICE["email"], "password": ALICE["password"]})
    assert r.status_code == 200, r.text
    return r.json()["token"]


# ---------- helpers to build real face / non-face images ----------

_REAL_FACE_CACHE = {"b64": None}

def _make_face_image_b64() -> str:
    """Fetch a real human face from thispersondoesnotexist.com (StyleGAN). Cached per session."""
    if _REAL_FACE_CACHE["b64"]:
        return _REAL_FACE_CACHE["b64"]
    import urllib.request, ssl
    ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
    try:
        req = urllib.request.Request("https://thispersondoesnotexist.com/",
                                     headers={"User-Agent": "Mozilla/5.0"})
        data = urllib.request.urlopen(req, context=ctx, timeout=15).read()
        # Re-encode smaller to keep payload under 500k for storage
        img = Image.open(io.BytesIO(data)).convert("RGB")
        img.thumbnail((512, 512))
        out = io.BytesIO(); img.save(out, format="JPEG", quality=85)
        b64 = base64.b64encode(out.getvalue()).decode()
        _REAL_FACE_CACHE["b64"] = b64
        return b64
    except Exception:
        # Fallback: blank (will fail face detection — test will skip)
        return _make_blank_b64()


def _verify_face_detectable(b64: str) -> bool:
    """Sanity-check the image actually has a face via Haar locally."""
    raw = base64.b64decode(b64)
    arr = np.array(Image.open(io.BytesIO(raw)).convert("RGB"))
    bgr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
    cas = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    faces = cas.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=4, minSize=(60, 60))
    return len(faces) > 0


def _make_blank_b64() -> str:
    img = Image.new("RGB", (200, 200), "white")
    buf = io.BytesIO(); img.save(buf, format="JPEG")
    return base64.b64encode(buf.getvalue()).decode()


def _make_docx_bytes(text="Hello Bachein DOCX. This is a test document for conversion.") -> bytes:
    d = DocxDocument()
    d.add_paragraph(text)
    bio = io.BytesIO(); d.save(bio); return bio.getvalue()


def _make_pdf_bytes(text="Hello Bachein PDF test") -> bytes:
    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=LETTER); c.drawString(72, 720, text); c.showPage(); c.save()
    return buf.getvalue()


def _make_jpeg_bytes(w=1200, h=900) -> bytes:
    """Big-ish JPEG so compress test sees a size reduction."""
    arr = np.random.randint(0, 255, (h, w, 3), dtype=np.uint8)
    # Add structured pattern so jpeg compresses well
    arr[::5, :, 0] = 200
    img = Image.fromarray(arr)
    bio = io.BytesIO(); img.save(bio, format="JPEG", quality=95); return bio.getvalue()


# ============ Google OAuth ============

class TestGoogleAuth:
    def test_invalid_session_returns_401(self, api_client):
        r = api_client.post(_url("/auth/google/session"), json={"session_id": "totally-invalid-session-xyz-" + uuid.uuid4().hex})
        assert r.status_code == 401, r.text


# ============ Face Enroll / Status ============

class TestFaceEnroll:
    def test_face_status_initially_false_or_true(self, alice_token):
        r = requests.get(_url("/auth/face/status"), headers={"Authorization": f"Bearer {alice_token}"})
        assert r.status_code == 200, r.text
        assert "enrolled" in r.json()

    def test_enroll_rejects_no_face(self, alice_token):
        b64 = _make_blank_b64()
        r = requests.post(_url("/auth/face/enroll"), json={"image_base64": b64}, headers=_auth(alice_token))
        assert r.status_code == 400, r.text
        assert "face" in r.text.lower()

    def test_enroll_accepts_face_and_status_becomes_true(self, alice_token):
        b64 = _make_face_image_b64()
        if not _verify_face_detectable(b64):
            pytest.skip("Synthetic face not detectable by Haar — environmental")
        r = requests.post(_url("/auth/face/enroll"), json={"image_base64": b64}, headers=_auth(alice_token))
        assert r.status_code == 200, r.text
        assert r.json().get("enrolled") is True
        # status now true
        s = requests.get(_url("/auth/face/status"), headers={"Authorization": f"Bearer {alice_token}"})
        assert s.status_code == 200
        assert s.json()["enrolled"] is True


# ============ Mandatory recipient_email ============

class TestSecureRecipientRequired:
    def test_secure_without_recipient_returns_400(self, alice_token):
        payload = {"title": "TEST_no_recipient", "category": "NDA", "mode": "secure", "content": "x"}
        r = requests.post(_url("/documents"), json=payload, headers=_auth(alice_token))
        assert r.status_code == 400, r.text
        assert "ecipient" in r.text  # "Recipient email is required"

    def test_normal_without_recipient_ok(self, alice_token):
        payload = {"title": "TEST_normal_no_recipient", "category": "NDA", "mode": "normal", "content": "x"}
        r = requests.post(_url("/documents"), json=payload, headers=_auth(alice_token))
        assert r.status_code == 200, r.text

    def test_secure_with_recipient_ok(self, alice_token):
        payload = {"title": "TEST_secure_with_recipient", "category": "NDA", "mode": "secure",
                   "content": "x", "recipient_email": "bob@bachein.com"}
        r = requests.post(_url("/documents"), json=payload, headers=_auth(alice_token))
        assert r.status_code == 200, r.text


# ============ Real face-verify (auto-enroll + reject no-face) ============

class TestFaceVerifyReal:
    def _make_doc(self, token):
        payload = {"title": "TEST_face_verify_real", "category": "NDA", "mode": "secure",
                   "content": "x", "recipient_email": ALICE["email"],
                   "security_config": {"face_verification": True, "otp_verification": False, "voice_oath": False}}
        # alice is the recipient too — but server forbids sender==recipient_email if equal. We need bob.
        return None

    def test_face_verify_rejects_no_face(self, alice_token):
        # Use a doc where alice is recipient — create a separate sender
        sender = api_client_signup("sender-fv-" + uuid.uuid4().hex[:6] + "@bachein.com")
        payload = {"title": "TEST_fv_noface", "category": "NDA", "mode": "secure",
                   "content": "x", "recipient_email": ALICE["email"],
                   "security_config": {"face_verification": True, "otp_verification": False, "voice_oath": False}}
        r = requests.post(_url("/documents"), json=payload, headers=_auth(sender))
        assert r.status_code == 200, r.text
        doc_id = r.json()["id"]
        # alice (recipient) attempts face-verify with blank
        fv = requests.post(_url("/documents/face-verify"),
                           json={"document_id": doc_id, "image_base64": _make_blank_b64()},
                           headers=_auth(alice_token))
        assert fv.status_code == 400, fv.text
        assert "face" in fv.text.lower()

    def test_face_verify_with_real_face(self, alice_token):
        b64 = _make_face_image_b64()
        if not _verify_face_detectable(b64):
            pytest.skip("Synthetic face not Haar-detectable")
        sender = api_client_signup("sender-fv2-" + uuid.uuid4().hex[:6] + "@bachein.com")
        payload = {"title": "TEST_fv_face", "category": "NDA", "mode": "secure",
                   "content": "x", "recipient_email": ALICE["email"],
                   "security_config": {"face_verification": True, "otp_verification": False, "voice_oath": False}}
        r = requests.post(_url("/documents"), json=payload, headers=_auth(sender))
        doc_id = r.json()["id"]
        fv = requests.post(_url("/documents/face-verify"),
                           json={"document_id": doc_id, "image_base64": b64},
                           headers=_auth(alice_token))
        assert fv.status_code == 200, fv.text
        j = fv.json()
        assert j["verified"] is True
        assert "distance" in j


def api_client_signup(email: str) -> str:
    s = requests.Session(); s.headers.update({"Content-Type": "application/json"})
    r = s.post(_url("/auth/signup"), json={"email": email, "password": "Test1234!", "name": "Sender"})
    if r.status_code != 200:
        r = s.post(_url("/auth/login"), json={"email": email, "password": "Test1234!"})
    return r.json()["token"]


# ============ Real voice oath ============

class TestVoiceOathReal:
    def test_voice_oath_garbage_audio_rejected(self, alice_token):
        sender = api_client_signup("sender-vo-" + uuid.uuid4().hex[:6] + "@bachein.com")
        payload = {"title": "TEST_voice", "category": "NDA", "mode": "secure",
                   "content": "x", "recipient_email": ALICE["email"],
                   "security_config": {"voice_oath": True, "otp_verification": False, "face_verification": False}}
        r = requests.post(_url("/documents"), json=payload, headers=_auth(sender))
        doc_id = r.json()["id"]
        # Garbage 'audio' — should NOT match required oath
        bogus = base64.b64encode(b"\x00" * 64).decode()
        vo = requests.post(_url("/documents/voice-oath"),
                           json={"document_id": doc_id, "audio_base64": bogus},
                           headers=_auth(alice_token), timeout=90)
        # Should be 400 with structured error including similarity, NOT a 500
        assert vo.status_code == 400, f"Expected 400 got {vo.status_code}: {vo.text}"
        assert "similarity" in vo.text.lower() or "match" in vo.text.lower() or "transcription" in vo.text.lower()


# ============ File Tools ============

class TestFileToolsFormats:
    def test_formats_returns_lists(self, alice_token):
        r = requests.get(_url("/file-tools/formats"), headers={"Authorization": f"Bearer {alice_token}"})
        # This endpoint may not require auth — try both
        if r.status_code == 401:
            r = requests.get(_url("/file-tools/formats"))
        assert r.status_code == 200, r.text
        j = r.json()
        assert "inputs" in j and "outputs" in j
        assert "pdf" in j["inputs"] and "docx" in j["inputs"]
        assert "pdf" in j["outputs"]


class TestCompressImage:
    def test_compress_image_returns_jpeg_and_smaller(self, alice_token):
        jpeg = _make_jpeg_bytes()
        files = {"file": ("big.jpg", jpeg, "image/jpeg")}
        data = {"quality": "40"}
        r = requests.post(_url("/file-tools/compress-image"), files=files, data=data,
                          headers={"Authorization": f"Bearer {alice_token}"}, timeout=60)
        assert r.status_code == 200, r.text
        assert r.headers.get("content-type", "").startswith("image/jpeg")
        assert "X-Original-Size" in r.headers or "x-original-size" in {k.lower() for k in r.headers}
        orig = int(r.headers.get("X-Original-Size") or r.headers.get("x-original-size") or "0")
        comp = int(r.headers.get("X-Compressed-Size") or r.headers.get("x-compressed-size") or "0")
        assert orig == len(jpeg)
        assert comp > 0
        assert comp < orig, f"Compressed ({comp}) not smaller than original ({orig})"
        assert len(r.content) == comp


class TestCompressPDF:
    def test_compress_pdf_returns_pdf(self, alice_token):
        pdf = _make_pdf_bytes("Some content " * 200)
        files = {"file": ("big.pdf", pdf, "application/pdf")}
        r = requests.post(_url("/file-tools/compress-pdf"), files=files,
                          headers={"Authorization": f"Bearer {alice_token}"}, timeout=60)
        assert r.status_code == 200, r.text
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert r.content[:4] == b"%PDF"


class TestConvert:
    def test_docx_to_pdf(self, alice_token):
        docx = _make_docx_bytes("Convert me to PDF please. Bachein test content.")
        files = {"file": ("source.docx", docx,
                          "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}
        r = requests.post(_url("/file-tools/convert"), files=files, data={"target": "pdf"},
                          headers={"Authorization": f"Bearer {alice_token}"}, timeout=90)
        assert r.status_code == 200, r.text
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert r.content[:4] == b"%PDF"
        assert (r.headers.get("X-Detected-Format") or r.headers.get("x-detected-format")) == "docx"

    def test_txt_to_pdf(self, alice_token):
        files = {"file": ("note.txt", b"hello world from bachein", "text/plain")}
        r = requests.post(_url("/file-tools/convert"), files=files, data={"target": "pdf"},
                          headers={"Authorization": f"Bearer {alice_token}"}, timeout=60)
        assert r.status_code == 200, r.text
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert r.content[:4] == b"%PDF"

    def test_image_to_pdf(self, alice_token):
        jpeg = _make_jpeg_bytes(300, 200)
        files = {"file": ("pic.jpg", jpeg, "image/jpeg")}
        r = requests.post(_url("/file-tools/convert"), files=files, data={"target": "pdf"},
                          headers={"Authorization": f"Bearer {alice_token}"}, timeout=60)
        assert r.status_code == 200, r.text
        assert r.content[:4] == b"%PDF"
        assert (r.headers.get("X-Detected-Format") or r.headers.get("x-detected-format")) == "jpg"

    def test_pdf_to_docx_uses_pdf2docx(self, alice_token):
        pdf = _make_pdf_bytes("PDF to DOCX conversion test using pdf2docx layout converter.")
        files = {"file": ("source.pdf", pdf, "application/pdf")}
        r = requests.post(_url("/file-tools/convert"), files=files, data={"target": "docx"},
                          headers={"Authorization": f"Bearer {alice_token}"}, timeout=120)
        assert r.status_code == 200, r.text
        ct = r.headers.get("content-type", "")
        assert "wordprocessingml" in ct or "officedocument" in ct, ct
        # docx is a zip — verify PK header
        assert r.content[:2] == b"PK"
