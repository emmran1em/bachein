import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { api, getUser } from '@/src/api';

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string }> = {
    draft: { bg: '#F0F0EE', fg: '#6B6B66' },
    sent: { bg: '#FCEAD8', fg: '#D9882B' },
    signed: { bg: '#DCEBE2', fg: '#3A6B4C' },
  };
  const c = map[status] || map.draft;
  return (
    <View style={[ss.pill, { backgroundColor: c.bg }]}>
      <Text style={[ss.pillText, { color: c.fg }]}>{status.toUpperCase()}</Text>
    </View>
  );
}

export default function Home() {
  const router = useRouter();
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [user, setUserState] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try {
      const u = await getUser();
      setUserState(u);
      const list: any = await api.listSent();
      setDocs(list);
    } catch (e) {
      // no-op
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(useCallback(() => { load(); }, []));

  return (
    <SafeAreaView style={ss.container} edges={['top']} testID="home-screen">
      <View style={ss.header}>
        <View>
          <Text style={ss.greeting}>Welcome,</Text>
          <Text style={ss.name}>{user?.name || 'there'}</Text>
        </View>
        <Pressable testID="ai-assistant-fab" style={ss.aiPill} onPress={() => router.push('/create')}>
          <Ionicons name="sparkles" size={14} color={theme.colors.brandSecondary} />
          <Text style={ss.aiPillText}>AI</Text>
        </Pressable>
      </View>

      <View style={ss.statsRow}>
        <View style={ss.statCard}>
          <Text style={ss.statNum}>{docs.length}</Text>
          <Text style={ss.statLabel}>Total Docs</Text>
        </View>
        <View style={ss.statCard}>
          <Text style={ss.statNum}>{docs.filter(d => d.status === 'signed').length}</Text>
          <Text style={ss.statLabel}>Signed</Text>
        </View>
        <View style={ss.statCard}>
          <Text style={ss.statNum}>{docs.filter(d => d.status === 'sent').length}</Text>
          <Text style={ss.statLabel}>Pending</Text>
        </View>
      </View>

      <Text style={ss.sectionTitle}>Your documents</Text>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={theme.colors.brand} />
      ) : docs.length === 0 ? (
        <View style={ss.empty} testID="home-empty">
          <Ionicons name="document-outline" size={48} color={theme.colors.muted} />
          <Text style={ss.emptyTitle}>No documents yet</Text>
          <Text style={ss.emptySub}>Tap the + button to create your first secure document.</Text>
          <Pressable testID="home-empty-create" style={ss.emptyBtn} onPress={() => router.push('/create')}>
            <Text style={ss.emptyBtnText}>Create Document</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={docs}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingBottom: 160, paddingHorizontal: 20 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          renderItem={({ item }) => (
            <Pressable
              testID={`doc-card-${item.id}`}
              style={ss.card}
              onPress={() => router.push(`/document/${item.id}`)}
            >
              <View style={{ flex: 1 }}>
                <View style={ss.rowBetween}>
                  <Text style={ss.docCategory}>{item.category}</Text>
                  <StatusPill status={item.status} />
                </View>
                <Text style={ss.docTitle} numberOfLines={2}>{item.title}</Text>
                <Text style={ss.docMeta}>
                  {new Date(item.created_at).toLocaleDateString()} • {item.mode === 'secure' ? 'Secure' : 'Normal'}
                  {item.recipient_email ? ` • ${item.recipient_email}` : ''}
                </Text>
              </View>
              <Pressable testID={`check-status-${item.id}`} style={ss.statusBtn} onPress={() => router.push(`/document/${item.id}`)}>
                <Text style={ss.statusBtnText}>Status</Text>
                <Ionicons name="chevron-forward" size={14} color={theme.colors.brand} />
              </Pressable>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const ss = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.surface },
  header: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  greeting: { color: theme.colors.muted, fontSize: 13 },
  name: { color: theme.colors.brand, fontSize: 26, fontWeight: '500', letterSpacing: -0.5 },
  aiPill: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FBE6DC', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, gap: 6 },
  aiPillText: { color: theme.colors.brandSecondary, fontWeight: '500', fontSize: 12 },
  statsRow: { flexDirection: 'row', gap: 12, paddingHorizontal: 20, marginTop: 16 },
  statCard: { flex: 1, backgroundColor: '#fff', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: theme.colors.border },
  statNum: { fontSize: 24, color: theme.colors.brand, fontWeight: '500' },
  statLabel: { fontSize: 11, color: theme.colors.muted, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionTitle: { paddingHorizontal: 24, marginTop: 24, marginBottom: 12, fontSize: 12, color: theme.colors.muted, textTransform: 'uppercase', letterSpacing: 1 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: theme.colors.border },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  docCategory: { color: theme.colors.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  docTitle: { color: theme.colors.brand, fontSize: 16, fontWeight: '500', marginTop: 6 },
  docMeta: { color: theme.colors.muted, fontSize: 12, marginTop: 6 },
  statusBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 12, alignSelf: 'flex-start', borderWidth: 1, borderColor: theme.colors.borderStrong, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  statusBtnText: { color: theme.colors.brand, fontSize: 12, fontWeight: '500' },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  pillText: { fontSize: 10, fontWeight: '500', letterSpacing: 0.5 },
  empty: { alignItems: 'center', marginTop: 80, paddingHorizontal: 40 },
  emptyTitle: { color: theme.colors.brand, fontSize: 18, fontWeight: '500', marginTop: 16 },
  emptySub: { color: theme.colors.muted, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  emptyBtn: { backgroundColor: theme.colors.brand, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 999, marginTop: 20 },
  emptyBtnText: { color: theme.colors.onBrandPrimary, fontWeight: '500' },
});
