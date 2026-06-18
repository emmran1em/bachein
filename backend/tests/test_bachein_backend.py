"""Bachein backend integration tests.

Covers:
- /api/health, /api/categories
- /api/auth/* (signup, login, me)
- /api/ai/* (generate, review)
- /api/documents/* full secure send → OTP → voice → sign flow
- /api/vault
"""
import time
import uuid
import base64
import pytest
import requests

BASE = None  # set via fixture


def _url(path):
    return f"{BASE}{path}"


@pytest.fixture(scope="module", autouse=True)
def _set_base(base_url):
    global BASE
    BASE = f"{base_url}/api"


# ---------- Module: Health & Categories ----------

class TestHealth:
    def test_health(self, api_client):
        r = api_client.get(_url("/health"))
        assert r.status_code == 200
        j = r.json()
        assert j.get("status") == "ok"
        assert "time" in j

    def test_root(self, api_client):
        r = api_client.get(_url("/"))
        assert r.status_code == 200
        assert r.json().get("app") == "Bachein"

    def test_categories(self, api_client):
        r = api_client.get(_url("/categories"))
        assert r.status_code == 200
        j = r.json()
        assert isinstance(j.get("categories"), list)
        assert "NDA" in j["categories"]
        assert isinstance(j.get("normal_pdf_types"), list)
        assert "Question Paper" in j["normal_pdf_types"]


# ---------- Module: Auth ----------

ALICE = {"email": "alice@bachein.com", "password": "Test1234!", "name": "Alice"}
BOB = {"email": "bob@bachein.com", "password": "Test1234!", "name": "Bob"}


def _signup_or_login(api_client, creds):
    r = api_client.post(_url("/auth/signup"), json=creds)
    if r.status_code == 200:
        return r.json()
    # Already registered → login
    r2 = api_client.post(_url("/auth/login"), json={"email": creds["email"], "password": creds["password"]})
    assert r2.status_code == 200, f"login failed: {r2.status_code} {r2.text}"
    return r2.json()


class TestAuth:
    def test_signup_or_login_alice(self, api_client, shared_state):
        data = _signup_or_login(api_client, ALICE)
        assert "token" in data and data["token"]
        assert data["user"]["email"] == ALICE["email"]
        assert data["user"]["name"]
        assert "id" in data["user"]
        shared_state["alice_token"] = data["token"]
        shared_state["alice_user"] = data["user"]

    def test_signup_or_login_bob(self, api_client, shared_state):
        data = _signup_or_login(api_client, BOB)
        assert "token" in data
        assert data["user"]["email"] == BOB["email"]
        shared_state["bob_token"] = data["token"]
        shared_state["bob_user"] = data["user"]

    def test_login_invalid_password(self, api_client):
        r = api_client.post(_url("/auth/login"), json={"email": ALICE["email"], "password": "WrongPass!"})
        assert r.status_code == 401

    def test_login_unknown_user(self, api_client):
        r = api_client.post(_url("/auth/login"), json={"email": f"nobody-{uuid.uuid4().hex[:6]}@x.com", "password": "x"})
        assert r.status_code == 401

    def test_me_without_token(self, api_client):
        r = requests.get(_url("/auth/me"))
        assert r.status_code == 401

    def test_me_with_token(self, api_client, shared_state):
        token = shared_state["alice_token"]
        r = requests.get(_url("/auth/me"), headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        u = r.json()
        assert u["email"] == ALICE["email"]
        assert u["id"] == shared_state["alice_user"]["id"]

    def test_me_with_invalid_token(self, api_client):
        r = requests.get(_url("/auth/me"), headers={"Authorization": "Bearer not-a-jwt"})
        assert r.status_code == 401

    def test_signup_duplicate(self, api_client):
        r = api_client.post(_url("/auth/signup"), json=ALICE)
        assert r.status_code == 400


# ---------- Module: AI ----------

class TestAI:
    def test_generate_requires_auth(self, api_client):
        r = api_client.post(_url("/ai/generate"), json={"prompt": "test"})
        assert r.status_code == 401

    def test_generate_returns_structured(self, api_client, shared_state):
        token = shared_state["alice_token"]
        body = {
            "prompt": "Short NDA between Acme Inc and Beta LLC for software collaboration. Keep concise.",
            "category": "NDA",
        }
        r = requests.post(
            _url("/ai/generate"),
            json=body,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            timeout=60,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        for k in ("title", "content", "cover_page"):
            assert k in j
            assert isinstance(j[k], str)
        assert len(j["content"]) > 30
        shared_state["generated_content"] = j["content"]
        shared_state["generated_title"] = j["title"]

    def test_review_requires_auth(self, api_client):
        r = api_client.post(_url("/ai/review"), json={"document_text": "x"})
        assert r.status_code == 401

    def test_review_returns_sections(self, api_client, shared_state):
        token = shared_state["alice_token"]
        text = shared_state.get("generated_content") or (
            "This Agreement is between Party A and Party B for the exchange of information. "
            "Both parties agree to keep information confidential."
        )
        r = requests.post(
            _url("/ai/review"),
            json={"document_text": text},
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            timeout=60,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        for k in ("missing_clauses", "risks", "recommendations", "summary"):
            assert k in j
        assert isinstance(j["missing_clauses"], list)
        assert isinstance(j["risks"], list)
        assert isinstance(j["recommendations"], list)
        assert isinstance(j["summary"], str)


# ---------- Module: Documents (Full Secure Flow) ----------

class TestDocumentsFlow:
    def test_create_secure_document(self, api_client, shared_state):
        token = shared_state["alice_token"]
        payload = {
            "title": "TEST_NDA Acme x Beta",
            "category": "NDA",
            "mode": "secure",
            "content": shared_state.get("generated_content") or "Confidential NDA test body.",
            "recipient_email": BOB["email"],
            "security_config": {
                "otp_verification": True,
                "voice_oath": True,
                "digital_signature": True,
            },
        }
        r = requests.post(
            _url("/documents"),
            json=payload,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["id"]
        assert d["status"] == "sent"
        assert d["mode"] == "secure"
        assert d["recipient_email"] == BOB["email"]
        assert d["sender_email"] == ALICE["email"]
        assert d["security_config"]["otp_verification"] is True
        assert d["signature_status"] == "pending"
        assert d["delivered"] is True
        shared_state["doc_id"] = d["id"]

    def test_create_normal_draft_document(self, api_client, shared_state):
        token = shared_state["alice_token"]
        payload = {
            "title": "TEST_Notes draft",
            "category": "Normal PDF",
            "mode": "normal",
            "content": "Some notes",
            # no recipient → draft
        }
        r = requests.post(
            _url("/documents"),
            json=payload,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        )
        assert r.status_code == 200
        d = r.json()
        assert d["status"] == "draft"
        assert d["security_config"] is None  # normal mode
        shared_state["draft_doc_id"] = d["id"]

    def test_list_sent_alice(self, api_client, shared_state):
        token = shared_state["alice_token"]
        r = requests.get(_url("/documents/sent"), headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        docs = r.json()
        ids = [d["id"] for d in docs]
        assert shared_state["doc_id"] in ids

    def test_list_received_bob(self, api_client, shared_state):
        token = shared_state["bob_token"]
        r = requests.get(_url("/documents/received"), headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        docs = r.json()
        ids = [d["id"] for d in docs]
        assert shared_state["doc_id"] in ids

    def test_get_document_marks_opened(self, api_client, shared_state):
        token = shared_state["bob_token"]
        doc_id = shared_state["doc_id"]
        r = requests.get(_url(f"/documents/{doc_id}"), headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        d = r.json()
        assert d["opened"] is True

    def test_get_document_forbidden_for_3rd_party(self, api_client, shared_state):
        # Create a stranger and try to access
        stranger = {"email": f"stranger-{uuid.uuid4().hex[:6]}@bachein.com", "password": "Test1234!", "name": "Stranger"}
        data = _signup_or_login(api_client, stranger)
        token = data["token"]
        doc_id = shared_state["doc_id"]
        r = requests.get(_url(f"/documents/{doc_id}"), headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 403

    def test_sign_blocked_without_otp(self, api_client, shared_state):
        token = shared_state["bob_token"]
        sig = base64.b64encode(b"fake-signature").decode()
        r = requests.post(
            _url("/documents/sign"),
            json={"document_id": shared_state["doc_id"], "signature_base64": sig},
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        )
        assert r.status_code == 400
        assert "OTP" in r.text

    def test_send_otp(self, api_client, shared_state):
        token = shared_state["bob_token"]
        doc_id = shared_state["doc_id"]
        r = requests.post(_url(f"/documents/{doc_id}/send-otp"), headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        j = r.json()
        assert j.get("sent") is True
        assert "otp_demo" in j and len(j["otp_demo"]) == 6
        shared_state["otp"] = j["otp_demo"]

    def test_verify_otp_wrong(self, api_client, shared_state):
        token = shared_state["bob_token"]
        r = requests.post(
            _url("/documents/verify-otp"),
            json={"document_id": shared_state["doc_id"], "otp": "000000"},
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        )
        # 000000 might collide but extremely unlikely; if it does retry
        if r.status_code == 200:
            pytest.skip("OTP collision (1 in 1M)")
        assert r.status_code == 400

    def test_verify_otp_correct(self, api_client, shared_state):
        token = shared_state["bob_token"]
        r = requests.post(
            _url("/documents/verify-otp"),
            json={"document_id": shared_state["doc_id"], "otp": shared_state["otp"]},
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        )
        assert r.status_code == 200, r.text
        assert r.json().get("verified") is True

    def test_sign_blocked_without_voice(self, api_client, shared_state):
        token = shared_state["bob_token"]
        sig = base64.b64encode(b"sig").decode()
        r = requests.post(
            _url("/documents/sign"),
            json={"document_id": shared_state["doc_id"], "signature_base64": sig},
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        )
        assert r.status_code == 400
        assert "Voice" in r.text or "voice" in r.text

    def test_voice_oath(self, api_client, shared_state):
        token = shared_state["bob_token"]
        audio = base64.b64encode(b"fake-audio-bytes").decode()
        r = requests.post(
            _url("/documents/voice-oath"),
            json={"document_id": shared_state["doc_id"], "audio_base64": audio},
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        )
        assert r.status_code == 200
        assert r.json().get("completed") is True

    def test_read_progress(self, api_client, shared_state):
        token = shared_state["bob_token"]
        r = requests.post(
            _url("/documents/read-progress"),
            json={"document_id": shared_state["doc_id"], "progress": 87},
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        )
        assert r.status_code == 200
        # Verify persisted via status
        s = requests.get(
            _url(f"/documents/{shared_state['doc_id']}/status"),
            headers={"Authorization": f"Bearer {token}"},
        )
        assert s.status_code == 200
        assert s.json().get("agreement_read_pct") == 87

    def test_sign_success(self, api_client, shared_state):
        token = shared_state["bob_token"]
        sig = base64.b64encode(b"final-signature-svg-data").decode()
        r = requests.post(
            _url("/documents/sign"),
            json={"document_id": shared_state["doc_id"], "signature_base64": sig},
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("signed") is True
        assert j.get("signed_at")

    def test_status_after_sign(self, api_client, shared_state):
        token = shared_state["alice_token"]
        r = requests.get(
            _url(f"/documents/{shared_state['doc_id']}/status"),
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200
        s = r.json()
        assert s["otp_verified"] is True
        assert s["voice_oath_completed"] is True
        assert s["signature_status"] == "signed"
        assert s["protected_unlocked"] is True
        assert s["opened"] is True
        assert isinstance(s.get("audit_log"), list)
        events = [e.get("event") for e in s["audit_log"]]
        assert "created" in events
        assert "signed" in events

    def test_vault_alice_sees_signed(self, api_client, shared_state):
        token = shared_state["alice_token"]
        r = requests.get(_url("/vault"), headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        v = r.json()
        assert "sent" in v and "received" in v
        sent_ids = [d["id"] for d in v["sent"]]
        assert shared_state["doc_id"] in sent_ids

    def test_vault_bob_sees_received(self, api_client, shared_state):
        token = shared_state["bob_token"]
        r = requests.get(_url("/vault"), headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        v = r.json()
        recv_ids = [d["id"] for d in v["received"]]
        assert shared_state["doc_id"] in recv_ids

    def test_send_otp_forbidden_for_sender(self, api_client, shared_state):
        # Alice (sender) cannot self-trigger OTP for the doc; only recipient can
        token = shared_state["alice_token"]
        r = requests.post(
            _url(f"/documents/{shared_state['doc_id']}/send-otp"),
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 403

    def test_get_unknown_document(self, api_client, shared_state):
        token = shared_state["alice_token"]
        r = requests.get(_url(f"/documents/{uuid.uuid4()}"), headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 404
