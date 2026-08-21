# Bachein — PRD (v7: Viewer, Scanner, Drafts, Word Tools + Expo Go fix)

## Shipped in V7 (this session)
- **Expo Go crash FIXED**: stray duplicate code fragments in `CameraCapture.native.tsx` and `downloads.tsx` broke the native bundle — removed; android + web bundles compile
- **More drawer** (home hamburger): added Downloads, Saved Drafts, Scan Document entries
- **In-app Document Viewer** `/viewer` (params url, name): iOS WebView direct, Android via Google Docs viewer, web iframe; Share button; Downloads rows now open in viewer; ⋯ menu gained "Open"
- **Phase 8 — Word tools in `/editor`**: tools-btn sheet → Find & Replace (text-node-safe replace all), Page Setup (narrow/normal/wide margins, header, footer, page numbers → applied by upgraded POST /api/editor/export-pdf which now renders headings/blocks + chrome, native export shares the PDF), AI Proofread (spelling & grammar via editorAi), font-size chips (S/M/L/XL), toolbar + strikethrough/indent/outdent/removeFormat
- **Phase 9 — `/drafts`**: saved drafts list, version history sheet (GET /api/editor/{id}/versions), version preview + restore
- **Phase 11 — `/scanner`**: OpenCV edge detection + perspective correction + CLAHE/B&W enhancement (POST /api/scanner/process), multi-page capture with thumbnails, POST /api/scanner/create-pdf → saved to Downloads (kind 'scan') and opened in viewer; full permission contract (settings redirect)
- **New AI logo**: user's transparent b\ mark at `assets/images/bachein-ai.png` used by BacheinAiLogo (AI tab, chat, papers screens)
- Voice Oath: confirmed works in Expo Go AND after publishing (foreground expo-audio + backend Azure REST; web uses browser speech over HTTPS)

## Shipped in V6
- **Phase 4 v2 — Question Paper Creator (production)** at `/ai/question-paper`
  - Inputs: Board (CBSE/ICSE/State/IB), Academic Year (2022-23…2026-27), Class 6-12, class-aware Subject list (6-10: Maths Standard/Basic, Science, Social Science, English, Tamil, IT · 11-12: Maths, Physics, Chemistry, Biology, CS, English, Yoga), Difficulty (Easy/Moderate/Board Level/Challenging), Number of Sets (1-3), optional chapters
  - Background job pipeline: blueprint LLM call → per-section question calls → PDF render; progress + progress_pct polled by UI
  - **Official CBSE-format PDF** (reportlab platypus): Series code, SET-n, Q.P. Code box, Roll No boxes, NOTE box, centered title, Time/Max Marks, General Instructions, sections with marks lines, marks column, OR internal choices, "Page x of y" + P.T.O. footers
  - **Real embedded figures** via matplotlib (`qp_engine.render_figure`): graphs (expressions), bar/line/pie, geometry primitives (polygon/circle/segment/arc/point/text/rect/arrow), flowcharts, tables
  - Preview screen with per-question regenerate, per-section regenerate, Generate Another Set, Download/Share, Print (web)
  - Endpoints: GET `/aiw/qp-options`, POST `/aiw/question-paper`, POST `/aiw/question-papers/{id}/regenerate` (q_no|section), POST `/aiw/question-papers/{id}/new-set`, GET `/aiw/question-papers/{id}` (poll), GET `.../pdf?token=`
- **Phase 5 v2 — Evaluated Topper Answer Booklet** at `/ai/answer-paper`
  - Upload PDF (text or scanned → vision transcription per page, up to 8 pages), image, txt, or paste text
  - Pipeline: transcribe → extract ALL questions → answer in batches of 6 → merge; long papers fully answered
  - **Evaluated ruled-booklet PDF** (`answer_engine.render_evaluated_booklet`): blue rules + red margin, Q numbers in margin, red ✓ ticks per step, step marks (+0.5) at right, circled per-question totals (x/y), examiner remarks, front-page TOTAL box, section headers, embedded answer diagrams
  - UI: progress screen, EXAMINER TOTAL card, jump-to-question chips with marks, per-answer award badges/ticks/remarks, booklet PDF share
- **Phase 6 — Downloads** at `/downloads` (done previous iteration): auto-saved generated PDFs, ⋯ menu Share (native sheet)/Rename/Delete; entries auto-registered by both generators; regenerate re-renders the stored PDF
- **Phase 7 — Edit Assignment** in `/editor`
  - "Or edit an existing document" import (PDF/DOCX/TXT → HTML via POST `/api/editor/import`, python-docx + PyMuPDF)
  - Images modal: "Insert image position" adds numbered `[Image Position N]` placeholder at cursor; "Upload & auto-insert images" maps Image i → Position i (extras appended)
- **Face auto-capture** (previous iteration): live polling of POST `/api/documents/face-detect` (Haar), oval turns green, "hold still", auto-captures (native + web)
- Voice Oath confirmed working in Expo Go (expo-audio foreground recording + Azure Speech backend) — no build required

## Key modules
- `/app/backend/qp_engine.py` — subject catalog, figure renderer, CBSE PDF renderer
- `/app/backend/answer_engine.py` — evaluated booklet renderer
- `/app/backend/ai_workspace.py` — AI routes incl. background tasks (_generate_paper_task, _answer_paper_task, _regen_task)
- `/app/backend/downloads_routes.py` — downloads CRUD + file serving
- matplotlib added to requirements.txt

## Known limitations / notes
- RichEditor body doesn't render on the **web preview** (react-native-webview limitation) — works on native; optional web fallback pending
- Syllabus/blueprint accuracy comes from LLM knowledge (no live CBSE website crawl)
- Face verification match still Haar/pHash (AWS Rekognition pending)

## Still queued (user's roadmap)
- Phase 10: File Kit additions (Protect/Unlock Document, OCR, PDF enhancement)
- GitHub Workspace connector — creds (GITHUB_CLIENT_ID/SECRET) already in backend/.env; NEEDS user to set OAuth callback URL in their GitHub OAuth App before building
- AWS Rekognition face match · System document handler (EAS build) · Push notifications
- Refactor: split server.py into routers (auth/documents)

## June 2026 fork — iterations 11–13 (all testing-agent green)
- **Floating dock** bottom nav (Home, Documents, center Create +, File Kit, AI); hides when keyboard opens
- **Editor**: 401 auto-logout (JWT now 30d), autosave→drafts on back, AI command writes NEW content too, spelling/grammar proofread, typed font sizes 6–96 + preset chips, searchable font picker with CSS fallback stacks, font colour palette (8 dots), default black text, horizontal A4 column pages (native webview only), ghost inline grey Shadow AI suggestion (span#bachein-ghost, stripped on save/export), long-press Ask Bachein bubble
- **NDA signed PDF** embeds sender+receiver signatures (draw/type/upload); signature dates date-only
- **OCR tool** `/ocr` (Gemini vision engine via ocr_service.py + <mark> uncertainty flags) + Edit Assignment drawer entry (/editor?import=1)
- **File Kit Phase 10**: Protect (AES-256) / Unlock PDF; **Sign Document** tool `/sign-pdf` (sign-prepare/sign-apply endpoints, draggable placement, embeds into PDF → Downloads)
- **Pro scanner** `/scanner`: fast capture → bg detect+warp (POST /scanner/detect, /scanner/apply), thumbnails, review modal (Crop draggable corners, Markup freehand → /scanner/annotate, Sign on image → /scanner/sign-image, Rotate, Filter, Retake, Delete), post-capture gallery grid (reorder arrows, add-page tile, Share/Sign/Save PDF); `?return=create` hands pages to create flow via src/lib/scanStore
- **create/mode.tsx** Take-photo bug fixed (was unimported Platform/FileSystem) — now routes to scanner
- **Viewer** horizontal page swiping (POST /api/pdf/pages) with fallback iframe/WebView
- **Templates**: TemplatePicker (5 NDA + 5 generic) in secure + normal create flows; ai/generate takes `template`, embeds 'Dated: <date>' (date only)
- **Receiver gating**: locked gate card pre-verification (content hidden), attachments + date-only dates shown post-unlock
- **Chat keyboard fix**: react-native-keyboard-controller KAV + composer clearance; KeyboardProvider in root layout
- Drawer scrollable (Profile/Log out reachable)

## Pending user inputs
- AWS Rekognition: needs AWS_ACCESS_KEY_ID/SECRET/region from user
- GitHub OAuth: user must set callback URL https://nda-hub-1.preview.emergentagent.com/github in their GitHub OAuth App
- Next big feature approved: local-first storage + user-owned Google Drive sync (needs Google OAuth creds w/ Drive scope)

## Iterations 14 (Droit AI + Voice agent + polish) — testing-agent green
- **Droit AI** (renamed from Bachein AI): system prompt introduces Droit; <DOCUMENT> tag → backend renders PDF → Downloads + artifact card in chat (view/share, Claude-style); <SEND email> tag → autonomously creates doc addressed to that email (recipient sees it in Received) + 'Sent to ✓' chip
- **Chat UI Claude-style**: left cream history drawer (84% width), serif assistant font, 'Ask Droit anything' placeholder
- **Voice agent**: real two-way voice — /api/aiw/voice/converse (ElevenLabs scribe_v1 STT → same chat brain → eleven_turbo_v2_5 TTS, voice Sarah EXAVITQu4vr4xnSDxMaL — free-tier key can't use Rachel), /voice/say for greetings; frontend voice overlay OVER Home (BlurView + rainbow animated border + pulsing orb + resonating rings, states idle/listening/thinking/speaking/denied/error, metering auto turn-end 1.4s silence, tap-to-interrupt); orb asset assets/images/voice-orb.png; orb button on Home header + chat header
- **AWS Rekognition** live: face_match.match() uses CompareFaces (falls back to pHash); creds in backend/.env (us-east-1)
- **GitHub OAuth creds updated** in .env (flow still pending build)
- **Home**: extension badge (.pdf/.docx) on rows, long-press + ellipsis (⋮) → Share PDF / Delete (DELETE /api/documents/{id}, sender-only), PDF filter shows ALL docs incl NDA, drawer scroll fixed (overlay/View restructure) + legal entries
- **Legal pages** /legal?section=terms|children|ai|legal; **Profile** shows Bachein v1.0.0
- **Upload existing**: Done → success card → Next → POST /api/downloads/import (image→PDF) → Share + View document
- **Viewer**: pointer (color-wand) → circle word → POST /api/viewer/explain (Gemini vision crop) → half-sheet explanation
- **Scanner**: single round-trip processing (faster); PageSign has explicit Add-signature reopen button
- **Disclaimer fixed everywhere**: "AI can make mistake, please check important info."
- JWT 30 days; elevenlabs+boto3 in requirements.txt

## Deferred (user's pre-deploy list — next phase)
- Full RAG pipeline (ChromaDB embeddings, chunking, retrieval) + Textract auto-OCR fallback + document versioning/change-review (accept/reject) + DOCX/HTML export of Droit docs
- Upload-existing → open scanner Pages section directly with rename-at-top
- Viewer A4 smoothness pass + lock/highlight tools in viewer
- Compressor upgrade w/ Ghostscript (gs not installed in pod)
- Google Drive local-first sync, GitHub connector OAuth flow
