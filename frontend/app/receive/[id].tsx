import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput, ActivityIndicator, Platform, Image, Animated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAudioRecorder, RecordingPresets, AudioModule } from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { theme } from '@/src/theme';
import { api } from '@/src/api';
import SignatureBottomSheet, { SignatureView, SignatureData } from '@/src/components/SignatureBottomSheet';

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
  const [camReady, setCamReady] = useState(false);

  // Voice
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);
  const [oathWords, setOathWords] = useState<string[]>([]);
  const [matchedWords, setMatchedWords] = useState<boolean[]>([]);
  const [saidWords, setSaidWords] = useState<string[]>([]);
  const [transcript, setTranscript] = useState('');
  const [attemptsLeft, setAttemptsLeft] = useState(5);
  const [attemptMsg, setAttemptMsg] = useState('');
  const pulse = useRef(new Animated.Value(0)).current;

  // Signature
  const [sigOpen, setSigOpen] = useState(false);
  const [receiverSig, setReceiverSig] = useState<SignatureData | null>(null);

  useEffect(() => {
    api.getDocument(id!).then((d: any) => setDoc(d)).catch((e) => setErr(e.message)).finally(() => setLoading(false));
    api.voiceOathText().then((r: any) => setOathWords(r?.words || []));
  }, [id]);

  useEffect(() => {
    (async () => {
      if (Platform.OS !== 'web') {
        await AudioModule.requestRecordingPermissionsAsync().catch(() => {});
      }
    })();
  }, []);

  // Pulse animation while recording
  useEffect(() => {
    if (recording) {
      const loop = Animated.loop(Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: false }),
        Animated.timing(pulse, { toValue: 0, duration: 700, useNativeDriver: false }),
      ]));
      loop.start();
      return () => loop.stop();
    } else {
      pulse.setValue(0);
    }
  }, [recording, pulse]);

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
      setErr('');
      if (!camPerm?.granted) {
        const p = await requestCamPerm();
        if (!p.granted) { setErr('Camera permission required'); return; }
      }
      if (!camReady) { setErr('Camera warming up… please wait a second and try again.'); return; }
      // Give the sensor a beat before capture
      await new Promise(r => setTimeout(r, 300));
      const photo = await cameraRef.current?.takePictureAsync({
        quality: 0.6,
        base64: true,
        skipProcessing: false,
        exif: false,
      });
      if (photo?.base64 && photo.base64.length > 500) {
        setSelfie('data:image/jpg;base64,' + photo.base64);
      } else {
        setErr('Could not capture image. Please ensure good lighting and try again.');
      }
    } catch (e: any) { setErr(e.message || 'Capture failed'); }
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
    setErr(''); setAttemptMsg(''); setMatchedWords([]); setTranscript(''); setSaidWords([]);
    try { await recorder.prepareToRecordAsync(); recorder.record(); setRecording(true); }
    catch (e: any) { setErr('Mic permission required: ' + e.message); }
  };
  const stopRec = async () => {
    try {
      await recorder.stop();
      setRecording(false);
      const uri = recorder.uri;
      if (uri) {
        setBusy(true);
        let base64 = '';
        try { base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' as any }); }
        catch { base64 = uri; }
        const r: any = await api.voiceOath(id!, base64.slice(0, 400000));
        setTranscript(r?.transcript || '');
        setMatchedWords(r?.matched_words || []);
        setSaidWords(r?.said_words || []);
        setAttemptsLeft(r?.attempts_left ?? 5);
        if (r?.completed) {
          setAttemptMsg('Voice oath verified ✓');
          setTimeout(() => setStep('sign'), 900);
        } else {
          setAttemptMsg(r?.message || 'Some words did not match — please read every word clearly.');
        }
      }
    } catch (e: any) {
      const msg = String(e.message || e);
      setErr(msg);
      if (msg.toLowerCase().includes('maximum')) setAttemptsLeft(0);
    } finally { setBusy(false); }
  };

  const submitSignature = async (sig: SignatureData) => {
    setReceiverSig(sig);
    setSigOpen(false);
    setErr(''); setBusy(true);
    try {
      const sigData = JSON.stringify(sig);
      await api.readProgress(id!, Math.max(100, readPct));
      await api.sign(id!, sigData);
      // Reload doc to get sender_signature + receiver_signature fresh
      try { const fresh: any = await api.getDocument(id!); setDoc(fresh); } catch {}
      setStep('confirm');
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  if (loading || !doc) {
    return <SafeAreaView style={s.container}><ActivityIndicator style={{ marginTop: 80 }} color={theme.colors.brand} /></SafeAreaView>;
  }

  const senderSig: SignatureData | null = doc.sender_signature ? (() => { try { return JSON.parse(doc.sender_signature); } catch { return null; } })() : null;

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

              {/* Signature block always visible so receiver sees sender's signature */}
              <View style={s.sigBlock}>
                <Text style={s.sigHeading}>SIGNATURES:</Text>
                <View style={{ marginTop: 8 }}>
                  <Text style={s.sigLabel}>Disclosing Party Signature:</Text>
                  {senderSig ? <SignatureView data={senderSig} /> : <View style={s.emptyLine} />}
                  <Text style={s.printedName}>Printed Name: {doc.sender_name}</Text>
                  <Text style={s.printedName}>Date: {doc.sender_signed_at ? new Date(doc.sender_signed_at).toLocaleDateString() : new Date(doc.created_at).toLocaleDateString()}</Text>
                </View>
                <View style={{ marginTop: 14 }}>
                  <Text style={s.sigLabel}>Receiving Party Signature:</Text>
                  <View style={s.emptyLine} />
                  <Text style={[s.printedName, { color: theme.colors.muted }]}>To be signed by you after verification</Text>
                </View>
              </View>
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
              <Text style={s.primaryBtnText}>I&apos;ve read this — Begin Verification</Text>
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
            <Text style={s.subtitle}>Look at the camera in a well-lit room. Make sure your whole face is inside the frame.</Text>
            <View style={s.cameraBox}>
              {!selfie && camPerm?.granted && (
                <CameraView
                  ref={(r) => { cameraRef.current = r; }}
                  style={{ flex: 1 }}
                  facing="front"
                  onCameraReady={() => setCamReady(true)}
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
              {!selfie && camPerm?.granted && !camReady && (
                <View style={s.camLoad}><ActivityIndicator color={'#fff'} /><Text style={{ color: '#fff', marginTop: 8 }}>Warming up camera…</Text></View>
              )}
            </View>
            {err ? <Text style={s.err}>{err}</Text> : null}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              {!selfie ? (
                <Pressable testID="capture-selfie-btn" style={[s.primaryBtn, { flex: 1, marginTop: 0 }, !camReady && { opacity: 0.6 }]} onPress={captureSelfie} disabled={!camPerm?.granted || !camReady}>
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
            <Text style={s.subtitle}>Read every word aloud clearly. Attempts remaining: {attemptsLeft}/5</Text>

            <View style={s.wordsWrap}>
              {oathWords.map((w, i) => {
                const state = matchedWords[i];
                const isMatched = state === true;
                const isMissed = state === false;
                return (
                  <View key={i} style={[s.wordChip, isMatched && s.wordChipOk, isMissed && s.wordChipMiss]}>
                    <Text style={[s.wordText, isMatched && s.wordTextOk, isMissed && s.wordTextMiss]}>{w}</Text>
                  </View>
                );
              })}
            </View>

            <View style={s.listenCenter}>
              <View style={s.listenWrap}>
                <Animated.View style={[s.pulseRing, { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0, 0.35] }), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.55] }) }] }]} />
                <Animated.View style={[s.pulseRing, s.pulseInner, { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0, 0.5] }), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] }) }] }]} />
                <Pressable testID={recording ? 'stop-rec-btn' : 'start-rec-btn'} style={[s.listenBtn, recording && s.listenBtnActive]} onPress={recording ? stopRec : startRec} disabled={busy || attemptsLeft <= 0}>
                  {busy && !recording ? <ActivityIndicator color={'#fff'} /> : (
                    <Ionicons name={recording ? 'stop' : 'mic'} size={30} color={'#fff'} />
                  )}
                </Pressable>
              </View>
              <Text style={s.listenHint}>
                {attemptsLeft <= 0 ? 'No attempts left — contact sender' :
                  recording ? 'Listening… tap to stop' :
                  busy ? 'Analyzing your voice…' :
                  matchedWords.length > 0 ? 'Try again — hold the mic and read every word clearly' :
                  'Tap the mic and read the words above'}
              </Text>
            </View>

            {!!transcript && (
              <View style={s.transcriptBox}>
                <Text style={s.transcriptLabel}>You said:</Text>
                <Text style={s.transcriptText}>&ldquo;{transcript}&rdquo;</Text>
                {!!attemptMsg && <Text style={[s.transcriptLabel, { marginTop: 8, color: theme.colors.warning }]}>{attemptMsg}</Text>}
              </View>
            )}
            {err ? <Text style={s.err}>{err}</Text> : null}
          </View>
        )}

        {step === 'sign' && (
          <View testID="sign-step">
            <Text style={s.title}>Sign as Receiving Party</Text>
            <Text style={s.subtitle}>Review your placement below, then apply your signature.</Text>

            <View style={s.docBox}>
              <Text style={s.docBody}>{doc.content}</Text>
              <View style={s.sigBlock}>
                <Text style={s.sigHeading}>SIGNATURES:</Text>
                <View style={{ marginTop: 8 }}>
                  <Text style={s.sigLabel}>Disclosing Party Signature:</Text>
                  {senderSig ? <SignatureView data={senderSig} /> : <View style={s.emptyLine} />}
                  <Text style={s.printedName}>Printed Name: {doc.sender_name}</Text>
                </View>
                <View style={{ marginTop: 14 }}>
                  <Text style={s.sigLabel}>Receiving Party Signature:</Text>
                  {receiverSig ? <SignatureView data={receiverSig} /> : (
                    <Pressable testID="inline-sign-btn" onPress={() => setSigOpen(true)} style={s.signCta}>
                      <Ionicons name="create-outline" size={16} color={theme.colors.brand} />
                      <Text style={s.signCtaText}>Tap to sign</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            </View>

            {err ? <Text style={s.err}>{err}</Text> : null}
            {busy && <ActivityIndicator style={{ marginTop: 12 }} color={theme.colors.brand} />}
          </View>
        )}

        {step === 'confirm' && (
          <View style={s.confirmContainer} testID="confirm-step">
            <View style={s.successCircle}>
              <Ionicons name="checkmark" size={48} color={'#fff'} />
            </View>
            <Text style={s.title}>Signed Successfully</Text>
            <Text style={s.subtitle}>Your signature is embedded in the document. The sender has been notified.</Text>
            <Pressable testID="view-unlocked-btn" style={s.primaryBtn} onPress={() => setStep('unlocked')}>
              <Text style={s.primaryBtnText}>View Signed Document</Text>
              <Ionicons name="arrow-forward" size={16} color={theme.colors.onBrandPrimary} />
            </Pressable>
          </View>
        )}

        {step === 'unlocked' && (
          <View testID="unlocked-step">
            <View style={s.unlockedBadge}>
              <Ionicons name="lock-open" size={14} color={theme.colors.success} />
              <Text style={s.unlockedText}>UNLOCKED &amp; SIGNED</Text>
            </View>
            <Text style={s.title}>{doc.title}</Text>
            <Text style={s.meta}>Watermark: {doc.recipient_email}</Text>
            <View style={s.docBox}>
              <Text style={s.docBody}>{doc.content}</Text>
              <View style={s.sigBlock}>
                <Text style={s.sigHeading}>SIGNATURES:</Text>
                <View style={{ marginTop: 8 }}>
                  <Text style={s.sigLabel}>Disclosing Party Signature:</Text>
                  {senderSig ? <SignatureView data={senderSig} /> : <View style={s.emptyLine} />}
                  <Text style={s.printedName}>Printed Name: {doc.sender_name}</Text>
                </View>
                <View style={{ marginTop: 14 }}>
                  <Text style={s.sigLabel}>Receiving Party Signature:</Text>
                  {receiverSig ? <SignatureView data={receiverSig} /> : <View style={s.emptyLine} />}
                  <Text style={s.printedName}>Printed Name: {doc.recipient_email}</Text>
                </View>
              </View>
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

      <SignatureBottomSheet
        visible={sigOpen}
        title="Sign as Receiving Party"
        role="Your signature will be embedded in the NDA."
        busy={busy}
        onClose={() => setSigOpen(false)}
        onDone={submitSignature}
      />
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
  docBox: { backgroundColor: '#fff', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: theme.colors.border, marginTop: 10 },
  docBody: { color: theme.colors.onSurfaceSecondary, lineHeight: 20, fontSize: 13 },
  sigBlock: { marginTop: 24, paddingTop: 18, borderTopWidth: 1, borderTopColor: theme.colors.divider },
  sigHeading: { color: theme.colors.brand, fontWeight: '500', fontSize: 13, letterSpacing: 0.5 },
  sigLabel: { color: theme.colors.onSurfaceSecondary, fontSize: 13, marginBottom: 6 },
  emptyLine: { height: 42, borderBottomWidth: 1, borderBottomColor: theme.colors.borderStrong, marginBottom: 6 },
  printedName: { color: theme.colors.onSurfaceSecondary, fontSize: 12, marginTop: 4 },
  signCta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 46, borderRadius: 10, backgroundColor: '#FFF8EF', borderWidth: 1, borderColor: '#F2DCB6' },
  signCtaText: { color: theme.colors.brand, fontWeight: '500' },
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
  // Voice UI
  wordsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 20, backgroundColor: '#fff', padding: 14, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border },
  wordChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: '#F5F1E9', borderWidth: 1, borderColor: theme.colors.border },
  wordChipOk: { backgroundColor: '#DCEBE2', borderColor: '#B4D7C1' },
  wordChipMiss: { backgroundColor: '#FBE6DC', borderColor: '#EEB89E' },
  wordText: { color: theme.colors.onSurfaceSecondary, fontSize: 15 },
  wordTextOk: { color: theme.colors.success, fontWeight: '500' },
  wordTextMiss: { color: theme.colors.error, fontWeight: '500' },
  listenCenter: { alignItems: 'center', marginTop: 32 },
  listenWrap: { width: 130, height: 130, alignItems: 'center', justifyContent: 'center' },
  pulseRing: { position: 'absolute', width: 100, height: 100, borderRadius: 50, backgroundColor: theme.colors.brandSecondary },
  pulseInner: { width: 90, height: 90, borderRadius: 45 },
  listenBtn: { width: 88, height: 88, borderRadius: 44, backgroundColor: theme.colors.brand, alignItems: 'center', justifyContent: 'center' },
  listenBtnActive: { backgroundColor: theme.colors.brandSecondary },
  listenHint: { color: theme.colors.muted, marginTop: 14, fontSize: 13, textAlign: 'center', paddingHorizontal: 24 },
  transcriptBox: { backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, padding: 14, marginTop: 20 },
  transcriptLabel: { color: theme.colors.muted, fontSize: 11, letterSpacing: 0.8 },
  transcriptText: { color: theme.colors.brand, fontSize: 14, marginTop: 4, fontStyle: 'italic', lineHeight: 20 },
  cameraBox: { height: 320, backgroundColor: '#000', borderRadius: 14, marginTop: 16, overflow: 'hidden' },
  camPerm: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surfaceSecondary, gap: 8 },
  camLoad: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)' },
  permText: { color: theme.colors.muted },
  confirmContainer: { alignItems: 'center', marginTop: 32 },
  successCircle: { width: 88, height: 88, borderRadius: 44, backgroundColor: theme.colors.success, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  unlockedBadge: { flexDirection: 'row', alignSelf: 'flex-start', alignItems: 'center', gap: 6, backgroundColor: '#DCEBE2', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, marginBottom: 12 },
  unlockedText: { color: theme.colors.success, fontSize: 10, fontWeight: '500', letterSpacing: 0.5 },
  attachLine: { color: theme.colors.brand, marginTop: 8, fontSize: 13 },
});
