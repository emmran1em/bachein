import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl, Modal, TextInput, Image, Alert, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { api, getUser, clearAuth, API_BASE } from '@/src/api';
import { sharePdf } from '@/src/share';
import { BacheinLogo } from '@/src/components/Logo';
import VoiceScreen from '../voice';

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
  const [drawer, setDrawer] = useState(false);
  const [filter, setFilter] = useState<'all' | 'pdf' | 'doc' | 'nda'>('all');
  const [searchOpen, setSearchOpen] = useState(false);
  const [docAction, setDocAction] = useState<any>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [query, setQuery] = useState('');

  const load = async () => {
    try {
      const u = await getUser();
      setUserState(u);
      const [s, r]: any = await Promise.all([api.listSent(), api.listReceived()]);
      setSent(s); setReceived(r);
    } catch {} finally { setLoading(false); setRefreshing(false); }
  };
  useFocusEffect(useCallback(() => { load(); }, []));

  // Filter helper — check whether a doc matches active filter + search
  const matchFilter = (d: any) => {
    if (filter === 'nda') {
      if ((d.category || '').toUpperCase() !== 'NDA') return false;
    } else if (filter === 'pdf') {
      // Every Bachein document is delivered as a PDF (incl. NDAs) — show all
    } else if (filter === 'doc') {
      const hasDoc = (d.attached_files || []).some((f: any) => /\.docx?$/.test((f.name || '').toLowerCase()) || (f.type || '').includes('word') || (f.type || '').includes('officedocument'));
      if (!hasDoc && (d.category || '').toUpperCase() !== 'DOC') return false;
    }
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      const hay = `${d.title} ${d.category} ${d.sender_email} ${d.recipient_email || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  };

  const filteredSent = useMemo(() => sent.filter(matchFilter), [sent, filter, query]);
  const filteredReceived = useMemo(() => received.filter(matchFilter), [received, filter, query]);

  const signed = [...filteredSent, ...filteredReceived].filter(d => d.status === 'signed').slice(0, 4);
  const pending = filteredSent.filter(d => d.status === 'sent' || d.status === 'draft').slice(0, 4);
  const recentReceived = filteredReceived.slice(0, 3);
  const recentEdited = filteredSent.slice(0, 3);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const goTo = (r: string) => { setDrawer(false); router.push(r as any); };
  const logout = async () => { setDrawer(false); await clearAuth(); router.replace('/(auth)/login'); };

  return (
    <SafeAreaView style={ss.container} edges={['top']} testID="home-screen">
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 220 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
        <View style={ss.headerRow}>
          <Pressable testID="menu-btn" onPress={() => setDrawer(true)} style={ss.menuBtn}>
            <Ionicons name="menu" size={22} color={theme.colors.brand} />
          </Pressable>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={ss.greeting}>{greeting},</Text>
            <Text style={ss.name}>{user?.name || 'there'}</Text>
          </View>
          <Pressable testID="home-search" style={ss.iconBtn} onPress={() => setSearchOpen((v) => !v)}>
            <Ionicons name={searchOpen ? 'close' : 'search'} size={20} color={theme.colors.brand} />
          </Pressable>
          <Pressable testID="home-voice-orb" style={ss.orbBtn} onPress={() => setVoiceOpen(true)}>
            <Image source={require('../../assets/images/voice-orb.png')} style={{ width: 40, height: 40, borderRadius: 20 }} />
          </Pressable>
        </View>

        {searchOpen && (
          <View style={ss.searchWrap}>
            <Ionicons name="search-outline" size={16} color={theme.colors.muted} />
            <TextInput
              testID="home-search-input"
              autoFocus
              placeholder="Search documents by title, sender…"
              placeholderTextColor={theme.colors.muted}
              value={query}
              onChangeText={setQuery}
              style={ss.searchInput}
            />
            {!!query && (
              <Pressable onPress={() => setQuery('')}>
                <Ionicons name="close-circle" size={16} color={theme.colors.muted} />
              </Pressable>
            )}
          </View>
        )}

        {loading ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={theme.colors.brand} />
        ) : (
          <>
            {/* Quick actions */}
            <View style={ss.quickRow}>
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
              <Pressable testID="quick-chat" style={ss.quick} onPress={() => router.push('/(tabs)/chat')}>
                <Ionicons name="sparkles-outline" size={22} color={theme.colors.accent} />
                <Text style={ss.quickText}>Bachein AI</Text>
              </Pressable>
            </View>

            {/* Filter chips */}
            <View style={ss.filterRow}>
              {([
                { k: 'all', label: 'All', icon: 'apps-outline' as const },
                { k: 'pdf', label: 'PDF', icon: 'document-outline' as const },
                { k: 'doc', label: 'DOC', icon: 'document-text-outline' as const },
                { k: 'nda', label: 'NDA', icon: 'shield-checkmark-outline' as const },
              ] as const).map(({ k, label, icon }) => (
                <Pressable
                  key={k}
                  testID={`filter-${k}`}
                  onPress={() => setFilter(k)}
                  style={[ss.chip, filter === k && ss.chipActive]}
                >
                  <Ionicons name={icon} size={13} color={filter === k ? '#fff' : theme.colors.brand} />
                  <Text style={[ss.chipText, filter === k && ss.chipTextActive]}>{label}</Text>
                </Pressable>
              ))}
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
                  <RowCard key={d.id} item={d} kind="sent" onPress={() => router.push(`/document/${d.id}`)} onLongPress={() => setDocAction(d)} />
                ))}
              </Section>
            )}

            {pending.length > 0 && (
              <Section title="Pending signatures" testID="section-pending">
                {pending.map((d: any) => (
                  <RowCard key={d.id} item={d} kind="sent" onPress={() => router.push(`/document/${d.id}`)} onLongPress={() => setDocAction(d)} />
                ))}
              </Section>
            )}

            {signed.length > 0 && (
              <Section title="Recently signed" action="Open Vault" onAction={() => router.push('/(tabs)/vault')} testID="section-signed">
                {signed.map((d: any) => (
                  <RowCard key={d.id} item={d} kind="signed" onPress={() => router.push(`/document/${d.id}`)} onLongPress={() => setDocAction(d)} />
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

            {(sent.length > 0 || received.length > 0) && filteredSent.length === 0 && filteredReceived.length === 0 && (
              <View style={ss.emptyFilter} testID="filter-empty">
                <Ionicons name="funnel-outline" size={24} color={theme.colors.muted} />
                <Text style={ss.emptyFilterText}>
                  {query ? `No matches for “${query}”` : `No ${filter.toUpperCase()} documents yet`}
                </Text>
                <Pressable onPress={() => { setFilter('all'); setQuery(''); }}>
                  <Text style={ss.emptyFilterClear}>Clear filters</Text>
                </Pressable>
              </View>
            )}
          </>
        )}
      </ScrollView>

      <Modal visible={drawer} transparent animationType="fade" onRequestClose={() => setDrawer(false)}>
        <View style={{ flex: 1 }}>
          <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.35)' }]} onPress={() => setDrawer(false)} testID="drawer-overlay" />
          <View style={ss.drawer}>
            <View style={ss.drawerHead}>
              <View style={ss.drawerAvatar}><Text style={ss.drawerAvatarTxt}>{(user?.name || '?').slice(0, 1).toUpperCase()}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={ss.drawerName}>{user?.name || '—'}</Text>
                <Text style={ss.drawerEmail}>{user?.email || '—'}</Text>
              </View>
            </View>
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator contentContainerStyle={{ paddingBottom: 40 }} testID="drawer-scroll">
            <DrawerItem icon="home-outline" label="Home" onPress={() => setDrawer(false)} testID="drawer-home" />
            <DrawerItem icon="add-circle-outline" label="Create Document" onPress={() => goTo('/create')} testID="drawer-create" />
            <DrawerItem icon="create-outline" label="Write Document" onPress={() => goTo('/editor')} testID="drawer-write" />
            <DrawerItem icon="folder-open-outline" label="Documents" onPress={() => goTo('/(tabs)/received')} testID="drawer-docs" />
            <DrawerItem icon="sparkles-outline" label="Bachein AI" onPress={() => goTo('/(tabs)/chat')} testID="drawer-ai" />
            <DrawerItem icon="construct-outline" label="File Kit" onPress={() => goTo('/(tabs)/filekit')} testID="drawer-tools" />
            <DrawerItem icon="download-outline" label="Downloads" onPress={() => goTo('/downloads')} testID="drawer-downloads" />
            <DrawerItem icon="documents-outline" label="Saved Drafts" onPress={() => goTo('/drafts')} testID="drawer-drafts" />
            <DrawerItem icon="scan-outline" label="Scan Document" onPress={() => goTo('/scanner')} testID="drawer-scanner" />
            <DrawerItem icon="create-outline" label="Edit Assignment" onPress={() => goTo('/editor?import=1')} testID="drawer-edit-assignment" />
            <DrawerItem icon="text-outline" label="OCR" onPress={() => goTo('/ocr')} testID="drawer-ocr" />
            <DrawerItem icon="lock-closed-outline" label="Vault" onPress={() => goTo('/(tabs)/vault')} testID="drawer-vault" />
            <DrawerItem icon="logo-github" label="GitHub Workspace" onPress={() => goTo('/github')} testID="drawer-github" />
            <DrawerItem icon="ribbon-outline" label="Plans & Upgrade" onPress={() => goTo('/plans')} testID="drawer-plans" />
            <View style={{ height: 1, backgroundColor: theme.colors.divider, marginVertical: 8 }} />
            <DrawerItem icon="person-outline" label="Profile" onPress={() => goTo('/(tabs)/profile')} testID="drawer-profile" />
            <DrawerItem icon="document-text-outline" label="Terms & Conditions" onPress={() => goTo('/legal?section=terms')} testID="drawer-terms" />
            <DrawerItem icon="shield-half-outline" label="Children's Privacy Policy" onPress={() => goTo('/legal?section=children')} testID="drawer-children" />
            <DrawerItem icon="sparkles-outline" label="Usage of AI Policy" onPress={() => goTo('/legal?section=ai')} testID="drawer-ai-policy" />
            <DrawerItem icon="ribbon-outline" label="NDA & Legal" onPress={() => goTo('/legal?section=legal')} testID="drawer-nda-legal" />
            <DrawerItem icon="log-out-outline" label="Log out" onPress={logout} testID="drawer-logout" danger />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Long-press document actions */}
      <Modal visible={!!docAction} transparent animationType="fade" onRequestClose={() => setDocAction(null)}>
        <Pressable style={ss.actionOverlay} onPress={() => setDocAction(null)}>
          <View style={ss.actionSheet}>
            <Text style={ss.actionTitle} numberOfLines={1}>{docAction?.title}</Text>
            <Pressable
              testID="doc-action-share"
              style={ss.actionRow}
              onPress={async () => {
                const d = docAction; setDocAction(null);
                try { await sharePdf(`${API_BASE}/documents/${d.id}/signed-pdf`, `${d.title}.pdf`); } catch {}
              }}
            >
              <Ionicons name="share-social-outline" size={19} color={theme.colors.brand} />
              <Text style={ss.actionText}>Share PDF</Text>
            </Pressable>
            <Pressable
              testID="doc-action-delete"
              style={ss.actionRow}
              onPress={async () => {
                const d = docAction; setDocAction(null);
                const doDelete = async () => { try { await api.deleteDocument(d.id); load(); } catch {} };
                if (Platform.OS === 'web') {
                  // eslint-disable-next-line no-alert
                  if (typeof window !== 'undefined' && window.confirm(`Delete "${d.title}"?`)) doDelete();
                } else {
                  Alert.alert('Delete document', `Delete "${d.title}"? This cannot be undone.`, [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: doDelete },
                  ]);
                }
              }}
            >
              <Ionicons name="trash-outline" size={19} color={theme.colors.error} />
              <Text style={[ss.actionText, { color: theme.colors.error }]}>Delete</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
      {/* Voice agent — immersive overlay over Home */}
      <Modal visible={voiceOpen} transparent animationType="fade" onRequestClose={() => setVoiceOpen(false)}>
        <VoiceScreen onClose={() => setVoiceOpen(false)} />
      </Modal>
    </SafeAreaView>
  );
}

function DrawerItem({ icon, label, onPress, testID, danger }: any) {
  return (
    <Pressable testID={testID} onPress={onPress} style={ss.drawerItem}>
      <Ionicons name={icon} size={18} color={danger ? theme.colors.error : theme.colors.brand} />
      <Text style={[ss.drawerText, danger && { color: theme.colors.error }]}>{label}</Text>
    </Pressable>
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

function RowCard({ item, kind, onPress, onLongPress }: { item: any; kind: string; onPress: () => void; onLongPress?: () => void }) {
  const isNormal = item.mode === 'normal';
  const firstFile = (item.attached_files || [])[0]?.name || '';
  const extMatch = firstFile.match(/\.(docx?|xlsx?|pptx?|txt|csv)$/i);
  const ext = extMatch ? `.${extMatch[1].toLowerCase()}` : '.pdf';
  return (
    <Pressable testID={`home-row-${item.id}`} style={ss.rowCard} onPress={onPress} onLongPress={onLongPress} delayLongPress={350}>
      <View style={ss.rowIcon}>
        <Ionicons name={isNormal ? 'document-text-outline' : 'shield-checkmark-outline'} size={18} color={theme.colors.brand} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={ss.rowTitle} numberOfLines={1}>{item.title}<Text style={ss.rowExt}> {ext}</Text></Text>
        <Text style={ss.rowMeta} numberOfLines={1}>
          {kind === 'received' ? `from ${item.sender_email}` : item.category}
          {' · '}
          {new Date(item.updated_at || item.created_at).toLocaleDateString()}
        </Text>
      </View>
      {onLongPress && (
        <Pressable testID={`home-row-more-${item.id}`} onPress={onLongPress} hitSlop={8} style={{ padding: 4 }}>
          <Ionicons name="ellipsis-vertical" size={16} color={theme.colors.muted} />
        </Pressable>
      )}
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
  orbBtn: { marginLeft: 10, borderRadius: 22, shadowColor: '#5856d6', shadowOpacity: 0.5, shadowRadius: 8, shadowOffset: { width: 0, height: 0 }, elevation: 6 },
  actionOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  actionSheet: { backgroundColor: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 34 },
  actionTitle: { color: theme.colors.muted, fontSize: 12.5, fontWeight: '600', marginBottom: 8 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: theme.colors.divider },
  actionText: { color: theme.colors.brand, fontSize: 15, fontWeight: '500' },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, paddingHorizontal: 12, marginTop: 12, height: 42 },
  searchInput: { flex: 1, color: theme.colors.brand, fontSize: 14, paddingVertical: 0 },
  filterRow: { flexDirection: 'row', gap: 8, marginTop: 14, flexWrap: 'wrap' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.card },
  chipActive: { backgroundColor: theme.colors.brand, borderColor: theme.colors.brand },
  chipText: { color: theme.colors.brand, fontSize: 12, fontWeight: '500' },
  chipTextActive: { color: '#fff' },
  emptyFilter: { alignItems: 'center', marginTop: 60, gap: 8 },
  emptyFilterText: { color: theme.colors.muted, fontSize: 14, marginTop: 4 },
  emptyFilterClear: { color: theme.colors.accent, fontSize: 12, fontWeight: '500', marginTop: 4 },
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
  rowExt: { color: theme.colors.muted, fontSize: 10.5, fontWeight: '600' },
  rowMeta: { color: theme.colors.muted, fontSize: 11, marginTop: 2 },
  empty: { alignItems: 'center', marginTop: 60, paddingHorizontal: 30 },
  emptyTitle: { color: theme.colors.brand, fontSize: 18, fontWeight: '500', marginTop: 24, textAlign: 'center' },
  emptySub: { color: theme.colors.muted, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  emptyBtn: { backgroundColor: theme.colors.brand, paddingHorizontal: 22, paddingVertical: 12, borderRadius: 999, marginTop: 20 },
  emptyBtnText: { color: theme.colors.onBrandPrimary, fontWeight: '500' },
  menuBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center' },
  drawerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  drawer: { position: 'absolute', top: 0, bottom: 0, left: 0, width: 280, backgroundColor: theme.colors.surface, padding: 16, paddingTop: 40, borderRightWidth: 1, borderRightColor: theme.colors.border },
  drawerHead: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, backgroundColor: theme.colors.card, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border, marginBottom: 16 },
  drawerAvatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: theme.colors.brand, alignItems: 'center', justifyContent: 'center' },
  drawerAvatarTxt: { color: theme.colors.onBrandPrimary, fontSize: 16, fontWeight: '500' },
  drawerName: { color: theme.colors.brand, fontSize: 15, fontWeight: '500' },
  drawerEmail: { color: theme.colors.muted, fontSize: 11 },
  drawerItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 12, borderRadius: 10 },
  drawerText: { color: theme.colors.brand, fontSize: 14, fontWeight: '500' },
});
