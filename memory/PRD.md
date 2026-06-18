# Bachein — Product Requirements (MVP V1)

## Vision
Bachein is an AI-powered secure document creation, sharing, NDA execution, digital signing, and trust verification platform. Mobile-first (Expo / React Native) with FastAPI + MongoDB backend.

## Stack
- Frontend: Expo Router (React Native), TypeScript, react-native-svg, expo-audio, AsyncStorage
- Backend: FastAPI, Motor (MongoDB), JWT auth (bcrypt), emergentintegrations (Gemini)
- AI: Gemini 3 Flash (generation) + Gemini 3.1 Pro (legal review) via Emergent Universal LLM Key

## V1 Scope (Implemented)
### Auth
- JWT email/password signup + login
- Token persisted via AsyncStorage

### Sender flow
- Home dashboard: list of created documents with status pill, stats, "Check Status" CTAs
- Bottom-center Create FAB
- Category picker (NDA, Patent/IP, Legal, Confidential, Financial, Org, Employment, Freelancer, Investor, Manufacturing, Secure PDF, Normal PDF)
- Normal PDF: AI Generator using Gemini — picks sub-type (Question Paper, Report, etc), generates title + cover + content, save to vault
- Secure flow: intent prompt → AI draft (with auto Legal Review showing missing clauses / risks / recommendations) → Security Configuration toggles → Recipient email → Send
- Document detail screen with full status tracker (delivered/opened/OTP/voice/read%/signature/timestamp)

### Receiver flow
- Received tab listing assigned documents
- Sequential verification wizard: Review → OTP (with demo OTP shown) → Voice Oath (record audio) → Digital Signature (SVG signature pad) → Confirmation → Unlocked Protected Content
- Read progress auto-tracked via scroll

### Evidence Vault
- All signed documents (sent + received) with audit metadata

### Security Toggles (UI + persisted to config)
OTP, Voice Oath, Digital Signature, Face Verification, Device Verification, Dynamic Watermark, Disable Download/Forwarding/Printing, Screenshot Detection, Geo Restriction, Time-Limited Viewing, Evidence Logging.

Backend enforces OTP and Voice Oath gates before signature when configured.

## Out of Scope / Deferred
- File upload (PDF/DOCX/PPTX/XLSX) attach + parsing — backend supports `attached_files` field but UI uploader deferred
- Real face verification (mock simulated capture deferred)
- Email/SMS for OTP delivery (currently returns demo OTP in API)
- Watermarking PDF rendering
- Geo / device restriction enforcement

## API (prefix `/api`)
- `POST /auth/signup`, `POST /auth/login`, `GET /auth/me`
- `GET /categories`
- `POST /ai/generate`, `POST /ai/review`
- `POST /documents`, `GET /documents/sent`, `GET /documents/received`, `GET /documents/{id}`
- `POST /documents/{id}/send-otp`, `POST /documents/verify-otp`
- `POST /documents/voice-oath`, `POST /documents/read-progress`, `POST /documents/sign`
- `GET /documents/{id}/status`, `GET /vault`

## Smart Business Enhancement (next)
- Per-document verification level → premium tier (Standard / Pro Audit / Enterprise) drives revenue per signed envelope.
