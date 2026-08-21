"""
Iteration 14 tests — Droit AI artifact + send-by-tag, document delete permission,
downloads/import for images, viewer/explain, voice/say regression.
"""
import base64
import io
import os
import time

import pytest
import requests
from PIL import Image, ImageDraw


BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://nda-hub-1.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ALICE = {"email": "alice@bachein.com", "password": "Test1234!", "name": "Alice"}
BOB = {"email": "bob@bachein.com", "password": "Test1234!", "name": "Bob"}


def _login_or_signup(u):
    r = requests.post(f"{API}/auth/login", json={"email": u["email"], "password": u["password"]}, timeout=20)
    if r.status_code == 200:
        return r.json()["token"]
    r = requests.post(f"{API}/auth/signup", json=u, timeout=20)
    assert r.status_code in (200, 201), f"signup failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def alice_token():
    return _login_or_signup(ALICE)


@pytest.fixture(scope="module")
def bob_token():
    return _login_or_signup(BOB)


def _auth(tok):
    return {"Authorization": f"Bearer {tok}"}


# ─────────────────────────── DROIT AI ARTIFACT ───────────────────────────
class TestDroitArtifact:
    """Droit chat: <DOCUMENT> parsing -> download_id + artifact returned."""

    def test_generate_document_returns_artifact(self, alice_token, shared):
        payload = {"message": "Generate a short thank-you letter as a PDF. Just 3 short lines."}
        r = requests.post(f"{API}/aiw/chat", headers=_auth(alice_token), json=payload, timeout=120)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:400]}"
        data = r.json()
        assert "artifact" in data, f"No artifact in response. Keys={list(data.keys())} reply={data.get('reply','')[:200]}"
        art = data["artifact"]
        assert "download_id" in art and art["download_id"], f"artifact missing download_id: {art}"
        assert "name" in art and art["name"], f"artifact missing name: {art}"
        shared["download_id"] = art["download_id"]
        shared["conv_id"] = data.get("conversation_id")

    def test_download_file_returns_valid_pdf(self, alice_token, shared):
        did = shared.get("download_id")
        assert did, "test_generate_document_returns_artifact must run first"
        r = requests.get(f"{API}/downloads/{did}/file", headers=_auth(alice_token), timeout=30)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:200]}"
        assert r.content[:4] == b"%PDF", f"Not a PDF: {r.content[:20]}"
        assert len(r.content) > 500


# ─────────────────────────── DROIT SEND-BY-TAG ───────────────────────────
class TestDroitSend:
    """Droit chat: <SEND email=...> parsing -> creates document to that recipient."""

    def test_send_to_bob_via_chat(self, alice_token, bob_token, shared):
        # New conversation - generate first, then send
        gen = requests.post(
            f"{API}/aiw/chat",
            headers=_auth(alice_token),
            json={"message": "Generate a short 3-line congratulations note as a PDF titled 'TEST_iter14 Note'."},
            timeout=120,
        )
        assert gen.status_code == 200
        conv_id = gen.json().get("conversation_id")
        assert conv_id
        # Send it to bob in same conversation
        snd = requests.post(
            f"{API}/aiw/chat",
            headers=_auth(alice_token),
            json={"message": "Now send it to bob@bachein.com", "conversation_id": conv_id},
            timeout=120,
        )
        assert snd.status_code == 200, f"{snd.status_code}: {snd.text[:400]}"
        data = snd.json()
        # sent_to field should be present if LLM emitted the <SEND> tag
        assert data.get("sent_to") == "bob@bachein.com", (
            f"sent_to missing/wrong. reply='{data.get('reply','')[:300]}' data_keys={list(data.keys())}"
        )
        shared["sent_title"] = data.get("artifact", {}).get("name") or "Document from Droit"

    def test_bob_received_the_document(self, bob_token, shared):
        # Give backend a moment
        time.sleep(1)
        r = requests.get(f"{API}/documents/received", headers=_auth(bob_token), timeout=20)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:200]}"
        body = r.json()
        items = body if isinstance(body, list) else body.get("items", [])
        assert isinstance(items, list), f"Received not a list: {type(items)}"
        # Look for a recent doc from alice
        alice_docs = [d for d in items if (d.get("sender_email") or "").lower() == "alice@bachein.com"]
        assert alice_docs, f"No documents from alice in bob's received list ({len(items)} items)"


# ─────────────────────────── DELETE DOCUMENT ───────────────────────────
class TestDeleteDocument:
    """DELETE /api/documents/{id} — sender=200, non-sender=403."""

    @pytest.fixture(scope="class")
    def created_doc(self, alice_token):
        payload = {
            "title": "TEST_iter14 delete me",
            "recipient_email": "bob@bachein.com",
            "content": "Test content for delete",
            "category": "Normal PDF",
            "mode": "secure",
            "security_config": {
                "otp_verification": False,
                "face_verification": False,
                "voice_oath": False,
                "digital_signature": False,
            },
            "attached_files": [],
        }
        r = requests.post(f"{API}/documents", headers=_auth(alice_token), json=payload, timeout=20)
        assert r.status_code in (200, 201), f"create failed: {r.status_code} {r.text[:200]}"
        return r.json()

    def test_non_sender_gets_403(self, bob_token, created_doc):
        did = created_doc["id"]
        r = requests.delete(f"{API}/documents/{did}", headers=_auth(bob_token), timeout=15)
        assert r.status_code == 403, f"Expected 403, got {r.status_code}: {r.text[:200]}"

    def test_sender_can_delete(self, alice_token, created_doc):
        did = created_doc["id"]
        r = requests.delete(f"{API}/documents/{did}", headers=_auth(alice_token), timeout=15)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:200]}"
        assert r.json().get("deleted") is True
        # Verify gone
        g = requests.get(f"{API}/documents/{did}", headers=_auth(alice_token), timeout=15)
        assert g.status_code == 404


# ─────────────────────────── DOWNLOADS IMPORT ───────────────────────────
class TestDownloadsImport:
    def test_import_image_becomes_pdf(self, alice_token):
        # Build a tiny in-memory PNG
        img = Image.new("RGB", (100, 60), "white")
        d = ImageDraw.Draw(img)
        d.text((10, 20), "TEST", fill="black")
        buf = io.BytesIO()
        img.save(buf, "PNG")
        b64 = base64.b64encode(buf.getvalue()).decode()

        r = requests.post(
            f"{API}/downloads/import",
            headers=_auth(alice_token),
            json={"name": "TEST_iter14_import.png", "file_base64": b64, "mime": "image/png"},
            timeout=30,
        )
        assert r.status_code == 200, f"{r.status_code}: {r.text[:200]}"
        j = r.json()
        assert j.get("download_id"), f"no download_id: {j}"
        assert j.get("size", 0) > 100
        # Fetch to confirm it's a PDF
        g = requests.get(f"{API}/downloads/{j['download_id']}/file", headers=_auth(alice_token), timeout=20)
        assert g.status_code == 200
        assert g.content[:4] == b"%PDF"


# ─────────────────────────── VIEWER EXPLAIN ───────────────────────────
class TestViewerExplain:
    def test_explain_labeled_bbox(self, alice_token):
        # Render "HELLO" on a white 400x200 image; bbox around the word (normalized)
        img = Image.new("RGB", (400, 200), "white")
        d = ImageDraw.Draw(img)
        d.text((60, 80), "HELLO", fill="black")
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=90)
        b64 = base64.b64encode(buf.getvalue()).decode()
        payload = {"image_base64": b64, "bbox": [0.1, 0.3, 0.6, 0.7]}
        r = requests.post(f"{API}/viewer/explain", headers=_auth(alice_token), json=payload, timeout=90)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
        j = r.json()
        assert j.get("explanation"), f"no explanation: {j}"
        assert len(j["explanation"]) > 10


# ─────────────────────────── VOICE SAY REGRESSION ───────────────────────────
class TestVoiceSay:
    def test_voice_say_returns_audio(self, alice_token):
        r = requests.post(
            f"{API}/aiw/voice/say",
            headers=_auth(alice_token),
            json={"text": "Hello from Bachein."},
            timeout=60,
        )
        assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
        j = r.json()
        assert j.get("audio_base64"), f"no audio_base64: keys={list(j.keys())}"
        assert len(j["audio_base64"]) > 100
