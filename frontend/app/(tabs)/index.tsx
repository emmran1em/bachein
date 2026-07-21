import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { api, getUser } from '@/src/api';
import { AiAvatar, BacheinLogo } from '@/src/components/Logo';

function Section({ title, action, onAction, children, testID }: any) {
  return (
    <View style={{ marginTop: 24 }} testID={testID}>
      <View style={ss.sectionHead}>
        <Text style={ss.sectionTitle}>{title}</Text>
        {action && <Pressable onPress={onAction}><Text style={ss.sectionAction}>{action}</Text></Pressable>}
      </View>
      {children}
    </View>
  );
}

export default function Home() {
  const router = useRouter();
  const [user, setUserState] = useState<any>(null);
  const [sent, setSent] = useState<any[]>([]);
  const [received, setReceived] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try {
      const u = await getUser();
      setUserState(u);
      const [s, r]: any = await Promise.all([api.listSent(), api.listReceived()]);
      setSent(s); setReceived(r);
    } catch {} finally { setLoading(false); setRefreshing(false); }
  };
  useFocusEffect(useCallback(() => { load(); }, []));

  const signed = [...sent, ...received].filter(d => d.status === 'signed').slice(0, 4);
  const pending = sent.filter(d => d.status === 'sent' || d.status === 'draft').slice(0, 4);
  const recentReceived = received.slice(0, 3);
  const recentEdited = sent.slice(0, 3);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <SafeAreaView style={ss.container} edges={['top']} testID="home-screen">
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 220 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
        <View style={ss.headerRow}>
          <View>
            <Text style={ss.greeting}>{greeting},</Text>
            <Text style={ss.name}>{user?.name || 'there'}</Text>
          </View>
          <Pressable testID="home-ai" style={ss.aiCard} onPress={() => router.push('/(tabs)/chat')}>
            <AiAvatar size={36} />
            <View style={{ marginLeft: 8 }}>
              <Text style={ss.aiTitle}>Ask Bachein AI</Text>
              <Text style={ss.aiSub}>Read · Draft · Send</Text>
            </View>
          </Pressable>
        </View>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={theme.colors.brand} />
        ) : (
          <>
            {/* Quick actions */}
            <View style={ss.quickRow}>
              <Pressable testID="quick-create" style={ss.quick} onPress={() => router.push('/create')}>
                <Ionicons name="add-circle" size={22} color={theme.colors.accent} />
                <Text style={ss.quickText}>Create</Text>
              </Pressable>
              <Pressable testID="quick-write" style={ss.quick} onPress={() => router.push('/editor')}>
                <Ionicons name="create-outline" size={22} color={theme.colors.brand} />
                <Text style={ss.quickText}>Write</Text>
              </Pressable>
              <Pressable testID="quick-docs" style={ss.quick} onPress={() => router.push('/(tabs)/received')}>
                <Ionicons name="folder-open-outline" size={22} color={theme.colors.brand} />
                <Text style={ss.quickText}>Documents</Text>
              </Pressable>
              <Pressable testID="quick-vault" style={ss.quick} onPress={() => router.push('/(tabs)/vault')}>
                <Ionicons name="lock-closed-outline" size={22} color={theme.colors.brand} />
                <Text style={ss.quickText}>Vault</Text>
              </Pressable>
            </View>

            {/* Stats */}
            <View style={ss.statsRow}>
              <StatCard num={sent.length} label="Sent" />
              <StatCard num={received.length} label="Received" />
              <StatCard num={signed.length} label="Signed" />
              <StatCard num={pending.length} label="Pending" />
            </View>

            {recentReceived.length > 0 && (
              <Section title="Recently received" action="See all" onAction={() => router.push('/(tabs)/received')} testID="section-received">
                {recentReceived.map((d: any) => (
                  <RowCard key={d.id} item={d} kind="received" onPress={() => {
                    if (d.mode === 'secure' && d.signature_status !== 'signed') router.push(`/receive/${d.id}`);
                    else router.push(`/document/${d.id}`);
                  }} />
                ))}
              </Section>
            )}

            {recentEdited.length > 0 && (
              <Section title="Your documents" action="See all" onAction={() => router.push('/(tabs)/received')} testID="section-sent">
                {recentEdited.map((d: any) => (
                  <RowCard key={d.id} item={d} kind="sent" onPress={() => router.push(`/document/${d.id}`)} />
                ))}
              </Section>
            )}

            {pending.length > 0 && (
              <Section title="Pending signatures" testID="section-pending">
                {pending.map((d: any) => (
                  <RowCard key={d.id} item={d} kind="sent" onPress={() => router.push(`/document/${d.id}`)} />
                ))}
              </Section>
            )}

            {signed.length > 0 && (
              <Section title="Recently signed" action="Open Vault" onAction={() => router.push('/(tabs)/vault')} testID="section-signed">
                {signed.map((d: any) => (
                  <RowCard key={d.id} item={d} kind="signed" onPress={() => router.push(`/document/${d.id}`)} />
                ))}
              </Section>
            )}

            {sent.length === 0 && received.length === 0 && (
              <View style={ss.empty}>
                <BacheinLogo size={32} />
                <Text style={ss.emptyTitle}>Your document workspace is ready.</Text>
                <Text style={ss.emptySub}>Create your first document or ask Bachein AI to draft one for you.</Text>
                <Pressable testID="empty-create-btn" style={ss.emptyBtn} onPress={() => router.push('/create')}>
                  <Text style={ss.emptyBtnText}>Create your first document</Text>
                </Pressable>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function StatCard({ num, label }: { num: number; label: string }) {
  return (
    <View style={ss.statCard}>
      <Text style={ss.statNum}>{num}</Text>
      <Text style={ss.statLabel}>{label}</Text>
    </View>
  );
}

function RowCard({ item, kind, onPress }: { item: any; kind: string; onPress: () => void }) {
  const isNormal = item.mode === 'normal';
  return (
    <Pressable testID={`home-row-${item.id}`} style={ss.rowCard} onPress={onPress}>
      <View style={ss.rowIcon}>
        <Ionicons name={isNormal ? 'document-text-outline' : 'shield-checkmark-outline'} size={18} color={theme.colors.brand} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={ss.rowTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={ss.rowMeta} numberOfLines={1}>
          {kind === 'received' ? `from ${item.sender_email}` : item.category}
          {' · '}
          {new Date(item.updated_at || item.created_at).toLocaleDateString()}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={theme.colors.muted} />
    </Pressable>
  );
}

const ss = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.surface },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  greeting: { color: theme.colors.muted, fontSize: 13 },
  name: { color: theme.colors.brand, fontSize: 24, fontWeight: '500', letterSpacing: -0.5 },
  aiCard: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.card },
  aiTitle: { color: theme.colors.brand, fontSize: 12, fontWeight: '500' },
  aiSub: { color: theme.colors.muted, fontSize: 10 },
  quickRow: { flexDirection: 'row', gap: 8, marginTop: 20 },
  quick: { flex: 1, alignItems: 'center', backgroundColor: theme.colors.card, paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border, gap: 6 },
  quickText: { color: theme.colors.brand, fontSize: 11, fontWeight: '500' },
  statsRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  statCard: { flex: 1, backgroundColor: theme.colors.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: theme.colors.border },
  statNum: { fontSize: 22, color: theme.colors.brand, fontWeight: '500' },
  statLabel: { fontSize: 10, color: theme.colors.muted, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sectionTitle: { color: theme.colors.brand, fontSize: 15, fontWeight: '500' },
  sectionAction: { color: theme.colors.accent, fontSize: 12, fontWeight: '500' },
  rowCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: theme.colors.card, padding: 12, borderRadius: 12, marginBottom: 8, borderWidth: 1, borderColor: theme.colors.border },
  rowIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: theme.colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { color: theme.colors.brand, fontSize: 13, fontWeight: '500' },
  rowMeta: { color: theme.colors.muted, fontSize: 11, marginTop: 2 },
  empty: { alignItems: 'center', marginTop: 60, paddingHorizontal: 30 },
  emptyTitle: { color: theme.colors.brand, fontSize: 18, fontWeight: '500', marginTop: 24, textAlign: 'center' },
  emptySub: { color: theme.colors.muted, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  emptyBtn: { backgroundColor: theme.colors.brand, paddingHorizontal: 22, paddingVertical: 12, borderRadius: 999, marginTop: 20 },
  emptyBtnText: { color: theme.colors.onBrandPrimary, fontWeight: '500' },
});
