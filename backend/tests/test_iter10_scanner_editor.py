"""Iteration 10 — Scanner (Phase 11), Editor versions & Page-setup PDF export tests.

Covers:
  1. POST /api/scanner/process (synthetic doc image) → 200, image_base64, found_document
  2. POST /api/scanner/process mode='bw' → 200, image_base64 returned
  3. POST /api/scanner/create-pdf (2 processed pages) → download_id + pages=2
  4. GET /api/downloads contains 'scan' kind
  5. GET /api/downloads/{id}/file?token=JWT returns valid PDF (%PDF header)
  6. POST /api/editor/save (twice, same doc id) then GET /api/editor/{id}/versions returns versions
  7. POST /api/editor/export-pdf w/ page_setup {margins, header, footer, page_numbers} → valid PDF, header text present
"""

import base64
import io
import os
import re

import numpy as np
import cv2
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://nda-hub-1.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

EMAIL = "alice@bachein.com"
PASSWORD = "Test1234!"


# ── session-scoped auth ────────────────────────────────────────
@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    tok = r.json().get("token") or r.json().get("access_token")
    assert tok, f"no token in login response: {r.json()}"
    return tok


@pytest.fixture(scope="module")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def module_state():
    return {}


# ── helper — build a synthetic doc photo (dark bg + bright quadrilateral) ──
def _synth_doc_b64(w=800, h=1000):
    img = np.full((h, w, 3), 20, dtype=np.uint8)  # dark bg
    # bright quadrilateral (slightly rotated to test perspective)
    pts = np.array([[120, 90], [700, 120], [680, 900], [140, 870]], dtype=np.int32)
    cv2.fillPoly(img, [pts], (245, 245, 240))
    # add some 'text' lines
    for y in range(220, 820, 60):
        cv2.line(img, (180, y), (640, y), (40, 40, 40), 3)
    ok, enc = cv2.imencode(".jpg", img)
    assert ok
    return base64.b64encode(enc.tobytes()).decode()


# ══════════════ 1. Scanner — process (color) ══════════════
class TestScannerProcess:
    def test_process_color_finds_document(self, auth_headers, module_state):
        payload = {"image_base64": _synth_doc_b64(), "mode": "color"}
        r = requests.post(f"{API}/scanner/process", json=payload, headers=auth_headers, timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "image_base64" in data and len(data["image_base64"]) > 100
        assert data.get("found_document") is True, "expected found_document=True for synthetic quadrilateral"
        module_state["page1_b64"] = data["image_base64"]

    def test_process_bw_mode(self, auth_headers, module_state):
        payload = {"image_base64": _synth_doc_b64(), "mode": "bw"}
        r = requests.post(f"{API}/scanner/process", json=payload, headers=auth_headers, timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "image_base64" in data and len(data["image_base64"]) > 100
        module_state["page2_b64"] = data["image_base64"]


# ══════════════ 2. Scanner — create-pdf, downloads listing & file fetch ══════════════
class TestScannerCreatePdf:
    def test_create_pdf_two_pages(self, auth_headers, module_state):
        pages = [module_state["page1_b64"], module_state["page2_b64"]]
        r = requests.post(
            f"{API}/scanner/create-pdf",
            json={"images": pages, "name": "TEST_scan iter10"},
            headers=auth_headers, timeout=60,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("pages") == 2, f"expected 2 pages got {data}"
        assert data.get("download_id")
        module_state["download_id"] = data["download_id"]
        module_state["scan_name"] = data.get("name", "TEST_scan iter10")

    def test_downloads_contains_scan(self, auth_headers, module_state):
        r = requests.get(f"{API}/downloads", headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text
        items = r.json().get("items", [])
        matching = [i for i in items if i.get("id") == module_state["download_id"]]
        assert matching, "created scan not present in /downloads listing"
        assert matching[0].get("kind") == "scan", f"expected kind=scan got {matching[0]}"

    def test_download_file_returns_pdf(self, token, module_state):
        did = module_state["download_id"]
        # token-in-query for the file endpoint
        r = requests.get(f"{API}/downloads/{did}/file?token={token}", timeout=30)
        assert r.status_code == 200, r.text[:200]
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert r.content[:4] == b"%PDF", "expected %PDF header"

    def test_cleanup_scan_download(self, auth_headers, module_state):
        did = module_state.get("download_id")
        if not did:
            return
        r = requests.delete(f"{API}/downloads/{did}", headers=auth_headers, timeout=30)
        assert r.status_code in (200, 404)


# ══════════════ 3. Editor save → versions ══════════════
class TestEditorVersions:
    def test_save_twice_and_list_versions(self, auth_headers, module_state):
        doc_id = None
        for i, html in enumerate([
            "<h1>TEST v1</h1><p>Original body</p>",
            "<h1>TEST v2</h1><p>Updated body one</p>",
            "<h1>TEST v3</h1><p>Updated body two</p>",
        ]):
            body = {
                "id": doc_id,
                "title": "TEST iter10 doc",
                "doc_type": "Other",
                "html": html,
                "plain_text": re.sub(r"<[^>]+>", " ", html),
            }
            r = requests.post(f"{API}/editor/save", json=body, headers=auth_headers, timeout=30)
            assert r.status_code == 200, r.text
            doc_id = r.json()["id"]
        module_state["editor_doc_id"] = doc_id

        r = requests.get(f"{API}/editor/{doc_id}/versions", headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "versions" in data
        vs = data["versions"]
        # 3 saves → 2 version snapshots pushed (first save created doc, next two pushed prev html)
        assert len(vs) >= 2, f"expected >=2 versions got {len(vs)}: {vs}"
        for v in vs:
            assert "ts" in v and "by" in v and "html" in v, f"missing keys in version: {v}"
        assert data.get("title") == "TEST iter10 doc"


# ══════════════ 4. Editor export-pdf with page_setup ══════════════
class TestEditorExportPdf:
    def test_export_pdf_with_page_setup(self, auth_headers):
        body = {
            "title": "TEST Export Page-Setup",
            "doc_type": "Other",
            "html": "<h1>Title</h1><p>Hello world</p>",
            "page_setup": {
                "margins": "narrow",
                "header": "My Header",
                "footer": "Confidential",
                "page_numbers": True,
            },
        }
        r = requests.post(f"{API}/editor/export-pdf", json=body, headers=auth_headers, timeout=60)
        assert r.status_code == 200, r.text[:200]
        assert r.headers.get("content-type", "").startswith("application/pdf")
        pdf = r.content
        assert pdf[:4] == b"%PDF", "not a PDF"

        # verify header text present via pymupdf
        try:
            import fitz
            doc = fitz.open(stream=pdf, filetype="pdf")
            all_text = "\n".join(pg.get_text() for pg in doc)
            assert "My Header" in all_text, f"header 'My Header' not found in PDF text"
            assert "Confidential" in all_text, f"footer 'Confidential' not found in PDF text"
            assert "Hello world" in all_text, "body text not found in PDF"
            assert "Page 1" in all_text or "Page" in all_text, "page number not rendered"
        except ImportError:
            pytest.skip("pymupdf not available")
