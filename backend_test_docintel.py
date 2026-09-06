"""E2E: ingest (pymupdf + textract fallback) → RAG chat → artifact version → docx/html export → signed-pdf unsigned fix."""
import requests, base64, io

BASE = "https://nda-hub-1.preview.emergentagent.com/api"
tok = requests.post(f"{BASE}/auth/login", json={"email": "alice@bachein.com", "password": "Test1234!"}).json()["token"]
H = {"Authorization": f"Bearer {tok}"}

# 1. build a text PDF (NDA-like) and ingest
import fitz
pdf = fitz.open()
pg = pdf.new_page()
body = ("NON-DISCLOSURE AGREEMENT\n\nThis agreement is between Pacloc Technologies and the Receiving Party. "
        "The confidentiality period shall be two (2) years from the date of disclosure. "
        "Either party may terminate this agreement with thirty (30) days written notice. "
        "Payment for consulting services shall be made within 30 days of invoice. " * 6)
pg.insert_textbox(fitz.Rect(50, 50, 545, 800), body, fontsize=10)
data = pdf.tobytes()
r = requests.post(f"{BASE}/aiw/ingest", headers=H, files={"file": ("nda-test.pdf", data, "application/pdf")}, timeout=120)
j = r.json()
print("ingest text-pdf:", r.status_code, "| method:", j.get("method"), "| chunks:", j.get("chunks"))
conv = j.get("conversation_id")

# 2. scanned PDF (image only) → Textract fallback
img_pdf = fitz.open()
pg2 = img_pdf.new_page()
tmp = fitz.open(); tp = tmp.new_page(); tp.insert_text((60, 100), "SCANNED CLAUSE: Termination requires 45 days notice.", fontsize=14)
pix = tmp[0].get_pixmap(dpi=120)
pg2.insert_image(pg2.rect, stream=pix.tobytes("png"))
r2 = requests.post(f"{BASE}/aiw/ingest", headers=H, files={"file": ("scan.pdf", img_pdf.tobytes(), "application/pdf")}, data={"conversation_id": conv}, timeout=180)
j2 = r2.json()
print("ingest scanned-pdf:", r2.status_code, "| method:", j2.get("method"), "| chars:", j2.get("chars"))

# 3. RAG question
r3 = requests.post(f"{BASE}/aiw/chat", headers=H, json={"conversation_id": conv, "message": "What does my document say about the confidentiality period and termination notice?"}, timeout=180)
j3 = r3.json()
rep = j3.get("reply", "")
print("rag chat:", r3.status_code, "| mentions 2 years:", ("two" in rep.lower() or "2" in rep), "| mentions 30 days:", "30" in rep, "| len:", len(rep))

# 4. modification → artifact v1 with version
r4 = requests.post(f"{BASE}/aiw/chat", headers=H, json={"conversation_id": conv, "message": "Change the confidentiality period from 2 years to 5 years and generate the updated NDA as a PDF."}, timeout=240)
j4 = r4.json()
art = j4.get("artifact") or {}
print("modify:", r4.status_code, "| artifact:", art.get("name"), "| version:", art.get("version"))

# 5. exports
if art:
    for fmt, sig in [("docx", b"PK"), ("html", b"<!DO")]:
        r5 = requests.get(f"{BASE}/aiw/export/{art['download_id']}?fmt={fmt}", headers=H)
        print(f"export {fmt}:", r5.status_code, len(r5.content), "bytes | magic ok:", r5.content[:len(sig)] == sig)

# 6. signed-pdf now works for UNSIGNED docs (home viewer fix)
docs = requests.get(f"{BASE}/documents", headers=H).json()
unsigned = next((d for d in docs if d.get("signature_status") != "signed"), None)
if unsigned:
    r6 = requests.get(f"{BASE}/documents/{unsigned['id']}/signed-pdf", headers=H)
    print("unsigned doc pdf:", r6.status_code, len(r6.content), "bytes | is pdf:", r6.content[:4] == b"%PDF")
