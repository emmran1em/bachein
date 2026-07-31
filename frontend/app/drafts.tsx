import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList, Modal, RefreshControl, ActivityIndicator, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { api } from '@/src/api';

/** Phase 9 — Saved Drafts + version history */
export default function DraftsScreen() {
  const router = useRouter();
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [historyFor, setHistoryFor] = useState<any>(null);
  const [versions, setVersions] = useState<any[] | null>(null);
  const [previewV, setPreviewV] = useState<any>(null);
  const [restoring, setRestoring] = useState(false);

  const load = useCallback(async () => {
    try {
      const r: any = await api.editorList();
      setDocs(r.documents || r.items || []);
    } catch {}
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openHistory = async (doc: any) => {
    setHistoryFor(doc);
    setVersions(null);
    setPreviewV(null);
    try {
      const r: any = await api.editorVersions(doc.id);
      setVersions(r.versions || []);
    } catch { setVersions([]); }
  };

  const restore = async (v: any) => {
    if (!historyFor) return;
    setRestoring(true);
    try {
      await api.editorSave({ id: historyFor.id, title: historyFor.title, doc_type: historyFor.doc_type || 'Other', html: v.html });
      setHistoryFor(null);
      router.push({ pathname: '/editor', params: { id: historyFor.id } });
    } catch {}
    setRestoring(false);
  };

  const fmt = (iso: string) => { try { return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return iso; } };
  const stripHtml = (h: string) => (h || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  return (
    <SafeAreaView style={s.container} edges={['top']} testID="drafts-screen">
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.iconBtn} testID="drafts-back">
          <Ionicons name="chevron-back" size={22} color={theme.colors.brand} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Saved Drafts</Text>
          <Text style={s.subtitle}>Your documents & version history</Text>
        </View>
        <Pressable onPress={() => router.push('/editor')} style={s.newBtn} testID="drafts-new">
          <Ionicons name="add" size={16} color="#fff" />
          <Text style={s.newText}>New</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={theme.colors.brand} /></View>
      ) : docs.length === 0 ? (
        <View style={s.center}>
          <Ionicons name="document-text-outline" size={40} color={theme.colors.borderStrong} />
          <Text style={s.emptyTitle}>No drafts yet</Text>
          <Text style={s.emptySub}>Documents you write or import are saved here automatically.</Text>
        </View>
      ) : (
        <FlatList
          data={docs}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 50 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={theme.colors.brand} />}
          renderItem={({ item }) => (
            <Pressable
              style={s.row}
              testID={`draft-${item.id}`}
              onPress={() => router.push({ pathname: '/editor', params: { id: item.id } })}
            >
              <View style={s.docIcon}><Ionicons name="document-text-outline" size={19} color={theme.colors.brand} /></View>
              <View style={{ flex: 1 }}>
                <Text style={s.name} numberOfLines={1}>{item.title || 'Untitled'}</Text>
                <Text style={s.meta}>{item.doc_type || 'Document'} · updated {fmt(item.updated_at || item.created_at)}</Text>
              </View>
              <Pressable style={s.histBtn} testID={`draft-history-${item.id}`} onPress={() => openHistory(item)}>
                <Ionicons name="time-outline" size={17} color={theme.colors.muted} />
              </Pressable>
            </Pressable>
          )}
        />
      )}

      <Modal visible={!!historyFor} transparent animationType="slide" onRequestClose={() => setHistoryFor(null)}>
        <Pressable style={s.backdrop} onPress={() => setHistoryFor(null)}>
          <Pressable style={s.sheet} onPress={() => {}}>
            <View style={s.grabber} />
            <Text style={s.sheetTitle} numberOfLines={1}>History — {historyFor?.title}</Text>
            {versions === null ? (
              <ActivityIndicator color={theme.colors.brand} style={{ marginVertical: 24 }} />
            ) : versions.length === 0 ? (
              <Text style={s.emptySub}>No previous versions yet — versions are saved every time you edit.</Text>
            ) : previewV ? (
              <View>
                <Text style={s.meta}>Version from {fmt(previewV.ts)} · by {previewV.by}</Text>
                <ScrollView style={s.previewBox}>
                  <Text style={s.previewText}>{stripHtml(previewV.html).slice(0, 3000) || '(empty)'}</Text>
                </ScrollView>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                  <Pressable style={s.cancelBtn} onPress={() => setPreviewV(null)}>
                    <Text style={s.cancelText}>Back</Text>
                  </Pressable>
                  <Pressable style={[s.restoreBtn, restoring && { opacity: 0.6 }]} disabled={restoring} onPress={() => restore(previewV)} testID="version-restore">
                    <Ionicons name="arrow-undo-outline" size={15} color="#fff" />
                    <Text style={s.restoreText}>{restoring ? 'Restoring…' : 'Restore this version'}</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 380 }}>
                {versions.map((v, i) => (
                  <Pressable key={i} style={s.vRow} testID={`version-${i}`} onPress={() => setPreviewV(v)}>
                    <Ionicons name="git-commit-outline" size={17} color={theme.colors.brand} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.vTitle}>{fmt(v.ts)}</Text>
                      <Text style={s.meta}>by {v.by} · {stripHtml(v.html).slice(0, 60) || '(empty)'}…</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={15} color={theme.colors.muted} />
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center' },
  title: { color: theme.colors.brand, fontSize: 18, fontWeight: '500' },
  subtitle: { color: theme.colors.muted, fontSize: 11, marginTop: 2 },
  newBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: theme.colors.brand, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
  newText: { color: '#fff', fontSize: 13, fontWeight: '500' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30, gap: 8 },
  emptyTitle: { color: theme.colors.brand, fontSize: 16, fontWeight: '500', marginTop: 6 },
  emptySub: { color: theme.colors.muted, fontSize: 12, textAlign: 'center', lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border, padding: 12, marginBottom: 10 },
  docIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: theme.colors.card, alignItems: 'center', justifyContent: 'center' },
  name: { color: theme.colors.brand, fontSize: 14, fontWeight: '500' },
  meta: { color: theme.colors.muted, fontSize: 11, marginTop: 3 },
  histBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 30 },
  grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: theme.colors.borderStrong, alignSelf: 'center', marginBottom: 12 },
  sheetTitle: { color: theme.colors.brand, fontSize: 15, fontWeight: '500', marginBottom: 10 },
  vRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.divider },
  vTitle: { color: theme.colors.brand, fontSize: 13.5, fontWeight: '500' },
  previewBox: { maxHeight: 260, marginTop: 10, backgroundColor: theme.colors.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: theme.colors.border },
  previewText: { color: theme.colors.brand, fontSize: 12.5, lineHeight: 19 },
  cancelBtn: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center' },
  cancelText: { color: theme.colors.brand, fontSize: 13 },
  restoreBtn: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: theme.colors.brand },
  restoreText: { color: '#fff', fontSize: 13, fontWeight: '500' },
});
