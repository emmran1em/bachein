# Bachein — PRD (v2: AI Chat + Real Email + File Upload + Face Verify)

## Stack
- Frontend: Expo Router (React Native), TypeScript, react-native-svg, expo-audio, expo-camera, expo-document-picker, expo-file-system
- Backend: FastAPI, Motor (MongoDB), JWT auth (bcrypt), emergentintegrations (Gemini), Resend (HTTP API via httpx), pypdf, reportlab
- AI: Gemini 3 Flash + Gemini 3.1 Pro via Emergent Universal LLM Key
- Email: Resend API (test mode — only delivers to account holder until a custom domain is verified at resend.com/domains)

## Features (V2 — current)

### Auth & Identity
- JWT email/password signup + login
- **Magic-link sign-in** (15-min token, email-delivered). Receivers auto-provisioned on first email click.
- Token persisted via AsyncStorage
- Dark-mode + tier preferences (standard/pro/enterprise)

### Sender flow
- Home dashboard with stats, sticky create FAB, document list with auto-refreshing status
- Category picker (12 categories)
- Normal PDF: Gemini AI generator with sub-types (Question Paper, Report, Notes, …)
- Secure flow: intent → AI draft → AI Legal Review (missing/risks/recommendations) → **Attach Files (PDF/DOCX/XLSX/PPTX/images)** with server-side parsing + AI auto-flagging (Patent / Source code / Financial / Research) → 13 Security Toggles → Recipient → Send
- **Real email** to recipient with magic-link CTA (Resend integration)
- Document detail with **live status tracker (4-s polling)** + downloadable Signed PDF + Audit Report (both with query-param JWT for in-app viewing)

### Receiver flow
- Magic-link landing → auto sign-in
- Inbox tab listing assigned documents
- Sequential verification: Review → OTP (emailed) → **Face verification (selfie via expo-camera)** → Voice Oath → **Signature (draw OR type)** → Confirmation → Unlocked Protected Content
- Auto-tracks reading progress via scroll
- Sender automatically receives "signed" notification email + dashboard reflects signed state without manual refresh

### Bachein AI (tab — full chat)
- Multi-turn streaming chat with Gemini
- Attach PDF → backend extracts text via pypdf → AI summarizes/modifies/translates/extracts clauses
- "Set password X on this PDF and email to friend@example.com" → AI emits ACTION_JSON → user taps "Send Email" → backend builds PDF (reportlab) → password-protects (pypdf) → sends via Resend
- Persistent chat history per session; multiple sessions per user

### Evidence Vault
- Signed sent + received with audit metadata
- Audit PDF report download
- Signed PDF (with watermark) download

## Endpoints (prefix /api)
Auth: signup, login, me, prefs(PATCH), magic/request, magic/consume  
AI: generate, review, chat, chat/sessions, chat/{id}, chat/action  
Files: upload  
Documents: CRUD, send-otp, verify-otp, face-verify, voice-oath, read-progress, sign, status, signed-pdf (token query), audit-pdf (token query), vault

## Email templates (Resend)
- Welcome / Sign-in magic link
- Document received (with magic-link CTA)
- OTP code
- Document signed (sender notification)
- PDF attachment (from AI chat) with optional password

## Limitations
- Resend free tier: emails ONLY deliver to the account-holder address (`emmran1empire@gmail.com`). To deliver to any recipient, verify a domain at resend.com/domains and update `RESEND_FROM` in `/app/backend/.env`. The endpoints return `sent:false` gracefully when this happens.
- Face verification stores a captured selfie as evidence — no biometric match (no Face++ / AWS Rekognition wired in).
- WhatsApp delivery (mentioned in spec) not yet wired.

## Revenue lever
Tier system in place (standard/pro/enterprise). Pro = unlimited signed envelopes + audit PDF. Enterprise = priority routing + custom domain branding. UI surfacing deferred.
