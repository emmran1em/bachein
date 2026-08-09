"""E2E: scanner detect/apply + sign-prepare/sign-apply."""
import requests, base64, io

BASE = "https://nda-hub-1.preview.emergentagent.com/api"
tok = requests.post(f"{BASE}/auth/login", json={"email": "alice@bachein.com", "password": "Test1234!"}).json()["token"]
H = {"Authorization": f"Bearer {tok}"}

# ── document photo simulation (white page on dark bg, tilted) ──
import numpy as np, cv2
bg = np.full((800, 600, 3), 40, np.uint8)
pts = np.array([[80, 100], [520, 130], [500, 700], [60, 660]], np.int32)
cv2.fillPoly(bg, [pts], (255, 255, 255))
cv2.putText(bg, "HELLO DOC", (150, 400), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 0), 2)
ok, enc = cv2.imencode(".jpg", bg)
img_b64 = base64.b64encode(enc.tobytes()).decode()

# 1. detect
r = requests.post(f"{BASE}/scanner/detect", headers=H, json={"image_base64": img_b64})
d = r.json()
print("detect:", r.status_code, "| found:", d.get("found"), "| corners:", [[round(x,2) for x in c] for c in d.get("corners", [])])

# 2. apply with corners + bw filter
r = requests.post(f"{BASE}/scanner/apply", headers=H, json={"image_base64": img_b64, "corners": d["corners"], "filter": "bw", "rotate": 90})
a = r.json()
print("apply:", r.status_code, "| found_document:", a.get("found_document"), "| out bytes:", len(a.get("image_base64", "")))

# 3. sign-prepare: build a small pdf
import fitz
pdf = fitz.open()
pg = pdf.new_page(width=595, height=842)
pg.insert_text((60, 100), "AGREEMENT", fontsize=18)
pg.insert_text((60, 760), "Signature: ______________", fontsize=11)
data = pdf.tobytes()
r = requests.post(f"{BASE}/file-tools/sign-prepare", headers=H, files={"file": ("agr.pdf", data, "application/pdf")})
j = r.json()
print("sign-prepare:", r.status_code, "| pages:", len(j.get("pages", [])), "| sid:", bool(j.get("session_id")))

# 4. sign-apply with drawn signature near the signature line
sig = {"mode": "draw", "paths": ["M5,30 L20,5 L35,30 L50,10 L65,30", "M10,38 L60,38"]}
r = requests.post(f"{BASE}/file-tools/sign-apply", headers=H, json={
    "session_id": j["session_id"], "page_index": 0, "x": 0.35, "y": 0.86, "w": 0.3, "signature": sig})
res = r.json()
print("sign-apply:", r.status_code, "|", res)

# 5. download + verify signature strokes on page
r = requests.get(f"{BASE}/downloads/{res['download_id']}/file", headers=H)
out = fitz.open(stream=r.content, filetype="pdf")
lines = sum(1 for dd in out[0].get_drawings() for it in dd["items"] if it[0] == "l")
print("signed pdf:", r.status_code, len(r.content), "bytes | drawn lines on page:", lines)
assert lines >= 5 and r.content[:4] == b"%PDF"
print("✅ SIGN-PDF FLOW VERIFIED")
