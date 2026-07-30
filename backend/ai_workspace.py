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
from fastapi import APIRouter, Depends, HTTPException
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

        # Attach document context (extracted text is expected client-side already)
        if body.attachments:
            ctx = "\n\n".join([f"[{a.get('name','file')}]\n{a.get('extracted_text','')}" for a in body.attachments if a.get("extracted_text")])
            if ctx:
                prompt = f"[Attached documents:]\n{ctx[:15000]}\n\nUSER: {prompt}"

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
            "You are Bachein AI — a premium document workspace assistant. "
            "You help with writing, drafting NDAs & contracts, summarizing, reviewing code, and analyzing documents. "
            "Be concise, structured (use markdown when useful), and clear. "
            "Do NOT invent facts. When unsure, say so. "
            "If the user asks for a document, format it cleanly with title, sections, and clear formatting."
        )

        # 5. Call the LLM
        try:
            reply = await _call_llm(auth, system, composed, f"conv-{conv_id}")
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(500, f"AI error: {e}")

        # 6. Persist + consume quota
        assistant_msg = {
            "id": str(uuid.uuid4()), "conv_id": conv_id, "user_id": user["id"],
            "role": "assistant", "content": reply, "provider": provider_id,
            "source": auth["source"], "ts": _now_iso(),
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
            "disclaimer": "AI can make mistakes. Please double-check important information.",
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
                "disclaimer": "AI can make mistakes. Please double-check important information."}

    # ============== Phase 4 — Question Paper Creator ==============
    class QuestionPaperIn(BaseModel):
        board: str          # CBSE | ICSE | State | IB | Other
        class_level: str    # 6-12
        subject: str
        chapters: List[str]
        total_marks: int = 80
        duration_minutes: int = 180
        difficulty: str = "mixed"   # easy | medium | hard | mixed
        include_case_studies: bool = True
        include_diagrams: bool = True
        include_maps: bool = False
        include_graphs: bool = False
        include_tables: bool = True
        num_sections: int = 5
        language: str = "English"
        provider: Optional[str] = None

    @router.post("/question-paper")
    async def create_question_paper(body: QuestionPaperIn, user=Depends(get_current_user)):
        settings = await _get_user_settings(user["id"])
        pid = body.provider or settings.get("default_provider", "gemini")
        auth = await _pick_key(user, pid)
        if auth["source"] != "byo":
            limits = _limits(settings.get("tier", "free"))
            used = await _quota_used(user["id"])
            if used["daily"] >= limits["daily"] or used["monthly"] >= limits["monthly"]:
                raise HTTPException(402, "AI quota reached. Connect your own key.")

        system = (
            "You are an expert board-exam question paper setter. "
            "You have deep knowledge of previous year papers, syllabus, marking schemes, and chapter weightage. "
            "Generate authentic, exam-ready question papers with correct pattern, difficulty distribution, and marks. "
            "You MUST output as strict JSON — no prose outside the JSON block."
        )
        prompt = (
            f"Create a {body.board} Class {body.class_level} {body.subject} question paper.\n"
            f"Chapters to cover: {', '.join(body.chapters) if body.chapters else 'all'}\n"
            f"Total marks: {body.total_marks} · Duration: {body.duration_minutes} min · Difficulty: {body.difficulty} · Language: {body.language}\n"
            f"Include: case_studies={body.include_case_studies}, diagrams={body.include_diagrams}, maps={body.include_maps}, "
            f"graphs={body.include_graphs}, tables={body.include_tables}\n"
            f"Sections: {body.num_sections}\n\n"
            "Analyze previous-year trends and chapter weightage to prioritize the MOST PROBABLE questions.\n\n"
            "Return ONLY this JSON schema (no markdown fences, just raw JSON):\n"
            "{\n"
            '  "title": "string",\n'
            '  "meta": {"board":"", "class":"", "subject":"", "total_marks":0, "duration":"", "language":""},\n'
            '  "general_instructions": ["string", ...],\n'
            '  "sections": [\n'
            '    {"name":"Section A","description":"", "questions":[\n'
            '       {"q_no":"1","marks":1,"type":"MCQ|SA|LA|VSA|case_study","text":"","options":["a","b","c","d"],"answer":null,\n'
            '        "figure":{"kind":"diagram|map|graph|table|none","caption":"","ascii":"","description":""},\n'
            '        "sub_questions":[]}\n'
            '     ]}\n'
            '  ],\n'
            '  "answer_key_available": true\n'
            "}\n\n"
            "Rules:\n"
            "- Distribute marks EXACTLY to the total.\n"
            "- Include case studies if requested with 3-4 sub-parts each.\n"
            "- For diagrams/maps/graphs/tables, add 'figure' with ASCII/text description that a PDF renderer can transform into an image (be concrete).\n"
            "- MCQs must include 4 options.\n"
            "- Base weightage on typical previous-year patterns."
        )
        try:
            raw = await _call_llm(auth, system, prompt, f"qp-{uuid.uuid4()}")
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(500, f"AI error: {e}")
        if auth["source"] != "byo":
            await _consume_quota(user["id"])

        # Try to parse the JSON out of the model response
        import json as _json, re as _re
        parsed = None
        # Try direct parse
        try: parsed = _json.loads(raw)
        except Exception:
            # Strip code fences and re-try
            m = _re.search(r"\{[\s\S]*\}", raw)
            if m:
                try: parsed = _json.loads(m.group(0))
                except Exception: parsed = None

        # Persist
        paper_id = str(uuid.uuid4())
        record = {
            "id": paper_id,
            "user_id": user["id"],
            "params": body.dict(),
            "raw_text": raw,
            "paper": parsed,
            "created_at": _now_iso(),
        }
        await db.question_papers.insert_one(dict(record))

        # Auto-save rendered PDF to Downloads section
        try:
            pdf_bytes = _render_paper_pdf(parsed or {}, record["params"])
            await _register_download(user["id"], f"{body.board} Class {body.class_level} {body.subject} — Question Paper", "question_paper", pdf_bytes, paper_id)
        except Exception:
            pass

        return {
            "id": paper_id,
            "paper": parsed,
            "raw_text": raw if parsed is None else None,
            "parsed": bool(parsed),
            "provider": pid,
            "source": auth["source"],
            "disclaimer": "AI can make mistakes. Please verify against the official syllabus and previous year papers.",
        }

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
        pdf_bytes = _render_paper_pdf(p.get("paper") or {}, p.get("params", {}))
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

        # ── Extract question paper text (or image for vision) ──
        import base64 as _b64
        source_text = (body.text or "").strip()
        image_b64: Optional[str] = None
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
                    source_text = "\n".join(p.get_text() for p in pdf)
                    if len(source_text.strip()) < 40 and len(pdf) > 0:
                        # Scanned PDF — render first page as image for vision models
                        pix = pdf[0].get_pixmap(dpi=130)
                        image_b64 = _b64.b64encode(pix.tobytes("jpeg")).decode()
                        source_text = ""
                except Exception as e:
                    raise HTTPException(400, f"Could not parse PDF: {e}")
            elif fn.endswith((".txt", ".md")):
                source_text = raw.decode(errors="ignore")
            elif fn.endswith((".jpg", ".jpeg", ".png", ".webp")):
                image_b64 = body.file_base64
            else:
                raise HTTPException(400, "Unsupported file. Upload a PDF, image, or text file.")
        if not source_text and not image_b64:
            raise HTTPException(400, "Provide a question paper — upload a file or paste the text.")

        detail_map = {
            "concise": "Keep each answer crisp — exactly enough to score full marks, no extra fluff.",
            "standard": "Write complete, well-structured answers the way a school topper writes in a board exam.",
            "detailed": "Write elaborate topper-level answers with all working steps, labelled points, and extra detail examiners love.",
        }
        system = (
            "You are the school topper and a board-exam examiner combined. "
            "You write PERFECT answer booklets: step-wise solutions, exact marking-scheme alignment, "
            "and presentation exactly like a topper's ruled answer sheet. "
            "You MUST output strict JSON only — no prose outside the JSON."
        )
        meta = f"Board: {body.board or 'unknown'} · Class: {body.class_level or 'unknown'} · Subject: {body.subject or 'unknown'} · Language: {body.language}"
        prompt = (
            f"Below is a question paper. Answer EVERY question like a topper in a board-exam answer booklet.\n{meta}\n"
            f"{detail_map.get(body.detail, detail_map['standard'])}\n\n"
            + (f"QUESTION PAPER TEXT:\n---\n{source_text[:14000]}\n---\n\n" if source_text else "The question paper is provided as an attached image — read every question from it.\n\n")
            + "Return ONLY this JSON schema (raw JSON, no markdown fences):\n"
            "{\n"
            '  "title": "string",\n'
            '  "subject": "string",\n'
            '  "total_marks": 0,\n'
            '  "answers": [\n'
            '    {"q_no":"1","question":"short restatement of the question","marks":3,\n'
            '     "steps":[{"text":"working / point written on the answer sheet","marks":1}],\n'
            '     "final_answer":"the boxed/concluding line",\n'
            '     "examiner_tip":"1-line note on how marks are awarded"}\n'
            "  ]\n"
            "}\n\n"
            "Rules:\n"
            "- Answer in the order questions appear. For MCQs state the option AND one-line reason.\n"
            "- Split marks across steps exactly per typical board marking schemes.\n"
            "- For diagrams describe what the topper would draw in [Diagram: ...] form.\n"
            "- Use the requested language for the answers."
        )
        try:
            raw_reply = await _call_llm(auth, system, prompt, f"ap-{uuid.uuid4()}", image_b64=image_b64)
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(500, f"AI error: {e}")
        if auth["source"] != "byo":
            await _consume_quota(user["id"])

        import json as _json, re as _re
        parsed = None
        try: parsed = _json.loads(raw_reply)
        except Exception:
            m = _re.search(r"\{[\s\S]*\}", raw_reply)
            if m:
                try: parsed = _json.loads(m.group(0))
                except Exception: parsed = None

        ap_id = str(uuid.uuid4())
        record = {
            "id": ap_id, "user_id": user["id"],
            "params": {"subject": body.subject, "class_level": body.class_level, "board": body.board,
                       "detail": body.detail, "language": body.language, "filename": body.filename},
            "raw_text": raw_reply, "answers": parsed, "created_at": _now_iso(),
        }
        await db.answer_papers.insert_one(dict(record))

        # Auto-save the ruled booklet PDF to Downloads
        try:
            pdf_bytes = _render_booklet_pdf(parsed or {}, record["params"])
            name = (parsed or {}).get("title") or f"{body.subject or 'Paper'} — Topper Answer Booklet"
            await _register_download(user["id"], name, "answer_paper", pdf_bytes, ap_id)
        except Exception:
            pass

        return {
            "id": ap_id, "answers": parsed,
            "raw_text": raw_reply if parsed is None else None,
            "parsed": bool(parsed), "provider": pid, "source": auth["source"],
            "disclaimer": "AI can make mistake, please check important info.",
        }

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
        pdf_bytes = _render_booklet_pdf(p.get("answers") or {}, p.get("params", {}))
        return Response(content=pdf_bytes, media_type="application/pdf",
                        headers={"Content-Disposition": f"inline; filename=answer-booklet-{ap_id}.pdf"})

    return router


def _render_paper_pdf(paper: dict, params: dict) -> bytes:
    """Simple ReportLab renderer for question papers."""
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas
    from reportlab.lib.units import cm
    import io as _io, textwrap as _tw

    buf = _io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    W, H = A4
    x0, y0 = 2 * cm, H - 2 * cm

    def line(text, y, size=10, bold=False):
        c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
        c.drawString(x0, y, text[:120])

    def wrap(text, y, size=10, indent=0, bold=False):
        c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
        for chunk in _tw.wrap(text, width=90):
            c.drawString(x0 + indent, y, chunk)
            y -= size + 3
        return y

    title = paper.get("title") or f"{params.get('board','')} Class {params.get('class_level','')} — {params.get('subject','')} Question Paper"
    line(title, y0, 14, True); y = y0 - 22
    meta = paper.get("meta") or {}
    metaline = f"Total Marks: {params.get('total_marks','')} · Duration: {params.get('duration_minutes','')} min · Language: {params.get('language','English')}"
    line(metaline, y, 10); y -= 20

    gi = paper.get("general_instructions") or []
    if gi:
        line("General Instructions:", y, 11, True); y -= 14
        for i, ins in enumerate(gi, 1):
            y = wrap(f"{i}. {ins}", y, 10, indent=8)
        y -= 6

    sections = paper.get("sections") or []
    for sec in sections:
        if y < 3 * cm: c.showPage(); y = H - 2 * cm
        line(sec.get("name", "Section"), y, 12, True); y -= 14
        if sec.get("description"):
            y = wrap(sec.get("description"), y, 9, indent=0)
        y -= 4
        for q in (sec.get("questions") or []):
            if y < 3 * cm: c.showPage(); y = H - 2 * cm
            qn = q.get("q_no", "")
            marks = q.get("marks", "")
            head = f"Q{qn}. ({marks}m) [{q.get('type','')}]"
            line(head, y, 10, True); y -= 12
            y = wrap(q.get("text", ""), y, 10, indent=12)
            opts = q.get("options") or []
            for i, o in enumerate(opts):
                y = wrap(f"({chr(97+i)}) {o}", y, 9, indent=24)
            fig = q.get("figure") or {}
            if fig and fig.get("kind") not in (None, "", "none"):
                y = wrap(f"[Figure — {fig.get('kind','')}: {fig.get('caption','')}]", y, 9, indent=16, bold=True)
                if fig.get("ascii"):
                    for ln in (fig.get("ascii") or "").splitlines():
                        c.setFont("Courier", 8)
                        c.drawString(x0 + 20, y, ln[:80])
                        y -= 10
            sqs = q.get("sub_questions") or []
            for j, sq in enumerate(sqs):
                y = wrap(f"({chr(97+j)}) {sq if isinstance(sq, str) else sq.get('text', '')}", y, 9, indent=24)
            y -= 4
    c.showPage(); c.save()
    return buf.getvalue()


def _render_booklet_pdf(data: dict, params: dict) -> bytes:
    """Render topper-style answers on a ruled board-exam answer booklet (blue rules + red margin)."""
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas
    from reportlab.lib.units import cm
    import io as _io, textwrap as _tw

    buf = _io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    W, H = A4
    left_edge = 1.1 * cm
    margin_x = 2.9 * cm            # writing starts here (right of the red margin line)
    red_x = margin_x - 0.45 * cm   # red vertical margin line
    right = W - 1.4 * cm
    top = H - 2.4 * cm
    bottom = 1.8 * cm
    gap = 21                       # rule spacing
    state = {"y": top, "page": 0}

    def draw_page():
        state["page"] += 1
        # ruled horizontal lines (light blue)
        c.setStrokeColorRGB(0.72, 0.82, 0.94)
        c.setLineWidth(0.7)
        y = top
        while y > bottom:
            c.line(left_edge, y - 5, right, y - 5)
            y -= gap
        # red left margin line
        c.setStrokeColorRGB(0.86, 0.32, 0.32)
        c.setLineWidth(1.1)
        c.line(red_x, H - 1.1 * cm, red_x, bottom - 0.6 * cm)
        # page number
        c.setFillColorRGB(0.45, 0.45, 0.5)
        c.setFont("Helvetica", 8)
        c.drawRightString(right, H - 1.3 * cm, f"Page {state['page']}")
        c.setFillColorRGB(0.08, 0.08, 0.15)
        state["y"] = top

    def next_line():
        state["y"] -= gap
        if state["y"] < bottom:
            c.showPage()
            draw_page()

    def write(text, size=10.5, bold=False, indent=0, margin_label=None, right_label=None, color=None):
        wrap_width = max(30, int((right - margin_x - indent) / (size * 0.52)))
        chunks = _tw.wrap(text, width=wrap_width) or [""]
        for idx, chunk in enumerate(chunks):
            if color: c.setFillColorRGB(*color)
            else: c.setFillColorRGB(0.08, 0.08, 0.15)
            c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
            c.drawString(margin_x + indent, state["y"], chunk)
            if idx == 0 and margin_label:
                c.setFont("Helvetica-Bold", 10.5)
                c.setFillColorRGB(0.86, 0.32, 0.32)
                c.drawString(left_edge + 4, state["y"], margin_label)
                c.setFillColorRGB(0.08, 0.08, 0.15)
            if idx == 0 and right_label:
                c.setFont("Helvetica-Bold", 9)
                c.setFillColorRGB(0.3, 0.45, 0.3)
                c.drawRightString(right - 2, state["y"], right_label)
                c.setFillColorRGB(0.08, 0.08, 0.15)
            next_line()

    draw_page()

    # Booklet header (page 1)
    title = data.get("title") or f"{params.get('subject') or 'Answer'} — Answer Booklet"
    c.setFont("Helvetica-Bold", 14)
    c.drawCentredString((left_edge + right) / 2, state["y"], title[:80])
    next_line()
    sub = " · ".join([x for x in [params.get("board"), f"Class {params.get('class_level')}" if params.get("class_level") else "", params.get("subject")] if x])
    if sub:
        c.setFont("Helvetica", 10)
        c.setFillColorRGB(0.35, 0.35, 0.4)
        c.drawCentredString((left_edge + right) / 2, state["y"], sub[:100])
        c.setFillColorRGB(0.08, 0.08, 0.15)
        next_line()
    c.setFont("Helvetica-Bold", 9)
    c.setFillColorRGB(0.86, 0.32, 0.32)
    c.drawCentredString((left_edge + right) / 2, state["y"], "— TOPPER-STYLE ANSWER SHEET —")
    c.setFillColorRGB(0.08, 0.08, 0.15)
    next_line(); next_line()

    for ans in (data.get("answers") or []):
        qno = str(ans.get("q_no", ""))
        marks = ans.get("marks", "")
        # question restatement (grey, small)
        write(ans.get("question", ""), size=9, indent=0, color=(0.42, 0.42, 0.48),
              margin_label=f"Q{qno}.", right_label=f"[{marks}m]" if marks != "" else None)
        for st in (ans.get("steps") or []):
            txt = st.get("text", "") if isinstance(st, dict) else str(st)
            m = st.get("marks") if isinstance(st, dict) else None
            write(txt, size=10.5, indent=6, right_label=(f"+{m}" if m else None))
        fa = ans.get("final_answer")
        if fa:
            write(f"∴  {fa}", size=10.5, bold=True, indent=6)
        tip = ans.get("examiner_tip")
        if tip:
            write(f"Examiner: {tip}", size=8.5, indent=6, color=(0.5, 0.42, 0.25))
        next_line()

    c.showPage(); c.save()
    return buf.getvalue()
