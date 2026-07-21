# Bachein — PRD (v5: Word-class AI Editor + Collaboration + Verified Domain)

## Shipped in V5 (this session)
- **Resend domain verified & wired**: RESEND_FROM is now `Bachein <noreply@eddingtun.com>` — all emails (doc received, OTP, magic link, signed notifications, collaboration invites, PDF attachments) now deliver universally.
- **A. Word-class AI Editor** at `/editor` — full implementation, not a placeholder.
  - 15 document type picker (Movie Story, Novel, Legal Agreement, NDA, Patent, Business Proposal, Investor Pitch, Research Paper, Technical Documentation, Teacher Question Paper, Resume, Meeting Notes, Contract, Policy Document, Other)
  - Profession-aware AI backend: each doc type maps to a specialized system prompt — **Director Mode** for stories, **Lawyer Mode** for legal/NDA/contract, **Teacher Mode** for question papers, **Patent Attorney Mode** for patents, **Business Strategist**, **Pitch Coach**, **Researcher**, **Engineer (Technical writer)**, **Career Coach (resume)**, **Notes Mode**, **Policy Writer**, plus a generic **Assistant Mode**
  - Real rich-text editor (`react-native-pell-rich-editor`): bold/italic/underline, H1/H2/H3, bullet & numbered lists, blockquote, code, links, left/center/right alignment, undo/redo
  - **AI Command Bar** above the editor — natural-language instructions like "Make all headings Times New Roman size 22" are sent to Gemini 3.1 Pro with the profession-aware system prompt and the current HTML; response rewrites the document
  - Autosave every 3s of inactivity + save button + "saved 14:32" indicator
  - Version history stored on every save (previous HTML pushed to `versions` array)
  - Export to PDF (server renders via reportlab with brand watermark)
  - Backend: `/editor/types`, `/editor/save`, `/editor/list`, `/editor/{id}`, `/editor/ai-command`, `/editor/export-pdf`
- **Add Collaborator** (invite co-authors)
  - Top-right invite button opens a modal with email + permission picker (view / comment / edit / admin)
  - Backend `/editor/invite` upserts collaborator on the doc, auto-creates the user if new, issues a 14-day magic-link token targeting the editor doc, sends a branded invite email via Resend from `noreply@eddingtun.com`
  - Magic-link consume now honors `editor_doc_id` and redirects invitees straight into the editor
  - Collaborators list rendered under the editor with permission badges
- **Fixes carried in**:
  - Web upload actually works (platform-aware Blob/File handling in `uploadFile` & `fileToolUpload`)
  - CORS `expose_headers` for compression size headers
  - Signature step: Draw / Type / **Attach from photos** (3rd mode via expo-image-picker)

## Still queued in your priority order (F ✅ B ✅ I ✅ A ✅ → C → D → E → G → H)
- **C** Personal cloud workspace with 12 folders + storage quota + Free tier
- **D** Real-time collaboration (WebSockets, live cursors, presence indicators, comments)
- **E** System document handler (already declared in app.json — activates on EAS build)
- **G** GitHub Workspace connector (OAuth creds stored, shell live at `/github`)
- **H** Push notifications (needs FCM/Expo push token setup)

## Backend endpoints total (all live)
Auth · Google OAuth · Magic link + lookup · Face enroll/status · Documents CRUD · OTP send/verify · Face-verify (real Haar + pHash) · Voice-oath (real Whisper transcript match) · Sign · Status · Signed PDF · Audit PDF · Vault · AI generate/review/chat · Chat sessions · Chat actions · File upload · File-tools convert / compress-image / compress-pdf · **Editor types / save / list / get / ai-command / export-pdf / invite**
