import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { api } from '@/src/api';

export default function Vault() {
  const [data, setData] = useState<{ sent: any[]; received: any[] }>({ sent: [], received: [] });
  const [loading, setLoading] = useState(true);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    api.vault().then((v: any) => setData(v)).catch(() => {}).finally(() => setLoading(false));
  }, []));

  const all = [
    ...data.sent.map((d: any) => ({ ...d, _role: 'Sent' })),
    ...data.received.map((d: any) => ({ ...d, _role: 'Received' })),
  ];

  return (
    <SafeAreaView style={ss.container} edges={['top']} testID="vault-screen">
      <View style={ss.header}>
        <Text style={ss.title}>Evidence Vault</Text>
        <Text style={ss.subtitle}>Signed agreements, audit logs, and verification records</Text>
      </View>
      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={theme.colors.brand} />
      ) : all.length === 0 ? (
        <View style={ss.empty} testID="vault-empty">
          <Ionicons name="shield-checkmark-outline" size={48} color={theme.colors.muted} />
          <Text style={ss.emptyTitle}>Vault is secure and empty</Text>
          <Text style={ss.emptySub}>Signed documents are automatically archived here with full audit trails.</Text>
        </View>
      ) : (
        <FlatList
          data={all}
          keyExtractor={(d, i) => d.id + i}
          contentContainerStyle={{ padding: 20, paddingBottom: 160 }}
          renderItem={({ item }) => (
            <View style={ss.card} testID={`vault-item-${item.id}`}>
              <View style={ss.rowBetween}>
                <Text style={ss.role}>{item._role.toUpperCase()}</Text>
                <Ionicons name="lock-closed" size={14} color={theme.colors.success} />
              </View>
              <Text style={ss.docTitle} numberOfLines={2}>{item.title}</Text>
              <Text style={ss.docMeta}>{item.category}</Text>
              <View style={ss.divider} />
              <Text style={ss.metaLine}>Signed: <Text style={ss.mono}>{item.signed_at ? new Date(item.signed_at).toLocaleString() : '—'}</Text></Text>
              <Text style={ss.metaLine}>OTP: <Text style={ss.mono}>{item.otp_verified ? '✓' : '—'}</Text>  Voice: <Text style={ss.mono}>{item.voice_oath_completed ? '✓' : '—'}</Text></Text>
              <Text style={ss.metaLine}>ID: <Text style={ss.mono}>{item.id.slice(0, 18)}…</Text></Text>
            </View>
          )}
        />
      )}
    </SafeAreaView>
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
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: theme.colors.border },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  role: { color: theme.colors.muted, fontSize: 10, letterSpacing: 1, fontWeight: '500' },
  docTitle: { color: theme.colors.brand, fontSize: 16, fontWeight: '500', marginTop: 8 },
  docMeta: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  divider: { height: 1, backgroundColor: theme.colors.divider, marginVertical: 10 },
  metaLine: { color: theme.colors.onSurfaceSecondary, fontSize: 12, marginTop: 2 },
  mono: { fontFamily: 'Courier', color: theme.colors.brand },
});
