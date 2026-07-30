"""Phase 4/5/6 tests — Question Paper Creator, Topper Answer Booklet, Downloads section.

Covers the review-request items:
- POST /api/aiw/answer-paper (LLM up to 90s)
- GET /api/aiw/answer-papers (list) & PDF via ?token=
- GET /api/aiw/question-papers/{id}/pdf?token= (query token)
- Downloads auto-registration (answer_paper + question_paper)
- PATCH /api/downloads/{id} rename, DELETE, GET file?token=
- POST /api/documents/face-detect false-path
"""
import os
import time
import pytest
import requests

BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE}/api"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": "alice@bachein.com", "password": "Test1234!"}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def auth(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ============== Downloads listing baseline ==============
class TestDownloadsBaseline:
    def test_list_downloads_ok(self, auth):
        r = requests.get(f"{API}/downloads", headers=auth, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert "items" in data and isinstance(data["items"], list)


# ============== Phase 5 — Topper answer booklet ==============
class TestAnswerPaper:
    ap_id = None

    def test_create_answer_paper(self, auth, token):
        payload = {
            "text": "Q1. (2 marks) Define photosynthesis.",
            "subject": "Science",
            "class_level": "10",
            "board": "CBSE",
            "detail": "concise",
        }
        r = requests.post(f"{API}/aiw/answer-paper", headers=auth, json=payload, timeout=120)
        assert r.status_code == 200, f"answer-paper create failed: {r.status_code} {r.text[:400]}"
        body = r.json()
        assert "id" in body
        # LLM may sometimes return unparsable JSON; still expect an id + disclaimer
        assert body.get("disclaimer") == "AI can make mistake, please check important info."
        TestAnswerPaper.ap_id = body["id"]
        # If parsed, structure sanity
        if body.get("parsed"):
            ans = body.get("answers") or {}
            assert isinstance(ans.get("answers", []), list)

    def test_list_answer_papers_contains_new(self, auth):
        assert TestAnswerPaper.ap_id, "no ap_id from previous step"
        r = requests.get(f"{API}/aiw/answer-papers", headers=auth, timeout=30)
        assert r.status_code == 200
        ids = [i["id"] for i in r.json().get("items", [])]
        assert TestAnswerPaper.ap_id in ids

    def test_answer_paper_pdf_via_query_token(self, token):
        assert TestAnswerPaper.ap_id
        r = requests.get(f"{API}/aiw/answer-papers/{TestAnswerPaper.ap_id}/pdf", params={"token": token}, timeout=60)
        assert r.status_code == 200, f"pdf failed: {r.status_code} {r.text[:200]}"
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert r.content[:5] == b"%PDF-"

    def test_answer_paper_registered_in_downloads(self, auth):
        assert TestAnswerPaper.ap_id
        # Give a tiny moment
        time.sleep(1)
        r = requests.get(f"{API}/downloads", headers=auth, timeout=30)
        assert r.status_code == 200
        items = r.json()["items"]
        matched = [i for i in items if i.get("kind") == "answer_paper" and i.get("ref_id") == TestAnswerPaper.ap_id]
        assert matched, f"answer_paper entry not registered for ap_id={TestAnswerPaper.ap_id}"


# ============== Phase 4 — Question paper (only PDF/ query-token test to save LLM time) ==============
class TestQuestionPaperPdfQueryToken:
    """We reuse the pre-seeded 'Renamed booklet' or any existing question_paper download.
    To fully validate query-token PDF endpoint, we create a small question paper.
    """
    qp_id = None

    def test_create_question_paper_minimal(self, auth):
        payload = {
            "board": "CBSE",
            "class_level": "10",
            "subject": "Science",
            "chapters": ["Light"],
            "total_marks": 20,
            "duration_minutes": 45,
            "difficulty": "easy",
            "include_case_studies": False,
            "include_diagrams": False,
            "include_maps": False,
            "include_graphs": False,
            "include_tables": False,
            "num_sections": 2,
            "language": "English",
        }
        r = requests.post(f"{API}/aiw/question-paper", headers=auth, json=payload, timeout=120)
        assert r.status_code == 200, f"qp create failed: {r.status_code} {r.text[:400]}"
        j = r.json()
        assert j.get("id")
        TestQuestionPaperPdfQueryToken.qp_id = j["id"]

    def test_qp_pdf_via_query_token(self, token):
        assert TestQuestionPaperPdfQueryToken.qp_id
        r = requests.get(f"{API}/aiw/question-papers/{TestQuestionPaperPdfQueryToken.qp_id}/pdf", params={"token": token}, timeout=60)
        assert r.status_code == 200, f"qp pdf failed: {r.status_code} {r.text[:200]}"
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert r.content[:5] == b"%PDF-"

    def test_qp_registered_in_downloads(self, auth):
        assert TestQuestionPaperPdfQueryToken.qp_id
        time.sleep(1)
        r = requests.get(f"{API}/downloads", headers=auth, timeout=30)
        assert r.status_code == 200
        items = r.json()["items"]
        matched = [i for i in items if i.get("kind") == "question_paper" and i.get("ref_id") == TestQuestionPaperPdfQueryToken.qp_id]
        assert matched, "question_paper entry not registered"


# ============== Phase 6 — Downloads rename/delete/file ==============
class TestDownloadsCRUD:
    dl_id = None

    def test_pick_a_download_for_crud(self, auth):
        r = requests.get(f"{API}/downloads", headers=auth, timeout=30)
        items = r.json()["items"]
        # Prefer an answer_paper entry created by our tests
        chosen = next((i for i in items if i.get("kind") == "answer_paper"), None) or (items[0] if items else None)
        assert chosen, "no downloads to test against"
        TestDownloadsCRUD.dl_id = chosen["id"]

    def test_rename(self, auth):
        assert TestDownloadsCRUD.dl_id
        newname = "TEST_renamed_by_pytest"
        r = requests.patch(f"{API}/downloads/{TestDownloadsCRUD.dl_id}", headers=auth, json={"name": newname}, timeout=15)
        assert r.status_code == 200, r.text[:200]
        assert r.json().get("name") == newname
        # Confirm via list
        r2 = requests.get(f"{API}/downloads", headers=auth, timeout=15)
        matched = [i for i in r2.json()["items"] if i["id"] == TestDownloadsCRUD.dl_id]
        assert matched and matched[0]["name"] == newname

    def test_file_download_query_token(self, token):
        assert TestDownloadsCRUD.dl_id
        r = requests.get(f"{API}/downloads/{TestDownloadsCRUD.dl_id}/file", params={"token": token}, timeout=30)
        assert r.status_code == 200, f"file download failed: {r.status_code} {r.text[:200]}"
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert r.content[:5] == b"%PDF-"

    def test_delete(self, auth):
        assert TestDownloadsCRUD.dl_id
        r = requests.delete(f"{API}/downloads/{TestDownloadsCRUD.dl_id}", headers=auth, timeout=15)
        assert r.status_code == 200
        # Verify gone
        r2 = requests.get(f"{API}/downloads", headers=auth, timeout=15)
        ids = [i["id"] for i in r2.json()["items"]]
        assert TestDownloadsCRUD.dl_id not in ids
        # Delete again → 404
        r3 = requests.delete(f"{API}/downloads/{TestDownloadsCRUD.dl_id}", headers=auth, timeout=15)
        assert r3.status_code == 404


# ============== Face detect endpoint (false path) ==============
class TestFaceDetect:
    def test_face_detect_empty(self, auth):
        r = requests.post(f"{API}/documents/face-detect", headers=auth, json={"image_base64": "abc"}, timeout=15)
        assert r.status_code == 200, r.text[:200]
        assert r.json() == {"face": False}

    def test_face_detect_invalid_but_long(self, auth):
        # 300 chars of junk — decode will fail; endpoint should return {face:false}
        img = "A" * 300
        r = requests.post(f"{API}/documents/face-detect", headers=auth, json={"image_base64": img}, timeout=15)
        assert r.status_code == 200
        assert r.json() == {"face": False}

    def test_face_detect_requires_auth(self):
        r = requests.post(f"{API}/documents/face-detect", json={"image_base64": "abc"}, timeout=15)
        # Should be 401 without token
        assert r.status_code in (401, 403)
