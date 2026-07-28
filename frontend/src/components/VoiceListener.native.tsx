import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAudioRecorder, RecordingPresets, AudioModule } from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import { theme } from '@/src/theme';

export type OathResult = { audioBase64: string; transcript: string; matchedWords: boolean[] };

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
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [level, setLevel] = useState(0);
  const tickerRef = useRef<any>(null);

  const bars = useRef([0, 1, 2, 3, 4].map(() => new Animated.Value(0.3))).current;

  useEffect(() => {
    (async () => { await AudioModule.requestRecordingPermissionsAsync().catch(() => {}); })();
    return () => { if (tickerRef.current) clearInterval(tickerRef.current); };
  }, []);

  useEffect(() => {
    bars.forEach((v, i) => {
      const target = 0.2 + Math.min(1, level * (0.6 + i * 0.12)) * 0.9;
      Animated.timing(v, { toValue: target, duration: 90, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
    });
  }, [level, bars]);

  const start = async () => {
    setErr('');
    onLiveWords?.(oathWords.map(() => false), '');
    try {
      await recorder.prepareToRecordAsync();
      recorder.record();
      setListening(true);
      // Animated pulse (native has no free real-time transcript so fake level via time-based sine)
      let t0 = Date.now();
      tickerRef.current = setInterval(() => {
        const dt = (Date.now() - t0) / 1000;
        const lvl = 0.35 + Math.abs(Math.sin(dt * 3)) * 0.55;
        setLevel(lvl);
      }, 90);
    } catch (e: any) {
      setErr('Microphone permission required: ' + (e.message || e));
    }
  };

  const stop = async () => {
    if (!listening) return;
    setListening(false); setBusy(true);
    if (tickerRef.current) { clearInterval(tickerRef.current); tickerRef.current = null; }
    setLevel(0);
    try {
      await recorder.stop();
      const uri = recorder.uri;
      let base64 = '';
      if (uri) {
        try { base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' as any }); }
        catch { base64 = ''; }
      }
      // Native STT unavailable in Expo Go — send full audio to backend (Whisper).
      onResult({ audioBase64: base64.slice(0, 400000), transcript: '', matchedWords: [] });
    } catch (e: any) { setErr(e.message || 'Recording failed'); }
    finally { setBusy(false); }
  };

  return (
    <View style={s.wrap}>
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
          onPress={listening ? stop : start}
          disabled={disabled || busy}
        >
          {busy && !listening ? <ActivityIndicator color={'#fff'} /> : (
            <Ionicons name={listening ? 'stop' : 'mic'} size={26} color={'#fff'} />
          )}
        </Pressable>
        <Text style={s.hint}>
          {disabled ? 'Verification locked' :
            listening ? 'Listening… tap when finished reading' :
            busy ? 'Analyzing your voice…' :
            'Tap to start · Attempts left: ' + attemptsLeft + '/5'}
        </Text>
      </View>
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
  err: { color: theme.colors.error, marginTop: 12, fontSize: 12, textAlign: 'center' },
});
