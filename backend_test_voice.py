"""E2E: voice/say, voice/converse, downloads/import, viewer/explain, rekognition creds."""
import requests, base64, io, subprocess

BASE = "https://nda-hub-1.preview.emergentagent.com/api"
tok = requests.post(f"{BASE}/auth/login", json={"email": "alice@bachein.com", "password": "Test1234!"}).json()["token"]
H = {"Authorization": f"Bearer {tok}"}

# 1. voice/say (TTS)
r = requests.post(f"{BASE}/aiw/voice/say", headers=H, json={"text": "Your voice agent is coming soon"}, timeout=60)
print("voice/say:", r.status_code, "| audio bytes:", len(base64.b64decode(r.json().get("audio_base64", ""))) if r.status_code == 200 else r.text[:120])

# 2. voice/converse — synthesize a spoken wav using espeak? Not available; use ffmpeg sine? STT needs speech.
# Use the TTS output itself as input speech!
if r.status_code == 200:
    tts_mp3 = base64.b64decode(r.json()["audio_base64"])
    r2 = requests.post(f"{BASE}/aiw/voice/converse", headers=H,
                       files={"audio": ("turn.mp3", tts_mp3, "audio/mpeg")},
                       data={}, timeout=180)
    j = r2.json() if r2.status_code == 200 else {}
    print("voice/converse:", r2.status_code, "| transcript:", repr(j.get("transcript", ""))[:80],
          "| reply len:", len(j.get("reply", "")), "| audio:", bool(j.get("audio_base64")), "| conv:", bool(j.get("conversation_id")))

# 3. downloads/import (image)
from PIL import Image
img = Image.new("RGB", (500, 700), "white")
buf = io.BytesIO(); img.save(buf, "JPEG")
r = requests.post(f"{BASE}/downloads/import", headers=H, json={
    "name": "my-upload.jpg", "file_base64": base64.b64encode(buf.getvalue()).decode(), "mime": "image/jpeg"})
print("downloads/import:", r.status_code, r.json() if r.status_code == 200 else r.text[:100])

# 4. viewer/explain
from PIL import ImageDraw
pg = Image.new("RGB", (800, 1100), "white")
d = ImageDraw.Draw(pg)
d.text((100, 300), "The company shall maintain strict confidentiality of all trade secrets.", fill="black")
buf2 = io.BytesIO(); pg.save(buf2, "JPEG")
r = requests.post(f"{BASE}/viewer/explain", headers=H, json={
    "image_base64": base64.b64encode(buf2.getvalue()).decode(),
    "bbox": [0.1, 0.25, 0.9, 0.32]}, timeout=120)
j = r.json() if r.status_code == 200 else {}
print("viewer/explain:", r.status_code, "|", repr(j.get("explanation", r.text))[:140])

# 5. AWS Rekognition creds sanity
import boto3, os
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
try:
    c = boto3.client("rekognition", region_name=os.environ["AWS_REGION"],
                     aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
                     aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"])
    buf3 = io.BytesIO(); Image.new("RGB", (120, 120), "grey").save(buf3, "JPEG")
    resp = c.detect_faces(Image={"Bytes": buf3.getvalue()})
    print("rekognition creds: OK (detect_faces call succeeded, faces:", len(resp.get("FaceDetails", [])), ")")
except Exception as e:
    print("rekognition creds FAILED:", str(e)[:160])
