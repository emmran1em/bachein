import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { api } from '@/src/api';

type Segment = 'sent' | 'received';

export default function Documents() {
  const router = useRouter();
  const [seg, setSeg] = useState<Segment>('sent');
  const [sent, setSent] = useState<any[]>([]);
  const [received, setReceived] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showMore, setShowMore] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [s, r]: any = await Promise.all([api.listSent(), api.listReceived()]);
      setSent(s); setReceived(r);
    } catch {} finally { setLoading(false); }
  };
  useFocusEffect(useCallback(() => { load(); }, []));

  const list = seg === 'sent' ? sent : received;
  const unreadCount = received.filter(d => !d.opened).length;

  return (
    <SafeAreaView style={ss.container} edges={['top']} testID="documents-screen">
      <View style={ss.header}>
        <View style={{ flex: 1 }}>
          <Text style={ss.title}>Documents</Text>
          <Text style={ss.subtitle}>Everything you send and receive.</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable testID="doc-more-btn" style={ss.iconBtn} onPress={() => setShowMore(!showMore)}>
            <Ionicons name="ellipsis-vertical" size={20} color={theme.colors.brand} />
          </Pressable>
        </View>
      </View>

      {showMore && (
        <View style={ss.moreMenu} testID="more-menu">
          <Pressable testID="menu-write" style={ss.moreItem} onPress={() => { setShowMore(false); router.push('/editor'); }}>
            <Ionicons name="create-outline" size={18} color={theme.colors.accent} />
            <Text style={ss.moreText}>Write Document</Text>
            <View style={ss.newPill}><Text style={ss.newText}>AI</Text></View>
          </Pressable>
          <Pressable testID="menu-github" style={ss.moreItem} onPress={() => { setShowMore(false); router.push('/github'); }}>
            <Ionicons name="logo-github" size={18} color={theme.colors.brand} />
            <Text style={ss.moreText}>GitHub Workspace</Text>
          </Pressable>
          <Pressable testID="menu-scan" style={ss.moreItem} onPress={() => { setShowMore(false); }}>
            <Ionicons name="scan-outline" size={18} color={theme.colors.brand} />
            <Text style={ss.moreText}>Scan document</Text>
          </Pressable>
        </View>
      )}

      <View style={ss.segRow}>
        <Pressable testID="seg-sent" style={[ss.seg, seg === 'sent' && ss.segActive]} onPress={() => setSeg('sent')}>
          <Text style={[ss.segText, seg === 'sent' && ss.segTextActive]}>Sent</Text>
          <View style={[ss.segCount, seg === 'sent' && ss.segCountActive]}><Text style={[ss.segCountText, seg === 'sent' && { color: theme.colors.onBrandPrimary }]}>{sent.length}</Text></View>
        </Pressable>
        <Pressable testID="seg-received" style={[ss.seg, seg === 'received' && ss.segActive]} onPress={() => setSeg('received')}>
          <Text style={[ss.segText, seg === 'received' && ss.segTextActive]}>Received</Text>
          <View style={[ss.segCount, seg === 'received' && ss.segCountActive, unreadCount > 0 && seg !== 'received' && { backgroundColor: theme.colors.accent }]}>
            <Text style={[ss.segCountText, seg === 'received' && { color: theme.colors.onBrandPrimary }, unreadCount > 0 && seg !== 'received' && { color: '#fff' }]}>{received.length}</Text>
          </View>
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={theme.colors.brand} />
      ) : list.length === 0 ? (
        <View style={ss.empty}>
          <Ionicons name={seg === 'sent' ? 'paper-plane-outline' : 'mail-open-outline'} size={44} color={theme.colors.muted} />
          <Text style={ss.emptyTitle}>{seg === 'sent' ? 'Nothing sent yet' : 'Nothing received yet'}</Text>
          <Text style={ss.emptySub}>{seg === 'sent' ? 'Tap the + button to create a document.' : 'Documents shared with you appear here.'}</Text>
        </View>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(d) => d.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 200 }}
          renderItem={({ item }) => <DocumentRow item={item} seg={seg} onPress={() => {
            if (seg === 'received' && item.mode === 'secure' && item.signature_status !== 'signed') {
              router.push(`/receive/${item.id}`);
            } else {
              router.push(`/document/${item.id}`);
            }
          }} />}
        />
      )}
    </SafeAreaView>
  );
}

function DocumentRow({ item, seg, onPress }: { item: any; seg: Segment; onPress: () => void }) {
  const isNormal = item.mode === 'normal';
  const badgeMap: any = {
    draft: { bg: '#EFECE5', fg: '#6B6760', label: 'DRAFT' },
    sent: { bg: '#FCEAD8', fg: '#D9882B', label: 'PENDING' },
    signed: { bg: '#DCEBE2', fg: '#4C8161', label: 'SIGNED' },
  };
  const b = badgeMap[item.status] || badgeMap.draft;
  return (
    <Pressable testID={`doc-row-${item.id}`} style={ss.row} onPress={onPress}>
      <View style={ss.rowIcon}>
        <Ionicons name={isNormal ? 'document-text-outline' : 'shield-checkmark-outline'} size={18} color={isNormal ? theme.colors.muted : theme.colors.brand} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={ss.docTitle} numberOfLines={1}>{item.title}</Text>
        {isNormal ? (
          <Text style={ss.docMeta}>Normal PDF · {new Date(item.created_at).toLocaleDateString()}</Text>
        ) : (
          <>
            <Text style={ss.docMeta} numberOfLines={1}>
              {item.category} · {new Date(item.created_at).toLocaleDateString()}
              {seg === 'sent' ? ` · ${item.recipient_email || '—'}` : ` · from ${item.sender_email}`}
            </Text>
            <View style={ss.chipRow}>
              <View style={[ss.chip, { backgroundColor: b.bg }]}><Text style={[ss.chipText, { color: b.fg }]}>{b.label}</Text></View>
              {item.otp_verified && <View style={ss.chipMuted}><Ionicons name="checkmark" size={9} color={theme.colors.success} /><Text style={ss.chipMutedText}>OTP</Text></View>}
              {item.face_verified && <View style={ss.chipMuted}><Ionicons name="checkmark" size={9} color={theme.colors.success} /><Text style={ss.chipMutedText}>Face</Text></View>}
              {item.voice_oath_completed && <View style={ss.chipMuted}><Ionicons name="checkmark" size={9} color={theme.colors.success} /><Text style={ss.chipMutedText}>Voice</Text></View>}
            </View>
          </>
        )}
      </View>
      {isNormal ? (
        <View style={ss.actionsCol}>
          <Pressable testID={`open-${item.id}`} style={ss.openBtn} onPress={onPress}>
            <Text style={ss.openBtnText}>Open</Text>
          </Pressable>
        </View>
      ) : (
        <View style={ss.actionsCol}>
          <Pressable testID={`status-${item.id}`} style={ss.statusPillBtn} onPress={onPress}>
            <Text style={ss.statusPillText}>{seg === 'received' && item.signature_status !== 'signed' ? 'Verify' : 'Status'}</Text>
            <Ionicons name="chevron-forward" size={12} color={theme.colors.brand} />
          </Pressable>
        </View>
      )}
    </Pressable>
  );
}

const ss = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.surface },
  header: { flexDirection: 'row', paddingHorizontal: 24, paddingTop: 12, paddingBottom: 8, alignItems: 'center' },
  title: { fontSize: 28, color: theme.colors.brand, fontWeight: '500', letterSpacing: -0.5 },
  subtitle: { color: theme.colors.muted, marginTop: 2, fontSize: 12 },
  iconBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center' },
  moreMenu: { marginHorizontal: 20, backgroundColor: theme.colors.card, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border, padding: 4, marginTop: 4 },
  moreItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  moreText: { color: theme.colors.brand, fontSize: 14, fontWeight: '500', flex: 1 },
  newPill: { backgroundColor: theme.colors.accent, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999 },
  newText: { color: '#fff', fontSize: 9, fontWeight: '600' },
  segRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, marginTop: 16, marginBottom: 4 },
  seg: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 999, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.card },
  segActive: { backgroundColor: theme.colors.brand, borderColor: theme.colors.brand },
  segText: { color: theme.colors.brand, fontSize: 13, fontWeight: '500' },
  segTextActive: { color: theme.colors.onBrandPrimary },
  segCount: { backgroundColor: theme.colors.surfaceSecondary, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, minWidth: 24, alignItems: 'center' },
  segCountActive: { backgroundColor: 'rgba(255,255,255,0.18)' },
  segCountText: { color: theme.colors.muted, fontSize: 11, fontWeight: '500' },
  empty: { alignItems: 'center', marginTop: 80, paddingHorizontal: 40 },
  emptyTitle: { color: theme.colors.brand, fontSize: 17, fontWeight: '500', marginTop: 12 },
  emptySub: { color: theme.colors.muted, textAlign: 'center', marginTop: 6, fontSize: 13 },
  row: { flexDirection: 'row', gap: 12, backgroundColor: theme.colors.card, padding: 14, borderRadius: 14, marginBottom: 8, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center' },
  rowIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center' },
  docTitle: { color: theme.colors.brand, fontSize: 14, fontWeight: '500' },
  docMeta: { color: theme.colors.muted, fontSize: 11, marginTop: 3 },
  chipRow: { flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' },
  chip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  chipText: { fontSize: 9, fontWeight: '600', letterSpacing: 0.5 },
  chipMuted: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: theme.colors.surfaceSecondary, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999 },
  chipMutedText: { color: theme.colors.muted, fontSize: 9, fontWeight: '500' },
  actionsCol: { alignItems: 'flex-end' },
  openBtn: { backgroundColor: theme.colors.brand, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  openBtnText: { color: theme.colors.onBrandPrimary, fontSize: 12, fontWeight: '500' },
  statusPillBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: theme.colors.borderStrong, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999, backgroundColor: theme.colors.card },
  statusPillText: { color: theme.colors.brand, fontSize: 11, fontWeight: '500' },
});
