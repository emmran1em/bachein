"""Voice oath: transcribe via OpenAI Whisper, do strict word-level match against required text.
Returns:
  matched (bool): every required word present in correct order (with light typo tolerance)
  similarity (float): 0-1 word-overlap ratio
  transcript (str): raw whisper output
  matched_words (list[bool]): per-required-word whether it was said
  said_words (list[str]): normalized tokens actually said
"""
import os
import base64
import tempfile
import re
import difflib
import httpx
from typing import Tuple, List, Dict, Any

EXPECTED_OATH = "I acknowledge this information is confidential and agree not to disclose it"


def _normalize(s: str) -> str:
    s = (s or "").lower()
    s = re.sub(r"[^a-z0-9' ]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _tokens(s: str) -> List[str]:
    return [t for t in _normalize(s).split() if t]


def _word_match(want: str, got_tokens: List[str], start_idx: int) -> int:
    """Return the index in got_tokens where `want` matches (or -1). Uses fuzzy match for tiny typos."""
    for i in range(start_idx, len(got_tokens)):
        w = got_tokens[i]
        if w == want:
            return i
        # Fuzzy: allow one-char typos for words >=4
        if len(want) >= 4 and difflib.SequenceMatcher(None, w, want).ratio() >= 0.85:
            return i
    return -1


def match_words(expected: str, transcript: str) -> Dict[str, Any]:
    """Determine per-required-word whether it was spoken (in order)."""
    req = _tokens(expected)
    got = _tokens(transcript)
    matched_flags: List[bool] = []
    cursor = 0
    for w in req:
        idx = _word_match(w, got, cursor)
        if idx >= 0:
            matched_flags.append(True)
            cursor = idx + 1
        else:
            matched_flags.append(False)
    all_matched = all(matched_flags) if matched_flags else False
    # similarity = matched_count / total
    sim = (sum(matched_flags) / len(matched_flags)) if matched_flags else 0.0
    return {
        "matched": all_matched,
        "similarity": sim,
        "matched_words": matched_flags,
        "required_words": req,
        "said_words": got,
    }


async def transcribe_and_match(audio_base64: str, expected: str = EXPECTED_OATH) -> Tuple[bool, float, str, List[bool], List[str]]:
    api_key = os.environ.get("BACHEIN_OPENAI_KEY", "").strip()
    # Guard: no real OpenAI key configured → don't call Whisper (would 401 with emergent key)
    if not api_key or not api_key.startswith("sk-"):
        return False, 0.0, "[server transcription unavailable — please use a browser that supports Web Speech API (Chrome, Edge, Safari) or ask sender to disable voice oath]", [], []
    if not audio_base64:
        return False, 0.0, "", [], []
    try:
        data = base64.b64decode(audio_base64)
    except Exception:
        return False, 0.0, "[invalid audio]", [], []
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
            return False, 0.0, f"[transcription error {resp.status_code}]", [], []
        body = resp.json()
        transcript = (body.get("text") or "").strip()
        m = match_words(expected, transcript)
        return m["matched"], m["similarity"], transcript, m["matched_words"], m["said_words"]
    except Exception as e:
        return False, 0.0, f"[transcription error: {e}]", [], []
    finally:
        try: os.unlink(path)
        except Exception: pass
