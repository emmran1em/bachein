# Bachein — PRD (v3: Google Auth + File Kit + Real Biometrics + Voice Match)

## Stack
- Frontend: Expo Router (RN), TypeScript, react-native-svg, expo-audio, expo-camera, expo-document-picker, expo-web-browser
- Backend: FastAPI, Motor (MongoDB), JWT, bcrypt, emergentintegrations (Gemini), Resend, pypdf, reportlab, pdf2docx, python-docx, openpyxl, python-pptx, Pillow, opencv-python (face detect + hash), httpx (Whisper)
- AI: Gemini 3 Flash + Gemini 3.1 Pro (drafting/review), OpenAI Whisper-1 via Emergent Universal Key (voice STT match)
- Email: Resend (test mode — only delivers to `emmran1empire@gmail.com` until domain verified)

## V3 Features
- **Google sign-in** (Emergent OAuth) button on login screen
- **File Kit tab** — Image Compressor (Pillow), PDF Compressor (pypdf), Document Converter (PDF/DOCX/XLSX/PPTX/TXT/MD/JPG/PNG/WEBP → PDF/TXT/DOCX/JPG/PNG/WEBP). PDF↔DOCX uses `pdf2docx` for layout preservation.
- **Real face match** — OpenCV Haar cascade face detection + perceptual hash comparison. Auto-enrolls on first verification, then compares against enrolled hash on subsequent verifications. Distance logged in audit trail.
- **Real voice oath match** — Whisper-1 transcription + fuzzy token overlap similarity ≥ 0.5 threshold. Backend rejects mismatched oaths with actual transcript in error.
- **Mandatory recipient email** — enforced both frontend and backend for secure documents.
- **File-open intent filters** — app.json declares Android `intentFilters` and iOS `CFBundleDocumentTypes` so Bachein appears in "Open with…" for PDF/DOCX/XLSX/PPTX/images (works after build, not in Expo Go).
- **Real emails, magic links, live-status polling, signed & audit PDF downloads, AI chat with PDF attach + email action** — all carried over from V2.

## Endpoints (V3 additions)
- `POST /api/auth/google/session` — exchange Emergent OAuth session_id → Bachein JWT
- `POST /api/auth/face/enroll` — save perceptual face hash
- `GET /api/auth/face/status`
- `GET /api/file-tools/formats`
- `POST /api/file-tools/convert` (multipart, `target` form field)
- `POST /api/file-tools/compress-image` (multipart, `quality`)
- `POST /api/file-tools/compress-pdf` (multipart)

Voice/Face endpoints now perform real ML matching, not stub storage.

## Testing
- Backend V3: 80/82 PASS (97.6%). 2 pre-existing minor issues addressed post-report (signed-pdf `?token=` and prefs tier validation).

## Known limitations
- Resend free tier — universal delivery requires domain verification
- GitHub sign-in not wired (needs GitHub OAuth app credentials from user)
- Document converter for PPTX/XLSX → PDF extracts text only (not full layout); PDF↔DOCX uses pdf2docx layout engine
- Face match uses Haar + perceptual hash (lightweight); AWS Rekognition CompareFaces would be more accurate but requires AWS keys
- File-open intent filters only activate in EAS build, not in Expo Go
