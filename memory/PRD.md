# Bachein — PRD (v4: UI Refresh + Documents Hub + Home Redesign)

## What shipped in V4
- **New Claude/Anthropic-inspired UI palette** — warm parchment surface (#F7F5F0), rust accent (#C5613E), softer radii, refined typography, custom logo (`bachein` wordmark with accent underline). No more purple/violet AI slop.
- **AI avatar component** — minimal chip-icon robot mark with accent dot, used in Home and Chat.
- **File Kit rebuilt** — no file size limits, 4-level compression slider (Extreme ~90% / Strong ~80% / Balanced ~60% / Light ~30%), proper error surfacing (no more `[object Object]`), native save to app Downloads folder with share sheet, persistent Downloads history in AsyncStorage, three-dot menu at top-left for Downloads & Clear.
- **Documents tab** (renamed from Inbox) — segmented **Sent | Received** view with unread badge, different row layouts for Normal PDF (Open button only) vs Secure/NDA (Category + status chips + verification chips + Status/Verify button), three-dot More menu with Write Document + GitHub Workspace + Scan.
- **Home = Document hub** — dynamic greeting, AI card, 4 quick actions (Create / Write / Documents / Vault), 4 stats (Sent/Received/Signed/Pending), and up to 4 dynamic sections: Recently received / Your documents / Pending signatures / Recently signed.
- **Send-success feedback** — green success toast at top + two-note "sent" audio tone the moment a secure doc is dispatched.
- **Global Toast host** — one central non-blocking notification system used across the app.
- **New routes** stubbed: `/editor` (Write Document — full editor coming next), `/github` (GitHub Workspace — OAuth credentials configured, connector coming next).

## Backend additions in .env
- RESEND_API_KEY updated to new key with verified-domain plan
- GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET stored
- AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION stored for future Rekognition integration

## Still to build (queued in priority order F→B→I→A→C→D→E→G→H)
- ✅ F. UI refresh — DONE this session
- ✅ B. Sent + Received redesign + sound/toast — DONE
- ✅ I. Home hub — DONE
- ⏳ A. Word-like AI editor with Command Bar + profession modes (Director/Lawyer/Teacher/Novelist/Researcher/Patent/Business/Engineer/Custom) — placeholder route created
- ⏳ C. Personal cloud workspace (My Drive / Drafts / Sent / Received / Vault / Signed / Templates / Imports / Shared / Favorites / Recent / Trash) + storage quota + Free tier limits
- ⏳ D. Real-time collab (WebSockets, live cursors, presence, version history, comments)
- ⏳ E. System document handler registration (Android intent filters + iOS UTIs are declared, activates on EAS build)
- ⏳ G. GitHub Workspace connector — OAuth + repo/file browser + AI-with-repo-context — placeholder route created
- ⏳ H. Push notifications (needs Emergent-managed push + FCM key from user)

## Setup you still need to do
- **Resend domain**: RESEND_FROM still uses `onboarding@resend.dev`. Tell me which domain you verified at resend.com/domains and I'll switch RESEND_FROM to `noreply@<yourdomain>`.
- **Deployment/publishing**: use the Emergent Publish button (top-right) when ready — that generates a signed EAS build activating the "Open with Bachein" file handler on device.
