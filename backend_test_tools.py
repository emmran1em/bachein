"""E2E: OCR extract, editor AI, suggest, export-pdf, protect/unlock."""
import requests, base64, io, json

BASE = "https://nda-hub-1.preview.emergentagent.com/api"
tok = requests.post(f"{BASE}/auth/login", json={"email": "alice@bachein.com", "password": "Test1234!"}).json()["token"]
H = {"Authorization": f"Bearer {tok}"}

# ── Build a test image with text (PIL) ──
from PIL import Image, ImageDraw
img = Image.new("RGB", (900, 400), "white")
d = ImageDraw.Draw(img)
d.text((40, 40), "MATHEMATICS TEST", fill="black")
d.text((40, 100), "Q1. Find the square root of 144. (2 marks)", fill="black")
d.text((40, 160), "Q2. Solve 3x + 5 = 20 for x. (3 marks)", fill="black")
buf = io.BytesIO(); img.save(buf, "JPEG")
img_b64 = base64.b64encode(buf.getvalue()).decode()

# 1. OCR extract on image
r = requests.post(f"{BASE}/ocr/extract", headers=H, json={"file_base64": img_b64, "filename": "test.jpg"}, timeout=120)
j = r.json() if r.status_code == 200 else {}
print("ocr/extract:", r.status_code, "| engine:", j.get("engine"), "| len(html):", len(j.get("html", "")), "| has Q1:", "144" in j.get("text", ""))

# 2. Editor AI command
r = requests.post(f"{BASE}/editor/ai-command", headers=H, json={
    "doc_type": "Other", "current_html": "<p>the quick brown fox jump over the lazy dogs back.</p>",
    "instruction": "Fix all grammar and make the sentence formal."}, timeout=90)
j = r.json() if r.status_code == 200 else {}
print("editor/ai-command:", r.status_code, "| changed:", "jump over" not in j.get("html", "x"), "| len:", len(j.get("html", "")))

# 3. Shadow suggest
r = requests.post(f"{BASE}/editor/suggest", headers=H, json={
    "doc_type": "Novel", "current_html": "<p>The rain hammered the tin roof as Meera opened the old letter. Her hands trembled because</p>"}, timeout=90)
j = r.json() if r.status_code == 200 else {}
print("editor/suggest:", r.status_code, "| suggestion:", repr(j.get("suggestion", ""))[:90])

# 4. Editor export-pdf (nonzero bytes)
r = requests.post(f"{BASE}/editor/export-pdf", headers=H, json={
    "id": None, "title": "Export Test", "doc_type": "Other",
    "html": "<h2>Hello</h2><p>" + ("Paragraph content. " * 60) + "</p>",
    "page_setup": {"margins": "normal", "header": "My Header", "footer": "My Footer", "page_numbers": True}}, timeout=60)
print("editor/export-pdf:", r.status_code, "|", len(r.content), "bytes | is pdf:", r.content[:4] == b"%PDF")

# 5. Protect + unlock PDF round-trip
pdf_bytes = r.content
r2 = requests.post(f"{BASE}/file-tools/protect", headers=H, files={"file": ("t.pdf", pdf_bytes, "application/pdf")}, data={"password": "secret12"})
print("protect:", r2.status_code, len(r2.content), "bytes")
import fitz
pp = fitz.open(stream=r2.content, filetype="pdf")
print("  protected needs_pass:", pp.needs_pass)
r3 = requests.post(f"{BASE}/file-tools/unlock", headers=H, files={"file": ("t.pdf", r2.content, "application/pdf")}, data={"password": "secret12"})
pu = fitz.open(stream=r3.content, filetype="pdf")
print("unlock:", r3.status_code, len(r3.content), "bytes | needs_pass now:", pu.needs_pass)
r4 = requests.post(f"{BASE}/file-tools/unlock", headers=H, files={"file": ("t.pdf", r2.content, "application/pdf")}, data={"password": "WRONG"})
print("unlock wrong pw:", r4.status_code, r4.text[:60])
