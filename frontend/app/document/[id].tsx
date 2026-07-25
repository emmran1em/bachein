import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl, Linking, Platform, Image, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer } from 'expo-audio';
import { theme } from '@/src/theme';
import { api, getUser, getToken } from '@/src/api';
import { SignatureView, SignatureData } from '@/src/components/SignatureBottomSheet';

function Row({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <View style={ss.row}>
      <Text style={ss.rowLabel}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {ok !== undefined && <Ionicons name={ok ? 'checkmark-circle' : 'ellipse-outline'} size={14} color={ok ? theme.colors.success : theme.colors.muted} />}
        <Text style={ss.rowValue}>{value}</Text>
      </View>
    </View>
  );
}

function AudioPlayer({ base64 }: { base64: string }) {
  const player = useAudioPlayer({ uri: base64.startsWith('data:') ? base64 : 'data:audio/m4a;base64,' + base64 });
  const [playing, setPlaying] = useState(false);
  const toggle = () => {
    if (playing) { player.pause(); setPlaying(false); }
    else { player.play(); setPlaying(true); }
  };
  useEffect(() => () => { try { player.pause(); } catch {} }, [player]);
  return (
    <Pressable onPress={toggle} style={ss.audioBtn}>
      <Ionicons name={playing ? 'pause' : 'play'} size={16} color={theme.colors.onBrandPrimary} />
      <Text style={ss.audioText}>{playing ? 'Pause voice oath' : 'Play voice oath'}</Text>
    </Pressable>
  );
}

export default function DocumentView() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [doc, setDoc] = useState<any>(null);
  const [status, setStatus] = useState<any>(null);
  const [me, setMe] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [artifacts, setArtifacts] = useState<any>(null);
  const [artLoading, setArtLoading] = useState(false);
  const [imgViewer, setImgViewer] = useState<string | null>(null);

  const load = async () => {
    try {
      const u = await getUser(); setMe(u);
      const d: any = await api.getDocument(id!);
      setDoc(d);
      const st: any = await api.status(id!);
      setStatus(st);
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  };

  useFocusEffect(useCallback(() => { load(); }, [id]));

  // Poll status every 4s while screen is focused, until signed
  useFocusEffect(useCallback(() => {
    const t = setInterval(async () => {
      try {
        const st: any = await api.status(id!);
        setStatus(st);
        if (st?.signature_status === 'signed') {
          api.getDocument(id!).then((d: any) => setDoc(d)).catch(() => {});
        }
      } catch {}
    }, 4000);
    return () => clearInterval(t);
  }, [id]));

  const loadSecurityArtifacts = async () => {
    if (artifacts) return; // cached
    setArtLoading(true);
    try {
      const r: any = await api.securityArtifacts(id!);
      setArtifacts(r);
    } catch (e) { /* ignore */ }
    finally { setArtLoading(false); }
  };

  const openSecurity = async () => {
    setSecurityOpen(true);
    await loadSecurityArtifacts();
  };

  const openPdf = async (url: string) => {
    try {
      const token = await getToken();
      const sep = url.includes('?') ? '&' : '?';
      await Linking.openURL(`${url}${sep}token=${token}`);
    } catch (e: any) { /* ignore */ }
  };

  if (loading || !doc) {
    return <SafeAreaView style={ss.container}><ActivityIndicator style={{ marginTop: 80 }} color={theme.colors.brand} /></SafeAreaView>;
  }

  const isSender = me?.id === doc.sender_id;
  const isReceiver = me?.email === doc.recipient_email;
  const showVerifyCta = isReceiver && doc.mode === 'secure' && doc.signature_status !== 'signed';

  const senderSig: SignatureData | null = doc.sender_signature ? (() => { try { return JSON.parse(doc.sender_signature); } catch { return null; } })() : null;
  const receiverSig: SignatureData | null = doc.receiver_signature ? (() => { try { return JSON.parse(doc.receiver_signature); } catch { return null; } })() : null;

  const secConfig = doc.security_config || {};
  const enabledFeatures = Object.entries(secConfig).filter(([k, v]) => k !== 'access_expiry_hours' && v);

  return (
    <SafeAreaView style={ss.container} edges={['top']} testID="document-detail-screen">
      <View style={ss.header}>
        <Pressable testID="back-button" onPress={() => router.back()} style={ss.closeBtn}>
          <Ionicons name="chevron-back" size={22} color={theme.colors.brand} />
        </Pressable>
        <Text style={ss.eyebrow}>{doc.category} • {doc.mode === 'secure' ? 'SECURE' : 'NORMAL'}</Text>

        {doc.mode === 'secure' && (
          <Pressable testID="open-security-details" onPress={openSecurity} style={ss.securityChip}>
            <Ionicons name="shield-checkmark" size={13} color={theme.colors.brand} />
            <Text style={ss.securityChipText}>Security</Text>
          </Pressable>
        )}
      </View>

      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 80 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
        <Text style={ss.title} testID="doc-title">{doc.title}</Text>
        <Text style={ss.meta}>Created {new Date(doc.created_at).toLocaleString()}</Text>
        {doc.recipient_email && <Text style={ss.meta}>To: {doc.recipient_email}</Text>}

        {showVerifyCta && (
          <Pressable testID="receiver-verify-cta" style={ss.verifyCta} onPress={() => router.push(`/receive/${doc.id}`)}>
            <Ionicons name="shield-checkmark" size={18} color={theme.colors.onBrandPrimary} />
            <Text style={ss.verifyCtaText}>Verify &amp; Sign to Unlock</Text>
          </Pressable>
        )}

        {isSender && doc.mode === 'secure' && (
          <View style={ss.statusCard} testID="status-card">
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={ss.statusTitle}>Status Tracker</Text>
              {status?.signature_status === 'signed' && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <View style={ss.liveDot} />
                  <Text style={ss.liveText}>SIGNED</Text>
                </View>
              )}
            </View>
            <View style={ss.divider} />
            <Row label="Recipient" value={doc.recipient_email || '—'} />
            <Row label="Delivered" value={status?.delivered ? 'Yes' : 'No'} ok={!!status?.delivered} />
            <Row label="Opened" value={status?.opened ? 'Yes' : 'No'} ok={!!status?.opened} />
            <Row label="OTP Verified" value={status?.otp_verified ? 'Yes' : 'Pending'} ok={!!status?.otp_verified} />
            <Row label="Face Verified" value={status?.face_verified ? 'Yes' : (doc.security_config?.face_verification ? 'Pending' : '—')} ok={!!status?.face_verified} />
            <Row label="Voice Oath" value={status?.voice_oath_completed ? `Completed (${status?.voice_attempts || 1} try)` : (doc.security_config?.voice_oath ? `Pending (${status?.voice_attempts || 0}/5)` : '—')} ok={!!status?.voice_oath_completed} />
            <Row label="Agreement Read" value={`${status?.agreement_read_pct || 0}%`} ok={(status?.agreement_read_pct || 0) >= 80} />
            <Row label="Signature" value={status?.signature_status === 'signed' ? 'Signed' : 'Pending'} ok={status?.signature_status === 'signed'} />
            <Row label="Signed At" value={status?.signed_at ? new Date(status.signed_at).toLocaleString() : '—'} />
            <Row label="Content Unlocked" value={status?.protected_unlocked ? 'Yes' : 'Locked'} ok={!!status?.protected_unlocked} />

            {status?.signature_status === 'signed' && (
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                <Pressable testID="download-signed-pdf" style={ss.downloadBtn} onPress={() => openPdf(api.signedPdfUrl(doc.id))}>
                  <Ionicons name="document-text-outline" size={14} color={theme.colors.brand} />
                  <Text style={ss.downloadText}>Signed PDF</Text>
                </Pressable>
                <Pressable testID="download-audit-pdf" style={ss.downloadBtn} onPress={() => openPdf(api.auditPdfUrl(doc.id))}>
                  <Ionicons name="receipt-outline" size={14} color={theme.colors.brand} />
                  <Text style={ss.downloadText}>Audit Report</Text>
                </Pressable>
              </View>
            )}
          </View>
        )}

        <Text style={ss.sectionLabel}>DOCUMENT</Text>
        <View style={ss.docBox}>
          <Text style={ss.docBody}>{doc.content}</Text>

          {(senderSig || receiverSig || doc.mode === 'secure') && (
            <View style={ss.sigBlock}>
              <Text style={ss.sigHeading}>SIGNATURES:</Text>
              <View style={{ marginTop: 8 }}>
                <Text style={ss.sigLabel}>Disclosing Party Signature:</Text>
                {senderSig ? <SignatureView data={senderSig} /> : <View style={ss.emptyLine} />}
                <Text style={ss.printedName}>Printed Name: {doc.sender_name}</Text>
                <Text style={ss.printedName}>Date: {doc.sender_signed_at ? new Date(doc.sender_signed_at).toLocaleDateString() : '—'}</Text>
              </View>
              <View style={{ marginTop: 14 }}>
                <Text style={ss.sigLabel}>Receiving Party Signature:</Text>
                {receiverSig ? <SignatureView data={receiverSig} /> : <View style={ss.emptyLine} />}
                <Text style={ss.printedName}>Printed Name: {doc.recipient_email || '—'}</Text>
                <Text style={ss.printedName}>Date: {doc.signed_at ? new Date(doc.signed_at).toLocaleDateString() : '—'}</Text>
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      {/* ── Security Details Modal ── */}
      <Modal visible={securityOpen} transparent animationType="slide" onRequestClose={() => setSecurityOpen(false)}>
        <View style={ss.overlay}>
          <Pressable style={ss.backdrop} onPress={() => setSecurityOpen(false)} />
          <View style={ss.sheet}>
            <View style={ss.handle} />
            <View style={ss.sheetHead}>
              <View style={{ flex: 1 }}>
                <Text style={ss.sheetTitle}>Security Details</Text>
                <Text style={ss.sheetSub}>All verifications recorded for this document</Text>
              </View>
              <Pressable onPress={() => setSecurityOpen(false)} style={ss.closeBtn2}>
                <Ionicons name="close" size={20} color={theme.colors.brand} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
              {artLoading && <ActivityIndicator color={theme.colors.brand} style={{ marginTop: 20 }} />}

              {/* Enabled features */}
              <Text style={ss.subLabel}>ENABLED SECURITY</Text>
              <View style={ss.featureWrap}>
                {enabledFeatures.map(([k]) => (
                  <View key={k} style={ss.featureChip}>
                    <Ionicons name="checkmark-circle" size={12} color={theme.colors.success} />
                    <Text style={ss.featureText}>{k.replace(/_/g, ' ')}</Text>
                  </View>
                ))}
                {enabledFeatures.length === 0 && <Text style={ss.emptyText}>No security features enabled</Text>}
              </View>

              {/* OTP */}
              <Text style={ss.subLabel}>OTP VERIFICATION</Text>
              <View style={ss.artCard}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons name={artifacts?.otp?.verified ? 'checkmark-circle' : 'ellipse-outline'} size={16} color={artifacts?.otp?.verified ? theme.colors.success : theme.colors.muted} />
                  <Text style={ss.artText}>{artifacts?.otp?.verified ? 'Recipient verified email OTP successfully.' : 'Not verified yet'}</Text>
                </View>
              </View>

              {/* Face */}
              {artifacts?.face?.image_b64 || secConfig.face_verification ? (
                <>
                  <Text style={ss.subLabel}>FACE VERIFICATION</Text>
                  <View style={ss.artCard}>
                    {artifacts?.face?.image_b64 ? (
                      <Pressable onPress={() => setImgViewer('data:image/jpg;base64,' + artifacts.face.image_b64)}>
                        <Image source={{ uri: 'data:image/jpg;base64,' + artifacts.face.image_b64 }} style={ss.faceImg} />
                        <Text style={ss.artHint}>Tap to view full</Text>
                      </Pressable>
                    ) : (
                      <Text style={ss.artText}>Waiting for recipient to complete face verification.</Text>
                    )}
                  </View>
                </>
              ) : null}

              {/* Voice */}
              {secConfig.voice_oath ? (
                <>
                  <Text style={ss.subLabel}>VOICE OATH</Text>
                  <View style={ss.artCard}>
                    {artifacts?.voice?.audio_b64 ? (
                      <>
                        <AudioPlayer base64={artifacts.voice.audio_b64} />
                        <Text style={[ss.artLabel, { marginTop: 12 }]}>Transcript:</Text>
                        <Text style={ss.artQuote}>&ldquo;{artifacts.voice.transcript}&rdquo;</Text>
                        <Text style={ss.artLabel}>Similarity: {(artifacts.voice.similarity * 100).toFixed(0)}%  ·  Attempts: {artifacts.voice.attempts}</Text>
                      </>
                    ) : (
                      <Text style={ss.artText}>Waiting for recipient to record voice oath.</Text>
                    )}
                  </View>
                </>
              ) : null}

              {/* Signatures */}
              <Text style={ss.subLabel}>SIGNATURES</Text>
              <View style={ss.artCard}>
                <Text style={ss.artLabel}>Disclosing Party</Text>
                {senderSig ? <SignatureView data={senderSig} height={54} /> : <Text style={ss.artText}>Not signed</Text>}
                <View style={{ height: 12 }} />
                <Text style={ss.artLabel}>Receiving Party</Text>
                {receiverSig ? <SignatureView data={receiverSig} height={54} /> : <Text style={ss.artText}>Not signed yet</Text>}
              </View>

              {/* Audit log */}
              {artifacts?.audit_log && artifacts.audit_log.length > 0 && (
                <>
                  <Text style={ss.subLabel}>AUDIT LOG</Text>
                  <View style={ss.artCard}>
                    {artifacts.audit_log.map((e: any, i: number) => (
                      <View key={i} style={ss.auditRow}>
                        <Text style={ss.auditEvent}>{e.event}</Text>
                        <Text style={ss.auditMeta}>{new Date(e.ts).toLocaleString()}</Text>
                      </View>
                    ))}
                  </View>
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Face image viewer */}
      <Modal visible={!!imgViewer} transparent animationType="fade" onRequestClose={() => setImgViewer(null)}>
        <Pressable style={ss.imgOverlay} onPress={() => setImgViewer(null)}>
          {imgViewer && <Image source={{ uri: imgViewer }} style={{ width: '90%', height: '80%', resizeMode: 'contain' }} />}
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const ss = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
  closeBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border },
  eyebrow: { color: theme.colors.muted, fontSize: 11, letterSpacing: 1, flex: 1 },
  securityChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  securityChipText: { color: theme.colors.brand, fontSize: 12, fontWeight: '500' },
  title: { fontSize: 24, color: theme.colors.brand, fontWeight: '500', letterSpacing: -0.5 },
  meta: { color: theme.colors.muted, fontSize: 13, marginTop: 4 },
  verifyCta: { flexDirection: 'row', alignSelf: 'flex-start', backgroundColor: theme.colors.brandSecondary, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 999, alignItems: 'center', gap: 8, marginTop: 16 },
  verifyCtaText: { color: '#fff', fontWeight: '500' },
  sectionLabel: { color: theme.colors.muted, fontSize: 11, letterSpacing: 1, marginTop: 28, marginBottom: 10 },
  docBox: { backgroundColor: '#fff', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: theme.colors.border },
  docBody: { color: theme.colors.onSurfaceSecondary, lineHeight: 20, fontSize: 13 },
  sigBlock: { marginTop: 24, paddingTop: 18, borderTopWidth: 1, borderTopColor: theme.colors.divider },
  sigHeading: { color: theme.colors.brand, fontWeight: '500', fontSize: 13, letterSpacing: 0.5 },
  sigLabel: { color: theme.colors.onSurfaceSecondary, fontSize: 13, marginBottom: 6 },
  emptyLine: { height: 42, borderBottomWidth: 1, borderBottomColor: theme.colors.borderStrong, marginBottom: 6 },
  printedName: { color: theme.colors.onSurfaceSecondary, fontSize: 12, marginTop: 4 },
  statusCard: { backgroundColor: '#fff', borderRadius: 16, padding: 18, borderWidth: 1, borderColor: theme.colors.border, marginTop: 16 },
  statusTitle: { color: theme.colors.brand, fontWeight: '500', fontSize: 15 },
  divider: { height: 1, backgroundColor: theme.colors.divider, marginVertical: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  rowLabel: { color: theme.colors.muted, fontSize: 13 },
  rowValue: { color: theme.colors.brand, fontSize: 13, fontWeight: '500' },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.success },
  liveText: { color: theme.colors.success, fontSize: 10, fontWeight: '500', letterSpacing: 0.5 },
  downloadBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: theme.colors.borderStrong, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: '#fff' },
  downloadText: { color: theme.colors.brand, fontSize: 12, fontWeight: '500' },
  // Modal
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  sheet: { backgroundColor: theme.colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '90%' },
  handle: { alignSelf: 'center', width: 42, height: 4, borderRadius: 2, backgroundColor: theme.colors.borderStrong, marginTop: 8 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  sheetTitle: { color: theme.colors.brand, fontSize: 18, fontWeight: '500' },
  sheetSub: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  closeBtn2: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border },
  subLabel: { color: theme.colors.muted, fontSize: 11, letterSpacing: 1, marginTop: 18, marginBottom: 8 },
  featureWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  featureChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fff', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: theme.colors.border },
  featureText: { color: theme.colors.brand, fontSize: 11, textTransform: 'capitalize', fontWeight: '500' },
  emptyText: { color: theme.colors.muted, fontSize: 12 },
  artCard: { backgroundColor: '#fff', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: theme.colors.border },
  artText: { color: theme.colors.onSurfaceSecondary, fontSize: 13, lineHeight: 18 },
  artLabel: { color: theme.colors.muted, fontSize: 11, letterSpacing: 0.8, marginBottom: 4 },
  artQuote: { color: theme.colors.brand, fontSize: 14, fontStyle: 'italic', lineHeight: 20, marginBottom: 8 },
  artHint: { color: theme.colors.muted, fontSize: 11, textAlign: 'center', marginTop: 6 },
  faceImg: { width: '100%', height: 180, borderRadius: 10, resizeMode: 'cover' },
  audioBtn: { flexDirection: 'row', alignSelf: 'flex-start', alignItems: 'center', gap: 8, backgroundColor: theme.colors.brand, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999 },
  audioText: { color: theme.colors.onBrandPrimary, fontWeight: '500', fontSize: 13 },
  auditRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  auditEvent: { color: theme.colors.brand, fontSize: 12, textTransform: 'capitalize', fontWeight: '500' },
  auditMeta: { color: theme.colors.muted, fontSize: 11 },
  imgOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', alignItems: 'center', justifyContent: 'center' },
});
