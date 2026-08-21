import AsyncStorage from '@react-native-async-storage/async-storage';

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || '';
const API = `${BASE}/api`;

const TOKEN_KEY = 'bachein_token';
const USER_KEY = 'bachein_user';
const PREFS_KEY = 'bachein_prefs';

export async function setToken(token: string) { await AsyncStorage.setItem(TOKEN_KEY, token); }
export async function getToken(): Promise<string | null> { return AsyncStorage.getItem(TOKEN_KEY); }
export async function setUser(user: any) { await AsyncStorage.setItem(USER_KEY, JSON.stringify(user)); }
export async function getUser(): Promise<any | null> {
  const raw = await AsyncStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}
export async function clearAuth() { await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY, PREFS_KEY]); }

export async function setPref(k: string, v: any) {
  const raw = await AsyncStorage.getItem(PREFS_KEY);
  const all = raw ? JSON.parse(raw) : {};
  all[k] = v;
  await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(all));
}
export async function getPrefs(): Promise<any> {
  const raw = await AsyncStorage.getItem(PREFS_KEY);
  return raw ? JSON.parse(raw) : {};
}

async function request<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers as any),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { ...opts, headers });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    if (res.status === 401) {
      // Stale/expired session — clear it and send the user to login
      try {
        await AsyncStorage.removeItem(TOKEN_KEY);
        const { router } = require('expo-router');
        router.replace('/login');
      } catch {}
      throw new Error('Session expired — please log in again');
    }
    const msg = data?.detail || data?.message || `Request failed (${res.status})`;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  return data as T;
}

export const BACKEND = BASE;
export const API_BASE = API;

export const api = {
  googleSession: (session_id: string) =>
    request('/auth/google/session', { method: 'POST', body: JSON.stringify({ session_id }) }),
  enrollFace: (image_base64: string) =>
    request('/auth/face/enroll', { method: 'POST', body: JSON.stringify({ image_base64 }) }),
  faceStatus: () => request('/auth/face/status'),
  fileFormats: () => request('/file-tools/formats'),
  signup: (email: string, password: string, name: string) =>
    request('/auth/signup', { method: 'POST', body: JSON.stringify({ email, password, name }) }),
  login: (email: string, password: string) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  me: () => request('/auth/me'),
  updatePrefs: (prefs: { dark_mode?: boolean; tier?: string }) =>
    request('/auth/prefs', { method: 'PATCH', body: JSON.stringify(prefs) }),
  magicRequest: (email: string) =>
    request('/auth/magic/request', { method: 'POST', body: JSON.stringify({ email }) }),
  magicConsume: (token: string) =>
    request('/auth/magic/consume', { method: 'POST', body: JSON.stringify({ token }) }),
  categories: () => request('/categories'),
  generate: (body: { prompt: string; category: string; sub_type?: string; template?: string }) =>
    request('/ai/generate', { method: 'POST', body: JSON.stringify(body) }),
  review: (document_text: string) =>
    request('/ai/review', { method: 'POST', body: JSON.stringify({ document_text }) }),
  chat: (body: { session_id?: string; message: string; pdf_context?: string }) =>
    request('/ai/chat', { method: 'POST', body: JSON.stringify(body) }),
  chatSessions: () => request('/ai/chat/sessions'),
  chatSession: (id: string) => request(`/ai/chat/${id}`),
  chatAction: (body: { session_id: string; action: string; payload: any }) =>
    request('/ai/chat/action', { method: 'POST', body: JSON.stringify(body) }),

  // ─── AI Workspace (Phase 1) ───
  aiwProviders: () => request('/aiw/providers'),
  aiwSettings: () => request('/aiw/settings'),
  aiwPatchSettings: (body: { default_provider?: string; tier?: string }) =>
    request('/aiw/settings', { method: 'PATCH', body: JSON.stringify(body) }),
  aiwSaveKey: (provider: string, api_key: string) =>
    request('/aiw/keys', { method: 'POST', body: JSON.stringify({ provider, api_key }) }),
  aiwDeleteKey: (provider: string) => request(`/aiw/keys/${provider}`, { method: 'DELETE' }),
  aiwTestKey: (provider: string) => request(`/aiw/keys/${provider}/test`, { method: 'POST' }),
  aiwQuota: () => request('/aiw/quota'),
  aiwConversations: () => request('/aiw/conversations'),
  aiwCreateConversation: (body: { title?: string; provider?: string }) =>
    request('/aiw/conversations', { method: 'POST', body: JSON.stringify(body) }),
  aiwConversation: (id: string) => request(`/aiw/conversations/${id}`),
  aiwPatchConversation: (id: string, body: { title?: string; pinned?: boolean }) =>
    request(`/aiw/conversations/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  aiwDeleteConversation: (id: string) =>
    request(`/aiw/conversations/${id}`, { method: 'DELETE' }),
  aiwChat: (body: { conversation_id?: string; message: string; provider?: string; quick_action?: string; attachments?: any[] }) =>
    request('/aiw/chat', { method: 'POST', body: JSON.stringify(body) }),
  aiwExplain: (body: { text: string; context?: string; style?: string; provider?: string }) =>
    request('/aiw/explain', { method: 'POST', body: JSON.stringify(body) }),
  aiwQuestionPaper: (body: any) =>
    request('/aiw/question-paper', { method: 'POST', body: JSON.stringify(body) }),
  aiwQuestionPapers: () => request('/aiw/question-papers'),
  aiwQuestionPaper1: (id: string) => request(`/aiw/question-papers/${id}`),
  aiwQuestionPaperPdfUrl: (id: string) => `${BASE}/api/aiw/question-papers/${id}/pdf`,
  // ─── AI Workspace (Phase 5 — Topper Answers) ───
  aiwAnswerPaper: (body: any) =>
    request('/aiw/answer-paper', { method: 'POST', body: JSON.stringify(body) }),
  aiwAnswerPapers: () => request('/aiw/answer-papers'),
  aiwAnswerPaper1: (id: string) => request(`/aiw/answer-papers/${id}`),
  aiwAnswerPaperPdfUrl: (id: string) => `${API}/aiw/answer-papers/${id}/pdf`,
  // ─── Question Paper v2 ───
  qpOptions: () => request('/aiw/qp-options'),
  aiwQpRegenerate: (id: string, body: { q_no?: string; section?: string }) =>
    request(`/aiw/question-papers/${id}/regenerate`, { method: 'POST', body: JSON.stringify(body) }),
  aiwQpNewSet: (id: string) =>
    request(`/aiw/question-papers/${id}/new-set`, { method: 'POST' }),
  // ─── Downloads (Phase 6) ───
  downloads: () => request('/downloads'),
  downloadsRename: (id: string, name: string) =>
    request(`/downloads/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  downloadsDelete: (id: string) => request(`/downloads/${id}`, { method: 'DELETE' }),
  downloadFileUrl: (id: string) => `${API}/downloads/${id}/file`,
  // ─── Live face detection (auto-capture) ───
  faceDetect: (image_base64: string) =>
    request('/documents/face-detect', { method: 'POST', body: JSON.stringify({ image_base64 }) }),
  createDocument: (body: any) =>
    request('/documents', { method: 'POST', body: JSON.stringify(body) }),
  listSent: () => request('/documents/sent'),
  listReceived: () => request('/documents/received'),
  getDocument: (id: string) => request(`/documents/${id}`),
  sendOtp: (id: string) => request(`/documents/${id}/send-otp`, { method: 'POST' }),
  verifyOtp: (document_id: string, otp: string) =>
    request('/documents/verify-otp', { method: 'POST', body: JSON.stringify({ document_id, otp }) }),
  faceVerify: (document_id: string, image_base64: string) =>
    request('/documents/face-verify', { method: 'POST', body: JSON.stringify({ document_id, image_base64 }) }),
  voiceOath: (document_id: string, audio_base64: string, transcript?: string) =>
    request('/documents/voice-oath', { method: 'POST', body: JSON.stringify({ document_id, audio_base64, transcript }) }),
  readProgress: (document_id: string, progress: number) =>
    request('/documents/read-progress', { method: 'POST', body: JSON.stringify({ document_id, progress }) }),
  sign: (document_id: string, signature_base64: string) =>
    request('/documents/sign', { method: 'POST', body: JSON.stringify({ document_id, signature_base64 }) }),
  senderSign: (document_id: string, signature_base64: string) =>
    request(`/documents/${document_id}/sender-sign`, { method: 'POST', body: JSON.stringify({ signature_base64 }) }),
  voiceOathText: () => request('/documents/voice-oath-text'),
  securityArtifacts: (document_id: string) => request(`/documents/${document_id}/security-artifacts`),
  status: (id: string) => request(`/documents/${id}/status`),
  vault: () => request('/vault'),
  editorTypes: () => request('/editor/types'),
  editorList: () => request('/editor/list'),
  editorGet: (id: string) => request(`/editor/${id}`),
  editorSave: (body: { id?: string; title: string; doc_type: string; html: string; plain_text?: string; page_setup?: any }) =>
    request('/editor/save', { method: 'POST', body: JSON.stringify(body) }),
  editorAi: (body: { doc_type: string; current_html: string; instruction: string }) =>
    request('/editor/ai-command', { method: 'POST', body: JSON.stringify(body) }),
  editorImport: (body: { file_base64: string; filename: string }) =>
    request('/editor/import', { method: 'POST', body: JSON.stringify(body) }),
  editorVersions: (id: string) => request(`/editor/${id}/versions`),
  editorSuggest: (body: { doc_type: string; current_html: string }) =>
    request('/editor/suggest', { method: 'POST', body: JSON.stringify(body) }),
  ocrExtract: (body: { file_base64: string; filename: string }) =>
    request('/ocr/extract', { method: 'POST', body: JSON.stringify(body) }),
  // ─── Scanner (Phase 11) ───
  scannerProcess: (image_base64: string, mode = 'color', rotate = 0) =>
    request('/scanner/process', { method: 'POST', body: JSON.stringify({ image_base64, mode, rotate }) }),
  scannerDetect: (image_base64: string) =>
    request('/scanner/detect', { method: 'POST', body: JSON.stringify({ image_base64 }) }),
  scannerApply: (body: { image_base64: string; corners?: number[][]; filter?: string; rotate?: number }) =>
    request('/scanner/apply', { method: 'POST', body: JSON.stringify(body) }),
  signApply: (body: { session_id: string; page_index: number; x: number; y: number; w: number; signature: any }) =>
    request('/file-tools/sign-apply', { method: 'POST', body: JSON.stringify(body) }),
  pdfPages: (pdf_base64: string) =>
    request('/pdf/pages', { method: 'POST', body: JSON.stringify({ pdf_base64 }) }),
  scannerAnnotate: (body: { image_base64: string; strokes: number[][][]; color?: string; width?: number }) =>
    request('/scanner/annotate', { method: 'POST', body: JSON.stringify(body) }),
  scannerSignImage: (body: { image_base64: string; signature: any; x: number; y: number; w: number }) =>
    request('/scanner/sign-image', { method: 'POST', body: JSON.stringify(body) }),
  downloadsImport: (body: { name: string; file_base64: string; mime: string }) =>
    request('/downloads/import', { method: 'POST', body: JSON.stringify(body) }),
  viewerExplain: (body: { image_base64: string; bbox: number[] }) =>
    request('/viewer/explain', { method: 'POST', body: JSON.stringify(body) }),
  deleteDocument: (id: string) => request(`/documents/${id}`, { method: 'DELETE' }),
  scannerCreatePdf: (images: string[], name?: string) =>
    request('/scanner/create-pdf', { method: 'POST', body: JSON.stringify({ images, name }) }),
  editorInvite: (body: { document_id: string; email: string; permission: string }) =>
    request('/editor/invite', { method: 'POST', body: JSON.stringify(body) }),
  signedPdfUrl: (id: string) => `${API}/documents/${id}/signed-pdf`,
  auditPdfUrl: (id: string) => `${API}/documents/${id}/audit-pdf`,
};

export async function uploadFile(file: { uri: string; name: string; type: string }): Promise<any> {
  const token = await getToken();
  const form = new FormData();
  const isWeb = typeof document !== 'undefined';
  if (isWeb) {
    const fetched = await fetch(file.uri);
    const blob = await fetched.blob();
    const asFile: any = (typeof File !== 'undefined')
      ? new File([blob], file.name, { type: file.type || blob.type || 'application/octet-stream' })
      : blob;
    form.append('file', asFile, file.name);
  } else {
    // @ts-ignore RN FormData
    form.append('file', { uri: file.uri, name: file.name, type: file.type });
  }
  const res = await fetch(`${API}/upload`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form as any,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt);
  }
  return res.json();
}

/** Multipart upload to any endpoint that returns JSON (e.g. /file-tools/sign-prepare). */
export async function uploadForm(endpoint: string, file: { uri: string; name: string; type: string }, extraFields: Record<string, string> = {}): Promise<any> {
  const token = await getToken();
  const form = new FormData();
  for (const [k, v] of Object.entries(extraFields)) form.append(k, v);
  const isWeb = typeof document !== 'undefined';
  if (isWeb) {
    const fetched = await fetch(file.uri);
    const blob = await fetched.blob();
    const asFile: any = (typeof File !== 'undefined')
      ? new File([blob], file.name, { type: file.type || blob.type || 'application/octet-stream' })
      : blob;
    form.append('file', asFile, file.name);
  } else {
    // @ts-ignore RN FormData
    form.append('file', { uri: file.uri, name: file.name, type: file.type });
  }
  const res = await fetch(`${API}${endpoint}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form as any,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.detail || `Upload failed (${res.status})`);
  return data;
}

export async function fileToolUpload(endpoint: string, file: { uri: string; name: string; type: string }, extraFields: Record<string, string> = {}): Promise<{ blobUri: string; base64?: string; headers: any; filename: string; contentType: string }> {
  const token = await getToken();
  const form = new FormData();
  for (const [k, v] of Object.entries(extraFields)) form.append(k, v);

  // Platform-aware file append: web needs real Blob/File, native uses {uri,name,type}
  const isWeb = typeof document !== 'undefined';
  if (isWeb) {
    // Fetch the picked file to get a Blob (works with expo DocumentPicker web URIs)
    const fetched = await fetch(file.uri);
    const blob = await fetched.blob();
    // File constructor is more compatible; fallback to Blob when unavailable
    const asFile: any = (typeof File !== 'undefined')
      ? new File([blob], file.name, { type: file.type || blob.type || 'application/octet-stream' })
      : blob;
    form.append('file', asFile, file.name);
  } else {
    // @ts-ignore RN FormData
    form.append('file', { uri: file.uri, name: file.name, type: file.type });
  }

  const res = await fetch(`${API}${endpoint}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form as any,
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const txt = await res.text();
      try { const j = JSON.parse(txt); msg = j.detail || j.message || txt; } catch { msg = txt || msg; }
    } catch {}
    throw new Error(msg);
  }
  const contentType = res.headers.get('content-type') || 'application/octet-stream';
  const dispo = res.headers.get('content-disposition') || '';
  const m = dispo.match(/filename="?([^"]+)"?/);
  const filename = m ? m[1] : 'download';
  const headers = {
    original: res.headers.get('x-original-size'),
    compressed: res.headers.get('x-compressed-size'),
    detected: res.headers.get('x-detected-format'),
    target: res.headers.get('x-target-format'),
  };
  const blob = await res.blob();
  let blobUri = '';
  let base64: string | undefined;
  if (isWeb && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    blobUri = URL.createObjectURL(blob);
  } else {
    // React Native: read blob as data URL
    const reader = new FileReader();
    base64 = await new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    blobUri = base64;
  }
  return { blobUri, base64, headers, filename, contentType };
}
