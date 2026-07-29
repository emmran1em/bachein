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
from typing import Tuple, List, Dict, Any, Optional

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
    """Prefer Azure Speech (reliable, cross-platform). Falls back to OpenAI Whisper if a real sk- key is set. Else clean error."""
    if not audio_base64:
        return False, 0.0, "", [], []
    try:
        data = base64.b64decode(audio_base64)
    except Exception:
        return False, 0.0, "[invalid audio]", [], []

    transcript = ""

    # ---- Path 1: Azure Speech REST (short-audio API) ----
    az_key = os.environ.get("AZURE_SPEECH_KEY", "").strip()
    az_region = os.environ.get("AZURE_SPEECH_REGION", "").strip()
    if az_key and az_region:
        # Convert everything to 16kHz mono WAV first — Azure's most reliable format.
        wav = _try_ffmpeg_to_wav(data)
        if wav is None:
            wav = data  # last-resort fallback
        ct = "audio/wav; codecs=audio/pcm; samplerate=16000"

        url = f"https://{az_region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=detailed&profanity=raw"
        headers = {
            "Ocp-Apim-Subscription-Key": az_key,
            "Content-Type": ct,
            "Accept": "application/json",
        }
        try:
            async with httpx.AsyncClient(timeout=45.0) as client:
                resp = await client.post(url, headers=headers, content=wav)
            if resp.status_code == 200:
                body = resp.json()
                transcript = (body.get("DisplayText") or "").strip()
                if not transcript:
                    nbest = body.get("NBest") or []
                    if nbest:
                        transcript = (nbest[0].get("Display") or nbest[0].get("Lexical") or "").strip()
        except Exception:
            pass

    # ---- Path 2: OpenAI Whisper (only if real sk- key set) ----
    if not transcript:
        api_key = os.environ.get("BACHEIN_OPENAI_KEY", "").strip()
        if api_key and api_key.startswith("sk-"):
            suffix = ".m4a"
            if data[:4] == b"OggS": suffix = ".ogg"
            elif data[:3] == b"ID3" or data[:2] == b"\xff\xfb": suffix = ".mp3"
            elif b"WEBM" in data[:64]: suffix = ".webm"
            elif b"ftyp" in data[:64]: suffix = ".m4a"
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
                f.write(data); path = f.name
            try:
                async with httpx.AsyncClient(timeout=60.0) as client:
                    with open(path, "rb") as fh:
                        files = {"file": (os.path.basename(path), fh, "audio/m4a")}
                        headers = {"Authorization": f"Bearer {api_key}"}
                        resp = await client.post("https://api.openai.com/v1/audio/transcriptions", headers=headers, files=files, data={"model": "whisper-1", "language": "en"})
                if resp.status_code == 200:
                    transcript = (resp.json().get("text") or "").strip()
            except Exception:
                pass
            finally:
                try: os.unlink(path)
                except Exception: pass

    if not transcript:
        return False, 0.0, "[Server transcription unavailable — please read the words in your browser (Chrome/Edge/Safari) so live word highlighting can capture the oath.]", [], []

    m = match_words(expected, transcript)
    return m["matched"], m["similarity"], transcript, m["matched_words"], m["said_words"]


def _try_ffmpeg_to_wav(data: bytes) -> Optional[bytes]:
    """Convert arbitrary audio bytes to 16kHz mono WAV via ffmpeg CLI. Returns None on failure."""
    import subprocess, shutil, tempfile as _tf
    if not shutil.which("ffmpeg"): return None
    try:
        with _tf.NamedTemporaryFile(suffix=".bin", delete=False) as fi:
            fi.write(data); ipath = fi.name
        opath = ipath + ".wav"
        subprocess.run(["ffmpeg", "-y", "-i", ipath, "-ar", "16000", "-ac", "1", opath], capture_output=True, timeout=30)
        if os.path.exists(opath):
            with open(opath, "rb") as f: out = f.read()
            try: os.unlink(ipath); os.unlink(opath)
            except Exception: pass
            return out
    except Exception:
        return None
    return None
