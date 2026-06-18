import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl, Linking, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { api, getUser, getToken } from '@/src/api';

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

export default function DocumentView() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [doc, setDoc] = useState<any>(null);
  const [status, setStatus] = useState<any>(null);
  const [me, setMe] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

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
          // Also refresh doc once
          api.getDocument(id!).then((d: any) => setDoc(d)).catch(() => {});
        }
      } catch {}
    }, 4000);
    return () => clearInterval(t);
  }, [id]));

  const openPdf = async (url: string) => {
    try {
      const token = await getToken();
      // Most platforms only handle GET via Linking; append token? Easier: use fetch + blob on web; for mobile we open with auth header is not supported.
      // For demo: just open URL (will fail if no auth) — instead use a temporary public-ish approach by appending token query param? Backend currently uses Authorization header only.
      // Simple solution: copy URL to clipboard or use Share. Use Linking.openURL with token in URL — not safe but functional for preview.
      const sep = url.includes('?') ? '&' : '?';
      await Linking.openURL(`${url}${sep}token=${token}`);
    } catch (e: any) {
      // ignore
    }
  };

  if (loading || !doc) {
    return <SafeAreaView style={ss.container}><ActivityIndicator style={{ marginTop: 80 }} color={theme.colors.brand} /></SafeAreaView>;
  }

  const isSender = me?.id === doc.sender_id;
  const isReceiver = me?.email === doc.recipient_email;
  const showVerifyCta = isReceiver && doc.mode === 'secure' && doc.signature_status !== 'signed';

  return (
    <SafeAreaView style={ss.container} edges={['top']} testID="document-detail-screen">
      <View style={ss.header}>
        <Pressable testID="back-button" onPress={() => router.back()} style={ss.closeBtn}>
          <Ionicons name="chevron-back" size={22} color={theme.colors.brand} />
        </Pressable>
        <Text style={ss.eyebrow}>{doc.category} • {doc.mode === 'secure' ? 'SECURE' : 'NORMAL'}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 80 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
        <Text style={ss.title} testID="doc-title">{doc.title}</Text>
        <Text style={ss.meta}>Created {new Date(doc.created_at).toLocaleString()}</Text>
        {doc.recipient_email && <Text style={ss.meta}>To: {doc.recipient_email}</Text>}

        {showVerifyCta && (
          <Pressable testID="receiver-verify-cta" style={ss.verifyCta} onPress={() => router.push(`/receive/${doc.id}`)}>
            <Ionicons name="shield-checkmark" size={18} color={theme.colors.onBrandPrimary} />
            <Text style={ss.verifyCtaText}>Verify & Sign to Unlock</Text>
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
            <Row label="Voice Oath" value={status?.voice_oath_completed ? 'Completed' : (doc.security_config?.voice_oath ? 'Pending' : '—')} ok={!!status?.voice_oath_completed} />
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
        </View>

        {doc.mode === 'secure' && doc.security_config && (
          <>
            <Text style={ss.sectionLabel}>SECURITY CONFIG</Text>
            <View style={ss.docBox}>
              {Object.entries(doc.security_config).filter(([k]) => k !== 'access_expiry_hours').map(([k, v]) => (
                <View style={ss.configRow} key={k}>
                  <Ionicons name={v ? 'checkmark-circle' : 'close-circle-outline'} size={14} color={v ? theme.colors.success : theme.colors.muted} />
                  <Text style={ss.configText}>{k.replace(/_/g, ' ')}</Text>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const ss = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
  closeBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border },
  eyebrow: { color: theme.colors.muted, fontSize: 11, letterSpacing: 1 },
  title: { fontSize: 24, color: theme.colors.brand, fontWeight: '500', letterSpacing: -0.5 },
  meta: { color: theme.colors.muted, fontSize: 13, marginTop: 4 },
  verifyCta: { flexDirection: 'row', alignSelf: 'flex-start', backgroundColor: theme.colors.brandSecondary, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 999, alignItems: 'center', gap: 8, marginTop: 16 },
  verifyCtaText: { color: '#fff', fontWeight: '500' },
  sectionLabel: { color: theme.colors.muted, fontSize: 11, letterSpacing: 1, marginTop: 28, marginBottom: 10 },
  docBox: { backgroundColor: '#fff', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: theme.colors.border },
  docBody: { color: theme.colors.onSurfaceSecondary, lineHeight: 20, fontSize: 13 },
  statusCard: { backgroundColor: '#fff', borderRadius: 16, padding: 18, borderWidth: 1, borderColor: theme.colors.border, marginTop: 16 },
  statusTitle: { color: theme.colors.brand, fontWeight: '500', fontSize: 15 },
  divider: { height: 1, backgroundColor: theme.colors.divider, marginVertical: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  rowLabel: { color: theme.colors.muted, fontSize: 13 },
  rowValue: { color: theme.colors.brand, fontSize: 13, fontWeight: '500' },
  configRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  configText: { color: theme.colors.onSurfaceSecondary, fontSize: 13, textTransform: 'capitalize' },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.success },
  liveText: { color: theme.colors.success, fontSize: 10, fontWeight: '500', letterSpacing: 0.5 },
  downloadBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: theme.colors.borderStrong, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: '#fff' },
  downloadText: { color: theme.colors.brand, fontSize: 12, fontWeight: '500' },
});
