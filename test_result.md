#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

## user_problem_statement: NDA/receiver improvements
1) Voice oath: currently not functioning. Must do exact word-match with real-time word highlighting, max 5 attempts, waveform "listening" UI (not "recording").
2) Fix face verification black-screen / "face not captured" bug on selfie capture.
3) Sender signs during NDA creation (Disclosing Party). Receiver sees sender's signature IN the doc. After receiver signs (inline bottom-sheet: draw/type/attach), both parties see completed doc. (Option 2 — inline signing chosen.)
4) Security Details panel on the document view — show face selfie, voice audio + transcript, OTP status, enabled features, audit log.

## backend:
  - task: "Voice oath — word-level match + 5-attempt limit + word-by-word feedback"
    implemented: true
    working: "NA"
    file: "/app/backend/voice_match.py, /app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "Rewrote voice_match to include per-word matching (fuzzy for typos), and server voice-oath endpoint now increments voice_attempts, returns matched_words+said_words+attempts_left, rejects after 5 with HTTP 423. Added GET /api/documents/voice-oath-text."

  - task: "Sender signature during NDA creation + storage + rendering"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "DocumentCreate now accepts sender_signature (JSON string). Added POST /documents/{id}/sender-sign to allow updating post-hoc. DocumentOut exposes sender_signature, sender_signed_at, receiver_signature. Verified via curl."

  - task: "Security Details endpoint"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "Added GET /api/documents/{id}/security-artifacts returning face image, voice audio + transcript + similarity + attempts, OTP, signature status and full audit_log."

  - task: "Face detection: more lenient multi-pass Haar detection"
    implemented: true
    working: "NA"
    file: "/app/backend/face_match.py, /app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "Multi-pass Haar (frontal + profile, histogram-equalized, progressive minSize/scale). Better error messages when selfie base64 <500 chars. Auto-enroll on first capture."

## frontend:
  - task: "SignatureBottomSheet reusable component (draw/type/attach)"
    implemented: true
    working: "NA"
    file: "/app/frontend/src/components/SignatureBottomSheet.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "New bottom-sheet modal with draw (SVG), type (italic font), attach (ImagePicker). Includes SignatureView renderer that displays the signature inline in the document (respects mode)."

  - task: "Secure NDA creation flow: sender signs inline"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/create/secure.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "Added 'sign' step between security config and recipient step. Shows doc preview with Signatures section — tapping 'Sign as Disclosing Party' opens SignatureBottomSheet. Signature is embedded in document as JSON string and posted with createDocument."

  - task: "Receiver flow: voice UI (word highlighting), listening pulse, face fix, inline signing"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/receive/[id].tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "1) Word pills for each required oath word — green when matched, red when missed. 2) Animated pulse rings + mic button — 'Listening… tap to stop'. 3) Camera fix — waits for onCameraReady, small delay before capture, base64 sanity check, better error messages. 4) Sender signature rendered inline in doc during review. 5) Receiver signs via inline bottom-sheet at their SIGNATURES line."

  - task: "Document view: inline signatures + Security Details panel"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/document/[id].tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "1) SIGNATURES section rendered inside the doc for both sender & receiver, using SignatureView. 2) 'Security' chip in header opens bottom-sheet with face image (tap to fullscreen), voice audio player + transcript, OTP status, enabled features, audit log."

## metadata:
  created_by: "main_agent"
  version: "1.0"
  test_sequence: 5
  run_ui: true

## test_plan:
  current_focus:
    - "Voice oath — word-level match + 5-attempt limit + word-by-word feedback"
    - "Sender signature during NDA creation + storage + rendering"
    - "Security Details endpoint"
    - "Face detection: more lenient multi-pass Haar detection"
    - "SignatureBottomSheet reusable component (draw/type/attach)"
    - "Secure NDA creation flow: sender signs inline"
    - "Receiver flow: voice UI (word highlighting), listening pulse, face fix, inline signing"
    - "Document view: inline signatures + Security Details panel"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

## agent_communication:
  - agent: "main"
    message: "Implemented Phase A + B + C of NDA/receiver improvements. Backend already verified via curl (auth, sender_signature, security-artifacts, voice-oath-text, attempt counting). Ready for full backend endpoint verification and frontend E2E testing. Test users: alice@bachein.com / Test1234! (sender), bob@bachein.com / Test1234! (receiver)."
