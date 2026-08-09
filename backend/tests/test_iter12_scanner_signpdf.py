"""
Iteration 12 — Scanner detect/apply + File-tools sign-prepare/sign-apply roundtrip.
Also spot-checks iter11 endpoints (editor/suggest, ocr/extract, protect/unlock) still work.

All tests use alice's credentials against the public EXPO_PUBLIC_BACKEND_URL.
"""
import base64
import io
import os

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://nda-hub-1.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ALICE_EMAIL = "alice@bachein.com"
ALICE_PW = "Test1234!"


# ─────────── Fixtures ───────────
@pytest.fixture(scope="module")
def alice_token():
    r = requests.post(f"{API}/auth/login", json={"email": ALICE_EMAIL, "password": ALICE_PW}, timeout=30)
    assert r.status_code == 200, f"alice login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def alice_headers(alice_token):
    return {"Authorization": f"Bearer {alice_token}", "Content-Type": "application/json"}


def _synth_doc_photo_b64() -> str:
    """Synthesise a photo of a document: dark bg with a bright quadrilateral (rotated rectangle)."""
    import numpy as np
    import cv2
    img = np.full((600, 800, 3), 30, dtype=np.uint8)  # dark bg
    quad = np.array([[120, 90], [700, 130], [670, 520], [90, 480]], dtype=np.int32)
    cv2.fillConvexPoly(img, quad, (240, 240, 240))
    cv2.putText(img, "TEST DOC", (200, 300), cv2.FONT_HERSHEY_SIMPLEX, 2, (30, 30, 30), 4)
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 88])
    assert ok
    return base64.b64encode(buf.tobytes()).decode()


def _minimal_pdf_bytes(text: str = "TEST iter12 sign roundtrip document", pages: int = 2) -> bytes:
    import fitz
    doc = fitz.open()
    for i in range(pages):
        page = doc.new_page(width=595, height=842)
        page.insert_text((72, 100 + i * 40), f"{text} — page {i + 1}", fontsize=14)
    buf = doc.tobytes()
    doc.close()
    return buf


# ─────────── Scanner: detect + apply ───────────
class TestScannerDetectApply:
    def test_scanner_detect_finds_quad(self, alice_headers):
        r = requests.post(
            f"{API}/scanner/detect",
            headers=alice_headers,
            json={"image_base64": _synth_doc_photo_b64()},
            timeout=45,
        )
        assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
        body = r.json()
        assert "found" in body and "corners" in body
        assert isinstance(body["corners"], list) and len(body["corners"]) == 4
        for c in body["corners"]:
            assert isinstance(c, list) and len(c) == 2
            assert 0.0 <= c[0] <= 1.0 and 0.0 <= c[1] <= 1.0
        assert body.get("width") and body.get("height")
        # Should find quad on our synthetic input
        assert body["found"] is True, f"expected found=True on synthetic doc, got {body}"

    def test_scanner_detect_no_quad_still_returns_default(self, alice_headers):
        # Uniform image → no quad
        import numpy as np, cv2
        img = np.full((300, 400, 3), 128, dtype=np.uint8)
        ok, buf = cv2.imencode(".jpg", img)
        b64 = base64.b64encode(buf.tobytes()).decode()
        r = requests.post(f"{API}/scanner/detect", headers=alice_headers, json={"image_base64": b64}, timeout=30)
        assert r.status_code == 200
        body = r.json()
        assert body["found"] is False
        assert len(body["corners"]) == 4

    def test_scanner_apply_color_filter_no_corners(self, alice_headers):
        r = requests.post(
            f"{API}/scanner/apply",
            headers=alice_headers,
            json={"image_base64": _synth_doc_photo_b64(), "filter": "color", "rotate": 0},
            timeout=45,
        )
        assert r.status_code == 200
        body = r.json()
        assert body.get("image_base64")
        raw = base64.b64decode(body["image_base64"])
        assert raw.startswith(b"\xff\xd8"), "apply result is not a JPEG"

    def test_scanner_apply_bw_rotate_with_corners(self, alice_headers):
        r = requests.post(
            f"{API}/scanner/apply",
            headers=alice_headers,
            json={
                "image_base64": _synth_doc_photo_b64(),
                "corners": [[0.15, 0.15], [0.85, 0.18], [0.83, 0.85], [0.12, 0.80]],
                "filter": "bw",
                "rotate": 90,
            },
            timeout=45,
        )
        assert r.status_code == 200
        body = r.json()
        assert body.get("image_base64")
        assert body.get("found_document") is True
        raw = base64.b64decode(body["image_base64"])
        assert raw.startswith(b"\xff\xd8")

    def test_scanner_apply_original_filter(self, alice_headers):
        r = requests.post(
            f"{API}/scanner/apply",
            headers=alice_headers,
            json={"image_base64": _synth_doc_photo_b64(), "filter": "original", "rotate": 0},
            timeout=45,
        )
        assert r.status_code == 200
        assert r.json().get("image_base64")

    def test_scanner_endpoints_require_auth(self):
        r = requests.post(f"{API}/scanner/detect", json={"image_base64": "abc"}, timeout=15)
        assert r.status_code in (401, 403)
        r2 = requests.post(f"{API}/scanner/apply", json={"image_base64": "abc"}, timeout=15)
        assert r2.status_code in (401, 403)


# ─────────── Sign-PDF: prepare + apply roundtrip ───────────
class TestSignPdfRoundtrip:
    def test_sign_prepare_returns_pages(self, alice_token):
        headers = {"Authorization": f"Bearer {alice_token}"}
        pdf = _minimal_pdf_bytes(pages=2)
        files = {"file": ("TEST_iter12_sign.pdf", pdf, "application/pdf")}
        r = requests.post(f"{API}/file-tools/sign-prepare", headers=headers, files=files, timeout=45)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
        body = r.json()
        assert body.get("session_id")
        assert body.get("total_pages") == 2
        assert isinstance(body.get("pages"), list) and len(body["pages"]) == 2
        for p in body["pages"]:
            assert p.get("image_base64")
            raw = base64.b64decode(p["image_base64"])
            assert raw.startswith(b"\xff\xd8"), "page preview is not a JPEG"
            assert p.get("width") and p.get("height")

        # Save session id for the next test via attribute
        TestSignPdfRoundtrip._sid = body["session_id"]
        TestSignPdfRoundtrip._pdf = pdf

    def test_sign_apply_draw_embeds_signature_and_creates_download(self, alice_token):
        headers_json = {"Authorization": f"Bearer {alice_token}", "Content-Type": "application/json"}
        sid = getattr(TestSignPdfRoundtrip, "_sid", None)
        assert sid, "prepare test must run first"
        # Draw a simple 3-stroke signature (SVG-like path syntax)
        payload = {
            "session_id": sid,
            "page_index": 0,
            "x": 0.1,
            "y": 0.75,
            "w": 0.35,
            "signature": {
                "mode": "draw",
                "paths": [
                    "M10,20 L30,25 L60,15 L90,30",
                    "M10,40 L40,45 L80,50",
                    "M20,60 L50,55 L85,65",
                ],
            },
        }
        r = requests.post(f"{API}/file-tools/sign-apply", headers=headers_json, json=payload, timeout=60)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
        body = r.json()
        assert body.get("download_id")
        assert body.get("name", "").startswith("signed-")
        assert body.get("size", 0) > 500

        # Verify the download exists via /api/downloads
        r2 = requests.get(f"{API}/downloads", headers={"Authorization": f"Bearer {alice_token}"}, timeout=30)
        assert r2.status_code == 200
        items = r2.json() if isinstance(r2.json(), list) else r2.json().get("items", [])
        found = [d for d in items if d.get("id") == body["download_id"]]
        assert found, "sign-apply download not visible in /downloads"
        assert found[0].get("kind") == "signed-pdf"

        # And it must be downloadable
        token = alice_token
        r3 = requests.get(f"{API}/downloads/{body['download_id']}/file?token={token}", timeout=30)
        assert r3.status_code == 200
        assert r3.content.startswith(b"%PDF"), "signed download is not a PDF"
        # cleanup
        requests.delete(f"{API}/downloads/{body['download_id']}", headers={"Authorization": f"Bearer {alice_token}"}, timeout=15)

    def test_sign_apply_type_mode(self, alice_token):
        headers = {"Authorization": f"Bearer {alice_token}"}
        # Fresh session
        pdf = _minimal_pdf_bytes(pages=1)
        files = {"file": ("TEST_iter12_type.pdf", pdf, "application/pdf")}
        r = requests.post(f"{API}/file-tools/sign-prepare", headers=headers, files=files, timeout=45)
        assert r.status_code == 200
        sid = r.json()["session_id"]

        r2 = requests.post(
            f"{API}/file-tools/sign-apply",
            headers={**headers, "Content-Type": "application/json"},
            json={"session_id": sid, "page_index": 0, "x": 0.5, "y": 0.5, "w": 0.3,
                  "signature": {"mode": "type", "text": "Alice Signer"}},
            timeout=45,
        )
        assert r2.status_code == 200
        dl_id = r2.json().get("download_id")
        assert dl_id
        # cleanup
        requests.delete(f"{API}/downloads/{dl_id}", headers=headers, timeout=15)

    def test_sign_apply_bad_session(self, alice_token):
        r = requests.post(
            f"{API}/file-tools/sign-apply",
            headers={"Authorization": f"Bearer {alice_token}", "Content-Type": "application/json"},
            json={"session_id": "does-not-exist", "page_index": 0, "x": 0.1, "y": 0.1, "w": 0.3,
                  "signature": {"mode": "type", "text": "X"}},
            timeout=15,
        )
        assert r.status_code == 404

    def test_sign_prepare_rejects_encrypted_pdf(self, alice_token):
        headers = {"Authorization": f"Bearer {alice_token}"}
        # Build an encrypted PDF
        import fitz
        doc = fitz.open()
        doc.new_page().insert_text((72, 100), "encrypted iter12")
        enc_bytes = doc.tobytes(encryption=fitz.PDF_ENCRYPT_AES_256, owner_pw="own", user_pw="usr")
        doc.close()
        files = {"file": ("TEST_iter12_enc.pdf", enc_bytes, "application/pdf")}
        r = requests.post(f"{API}/file-tools/sign-prepare", headers=headers, files=files, timeout=30)
        assert r.status_code == 400


# ─────────── iter11 spot checks ───────────
class TestIter11Regression:
    def test_editor_suggest_still_works(self, alice_headers):
        r = requests.post(
            f"{API}/editor/suggest",
            headers=alice_headers,
            json={"doc_type": "Business Proposal", "current_html": "<p>Q4 outlook is</p>"},
            timeout=90,
        )
        assert r.status_code == 200
        assert "suggestion" in r.json()

    def test_ocr_extract_pdf_text_layer_regression(self, alice_headers):
        pdf = _minimal_pdf_bytes("Bachein iter12 regression OCR. " * 6, pages=1)
        b64 = base64.b64encode(pdf).decode()
        r = requests.post(
            f"{API}/ocr/extract",
            headers=alice_headers,
            json={"file_base64": b64, "filename": "TEST_iter12_ocr.pdf"},
            timeout=90,
        )
        assert r.status_code == 200
        body = r.json()
        assert body.get("html")

    def test_protect_unlock_roundtrip_regression(self, alice_token):
        headers = {"Authorization": f"Bearer {alice_token}"}
        pdf = _minimal_pdf_bytes(pages=1)
        # Protect
        r = requests.post(f"{API}/file-tools/protect", headers=headers,
                          files={"file": ("TEST_iter12_prot.pdf", pdf, "application/pdf")},
                          data={"password": "P@ss12!"}, timeout=45)
        assert r.status_code == 200
        prot = r.content
        assert prot.startswith(b"%PDF")
        # Wrong pw
        r2 = requests.post(f"{API}/file-tools/unlock", headers=headers,
                           files={"file": ("TEST.pdf", prot, "application/pdf")},
                           data={"password": "wrong"}, timeout=45)
        assert r2.status_code == 400
        # Right pw
        r3 = requests.post(f"{API}/file-tools/unlock", headers=headers,
                           files={"file": ("TEST.pdf", prot, "application/pdf")},
                           data={"password": "P@ss12!"}, timeout=45)
        assert r3.status_code == 200
        assert r3.content.startswith(b"%PDF")
