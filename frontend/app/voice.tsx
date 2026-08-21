import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Image, Animated, Easing, Linking, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useAudioRecorder, useAudioRecorderState, RecordingPresets, AudioModule, createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { API_BASE as API, getToken } from '@/src/api';

const RAINBOW = ['#ff3b30', '#ff9500', '#ffd60a', '#34c759', '#007aff', '#5856d6', '#af52de'] as const;
type VState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'denied' | 'error';

const STATUS: Record<VState, string> = {
  idle: 'Tap the orb and start talking',
  listening: 'Listening… speak now',
  thinking: 'Thinking…',
  speaking: 'Speaking — tap to interrupt',
  denied: 'Microphone permission needed',
  error: 'Something went wrong — tap to retry',
};

/** Bachein Voice Agent — two-way voice conversation. Renders as a screen or as an overlay (onClose provided). */
export default function VoiceScreen({ onClose }: { onClose?: () => void }) {
  const router = useRouter();
  const close = () => { stopPlayback(); try { const r: any = recorder.stop(); r?.catch?.(() => {}); } catch {} if (onClose) { onClose(); } else { router.back(); } };
  const { width, height } = useWindowDimensions();
  const { conv } = useLocalSearchParams<{ conv?: string }>();
  const [vstate, setVstate] = useState<VState>('idle');
  const vstateRef = useRef<VState>('idle');
  const setState = (s: VState) => { vstateRef.current = s; setVstate(s); };
  const [caption, setCaption] = useState('');
  const [reply, setReply] = useState('');
  const [canAskAgain, setCanAskAgain] = useState(true);
  const convId = useRef<string | null>(typeof conv === 'string' ? conv : null);
  const playerRef = useRef<any>(null);
  const spokeRef = useRef(false);
  const lastLoudRef = useRef(0);
  const turnStartRef = useRef(0);

  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const recState = useAudioRecorderState(recorder, 150);

  // ── animations ──
  const glow = useRef(new Animated.Value(0)).current;      // rainbow border cycle
  const pulse = useRef(new Animated.Value(0)).current;     // orb pulse
  const ring1 = useRef(new Animated.Value(0)).current;     // resonating rings
  const ring2 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(Animated.timing(glow, { toValue: 1, duration: 6000, easing: Easing.linear, useNativeDriver: false })).start();
    Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ])).start();
    const ringLoop = (v: Animated.Value, delay: number) =>
      Animated.loop(Animated.sequence([
        Animated.delay(delay),
        Animated.timing(v, { toValue: 1, duration: 1800, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]));
    ringLoop(ring1, 0).start();
    ringLoop(ring2, 900).start();
  }, [glow, pulse, ring1, ring2]);

  const borderColor = glow.interpolate({
    inputRange: RAINBOW.map((_, i) => i / (RAINBOW.length - 1)),
    outputRange: [...RAINBOW],
  });

  const stopPlayback = useCallback(() => {
    try { playerRef.current?.pause(); playerRef.current?.remove(); } catch {}
    playerRef.current = null;
  }, []);

  const playB64 = useCallback((b64: string, onDone?: () => void) => {
    stopPlayback();
    try {
      const p = createAudioPlayer({ uri: `data:audio/mpeg;base64,${b64}` });
      playerRef.current = p;
      p.addListener('playbackStatusUpdate', (st: any) => {
        if (st.didJustFinish) { onDone?.(); }
      });
      p.play();
    } catch { onDone?.(); }
  }, [stopPlayback]);

  // greeting on mount
  useEffect(() => {
    (async () => {
      try {
        await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true } as any);
      } catch {}
      try {
        const token = await getToken();
        const r = await fetch(`${API}/aiw/voice/say`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ text: 'Your voice agent is coming soon. You can already talk to me — tap the orb and ask me anything about your documents.' }),
        });
        const j = await r.json();
        if (j.audio_base64) playB64(j.audio_base64);
      } catch {}
    })();
    return () => { stopPlayback(); try { const r: any = recorder.stop(); r?.catch?.(() => {}); } catch {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startListening = useCallback(async () => {
    stopPlayback();
    const perm = await AudioModule.requestRecordingPermissionsAsync();
    if (!perm.granted) {
      setCanAskAgain(perm.canAskAgain !== false);
      setState('denied');
      return;
    }
    try {
      spokeRef.current = false;
      lastLoudRef.current = Date.now();
      turnStartRef.current = Date.now();
      await recorder.prepareToRecordAsync();
      recorder.record();
      setState('listening');
      setCaption('');
      setReply('');
    } catch {
      setState('error');
    }
  }, [recorder, stopPlayback]);

  const endTurn = useCallback(async () => {
    if (vstateRef.current !== 'listening') return;
    setState('thinking');
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) throw new Error('no audio');
      const token = await getToken();
      const form = new FormData();
      if (typeof document !== 'undefined') {
        const blob = await (await fetch(uri)).blob();
        form.append('audio', new File([blob], 'turn.m4a', { type: blob.type || 'audio/m4a' }));
      } else {
        // @ts-ignore RN FormData
        form.append('audio', { uri, name: 'turn.m4a', type: 'audio/m4a' });
      }
      if (convId.current) form.append('conversation_id', convId.current);
      const r = await fetch(`${API}/aiw/voice/converse`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form as any,
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.detail || 'Voice failed');
      convId.current = j.conversation_id || convId.current;
      setCaption(j.transcript || '');
      setReply(j.reply || '');
      if (j.audio_base64) {
        setState('speaking');
        playB64(j.audio_base64, () => { if (vstateRef.current === 'speaking') setState('idle'); });
      } else {
        setState('idle');
      }
    } catch {
      setState('error');
    }
  }, [recorder, playB64]);

  // automatic turn detection via metering (speak → 1.4s silence → send)
  useEffect(() => {
    if (vstate !== 'listening') return;
    const m = (recState as any)?.metering;
    const now = Date.now();
    if (typeof m === 'number') {
      if (m > -38) { spokeRef.current = true; lastLoudRef.current = now; }
      if (spokeRef.current && now - lastLoudRef.current > 1400) { endTurn(); return; }
    }
    if (now - turnStartRef.current > 20000) endTurn(); // hard cap 20s
  }, [recState, vstate, endTurn]);

  const onOrb = () => {
    const s = vstateRef.current;
    if (s === 'listening') { endTurn(); return; }         // manual stop
    if (s === 'speaking') { stopPlayback(); startListening(); return; } // interrupt
    if (s === 'thinking') return;
    if (s === 'denied' && !canAskAgain) { Linking.openSettings(); return; }
    startListening();
  };

  const ringStyle = (v: Animated.Value) => ({
    transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 2.1] }) }],
    opacity: v.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.5, 0] }),
  });
  const active = vstate === 'listening' || vstate === 'speaking';

  return (
    <View style={[s.container, onClose && { backgroundColor: "transparent" }]} testID="voice-screen">
      {onClose && <BlurView intensity={50} tint="dark" style={StyleSheet.absoluteFill} />}
      {onClose && <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(5,6,10,0.55)" }]} />}
      {/* Rainbow Gemini-style glow around the screen edges */}
      <Animated.View pointerEvents="none" style={[s.glowBorder, { width, height, borderColor }]} />
      <LinearGradient colors={['rgba(88,86,214,0.35)', 'transparent']} style={s.topGlow} pointerEvents="none" />
      <LinearGradient colors={['transparent', 'rgba(175,82,222,0.35)']} style={s.bottomGlow} pointerEvents="none" />

      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View style={s.header}>
          <Pressable onPress={close} style={s.closeBtn} testID="voice-back">
            <Ionicons name="chevron-down" size={22} color="#fff" />
          </Pressable>
          <Text style={s.headTitle}>Bachein Voice</Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={s.center}>
          {/* resonating rings */}
          <View style={s.orbWrap}>
            <Animated.View style={[s.ring, ringStyle(ring1), !active && { opacity: 0 }]} />
            <Animated.View style={[s.ring, ringStyle(ring2), !active && { opacity: 0 }]} />
            <Animated.View style={{ transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, active ? 1.09 : 1.04] }) }] }}>
              <Pressable onPress={onOrb} testID="voice-orb">
                <Animated.View style={[s.orbGlow, { shadowColor: borderColor as any }]}>
                  <Image source={require('../assets/images/voice-orb.png')} style={s.orbImg} />
                </Animated.View>
              </Pressable>
            </Animated.View>
          </View>

          <Text style={s.status} testID="voice-status">{STATUS[vstate]}</Text>
          {vstate === 'denied' && (
            <Pressable style={s.permBtn} onPress={() => (canAskAgain ? startListening() : Linking.openSettings())} testID="voice-perm">
              <Ionicons name="mic-outline" size={15} color="#fff" />
              <Text style={s.permText}>{canAskAgain ? 'Allow microphone' : 'Open Settings'}</Text>
            </Pressable>
          )}

          {!!caption && (
            <View style={s.captionBox}>
              <Text style={s.captionLabel}>YOU</Text>
              <Text style={s.captionText}>{caption}</Text>
            </View>
          )}
          {!!reply && (
            <View style={[s.captionBox, { borderColor: 'rgba(88,86,214,0.5)' }]}>
              <Text style={[s.captionLabel, { color: '#8e8cf0' }]}>BACHEIN</Text>
              <Text style={s.captionText} numberOfLines={6}>{reply}</Text>
            </View>
          )}
        </View>

        <Text style={s.disclaimer}>AI can make mistake, please check important info.</Text>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#05060a' },
  glowBorder: { position: 'absolute', top: 0, left: 0, borderWidth: 4, borderRadius: 26, shadowOpacity: 0.9, shadowRadius: 18, shadowOffset: { width: 0, height: 0 } },
  topGlow: { position: 'absolute', top: 0, left: 0, right: 0, height: 130 },
  bottomGlow: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 130 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10 },
  closeBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  headTitle: { flex: 1, textAlign: 'center', color: '#fff', fontSize: 15, fontWeight: '600' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 26, gap: 18 },
  orbWrap: { width: 260, height: 260, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: 180, height: 180, borderRadius: 90, borderWidth: 2, borderColor: '#5e8bff' },
  orbGlow: { shadowOpacity: 0.9, shadowRadius: 30, shadowOffset: { width: 0, height: 0 }, elevation: 20, borderRadius: 90 },
  orbImg: { width: 180, height: 180, borderRadius: 90 },
  status: { color: 'rgba(255,255,255,0.85)', fontSize: 15, fontWeight: '500', textAlign: 'center' },
  permBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#5856d6', borderRadius: 999, paddingHorizontal: 18, paddingVertical: 11 },
  permText: { color: '#fff', fontWeight: '600', fontSize: 13.5 },
  captionBox: { alignSelf: 'stretch', backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', borderRadius: 16, padding: 14 },
  captionLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 10, letterSpacing: 1.4, marginBottom: 4 },
  captionText: { color: '#fff', fontSize: 13.5, lineHeight: 20 },
  disclaimer: { color: 'rgba(255,255,255,0.4)', fontSize: 10.5, textAlign: 'center', paddingBottom: 12 },
});
