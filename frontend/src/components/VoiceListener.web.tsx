import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';

export type OathResult = { audioBase64: string; transcript: string; matchedWords: boolean[] };

// Utility: normalize + tokenize the same way backend does
function tokens(s: string): string[] {
  return (s || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);
}
function similar(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  let same = 0;
  const min = Math.min(a.length, b.length);
  for (let i = 0; i < min; i++) if (a[i] === b[i]) same++;
  return same / Math.max(a.length, b.length) >= 0.75;
}
function computeMatched(oath: string[], said: string[]): boolean[] {
  const flags: boolean[] = [];
  let cursor = 0;
  for (const w of oath) {
    const wn = w.toLowerCase();
    let hit = -1;
    for (let i = cursor; i < said.length; i++) {
      if (said[i] === wn || similar(said[i], wn)) { hit = i; break; }
    }
    if (hit >= 0) { flags.push(true); cursor = hit + 1; } else flags.push(false);
  }
  return flags;
}

export default function VoiceListener({
  oathWords,
  attemptsLeft,
  disabled,
  onResult,
  onLiveWords,
}: {
  oathWords: string[];
  attemptsLeft: number;
  disabled?: boolean;
  onResult: (r: OathResult) => void;
  onLiveWords?: (matched: boolean[], transcript: string) => void;
}) {
  const [listening, setListening] = useState(false);
  const [audioB64, setAudioB64] = useState<string | null>(null);
  const [transcript, setTranscript] = useState('');
  const [level, setLevel] = useState(0); // 0..1
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const mediaRef = useRef<any>(null); // MediaRecorder
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const acRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const recogRef = useRef<any>(null);
  const finalTextRef = useRef<string>('');

  // Waveform bars — 5 pulses of different phases
  const bars = useRef([0, 1, 2, 3, 4].map(() => new Animated.Value(0.3))).current;

  const stopEverything = () => {
    try { recogRef.current?.stop(); } catch {}
    recogRef.current = null;
    try { mediaRef.current?.stop(); } catch {}
    mediaRef.current = null;
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    try { acRef.current?.close(); } catch {}
    acRef.current = null;
    analyserRef.current = null;
  };

  useEffect(() => () => stopEverything(), []);

  // Animate bars based on `level`
  useEffect(() => {
    bars.forEach((v, i) => {
      const target = 0.2 + Math.min(1, level * (0.7 + i * 0.1)) * 0.9;
      Animated.timing(v, { toValue: target, duration: 90, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
    });
  }, [level, bars]);

  const start = async () => {
    setErr(''); setTranscript(''); finalTextRef.current = ''; chunksRef.current = [];
    onLiveWords?.(oathWords.map(() => false), '');

    // 1) getUserMedia
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e: any) {
      setErr('Microphone permission required. Please allow access in your browser.');
      return;
    }
    streamRef.current = stream;

    // 2) Live audio level via AudioContext
    try {
      // @ts-ignore
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      const ac = new AC();
      const src = ac.createMediaStreamSource(stream);
      const an = ac.createAnalyser();
      an.fftSize = 256;
      src.connect(an);
      acRef.current = ac;
      analyserRef.current = an;
      const data = new Uint8Array(an.frequencyBinCount);
      const tick = () => {
        an.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const avg = sum / data.length / 255; // 0..1
        setLevel(avg);
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {}

    // 3) MediaRecorder for the audio we'll upload
    try {
      const mr = new (window as any).MediaRecorder(stream, { mimeType: 'audio/webm' });
      mr.ondataavailable = (e: any) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
      mr.start(200);
      mediaRef.current = mr;
    } catch {}

    // 4) Web Speech API for real-time transcript + word highlighting
    // @ts-ignore
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      setErr('Live word-highlighting is not supported in this browser. Please use Chrome, Edge or Safari — or ask the sender to disable voice oath.');
      // Continue anyway with just audio recording so user can still submit
    } else {
      const r = new SR();
      r.lang = 'en-US';
      r.interimResults = true;
      r.continuous = true;
      r.maxAlternatives = 1;
      r.onresult = (e: any) => {
        let interim = '';
        let final = finalTextRef.current;
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) final += ' ' + t;
          else interim += ' ' + t;
        }
        finalTextRef.current = final;
        const combined = (final + ' ' + interim).trim();
        setTranscript(combined);
        const said = tokens(combined);
        const flags = computeMatched(oathWords, said);
        onLiveWords?.(flags, combined);
        if (flags.every(Boolean)) {
          // All words matched — auto-stop
          setTimeout(() => stop(true), 220);
        }
      };
      r.onerror = (e: any) => {
        if (e?.error === 'no-speech' || e?.error === 'aborted') return;
        setErr('Speech recognition: ' + e?.error);
      };
      try { r.start(); recogRef.current = r; } catch {}
    }

    setListening(true);
  };

  const stop = async (autoAllMatched?: boolean) => {
    if (!listening) return;
    setListening(false);
    setBusy(true);
    // Stop recorder, then collect blob → base64
    let audioB64Local = '';
    try {
      const mr = mediaRef.current;
      if (mr && mr.state !== 'inactive') {
        await new Promise<void>((resolve) => {
          mr.onstop = async () => {
            try {
              const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
              const buf = await blob.arrayBuffer();
              // Convert to base64
              let bin = '';
              const bytes = new Uint8Array(buf);
              const CHUNK = 32768;
              for (let i = 0; i < bytes.length; i += CHUNK) {
                bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)) as any);
              }
              audioB64Local = btoa(bin);
            } catch {}
            resolve();
          };
          try { mr.stop(); } catch { resolve(); }
        });
      }
    } catch {}
    // Compute final match on whatever transcript we captured
    const finalTranscript = (finalTextRef.current + ' ' + transcript).trim() || transcript;
    const said = tokens(finalTranscript);
    const flags = computeMatched(oathWords, said);
    setAudioB64(audioB64Local);
    stopEverything();
    setBusy(false);
    onResult({ audioBase64: audioB64Local, transcript: finalTranscript, matchedWords: flags });
  };

  return (
    <View style={s.wrap}>
      {/* Waveform bars */}
      <View style={s.pulseArea}>
        <View style={s.barsRow}>
          {bars.map((v, i) => (
            <Animated.View
              key={i}
              style={[
                s.bar,
                {
                  height: v.interpolate({ inputRange: [0, 1], outputRange: [8, 90] }),
                  backgroundColor: listening ? theme.colors.brand : theme.colors.borderStrong,
                  opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }),
                },
              ]}
            />
          ))}
        </View>
        <Pressable
          testID={listening ? 'stop-rec-btn' : 'start-rec-btn'}
          style={[s.micBtn, listening && s.micBtnActive, (disabled || busy) && { opacity: 0.5 }]}
          onPress={listening ? () => stop() : start}
          disabled={disabled || busy}
        >
          {busy && !listening ? <ActivityIndicator color={'#fff'} /> : (
            <Ionicons name={listening ? 'stop' : 'mic'} size={26} color={'#fff'} />
          )}
        </Pressable>
        <Text style={s.hint}>
          {disabled ? 'Verification locked' :
            listening ? 'Listening… speak the words above clearly' :
            busy ? 'Analyzing…' :
            'Tap to start · Attempts left: ' + attemptsLeft + '/5'}
        </Text>
      </View>

      {!!transcript && (
        <View style={s.transcriptBox}>
          <Text style={s.transcriptLabel}>You said:</Text>
          <Text style={s.transcriptText}>&ldquo;{transcript}&rdquo;</Text>
        </View>
      )}
      {!!err && <Text style={s.err}>{err}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginTop: 20, alignItems: 'stretch' },
  pulseArea: { alignItems: 'center', marginTop: 8 },
  barsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 100, marginBottom: 24 },
  bar: { width: 12, borderRadius: 6 },
  micBtn: { width: 92, height: 92, borderRadius: 46, backgroundColor: theme.colors.brand, alignItems: 'center', justifyContent: 'center' },
  micBtnActive: { backgroundColor: theme.colors.brandSecondary },
  hint: { color: theme.colors.muted, fontSize: 12, marginTop: 14, textAlign: 'center', paddingHorizontal: 20 },
  transcriptBox: { backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, padding: 14, marginTop: 24 },
  transcriptLabel: { color: theme.colors.muted, fontSize: 11, letterSpacing: 0.8 },
  transcriptText: { color: theme.colors.brand, fontSize: 14, marginTop: 4, fontStyle: 'italic', lineHeight: 20 },
  err: { color: theme.colors.error, marginTop: 12, fontSize: 12, textAlign: 'center' },
});
