"""Email service using Resend HTTP API."""
import os
import httpx
import base64
import logging
from typing import Optional, List, Dict, Any

logger = logging.getLogger("bachein.email")

RESEND_API = "https://api.resend.com/emails"


async def send_email(
    to: str,
    subject: str,
    html: str,
    *,
    attachments: Optional[List[Dict[str, Any]]] = None,
    reply_to: Optional[str] = None,
) -> bool:
    """Send an email via Resend. Returns True on 200/202.

    attachments: list of { filename, content (base64 string) }
    """
    api_key = os.environ.get("RESEND_API_KEY")
    from_addr = os.environ.get("RESEND_FROM", "Bachein <onboarding@resend.dev>")
    if not api_key:
        logger.warning("RESEND_API_KEY not set — skipping email")
        return False

    payload: Dict[str, Any] = {
        "from": from_addr,
        "to": [to],
        "subject": subject,
        "html": html,
    }
    if reply_to:
        payload["reply_to"] = reply_to
    if attachments:
        payload["attachments"] = attachments

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.post(RESEND_API, json=payload, headers=headers)
            if r.status_code >= 300:
                logger.error("Resend error %s: %s", r.status_code, r.text)
                return False
            return True
    except Exception as e:
        logger.exception("Resend exception: %s", e)
        return False


def _layout(title: str, body_html: str, cta_label: Optional[str] = None, cta_url: Optional[str] = None) -> str:
    cta_html = ""
    if cta_label and cta_url:
        cta_html = (
            f'<a href="{cta_url}" style="display:inline-block;padding:14px 24px;'
            f'background:#1C1C1A;color:#FAFAF9;text-decoration:none;border-radius:10px;'
            f'font-weight:500;margin-top:16px;">{cta_label}</a>'
        )
    return f"""
<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#FAFAF9;padding:32px;color:#1C1C1A;margin:0;">
  <div style="max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #E5E5E2;border-radius:16px;padding:32px;">
    <div style="font-size:24px;font-weight:500;letter-spacing:-0.5px;">bachein</div>
    <div style="color:#6B6B66;font-size:11px;letter-spacing:1px;margin-bottom:24px;">SECURE · SIGNED · VERIFIED</div>
    <h2 style="font-size:20px;font-weight:500;margin:0 0 12px 0;">{title}</h2>
    {body_html}
    {cta_html}
    <hr style="border:none;border-top:1px solid #E5E5E2;margin:28px 0 16px 0;"/>
    <div style="color:#6B6B66;font-size:11px;line-height:16px;">This is an automated message from Bachein. Do not share verification codes or magic links.</div>
  </div>
</body></html>
"""


async def email_doc_received(to: str, sender_name: str, doc_title: str, app_url: str, magic_token: str, doc_id: str) -> bool:
    link = f"{app_url}/magic?token={magic_token}&doc={doc_id}"
    body = f"""
<p style="line-height:22px;color:#4A4A46;">
<b>{sender_name}</b> sent you a secure document on Bachein: <b>{doc_title}</b>.
</p>
<p style="line-height:22px;color:#4A4A46;">
Tap below to verify your identity and review the document. The link signs you in automatically.
</p>
"""
    return await send_email(to, f"📨 You received a secure document: {doc_title}", _layout("Secure document received", body, "Open & Verify", link))


async def email_otp(to: str, code: str, doc_title: str) -> bool:
    body = f"""
<p style="line-height:22px;color:#4A4A46;">Your one-time access code for <b>{doc_title}</b> is:</p>
<div style="font-family:Courier,monospace;font-size:36px;letter-spacing:12px;background:#F0F0EE;padding:18px;border-radius:10px;text-align:center;font-weight:500;">{code}</div>
<p style="color:#6B6B66;font-size:12px;margin-top:14px;">This code expires in 10 minutes.</p>
"""
    return await send_email(to, f"🔐 Bachein OTP: {code}", _layout("Verification code", body))


async def email_signed_notification(to: str, signer_email: str, doc_title: str, app_url: str, doc_id: str) -> bool:
    link = f"{app_url}/document/{doc_id}"
    body = f"""
<p style="line-height:22px;color:#4A4A46;"><b>{signer_email}</b> has signed your document: <b>{doc_title}</b>.</p>
<p style="line-height:22px;color:#4A4A46;">The signed agreement is now stored in your Evidence Vault with full audit trail.</p>
"""
    return await send_email(to, f"✅ Signed: {doc_title}", _layout("Document signed", body, "View Audit Trail", link))


async def email_magic_link(to: str, app_url: str, magic_token: str) -> bool:
    link = f"{app_url}/magic?token={magic_token}"
    body = f"""
<p style="line-height:22px;color:#4A4A46;">Tap the button below to sign in to Bachein. The link is valid for 15 minutes.</p>
"""
    return await send_email(to, "🔗 Your Bachein sign-in link", _layout("Sign in to Bachein", body, "Sign in", link))


async def email_pdf_attachment(to: str, subject: str, message: str, filename: str, pdf_bytes: bytes, password: Optional[str] = None) -> bool:
    body = f"""
<p style="line-height:22px;color:#4A4A46;">{message}</p>
{f'<p style="line-height:22px;color:#4A4A46;">🔐 This PDF is password-protected. Password: <b>{password}</b></p>' if password else ''}
<p style="color:#6B6B66;font-size:12px;margin-top:14px;">Sent via Bachein AI.</p>
"""
    attachments = [{
        "filename": filename,
        "content": base64.b64encode(pdf_bytes).decode(),
    }]
    return await send_email(to, subject, _layout("New document", body), attachments=attachments)
