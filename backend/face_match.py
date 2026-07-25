"""Face match using OpenCV face detection + perceptual hash comparison.
Lightweight, no heavy ML deps. Stores embedding-like hash of reference selfie
during signup/enrollment and compares on verification.
"""
import base64
import io
import numpy as np
import cv2
from PIL import Image


def _decode_image(b64: str) -> np.ndarray:
    raw = base64.b64decode(b64)
    img = Image.open(io.BytesIO(raw))
    if img.mode != "RGB":
        img = img.convert("RGB")
    arr = np.array(img)
    return cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)


_FACE_CASCADE = None
_PROFILE_CASCADE = None

def _get_cascades():
    global _FACE_CASCADE, _PROFILE_CASCADE
    if _FACE_CASCADE is None:
        _FACE_CASCADE = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
        _PROFILE_CASCADE = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_profileface.xml")
    return _FACE_CASCADE, _PROFILE_CASCADE


def _detect_faces_multi(gray: np.ndarray):
    """Multi-pass detection with progressive leniency + histogram equalization + profile fallback."""
    face_c, profile_c = _get_cascades()
    eq = cv2.equalizeHist(gray)
    passes = [
        (1.1, 4, (60, 60)),
        (1.1, 3, (40, 40)),
        (1.2, 2, (30, 30)),
        (1.3, 2, (24, 24)),
    ]
    for sf, mn, ms in passes:
        for src in (gray, eq):
            faces = face_c.detectMultiScale(src, scaleFactor=sf, minNeighbors=mn, minSize=ms)
            if len(faces) > 0:
                return faces
            faces = profile_c.detectMultiScale(src, scaleFactor=sf, minNeighbors=mn, minSize=ms)
            if len(faces) > 0:
                return faces
    return []


def detect_face(img: np.ndarray) -> bool:
    """Return True if at least one face is detected via Haar cascade (with multi-pass leniency)."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    faces = _detect_faces_multi(gray)
    return len(faces) > 0


def compute_face_hash(b64: str) -> str:
    """Return a perceptual hash of the largest detected face region."""
    img = _decode_image(b64)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    faces = _detect_faces_multi(gray)
    if len(faces) == 0:
        return ""
    # largest face
    x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
    face = gray[y:y + h, x:x + w]
    face_small = cv2.resize(face, (16, 16), interpolation=cv2.INTER_AREA)
    avg = face_small.mean()
    bits = (face_small > avg).astype(np.uint8).flatten()
    return "".join(str(b) for b in bits)


def hamming(a: str, b: str) -> int:
    if not a or not b or len(a) != len(b):
        return 1_000_000
    return sum(1 for x, y in zip(a, b) if x != y)


def match(b64_reference: str, b64_candidate: str, threshold: int = 90) -> tuple:
    """Returns (matched, distance, has_face_in_candidate)."""
    try:
        h_ref = compute_face_hash(b64_reference) if b64_reference else ""
        h_cand = compute_face_hash(b64_candidate)
        has_face = bool(h_cand)
        if not h_ref:
            # No enrolled reference — accept any image with a face (first-time enrollment)
            return has_face, 0, has_face
        d = hamming(h_ref, h_cand)
        return (d <= threshold), d, has_face
    except Exception:
        return False, 1_000_000, False
