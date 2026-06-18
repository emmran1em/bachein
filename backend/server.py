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

from email_service import (
    email_doc_received, email_otp, email_signed_notification,
    email_magic_link, email_pdf_attachment,
)
from pdf_utils import extract_text_from_pdf, password_protect_pdf, text_to_pdf, audit_report_pdf

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
    recipient_email: Optional[EmailStr] = None
    security_config: Optional[SecurityConfig] = None
    attached_files: Optional[List[Dict[str, Any]]] = None

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
    agreement_read_pct: int = 0
    signature_status: str = "pending"
    signed_at: Optional[str] = None
    protected_unlocked: bool = False

class VerifyOtpRequest(BaseModel):
    document_id: str
    otp: str

class VoiceOathRequest(BaseModel):
    document_id: str
    audio_base64: str

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

@api.patch("/auth/prefs", response_model=UserOut)
async def update_prefs(req: PrefsRequest, user=Depends(get_current_user)):
    upd = {}
    if req.dark_mode is not None:
        upd["dark_mode"] = req.dark_mode
    if req.tier is not None and req.tier in ("standard", "pro", "enterprise"):
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
        "agreement_read_pct": 0,
        "signature_status": "pending",
        "signed_at": None,
        "protected_unlocked": False,
        "otp_code": f"{random.randint(100000, 999999)}",
        "audit_log": [{"event": "created", "ts": now_iso(), "by": user["email"]}],
    }
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
    await db.documents.update_one(
        {"id": req.document_id},
        {"$set": {
            "face_verified": True,
            "face_image_b64": req.image_base64[:500000],
            "updated_at": now_iso(),
         },
         "$push": {"audit_log": {"event": "face_verified", "ts": now_iso(), "by": user["email"]}}}
    )
    return {"verified": True}

@api.post("/documents/voice-oath")
async def voice_oath(req: VoiceOathRequest, user=Depends(get_current_user)):
    doc = await db.documents.find_one({"id": req.document_id})
    if not doc:
        raise HTTPException(404, "Not found")
    if doc.get("recipient_email") != user["email"]:
        raise HTTPException(403, "Forbidden")
    await db.documents.update_one(
        {"id": req.document_id},
        {"$set": {
            "voice_oath_completed": True,
            "voice_oath_audio": req.audio_base64[:500000],
            "updated_at": now_iso(),
         },
         "$push": {"audit_log": {"event": "voice_oath", "ts": now_iso(), "by": user["email"]}}}
    )
    return {"completed": True}

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
        "agreement_read_pct": doc.get("agreement_read_pct", 0),
        "signature_status": doc.get("signature_status"),
        "signed_at": doc.get("signed_at"),
        "protected_unlocked": doc.get("protected_unlocked"),
        "audit_log": doc.get("audit_log", []),
    }

@api.get("/documents/{doc_id}/signed-pdf")
async def get_signed_pdf(doc_id: str, user=Depends(get_current_user)):
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

# Include
app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
