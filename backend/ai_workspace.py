"""AI Workspace — provider-agnostic AI orchestration for Bachein.

Design principles:
- Provider registry (add new providers by dropping into PROVIDERS dict)
- Tier system: free (BacheIn keys, quota) · pro (BacheIn keys, higher quota) · byo (user's own keys)
- All AI calls flow through `run_chat()` which picks the right key based on:
    1. User has BYO key for chosen provider → use it
    2. User is on free/pro and has quota left → use BacheIn's env key
    3. Otherwise → 402 quota exceeded
- MVP wiring uses `emergentintegrations` under the hood; when you (BacheIn owner) add
  direct env keys later, swap the provider adapter internally without changing the API.
"""
import os
import base64
import hashlib
import uuid
import re
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from cryptography.fernet import Fernet, InvalidToken

# ============== Provider registry ==============
PROVIDERS: Dict[str, Dict[str, Any]] = {
    "gemini": {
        "id": "gemini",
        "name": "Gemini",
        "tagline": "Fast · multimodal · long context",
        "models": ["gemini-2.5-flash", "gemini-2.5-pro"],
        "default_model": "gemini-2.5-flash",
        "byo_key_url": "https://aistudio.google.com/apikey",
        "supports_images": True,
        "supports_web": False,
        "emergent_channel": "gemini",
    },
    "openai": {
        "id": "openai",
        "name": "ChatGPT",
        "tagline": "GPT · images · voice",
        "models": ["gpt-4o", "gpt-4o-mini"],
        "default_model": "gpt-4o-mini",
        "byo_key_url": "https://platform.openai.com/api-keys",
        "supports_images": True,
        "supports_web": False,
        "emergent_channel": "openai",
    },
    "anthropic": {
        "id": "anthropic",
        "name": "Claude",
        "tagline": "Deep reasoning · long docs · code",
        "models": ["claude-sonnet-4-5-20250929", "claude-opus-4-5-20250929"],
        "default_model": "claude-sonnet-4-5-20250929",
        "byo_key_url": "https://console.anthropic.com/settings/keys",
        "supports_images": False,
        "supports_web": False,
        "emergent_channel": "anthropic",
    },
    "grok": {
        "id": "grok",
        "name": "Grok",
        "tagline": "Real-time · witty · web-aware",
        "models": ["grok-4", "grok-beta"],
        "default_model": "grok-4",
        "byo_key_url": "https://console.x.ai",
        "supports_images": False,
        "supports_web": True,
        "emergent_channel": None,  # BYO only
    },
}

FREE_DAILY = int(os.environ.get("FREE_DAILY_LIMIT", "20"))
FREE_MONTHLY = int(os.environ.get("FREE_MONTHLY_LIMIT", "200"))
PRO_DAILY = int(os.environ.get("PRO_DAILY_LIMIT", "500"))
PRO_MONTHLY = int(os.environ.get("PRO_MONTHLY_LIMIT", "10000"))

# Encryption for BYO keys
def _get_fernet() -> Fernet:
    seed = os.environ.get("BACHEIN_KEY_SECRET", "bachein-dev-secret-change-in-prod")
    key = base64.urlsafe_b64encode(hashlib.sha256(seed.encode()).digest())
    return Fernet(key)

def _encrypt(plain: str) -> str:
    return _get_fernet().encrypt(plain.encode()).decode()

def _decrypt(cipher: str) -> str:
    try: return _get_fernet().decrypt(cipher.encode()).decode()
    except InvalidToken: return ""

def _mask(k: str) -> str:
    if not k or len(k) < 8: return "••••"
    return k[:4] + "…" + k[-4:]

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def _today_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")

def _month_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


# ============== Pydantic models ==============
class ProviderKeyIn(BaseModel):
    provider: str
    api_key: str

class SettingsPatch(BaseModel):
    default_provider: Optional[str] = None
    tier: Optional[str] = None

class ConversationCreate(BaseModel):
    title: Optional[str] = None
    provider: Optional[str] = None

class ConversationPatch(BaseModel):
    title: Optional[str] = None
    pinned: Optional[bool] = None

class ChatSendIn(BaseModel):
    conversation_id: Optional[str] = None
    message: str
    provider: Optional[str] = None
    model: Optional[str] = None
    quick_action: Optional[str] = None  # summarize|rewrite|improve|translate|explain|draft_nda|generate_contract|review_code|continue_writing
    attachments: Optional[List[Dict[str, Any]]] = None


# ============== Router factory ==============
def build_ai_router(db, get_current_user, get_user_flex=None):
    router = APIRouter(prefix="/aiw")
    user_dep_flex = get_user_flex or get_current_user

    async def _get_user_settings(user_id: str) -> Dict[str, Any]:
        s = await db.ai_settings.find_one({"user_id": user_id}, {"_id": 0})
        if s: return s
        # Auto-init
        s = {
            "user_id": user_id,
            "tier": "free",
            "default_provider": "gemini",
            "keys": {},  # {provider_id: encrypted_key}
            "created_at": _now_iso(),
        }
        await db.ai_settings.insert_one(dict(s))
        return s

    async def _quota_used(user_id: str) -> Dict[str, int]:
        today = await db.ai_usage.find_one({"user_id": user_id, "date": _today_str()}) or {}
        month = await db.ai_usage.aggregate([
            {"$match": {"user_id": user_id, "month": _month_str()}},
            {"$group": {"_id": None, "total": {"$sum": "$count"}}},
        ]).to_list(1)
        return {"daily": int(today.get("count", 0)), "monthly": int((month[0]["total"] if month else 0))}

    async def _consume_quota(user_id: str):
        await db.ai_usage.update_one(
            {"user_id": user_id, "date": _today_str()},
            {"$inc": {"count": 1}, "$set": {"month": _month_str(), "user_id": user_id, "date": _today_str()}},
            upsert=True,
        )

    def _limits(tier: str) -> Dict[str, int]:
        if tier == "pro": return {"daily": PRO_DAILY, "monthly": PRO_MONTHLY}
        if tier == "byo": return {"daily": 10**9, "monthly": 10**9}
        return {"daily": FREE_DAILY, "monthly": FREE_MONTHLY}

    async def _pick_key(user, provider_id: str) -> Dict[str, str]:
        """Return {source: 'byo'|'bachein', key: <secret>, model: <default_model>}"""
        p = PROVIDERS.get(provider_id)
        if not p: raise HTTPException(400, f"Unknown provider: {provider_id}")
        settings = await _get_user_settings(user["id"])
        # BYO priority
        enc = (settings.get("keys") or {}).get(provider_id)
        if enc:
            k = _decrypt(enc)
            if k: return {"source": "byo", "key": k, "model": p["default_model"], "provider": provider_id}
        # BacheIn-managed: use env key OR emergent channel
        env_name = f"BACHEIN_{provider_id.upper()}_KEY"
        env_key = os.environ.get(env_name, "").strip()
        if env_key:
            return {"source": "bachein", "key": env_key, "model": p["default_model"], "provider": provider_id}
        # Fallback: emergent channel (only for supported providers)
        if p.get("emergent_channel"):
            em = os.environ.get("EMERGENT_LLM_KEY", "").strip()
            if em:
                return {"source": "emergent", "key": em, "model": p["default_model"], "provider": provider_id}
        raise HTTPException(402, f"No API key available for {p['name']}. Add your own key under Settings → BYO.")

    async def _register_download(user_id: str, name: str, kind: str, pdf_bytes: bytes, ref_id: str = "") -> str:
        """Persist a generated PDF into the user's Downloads section."""
        import base64 as _b64
        rec = {
            "id": str(uuid.uuid4()), "user_id": user_id, "name": name, "kind": kind,
            "ref_id": ref_id, "size": len(pdf_bytes),
            "pdf_b64": _b64.b64encode(pdf_bytes).decode(), "created_at": _now_iso(),
        }
        await db.downloads.insert_one(dict(rec))
        return rec["id"]

    async def _call_llm(auth: Dict[str, str], system: str, prompt: str, session_id: str, image_b64: Optional[str] = None) -> str:
        """Provider dispatch. MVP: Emergent adapter for gemini/openai/anthropic; BYO via direct SDK later."""
        provider = auth["provider"]
        key = auth["key"]
        model = auth["model"]
        src = auth["source"]

        # For "emergent" and "bachein" source (assuming bachein-managed is also emergent for now),
        # we route through emergentintegrations. Later, when the user swaps to their own keys,
        # this branch becomes direct SDK calls per provider.
        if src in ("emergent", "bachein") and PROVIDERS[provider].get("emergent_channel"):
            from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent
            channel = PROVIDERS[provider]["emergent_channel"]
            chat = LlmChat(api_key=key, session_id=session_id, system_message=system).with_model(channel, model)
            msg = UserMessage(text=prompt, file_contents=[ImageContent(image_base64=image_b64)]) if image_b64 else UserMessage(text=prompt)
            reply = await chat.send_message(msg)
            return reply or ""

        if image_b64 and provider not in ("openai", "gemini"):
            raise HTTPException(400, f"{PROVIDERS[provider]['name']} key does not support image input here. Upload a text-based PDF or paste the text instead.")

        # BYO — direct provider SDKs
        if provider == "openai":
            import httpx
            async with httpx.AsyncClient(timeout=120.0) as client:
                r = await client.post(
                    "https://api.openai.com/v1/chat/completions",
                    headers={"Authorization": f"Bearer {key}"},
                    json={
                        "model": model,
                        "messages": [{"role": "system", "content": system}, {"role": "user", "content": (
                            prompt if not image_b64 else [
                                {"type": "text", "text": prompt},
                                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"}},
                            ]
                        )}],
                    },
                )
                if r.status_code != 200: raise HTTPException(r.status_code, f"OpenAI: {r.text[:300]}")
                return r.json()["choices"][0]["message"]["content"]
        if provider == "anthropic":
            import httpx
            async with httpx.AsyncClient(timeout=120.0) as client:
                r = await client.post(
                    "https://api.anthropic.com/v1/messages",
                    headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
                    json={"model": model, "max_tokens": 2048, "system": system, "messages": [{"role": "user", "content": prompt}]},
                )
                if r.status_code != 200: raise HTTPException(r.status_code, f"Anthropic: {r.text[:300]}")
                return r.json()["content"][0]["text"]
        if provider == "gemini":
            import httpx
            async with httpx.AsyncClient(timeout=120.0) as client:
                r = await client.post(
                    f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}",
                    json={"systemInstruction": {"parts": [{"text": system}]},
                          "contents": [{"parts": ([{"text": prompt}] + ([{"inline_data": {"mime_type": "image/jpeg", "data": image_b64}}] if image_b64 else []))}]},
                )
                if r.status_code != 200: raise HTTPException(r.status_code, f"Gemini: {r.text[:300]}")
                cands = r.json().get("candidates", [{}])
                return cands[0].get("content", {}).get("parts", [{}])[0].get("text", "") if cands else ""
        if provider == "grok":
            import httpx
            async with httpx.AsyncClient(timeout=120.0) as client:
                r = await client.post(
                    "https://api.x.ai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {key}"},
                    json={"model": model, "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}]},
                )
                if r.status_code != 200: raise HTTPException(r.status_code, f"Grok: {r.text[:300]}")
                return r.json()["choices"][0]["message"]["content"]
        if provider == "deepseek":
            import httpx
            async with httpx.AsyncClient(timeout=120.0) as client:
                r = await client.post(
                    "https://api.deepseek.com/chat/completions",
                    headers={"Authorization": f"Bearer {key}"},
                    json={"model": model, "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}]},
                )
                if r.status_code != 200: raise HTTPException(r.status_code, f"DeepSeek: {r.text[:300]}")
                return r.json()["choices"][0]["message"]["content"]
        if provider == "perplexity":
            import httpx
            async with httpx.AsyncClient(timeout=120.0) as client:
                r = await client.post(
                    "https://api.perplexity.ai/chat/completions",
                    headers={"Authorization": f"Bearer {key}"},
                    json={"model": model, "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}]},
                )
                if r.status_code != 200: raise HTTPException(r.status_code, f"Perplexity: {r.text[:300]}")
                return r.json()["choices"][0]["message"]["content"]
        if provider == "mistral":
            import httpx
            async with httpx.AsyncClient(timeout=120.0) as client:
                r = await client.post(
                    "https://api.mistral.ai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {key}"},
                    json={"model": model, "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}]},
                )
                if r.status_code != 200: raise HTTPException(r.status_code, f"Mistral: {r.text[:300]}")
                return r.json()["choices"][0]["message"]["content"]
        raise HTTPException(400, f"Provider {provider} not supported")

    # ============== Routes ==============
    @router.get("/providers")
    async def list_providers(user=Depends(get_current_user)):
        settings = await _get_user_settings(user["id"])
        out = []
        for pid, p in PROVIDERS.items():
            env_name = f"BACHEIN_{pid.upper()}_KEY"
            has_bachein = bool(os.environ.get(env_name, "").strip()) or bool(p.get("emergent_channel") and os.environ.get("EMERGENT_LLM_KEY"))
            connected_byo = bool((settings.get("keys") or {}).get(pid))
            out.append({
                **{k: v for k, v in p.items() if k != "emergent_channel"},
                "has_bachein_key": has_bachein,
                "connected_byo": connected_byo,
            })
        return {"providers": out, "default_provider": settings.get("default_provider", "gemini")}

    @router.get("/settings")
    async def get_settings(user=Depends(get_current_user)):
        settings = await _get_user_settings(user["id"])
        quota = await _quota_used(user["id"])
        limits = _limits(settings.get("tier", "free"))
        keys = {}
        for pid, enc in (settings.get("keys") or {}).items():
            k = _decrypt(enc)
            keys[pid] = {"masked": _mask(k), "connected": True}
        return {
            "tier": settings.get("tier", "free"),
            "default_provider": settings.get("default_provider", "gemini"),
            "keys": keys,
            "quota": {"daily_used": quota["daily"], "daily_limit": limits["daily"],
                      "monthly_used": quota["monthly"], "monthly_limit": limits["monthly"]},
        }

    @router.patch("/settings")
    async def patch_settings(body: SettingsPatch, user=Depends(get_current_user)):
        upd = {}
        if body.default_provider:
            if body.default_provider not in PROVIDERS: raise HTTPException(400, "Unknown provider")
            upd["default_provider"] = body.default_provider
        if body.tier in ("free", "pro", "byo"): upd["tier"] = body.tier
        if upd:
            await db.ai_settings.update_one({"user_id": user["id"]}, {"$set": upd}, upsert=True)
        return await get_settings(user)

    @router.post("/keys")
    async def save_key(body: ProviderKeyIn, user=Depends(get_current_user)):
        if body.provider not in PROVIDERS: raise HTTPException(400, "Unknown provider")
        if not body.api_key or len(body.api_key) < 10: raise HTTPException(400, "Invalid API key")
        enc = _encrypt(body.api_key.strip())
        await db.ai_settings.update_one(
            {"user_id": user["id"]},
            {"$set": {f"keys.{body.provider}": enc, "updated_at": _now_iso()}},
            upsert=True,
        )
        # Optionally auto-promote to BYO tier if this was the first key
        s = await _get_user_settings(user["id"])
        if s.get("tier") == "free" and len(s.get("keys") or {}) >= 1:
            await db.ai_settings.update_one({"user_id": user["id"]}, {"$set": {"tier": "byo"}})
        return {"ok": True, "provider": body.provider}

    @router.delete("/keys/{provider}")
    async def delete_key(provider: str, user=Depends(get_current_user)):
        await db.ai_settings.update_one({"user_id": user["id"]}, {"$unset": {f"keys.{provider}": ""}})
        return {"ok": True}

    @router.post("/keys/{provider}/test")
    async def test_key(provider: str, user=Depends(get_current_user)):
        """Quick ping: 'Say OK' — validates the key works."""
        settings = await _get_user_settings(user["id"])
        enc = (settings.get("keys") or {}).get(provider)
        if not enc: raise HTTPException(400, "No key stored")
        auth = {"source": "byo", "key": _decrypt(enc), "model": PROVIDERS[provider]["default_model"], "provider": provider}
        try:
            r = await _call_llm(auth, "You are a health check.", "Reply with just: OK", f"test-{uuid.uuid4()}")
            return {"ok": True, "reply": r[:100]}
        except HTTPException as e:
            raise
        except Exception as e:
            raise HTTPException(400, f"Key test failed: {e}")

    @router.get("/quota")
    async def get_quota(user=Depends(get_current_user)):
        settings = await _get_user_settings(user["id"])
        quota = await _quota_used(user["id"])
        limits = _limits(settings.get("tier", "free"))
        return {
            "tier": settings.get("tier", "free"),
            "daily_used": quota["daily"], "daily_limit": limits["daily"],
            "monthly_used": quota["monthly"], "monthly_limit": limits["monthly"],
        }

    # ---- Conversations ----
    @router.get("/conversations")
    async def list_conversations(user=Depends(get_current_user)):
        convs = await db.ai_conversations.find({"user_id": user["id"]}, {"_id": 0}).sort([("pinned", -1), ("updated_at", -1)]).to_list(200)
        return {"conversations": convs}

    @router.post("/conversations")
    async def create_conversation(body: ConversationCreate, user=Depends(get_current_user)):
        settings = await _get_user_settings(user["id"])
        c = {
            "id": str(uuid.uuid4()),
            "user_id": user["id"],
            "title": body.title or "New chat",
            "provider": body.provider or settings.get("default_provider", "gemini"),
            "pinned": False,
            "message_count": 0,
            "created_at": _now_iso(),
            "updated_at": _now_iso(),
        }
        await db.ai_conversations.insert_one(dict(c))
        return c

    @router.get("/conversations/{conv_id}")
    async def get_conversation(conv_id: str, user=Depends(get_current_user)):
        c = await db.ai_conversations.find_one({"id": conv_id, "user_id": user["id"]}, {"_id": 0})
        if not c: raise HTTPException(404, "Not found")
        msgs = await db.ai_messages.find({"conv_id": conv_id}, {"_id": 0}).sort("ts", 1).to_list(500)
        return {"conversation": c, "messages": msgs}

    @router.patch("/conversations/{conv_id}")
    async def patch_conversation(conv_id: str, body: ConversationPatch, user=Depends(get_current_user)):
        upd = {}
        if body.title is not None: upd["title"] = body.title[:120]
        if body.pinned is not None: upd["pinned"] = bool(body.pinned)
        if upd:
            upd["updated_at"] = _now_iso()
            await db.ai_conversations.update_one({"id": conv_id, "user_id": user["id"]}, {"$set": upd})
        c = await db.ai_conversations.find_one({"id": conv_id, "user_id": user["id"]}, {"_id": 0})
        return c

    @router.delete("/conversations/{conv_id}")
    async def delete_conversation(conv_id: str, user=Depends(get_current_user)):
        await db.ai_conversations.delete_one({"id": conv_id, "user_id": user["id"]})
        await db.ai_messages.delete_many({"conv_id": conv_id})
        return {"ok": True}

    # ---- Chat ----
    QUICK_ACTIONS = {
        "summarize": "Summarize the following in 5 concise bullets:\n\n{text}",
        "rewrite": "Rewrite the following professionally and clearly, keeping meaning intact:\n\n{text}",
        "improve": "Improve the writing quality (grammar, style, clarity) of the following:\n\n{text}",
        "translate": "Translate the following to plain, simple English (state original language if not English):\n\n{text}",
        "explain": "Explain the following in simple, easy-to-understand terms:\n\n{text}",
        "draft_nda": "Draft a professional Non-Disclosure Agreement based on this request. Include standard clauses (parties, definitions, obligations, term, remedies):\n\n{text}",
        "generate_contract": "Draft a formal contract based on this request. Include parties, scope, term, payment, termination, jurisdiction:\n\n{text}",
        "review_code": "Review the following code. Identify bugs, security issues, style problems, and suggest improvements:\n\n{text}",
        "continue_writing": "Continue this text in the same tone and style — write 2-3 additional paragraphs:\n\n{text}",
        "create_pdf": "Format the following as a well-structured document (with title, headings, paragraphs) suitable for PDF export:\n\n{text}",
    }

    @router.post("/chat")
    async def chat(body: ChatSendIn, user=Depends(get_current_user)):
        # 1. Ensure conversation
        conv_id = body.conversation_id
        settings = await _get_user_settings(user["id"])
        provider_id = body.provider or settings.get("default_provider", "gemini")
        if provider_id not in PROVIDERS: raise HTTPException(400, "Unknown provider")

        if not conv_id:
            conv = await create_conversation(ConversationCreate(title=(body.message[:60] or "New chat"), provider=provider_id), user)
            conv_id = conv["id"]

        # 2. Enforce quota when using BacheIn keys
        auth = await _pick_key(user, provider_id)
        if auth["source"] != "byo":
            limits = _limits(settings.get("tier", "free"))
            used = await _quota_used(user["id"])
            if used["daily"] >= limits["daily"]:
                raise HTTPException(402, "Daily AI quota reached. Add your own API key (BYO) to keep chatting for free.")
            if used["monthly"] >= limits["monthly"]:
                raise HTTPException(402, "Monthly AI quota reached. Add your own API key (BYO) or upgrade to Pro.")

        # 3. Build prompt (quick action wraps message)
        text = body.message.strip()
        prompt = text
        if body.quick_action and body.quick_action in QUICK_ACTIONS:
            prompt = QUICK_ACTIONS[body.quick_action].replace("{text}", text)

        # Attach document context (inline extracted text and/or RAG retrieval from ingested docs)
        if body.attachments:
            ctx = "\n\n".join([f"[{a.get('name','file')}]\n{a.get('extracted_text','')}" for a in body.attachments if a.get("extracted_text")])
            if ctx:
                prompt = f"[Attached documents:]\n{ctx[:15000]}\n\nUSER: {prompt}"
        # RAG: retrieve relevant sections of docs ingested into this conversation
        try:
            has_docs = await db.ai_documents.find_one({"conv_id": conv_id, "user_id": user["id"]})
            if has_docs:
                from doc_intel import rag as _rag
                hits = _rag.query(user["id"], conv_id, text, k=6)
                if hits:
                    sections = "\n\n".join(f"[{h['file_name']} — section {h['chunk_id'] + 1}]\n{h['text']}" for h in hits)
                    prompt = (
                        f"[RELEVANT SECTIONS FROM THE USER'S UPLOADED DOCUMENT(S) — answer strictly from these when the question is about the document]:\n"
                        f"{sections[:14000]}\n\nUSER: {prompt}"
                    )
        except Exception:
            pass

        # Persist user message
        user_msg = {
            "id": str(uuid.uuid4()), "conv_id": conv_id, "user_id": user["id"],
            "role": "user", "content": text, "attachments": body.attachments or [],
            "provider": provider_id, "ts": _now_iso(),
        }
        await db.ai_messages.insert_one(dict(user_msg))

        # 4. Fetch recent history
        history = await db.ai_messages.find({"conv_id": conv_id}, {"_id": 0}).sort("ts", 1).to_list(20)
        history_text = "\n".join([f'{m["role"].upper()}: {m["content"]}' for m in history[:-1][-10:]])
        composed = (history_text + "\n\n" + prompt) if history_text else prompt

        system = (
            "You are Droit — Bachein's premium document intelligence assistant. Introduce yourself as Droit. "
            "You help with writing, drafting NDAs & contracts, summarizing, analyzing clauses, finding risks, and modifying documents. "
            "Be concise, structured (use markdown when useful), and clear. Do NOT invent facts; when answering from an attached document, "
            "prefix facts with 'According to your document:' and suggestions with 'Suggested improvement:'. "
            "SPECIAL ACTIONS:\n"
            "1. If the user asks you to CREATE, GENERATE or MODIFY a document/PDF (e.g. 'generate this as a PDF', 'rewrite this NDA'), first give a SHORT explanation of what you did, "
            "then output the FULL final document text between <DOCUMENT title=\"Short Title\"> and </DOCUMENT> tags. The document text must be complete and professional.\n"
            "2. If the user asks you to SEND a document to someone and gives an email, include the tag <SEND email=\"their@email.com\"/> in your reply and confirm the send in one sentence."
        )

        # 5. Call the LLM
        try:
            reply = await _call_llm(auth, system, composed, f"conv-{conv_id}")
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(500, f"AI error: {e}")

        # ── Droit special actions: document artifact + autonomous send ──
        artifact = None
        dm = re.search(r'<DOCUMENT title="(.*?)">([\s\S]*?)</DOCUMENT>', reply)
        if dm:
            a_title = (dm.group(1) or "Droit Document").strip()[:80]
            a_body = dm.group(2).strip()
            reply = reply.replace(dm.group(0), "").strip()
            try:
                import fitz as _fitz
                pdf = _fitz.open()
                page = pdf.new_page(width=595, height=842)
                page.insert_text((60, 60), a_title, fontsize=16, fontname="hebo")
                rect = _fitz.Rect(60, 90, 535, 800)
                text_left = a_body
                while text_left:
                    leftover = page.insert_textbox(rect, text_left, fontsize=10.5, fontname="helv", lineheight=1.5)
                    if leftover >= 0:
                        break
                    # crude split: keep filling new pages
                    words = text_left.split(" ")
                    fit_guess = max(50, int(len(words) * 0.6))
                    page.insert_textbox(rect, " ".join(words[:fit_guess]), fontsize=10.5, fontname="helv", lineheight=1.5)
                    text_left = " ".join(words[fit_guess:])
                    if text_left:
                        page = pdf.new_page(width=595, height=842)
                        rect = _fitz.Rect(60, 60, 535, 800)
                    else:
                        break
                did = await _register_download(user["id"], a_title, "droit-doc", pdf.tobytes())
                # version chain within this conversation + keep source text for DOCX/HTML export
                ver = 1 + await db.downloads.count_documents({"user_id": user["id"], "kind": "droit-doc", "conv_id": conv_id})
                await db.downloads.update_one({"id": did}, {"$set": {"content_text": a_body[:200000], "conv_id": conv_id, "version": ver}})
                artifact = {"download_id": did, "name": a_title, "version": ver}
            except Exception:
                artifact = None
        sent_to = None
        sm = re.search(r'<SEND email="([^"]+)"\s*/?>', reply)
        if sm:
            sent_to = sm.group(1).strip().lower()
            reply = reply.replace(sm.group(0), "").strip()
            try:
                _ts = _now_iso()
                await db.documents.insert_one({
                    "id": str(uuid.uuid4()), "sender_id": user["id"],
                    "sender_name": user.get("name", ""), "sender_email": user.get("email", ""),
                    "recipient_email": sent_to, "title": (artifact or {}).get("name", "Document from Droit"),
                    "content": (dm.group(2).strip()[:20000] if dm else text[:2000]),
                    "category": "Normal PDF", "mode": "secure", "status": "sent",
                    "security_config": {"otp_verification": False, "face_verification": False, "voice_oath": False, "digital_signature": False},
                    "attached_files": [], "created_at": _ts, "updated_at": _ts,
                    "delivered": False, "opened": False, "otp_verified": False,
                    "face_verified": False, "voice_oath_completed": False, "voice_attempts": 0,
                    "agreement_read_pct": 0, "signature_status": "pending",
                })
            except Exception:
                sent_to = None

        # 6. Persist + consume quota
        assistant_msg = {
            "id": str(uuid.uuid4()), "conv_id": conv_id, "user_id": user["id"],
            "role": "assistant", "content": reply, "provider": provider_id,
            "source": auth["source"], "ts": _now_iso(),
            **({"artifact": artifact} if artifact else {}),
            **({"sent_to": sent_to} if sent_to else {}),
        }
        await db.ai_messages.insert_one(dict(assistant_msg))
        if auth["source"] != "byo":
            await _consume_quota(user["id"])

        # Auto-title first response
        conv = await db.ai_conversations.find_one({"id": conv_id})
        if conv and conv.get("message_count", 0) == 0 and text:
            title = re.sub(r"\s+", " ", text).strip()[:60] or "New chat"
            await db.ai_conversations.update_one({"id": conv_id}, {"$set": {"title": title}})

        await db.ai_conversations.update_one(
            {"id": conv_id},
            {"$set": {"updated_at": _now_iso()}, "$inc": {"message_count": 2}},
        )

        return {
            "conversation_id": conv_id,
            "reply": reply,
            "provider": provider_id,
            "source": auth["source"],
            **({"artifact": artifact} if artifact else {}),
            **({"sent_to": sent_to} if sent_to else {}),
            "disclaimer": "AI can make mistake, please check important info.",
        }

    # ============== Phase 3 — Ask BacheIn (floating explain) ==============
    class ExplainIn(BaseModel):
        text: str
        context: Optional[str] = None
        style: Optional[str] = "simple"  # simple | detailed | eli5 | technical
        provider: Optional[str] = None

    @router.post("/explain")
    async def explain(body: ExplainIn, user=Depends(get_current_user)):
        settings = await _get_user_settings(user["id"])
        pid = body.provider or settings.get("default_provider", "gemini")
        auth = await _pick_key(user, pid)
        # Quota
        if auth["source"] != "byo":
            limits = _limits(settings.get("tier", "free"))
            used = await _quota_used(user["id"])
            if used["daily"] >= limits["daily"] or used["monthly"] >= limits["monthly"]:
                raise HTTPException(402, "AI quota reached. Connect your own key to keep asking.")

        style_map = {
            "simple": "Explain in very simple plain English, as if to a curious 12-year-old. Use short sentences.",
            "detailed": "Give a thorough, well-structured explanation with examples.",
            "eli5": "Explain like I'm 5. Use analogies. Keep it 3 sentences max.",
            "technical": "Give a precise technical explanation with correct terminology.",
        }
        instr = style_map.get(body.style or "simple", style_map["simple"])
        ctx = f"\n\nContext (surrounding text):\n{body.context[:2000]}" if body.context else ""
        prompt = (
            f"{instr}\n\nExplain the following selection:\n\n---\n{body.text[:3000]}\n---{ctx}\n\n"
            "Return a clean explanation only — no preamble like 'sure' or 'here is'."
        )
        system = "You are Bachein's inline document explainer. Be precise, friendly, and brief."
        try:
            reply = await _call_llm(auth, system, prompt, f"explain-{uuid.uuid4()}")
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(500, f"AI error: {e}")
        if auth["source"] != "byo":
            await _consume_quota(user["id"])
        return {"explanation": reply, "provider": pid, "source": auth["source"],
                "disclaimer": "AI can make mistake, please check important info."}

    # ============== Phase 4 — Question Paper Creator (board-grade) ==============
    from qp_engine import (BOARDS as QP_BOARDS, DIFFICULTIES as QP_DIFFS, ACADEMIC_YEARS as QP_YEARS,
                           subjects_for_class, gen_series_code, render_cbse_pdf)
    from answer_engine import render_evaluated_booklet
    import asyncio as _asyncio
    import json as _json
    import re as _re

    def _parse_json(raw: str):
        try:
            return _json.loads(raw)
        except Exception:
            m = _re.search(r"\{[\s\S]*\}", raw or "")
            if m:
                try:
                    return _json.loads(m.group(0))
                except Exception:
                    return None
        return None

    FIGURE_SPEC_DOC = (
        '"figure" must be null OR EXACTLY one of these renderable specs:\n'
        '{"kind":"graph","expressions":["x**2 - 4"],"x_range":[-5,5],"points":[[1,2,"A"]],"caption":"Fig. 1"}\n'
        '{"kind":"bar","labels":["A","B"],"values":[3,5],"x_label":"","y_label":"","caption":""}   (also kind "line" or "pie")\n'
        '{"kind":"geometry","shapes":[{"type":"polygon","points":[[0,0],[4,0],[2,3]]},{"type":"circle","center":[0,0],"radius":3},'
        '{"type":"segment","points":[[0,0],[4,3]]},{"type":"point","at":[2,3],"label":"A"},{"type":"text","at":[1,0.5],"label":"60\u00b0"},'
        '{"type":"arc","center":[0,0],"radius":1,"theta":[0,60]},{"type":"rect","at":[0,0],"w":2,"h":1,"label":"R"},'
        '{"type":"arrow","points":[[0,0],[2,0]]}],"caption":"Fig. 2"}\n'
        '{"kind":"flowchart","nodes":["Start","Step 1","End"],"caption":""}\n'
        '{"kind":"table","rows":[["x","f(x)"],["1","3"]],"caption":""}\n'
        "Expressions use python math syntax (x**2; allowed funcs: sin cos tan exp log sqrt abs; constants pi, e). "
        "Geometry shapes must use concrete coordinates so the figure renders correctly. "
        "EVERY diagram/graph/map/circuit question MUST include a renderable figure spec — never leave it as a text description."
    )

    QP_SYSTEM = (
        "You are an official board examination paper setter with deep knowledge of official blueprints, "
        "official sample question papers, question paper design documents, marking schemes, previous year board papers, "
        "NCERT/prescribed textbooks, NCERT Exemplar and trusted educational publishers (Oswaal, Educart, Xam Idea, Arihant, "
        "Together With, Physics Wallah, Vedantu, BYJU'S, LearnCBSE). Use that knowledge ONLY to match the authentic pattern, "
        "syllabus, competency levels and question styles — generate NEW, ORIGINAL questions, never copy existing papers. "
        "Output strict JSON only, no prose, no markdown fences."
    )

    @router.get("/qp-options")
    async def qp_options(user=Depends(get_current_user)):
        return {
            "boards": QP_BOARDS, "difficulties": QP_DIFFS, "academic_years": QP_YEARS,
            "classes": [str(i) for i in range(6, 13)],
            "subjects": {str(i): subjects_for_class(str(i)) for i in range(6, 13)},
        }

    class QuestionPaperIn(BaseModel):
        board: str = "CBSE"
        academic_year: str = "2025-26"
        class_level: str
        subject: str
        difficulty: str = "Board Level"   # Easy | Moderate | Board Level | Challenging
        num_sets: int = 1
        language: str = "English"
        chapters: List[str] = []
        provider: Optional[str] = None

    def _qp_base_desc(p: dict) -> str:
        chapters = f" Restrict to chapters: {', '.join(p['chapters'])}." if p.get("chapters") else " Cover the full prescribed syllabus."
        return (
            f"{p['board']} Class {p['class_level']} {p['subject']} board examination question paper for academic year {p['academic_year']}. "
            f"STRICTLY use the syllabus, official blueprint and examination pattern applicable to the {p['academic_year']} session "
            f"(account for any syllabus rationalisation or pattern changes of that year). Difficulty: {p['difficulty']}. Language: English only."
            + chapters
        )

    async def _generate_paper_task(paper_id: str, user_id: str, auth: dict, p: dict):
        async def prog(text, pct=None):
            upd = {"progress": text}
            if pct is not None:
                upd["progress_pct"] = pct
            await db.question_papers.update_one({"id": paper_id}, {"$set": upd})
        try:
            base = _qp_base_desc(p)
            await prog("Analysing official blueprint, syllabus & previous-year pattern…", 5)
            bp_prompt = (
                f"Design the official examination blueprint for: {base}\n"
                "Reproduce the REAL official pattern for that subject/class/year: correct section names (A, B, C, D, E as applicable), "
                "exact question counts, question types (MCQ, Assertion-Reason, VSA, SA, LA, Case study, Competency-based, "
                "diagram/graph-based, numericals, application-based), marks per question, internal choices, and total marks.\n"
                "Return ONLY JSON:\n"
                '{"title":"SUBJECT NAME (e.g. MATHEMATICS (STANDARD))","time_allowed":"3 hours","max_marks":80,\n'
                ' "general_instructions":["(exact style of official general instructions, one per item, 8-11 items)"],\n'
                ' "sections":[{"name":"SECTION A","description":"This section comprises Multiple Choice Questions of 1 mark each.",'
                '"marks_line":"20 x 1 = 20","q_start":1,"q_end":20,"marks_each":1,'
                '"types":"MCQ + Assertion-Reason","notes":"chapter coverage, competency %, internal choices, which questions need figures"}]}'
            )
            raw = await _call_llm(auth, QP_SYSTEM, bp_prompt, f"qpbp-{paper_id}")
            bp = _parse_json(raw)
            if not bp or not bp.get("sections"):
                raise ValueError("Blueprint generation failed — please retry")

            paper = {
                "title": bp.get("title") or p["subject"].upper(),
                "time_allowed": bp.get("time_allowed", "3 hours"),
                "max_marks": bp.get("max_marks", 80),
                "general_instructions": bp.get("general_instructions") or [],
                "series": gen_series_code(),
                "set_no": p.get("set_no", 1),
                "sections": [],
            }
            n_secs = len(bp["sections"])
            for idx, sec in enumerate(bp["sections"][:7]):
                await prog(f"Writing {sec.get('name', 'Section')} — questions {sec.get('q_start', '')}\u2013{sec.get('q_end', '')} ({idx + 1}/{n_secs})…",
                           10 + int(75 * (idx / max(1, n_secs))))
                sec_prompt = (
                    f"Paper: {base}\nPaper blueprint section to write now: {_json.dumps(sec)}\n"
                    f"Set number: {p.get('set_no', 1)} (each set must have different questions of identical pattern/difficulty).\n\n"
                    f"Write ALL questions Q{sec.get('q_start')} to Q{sec.get('q_end')} for this section, fully exam-ready and original.\n"
                    "Rules:\n"
                    "- Match official wording style, rigour and competency mix for this board/year.\n"
                    "- MCQs: exactly 4 options. Assertion-Reason: use the standard official 4-option format.\n"
                    "- Internal choices exactly where the official pattern has them (use or_choice).\n"
                    "- Case studies: passage in text + 3-4 sub_questions with marks.\n"
                    f"- {FIGURE_SPEC_DOC}\n\n"
                    "Return ONLY JSON:\n"
                    '{"questions":[{"q_no":"1","marks":1,"type":"MCQ",'
                    '"text":"...","options":["...","...","...","..."],'
                    '"figure":null,'
                    '"or_choice":null or {"text":"...","options":[],"figure":null},'
                    '"sub_questions":[] or [{"label":"(i)","text":"...","marks":1}]}]}'
                )
                sraw = await _call_llm(auth, QP_SYSTEM, sec_prompt, f"qpsec-{paper_id}-{idx}")
                sp = _parse_json(sraw) or {}
                paper["sections"].append({
                    "name": sec.get("name", f"SECTION {chr(65 + idx)}"),
                    "description": sec.get("description", ""),
                    "marks_line": sec.get("marks_line", ""),
                    "questions": sp.get("questions") or [],
                })

            await prog("Rendering printable board-format PDF…", 90)
            pdf = render_cbse_pdf(paper, p)
            name = f"{p['board']} Class {p['class_level']} {p['subject']} — Set {p.get('set_no', 1)} ({p['academic_year']})"
            dl_id = await _register_download(user_id, name, "question_paper", pdf, paper_id)
            await db.question_papers.update_one(
                {"id": paper_id},
                {"$set": {"paper": paper, "status": "ready", "progress": "", "progress_pct": 100, "download_id": dl_id}})
        except Exception as e:
            await db.question_papers.update_one(
                {"id": paper_id},
                {"$set": {"status": "failed", "error": str(e)[:400], "progress": ""}})

    async def _rerender_paper_pdf(paper_id: str):
        rec = await db.question_papers.find_one({"id": paper_id}, {"_id": 0})
        if not rec or not rec.get("paper"):
            return
        import base64 as _b64
        pdf = render_cbse_pdf(rec["paper"], rec.get("params", {}))
        if rec.get("download_id"):
            await db.downloads.update_one(
                {"id": rec["download_id"]},
                {"$set": {"pdf_b64": _b64.b64encode(pdf).decode(), "size": len(pdf)}})

    @router.post("/question-paper")
    async def create_question_paper(body: QuestionPaperIn, user=Depends(get_current_user)):
        settings = await _get_user_settings(user["id"])
        pid = body.provider or settings.get("default_provider", "gemini")
        auth = await _pick_key(user, pid)
        num_sets = max(1, min(3, body.num_sets or 1))
        if auth["source"] != "byo":
            limits = _limits(settings.get("tier", "free"))
            used = await _quota_used(user["id"])
            if used["daily"] >= limits["daily"] or used["monthly"] >= limits["monthly"]:
                raise HTTPException(402, "AI quota reached. Connect your own key.")
            for _ in range(num_sets):
                await _consume_quota(user["id"])

        ids = []
        for set_no in range(1, num_sets + 1):
            paper_id = str(uuid.uuid4())
            params = body.dict()
            params["set_no"] = set_no
            await db.question_papers.insert_one({
                "id": paper_id, "user_id": user["id"], "params": params,
                "status": "generating", "progress": "Queued…", "progress_pct": 0,
                "paper": None, "created_at": _now_iso(),
            })
            _asyncio.create_task(_generate_paper_task(paper_id, user["id"], auth, params))
            ids.append(paper_id)
        return {"id": ids[0], "ids": ids, "status": "generating", "provider": pid, "source": auth["source"],
                "disclaimer": "AI can make mistake, please check important info."}

    class RegenIn(BaseModel):
        q_no: Optional[str] = None
        section: Optional[str] = None
        provider: Optional[str] = None

    async def _regen_task(paper_id: str, auth: dict, rec: dict, body_q_no, body_section):
        try:
            paper = rec["paper"]
            p = rec.get("params", {})
            base = _qp_base_desc(p)
            if body_q_no:
                target_sec, target_q, qi = None, None, -1
                for sec in paper.get("sections", []):
                    for i, q in enumerate(sec.get("questions", [])):
                        if str(q.get("q_no")) == str(body_q_no):
                            target_sec, target_q, qi = sec, q, i
                if not target_q:
                    raise ValueError(f"Question {body_q_no} not found")
                prompt = (
                    f"Paper: {base}\nSection: {target_sec.get('name')}\n"
                    f"Regenerate ONLY this question with a NEW original question of the SAME type, marks, chapter area and difficulty:\n"
                    f"{_json.dumps(target_q)[:3000]}\n\n{FIGURE_SPEC_DOC}\n\n"
                    'Return ONLY JSON for the single replacement question: {"q_no":"...","marks":1,"type":"...","text":"...","options":[],"figure":null,"or_choice":null,"sub_questions":[]}'
                )
                raw = await _call_llm(auth, QP_SYSTEM, prompt, f"qpregen-{paper_id}")
                nq = _parse_json(raw)
                if not nq or not nq.get("text"):
                    raise ValueError("Regeneration failed")
                nq["q_no"] = target_q.get("q_no")
                nq["marks"] = target_q.get("marks")
                target_sec["questions"][qi] = nq
            elif body_section:
                si, target_sec = -1, None
                for i, sec in enumerate(paper.get("sections", [])):
                    if str(sec.get("name", "")).strip().lower() == str(body_section).strip().lower():
                        si, target_sec = i, sec
                if not target_sec:
                    raise ValueError(f"Section {body_section} not found")
                qs = target_sec.get("questions", [])
                sec_meta = {"name": target_sec.get("name"), "description": target_sec.get("description"),
                            "q_start": qs[0].get("q_no") if qs else "", "q_end": qs[-1].get("q_no") if qs else "",
                            "marks_each": qs[0].get("marks") if qs else ""}
                prompt = (
                    f"Paper: {base}\nRegenerate the ENTIRE section with NEW original questions of identical pattern/marks/types: {_json.dumps(sec_meta)}\n"
                    f"Old questions for pattern reference (do NOT reuse content): {_json.dumps(qs)[:6000]}\n\n{FIGURE_SPEC_DOC}\n\n"
                    'Return ONLY JSON: {"questions":[...same schema as before...]}'
                )
                raw = await _call_llm(auth, QP_SYSTEM, prompt, f"qpregen-{paper_id}")
                sp = _parse_json(raw)
                if not sp or not sp.get("questions"):
                    raise ValueError("Section regeneration failed")
                paper["sections"][si]["questions"] = sp["questions"]
            await db.question_papers.update_one({"id": paper_id}, {"$set": {"paper": paper, "status": "ready", "progress": ""}})
            await _rerender_paper_pdf(paper_id)
        except Exception as e:
            await db.question_papers.update_one({"id": paper_id}, {"$set": {"status": "ready", "progress": "", "error": str(e)[:300]}})

    @router.post("/question-papers/{qp_id}/regenerate")
    async def regenerate_question_paper(qp_id: str, body: RegenIn, user=Depends(get_current_user)):
        rec = await db.question_papers.find_one({"id": qp_id, "user_id": user["id"]}, {"_id": 0})
        if not rec or not rec.get("paper"):
            raise HTTPException(404, "Paper not found or not ready")
        if not body.q_no and not body.section:
            raise HTTPException(400, "Provide q_no or section")
        settings = await _get_user_settings(user["id"])
        pid = body.provider or settings.get("default_provider", "gemini")
        auth = await _pick_key(user, pid)
        if auth["source"] != "byo":
            await _consume_quota(user["id"])
        await db.question_papers.update_one(
            {"id": qp_id},
            {"$set": {"status": "regenerating", "error": None,
                      "progress": f"Regenerating {'Q' + str(body.q_no) if body.q_no else body.section}…"}})
        _asyncio.create_task(_regen_task(qp_id, auth, rec, body.q_no, body.section))
        return {"id": qp_id, "status": "regenerating"}

    @router.post("/question-papers/{qp_id}/new-set")
    async def question_paper_new_set(qp_id: str, user=Depends(get_current_user)):
        rec = await db.question_papers.find_one({"id": qp_id, "user_id": user["id"]}, {"_id": 0})
        if not rec:
            raise HTTPException(404, "Not found")
        settings = await _get_user_settings(user["id"])
        params = dict(rec.get("params", {}))
        pid = params.get("provider") or settings.get("default_provider", "gemini")
        auth = await _pick_key(user, pid)
        if auth["source"] != "byo":
            await _consume_quota(user["id"])
        existing = await db.question_papers.count_documents({"user_id": user["id"], "params.subject": params.get("subject"),
                                                             "params.class_level": params.get("class_level"),
                                                             "params.academic_year": params.get("academic_year")})
        params["set_no"] = min(9, existing + 1)
        new_id = str(uuid.uuid4())
        await db.question_papers.insert_one({
            "id": new_id, "user_id": user["id"], "params": params,
            "status": "generating", "progress": "Queued…", "progress_pct": 0,
            "paper": None, "created_at": _now_iso(),
        })
        _asyncio.create_task(_generate_paper_task(new_id, user["id"], auth, params))
        return {"id": new_id, "status": "generating", "set_no": params["set_no"]}


    @router.get("/question-papers")
    async def list_question_papers(user=Depends(get_current_user)):
        items = await db.question_papers.find({"user_id": user["id"]}, {"_id": 0, "raw_text": 0}).sort("created_at", -1).to_list(50)
        return {"items": items}

    @router.get("/question-papers/{qp_id}")
    async def get_question_paper(qp_id: str, user=Depends(get_current_user)):
        p = await db.question_papers.find_one({"id": qp_id, "user_id": user["id"]}, {"_id": 0})
        if not p: raise HTTPException(404, "Not found")
        return p

    @router.get("/question-papers/{qp_id}/pdf")
    async def question_paper_pdf(qp_id: str, user=Depends(user_dep_flex)):
        from fastapi.responses import Response
        p = await db.question_papers.find_one({"id": qp_id, "user_id": user["id"]}, {"_id": 0})
        if not p: raise HTTPException(404, "Not found")
        # Render to PDF
        pdf_bytes = render_cbse_pdf(p.get("paper") or {}, p.get("params", {}))
        return Response(content=pdf_bytes, media_type="application/pdf",
                        headers={"Content-Disposition": f"inline; filename=question-paper-{qp_id}.pdf"})

    # ============== Phase 5 — Question Paper Analysis (Topper-Style Answers) ==============
    class AnswerPaperIn(BaseModel):
        text: Optional[str] = None
        file_base64: Optional[str] = None
        filename: Optional[str] = None
        subject: Optional[str] = ""
        class_level: Optional[str] = ""
        board: Optional[str] = ""
        detail: str = "standard"      # concise | standard | detailed
        language: str = "English"
        provider: Optional[str] = None

    AP_SYSTEM = (
        "You are a board topper and an official board examiner combined. You write PERFECT evaluated answer booklets "
        "aligned to official marking schemes, evaluation guidelines, NCERT/NCERT Exemplar and trusted solution publishers "
        "(Oswaal, Educart, Xam Idea, Arihant, Physics Wallah, Vedantu, LearnCBSE). "
        "Output strict JSON only — no prose, no markdown fences."
    )

    async def _answer_paper_task(ap_id: str, user_id: str, auth: dict, params: dict, source_text: str, page_images: list):
        async def prog(text, pct=None):
            upd = {"progress": text}
            if pct is not None:
                upd["progress_pct"] = pct
            await db.answer_papers.update_one({"id": ap_id}, {"$set": upd})
        try:
            # 1) Vision transcription for scanned papers / photos
            if not source_text and page_images:
                parts = []
                for i, img in enumerate(page_images):
                    await prog(f"Reading page {i + 1}/{len(page_images)} of the paper…", 2 + int(18 * i / len(page_images)))
                    t = await _call_llm(
                        auth, "You transcribe examination papers exactly. Output plain text only.",
                        "Transcribe EVERY question on this page exactly — keep question numbers, marks, options and internal choices. Describe figures as [Figure: ...].",
                        f"aptr-{ap_id}-{i}", image_b64=img)
                    parts.append(t or "")
                source_text = "\n".join(parts)
            if len((source_text or "").strip()) < 10:
                raise ValueError("Could not read the question paper")

            # 2) Identify every question
            await prog("Analysing the paper — identifying every question, marks and sections…", 22)
            ex_prompt = (
                "From this question paper, list EVERY question (keep internal choices and all sub-parts inside the question text).\n"
                f"---\n{source_text[:22000]}\n---\n"
                'Return ONLY JSON: {"title":"","subject":"","max_marks":0,'
                '"questions":[{"q_no":"1","section":"A","marks":1,"type":"MCQ","text":"full question text including options/choices"}]}'
            )
            ex = _parse_json(await _call_llm(auth, AP_SYSTEM, ex_prompt, f"apex-{ap_id}"))
            questions = (ex or {}).get("questions") or []
            if not questions:
                raise ValueError("Could not identify questions in the paper")

            detail_map = {
                "concise": "Crisp answers — exactly enough to score full marks.",
                "standard": "Complete, well-structured topper answers.",
                "detailed": "Elaborate topper answers with all working, labelled points and extra detail examiners love.",
            }
            meta = (f"Board: {params.get('board') or 'CBSE'} · Class: {params.get('class_level') or ''} · "
                    f"Subject: {params.get('subject') or (ex or {}).get('subject', '')} · Language: {params.get('language', 'English')}")

            # 3) Answer ALL questions in batches
            all_answers = []
            BATCH = 6
            n_batches = (len(questions) + BATCH - 1) // BATCH
            for bi in range(n_batches):
                chunk = questions[bi * BATCH:(bi + 1) * BATCH]
                first, last = chunk[0].get("q_no"), chunk[-1].get("q_no")
                await prog(f"Writing topper answers Q{first}\u2013Q{last} ({bi + 1}/{n_batches})…", 25 + int(60 * bi / n_batches))
                bprompt = (
                    f"{meta}\n{detail_map.get(params.get('detail', 'standard'), detail_map['standard'])}\n"
                    "Answer EVERY question below exactly like a board topper, aligned to the official marking scheme: "
                    "step-wise working with marks per step, required formulas, full calculations, keywords examiners look for. "
                    "For MCQs state the correct option AND a one-line reason. Where an internal choice exists, answer the better-scoring option. "
                    "Also act as the examiner: give marks_awarded (a topper typically scores full or near-full) and a 1-line examiner_remark.\n\n"
                    f"QUESTIONS:\n{_json.dumps(chunk)[:12000]}\n\n"
                    f"When an answer needs a diagram/graph, include a renderable figure. {FIGURE_SPEC_DOC}\n\n"
                    'Return ONLY JSON: {"answers":[{"q_no":"1","section":"A","question":"short restatement","marks":1,'
                    '"steps":[{"text":"...","marks":0.5}],"final_answer":"...","figure":null,'
                    '"marks_awarded":1,"examiner_remark":"..."}]}'
                )
                br = _parse_json(await _call_llm(auth, AP_SYSTEM, bprompt, f"apb-{ap_id}-{bi}"))
                all_answers.extend((br or {}).get("answers") or [])

            if not all_answers:
                raise ValueError("Answer generation failed")

            def _num(v):
                try:
                    return float(v)
                except Exception:
                    return 0.0
            total_awarded = round(sum(_num(a.get("marks_awarded", a.get("marks", 0))) for a in all_answers), 1)
            if total_awarded == int(total_awarded):
                total_awarded = int(total_awarded)
            data = {
                "title": (ex or {}).get("title") or f"{params.get('subject') or 'Paper'} — Evaluated Answer Booklet",
                "subject": (ex or {}).get("subject") or params.get("subject"),
                "max_marks": (ex or {}).get("max_marks"),
                "answers": all_answers,
                "total_awarded": total_awarded,
                "summary_remark": "Excellent presentation. Step-wise working shown clearly — keep diagrams labelled and conclusions highlighted.",
            }
            await prog("Rendering the evaluated answer booklet…", 90)
            pdf = render_evaluated_booklet(data, params)
            dl_id = await _register_download(user_id, str(data["title"])[:90], "answer_paper", pdf, ap_id)
            await db.answer_papers.update_one({"id": ap_id}, {"$set": {
                "answers": data, "status": "ready", "progress": "", "progress_pct": 100, "download_id": dl_id}})
        except Exception as e:
            await db.answer_papers.update_one({"id": ap_id}, {"$set": {"status": "failed", "error": str(e)[:400], "progress": ""}})

    @router.post("/answer-paper")
    async def create_answer_paper(body: AnswerPaperIn, user=Depends(get_current_user)):
        settings = await _get_user_settings(user["id"])
        pid = body.provider or settings.get("default_provider", "gemini")
        auth = await _pick_key(user, pid)
        if auth["source"] != "byo":
            limits = _limits(settings.get("tier", "free"))
            used = await _quota_used(user["id"])
            if used["daily"] >= limits["daily"] or used["monthly"] >= limits["monthly"]:
                raise HTTPException(402, "AI quota reached. Connect your own key.")

        # ── Extract question paper text (or page images for vision) ──
        import base64 as _b64
        source_text = (body.text or "").strip()
        page_images: List[str] = []
        if body.file_base64 and body.filename:
            fn = body.filename.lower()
            try:
                raw = _b64.b64decode(body.file_base64)
            except Exception:
                raise HTTPException(400, "Could not read the uploaded file.")
            if fn.endswith(".pdf"):
                try:
                    import fitz
                    pdf = fitz.open(stream=raw, filetype="pdf")
                    source_text = "\n".join(pg.get_text() for pg in pdf)
                    if len(source_text.strip()) < 40 and len(pdf) > 0:
                        # Scanned PDF — render pages for vision transcription
                        for pg in list(pdf)[:8]:
                            pix = pg.get_pixmap(dpi=120)
                            page_images.append(_b64.b64encode(pix.tobytes("jpeg")).decode())
                        source_text = ""
                except HTTPException:
                    raise
                except Exception as e:
                    raise HTTPException(400, f"Could not parse PDF: {e}")
            elif fn.endswith((".txt", ".md")):
                source_text = raw.decode(errors="ignore")
            elif fn.endswith((".jpg", ".jpeg", ".png", ".webp")):
                page_images = [body.file_base64]
            else:
                raise HTTPException(400, "Unsupported file. Upload a PDF, image, or text file.")
        if not source_text and not page_images:
            raise HTTPException(400, "Provide a question paper — upload a file or paste the text.")

        if auth["source"] != "byo":
            await _consume_quota(user["id"])

        ap_id = str(uuid.uuid4())
        params = {"subject": body.subject, "class_level": body.class_level, "board": body.board,
                  "detail": body.detail, "language": body.language, "filename": body.filename}
        await db.answer_papers.insert_one({
            "id": ap_id, "user_id": user["id"], "params": params,
            "status": "generating", "progress": "Queued…", "progress_pct": 0,
            "answers": None, "created_at": _now_iso(),
        })
        _asyncio.create_task(_answer_paper_task(ap_id, user["id"], auth, params, source_text, page_images))
        return {"id": ap_id, "status": "generating", "provider": pid, "source": auth["source"],
                "disclaimer": "AI can make mistake, please check important info."}


    @router.get("/answer-papers")
    async def list_answer_papers(user=Depends(get_current_user)):
        items = await db.answer_papers.find({"user_id": user["id"]}, {"_id": 0, "raw_text": 0, "answers": 0}).sort("created_at", -1).to_list(50)
        return {"items": items}

    @router.get("/answer-papers/{ap_id}")
    async def get_answer_paper(ap_id: str, user=Depends(get_current_user)):
        p = await db.answer_papers.find_one({"id": ap_id, "user_id": user["id"]}, {"_id": 0})
        if not p: raise HTTPException(404, "Not found")
        return p

    @router.get("/answer-papers/{ap_id}/pdf")
    async def answer_paper_pdf(ap_id: str, user=Depends(user_dep_flex)):
        from fastapi.responses import Response
        p = await db.answer_papers.find_one({"id": ap_id, "user_id": user["id"]}, {"_id": 0})
        if not p: raise HTTPException(404, "Not found")
        pdf_bytes = render_evaluated_booklet(p.get("answers") or {}, p.get("params", {}))
        return Response(content=pdf_bytes, media_type="application/pdf",
                        headers={"Content-Disposition": f"inline; filename=answer-booklet-{ap_id}.pdf"})

    # ══════════════ Document Intelligence — ingest + export ══════════════
    @router.post("/ingest")
    async def ingest_document(
        file: UploadFile = File(...),
        conversation_id: Optional[str] = Form(None),
        user=Depends(get_current_user),
    ):
        """Upload a document into an AI conversation: extract (PyMuPDF → Textract fallback), chunk, index for RAG."""
        from doc_intel import extract_any, chunk_text, rag as _rag
        data = await file.read()
        if len(data) > 25 * 1024 * 1024:
            raise HTTPException(400, "File too large (max 25 MB)")
        conv_id = conversation_id
        if not conv_id:
            conv_id = str(uuid.uuid4())
            await db.ai_conversations.insert_one({
                "id": conv_id, "user_id": user["id"], "title": (file.filename or "Document")[:60],
                "pinned": False, "created_at": _now_iso(), "updated_at": _now_iso(),
            })
        try:
            text_out, method = extract_any(data, file.filename or "file.pdf")
        except ValueError as e:
            raise HTTPException(400, str(e))
        if not text_out.strip():
            # Vision-LLM OCR fallback (Textract unavailable / returned nothing)
            try:
                import fitz as _fitz
                name_l = (file.filename or "").lower()
                if name_l.endswith((".png", ".jpg", ".jpeg", ".webp")):
                    imgs = [base64.b64encode(data).decode()]
                else:
                    _pdf = _fitz.open(stream=data, filetype="pdf")
                    imgs = [base64.b64encode(pg.get_pixmap(dpi=140).tobytes("jpeg")).decode() for pg in list(_pdf)[:8]]
                from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent
                ocr_chat = LlmChat(
                    api_key=os.environ.get("EMERGENT_LLM_KEY", ""),
                    session_id=f"ingest-ocr-{user['id'][:8]}",
                    system_message="Transcribe ALL text in the given document image(s) exactly, preserving structure. Output plain text only.",
                ).with_model("gemini", "gemini-3.1-pro-preview")
                pieces = []
                for im in imgs:
                    t = await ocr_chat.send_message(UserMessage(text="Transcribe this page.", file_contents=[ImageContent(image_base64=im)]))
                    pieces.append(t or "")
                text_out = "\n\n".join(pieces).strip()
                method = "vision-llm-ocr"
            except Exception:
                pass
        if not text_out.strip():
            raise HTTPException(400, "We could not read any text from this document. Try another version or format.")
        chunks = chunk_text(text_out)
        doc_id = str(uuid.uuid4())
        try:
            _rag.add(user["id"], conv_id, doc_id, file.filename or "document", chunks)
        except Exception:
            pass
        await db.ai_documents.insert_one({
            "id": doc_id, "user_id": user["id"], "conv_id": conv_id,
            "file_name": file.filename or "document", "method": method,
            "chars": len(text_out), "chunks": len(chunks),
            "text_head": text_out[:12000], "created_at": _now_iso(),
        })
        return {
            "document_id": doc_id, "conversation_id": conv_id,
            "file_name": file.filename, "method": method,
            "chars": len(text_out), "chunks": len(chunks),
        }

    @router.get("/export/{download_id}")
    async def export_download(download_id: str, fmt: str = "docx", user=Depends(user_dep_flex)):
        """Export a Droit-generated document as DOCX or HTML (PDF already stored)."""
        from doc_intel import text_to_docx, text_to_html
        from fastapi.responses import Response
        dl = await db.downloads.find_one({"id": download_id, "user_id": user["id"]})
        if not dl:
            raise HTTPException(404, "Not found")
        body_txt = dl.get("content_text") or ""
        if not body_txt:
            # fall back to extracting text from the stored PDF
            try:
                import fitz
                pdf = fitz.open(stream=base64.b64decode(dl["pdf_b64"]), filetype="pdf")
                body_txt = "\n\n".join(pg.get_text() for pg in pdf)
            except Exception:
                raise HTTPException(400, "This download cannot be exported")
        title = dl.get("name", "Document")
        if fmt == "html":
            return Response(content=text_to_html(title, body_txt), media_type="text/html",
                            headers={"Content-Disposition": f'attachment; filename="{title}.html"'})
        return Response(
            content=text_to_docx(title, body_txt),
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": f'attachment; filename="{title}.docx"'},
        )

    # ══════════════ Voice agent — ElevenLabs STT ↔ LLM ↔ TTS ══════════════
    _EL_KEY = os.environ.get("ELEVENLABS_API_KEY", "")
    _EL_VOICE = os.environ.get("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")

    @router.post("/voice/converse")
    async def voice_converse(
        audio: UploadFile = File(...),
        conversation_id: Optional[str] = Form(None),
        user=Depends(get_current_user),
    ):
        """One conversational turn: user speech → transcript → Bachein LLM → spoken reply."""
        if not _EL_KEY:
            raise HTTPException(500, "Voice engine not configured")
        import io as _io
        import asyncio as _aio
        from elevenlabs.client import ElevenLabs as _EL
        data = await audio.read()
        if len(data) < 800:
            return {"transcript": "", "reply": "", "audio_base64": None, "conversation_id": conversation_id}
        el = _EL(api_key=_EL_KEY)
        loop = _aio.get_event_loop()

        # 1. Speech → text (ElevenLabs Scribe)
        def _stt():
            return el.speech_to_text.convert(file=_io.BytesIO(data), model_id="scribe_v1")
        try:
            tr = await loop.run_in_executor(None, _stt)
        except Exception as e:
            raise HTTPException(502, f"Speech recognition failed: {e}")
        transcript = (getattr(tr, "text", "") or "").strip()
        if not transcript:
            return {"transcript": "", "reply": "", "audio_base64": None, "conversation_id": conversation_id}

        # 2. Same Bachein chat brain (history + quota + provider selection preserved)
        chat_res = await chat(ChatSendIn(message=transcript, conversation_id=conversation_id), user)
        reply = chat_res.get("reply", "")

        # 3. Text → speech (low-latency turbo voice)
        spoken = re.sub(r"[*#`_>|]+", " ", reply)
        spoken = re.sub(r"\[(.*?)\]\(.*?\)", r"\1", spoken)
        spoken = re.sub(r"\s+", " ", spoken).strip()[:900]
        audio_b64 = None
        if spoken:
            def _tts():
                gen = el.text_to_speech.convert(
                    text=spoken, voice_id=_EL_VOICE,
                    model_id="eleven_turbo_v2_5", output_format="mp3_22050_32",
                )
                return b"".join(gen)
            try:
                audio_bytes = await loop.run_in_executor(None, _tts)
                audio_b64 = base64.b64encode(audio_bytes).decode()
            except Exception:
                audio_b64 = None  # still return the text reply
        return {
            "transcript": transcript, "reply": reply, "audio_base64": audio_b64,
            "conversation_id": chat_res.get("conversation_id", conversation_id),
            "disclaimer": "AI can make mistake, please check important info.",
        }

    @router.post("/voice/say")
    async def voice_say(body: Dict[str, Any], user=Depends(get_current_user)):
        """Plain TTS for short phrases (greetings/status lines)."""
        if not _EL_KEY:
            raise HTTPException(500, "Voice engine not configured")
        import asyncio as _aio
        from elevenlabs.client import ElevenLabs as _EL
        text = str(body.get("text", "")).strip()[:300]
        if not text:
            raise HTTPException(400, "text required")
        el = _EL(api_key=_EL_KEY)
        def _tts():
            gen = el.text_to_speech.convert(text=text, voice_id=_EL_VOICE, model_id="eleven_turbo_v2_5", output_format="mp3_22050_32")
            return b"".join(gen)
        audio_bytes = await _aio.get_event_loop().run_in_executor(None, _tts)
        return {"audio_base64": base64.b64encode(audio_bytes).decode()}

    return router
