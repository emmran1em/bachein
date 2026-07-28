import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { api } from '@/src/api';

export default function Vault() {
  const [data, setData] = useState<{ sent: any[]; received: any[] }>({ sent: [], received: [] });
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useFocusEffect(useCallback(() => {
    setLoading(true);
    api.vault().then((v: any) => setData(v)).catch(() => {}).finally(() => setLoading(false));
  }, []));

  const isNda = (d: any) => (d?.category || '').toUpperCase() === 'NDA';
  const isSigned = (d: any) => d?.status === 'signed' || d?.signature_status === 'signed';

  const all = [
    ...data.sent.filter((d: any) => isNda(d) && isSigned(d)).map((d: any) => ({ ...d, _role: 'Sent' })),
    ...data.received.filter((d: any) => isNda(d) && isSigned(d)).map((d: any) => ({ ...d, _role: 'Received' })),
  ];

  return (
    <SafeAreaView style={ss.container} edges={['top']} testID="vault-screen">
      <View style={ss.header}>
        <Text style={ss.title}>NDA Vault</Text>
        <Text style={ss.subtitle}>Fully-signed NDAs with voice, face &amp; audit records</Text>
      </View>
      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={theme.colors.brand} />
      ) : all.length === 0 ? (
        <View style={ss.empty} testID="vault-empty">
          <Ionicons name="shield-checkmark-outline" size={48} color={theme.colors.muted} />
          <Text style={ss.emptyTitle}>Your NDA vault is empty</Text>
          <Text style={ss.emptySub}>Once an NDA is fully signed by both parties, it&apos;s locked here with the voice oath, face check and audit trail.</Text>
        </View>
      ) : (
        <FlatList
          data={all}
          keyExtractor={(d, i) => d.id + i}
          contentContainerStyle={{ padding: 20, paddingBottom: 160 }}
          renderItem={({ item }) => (
            <Pressable
              style={ss.card}
              testID={`vault-item-${item.id}`}
              onPress={() => router.push(`/document/${item.id}`)}
            >
              <View style={ss.rowBetween}>
                <View style={ss.badge}>
                  <Ionicons name="shield-checkmark" size={11} color={theme.colors.brand} />
                  <Text style={ss.badgeText}>{item._role.toUpperCase()} · NDA</Text>
                </View>
                <View style={ss.lockPill}>
                  <Ionicons name="lock-closed" size={11} color={theme.colors.success} />
                  <Text style={ss.lockText}>SEALED</Text>
                </View>
              </View>
              <Text style={ss.docTitle} numberOfLines={2}>{item.title}</Text>
              <Text style={ss.docMeta}>
                {item._role === 'Sent' ? `To ${item.recipient_email || '—'}` : `From ${item.sender_email || '—'}`}
              </Text>
              <View style={ss.divider} />
              <View style={ss.evidenceRow}>
                <Evidence icon="finger-print" label="Signature" ok={isSigned(item)} />
                <Evidence icon="mail-outline" label="OTP" ok={item.otp_verified} />
                <Evidence icon="mic-outline" label="Voice" ok={item.voice_oath_completed} />
                <Evidence icon="person-outline" label="Face" ok={item.face_verified} />
              </View>
              <View style={ss.footRow}>
                <Text style={ss.metaLine}>
                  Signed <Text style={ss.metaBold}>{item.signed_at ? new Date(item.signed_at).toLocaleDateString() : '—'}</Text>
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Text style={ss.openText}>Open</Text>
                  <Ionicons name="chevron-forward" size={14} color={theme.colors.accent} />
                </View>
              </View>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

function Evidence({ icon, label, ok }: { icon: any; label: string; ok: boolean }) {
  return (
    <View style={ss.evidenceItem}>
      <View style={[ss.evIconWrap, ok && ss.evIconOk]}>
        <Ionicons name={icon} size={12} color={ok ? theme.colors.success : theme.colors.muted} />
      </View>
      <Text style={[ss.evLabel, ok && { color: theme.colors.success, fontWeight: '500' }]}>{label}</Text>
    </View>
  );
}

const ss = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.surface },
  header: { paddingHorizontal: 24, paddingTop: 12 },
  title: { fontSize: 28, color: theme.colors.brand, fontWeight: '500', letterSpacing: -0.5 },
  subtitle: { color: theme.colors.muted, marginTop: 4, fontSize: 13 },
  empty: { alignItems: 'center', marginTop: 80, paddingHorizontal: 40 },
  emptyTitle: { color: theme.colors.brand, fontSize: 18, fontWeight: '500', marginTop: 16 },
  emptySub: { color: theme.colors.muted, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: theme.colors.border },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: theme.colors.surfaceSecondary, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  badgeText: { color: theme.colors.brand, fontSize: 10, fontWeight: '500', letterSpacing: 0.5 },
  lockPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#DCEBE2', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  lockText: { color: theme.colors.success, fontSize: 10, fontWeight: '500', letterSpacing: 0.5 },
  docTitle: { color: theme.colors.brand, fontSize: 16, fontWeight: '500', marginTop: 10 },
  docMeta: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  divider: { height: 1, backgroundColor: theme.colors.divider, marginVertical: 12 },
  evidenceRow: { flexDirection: 'row', gap: 8 },
  evidenceItem: { flex: 1, alignItems: 'center', gap: 4 },
  evIconWrap: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surfaceSecondary },
  evIconOk: { backgroundColor: '#DCEBE2' },
  evLabel: { color: theme.colors.muted, fontSize: 10 },
  footRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 },
  metaLine: { color: theme.colors.muted, fontSize: 11 },
  metaBold: { color: theme.colors.brand, fontWeight: '500' },
  openText: { color: theme.colors.accent, fontSize: 12, fontWeight: '500' },
});
