import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput, ActivityIndicator, Image, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { useAudioRecorder, RecordingPresets, AudioModule } from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import { theme } from '@/src/theme';
import { api } from '@/src/api';

type Step = 'review' | 'otp' | 'voice' | 'sign' | 'confirm' | 'unlocked';

export default function ReceiveFlow() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [doc, setDoc] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<Step>('review');
  const [readPct, setReadPct] = useState(0);
  const [otpInput, setOtpInput] = useState('');
  const [otpDemo, setOtpDemo] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // Voice
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const [audioUri, setAudioUri] = useState<string | null>(null);

  // Signature
  const [paths, setPaths] = useState<string[]>([]);
  const currentPath = useRef<string>('');

  useEffect(() => {
    api.getDocument(id!).then((d: any) => setDoc(d)).catch((e) => setErr(e.message)).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    (async () => {
      if (Platform.OS !== 'web') {
        await AudioModule.requestRecordingPermissionsAsync().catch(() => {});
      }
    })();
  }, []);

  const sendOtp = async () => {
    setErr(''); setBusy(true);
    try {
      const r: any = await api.sendOtp(id!);
      setOtpDemo(r.otp_demo || null);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const verifyOtp = async () => {
    setErr(''); setBusy(true);
    try {
      await api.verifyOtp(id!, otpInput);
      setStep(doc?.security_config?.voice_oath ? 'voice' : 'sign');
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const startRec = async () => {
    setErr('');
    try {
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
    } catch (e: any) { setErr('Mic permission required: ' + e.message); }
  };

  const stopRec = async () => {
    try {
      await recorder.stop();
      setRecording(false);
      const uri = recorder.uri;
      if (uri) {
        setAudioUri(uri);
        setRecorded(true);
      }
    } catch (e: any) { setErr(e.message); }
  };

  const submitVoice = async () => {
    setErr(''); setBusy(true);
    try {
      let base64 = '';
      if (audioUri) {
        try {
          base64 = await FileSystem.readAsStringAsync(audioUri, { encoding: 'base64' as any });
        } catch {
          base64 = audioUri; // fallback on web
        }
      }
      await api.voiceOath(id!, base64.slice(0, 400000));
      setStep('sign');
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const onTouchStart = (e: any) => {
    const { locationX, locationY } = e.nativeEvent;
    currentPath.current = `M${locationX.toFixed(1)},${locationY.toFixed(1)}`;
  };
  const onTouchMove = (e: any) => {
    const { locationX, locationY } = e.nativeEvent;
    currentPath.current += ` L${locationX.toFixed(1)},${locationY.toFixed(1)}`;
    setPaths((p) => [...p.slice(0, -1), currentPath.current]);
  };
  const onTouchEnd = () => {
    setPaths((p) => {
      const last = p[p.length - 1];
      if (last && last === currentPath.current) return p;
      return [...p, currentPath.current];
    });
    currentPath.current = '';
  };

  const submitSignature = async () => {
    if (paths.length === 0) { setErr('Please draw your signature'); return; }
    setErr(''); setBusy(true);
    try {
      const sigData = JSON.stringify({ paths, ts: new Date().toISOString() });
      await api.readProgress(id!, Math.max(100, readPct));
      await api.sign(id!, sigData);
      setStep('confirm');
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  if (loading || !doc) {
    return <SafeAreaView style={s.container}><ActivityIndicator style={{ marginTop: 80 }} color={theme.colors.brand} /></SafeAreaView>;
  }

  const sec = doc.security_config || {};
  const startVerify = () => setStep(sec.otp_verification ? 'otp' : sec.voice_oath ? 'voice' : 'sign');

  return (
    <SafeAreaView style={s.container} edges={['top']} testID="receive-flow-screen">
      <View style={s.header}>
        <Pressable testID="back-button" onPress={() => router.back()} style={s.closeBtn}>
          <Ionicons name="close" size={22} color={theme.colors.brand} />
        </Pressable>
        <Text style={s.eyebrow}>SECURE ACCESS • {step.toUpperCase()}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 80 }} keyboardShouldPersistTaps="handled" onScroll={(e) => {
        const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
        const pct = Math.min(100, Math.round(((contentOffset.y + layoutMeasurement.height) / contentSize.height) * 100));
        if (pct > readPct) {
          setReadPct(pct);
          if (pct % 25 === 0) api.readProgress(id!, pct).catch(() => {});
        }
      }} scrollEventThrottle={200}>

        {step === 'review' && (
          <>
            <Text style={s.title}>{doc.title}</Text>
            <Text style={s.meta}>From {doc.sender_name} ({doc.sender_email})</Text>
            <Text style={s.meta}>Category: {doc.category}</Text>

            <View style={s.notice}>
              <Ionicons name="lock-closed" size={16} color={theme.colors.brandSecondary} />
              <Text style={s.noticeText}>This document is protected. Complete verification to access protected content.</Text>
            </View>

            <Text style={s.sectionLabel}>AGREEMENT</Text>
            <View style={s.docBox}>
              <Text style={s.docBody}>{doc.content}</Text>
            </View>
            <Text style={s.readMeta}>Reading progress: {readPct}%</Text>

            <Pressable testID="start-verify-btn" style={s.primaryBtn} onPress={startVerify}>
              <Ionicons name="shield-checkmark" size={16} color={theme.colors.onBrandPrimary} />
              <Text style={s.primaryBtnText}>I've read this — Begin Verification</Text>
            </Pressable>
          </>
        )}

        {step === 'otp' && (
          <View testID="otp-step">
            <Text style={s.title}>Identity Verification</Text>
            <Text style={s.subtitle}>We've issued a one-time code. Enter it below to confirm your identity.</Text>
            <Pressable testID="send-otp-btn" style={s.secondaryBtn} onPress={sendOtp} disabled={busy}>
              {busy ? <ActivityIndicator color={theme.colors.brand} /> : <Text style={s.secondaryBtnText}>{otpDemo ? 'Resend code' : 'Send code'}</Text>}
            </Pressable>
            {otpDemo && <Text style={s.demoBox} testID="otp-demo">Demo OTP: <Text style={{ fontFamily: 'Courier', color: theme.colors.brand }}>{otpDemo}</Text></Text>}
            <Text style={s.label}>Enter OTP</Text>
            <TextInput
              testID="otp-input"
              style={s.input}
              value={otpInput}
              onChangeText={setOtpInput}
              keyboardType="number-pad"
              maxLength={6}
              placeholder="------"
              placeholderTextColor={theme.colors.muted}
            />
            {err ? <Text style={s.err}>{err}</Text> : null}
            <Pressable testID="verify-otp-btn" style={[s.primaryBtn, (otpInput.length < 6 || busy) && { opacity: 0.6 }]} onPress={verifyOtp} disabled={otpInput.length < 6 || busy}>
              {busy ? <ActivityIndicator color={theme.colors.onBrandPrimary} /> : <Text style={s.primaryBtnText}>Verify</Text>}
            </Pressable>
          </View>
        )}

        {step === 'voice' && (
          <View testID="voice-step">
            <Text style={s.title}>Voice Oath</Text>
            <Text style={s.subtitle}>Please record the following statement:</Text>
            <View style={s.oathBox}>
              <Text style={s.oathText}>"I acknowledge this information is confidential and agree not to disclose it."</Text>
            </View>
            <View style={s.recCenter}>
              <Pressable testID={recording ? 'stop-rec-btn' : 'start-rec-btn'} style={[s.recBtn, recording && s.recBtnActive]} onPress={recording ? stopRec : startRec}>
                <Ionicons name={recording ? 'stop' : 'mic'} size={32} color={'#fff'} />
              </Pressable>
              <Text style={s.recHint}>{recording ? 'Recording… Tap to stop' : recorded ? 'Recorded ✓ (Tap to redo)' : 'Tap to record'}</Text>
            </View>
            {err ? <Text style={s.err}>{err}</Text> : null}
            <Pressable testID="submit-voice-btn" style={[s.primaryBtn, (!recorded || busy) && { opacity: 0.6 }]} disabled={!recorded || busy} onPress={submitVoice}>
              {busy ? <ActivityIndicator color={theme.colors.onBrandPrimary} /> : <Text style={s.primaryBtnText}>Submit Voice Oath</Text>}
            </Pressable>
          </View>
        )}

        {step === 'sign' && (
          <View testID="sign-step">
            <Text style={s.title}>Digital Signature</Text>
            <Text style={s.subtitle}>Sign below to legally bind your acceptance.</Text>
            <View
              style={s.sigPad}
              onStartShouldSetResponder={() => true}
              onMoveShouldSetResponder={() => true}
              onResponderGrant={onTouchStart}
              onResponderMove={onTouchMove}
              onResponderRelease={onTouchEnd}
              onResponderTerminate={onTouchEnd}
              testID="signature-pad"
            >
              <Svg width="100%" height="100%">
                {paths.map((p, i) => (
                  <Path key={i} d={p} stroke={theme.colors.brand} strokeWidth={2.5} fill="none" />
                ))}
              </Svg>
              {paths.length === 0 && <Text style={s.sigHint}>Sign here</Text>}
            </View>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
              <Pressable testID="clear-sig-btn" style={s.clearBtn} onPress={() => setPaths([])}>
                <Text style={s.clearBtnText}>Clear</Text>
              </Pressable>
            </View>
            {err ? <Text style={s.err}>{err}</Text> : null}
            <Pressable testID="submit-sig-btn" style={[s.primaryBtn, busy && { opacity: 0.6 }]} onPress={submitSignature} disabled={busy}>
              {busy ? <ActivityIndicator color={theme.colors.onBrandPrimary} /> : <Text style={s.primaryBtnText}>Sign & Confirm</Text>}
            </Pressable>
          </View>
        )}

        {step === 'confirm' && (
          <View style={s.confirmContainer} testID="confirm-step">
            <View style={s.successCircle}>
              <Ionicons name="checkmark" size={48} color={'#fff'} />
            </View>
            <Text style={s.title}>Signed Successfully</Text>
            <Text style={s.subtitle}>Your signature, voice oath, and OTP verification are now sealed in the Evidence Vault.</Text>
            <Pressable testID="view-unlocked-btn" style={s.primaryBtn} onPress={() => setStep('unlocked')}>
              <Text style={s.primaryBtnText}>Unlock Protected Content</Text>
              <Ionicons name="arrow-forward" size={16} color={theme.colors.onBrandPrimary} />
            </Pressable>
          </View>
        )}

        {step === 'unlocked' && (
          <View testID="unlocked-step">
            <View style={s.unlockedBadge}>
              <Ionicons name="lock-open" size={14} color={theme.colors.success} />
              <Text style={s.unlockedText}>UNLOCKED</Text>
            </View>
            <Text style={s.title}>Protected Content</Text>
            <Text style={s.meta}>Watermark: {doc.recipient_email}</Text>
            <View style={s.docBox}>
              <Text style={s.docBody}>{doc.content}</Text>
              {(doc.attached_files || []).map((f: any, i: number) => (
                <Text key={i} style={s.attachLine}>• {f.name}</Text>
              ))}
            </View>
            <Pressable testID="back-home-btn" style={s.primaryBtn} onPress={() => router.replace('/(tabs)')}>
              <Text style={s.primaryBtnText}>Back to Home</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
  closeBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border },
  eyebrow: { color: theme.colors.muted, fontSize: 11, letterSpacing: 1 },
  title: { fontSize: 26, color: theme.colors.brand, fontWeight: '500', letterSpacing: -0.5, lineHeight: 32 },
  subtitle: { color: theme.colors.muted, marginTop: 8, lineHeight: 20 },
  meta: { color: theme.colors.muted, fontSize: 13, marginTop: 4 },
  notice: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: '#FBE6DC', borderRadius: 12, padding: 12, marginTop: 16 },
  noticeText: { flex: 1, color: theme.colors.brandSecondary, fontSize: 12, lineHeight: 16 },
  sectionLabel: { color: theme.colors.muted, fontSize: 11, letterSpacing: 1, marginTop: 28, marginBottom: 10 },
  docBox: { backgroundColor: '#fff', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: theme.colors.border },
  docBody: { color: theme.colors.onSurfaceSecondary, lineHeight: 20, fontSize: 13 },
  readMeta: { color: theme.colors.muted, fontSize: 11, marginTop: 8, textAlign: 'right' },
  primaryBtn: { flexDirection: 'row', gap: 8, marginTop: 20, backgroundColor: theme.colors.brand, padding: 16, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: theme.colors.onBrandPrimary, fontWeight: '500', fontSize: 15 },
  secondaryBtn: { flexDirection: 'row', gap: 8, marginTop: 16, borderWidth: 1, borderColor: theme.colors.borderStrong, padding: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  secondaryBtnText: { color: theme.colors.brand, fontWeight: '500' },
  demoBox: { color: theme.colors.muted, marginTop: 10, fontSize: 12 },
  label: { color: theme.colors.muted, fontSize: 11, letterSpacing: 1, marginTop: 20, marginBottom: 8 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, padding: 14, fontSize: 22, color: theme.colors.brand, letterSpacing: 6, textAlign: 'center' },
  err: { color: theme.colors.error, marginTop: 12 },
  oathBox: { backgroundColor: '#FFF8EF', borderLeftWidth: 3, borderLeftColor: theme.colors.warning, borderRadius: 10, padding: 14, marginTop: 16 },
  oathText: { color: theme.colors.brand, fontSize: 15, lineHeight: 22, fontStyle: 'italic' },
  recCenter: { alignItems: 'center', marginTop: 32 },
  recBtn: { width: 84, height: 84, borderRadius: 42, backgroundColor: theme.colors.brand, alignItems: 'center', justifyContent: 'center' },
  recBtnActive: { backgroundColor: theme.colors.error },
  recHint: { color: theme.colors.muted, marginTop: 12, fontSize: 13 },
  sigPad: { height: 200, backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.borderStrong, borderRadius: 12, marginTop: 16, overflow: 'hidden' },
  sigHint: { position: 'absolute', top: 90, alignSelf: 'center', color: theme.colors.muted, fontSize: 13 },
  clearBtn: { borderWidth: 1, borderColor: theme.colors.borderStrong, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: '#fff' },
  clearBtnText: { color: theme.colors.brand, fontSize: 12, fontWeight: '500' },
  confirmContainer: { alignItems: 'center', marginTop: 32 },
  successCircle: { width: 88, height: 88, borderRadius: 44, backgroundColor: theme.colors.success, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  unlockedBadge: { flexDirection: 'row', alignSelf: 'flex-start', alignItems: 'center', gap: 6, backgroundColor: '#DCEBE2', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, marginBottom: 12 },
  unlockedText: { color: theme.colors.success, fontSize: 10, fontWeight: '500', letterSpacing: 0.5 },
  attachLine: { color: theme.colors.brand, marginTop: 8, fontSize: 13 },
});
