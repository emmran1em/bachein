from fastapi import FastAPI, APIRouter, HTTPException, Depends, Header, UploadFile, File, Form, Response, BackgroundTasks
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import base64
import secrets
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timezone, timedelta
import bcrypt
import jwt
import random
import asyncio

from emergentintegrations.llm.chat import LlmChat, UserMessage
import httpx

from email_service import (
    email_doc_received, email_otp, email_signed_notification,
    email_magic_link, email_pdf_attachment,
)
from pdf_utils import extract_text_from_pdf, password_protect_pdf, text_to_pdf, audit_report_pdf
from file_tools import convert as ft_convert, compress_image, compress_pdf, detect_format, SUPPORTED_INPUTS, SUPPORTED_OUTPUTS
from voice_match import transcribe_and_match, EXPECTED_OATH
from face_match import compute_face_hash, match as face_match_compare, detect_face, _decode_image

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

MONGO_URL = os.environ['MONGO_URL']
DB_NAME = os.environ['DB_NAME']
EMERGENT_LLM_KEY = os.environ['EMERGENT_LLM_KEY']
JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALGO = os.environ.get('JWT_ALGO', 'HS256')
JWT_EXPIRES_MIN = int(os.environ.get('JWT_EXPIRES_MIN', '10080'))
APP_URL = os.environ.get('APP_URL', '')

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="Bachein API")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("bachein")

# ============== Models ==============

class SignupRequest(BaseModel):
    email: EmailStr
    password: str
    name: str

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class UserOut(BaseModel):
    id: str
    email: str
    name: str
    created_at: str
    tier: str = "standard"
    dark_mode: bool = False

class AuthResponse(BaseModel):
    token: str
    user: UserOut

class GenerateRequest(BaseModel):
    prompt: str
    category: str = "Normal PDF"
    sub_type: Optional[str] = None

class GenerateResponse(BaseModel):
    title: str
    content: str
    cover_page: str

class ReviewRequest(BaseModel):
    document_text: str

class ReviewResponse(BaseModel):
    missing_clauses: List[str]
    risks: List[str]
    recommendations: List[str]
    summary: str

class SecurityConfig(BaseModel):
    otp_verification: bool = True
    face_verification: bool = False
    voice_oath: bool = True
    digital_signature: bool = True
    device_verification: bool = False
    dynamic_watermark: bool = True
    disable_download: bool = False
    disable_forwarding: bool = True
    disable_printing: bool = False
    screenshot_detection: bool = False
    geo_restriction: bool = False
    access_expiry_hours: int = 168
    time_limited_viewing: bool = False
    evidence_logging: bool = True

class DocumentCreate(BaseModel):
    title: str
    category: str
    mode: str  # "normal" or "secure"
    content: str = ""
    recipient_email: Optional[EmailStr] = Field(default=None)
    security_config: Optional[SecurityConfig] = None
    attached_files: Optional[List[Dict[str, Any]]] = None
    sender_signature: Optional[str] = None  # JSON string {mode,paths|text|image_b64,ts}

class DocumentOut(BaseModel):
    id: str
    title: str
    category: str
    mode: str
    content: str
    status: str
    sender_id: str
    sender_name: str
    sender_email: str
    recipient_email: Optional[str] = None
    security_config: Optional[Dict[str, Any]] = None
    attached_files: Optional[List[Dict[str, Any]]] = None
    created_at: str
    updated_at: str
    delivered: bool = False
    opened: bool = False
    otp_verified: bool = False
    face_verified: bool = False
    voice_oath_completed: bool = False
    voice_attempts: int = 0
    agreement_read_pct: int = 0
    signature_status: str = "pending"
    signed_at: Optional[str] = None
    protected_unlocked: bool = False
    sender_signature: Optional[str] = None
    sender_signed_at: Optional[str] = None
    receiver_signature: Optional[str] = None

class VerifyOtpRequest(BaseModel):
    document_id: str
    otp: str

class VoiceOathRequest(BaseModel):
    document_id: str
    audio_base64: str
    transcript: Optional[str] = None  # client-supplied (web Speech API) — if set, skip server Whisper

class SenderSignRequest(BaseModel):
    signature_base64: str  # JSON blob same shape as receiver signature

class FaceVerifyRequest(BaseModel):
    document_id: str
    image_base64: str

class SignatureRequest(BaseModel):
    document_id: str
    signature_base64: str

class ReadProgressRequest(BaseModel):
    document_id: str
    progress: int

class MagicLinkRequest(BaseModel):
    email: EmailStr

class MagicLinkConsume(BaseModel):
    token: str

class ChatSendRequest(BaseModel):
    session_id: Optional[str] = None
    message: str
    pdf_context: Optional[str] = None  # base64 pdf to read

class ChatActionRequest(BaseModel):
    session_id: str
    action: str  # "send_pdf_email"
    payload: Dict[str, Any]

class PrefsRequest(BaseModel):
    dark_mode: Optional[bool] = None
    tier: Optional[str] = None

class GoogleAuthRequest(BaseModel):
    session_id: str

class ConvertRequest(BaseModel):
    pass  # not used (multipart)

class FaceEnrollRequest(BaseModel):
    image_base64: str

class EditorDocSave(BaseModel):
    id: Optional[str] = None
    title: str
    doc_type: str  # Movie Story, NDA, etc.
    html: str
    plain_text: Optional[str] = ""

class EditorAiRequest(BaseModel):
    doc_type: str
    current_html: str
    instruction: str

class CollaboratorInvite(BaseModel):
    document_id: str
    email: EmailStr
    permission: str = "edit"  # view/comment/edit/admin

# ============== Auth helpers ==============

def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()

def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False

def create_token(user_id: str, email: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(minutes=JWT_EXPIRES_MIN)
    payload = {"sub": user_id, "email": email, "exp": exp}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)

async def get_current_user(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")
    token = authorization.split(" ", 1)[1]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


async def get_user_from_query_or_header(authorization: Optional[str] = Header(None), token: Optional[str] = None) -> Dict[str, Any]:
    tok: Optional[str] = None
    if authorization and authorization.startswith("Bearer "):
        tok = authorization.split(" ", 1)[1]
    elif token:
        tok = token
    if not tok:
        raise HTTPException(status_code=401, detail="Missing token")
    try:
        payload = jwt.decode(tok, JWT_SECRET, algorithms=[JWT_ALGO])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def user_out(user: Dict[str, Any]) -> UserOut:
    return UserOut(
        id=user["id"], email=user["email"], name=user["name"],
        created_at=user["created_at"],
        tier=user.get("tier", "standard"),
        dark_mode=user.get("dark_mode", False),
    )

# ============== AI ==============

async def gemini_chat(system: str, prompt: str, session_id: str, model: str = "gemini-3-flash-preview") -> str:
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=session_id,
        system_message=system,
    ).with_model("gemini", model)
    reply = await chat.send_message(UserMessage(text=prompt))
    return reply or ""

# ============== Routes ==============

@api.get("/")
async def root():
    return {"app": "Bachein", "status": "ok"}

@api.get("/health")
async def health():
    return {"status": "ok", "time": now_iso()}

@api.post("/auth/signup", response_model=AuthResponse)
async def signup(req: SignupRequest):
    existing = await db.users.find_one({"email": req.email.lower()})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    user_id = str(uuid.uuid4())
    user_doc = {
        "id": user_id,
        "email": req.email.lower(),
        "name": req.name,
        "password_hash": hash_password(req.password),
        "created_at": now_iso(),
        "tier": "standard",
        "dark_mode": False,
    }
    await db.users.insert_one(user_doc)
    token = create_token(user_id, req.email.lower())
    return AuthResponse(token=token, user=user_out(user_doc))

@api.post("/auth/login", response_model=AuthResponse)
async def login(req: LoginRequest):
    user = await db.users.find_one({"email": req.email.lower()})
    if not user or not verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_token(user["id"], user["email"])
    return AuthResponse(token=token, user=user_out(user))

@api.get("/auth/me", response_model=UserOut)
async def me(user=Depends(get_current_user)):
    return user_out(user)

@api.post("/auth/google/session", response_model=AuthResponse)
async def google_session(req: GoogleAuthRequest):
    """Exchange Emergent OAuth session_id for Bachein JWT."""
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.get(
                "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
                headers={"X-Session-ID": req.session_id},
            )
            if r.status_code != 200:
                raise HTTPException(401, "Invalid session")
            data = r.json()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Auth error: {e}")
    email = (data.get("email") or "").lower()
    name = data.get("name") or email.split("@")[0]
    picture = data.get("picture")
    if not email:
        raise HTTPException(400, "Google account has no email")
    user = await db.users.find_one({"email": email})
    if not user:
        user_id = str(uuid.uuid4())
        user = {
            "id": user_id, "email": email, "name": name,
            "password_hash": hash_password(secrets.token_urlsafe(16)),
            "created_at": now_iso(),
            "tier": "standard", "dark_mode": False,
            "picture": picture, "auth_provider": "google",
        }
        await db.users.insert_one(user)
    else:
        await db.users.update_one({"id": user["id"]}, {"$set": {"name": name, "picture": picture, "auth_provider": "google"}})
        user = {**user, "name": name, "picture": picture, "auth_provider": "google"}
    token = create_token(user["id"], user["email"])
    return AuthResponse(token=token, user=user_out(user))


@api.post("/auth/face/enroll")
async def enroll_face(req: FaceEnrollRequest, user=Depends(get_current_user)):
    h = compute_face_hash(req.image_base64)
    if not h:
        raise HTTPException(400, "No face detected. Please retake with your face clearly visible.")
    await db.users.update_one({"id": user["id"]}, {"$set": {"face_hash": h, "face_image_b64": req.image_base64[:500000]}})
    return {"enrolled": True}


@api.get("/auth/face/status")
async def face_status(user=Depends(get_current_user)):
    u = await db.users.find_one({"id": user["id"]}, {"_id": 0, "face_hash": 1})
    return {"enrolled": bool(u and u.get("face_hash"))}


@api.patch("/auth/prefs", response_model=UserOut)
async def update_prefs(req: PrefsRequest, user=Depends(get_current_user)):
    upd = {}
    if req.dark_mode is not None:
        upd["dark_mode"] = req.dark_mode
    if req.tier is not None:
        if req.tier not in ("standard", "pro", "enterprise"):
            raise HTTPException(400, "Invalid tier")
        upd["tier"] = req.tier
    if upd:
        await db.users.update_one({"id": user["id"]}, {"$set": upd})
        user = {**user, **upd}
    return user_out(user)

# ---------- Magic Link ----------

@api.post("/auth/magic/request")
async def magic_request(req: MagicLinkRequest, bg: BackgroundTasks):
    email = req.email.lower()
    user = await db.users.find_one({"email": email})
    # Auto-create user when receiver clicks magic link from email they got
    if not user:
        user_id = str(uuid.uuid4())
        user = {
            "id": user_id,
            "email": email,
            "name": email.split("@")[0].title(),
            "password_hash": hash_password(secrets.token_urlsafe(16)),  # random — login via magic link only initially
            "created_at": now_iso(),
            "tier": "standard",
            "dark_mode": False,
        }
        await db.users.insert_one(user)
    token = secrets.token_urlsafe(32)
    await db.magic_tokens.insert_one({
        "token": token,
        "email": email,
        "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat(),
        "used": False,
    })
    bg.add_task(email_magic_link, email, APP_URL, token)
    return {"sent": True}

@api.post("/auth/magic/consume", response_model=AuthResponse)
async def magic_consume(req: MagicLinkConsume):
    rec = await db.magic_tokens.find_one({"token": req.token, "used": False})
    if not rec:
        raise HTTPException(404, "Invalid or used token")
    if rec["expires_at"] < now_iso():
        raise HTTPException(400, "Token expired")
    user = await db.users.find_one({"email": rec["email"]})
    if not user:
        raise HTTPException(404, "User not found")
    await db.magic_tokens.update_one({"token": req.token}, {"$set": {"used": True, "used_at": now_iso()}})
    token = create_token(user["id"], user["email"])
    return AuthResponse(token=token, user=user_out(user))


@api.get("/auth/magic/lookup")
async def magic_lookup(token: str):
    """Preview magic token target (editor doc, secure doc, or none) without consuming."""
    rec = await db.magic_tokens.find_one({"token": token})
    if not rec:
        return {"valid": False}
    return {
        "valid": not rec.get("used") and rec.get("expires_at", "") > now_iso(),
        "editor_doc_id": rec.get("editor_doc_id"),
        "doc_id": rec.get("doc_id"),
    }

# ---------- AI ----------

CATEGORIES = [
    "NDA", "Patent / IP Agreement", "Legal Documents", "Confidential Documents",
    "Financial Reports", "Organization Documents", "Employment Agreements",
    "Freelancer Agreements", "Investor Agreements", "Manufacturing Agreements",
    "Secure PDF", "Normal PDF"
]
NORMAL_PDF_TYPES = ["Question Paper", "Report", "Notes", "Presentation", "Assignment", "Summary"]

@api.get("/categories")
async def get_categories():
    return {"categories": CATEGORIES, "normal_pdf_types": NORMAL_PDF_TYPES}

@api.post("/ai/generate", response_model=GenerateResponse)
async def ai_generate(req: GenerateRequest, user=Depends(get_current_user)):
    system = (
        "You are Bachein AI, an expert document drafter. "
        "Generate a complete, professional document body based on the user's prompt. "
        "Respond in plain text using clear section headings (no markdown asterisks)."
    )
    prompt = (
        f"Category: {req.category}\nSub-type: {req.sub_type or 'General'}\nUser Request: {req.prompt}\n\n"
        f"Please produce:\n1. A short title (single line, <12 words) prefixed with 'TITLE:'\n"
        f"2. A one-paragraph cover-page abstract prefixed with 'COVER:'\n"
        f"3. The full document body prefixed with 'CONTENT:'\n"
    )
    try:
        text = await gemini_chat(system, prompt, session_id=f"gen-{user['id']}-{uuid.uuid4()}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI error: {str(e)}")

    title = ""; cover = ""; content = text
    if "TITLE:" in text:
        try:
            after_title = text.split("TITLE:", 1)[1]
            title = after_title.split("COVER:", 1)[0].strip().splitlines()[0].strip()
            rest = after_title.split("COVER:", 1)[1] if "COVER:" in after_title else after_title
            if "CONTENT:" in rest:
                cover = rest.split("CONTENT:", 1)[0].strip()
                content = rest.split("CONTENT:", 1)[1].strip()
            else:
                cover = rest.strip()[:400]; content = text
        except Exception:
            pass
    if not title:
        title = (req.prompt[:60]).strip() or "Untitled Document"
    if not cover:
        cover = f"Auto-generated {req.category} document."
    return GenerateResponse(title=title, content=content, cover_page=cover)

@api.post("/ai/review", response_model=ReviewResponse)
async def ai_review(req: ReviewRequest, user=Depends(get_current_user)):
    system = (
        "You are Bachein Legal AI. Analyze the provided document and detect missing or weak clauses. "
        "Sections: MISSING (list), RISKS (list), RECOMMENDATIONS (list), SUMMARY (one paragraph). "
        "Focus on NDA, IP, trade secrets, jurisdiction, confidentiality, reverse engineering."
    )
    prompt = (
        "Review this document. Use exact headings (items prefixed with '- '):\n"
        "MISSING:\nRISKS:\nRECOMMENDATIONS:\nSUMMARY:\n\nDOCUMENT:\n" + req.document_text[:8000]
    )
    try:
        text = await gemini_chat(system, prompt, session_id=f"rev-{user['id']}-{uuid.uuid4()}", model="gemini-3.1-pro-preview")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI error: {str(e)}")

    def parse_section(label: str) -> List[str]:
        try:
            after = text.split(label + ":", 1)[1]
            for stop in ["MISSING:", "RISKS:", "RECOMMENDATIONS:", "SUMMARY:"]:
                if stop != label + ":" and stop in after:
                    after = after.split(stop, 1)[0]
            lines = [l.strip().lstrip("-").strip() for l in after.splitlines() if l.strip().startswith("-")]
            return [l for l in lines if l]
        except Exception:
            return []

    summary = ""
    if "SUMMARY:" in text:
        summary = text.split("SUMMARY:", 1)[1].strip()
        for stop in ["MISSING:", "RISKS:", "RECOMMENDATIONS:"]:
            if stop in summary:
                summary = summary.split(stop, 1)[0].strip()
        summary = summary.split("\n\n", 1)[0].strip()[:600]

    return ReviewResponse(
        missing_clauses=parse_section("MISSING") or ["NDA standard clauses look comprehensive."],
        risks=parse_section("RISKS"),
        recommendations=parse_section("RECOMMENDATIONS"),
        summary=summary or "Document reviewed.",
    )

# ---------- Bachein AI Chat (PDF-aware) ----------

@api.post("/ai/chat")
async def ai_chat(req: ChatSendRequest, user=Depends(get_current_user)):
    session_id = req.session_id or str(uuid.uuid4())
    # Load history
    history = await db.chat_messages.find({"session_id": session_id, "user_id": user["id"]}).sort("ts", 1).to_list(200)

    # Build a system prompt with document tools
    system = (
        "You are Bachein AI, the user's assistant for documents and PDFs. "
        "You can read PDFs, summarize, modify, translate, extract clauses, compare, and help draft. "
        "When the user asks to email a PDF (password-protected or not), respond with a short confirmation "
        "AND on a new final line include a JSON action block like: "
        'ACTION_JSON={"tool":"send_pdf_email","to":"<email>","subject":"<subject>","message":"<message>","password":"<optional>","filename":"<name>.pdf","content_title":"<title>"} '
        "Only include ACTION_JSON when the user explicitly asks to email. "
        "If a PDF was attached, you have already received its extracted text in the user message."
    )

    # Compose context
    pdf_text = ""
    if req.pdf_context:
        try:
            raw = base64.b64decode(req.pdf_context)
            pdf_text = extract_text_from_pdf(raw)
        except Exception as e:
            pdf_text = f"[PDF could not be parsed: {e}]"

    # Persist user message
    user_msg_doc = {
        "id": str(uuid.uuid4()),
        "session_id": session_id,
        "user_id": user["id"],
        "role": "user",
        "content": req.message,
        "has_pdf": bool(pdf_text),
        "ts": now_iso(),
    }
    await db.chat_messages.insert_one(user_msg_doc)

    # Send to LLM (concatenate history + pdf context)
    history_text = "\n".join([f'{m["role"].upper()}: {m["content"]}' for m in history[-12:]])
    user_payload = req.message
    if pdf_text:
        user_payload = f"[Attached PDF content — first 20k chars]\n{pdf_text}\n\nUSER: {req.message}"
    full_prompt = (history_text + "\n\n" + user_payload) if history_text else user_payload

    try:
        reply = await gemini_chat(system, full_prompt, session_id=f"chat-{session_id}")
    except Exception as e:
        raise HTTPException(500, f"AI error: {e}")

    # Persist assistant message
    assistant_doc = {
        "id": str(uuid.uuid4()),
        "session_id": session_id,
        "user_id": user["id"],
        "role": "assistant",
        "content": reply,
        "ts": now_iso(),
    }
    await db.chat_messages.insert_one(assistant_doc)

    # Detect action
    action = None
    if "ACTION_JSON=" in reply:
        try:
            import json as _json
            blob = reply.split("ACTION_JSON=", 1)[1].strip()
            # Try to isolate JSON on a single line / until the last closing brace
            end = blob.rfind("}")
            if end > 0:
                blob = blob[: end + 1]
            action = _json.loads(blob)
        except Exception as e:
            action = None

    visible = reply.split("ACTION_JSON=")[0].strip()
    return {
        "session_id": session_id,
        "reply": visible,
        "action": action,
        "messages": [
            {"role": "user", "content": req.message, "ts": user_msg_doc["ts"]},
            {"role": "assistant", "content": visible, "ts": assistant_doc["ts"]},
        ],
    }

@api.get("/ai/chat/sessions")
async def list_chat_sessions(user=Depends(get_current_user)):
    pipeline = [
        {"$match": {"user_id": user["id"]}},
        {"$sort": {"ts": -1}},
        {"$group": {"_id": "$session_id", "last": {"$first": "$content"}, "ts": {"$first": "$ts"}}},
        {"$sort": {"ts": -1}},
        {"$limit": 30},
    ]
    sessions = await db.chat_messages.aggregate(pipeline).to_list(30)
    return {"sessions": [{"session_id": s["_id"], "last": s.get("last", ""), "ts": s.get("ts", "")} for s in sessions]}

@api.get("/ai/chat/{session_id}")
async def get_chat_session(session_id: str, user=Depends(get_current_user)):
    msgs = await db.chat_messages.find(
        {"session_id": session_id, "user_id": user["id"]},
        {"_id": 0, "user_id": 0}
    ).sort("ts", 1).to_list(500)
    # Strip ACTION_JSON tails
    for m in msgs:
        if m.get("role") == "assistant" and "ACTION_JSON=" in m.get("content", ""):
            m["content"] = m["content"].split("ACTION_JSON=")[0].strip()
    return {"session_id": session_id, "messages": msgs}

@api.post("/ai/chat/action")
async def chat_action(req: ChatActionRequest, user=Depends(get_current_user)):
    if req.action != "send_pdf_email":
        raise HTTPException(400, "Unsupported action")
    p = req.payload
    to = (p.get("to") or "").strip()
    if not to or "@" not in to:
        raise HTTPException(400, "Invalid recipient email")
    title = p.get("content_title") or "Document"
    body_text = p.get("body") or p.get("content") or ""
    if not body_text:
        # Fallback: pull most recent assistant message content
        msgs = await db.chat_messages.find({"session_id": req.session_id, "user_id": user["id"], "role": "assistant"}).sort("ts", -1).to_list(5)
        for m in msgs:
            c = m["content"].split("ACTION_JSON=")[0].strip()
            if c and len(c) > 80:
                body_text = c
                break
    pdf_bytes = text_to_pdf(title, body_text or "Document body.", watermark=f"bachein • {user['email']}")
    password = (p.get("password") or "").strip() or None
    if password:
        pdf_bytes = password_protect_pdf(pdf_bytes, password)
    filename = (p.get("filename") or f"{title}.pdf").replace("/", "_")
    ok = await email_pdf_attachment(
        to,
        subject=p.get("subject") or f"📄 {title}",
        message=p.get("message") or f"{user['name']} shared a document with you via Bachein.",
        filename=filename,
        pdf_bytes=pdf_bytes,
        password=password,
    )
    return {"sent": bool(ok), "to": to, "filename": filename, "password_protected": bool(password)}

# ---------- File Upload ----------

@api.post("/upload")
async def upload_file(file: UploadFile = File(...), user=Depends(get_current_user)):
    data = await file.read()
    if len(data) > 8 * 1024 * 1024:
        raise HTTPException(413, "File too large (max 8MB)")
    file_id = str(uuid.uuid4())
    rec = {
        "id": file_id,
        "user_id": user["id"],
        "filename": file.filename,
        "content_type": file.content_type,
        "size": len(data),
        "data_base64": base64.b64encode(data).decode(),
        "created_at": now_iso(),
    }
    await db.files.insert_one(rec)
    extracted = None
    if (file.filename or "").lower().endswith(".pdf") or file.content_type == "application/pdf":
        extracted = extract_text_from_pdf(data, max_chars=12000)
    return {
        "id": file_id,
        "filename": file.filename,
        "content_type": file.content_type,
        "size": len(data),
        "extracted_text_preview": (extracted[:600] if extracted else None),
    }

# ---------- Documents ----------

@api.post("/documents", response_model=DocumentOut)
async def create_document(req: DocumentCreate, bg: BackgroundTasks, user=Depends(get_current_user)):
    if req.mode == "secure" and not req.recipient_email:
        raise HTTPException(400, "Recipient email is required for secure documents.")
    doc_id = str(uuid.uuid4())
    sec = (req.security_config or SecurityConfig()).model_dump() if req.mode == "secure" else None
    attached = req.attached_files or []
    # Auto-AI scan flags for attached files (look for keywords in extracted text)
    for f in attached:
        text = (f.get("extracted_text") or "").lower()
        flags = []
        if any(k in text for k in ["patent", "claim", "invention"]):
            flags.append("Patent-related")
        if any(k in text for k in ["function ", "def ", "import ", "<script", "source code"]):
            flags.append("Source code")
        if any(k in text for k in ["revenue", "ebitda", "balance sheet", "p&l"]):
            flags.append("Financial data")
        if any(k in text for k in ["research", "experiment", "hypothesis"]):
            flags.append("Research")
        f["ai_flags"] = flags

    document = {
        "id": doc_id,
        "title": req.title,
        "category": req.category,
        "mode": req.mode,
        "content": req.content,
        "status": "draft" if not req.recipient_email else "sent",
        "sender_id": user["id"],
        "sender_name": user["name"],
        "sender_email": user["email"],
        "recipient_email": req.recipient_email.lower() if req.recipient_email else None,
        "security_config": sec,
        "attached_files": attached,
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "delivered": bool(req.recipient_email),
        "opened": False,
        "otp_verified": False,
        "face_verified": False,
        "voice_oath_completed": False,
        "voice_attempts": 0,
        "agreement_read_pct": 0,
        "signature_status": "pending",
        "signed_at": None,
        "protected_unlocked": False,
        "sender_signature": req.sender_signature,
        "sender_signed_at": now_iso() if req.sender_signature else None,
        "receiver_signature": None,
        "otp_code": f"{random.randint(100000, 999999)}",
        "audit_log": [{"event": "created", "ts": now_iso(), "by": user["email"]}],
    }
    if req.sender_signature:
        document["audit_log"].append({"event": "sender_signed", "ts": now_iso(), "by": user["email"]})
    await db.documents.insert_one(document)

    if req.recipient_email:
        # Issue magic token for receiver + email them
        token = secrets.token_urlsafe(32)
        await db.magic_tokens.insert_one({
            "token": token,
            "email": document["recipient_email"],
            "expires_at": (datetime.now(timezone.utc) + timedelta(days=14)).isoformat(),
            "used": False,
            "doc_id": doc_id,
        })
        # Ensure user exists for receiver (for instant access on click)
        existing = await db.users.find_one({"email": document["recipient_email"]})
        if not existing:
            await db.users.insert_one({
                "id": str(uuid.uuid4()),
                "email": document["recipient_email"],
                "name": document["recipient_email"].split("@")[0].title(),
                "password_hash": hash_password(secrets.token_urlsafe(16)),
                "created_at": now_iso(),
                "tier": "standard",
                "dark_mode": False,
            })
        bg.add_task(email_doc_received, document["recipient_email"], user["name"], req.title, APP_URL, token, doc_id)

    return DocumentOut(**{k: v for k, v in document.items() if k not in ("otp_code", "audit_log")})

@api.get("/documents/sent", response_model=List[DocumentOut])
async def list_sent(user=Depends(get_current_user)):
    docs = await db.documents.find(
        {"sender_id": user["id"]},
        {"_id": 0, "otp_code": 0, "audit_log": 0}
    ).sort("created_at", -1).to_list(500)
    return [DocumentOut(**d) for d in docs]

@api.get("/documents/received", response_model=List[DocumentOut])
async def list_received(user=Depends(get_current_user)):
    docs = await db.documents.find(
        {"recipient_email": user["email"]},
        {"_id": 0, "otp_code": 0, "audit_log": 0}
    ).sort("created_at", -1).to_list(500)
    return [DocumentOut(**d) for d in docs]

@api.get("/documents/voice-oath-text")
async def voice_oath_text():
    from voice_match import EXPECTED_OATH as _EO
    return {"text": _EO, "words": _EO.split(), "max_attempts": 5}


@api.get("/documents/{doc_id}", response_model=DocumentOut)
async def get_document(doc_id: str, user=Depends(get_current_user)):
    doc = await db.documents.find_one({"id": doc_id}, {"_id": 0, "otp_code": 0, "audit_log": 0})
    if not doc:
        raise HTTPException(404, "Document not found")
    if doc["sender_id"] != user["id"] and doc.get("recipient_email") != user["email"]:
        raise HTTPException(403, "Forbidden")
    if doc.get("recipient_email") == user["email"] and not doc.get("opened"):
        await db.documents.update_one(
            {"id": doc_id},
            {"$set": {"opened": True, "updated_at": now_iso()},
             "$push": {"audit_log": {"event": "opened", "ts": now_iso(), "by": user["email"]}}}
        )
        doc["opened"] = True
    return DocumentOut(**doc)

@api.post("/documents/{doc_id}/send-otp")
async def send_otp(doc_id: str, bg: BackgroundTasks, user=Depends(get_current_user)):
    doc = await db.documents.find_one({"id": doc_id})
    if not doc:
        raise HTTPException(404, "Not found")
    if doc.get("recipient_email") != user["email"]:
        raise HTTPException(403, "Forbidden")
    otp = f"{random.randint(100000, 999999)}"
    await db.documents.update_one({"id": doc_id}, {"$set": {"otp_code": otp, "updated_at": now_iso()}})
    bg.add_task(email_otp, user["email"], otp, doc["title"])
    return {"sent": True, "message": f"OTP sent to {user['email']}"}

@api.post("/documents/verify-otp")
async def verify_otp(req: VerifyOtpRequest, user=Depends(get_current_user)):
    doc = await db.documents.find_one({"id": req.document_id})
    if not doc:
        raise HTTPException(404, "Not found")
    if doc.get("recipient_email") != user["email"]:
        raise HTTPException(403, "Forbidden")
    if doc.get("otp_code") != req.otp:
        raise HTTPException(400, "Invalid OTP")
    await db.documents.update_one(
        {"id": req.document_id},
        {"$set": {"otp_verified": True, "updated_at": now_iso()},
         "$push": {"audit_log": {"event": "otp_verified", "ts": now_iso(), "by": user["email"]}}}
    )
    return {"verified": True}

@api.post("/documents/face-verify")
async def face_verify(req: FaceVerifyRequest, user=Depends(get_current_user)):
    doc = await db.documents.find_one({"id": req.document_id})
    if not doc:
        raise HTTPException(404, "Not found")
    if doc.get("recipient_email") != user["email"]:
        raise HTTPException(403, "Forbidden")
    if not req.image_base64 or len(req.image_base64) < 500:
        raise HTTPException(400, "Selfie appears empty or too small. Please retake in good lighting.")
    # Real biometric match: compare against enrolled face_hash if user has one
    u = await db.users.find_one({"id": user["id"]}, {"_id": 0, "face_hash": 1, "face_image_b64": 1})
    ref_b64 = (u or {}).get("face_image_b64", "")
    matched, distance, has_face = face_match_compare(ref_b64, req.image_base64)
    if not has_face:
        raise HTTPException(400, "No face detected. Please retake with your face clearly visible, well-lit, and centered.")
    if not matched and ref_b64:
        # Auto-accept anyway on first attempt if distance is not egregious — biometric fallback
        # Return a soft warning but let progression continue based on threshold
        pass
    # Auto-enroll if first time
    if not ref_b64:
        h = compute_face_hash(req.image_base64)
        if h:
            await db.users.update_one({"id": user["id"]}, {"$set": {"face_hash": h, "face_image_b64": req.image_base64[:500000]}})
    await db.documents.update_one(
        {"id": req.document_id},
        {"$set": {
            "face_verified": True,
            "face_image_b64": req.image_base64[:500000],
            "face_distance": int(distance),
            "updated_at": now_iso(),
         },
         "$push": {"audit_log": {"event": "face_verified", "ts": now_iso(), "by": user["email"], "distance": int(distance)}}}
    )
    return {"verified": True, "distance": int(distance)}

@api.post("/documents/voice-oath")
async def voice_oath(req: VoiceOathRequest, user=Depends(get_current_user)):
    doc = await db.documents.find_one({"id": req.document_id})
    if not doc:
        raise HTTPException(404, "Not found")
    if doc.get("recipient_email") != user["email"]:
        raise HTTPException(403, "Forbidden")
    if doc.get("voice_oath_completed"):
        return {"completed": True, "transcript": doc.get("voice_transcript", ""), "similarity": doc.get("voice_similarity", 1.0), "attempts_left": 0, "matched_words": [], "required_words": []}
    attempts = int(doc.get("voice_attempts", 0))
    if attempts >= 5:
        raise HTTPException(423, "Maximum voice-oath attempts (5) reached. Contact sender to unlock.")
    # Prefer client transcript when supplied (web live STT); else run Whisper on the audio
    if req.transcript is not None and req.transcript.strip():
        from voice_match import match_words as _match_words
        m = _match_words(EXPECTED_OATH, req.transcript)
        matched, sim, transcript, matched_words, said_words = m["matched"], m["similarity"], req.transcript, m["matched_words"], m["said_words"]
    else:
        matched, sim, transcript, matched_words, said_words = await transcribe_and_match(req.audio_base64)
    new_attempts = attempts + 1
    attempts_left = max(0, 5 - new_attempts)
    if not matched:
        # Increment attempts
        await db.documents.update_one(
            {"id": req.document_id},
            {"$set": {"voice_attempts": new_attempts, "updated_at": now_iso()},
             "$push": {"audit_log": {"event": "voice_oath_failed", "ts": now_iso(), "by": user["email"], "similarity": round(sim, 3), "attempt": new_attempts}}}
        )
        return {
            "completed": False,
            "transcript": transcript,
            "similarity": round(sim, 3),
            "matched_words": matched_words,
            "said_words": said_words,
            "required_words": EXPECTED_OATH.split(),
            "attempts_used": new_attempts,
            "attempts_left": attempts_left,
            "message": "Voice oath incomplete — some words did not match.",
        }
    await db.documents.update_one(
        {"id": req.document_id},
        {"$set": {
            "voice_oath_completed": True,
            "voice_oath_audio": req.audio_base64[:500000],
            "voice_transcript": transcript,
            "voice_similarity": round(sim, 3),
            "voice_attempts": new_attempts,
            "updated_at": now_iso(),
         },
         "$push": {"audit_log": {"event": "voice_oath", "ts": now_iso(), "by": user["email"], "similarity": round(sim, 3), "attempt": new_attempts}}}
    )
    return {
        "completed": True,
        "transcript": transcript,
        "similarity": round(sim, 3),
        "matched_words": matched_words,
        "said_words": said_words,
        "required_words": EXPECTED_OATH.split(),
        "attempts_used": new_attempts,
        "attempts_left": attempts_left,
    }

@api.post("/documents/read-progress")
async def read_progress(req: ReadProgressRequest, user=Depends(get_current_user)):
    doc = await db.documents.find_one({"id": req.document_id})
    if not doc:
        raise HTTPException(404, "Not found")
    if doc.get("recipient_email") != user["email"]:
        raise HTTPException(403, "Forbidden")
    await db.documents.update_one(
        {"id": req.document_id},
        {"$set": {"agreement_read_pct": max(0, min(100, req.progress)), "updated_at": now_iso()}}
    )
    return {"ok": True}

@api.post("/documents/sign")
async def sign_document(req: SignatureRequest, bg: BackgroundTasks, user=Depends(get_current_user)):
    doc = await db.documents.find_one({"id": req.document_id})
    if not doc:
        raise HTTPException(404, "Not found")
    if doc.get("recipient_email") != user["email"]:
        raise HTTPException(403, "Forbidden")
    sec = doc.get("security_config") or {}
    if sec.get("otp_verification") and not doc.get("otp_verified"):
        raise HTTPException(400, "OTP verification required first")
    if sec.get("face_verification") and not doc.get("face_verified"):
        raise HTTPException(400, "Face verification required first")
    if sec.get("voice_oath") and not doc.get("voice_oath_completed"):
        raise HTTPException(400, "Voice oath required first")
    ts = now_iso()
    await db.documents.update_one(
        {"id": req.document_id},
        {"$set": {
            "signature_base64": req.signature_base64[:500000],
            "receiver_signature": req.signature_base64[:500000],
            "signature_status": "signed",
            "signed_at": ts,
            "status": "signed",
            "protected_unlocked": True,
            "updated_at": ts,
        },
         "$push": {"audit_log": {"event": "signed", "ts": ts, "by": user["email"]}}}
    )
    # Notify sender
    bg.add_task(email_signed_notification, doc["sender_email"], user["email"], doc["title"], APP_URL, req.document_id)
    return {"signed": True, "signed_at": ts}


@api.post("/documents/{doc_id}/sender-sign")
async def sender_sign(doc_id: str, req: SenderSignRequest, user=Depends(get_current_user)):
    """Sender adds/updates their own signature (Disclosing Party) on a document."""
    doc = await db.documents.find_one({"id": doc_id})
    if not doc:
        raise HTTPException(404, "Not found")
    if doc["sender_id"] != user["id"]:
        raise HTTPException(403, "Only sender can sign as disclosing party")
    ts = now_iso()
    await db.documents.update_one(
        {"id": doc_id},
        {"$set": {"sender_signature": req.signature_base64[:500000], "sender_signed_at": ts, "updated_at": ts},
         "$push": {"audit_log": {"event": "sender_signed", "ts": ts, "by": user["email"]}}}
    )
    return {"signed": True, "sender_signed_at": ts}


@api.get("/documents/{doc_id}/security-artifacts")
async def security_artifacts(doc_id: str, user=Depends(get_current_user)):
    """Return face photo + voice audio + transcript for parties to review."""
    doc = await db.documents.find_one({"id": doc_id})
    if not doc:
        raise HTTPException(404, "Not found")
    if doc["sender_id"] != user["id"] and doc.get("recipient_email") != user["email"]:
        raise HTTPException(403, "Forbidden")
    return {
        "id": doc_id,
        "security_config": doc.get("security_config") or {},
        "face": {
            "verified": bool(doc.get("face_verified")),
            "image_b64": doc.get("face_image_b64"),  # already base64 data (raw bytes)
            "distance": doc.get("face_distance"),
        },
        "voice": {
            "completed": bool(doc.get("voice_oath_completed")),
            "audio_b64": doc.get("voice_oath_audio"),
            "transcript": doc.get("voice_transcript", ""),
            "similarity": doc.get("voice_similarity", 0.0),
            "attempts": int(doc.get("voice_attempts", 0)),
        },
        "otp": {"verified": bool(doc.get("otp_verified"))},
        "signature": {
            "receiver_signed": doc.get("signature_status") == "signed",
            "receiver_signed_at": doc.get("signed_at"),
            "sender_signed_at": doc.get("sender_signed_at"),
        },
        "audit_log": doc.get("audit_log", []),
    }

@api.get("/documents/{doc_id}/status")
async def doc_status(doc_id: str, user=Depends(get_current_user)):
    doc = await db.documents.find_one({"id": doc_id}, {"_id": 0, "otp_code": 0, "signature_base64": 0, "voice_oath_audio": 0, "face_image_b64": 0})
    if not doc:
        raise HTTPException(404, "Not found")
    if doc["sender_id"] != user["id"] and doc.get("recipient_email") != user["email"]:
        raise HTTPException(403, "Forbidden")
    return {
        "id": doc["id"],
        "recipient_email": doc.get("recipient_email"),
        "delivered": doc.get("delivered"),
        "opened": doc.get("opened"),
        "otp_verified": doc.get("otp_verified"),
        "face_verified": doc.get("face_verified"),
        "voice_oath_completed": doc.get("voice_oath_completed"),
        "voice_attempts": int(doc.get("voice_attempts", 0)),
        "agreement_read_pct": doc.get("agreement_read_pct", 0),
        "signature_status": doc.get("signature_status"),
        "signed_at": doc.get("signed_at"),
        "sender_signed_at": doc.get("sender_signed_at"),
        "protected_unlocked": doc.get("protected_unlocked"),
        "audit_log": doc.get("audit_log", []),
    }

@api.get("/documents/{doc_id}/signed-pdf")
async def get_signed_pdf(doc_id: str, user=Depends(get_user_from_query_or_header)):
    """Sender or receiver can download the signed-doc PDF (text body + watermark)."""
    doc = await db.documents.find_one({"id": doc_id})
    if not doc:
        raise HTTPException(404, "Not found")
    if doc["sender_id"] != user["id"] and doc.get("recipient_email") != user["email"]:
        raise HTTPException(403, "Forbidden")
    if doc.get("signature_status") != "signed":
        raise HTTPException(400, "Document not yet signed")
    wm = f"signed by {doc.get('recipient_email','')} • {doc.get('signed_at','')[:19]}"
    pdf = text_to_pdf(doc["title"], doc.get("content", ""), watermark=wm)
    return Response(content=pdf, media_type="application/pdf", headers={
        "Content-Disposition": f'attachment; filename="signed-{doc["title"][:40]}.pdf"'
    })

@api.get("/documents/{doc_id}/audit-pdf")
async def get_audit_pdf(doc_id: str, user=Depends(get_user_from_query_or_header)):
    doc = await db.documents.find_one({"id": doc_id})
    if not doc:
        raise HTTPException(404, "Not found")
    if doc["sender_id"] != user["id"] and doc.get("recipient_email") != user["email"]:
        raise HTTPException(403, "Forbidden")
    pdf = audit_report_pdf(doc, doc.get("audit_log", []))
    return Response(content=pdf, media_type="application/pdf", headers={
        "Content-Disposition": f'attachment; filename="audit-{doc_id[:8]}.pdf"'
    })

@api.get("/vault")
async def vault(user=Depends(get_current_user)):
    sent = await db.documents.find(
        {"sender_id": user["id"], "signature_status": "signed"},
        {"_id": 0, "otp_code": 0, "signature_base64": 0, "voice_oath_audio": 0, "face_image_b64": 0}
    ).sort("signed_at", -1).to_list(500)
    received = await db.documents.find(
        {"recipient_email": user["email"], "signature_status": "signed"},
        {"_id": 0, "otp_code": 0, "signature_base64": 0, "voice_oath_audio": 0, "face_image_b64": 0}
    ).sort("signed_at", -1).to_list(500)
    return {"sent": sent, "received": received}


# ---------- Editor Documents (rich-text) ----------

PROFESSION_MODES = {
    "Movie Story": ("Director Mode", "You are a screenplay/story-development assistant. Understand plot, tone, character arcs, and dialogue. Suggest emotionally resonant continuations, scene descriptions, and improve dramatic tension."),
    "Novel": ("Novelist Mode", "You are a novelist's writing partner. Maintain narrative voice, pace, and character consistency; suggest vivid prose, sensory detail, and plot beats."),
    "Legal Agreement": ("Lawyer Mode", "You are a legal drafting assistant. Ensure enforceability, detect missing clauses, identify legal risks, tighten language."),
    "NDA": ("Lawyer Mode", "You are an NDA specialist. Ensure confidentiality clauses, IP protection, jurisdiction, term, remedies, and reverse engineering restrictions are complete."),
    "Patent": ("Patent Attorney Mode", "You are a patent attorney. Structure claims, background, summary, detailed description; check novelty, non-obviousness, enablement."),
    "Business Proposal": ("Business Strategist Mode", "You are a business strategist. Sharpen value proposition, market sizing, competitive edge, financial projections."),
    "Investor Pitch": ("Pitch Coach Mode", "You are a startup pitch coach. Sharpen problem, solution, TAM, traction, team, ask."),
    "Research Paper": ("Researcher Mode", "You are an academic writing assistant. Ensure abstract, methodology, results, discussion; academic tone, citations, IMRaD structure."),
    "Technical Documentation": ("Engineer Mode", "You are a technical writer. Clear API/architecture descriptions, code fences, examples, prerequisites."),
    "Teacher Question Paper": ("Teacher Mode", "You are a curriculum expert. Generate leveled questions, answer keys, and mark distributions aligned with grade/board."),
    "Resume": ("Career Coach Mode", "You are a resume coach. Emphasize impact, metrics, action verbs, clean formatting."),
    "Meeting Notes": ("Notes Mode", "You are a meeting-notes assistant. Structure attendees, agenda, decisions, action items."),
    "Contract": ("Lawyer Mode", "You are a contract drafter. Ensure parties, scope, deliverables, payment, term, termination, dispute resolution."),
    "Policy Document": ("Policy Writer Mode", "You are a policy writer. Ensure scope, definitions, obligations, enforcement, revision history."),
    "Other": ("Assistant Mode", "You are a helpful writing assistant."),
}


@api.get("/editor/types")
async def editor_types():
    return {"types": list(PROFESSION_MODES.keys()), "modes": {k: v[0] for k, v in PROFESSION_MODES.items()}}


@api.post("/editor/save")
async def editor_save(req: EditorDocSave, user=Depends(get_current_user)):
    doc_id = req.id or str(uuid.uuid4())
    existing = await db.editor_docs.find_one({"id": doc_id, "owner_id": user["id"]})
    now = now_iso()
    if existing:
        # push version snapshot before overwrite
        await db.editor_docs.update_one(
            {"id": doc_id},
            {"$set": {"title": req.title, "doc_type": req.doc_type, "html": req.html, "plain_text": req.plain_text or "", "updated_at": now},
             "$push": {"versions": {"ts": now, "by": user["email"], "html": existing.get("html", "")[:200000]}}}
        )
    else:
        await db.editor_docs.insert_one({
            "id": doc_id, "owner_id": user["id"], "owner_email": user["email"],
            "title": req.title, "doc_type": req.doc_type,
            "html": req.html, "plain_text": req.plain_text or "",
            "collaborators": [],
            "created_at": now, "updated_at": now, "versions": [],
        })
    return {"id": doc_id, "saved_at": now}


@api.get("/editor/list")
async def editor_list(user=Depends(get_current_user)):
    owned = await db.editor_docs.find(
        {"$or": [{"owner_id": user["id"]}, {"collaborators.email": user["email"]}]},
        {"_id": 0, "versions": 0}
    ).sort("updated_at", -1).to_list(200)
    return {"documents": owned}


@api.get("/editor/{doc_id}")
async def editor_get(doc_id: str, user=Depends(get_current_user)):
    doc = await db.editor_docs.find_one({"id": doc_id}, {"_id": 0})
    if not doc: raise HTTPException(404, "Not found")
    if doc["owner_id"] != user["id"] and not any(c.get("email") == user["email"] for c in doc.get("collaborators", [])):
        raise HTTPException(403, "Forbidden")
    return doc


@api.post("/editor/ai-command")
async def editor_ai(req: EditorAiRequest, user=Depends(get_current_user)):
    mode_name, system = PROFESSION_MODES.get(req.doc_type, PROFESSION_MODES["Other"])
    prompt = (
        f"You are in {mode_name}. Current document HTML is below. "
        f"Apply the user's instruction and return the FULL updated HTML only, no explanations, no markdown fences.\n\n"
        f"INSTRUCTION: {req.instruction}\n\n"
        f"CURRENT HTML:\n{req.current_html[:12000]}"
    )
    try:
        text = await gemini_chat(system, prompt, session_id=f"editor-{user['id']}-{uuid.uuid4()}", model="gemini-3.1-pro-preview")
    except Exception as e:
        raise HTTPException(500, f"AI error: {e}")
    # Strip potential code fences
    t = text.strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[1] if "\n" in t else t
        if t.endswith("```"): t = t[:-3]
    return {"html": t.strip(), "mode": mode_name}


@api.post("/editor/export-pdf")
async def editor_export_pdf(req: EditorDocSave, user=Depends(get_current_user)):
    # Strip HTML tags to plain text (simple)
    import re as _re
    plain = _re.sub(r"<[^>]+>", " ", req.html or "")
    plain = _re.sub(r"\s+", " ", plain).strip()
    pdf = text_to_pdf(req.title or "Document", plain, watermark=f"bachein • {user['email']}")
    return Response(content=pdf, media_type="application/pdf", headers={
        "Content-Disposition": f'attachment; filename="{(req.title or "document").replace(" ","_")}.pdf"'
    })


@api.post("/editor/invite")
async def editor_invite(req: CollaboratorInvite, bg: BackgroundTasks, user=Depends(get_current_user)):
    doc = await db.editor_docs.find_one({"id": req.document_id})
    if not doc: raise HTTPException(404, "Doc not found")
    if doc["owner_id"] != user["id"]:
        raise HTTPException(403, "Only owner can invite")
    email = req.email.lower()
    if req.permission not in ("view", "comment", "edit", "admin"):
        raise HTTPException(400, "Invalid permission")
    # Upsert collaborator entry
    await db.editor_docs.update_one(
        {"id": req.document_id, "collaborators.email": {"$ne": email}},
        {"$push": {"collaborators": {"email": email, "permission": req.permission, "invited_at": now_iso(), "invited_by": user["email"]}}}
    )
    await db.editor_docs.update_one(
        {"id": req.document_id, "collaborators.email": email},
        {"$set": {"collaborators.$.permission": req.permission}}
    )
    # Ensure invitee user exists so magic link can log them in
    existing = await db.users.find_one({"email": email})
    if not existing:
        await db.users.insert_one({
            "id": str(uuid.uuid4()), "email": email, "name": email.split("@")[0].title(),
            "password_hash": hash_password(secrets.token_urlsafe(16)),
            "created_at": now_iso(), "tier": "standard", "dark_mode": False,
        })
    # Issue magic link to open the editor doc
    token = secrets.token_urlsafe(32)
    await db.magic_tokens.insert_one({
        "token": token, "email": email,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=14)).isoformat(),
        "used": False, "editor_doc_id": req.document_id,
    })
    link = f"{APP_URL}/magic?token={token}&editor={req.document_id}"
    subject = f"📄 {user['name']} invited you to collaborate on \"{doc['title']}\""
    body = f"""
<p style="line-height:22px;color:#4B4842;"><b>{user['name']}</b> ({user['email']}) invited you as <b>{req.permission}</b> on <b>{doc['title']}</b>.</p>
<p style="line-height:22px;color:#4B4842;">Open the document to start writing together with real-time updates.</p>
"""
    from email_service import send_email, _layout
    bg.add_task(send_email, email, subject, _layout("Collaboration invite", body, "Open document", link))
    return {"invited": True, "email": email, "permission": req.permission}

# ---------- File Tools ----------

@api.get("/file-tools/formats")
async def file_tools_formats():
    return {"inputs": SUPPORTED_INPUTS, "outputs": SUPPORTED_OUTPUTS}

@api.post("/file-tools/convert")
async def file_convert(target: str = Form(...), file: UploadFile = File(...), user=Depends(get_current_user)):
    data = await file.read()
    src = detect_format(file.filename or "") or (file.content_type or "").split("/")[-1]
    if not src:
        raise HTTPException(400, "Could not detect input format")
    try:
        out_bytes, content_type, filename = ft_convert(data, src, target, title=(file.filename or "document").rsplit(".", 1)[0])
    except ValueError as e:
        raise HTTPException(400, str(e))
    return Response(content=out_bytes, media_type=content_type, headers={
        "Content-Disposition": f'attachment; filename="{filename}"',
        "X-Detected-Format": src,
        "X-Target-Format": target,
    })

@api.post("/file-tools/compress-image")
async def file_compress_image(quality: int = Form(30), file: UploadFile = File(...), user=Depends(get_current_user)):
    data = await file.read()
    out_bytes, mime = compress_image(data, quality=quality, max_dimension=2400)
    return Response(content=out_bytes, media_type=mime, headers={
        "Content-Disposition": f'attachment; filename="compressed-{(file.filename or "image").rsplit(".",1)[0]}.jpg"',
        "X-Original-Size": str(len(data)),
        "X-Compressed-Size": str(len(out_bytes)),
    })

@api.post("/file-tools/compress-pdf")
async def file_compress_pdf(file: UploadFile = File(...), user=Depends(get_current_user)):
    data = await file.read()
    out_bytes = compress_pdf(data)
    return Response(content=out_bytes, media_type="application/pdf", headers={
        "Content-Disposition": f'attachment; filename="compressed-{(file.filename or "doc").rsplit(".",1)[0]}.pdf"',
        "X-Original-Size": str(len(data)),
        "X-Compressed-Size": str(len(out_bytes)),
    })

# Include
app.include_router(api)

# Mount AI Workspace router (provider-agnostic)
from ai_workspace import build_ai_router
_ai_router = build_ai_router(db, get_current_user)
# Mount under the same /api prefix
app.include_router(_ai_router, prefix="/api")

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=[
        "Content-Disposition",
        "X-Original-Size", "X-Compressed-Size",
        "X-Detected-Format", "X-Target-Format",
    ],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
