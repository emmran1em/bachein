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
        "name": "Google Gemini",
        "tagline": "Multimodal · fast · long context",
        "models": ["gemini-2.5-flash", "gemini-2.5-pro"],
        "default_model": "gemini-2.5-flash",
        "byo_key_url": "https://aistudio.google.com/apikey",
        "supports_images": True,
        "supports_web": False,
        "emergent_channel": "gemini",
    },
    "openai": {
        "id": "openai",
        "name": "OpenAI ChatGPT",
        "tagline": "GPT-5 series · images · voice",
        "models": ["gpt-4o", "gpt-4o-mini"],
        "default_model": "gpt-4o-mini",
        "byo_key_url": "https://platform.openai.com/api-keys",
        "supports_images": True,
        "supports_web": False,
        "emergent_channel": "openai",
    },
    "anthropic": {
        "id": "anthropic",
        "name": "Anthropic Claude",
        "tagline": "Deep reasoning · long documents · code",
        "models": ["claude-sonnet-4-5-20250929", "claude-opus-4-5-20250929"],
        "default_model": "claude-sonnet-4-5-20250929",
        "byo_key_url": "https://console.anthropic.com/settings/keys",
        "supports_images": False,
        "supports_web": False,
        "emergent_channel": "anthropic",
    },
    "grok": {
        "id": "grok",
        "name": "xAI Grok",
        "tagline": "Real-time · witty · web-aware",
        "models": ["grok-4", "grok-beta"],
        "default_model": "grok-4",
        "byo_key_url": "https://console.x.ai",
        "supports_images": False,
        "supports_web": True,
        "emergent_channel": None,  # BYO only for now
    },
    "deepseek": {
        "id": "deepseek",
        "name": "DeepSeek",
        "tagline": "Efficient · code-first",
        "models": ["deepseek-chat", "deepseek-coder"],
        "default_model": "deepseek-chat",
        "byo_key_url": "https://platform.deepseek.com/api_keys",
        "supports_images": False,
        "supports_web": False,
        "emergent_channel": None,
    },
    "perplexity": {
        "id": "perplexity",
        "name": "Perplexity",
        "tagline": "Live web search · citations",
        "models": ["sonar-pro", "sonar"],
        "default_model": "sonar-pro",
        "byo_key_url": "https://www.perplexity.ai/settings/api",
        "supports_images": False,
        "supports_web": True,
        "emergent_channel": None,
    },
    "mistral": {
        "id": "mistral",
        "name": "Mistral",
        "tagline": "Fast · European · efficient",
        "models": ["mistral-large-latest", "mistral-small-latest"],
        "default_model": "mistral-large-latest",
        "byo_key_url": "https://console.mistral.ai/api-keys",
        "supports_images": False,
        "supports_web": False,
        "emergent_channel": None,
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
def build_ai_router(db, get_current_user):
    router = APIRouter(prefix="/aiw")

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

    async def _call_llm(auth: Dict[str, str], system: str, prompt: str, session_id: str) -> str:
        """Provider dispatch. MVP: Emergent adapter for gemini/openai/anthropic; BYO via direct SDK later."""
        provider = auth["provider"]
        key = auth["key"]
        model = auth["model"]
        src = auth["source"]

        # For "emergent" and "bachein" source (assuming bachein-managed is also emergent for now),
        # we route through emergentintegrations. Later, when the user swaps to their own keys,
        # this branch becomes direct SDK calls per provider.
        if src in ("emergent", "bachein") and PROVIDERS[provider].get("emergent_channel"):
            from emergentintegrations.llm.chat import LlmChat, UserMessage
            channel = PROVIDERS[provider]["emergent_channel"]
            chat = LlmChat(api_key=key, session_id=session_id, system_message=system).with_model(channel, model)
            reply = await chat.send_message(UserMessage(text=prompt))
            return reply or ""

        # BYO — direct provider SDKs
        if provider == "openai":
            import httpx
            async with httpx.AsyncClient(timeout=120.0) as client:
                r = await client.post(
                    "https://api.openai.com/v1/chat/completions",
                    headers={"Authorization": f"Bearer {key}"},
                    json={
                        "model": model,
                        "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
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
                          "contents": [{"parts": [{"text": prompt}]}]},
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

    return router
