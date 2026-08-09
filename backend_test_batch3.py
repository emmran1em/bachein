"""E2E: pdf/pages, scanner/annotate, scanner/sign-image, ai/generate with template."""
import requests, base64

BASE = "https://nda-hub-1.preview.emergentagent.com/api"
tok = requests.post(f"{BASE}/auth/login", json={"email": "alice@bachein.com", "password": "Test1234!"}).json()["token"]
H = {"Authorization": f"Bearer {tok}"}

# 1. pdf/pages
import fitz
pdf = fitz.open()
for i in range(3):
    pg = pdf.new_page()
    pg.insert_text((70, 100), f"Page {i+1}", fontsize=20)
b64 = base64.b64encode(pdf.tobytes()).decode()
r = requests.post(f"{BASE}/pdf/pages", headers=H, json={"pdf_base64": b64})
j = r.json()
print("pdf/pages:", r.status_code, "| pages:", len(j.get("pages", [])), "| total:", j.get("total"))

# 2. annotate
import numpy as np, cv2
img = np.full((600, 450, 3), 255, np.uint8)
ok, enc = cv2.imencode(".jpg", img)
ib64 = base64.b64encode(enc.tobytes()).decode()
r = requests.post(f"{BASE}/scanner/annotate", headers=H, json={
    "image_base64": ib64, "strokes": [[[0.1, 0.1], [0.5, 0.5], [0.9, 0.2]]], "color": "#e11d48"})
out = base64.b64decode(r.json()["image_base64"])
oimg = cv2.imdecode(np.frombuffer(out, np.uint8), cv2.IMREAD_COLOR)
red_px = int(((oimg[:, :, 2] > 180) & (oimg[:, :, 0] < 120)).sum())
print("annotate:", r.status_code, "| red pixels:", red_px)

# 3. sign-image (draw + type)
r = requests.post(f"{BASE}/scanner/sign-image", headers=H, json={
    "image_base64": ib64, "x": 0.3, "y": 0.7, "w": 0.4,
    "signature": {"mode": "draw", "paths": ["M5,30 L20,5 L35,30 L50,10"]}})
out = base64.b64decode(r.json()["image_base64"])
oimg = cv2.imdecode(np.frombuffer(out, np.uint8), cv2.IMREAD_COLOR)
ink_px = int((oimg.sum(axis=2) < 500).sum())
print("sign-image draw:", r.status_code, "| ink pixels:", ink_px)
r2 = requests.post(f"{BASE}/scanner/sign-image", headers=H, json={
    "image_base64": ib64, "x": 0.2, "y": 0.5, "w": 0.5,
    "signature": {"mode": "type", "text": "Alice Sender"}})
out2 = base64.b64decode(r2.json()["image_base64"])
oimg2 = cv2.imdecode(np.frombuffer(out2, np.uint8), cv2.IMREAD_COLOR)
print("sign-image type:", r2.status_code, "| ink pixels:", int((oimg2.sum(axis=2) < 500).sum()))

# 4. generate with template + Dated line
r = requests.post(f"{BASE}/ai/generate", headers=H, json={
    "prompt": "NDA for sharing a mobile app prototype with a freelance developer",
    "category": "NDA", "template": "One-way (Unilateral) NDA"}, timeout=180)
j = r.json()
has_date = "Dated" in j.get("content", "") or "Dated" in j.get("cover_page", "")
print("generate:", r.status_code, "| title:", j.get("title", "")[:50], "| Dated line:", has_date, "| len:", len(j.get("content", "")))
