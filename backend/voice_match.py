"""Voice oath: transcribe via OpenAI Whisper, fuzzy-match against required text."""
import os
import base64
import tempfile
import re
import httpx
from typing import Tuple

EXPECTED_OATH = "i acknowledge this information is confidential and agree not to disclose it"


def _normalize(s: str) -> str:
    s = (s or "").lower()
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _similarity(a: str, b: str) -> float:
    A = set(_normalize(a).split())
    B = set(_normalize(b).split())
    if not A or not B:
        return 0.0
    inter = A & B
    union = A | B
    return len(inter) / len(union)


async def transcribe_and_match(audio_base64: str, expected: str = EXPECTED_OATH, threshold: float = 0.5) -> Tuple[bool, float, str]:
    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key or not audio_base64:
        return False, 0.0, ""
    try:
        data = base64.b64decode(audio_base64)
    except Exception:
        return False, 0.0, "[invalid audio]"
    suffix = ".m4a"
    if data[:4] == b"OggS":
        suffix = ".ogg"
    elif data[:3] == b"ID3" or data[:2] == b"\xff\xfb":
        suffix = ".mp3"
    elif b"WEBM" in data[:64]:
        suffix = ".webm"
    elif b"ftyp" in data[:64]:
        suffix = ".m4a"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
        f.write(data)
        path = f.name
    try:
        # Use Emergent's integrations proxy endpoint compatible with OpenAI Whisper
        url = "https://integrations.emergentagent.com/v1/openai/audio/transcriptions"
        headers = {"Authorization": f"Bearer {api_key}"}
        async with httpx.AsyncClient(timeout=60.0) as client:
            with open(path, "rb") as fh:
                files = {"file": (os.path.basename(path), fh, "audio/m4a")}
                resp = await client.post(url, headers=headers, files=files, data={"model": "whisper-1", "language": "en"})
        if resp.status_code != 200:
            # Fallback to direct OpenAI endpoint
            url2 = "https://api.openai.com/v1/audio/transcriptions"
            async with httpx.AsyncClient(timeout=60.0) as client:
                with open(path, "rb") as fh:
                    files = {"file": (os.path.basename(path), fh, "audio/m4a")}
                    resp = await client.post(url2, headers=headers, files=files, data={"model": "whisper-1", "language": "en"})
            if resp.status_code != 200:
                return False, 0.0, f"[transcription error {resp.status_code}: {resp.text[:200]}]"
        body = resp.json()
        transcript = (body.get("text") or "").strip()
        sim = _similarity(transcript, expected)
        return (sim >= threshold), sim, transcript
    except Exception as e:
        return False, 0.0, f"[transcription error: {e}]"
    finally:
        try: os.unlink(path)
        except Exception: pass
