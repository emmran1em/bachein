"""Phase 4v2 / 5v2 / 7 tests — Question Paper Creator, Answer Booklet, Editor Import.

Runs against public backend using alice@bachein.com credentials.
QP generation is a background job — this suite reuses the pre-seeded paper id
from the review request to save time, but still exercises the create → poll flow
with a strict-but-bounded timeout.
"""
import base64
import os
import time

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://nda-hub-1.preview.emergentagent.com").rstrip("/")
API = BASE_URL + "/api"

ALICE = {"email": "alice@bachein.com", "password": "Test1234!"}
PRESEEDED_QP_ID = "00cd048d-a632-4370-9cca-f0ab9b66a407"


# ────────────────────────── fixtures ──────────────────────────
@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json=ALICE, timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ────────────────────────── helpers ──────────────────────────

def _poll(url: str, headers: dict, timeout_s: int, want_status=("ready",)) -> dict:
    end = time.time() + timeout_s
    last = None
    while time.time() < end:
        r = requests.get(url, headers=headers, timeout=30)
        r.raise_for_status()
        last = r.json()
        if last.get("status") in want_status:
            return last
        if last.get("status") == "failed":
            pytest.fail(f"Job failed: {last.get('error')}")
        time.sleep(10)
    pytest.fail(f"Timed out after {timeout_s}s waiting for {want_status}. Last status: {last.get('status') if last else 'n/a'} progress={last.get('progress') if last else ''}")


# ═══════════════════ Phase 4 v2 — Question Paper ═══════════════════

class TestQPOptions:
    def test_qp_options_shape(self, headers):
        r = requests.get(f"{API}/aiw/qp-options", headers=headers, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "CBSE" in data["boards"]
        assert "Board Level" in data["difficulties"]
        assert "2025-26" in data["academic_years"]
        assert "10" in data["classes"] and "12" in data["classes"]
        # 6-10 junior subjects
        j = data["subjects"]["10"]
        assert any("Mathematics (Standard)" == s for s in j)
        assert any("Mathematics (Basic)" == s for s in j)
        # 11-12 senior subjects
        s = data["subjects"]["11"]
        assert "Physics" in s and "Chemistry" in s


class TestQPGenerationFlow:
    """Create → poll (bounded to first progress update to save cost) → verify record persistence."""

    def test_create_returns_generating(self, headers, shared):
        body = {"board": "CBSE", "academic_year": "2025-26", "class_level": "10",
                "subject": "Science", "difficulty": "Board Level", "num_sets": 1}
        r = requests.post(f"{API}/aiw/question-paper", headers=headers, json=body, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["status"] == "generating"
        assert "id" in data
        # Disclaimer must be exact
        assert data.get("disclaimer") == "AI can make mistake, please check important info."
        shared["new_qp_id"] = data["id"]

    def test_poll_updates_progress(self, headers, shared):
        qp_id = shared.get("new_qp_id")
        assert qp_id, "test_create must run first"
        # Poll a few times just to confirm progress is being updated (not full completion)
        deadline = time.time() + 60
        seen_progress = set()
        while time.time() < deadline:
            r = requests.get(f"{API}/aiw/question-papers/{qp_id}", headers=headers, timeout=30)
            assert r.status_code == 200
            d = r.json()
            seen_progress.add((d.get("progress"), d.get("progress_pct")))
            if d.get("status") in ("ready", "failed"):
                break
            time.sleep(6)
        assert len(seen_progress) >= 1
        # Confirm at least one progress text or pct was set
        assert any(p or (pct and pct > 0) for (p, pct) in seen_progress)


class TestQPReadyOperations:
    """Use pre-seeded paper for ready-state operations."""

    def test_preseeded_ready(self, headers, shared):
        r = requests.get(f"{API}/aiw/question-papers/{PRESEEDED_QP_ID}", headers=headers, timeout=30)
        if r.status_code == 404:
            pytest.skip("Pre-seeded paper missing — cannot run ready-state ops")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "ready"
        paper = d.get("paper") or {}
        assert paper.get("sections"), "paper.sections should be non-empty"
        shared["qp_id"] = PRESEEDED_QP_ID
        # Capture Q1 text for regenerate comparison
        secs = paper["sections"]
        q1_text = None
        for sec in secs:
            for q in sec.get("questions", []):
                if str(q.get("q_no")) == "1":
                    q1_text = q.get("text")
                    break
            if q1_text:
                break
        shared["q1_before"] = q1_text

    def test_pdf_download(self, headers, shared, token):
        qp_id = shared.get("qp_id")
        if not qp_id:
            pytest.skip("no ready paper")
        r = requests.get(f"{API}/aiw/question-papers/{qp_id}/pdf?token={token}", timeout=60)
        assert r.status_code == 200, r.text[:200]
        assert r.content[:4] == b"%PDF", "response is not a PDF"
        assert len(r.content) > 30_000, f"PDF too small: {len(r.content)}"

    def test_downloads_contains_qp(self, headers, shared):
        qp_id = shared.get("qp_id")
        if not qp_id:
            pytest.skip("no ready paper")
        r = requests.get(f"{API}/downloads", headers=headers, timeout=30)
        assert r.status_code == 200
        items = r.json()["items"]
        qps = [i for i in items if i.get("kind") == "question_paper" and i.get("ref_id") == qp_id]
        assert qps, f"downloads has no question_paper for ref_id {qp_id}"
        assert qps[0]["name"]

    def test_regenerate_q1(self, headers, shared):
        qp_id = shared.get("qp_id")
        q1_before = shared.get("q1_before")
        if not qp_id or not q1_before:
            pytest.skip("no ready paper / q1 text")
        r = requests.post(f"{API}/aiw/question-papers/{qp_id}/regenerate",
                          headers=headers, json={"q_no": "1"}, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "regenerating"
        # Poll (regen is 1 LLM call — usually under 60s)
        ready = _poll(f"{API}/aiw/question-papers/{qp_id}", headers, timeout_s=180)
        # Find new q1
        q1_after = None
        for sec in ready["paper"]["sections"]:
            for q in sec.get("questions", []):
                if str(q.get("q_no")) == "1":
                    q1_after = q.get("text")
                    break
            if q1_after:
                break
        assert q1_after, "q1 not found after regen"
        assert q1_after != q1_before, "Q1 text did not change after regenerate"

    def test_new_set(self, headers, shared, token):
        qp_id = shared.get("qp_id")
        if not qp_id:
            pytest.skip("no ready paper")
        r = requests.post(f"{API}/aiw/question-papers/{qp_id}/new-set", headers=headers, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "generating"
        assert d["set_no"] >= 2
        assert d["id"] and d["id"] != qp_id
        # Verify persistence
        rr = requests.get(f"{API}/aiw/question-papers/{d['id']}", headers=headers, timeout=30)
        assert rr.status_code == 200
        assert rr.json()["params"]["set_no"] >= 2


# ═══════════════════ Phase 5 v2 — Answer Paper ═══════════════════

MINI_PAPER = """Class 10 Science — Mini paper

Q1. (1 mark) What is the SI unit of force?
Q2. (1 mark) State Ohm's law.
Q3. (2 marks) Define reflection of light and state its two laws.
Q4. (3 marks) A resistor of 10 ohm carries a current of 2 A. Calculate the power dissipated.
Q5. (3 marks) Explain photosynthesis in plants in three points.
"""


class TestAnswerPaper:
    def test_create_answer_paper(self, headers, shared):
        body = {"text": MINI_PAPER, "subject": "Science", "class_level": "10",
                "board": "CBSE", "detail": "standard"}
        r = requests.post(f"{API}/aiw/answer-paper", headers=headers, json=body, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "generating"
        assert d.get("disclaimer") == "AI can make mistake, please check important info."
        shared["ap_id"] = d["id"]

    def test_answer_paper_ready(self, headers, shared):
        ap_id = shared.get("ap_id")
        assert ap_id, "create test must run first"
        ready = _poll(f"{API}/aiw/answer-papers/{ap_id}", headers, timeout_s=360)
        ans = ready.get("answers") or {}
        answers = ans.get("answers") or []
        assert len(answers) >= 4, f"Expected ~5 answers, got {len(answers)}"
        # Each answer has required shape
        good = [a for a in answers if a.get("steps") and "marks_awarded" in a and "examiner_remark" in a]
        assert good, "No answer has steps[]+marks_awarded+examiner_remark"
        # steps[].marks presence
        assert any("marks" in (s or {}) for a in good for s in a.get("steps", []))
        assert ans.get("total_awarded") is not None

    def test_answer_paper_pdf_and_downloads(self, headers, shared, token):
        ap_id = shared.get("ap_id")
        if not ap_id:
            pytest.skip("no ap_id")
        r = requests.get(f"{API}/aiw/answer-papers/{ap_id}/pdf?token={token}", timeout=60)
        assert r.status_code == 200
        assert r.content[:4] == b"%PDF"
        # Downloads entry
        rr = requests.get(f"{API}/downloads", headers=headers, timeout=30)
        assert rr.status_code == 200
        items = rr.json()["items"]
        aps = [i for i in items if i.get("kind") == "answer_paper" and i.get("ref_id") == ap_id]
        assert aps, "no answer_paper entry in downloads"


# ═══════════════════ Phase 7 — Editor Import ═══════════════════

class TestEditorImport:
    def test_import_txt(self, headers):
        content = b"Hello world.\n\nThis is a second paragraph."
        b64 = base64.b64encode(content).decode()
        r = requests.post(f"{API}/editor/import", headers=headers,
                          json={"filename": "TEST_import.txt", "file_base64": b64}, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "<p>" in d["html"]
        assert d["title"] == "TEST_import"

    def test_import_docx(self, headers):
        try:
            from docx import Document
        except ImportError:
            pytest.skip("python-docx not installed in test env")
        import io
        d = Document()
        d.add_heading("Title Heading", level=1)
        d.add_paragraph("Some body text.")
        buf = io.BytesIO()
        d.save(buf)
        b64 = base64.b64encode(buf.getvalue()).decode()
        r = requests.post(f"{API}/editor/import", headers=headers,
                          json={"filename": "TEST_import.docx", "file_base64": b64}, timeout=30)
        assert r.status_code == 200, r.text
        html = r.json()["html"]
        assert "<h1>" in html or "<h2>" in html or "<h3>" in html
        assert "<p>" in html

    def test_import_invalid_ext(self, headers):
        b64 = base64.b64encode(b"data").decode()
        r = requests.post(f"{API}/editor/import", headers=headers,
                          json={"filename": "bad.xyz", "file_base64": b64}, timeout=30)
        assert r.status_code == 400
