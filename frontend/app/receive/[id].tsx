import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput, ActivityIndicator, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { api } from '@/src/api';
import SignatureBottomSheet, { SignatureView, SignatureData } from '@/src/components/SignatureBottomSheet';
import CameraCapture from '@/src/components/CameraCapture';
import VoiceListener from '@/src/components/VoiceListener';

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

  // Voice
  const [oathWords, setOathWords] = useState<string[]>([]);
  const [liveMatched, setLiveMatched] = useState<boolean[]>([]);
  const [attemptsLeft, setAttemptsLeft] = useState(5);
  const [attemptMsg, setAttemptMsg] = useState('');
  const [savedTranscript, setSavedTranscript] = useState('');

  // Signature
  const [sigOpen, setSigOpen] = useState(false);
  const [receiverSig, setReceiverSig] = useState<SignatureData | null>(null);

  useEffect(() => {
    api.getDocument(id!).then((d: any) => setDoc(d)).catch((e) => setErr(e.message)).finally(() => setLoading(false));
    api.voiceOathText().then((r: any) => setOathWords(r?.words || []));
  }, [id]);

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
    try { await api.sendOtp(id!); setOtpSent(true); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const verifyOtp = async () => {
    setErr(''); setBusy(true);
    try { await api.verifyOtp(id!, otpInput); nextAfterOtp(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const handleFaceCapture = async ({ base64 }: { base64: string }) => {
    setErr(''); setBusy(true);
    try { await api.faceVerify(id!, base64); nextAfterFace(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const handleVoiceResult = async (r: { audioBase64: string; transcript: string; matchedWords: boolean[] }) => {
    setErr(''); setAttemptMsg(''); setBusy(true);
    try {
      const resp: any = await api.voiceOath(id!, r.audioBase64, r.transcript || undefined);
      setLiveMatched(resp?.matched_words || r.matchedWords || []);
      setSavedTranscript(resp?.transcript || r.transcript || '');
      setAttemptsLeft(resp?.attempts_left ?? attemptsLeft);
      if (resp?.completed) {
        setAttemptMsg('Voice oath verified ✓');
        setTimeout(() => setStep('sign'), 900);
      } else {
        setAttemptMsg(resp?.message || 'Some words did not match — please read every word clearly.');
      }
    } catch (e: any) {
      const msg = String(e.message || e);
      setErr(msg);
      if (msg.toLowerCase().includes('maximum')) setAttemptsLeft(0);
    } finally { setBusy(false); }
  };

  const submitSignature = async (sig: SignatureData) => {
    setReceiverSig(sig); setSigOpen(false); setErr(''); setBusy(true);
    try {
      const sigData = JSON.stringify(sig);
      await api.readProgress(id!, Math.max(100, readPct));
      await api.sign(id!, sigData);
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
            <Text style={s.meta}>Received: {new Date(doc.created_at).toLocaleDateString()}</Text>
            {/* Locked gate — the document is NOT visible until verification is complete */}
            <View style={s.lockCard} testID="locked-gate">
              <View style={s.lockIconWrap}><Ionicons name="lock-closed" size={40} color={theme.colors.brand} /></View>
              <Text style={s.lockTitle}>This {doc.category || 'document'} is locked</Text>
              <Text style={s.lockSub}>
                Complete the sender&apos;s security verification to view the document
                {(doc.attached_files || []).length > 0 ? ` and its ${doc.attached_files.length} attached file${doc.attached_files.length > 1 ? 's' : ''}` : ''}.
              </Text>
              <View style={s.lockChips}>
                {doc.security_config?.otp_verification && (
                  <View style={s.lockChip}><Ionicons name="mail-outline" size={12} color={theme.colors.brand} /><Text style={s.lockChipText}>Email OTP</Text></View>
                )}
                {doc.security_config?.face_verification && (
                  <View style={s.lockChip}><Ionicons name="person-circle-outline" size={12} color={theme.colors.brand} /><Text style={s.lockChipText}>Face check</Text></View>
                )}
                {doc.security_config?.voice_oath && (
                  <View style={s.lockChip}><Ionicons name="mic-outline" size={12} color={theme.colors.brand} /><Text style={s.lockChipText}>Voice oath</Text></View>
                )}
                <View style={s.lockChip}><Ionicons name="create-outline" size={12} color={theme.colors.brand} /><Text style={s.lockChipText}>Signature</Text></View>
              </View>
            </View>
            <Pressable testID="start-verify-btn" style={s.primaryBtn} onPress={nextAfterReview}>
              <Ionicons name="lock-open-outline" size={16} color={theme.colors.onBrandPrimary} />
              <Text style={s.primaryBtnText}>Unlock the {doc.category || 'document'}</Text>
            </Pressable>
          </>
        )}

        {step === 'otp' && (
          <View testID="otp-step">
            <Text style={s.title}>Email Verification</Text>
            <Text style={s.subtitle}>An OTP will be emailed to you.</Text>
            <Pressable testID="send-otp-btn" style={s.secondaryBtn} onPress={sendOtp} disabled={busy}>
              {busy ? <ActivityIndicator color={theme.colors.brand} /> : <Text style={s.secondaryBtnText}>{otpSent ? 'Resend code' : 'Send code to my email'}</Text>}
            </Pressable>
            {otpSent && <Text style={s.demoBox}>✓ Email sent. Check your inbox.</Text>}
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
            <Text style={s.subtitle}>Center your face inside the guide. Ensure your face is well-lit.</Text>
            <CameraCapture onCapture={handleFaceCapture} onCancel={() => router.back()} />
            {err ? <Text style={s.err}>{err}</Text> : null}
            {busy && <ActivityIndicator style={{ marginTop: 12 }} color={theme.colors.brand} />}
          </View>
        )}

        {step === 'voice' && (
          <View testID="voice-step">
            <Text style={s.title}>Voice Oath</Text>
            <Text style={s.subtitle}>Read every word aloud clearly. Words highlight as you say them.</Text>

            {/* Word pills — highlight live as user speaks */}
            <View style={s.wordsWrap}>
              {oathWords.map((w, i) => {
                const state = liveMatched[i];
                return (
                  <View key={i} style={[s.wordChip, state === true && s.wordChipOk]}>
                    <Text style={[s.wordText, state === true && s.wordTextOk]}>{w}</Text>
                  </View>
                );
              })}
            </View>

            <VoiceListener
              oathWords={oathWords}
              attemptsLeft={attemptsLeft}
              disabled={attemptsLeft <= 0}
              onLiveWords={(m, _t) => { setLiveMatched(m); }}
              onResult={handleVoiceResult}
            />

            {!!savedTranscript && !busy && !attemptMsg.includes('verified') && (
              <View style={s.transcriptBox}>
                <Text style={s.transcriptLabel}>Server heard:</Text>
                <Text style={s.transcriptText}>&ldquo;{savedTranscript}&rdquo;</Text>
              </View>
            )}
            {!!attemptMsg && <Text style={[s.hintMsg, attemptMsg.includes('verified') && { color: theme.colors.success }]}>{attemptMsg}</Text>}
            {err ? <Text style={s.err}>{err}</Text> : null}
          </View>
        )}

        {step === 'sign' && (
          <View testID="sign-step">
            <Text style={s.title}>Sign as Receiving Party</Text>
            <Text style={s.subtitle}>Review your placement, then apply your signature.</Text>
            <View style={s.docBox}>
              <Text style={s.docBody}>{doc.content}</Text>
              {(doc.attached_files || []).length > 0 && (
                <View style={{ marginTop: 16 }}>
                  <Text style={s.sigHeading}>ATTACHED MATERIALS:</Text>
                  {doc.attached_files.map((f: any, i: number) => (
                    <View key={i} style={s.attachRow}>
                      <Ionicons name="document-attach" size={16} color={theme.colors.brand} />
                      <Text style={s.attachName}>{f.name}</Text>
                    </View>
                  ))}
                </View>
              )}
              <View style={s.sigBlock}>
                <Text style={s.sigHeading}>SIGNATURES:</Text>
                <View style={{ marginTop: 8 }}>
                  <Text style={s.sigLabel}>Disclosing Party Signature:</Text>
                  {senderSig ? <SignatureView data={senderSig} /> : <View style={s.emptyLine} />}
                  <Text style={s.printedName}>Printed Name: {doc.sender_name}</Text>
                  <Text style={s.printedName}>Date: {new Date(doc.sender_signed_at || doc.created_at).toLocaleDateString()}</Text>
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
            <View style={s.successCircle}><Ionicons name="checkmark" size={48} color={'#fff'} /></View>
            <Text style={s.title}>Signed Successfully</Text>
            <Text style={s.subtitle}>The sender has been notified.</Text>
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
            <View style={s.docBox}>
              <Text style={s.docBody}>{doc.content}</Text>
              <View style={s.sigBlock}>
                <Text style={s.sigHeading}>SIGNATURES:</Text>
                <View style={{ marginTop: 8 }}>
                  <Text style={s.sigLabel}>Disclosing Party:</Text>
                  {senderSig ? <SignatureView data={senderSig} /> : <View style={s.emptyLine} />}
                  <Text style={s.printedName}>{doc.sender_name}</Text>
                </View>
                <View style={{ marginTop: 14 }}>
                  <Text style={s.sigLabel}>Receiving Party:</Text>
                  {receiverSig ? <SignatureView data={receiverSig} /> : <View style={s.emptyLine} />}
                  <Text style={s.printedName}>{doc.recipient_email}</Text>
                  {!!doc.signed_at && <Text style={s.printedName}>Date: {new Date(doc.signed_at).toLocaleDateString()}</Text>}
                </View>
              </View>
              {(doc.attached_files || []).length > 0 && (
                <View style={{ marginTop: 16 }}>
                  <Text style={s.sigHeading}>ATTACHED MATERIALS:</Text>
                  {doc.attached_files.map((f: any, i: number) => (
                    <View key={i} style={s.attachRow}>
                      <Ionicons name="document-attach" size={16} color={theme.colors.brand} />
                      <Text style={s.attachName}>{f.name}</Text>
                    </View>
                  ))}
                </View>
              )}
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
  lockCard: { alignItems: 'center', gap: 8, backgroundColor: '#fff', borderRadius: 18, borderWidth: 1, borderColor: theme.colors.border, padding: 28, marginTop: 24 },
  lockIconWrap: { width: 74, height: 74, borderRadius: 37, backgroundColor: theme.colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  lockTitle: { color: theme.colors.brand, fontSize: 17, fontWeight: '600', textAlign: 'center' },
  lockSub: { color: theme.colors.muted, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  lockChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 10 },
  lockChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: theme.colors.surfaceSecondary, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
  lockChipText: { color: theme.colors.brand, fontSize: 11.5, fontWeight: '500' },
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
  attachRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, marginBottom: 8 },
  attachName: { flex: 1, color: theme.colors.brand, fontSize: 13 },
  readMeta: { color: theme.colors.muted, fontSize: 11, marginTop: 8, textAlign: 'right' },
  primaryBtn: { flexDirection: 'row', gap: 8, marginTop: 20, backgroundColor: theme.colors.brand, padding: 16, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: theme.colors.onBrandPrimary, fontWeight: '500', fontSize: 15 },
  secondaryBtn: { flexDirection: 'row', gap: 8, marginTop: 16, borderWidth: 1, borderColor: theme.colors.borderStrong, padding: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  secondaryBtnText: { color: theme.colors.brand, fontWeight: '500' },
  demoBox: { color: theme.colors.success, marginTop: 10, fontSize: 12 },
  label: { color: theme.colors.muted, fontSize: 11, letterSpacing: 1, marginTop: 20, marginBottom: 8 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, padding: 14, fontSize: 22, color: theme.colors.brand, letterSpacing: 6, textAlign: 'center' },
  err: { color: theme.colors.error, marginTop: 12 },
  hintMsg: { color: theme.colors.warning, marginTop: 12, textAlign: 'center', fontSize: 13 },
  wordsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 20, backgroundColor: '#fff', padding: 14, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border },
  wordChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: '#F5F1E9', borderWidth: 1, borderColor: theme.colors.border },
  wordChipOk: { backgroundColor: '#DCEBE2', borderColor: '#B4D7C1' },
  wordText: { color: theme.colors.onSurfaceSecondary, fontSize: 15 },
  wordTextOk: { color: theme.colors.success, fontWeight: '500' },
  transcriptBox: { backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, padding: 14, marginTop: 20 },
  transcriptLabel: { color: theme.colors.muted, fontSize: 11, letterSpacing: 0.8 },
  transcriptText: { color: theme.colors.brand, fontSize: 14, marginTop: 4, fontStyle: 'italic', lineHeight: 20 },
  confirmContainer: { alignItems: 'center', marginTop: 32 },
  successCircle: { width: 88, height: 88, borderRadius: 44, backgroundColor: theme.colors.success, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  unlockedBadge: { flexDirection: 'row', alignSelf: 'flex-start', alignItems: 'center', gap: 6, backgroundColor: '#DCEBE2', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, marginBottom: 12 },
  unlockedText: { color: theme.colors.success, fontSize: 10, fontWeight: '500', letterSpacing: 0.5 },
});
