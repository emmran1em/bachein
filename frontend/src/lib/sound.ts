import { Platform } from 'react-native';

let cachedTone: HTMLAudioElement | null = null;

/** Small web-native ping tone (base64 wav). No file needed. */
const TONE_DATA_URL = 'data:audio/wav;base64,UklGRoQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YWAAAAAA/wAA/wAA/wAA/wAA/wAA/wAA/wAA/wAA/wAA/wAA/wAA/wAA/wAA/wAA/wAA/wAA/wAA/wAA/wAA/wAA/wAA/wAA/wAA/wAA/wAA/wAA/wAA/wAA/wAA/wAA';

export function playSent() {
  try {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && 'AudioContext' in window) {
      const AC = (window.AudioContext || (window as any).webkitAudioContext);
      const ctx = new AC();
      const now = ctx.currentTime;
      // Two-note "sent" tone
      [880, 1320].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, now + i * 0.11);
        g.gain.exponentialRampToValueAtTime(0.22, now + i * 0.11 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.11 + 0.18);
        osc.connect(g).connect(ctx.destination);
        osc.start(now + i * 0.11);
        osc.stop(now + i * 0.11 + 0.2);
      });
      setTimeout(() => ctx.close().catch(() => {}), 500);
      return;
    }
  } catch {}
  // Native: best-effort no-op (expo-audio playSoundAsync could be added later)
}
