"""Backend tests for Bachein NDA + secure-document endpoints (iteration 5).

Covers:
- POST /auth/login
- GET  /documents/voice-oath-text
- POST /documents (with sender_signature)
- POST /documents/{id}/sender-sign
- POST /documents/voice-oath (mismatch shape + 5-attempt lock)
- POST /documents/face-verify (empty + faceless)
- GET  /documents/{id}/security-artifacts (+ 403 for outsider)
- GET  /documents/{id}/status (voice_attempts + sender_signed_at)
"""
import base64
import io
import json
import os
import time
from pathlib import Path

import pytest
import requests
from PIL import Image

# --- Base URL from frontend/.env -----------------------------------------
_FRONTEND_ENV = Path("/app/frontend/.env")
if _FRONTEND_ENV.exists():
    for _line in _FRONTEND_ENV.read_text().splitlines():
        if _line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            os.environ.setdefault(
                "EXPO_PUBLIC_BACKEND_URL",
                _line.split("=", 1)[1].strip().strip('"'),
            )

BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") + "/api"

ALICE = {"email": "alice@bachein.com", "password": "Test1234!"}
BOB = {"email": "bob@bachein.com", "password": "Test1234!"}
CAROL = {"email": "carol_outsider@bachein.com", "password": "Test1234!", "name": "Carol"}


# ---------- helpers ---------------------------------------------------------
def _login(creds):
    r = requests.post(f"{BASE}/auth/login", json=creds, timeout=15)
    return r


def _login_or_signup(creds):
    r = _login({"email": creds["email"], "password": creds["password"]})
    if r.status_code == 200:
        return r.json()["token"]
    # sign up
    r = requests.post(f"{BASE}/auth/signup", json=creds, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _small_faceless_jpeg_b64() -> str:
    buf = io.BytesIO()
    Image.new("RGB", (100, 100), (255, 255, 255)).save(buf, "JPEG")
    return base64.b64encode(buf.getvalue()).decode()


# ---------- session-scoped fixtures ----------------------------------------
@pytest.fixture(scope="module")
def tokens():
    alice_t = _login_or_signup({**ALICE, "name": "Alice"})
    bob_t = _login_or_signup({**BOB, "name": "Bob"})
    carol_t = _login_or_signup(CAROL)
    return {"alice": alice_t, "bob": bob_t, "carol": carol_t}


@pytest.fixture(scope="module")
def doc_id(tokens):
    """Create a secure NDA doc from Alice -> Bob with a sender_signature."""
    sender_sig = json.dumps({"mode": "type", "text": "Alice", "ts": "2026-01-15T12:00:00Z"})
    payload = {
        "title": "TEST_NDA_v5",
        "category": "NDA",
        "mode": "secure",
        "content": "This is a TEST NDA agreement body.",
        "recipient_email": BOB["email"],
        "security_config": {
            "otp_verification": True,
            "face_verification": True,
            "voice_oath": True,
            "digital_signature": True,
        },
        "sender_signature": sender_sig,
    }
    r = requests.post(f"{BASE}/documents", headers=_auth(tokens["alice"]), json=payload, timeout=20)
    assert r.status_code == 200, f"create doc failed: {r.status_code} {r.text}"
    d = r.json()
    assert d["sender_signature"] == sender_sig, "sender_signature not stored verbatim"
    assert d["sender_signed_at"], "sender_signed_at must be populated when sig provided"
    assert d["receiver_signature"] is None
    return d["id"]


# ============== TESTS =====================================================

class TestAuth:
    def test_alice_login(self):
        r = _login(ALICE)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["token"] and j["user"]["email"] == ALICE["email"]

    def test_bob_login(self):
        r = _login(BOB)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["token"] and j["user"]["email"] == BOB["email"]


class TestVoiceOathText:
    def test_anonymous_shape(self):
        r = requests.get(f"{BASE}/documents/voice-oath-text", timeout=10)
        assert r.status_code == 200, r.text
        j = r.json()
        assert set(["text", "words", "max_attempts"]).issubset(j.keys())
        assert isinstance(j["words"], list) and len(j["words"]) > 0
        assert j["max_attempts"] == 5
        # words list preserves case of the oath text
        assert j["words"] == j["text"].split()


class TestCreateDocument:
    """POST /documents with sender_signature."""

    def test_create_with_sender_signature(self, tokens):
        sig = json.dumps({"mode": "type", "text": "Alice", "ts": "2026-06-25"})
        r = requests.post(
            f"{BASE}/documents",
            headers=_auth(tokens["alice"]),
            json={
                "title": "TEST_NDA_sender_sig_only",
                "category": "NDA",
                "mode": "secure",
                "content": "body",
                "recipient_email": BOB["email"],
                "sender_signature": sig,
            },
            timeout=20,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["sender_signature"] == sig
        assert d["sender_signed_at"] is not None
        assert d["receiver_signature"] is None
        # DocumentOut model shape
        for k in ("sender_signature", "sender_signed_at", "receiver_signature", "voice_attempts"):
            assert k in d, f"missing key {k} in DocumentOut"

    def test_create_without_sender_signature(self, tokens):
        r = requests.post(
            f"{BASE}/documents",
            headers=_auth(tokens["alice"]),
            json={
                "title": "TEST_NDA_no_sig",
                "category": "NDA",
                "mode": "secure",
                "content": "body",
                "recipient_email": BOB["email"],
            },
            timeout=20,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["sender_signature"] is None
        assert d["sender_signed_at"] is None


class TestSenderSign:
    def test_sender_can_sign(self, tokens, doc_id):
        sig = json.dumps({"mode": "type", "text": "Alice v2", "ts": "2026-01-16"})
        r = requests.post(
            f"{BASE}/documents/{doc_id}/sender-sign",
            headers=_auth(tokens["alice"]),
            json={"signature_base64": sig},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["signed"] is True
        assert j["sender_signed_at"]

    def test_receiver_cannot_sender_sign(self, tokens, doc_id):
        r = requests.post(
            f"{BASE}/documents/{doc_id}/sender-sign",
            headers=_auth(tokens["bob"]),
            json={"signature_base64": "not-allowed"},
            timeout=15,
        )
        assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"


class TestVoiceOath:
    """Verify NEW shape: 200 on mismatch, HTTP 423 after 5 attempts."""

    def test_mismatch_returns_200_with_shape(self, tokens, doc_id):
        # send tiny garbage audio - whisper 401 expected, transcript will be an error string
        garbage = base64.b64encode(b"not-audio-bytes-abc123").decode()
        r = requests.post(
            f"{BASE}/documents/voice-oath",
            headers=_auth(tokens["bob"]),
            json={"document_id": doc_id, "audio_base64": garbage},
            timeout=60,
        )
        assert r.status_code == 200, f"expected 200 on mismatch, got {r.status_code} {r.text}"
        j = r.json()
        for k in (
            "completed", "matched_words", "said_words", "required_words",
            "attempts_used", "attempts_left", "transcript", "similarity", "message",
        ):
            assert k in j, f"missing key {k} in mismatch response"
        assert j["completed"] is False
        assert isinstance(j["required_words"], list) and len(j["required_words"]) > 0
        assert j["attempts_used"] == 1
        assert j["attempts_left"] == 4

    def test_voice_attempts_persisted_in_status(self, tokens, doc_id):
        r = requests.get(
            f"{BASE}/documents/{doc_id}/status",
            headers=_auth(tokens["bob"]),
            timeout=10,
        )
        assert r.status_code == 200
        j = r.json()
        assert j["voice_attempts"] >= 1, f"voice_attempts should be persisted; got {j.get('voice_attempts')}"
        assert "sender_signed_at" in j and j["sender_signed_at"], "status should return sender_signed_at"

    def test_lock_after_5_attempts(self, tokens, doc_id):
        garbage = base64.b64encode(b"nope-nope-nope").decode()
        # We've already used 1 attempt; do 4 more to reach 5.
        last_status = None
        for i in range(4):
            r = requests.post(
                f"{BASE}/documents/voice-oath",
                headers=_auth(tokens["bob"]),
                json={"document_id": doc_id, "audio_base64": garbage},
                timeout=60,
            )
            last_status = r.status_code
            assert r.status_code == 200, f"attempt {i+2}: expected 200, got {r.status_code} {r.text}"
        # 6th attempt should hit the 5-attempt lock (423)
        r = requests.post(
            f"{BASE}/documents/voice-oath",
            headers=_auth(tokens["bob"]),
            json={"document_id": doc_id, "audio_base64": garbage},
            timeout=60,
        )
        assert r.status_code == 423, f"expected 423 lock, got {r.status_code} {r.text}"
        detail = r.json().get("detail", "")
        assert "5" in detail or "Maximum" in detail


class TestFaceVerify:
    def test_reject_too_small_selfie(self, tokens, doc_id):
        r = requests.post(
            f"{BASE}/documents/face-verify",
            headers=_auth(tokens["bob"]),
            json={"document_id": doc_id, "image_base64": "aGVsbG8="},
            timeout=15,
        )
        assert r.status_code == 400, f"expected 400 for tiny b64, got {r.status_code} {r.text}"
        detail = r.json().get("detail", "")
        assert "empty" in detail.lower() or "small" in detail.lower()

    def test_reject_no_face_detected(self, tokens, doc_id):
        b64 = _small_faceless_jpeg_b64()
        assert len(b64) >= 500, "test fixture too small — need >=500 b64 chars"
        r = requests.post(
            f"{BASE}/documents/face-verify",
            headers=_auth(tokens["bob"]),
            json={"document_id": doc_id, "image_base64": b64},
            timeout=20,
        )
        assert r.status_code == 400, f"expected 400 no-face, got {r.status_code} {r.text}"
        detail = r.json().get("detail", "")
        assert "face" in detail.lower()


class TestSecurityArtifacts:
    def test_sender_can_read(self, tokens, doc_id):
        r = requests.get(
            f"{BASE}/documents/{doc_id}/security-artifacts",
            headers=_auth(tokens["alice"]),
            timeout=15,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        for k in ("id", "security_config", "face", "voice", "otp", "signature", "audit_log"):
            assert k in j, f"missing key {k}"
        assert set(("verified", "image_b64", "distance")).issubset(j["face"].keys())
        assert set(("completed", "audio_b64", "transcript", "similarity", "attempts")).issubset(j["voice"].keys())
        # We failed voice attempts previously, so attempts should be > 0
        assert j["voice"]["attempts"] >= 1
        # audit_log non-empty and contains "created"
        events = [e.get("event") for e in j["audit_log"]]
        assert "created" in events, f"audit_log missing 'created', got: {events}"

    def test_receiver_can_read(self, tokens, doc_id):
        r = requests.get(
            f"{BASE}/documents/{doc_id}/security-artifacts",
            headers=_auth(tokens["bob"]),
            timeout=15,
        )
        assert r.status_code == 200, r.text

    def test_outsider_forbidden(self, tokens, doc_id):
        r = requests.get(
            f"{BASE}/documents/{doc_id}/security-artifacts",
            headers=_auth(tokens["carol"]),
            timeout=15,
        )
        assert r.status_code == 403, f"expected 403 outsider, got {r.status_code} {r.text}"


class TestDocStatus:
    def test_status_has_new_fields(self, tokens, doc_id):
        r = requests.get(
            f"{BASE}/documents/{doc_id}/status",
            headers=_auth(tokens["alice"]),
            timeout=10,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert "voice_attempts" in j
        assert "sender_signed_at" in j
        assert j["sender_signed_at"], "sender_signed_at should be populated after sender-sign"
