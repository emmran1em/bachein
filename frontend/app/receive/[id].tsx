import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput, ActivityIndicator, Platform, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { useAudioRecorder, RecordingPresets, AudioModule } from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { theme } from '@/src/theme';
import { api } from '@/src/api';

type Step = 'review' | 'otp' | 'face' | 'voice' | 'sign' | 'confirm' | 'unlocked';

export default function ReceiveFlow() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [doc, setDoc] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<Step>('review');
  const [readPct, setReadPct] = useState(0);
  const [otpInput, setOtpInput] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // Camera
  const cameraRef = useRef<CameraView | null>(null);
  const [camPerm, requestCamPerm] = useCameraPermissions();
  const [selfie, setSelfie] = useState<string | null>(null);

  // Voice
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const [audioUri, setAudioUri] = useState<string | null>(null);

  // Signature
  const [paths, setPaths] = useState<string[]>([]);
  const currentPath = useRef<string>('');
  const [typedSig, setTypedSig] = useState('');
  const [sigMode, setSigMode] = useState<'draw' | 'type' | 'upload'>('draw');
  const [uploadedSig, setUploadedSig] = useState<string | null>(null);

  const pickSignatureImage = async () => {
    setErr('');
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { setErr('Photo library permission needed'); return; }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        base64: true,
        quality: 0.8,
      });
      if (res.canceled) return;
      const a = res.assets[0];
      if (a.base64) setUploadedSig('data:image/jpeg;base64,' + a.base64);
    } catch (e: any) { setErr(e.message); }
  };

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

  const nextAfterReview = () => {
    const sec = doc?.security_config || {};
    if (sec.otp_verification) setStep('otp');
    else if (sec.face_verification) setStep('face');
    else if (sec.voice_oath) setStep('voice');
    else setStep('sign');
  };
  const nextAfterOtp = () => {
    const sec = doc?.security_config || {};
    if (sec.face_verification) setStep('face');
    else if (sec.voice_oath) setStep('voice');
    else setStep('sign');
  };
  const nextAfterFace = () => {
    const sec = doc?.security_config || {};
    if (sec.voice_oath) setStep('voice');
    else setStep('sign');
  };

  const sendOtp = async () => {
    setErr(''); setBusy(true);
    try {
      await api.sendOtp(id!);
      setOtpSent(true);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const verifyOtp = async () => {
    setErr(''); setBusy(true);
    try {
      await api.verifyOtp(id!, otpInput);
      nextAfterOtp();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const captureSelfie = async () => {
    try {
      if (!camPerm?.granted) {
        const p = await requestCamPerm();
        if (!p.granted) { setErr('Camera permission required'); return; }
      }
      const photo = await cameraRef.current?.takePictureAsync({ quality: 0.4, base64: true });
      if (photo?.base64) {
        setSelfie('data:image/jpg;base64,' + photo.base64);
      }
    } catch (e: any) { setErr(e.message); }
  };

  const submitFace = async () => {
    if (!selfie) { setErr('Capture a selfie first'); return; }
    setErr(''); setBusy(true);
    try {
      await api.faceVerify(id!, selfie.replace(/^data:image\/[a-z]+;base64,/, ''));
      nextAfterFace();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const startRec = async () => {
    setErr('');
    try { await recorder.prepareToRecordAsync(); recorder.record(); setRecording(true); }
    catch (e: any) { setErr('Mic permission required: ' + e.message); }
  };
  const stopRec = async () => {
    try {
      await recorder.stop();
      setRecording(false);
      const uri = recorder.uri;
      if (uri) { setAudioUri(uri); setRecorded(true); }
    } catch (e: any) { setErr(e.message); }
  };

  const submitVoice = async () => {
    setErr(''); setBusy(true);
    try {
      let base64 = '';
      if (audioUri) {
        try { base64 = await FileSystem.readAsStringAsync(audioUri, { encoding: 'base64' as any }); }
        catch { base64 = audioUri; }
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
    if (sigMode === 'draw' && paths.length === 0) { setErr('Please draw your signature'); return; }
    if (sigMode === 'type' && !typedSig.trim()) { setErr('Please type your signature'); return; }
    if (sigMode === 'upload' && !uploadedSig) { setErr('Please attach a signature image'); return; }
    setErr(''); setBusy(true);
    try {
      const sigData = JSON.stringify({
        mode: sigMode,
        paths: sigMode === 'draw' ? paths : null,
        text: sigMode === 'type' ? typedSig : null,
        image_b64: sigMode === 'upload' ? uploadedSig : null,
        ts: new Date().toISOString(),
      });
      await api.readProgress(id!, Math.max(100, readPct));
      await api.sign(id!, sigData);
      setStep('confirm');
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  if (loading || !doc) {
    return <SafeAreaView style={s.container}><ActivityIndicator style={{ marginTop: 80 }} color={theme.colors.brand} /></SafeAreaView>;
  }

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
            {(doc.attached_files || []).length > 0 && (
              <>
                <Text style={s.sectionLabel}>ATTACHED FILES</Text>
                {doc.attached_files.map((f: any, i: number) => (
                  <View key={i} style={s.attachRow}>
                    <Ionicons name="document-attach" size={16} color={theme.colors.brand} />
                    <Text style={s.attachName}>{f.name}</Text>
                    {(f.ai_flags || []).map((flag: string, j: number) => (
                      <View key={j} style={s.flagPill}><Text style={s.flagText}>{flag}</Text></View>
                    ))}
                  </View>
                ))}
              </>
            )}
            <Text style={s.readMeta}>Reading progress: {readPct}%</Text>
            <Pressable testID="start-verify-btn" style={s.primaryBtn} onPress={nextAfterReview}>
              <Ionicons name="shield-checkmark" size={16} color={theme.colors.onBrandPrimary} />
              <Text style={s.primaryBtnText}>I've read this — Begin Verification</Text>
            </Pressable>
          </>
        )}

        {step === 'otp' && (
          <View testID="otp-step">
            <Text style={s.title}>Identity Verification</Text>
            <Text style={s.subtitle}>An OTP has been sent to your email. Enter it below.</Text>
            <Pressable testID="send-otp-btn" style={s.secondaryBtn} onPress={sendOtp} disabled={busy}>
              {busy ? <ActivityIndicator color={theme.colors.brand} /> : <Text style={s.secondaryBtnText}>{otpSent ? 'Resend code' : 'Send code to my email'}</Text>}
            </Pressable>
            {otpSent && <Text style={s.demoBox} testID="otp-demo">✓ Email sent. Check your inbox.</Text>}
            <Text style={s.label}>Enter OTP</Text>
            <TextInput testID="otp-input" style={s.input} value={otpInput} onChangeText={setOtpInput} keyboardType="number-pad" maxLength={6} placeholder="------" placeholderTextColor={theme.colors.muted} />
            {err ? <Text style={s.err}>{err}</Text> : null}
            <Pressable testID="verify-otp-btn" style={[s.primaryBtn, (otpInput.length < 6 || busy) && { opacity: 0.6 }]} onPress={verifyOtp} disabled={otpInput.length < 6 || busy}>
              {busy ? <ActivityIndicator color={theme.colors.onBrandPrimary} /> : <Text style={s.primaryBtnText}>Verify</Text>}
            </Pressable>
          </View>
        )}

        {step === 'face' && (
          <View testID="face-step">
            <Text style={s.title}>Face Verification</Text>
            <Text style={s.subtitle}>Capture a selfie to confirm your identity.</Text>
            <View style={s.cameraBox}>
              {!selfie && camPerm?.granted && (
                <CameraView
                  ref={(r) => { cameraRef.current = r; }}
                  style={{ flex: 1 }}
                  facing="front"
                />
              )}
              {selfie && <Image source={{ uri: selfie }} style={{ flex: 1, borderRadius: 12 }} />}
              {!camPerm?.granted && (
                <View style={s.camPerm}>
                  <Ionicons name="camera-outline" size={32} color={theme.colors.muted} />
                  <Text style={s.permText}>Camera permission needed</Text>
                  <Pressable style={s.secondaryBtn} onPress={() => requestCamPerm()}>
                    <Text style={s.secondaryBtnText}>Grant access</Text>
                  </Pressable>
                </View>
              )}
            </View>
            {err ? <Text style={s.err}>{err}</Text> : null}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              {!selfie ? (
                <Pressable testID="capture-selfie-btn" style={[s.primaryBtn, { flex: 1, marginTop: 0 }]} onPress={captureSelfie} disabled={!camPerm?.granted}>
                  <Ionicons name="camera" size={16} color={theme.colors.onBrandPrimary} />
                  <Text style={s.primaryBtnText}>Capture</Text>
                </Pressable>
              ) : (
                <>
                  <Pressable testID="retake-btn" style={[s.secondaryBtn, { flex: 1, marginTop: 0 }]} onPress={() => setSelfie(null)}>
                    <Text style={s.secondaryBtnText}>Retake</Text>
                  </Pressable>
                  <Pressable testID="submit-face-btn" style={[s.primaryBtn, { flex: 1, marginTop: 0 }, busy && { opacity: 0.6 }]} onPress={submitFace} disabled={busy}>
                    {busy ? <ActivityIndicator color={theme.colors.onBrandPrimary} /> : <Text style={s.primaryBtnText}>Submit</Text>}
                  </Pressable>
                </>
              )}
            </View>
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
            <View style={s.sigModeRow}>
              <Pressable testID="sig-mode-draw" style={[s.sigModeBtn, sigMode === 'draw' && s.sigModeActive]} onPress={() => setSigMode('draw')}>
                <Text style={[s.sigModeText, sigMode === 'draw' && s.sigModeTextActive]}>Draw</Text>
              </Pressable>
              <Pressable testID="sig-mode-type" style={[s.sigModeBtn, sigMode === 'type' && s.sigModeActive]} onPress={() => setSigMode('type')}>
                <Text style={[s.sigModeText, sigMode === 'type' && s.sigModeTextActive]}>Type</Text>
              </Pressable>
              <Pressable testID="sig-mode-upload" style={[s.sigModeBtn, sigMode === 'upload' && s.sigModeActive]} onPress={() => setSigMode('upload')}>
                <Text style={[s.sigModeText, sigMode === 'upload' && s.sigModeTextActive]}>Attach</Text>
              </Pressable>
            </View>
            {sigMode === 'draw' ? (
              <>
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
              </>
            ) : sigMode === 'type' ? (
              <TextInput testID="typed-signature-input" style={s.typedSig} value={typedSig} onChangeText={setTypedSig} placeholder="Type your full name" placeholderTextColor={theme.colors.muted} />
            ) : (
              <View style={{ marginTop: 12 }}>
                {uploadedSig ? (
                  <View style={s.sigPreview}>
                    <Image source={{ uri: uploadedSig }} style={{ flex: 1, resizeMode: 'contain' }} />
                  </View>
                ) : (
                  <Pressable testID="pick-sig-btn" onPress={pickSignatureImage} style={s.sigUploadZone}>
                    <Ionicons name="images-outline" size={28} color={theme.colors.brand} />
                    <Text style={s.sigUploadText}>Attach signature from your photos</Text>
                    <Text style={s.sigUploadSub}>JPG or PNG · transparent background works best</Text>
                  </Pressable>
                )}
                {uploadedSig && (
                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                    <Pressable testID="clear-sig-upload" style={s.clearBtn} onPress={() => setUploadedSig(null)}>
                      <Text style={s.clearBtnText}>Replace</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            )}
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
            <Text style={s.subtitle}>Your signature and verifications are now sealed in the Evidence Vault. The sender has been notified.</Text>
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
  attachRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, marginBottom: 8, flexWrap: 'wrap' },
  attachName: { flex: 1, color: theme.colors.brand, fontSize: 13 },
  flagPill: { backgroundColor: '#FFF8EF', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  flagText: { color: theme.colors.warning, fontSize: 10, fontWeight: '500' },
  readMeta: { color: theme.colors.muted, fontSize: 11, marginTop: 8, textAlign: 'right' },
  primaryBtn: { flexDirection: 'row', gap: 8, marginTop: 20, backgroundColor: theme.colors.brand, padding: 16, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: theme.colors.onBrandPrimary, fontWeight: '500', fontSize: 15 },
  secondaryBtn: { flexDirection: 'row', gap: 8, marginTop: 16, borderWidth: 1, borderColor: theme.colors.borderStrong, padding: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  secondaryBtnText: { color: theme.colors.brand, fontWeight: '500' },
  demoBox: { color: theme.colors.success, marginTop: 10, fontSize: 12 },
  label: { color: theme.colors.muted, fontSize: 11, letterSpacing: 1, marginTop: 20, marginBottom: 8 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, padding: 14, fontSize: 22, color: theme.colors.brand, letterSpacing: 6, textAlign: 'center' },
  err: { color: theme.colors.error, marginTop: 12 },
  oathBox: { backgroundColor: '#FFF8EF', borderLeftWidth: 3, borderLeftColor: theme.colors.warning, borderRadius: 10, padding: 14, marginTop: 16 },
  oathText: { color: theme.colors.brand, fontSize: 15, lineHeight: 22, fontStyle: 'italic' },
  recCenter: { alignItems: 'center', marginTop: 32 },
  recBtn: { width: 84, height: 84, borderRadius: 42, backgroundColor: theme.colors.brand, alignItems: 'center', justifyContent: 'center' },
  recBtnActive: { backgroundColor: theme.colors.error },
  recHint: { color: theme.colors.muted, marginTop: 12, fontSize: 13 },
  cameraBox: { height: 320, backgroundColor: '#000', borderRadius: 14, marginTop: 16, overflow: 'hidden' },
  camPerm: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surfaceSecondary, gap: 8 },
  permText: { color: theme.colors.muted },
  sigModeRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  sigModeBtn: { flex: 1, paddingVertical: 10, borderRadius: 999, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', backgroundColor: '#fff' },
  sigModeActive: { backgroundColor: theme.colors.brand, borderColor: theme.colors.brand },
  sigModeText: { color: theme.colors.brand, fontSize: 13, fontWeight: '500' },
  sigModeTextActive: { color: theme.colors.onBrandPrimary },
  sigPad: { height: 200, backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.borderStrong, borderRadius: 12, marginTop: 12, overflow: 'hidden' },
  sigHint: { position: 'absolute', top: 90, alignSelf: 'center', color: theme.colors.muted, fontSize: 13 },
  typedSig: { backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, padding: 18, fontSize: 28, color: theme.colors.brand, marginTop: 12, fontStyle: 'italic', textAlign: 'center' },
  clearBtn: { borderWidth: 1, borderColor: theme.colors.borderStrong, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: '#fff' },
  clearBtnText: { color: theme.colors.brand, fontSize: 12, fontWeight: '500' },
  confirmContainer: { alignItems: 'center', marginTop: 32 },
  successCircle: { width: 88, height: 88, borderRadius: 44, backgroundColor: theme.colors.success, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  unlockedBadge: { flexDirection: 'row', alignSelf: 'flex-start', alignItems: 'center', gap: 6, backgroundColor: '#DCEBE2', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, marginBottom: 12 },
  unlockedText: { color: theme.colors.success, fontSize: 10, fontWeight: '500', letterSpacing: 0.5 },
  attachLine: { color: theme.colors.brand, marginTop: 8, fontSize: 13 },
  sigPreview: { height: 160, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, marginTop: 12, overflow: 'hidden', padding: 10 },
  sigUploadZone: { height: 160, backgroundColor: '#fff', borderRadius: 12, borderWidth: 2, borderColor: theme.colors.border, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 12 },
  sigUploadText: { color: theme.colors.brand, fontWeight: '500' },
  sigUploadSub: { color: theme.colors.muted, fontSize: 11 },
});
