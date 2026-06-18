import AsyncStorage from '@react-native-async-storage/async-storage';

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || '';
const API = `${BASE}/api`;

const TOKEN_KEY = 'bachein_token';
const USER_KEY = 'bachein_user';

export async function setToken(token: string) {
  await AsyncStorage.setItem(TOKEN_KEY, token);
}
export async function getToken(): Promise<string | null> {
  return AsyncStorage.getItem(TOKEN_KEY);
}
export async function setUser(user: any) {
  await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
}
export async function getUser(): Promise<any | null> {
  const raw = await AsyncStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}
export async function clearAuth() {
  await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY]);
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
    const msg = data?.detail || data?.message || `Request failed (${res.status})`;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  return data as T;
}

export const api = {
  signup: (email: string, password: string, name: string) =>
    request('/auth/signup', { method: 'POST', body: JSON.stringify({ email, password, name }) }),
  login: (email: string, password: string) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  me: () => request('/auth/me'),
  categories: () => request('/categories'),
  generate: (body: { prompt: string; category: string; sub_type?: string }) =>
    request('/ai/generate', { method: 'POST', body: JSON.stringify(body) }),
  review: (document_text: string) =>
    request('/ai/review', { method: 'POST', body: JSON.stringify({ document_text }) }),
  createDocument: (body: any) =>
    request('/documents', { method: 'POST', body: JSON.stringify(body) }),
  listSent: () => request('/documents/sent'),
  listReceived: () => request('/documents/received'),
  getDocument: (id: string) => request(`/documents/${id}`),
  sendOtp: (id: string) => request(`/documents/${id}/send-otp`, { method: 'POST' }),
  verifyOtp: (document_id: string, otp: string) =>
    request('/documents/verify-otp', { method: 'POST', body: JSON.stringify({ document_id, otp }) }),
  voiceOath: (document_id: string, audio_base64: string) =>
    request('/documents/voice-oath', { method: 'POST', body: JSON.stringify({ document_id, audio_base64 }) }),
  readProgress: (document_id: string, progress: number) =>
    request('/documents/read-progress', { method: 'POST', body: JSON.stringify({ document_id, progress }) }),
  sign: (document_id: string, signature_base64: string) =>
    request('/documents/sign', { method: 'POST', body: JSON.stringify({ document_id, signature_base64 }) }),
  status: (id: string) => request(`/documents/${id}/status`),
  vault: () => request('/vault'),
};
