from fastapi import FastAPI, APIRouter, HTTPException, Depends, Header
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
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

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

MONGO_URL = os.environ['MONGO_URL']
DB_NAME = os.environ['DB_NAME']
EMERGENT_LLM_KEY = os.environ['EMERGENT_LLM_KEY']
JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALGO = os.environ.get('JWT_ALGO', 'HS256')
JWT_EXPIRES_MIN = int(os.environ.get('JWT_EXPIRES_MIN', '10080'))

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

class AuthResponse(BaseModel):
    token: str
    user: UserOut

class GenerateRequest(BaseModel):
    prompt: str
    category: str = "Normal PDF"
    sub_type: Optional[str] = None  # Question Paper, Report, Notes, Presentation

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
    category: str  # NDA, Patent, Legal Documents etc.
    mode: str  # "normal" or "secure"
    content: str = ""
    recipient_email: Optional[str] = None
    security_config: Optional[SecurityConfig] = None
    attached_files: Optional[List[Dict[str, Any]]] = None  # [{name, type, size, data_base64}]

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
    # Tracking
    delivered: bool = False
    opened: bool = False
    otp_verified: bool = False
    face_verified: bool = False
    voice_oath_completed: bool = False
    agreement_read_pct: int = 0
    signature_status: str = "pending"  # pending/signed
    signed_at: Optional[str] = None
    protected_unlocked: bool = False

class VerifyOtpRequest(BaseModel):
    document_id: str
    otp: str

class VoiceOathRequest(BaseModel):
    document_id: str
    audio_base64: str

class SignatureRequest(BaseModel):
    document_id: str
    signature_base64: str

class ReadProgressRequest(BaseModel):
    document_id: str
    progress: int

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

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

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
    }
    await db.users.insert_one(user_doc)
    token = create_token(user_id, req.email.lower())
    return AuthResponse(
        token=token,
        user=UserOut(id=user_id, email=req.email.lower(), name=req.name, created_at=user_doc["created_at"]),
    )

@api.post("/auth/login", response_model=AuthResponse)
async def login(req: LoginRequest):
    user = await db.users.find_one({"email": req.email.lower()})
    if not user or not verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_token(user["id"], user["email"])
    return AuthResponse(
        token=token,
        user=UserOut(id=user["id"], email=user["email"], name=user["name"], created_at=user["created_at"]),
    )

@api.get("/auth/me", response_model=UserOut)
async def me(user=Depends(get_current_user)):
    return UserOut(id=user["id"], email=user["email"], name=user["name"], created_at=user["created_at"])

# ---------- AI ----------

CATEGORIES = [
    "NDA", "Patent / IP Agreement", "Legal Documents", "Confidential Documents",
    "Financial Reports", "Organization Documents", "Employment Agreements",
    "Freelancer Agreements", "Investor Agreements", "Manufacturing Agreements",
    "Secure PDF", "Normal PDF"
]

NORMAL_PDF_TYPES = [
    "Question Paper", "Report", "Notes", "Presentation", "Assignment", "Summary"
]

@api.get("/categories")
async def get_categories():
    return {
        "categories": CATEGORIES,
        "normal_pdf_types": NORMAL_PDF_TYPES,
    }

@api.post("/ai/generate", response_model=GenerateResponse)
async def ai_generate(req: GenerateRequest, user=Depends(get_current_user)):
    system = (
        "You are Bachein AI, an expert document drafter. "
        "Generate a complete, professional document body based on the user's prompt. "
        "Respond in plain text using clear section headings (no markdown asterisks). "
        "Keep tone formal and production-ready."
    )
    prompt = (
        f"Category: {req.category}\n"
        f"Sub-type: {req.sub_type or 'General'}\n"
        f"User Request: {req.prompt}\n\n"
        f"Please produce:\n"
        f"1. A short title (single line, <12 words) prefixed with 'TITLE:'\n"
        f"2. A one-paragraph cover-page abstract prefixed with 'COVER:'\n"
        f"3. The full document body prefixed with 'CONTENT:'\n"
    )
    try:
        text = await gemini_chat(system, prompt, session_id=f"gen-{user['id']}-{uuid.uuid4()}")
    except Exception as e:
        logger.exception("AI generate error")
        raise HTTPException(status_code=500, detail=f"AI error: {str(e)}")

    title = ""
    cover = ""
    content = text
    if "TITLE:" in text:
        try:
            after_title = text.split("TITLE:", 1)[1]
            title = after_title.split("COVER:", 1)[0].strip().splitlines()[0].strip()
            rest = after_title.split("COVER:", 1)[1] if "COVER:" in after_title else after_title
            if "CONTENT:" in rest:
                cover = rest.split("CONTENT:", 1)[0].strip()
                content = rest.split("CONTENT:", 1)[1].strip()
            else:
                cover = rest.strip()[:400]
                content = text
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
        "Return a JSON-like response with sections: MISSING (list), RISKS (list), RECOMMENDATIONS (list), SUMMARY (one paragraph). "
        "Focus on: NDA clauses, IP protection, trade secret protection, jurisdiction, confidentiality, reverse engineering."
    )
    prompt = (
        "Review this document and respond using these exact headings (each item on its own line, prefixed with '- '):\n"
        "MISSING:\nRISKS:\nRECOMMENDATIONS:\nSUMMARY:\n\nDOCUMENT:\n" + req.document_text[:8000]
    )
    try:
        text = await gemini_chat(system, prompt, session_id=f"rev-{user['id']}-{uuid.uuid4()}", model="gemini-3.1-pro-preview")
    except Exception as e:
        logger.exception("AI review error")
        raise HTTPException(status_code=500, detail=f"AI error: {str(e)}")

    def parse_section(label: str) -> List[str]:
        try:
            after = text.split(label + ":", 1)[1]
            # stop at next ALLCAPS heading
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

# ---------- Documents ----------

def doc_to_out(doc: Dict[str, Any]) -> DocumentOut:
    doc = {k: v for k, v in doc.items() if k != "_id"}
    return DocumentOut(**doc)

@api.post("/documents", response_model=DocumentOut)
async def create_document(req: DocumentCreate, user=Depends(get_current_user)):
    doc_id = str(uuid.uuid4())
    sec = (req.security_config or SecurityConfig()).dict() if req.mode == "secure" else None
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
        "attached_files": req.attached_files or [],
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
    return doc_to_out(document)

@api.get("/documents/sent", response_model=List[DocumentOut])
async def list_sent(user=Depends(get_current_user)):
    docs = await db.documents.find(
        {"sender_id": user["id"]},
        {"_id": 0, "otp_code": 0}
    ).sort("created_at", -1).to_list(500)
    return [DocumentOut(**d) for d in docs]

@api.get("/documents/received", response_model=List[DocumentOut])
async def list_received(user=Depends(get_current_user)):
    docs = await db.documents.find(
        {"recipient_email": user["email"]},
        {"_id": 0, "otp_code": 0}
    ).sort("created_at", -1).to_list(500)
    return [DocumentOut(**d) for d in docs]

@api.get("/documents/{doc_id}", response_model=DocumentOut)
async def get_document(doc_id: str, user=Depends(get_current_user)):
    doc = await db.documents.find_one({"id": doc_id}, {"_id": 0, "otp_code": 0})
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
async def send_otp(doc_id: str, user=Depends(get_current_user)):
    doc = await db.documents.find_one({"id": doc_id})
    if not doc:
        raise HTTPException(404, "Not found")
    if doc.get("recipient_email") != user["email"]:
        raise HTTPException(403, "Forbidden")
    otp = f"{random.randint(100000, 999999)}"
    await db.documents.update_one({"id": doc_id}, {"$set": {"otp_code": otp, "updated_at": now_iso()}})
    # For demo: return OTP in response (production would email/SMS)
    return {"sent": True, "otp_demo": otp, "message": "OTP issued. In production this would be emailed."}

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
            "voice_oath_audio": req.audio_base64[:500000],  # cap
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
async def sign_document(req: SignatureRequest, user=Depends(get_current_user)):
    doc = await db.documents.find_one({"id": req.document_id})
    if not doc:
        raise HTTPException(404, "Not found")
    if doc.get("recipient_email") != user["email"]:
        raise HTTPException(403, "Forbidden")
    sec = doc.get("security_config") or {}
    # Enforce required gates if configured
    if sec.get("otp_verification") and not doc.get("otp_verified"):
        raise HTTPException(400, "OTP verification required first")
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
    return {"signed": True, "signed_at": ts}

@api.get("/documents/{doc_id}/status")
async def doc_status(doc_id: str, user=Depends(get_current_user)):
    doc = await db.documents.find_one({"id": doc_id}, {"_id": 0, "otp_code": 0, "signature_base64": 0, "voice_oath_audio": 0})
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

@api.get("/vault")
async def vault(user=Depends(get_current_user)):
    sent = await db.documents.find(
        {"sender_id": user["id"], "signature_status": "signed"},
        {"_id": 0, "otp_code": 0, "signature_base64": 0, "voice_oath_audio": 0}
    ).sort("signed_at", -1).to_list(500)
    received = await db.documents.find(
        {"recipient_email": user["email"], "signature_status": "signed"},
        {"_id": 0, "otp_code": 0, "signature_base64": 0, "voice_oath_audio": 0}
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
