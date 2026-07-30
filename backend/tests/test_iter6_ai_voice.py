"""
Iteration 6 — verify:
  - GET /api/aiw/providers returns exactly 4 providers (gemini, openai, anthropic, grok)
  - GET /api/documents/voice-oath-azure-token returns { token, region } with non-empty values
  - POST /api/documents/voice-oath transcribes uploaded webm audio via Azure Speech
    and returns a valid transcript + matched_words with >=70% match
  - After 5 failed voice-oath attempts a 6th call returns HTTP 423
"""
import base64
import os
import subprocess
import tempfile
import time
import pytest
import requests

from conftest import BASE_URL  # noqa

ALICE = {"email": "alice@bachein.com", "password": "Test1234!"}
BOB = {"email": "bob@bachein.com", "password": "Test1234!"}
OATH = "I acknowledge this information is confidential and agree not to disclose it"

_state = {}


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login {email} -> {r.status_code} {r.text[:200]}"
    return r.json()["token"]


def _auth(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


def _make_oath_audio_b64():
    """Generate espeak-ng speech and encode to opus/webm base64."""
    wav = tempfile.NamedTemporaryFile(suffix=".wav", delete=False).name
    webm = tempfile.NamedTemporaryFile(suffix=".webm", delete=False).name
    subprocess.run(["espeak-ng", OATH, "-w", wav], check=True, capture_output=True)
    subprocess.run(["ffmpeg", "-y", "-i", wav, "-c:a", "libopus", webm],
                   check=True, capture_output=True)
    with open(webm, "rb") as f:
        data = f.read()
    return base64.b64encode(data).decode()


# ==================== ai providers ====================
def test_ai_providers_returns_exactly_4():
    tok = _login(**ALICE)
    r = requests.get(f"{BASE_URL}/api/aiw/providers", headers=_auth(tok), timeout=20)
    assert r.status_code == 200, r.text
    data = r.json()
    ids = sorted([p["id"] for p in data["providers"]])
    assert ids == ["anthropic", "gemini", "grok", "openai"], f"Got {ids}"
    # No DeepSeek / Perplexity / Mistral leaks
    for banned in ("deepseek", "perplexity", "mistral"):
        assert banned not in ids


# ==================== azure token ====================
def test_azure_token_endpoint():
    tok = _login(**ALICE)
    r = requests.get(f"{BASE_URL}/api/documents/voice-oath-azure-token",
                     headers=_auth(tok), timeout=20)
    assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
    body = r.json()
    assert "token" in body and body["token"], "Empty token"
    assert "region" in body and body["region"], "Empty region"
    _state["azure_ok"] = True


# ==================== voice-oath happy path ====================
def _ensure_receive_doc():
    """Return (bob_token, document_id) for a secure NDA doc addressed to Bob."""
    if "doc_id" in _state and "bob_tok" in _state:
        return _state["bob_tok"], _state["doc_id"]
    alice_tok = _login(**ALICE)
    bob_tok = _login(**BOB)
    # Create a fresh NDA doc from Alice -> bob@bachein.com with voice oath required
    payload = {
        "title": "TEST_iter6_voice_oath_doc",
        "content": "Trade secret handoff for iter6 test.",
        "category": "NDA",
        "mode": "secure",
        "recipient_email": BOB["email"],
        "expires_hours": 48,
        "requires_voice_oath": True,
        "requires_face_verification": False,
        "sender_signature": "Alice sender signature",
    }
    r = requests.post(f"{BASE_URL}/api/documents", headers=_auth(alice_tok), json=payload, timeout=30)
    assert r.status_code in (200, 201), f"create doc {r.status_code} {r.text[:300]}"
    doc = r.json()
    doc_id = doc.get("id") or doc.get("document_id")
    assert doc_id, f"no id in {doc}"
    # Bob issues OTP + verifies (simulate) — but voice-oath endpoint may need doc unlocked.
    # Try to send OTP.
    r2 = requests.post(f"{BASE_URL}/api/documents/{doc_id}/send-otp", headers=_auth(bob_tok), timeout=20)
    if r2.status_code == 200:
        otp = r2.json().get("otp_demo") or r2.json().get("otp")
        if otp:
            requests.post(f"{BASE_URL}/api/documents/{doc_id}/verify-otp",
                          headers=_auth(bob_tok), json={"otp": otp}, timeout=20)
    _state["bob_tok"] = bob_tok
    _state["doc_id"] = doc_id
    return bob_tok, doc_id


def test_voice_oath_transcribes_and_matches():
    bob_tok, doc_id = _ensure_receive_doc()
    audio_b64 = _make_oath_audio_b64()
    r = requests.post(
        f"{BASE_URL}/api/documents/voice-oath",
        headers=_auth(bob_tok),
        json={"document_id": doc_id, "audio_base64": audio_b64},
        timeout=60,
    )
    assert r.status_code == 200, f"{r.status_code} {r.text[:400]}"
    body = r.json()
    # Contract shape checks
    for k in ("transcript", "matched_words", "required_words", "similarity"):
        assert k in body, f"missing {k} in {body}"
    transcript = (body.get("transcript") or "").lower()
    assert transcript and "[server transcription unavailable" not in transcript, \
        f"Azure transcription failed. transcript={transcript!r}"
    # Expect at least 70% word overlap
    matched = body.get("matched_words") or []
    if matched:
        rate = sum(1 for m in matched if m) / max(1, len(matched))
    else:
        rate = float(body.get("similarity") or 0)
    assert rate >= 0.70, f"match rate too low: {rate:.2f}, transcript={transcript!r}"
    _state["oath_matched"] = True
    _state["attempts_used_after_success"] = body.get("attempts_used", 0)


# ==================== 5-fail lock -> 423 ====================
def test_voice_oath_locks_after_5_failures():
    """Fresh doc — send 5 bad-audio attempts, then expect 423 on the 6th call."""
    alice_tok = _login(**ALICE)
    bob_tok = _login(**BOB)
    payload = {
        "title": "TEST_iter6_lock_doc",
        "content": "Lock test.",
        "category": "NDA",
        "mode": "secure",
        "recipient_email": BOB["email"],
        "expires_hours": 24,
        "requires_voice_oath": True,
        "requires_face_verification": False,
        "sender_signature": "Alice",
    }
    r = requests.post(f"{BASE_URL}/api/documents", headers=_auth(alice_tok), json=payload, timeout=20)
    assert r.status_code in (200, 201), r.text[:200]
    doc_id = r.json().get("id") or r.json().get("document_id")
    # OTP verify (best effort)
    r2 = requests.post(f"{BASE_URL}/api/documents/{doc_id}/send-otp", headers=_auth(bob_tok), timeout=20)
    if r2.status_code == 200:
        otp = r2.json().get("otp_demo") or r2.json().get("otp")
        if otp:
            requests.post(f"{BASE_URL}/api/documents/{doc_id}/verify-otp",
                          headers=_auth(bob_tok), json={"otp": otp}, timeout=20)

    # Bad audio — 200 bytes of noise, non-matching
    bad = base64.b64encode(b"\x00\x11" * 1000).decode()
    seen_423 = False
    last = None
    for i in range(6):
        r = requests.post(
            f"{BASE_URL}/api/documents/voice-oath",
            headers=_auth(bob_tok),
            json={"document_id": doc_id, "audio_base64": bad},
            timeout=45,
        )
        last = (r.status_code, r.text[:200])
        if r.status_code == 423:
            seen_423 = True
            break
        # Attempts 1..5 should be 200 with completed=false
        assert r.status_code == 200, f"attempt {i+1}: {r.status_code} {r.text[:200]}"
        j = r.json()
        assert j.get("completed") in (False, None), f"attempt {i+1} unexpectedly completed: {j}"
    assert seen_423, f"never got 423 after 5 failures. last={last}"
