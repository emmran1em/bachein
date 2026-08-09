"""E2E: signed PDF must embed both signatures."""
import requests, json, sys

BASE = "https://nda-hub-1.preview.emergentagent.com/api"

def login(email, pw):
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": pw})
    if r.status_code != 200:
        r = requests.post(f"{BASE}/auth/signup", json={"email": email, "password": pw, "name": email.split("@")[0].title()})
    r.raise_for_status()
    return r.json()["token"]

alice = login("alice@bachein.com", "Test1234!")
bob = login("bob@bachein.com", "Test1234!")
ha = {"Authorization": f"Bearer {alice}"}
hb = {"Authorization": f"Bearer {bob}"}

# 1. create secure doc, no extra verifications
r = requests.post(f"{BASE}/documents", headers=ha, json={
    "title": "Sig Embed Test NDA",
    "content": "This is a confidentiality agreement between the parties for testing signature embedding in the exported PDF.",
    "category": "NDA", "mode": "secure", "recipient_email": "bob@bachein.com",
    "security_config": {"otp_verification": False, "face_verification": False, "voice_oath": False},
})
print("create:", r.status_code)
doc_id = r.json()["id"]

# 2. sender draws signature
sig_draw = json.dumps({"mode": "draw", "paths": ["M10,40 L30,10 L50,40 L70,15 L90,40", "M20,50 L80,50"]})
r = requests.post(f"{BASE}/documents/{doc_id}/sender-sign", headers=ha, json={"signature_base64": sig_draw})
print("sender-sign:", r.status_code, r.text[:100])

# 3. receiver signs (typed)
sig_type = json.dumps({"mode": "type", "text": "Bob Receiver"})
r = requests.post(f"{BASE}/documents/sign", headers=hb, json={"document_id": doc_id, "signature_base64": sig_type})
print("receiver-sign:", r.status_code, r.text[:120])

# 4. download signed pdf as both parties
for who, h in [("sender", ha), ("receiver", hb)]:
    r = requests.get(f"{BASE}/documents/{doc_id}/signed-pdf", headers=h)
    ok = r.status_code == 200 and len(r.content) > 1000 and r.content[:4] == b"%PDF"
    print(f"signed-pdf as {who}: {r.status_code}, {len(r.content)} bytes, pdf={ok}")
    if who == "sender":
        open("/tmp/signed_test.pdf", "wb").write(r.content)

# 5. inspect pdf for signature markers
import fitz
pdf = fitz.open("/tmp/signed_test.pdf")
last = pdf[-1]
text = last.get_text()
drawings = last.get_drawings()
has_sig_header = "SIGNATURES" in text
has_typed = "Bob Receiver" in text
n_lines = sum(1 for d in drawings for it in d["items"] if it[0] == "l")
print(f"PDF pages={len(pdf)} | SIGNATURES header={has_sig_header} | typed sig text={has_typed} | drawn lines={n_lines}")
assert has_sig_header and has_typed and n_lines >= 5, "Signature embedding FAILED"
print("✅ SIGNATURE EMBEDDING VERIFIED")
