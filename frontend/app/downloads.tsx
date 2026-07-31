import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList, Modal, TextInput, RefreshControl, ActivityIndicator, Alert, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { api } from '@/src/api';
import { sharePdf } from '@/src/share';

type DL = { id: string; name: string; kind: string; size: number; created_at: string };

const KIND_META: Record<string, { icon: any; label: string }> = {
  question_paper: { icon: 'school-outline', label: 'Question Paper' },
  answer_paper: { icon: 'create-outline', label: 'Answer Booklet' },
  scan: { icon: 'scan-outline', label: 'Scanned PDF' },
};

export default function DownloadsScreen() {
  const router = useRouter();
  const [items, setItems] = useState<DL[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [menuFor, setMenuFor] = useState<DL | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r: any = await api.downloads();
      setItems(r.items || []);
    } catch {}
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const doShare = async (item: DL) => {
    setBusy(true);
    try { await sharePdf(api.downloadFileUrl(item.id), item.name); } catch {}
    setBusy(false);
    setMenuFor(null);
  };

  const doDelete = async (item: DL) => {
    const run = async () => {
      try { await api.downloadsDelete(item.id); setItems((p) => p.filter((x) => x.id !== item.id)); } catch {}
      setMenuFor(null);
    };
    if (Platform.OS === 'web') {
      // eslint-disable-next-line no-alert
      if (confirm(`Delete "${item.name}"?`)) run(); else setMenuFor(null);
    } else {
      Alert.alert('Delete file', `Delete "${item.name}"?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: run },
      ]);
    }
  };

  const commitRename = async () => {
    if (!menuFor) return;
    const name = renameVal.trim();
    if (!name) { setRenaming(false); return; }
    setBusy(true);
    try {
      await api.downloadsRename(menuFor.id, name);
      setItems((p) => p.map((x) => (x.id === menuFor.id ? { ...x, name } : x)));
    } catch {}
    setBusy(false);
    setRenaming(false);
    setMenuFor(null);
  };

  const fmtSize = (b: number) => (b > 1024 * 1024 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
  const fmtDate = (iso: string) => { try { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); } catch { return ''; } };

  return (
    <SafeAreaView style={s.container} edges={['top']} testID="downloads-screen">
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.iconBtn} testID="dl-back">
          <Ionicons name="chevron-back" size={22} color={theme.colors.brand} />
        </Pressable>
        <View>
          <Text style={s.title}>Downloads</Text>
          <Text style={s.subtitle}>Your generated PDFs — share, rename, delete</Text>
        </View>
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={theme.colors.brand} /></View>
      ) : items.length === 0 ? (
        <View style={s.center}>
          <Ionicons name="download-outline" size={40} color={theme.colors.borderStrong} />
          <Text style={s.emptyTitle}>Nothing here yet</Text>
          <Text style={s.emptySub}>Question papers and answer booklets you generate are saved here automatically.</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.brand} />}
          renderItem={({ item }) => {
            const meta = KIND_META[item.kind] || { icon: 'document-outline', label: 'PDF' };
            return (
              <View style={s.row} testID={`dl-row-${item.id}`}>
                <View style={s.fileIcon}>
                  <Ionicons name={meta.icon} size={20} color={theme.colors.brand} />
                </View>
                <Pressable style={{ flex: 1 }} onPress={() => doShare(item)}>
                  <Text style={s.name} numberOfLines={2}>{item.name}</Text>
                  <Text style={s.meta}>{meta.label} · {fmtSize(item.size)} · {fmtDate(item.created_at)}</Text>
                </Pressable>
                <Pressable
                  testID={`dl-more-${item.id}`}
                  style={s.moreBtn}
                  onPress={() => { setMenuFor(item); setRenaming(false); setRenameVal(item.name); }}
                >
                  <Ionicons name="ellipsis-horizontal" size={18} color={theme.colors.muted} />
                </Pressable>
              </View>
            );
          }}
        />
      )}

      <Modal visible={!!menuFor} transparent animationType="slide" onRequestClose={() => setMenuFor(null)}>
        <Pressable style={s.backdrop} onPress={() => setMenuFor(null)}>
          <Pressable style={s.sheet} onPress={() => {}}>
            <View style={s.grabber} />
            <Text style={s.sheetTitle} numberOfLines={1}>{menuFor?.name}</Text>
            {renaming ? (
              <View style={{ marginTop: 14 }}>
                <TextInput
                  testID="dl-rename-input"
                  style={s.renameInput}
                  value={renameVal}
                  onChangeText={setRenameVal}
                  autoFocus
                  placeholder="New name"
                  placeholderTextColor={theme.colors.muted}
                />
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                  <Pressable style={s.sheetCancel} onPress={() => setRenaming(false)}>
                    <Text style={s.sheetCancelText}>Cancel</Text>
                  </Pressable>
                  <Pressable testID="dl-rename-save" style={[s.sheetPrimary, busy && { opacity: 0.6 }]} disabled={busy} onPress={commitRename}>
                    <Text style={s.sheetPrimaryText}>Save</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <View style={{ marginTop: 8 }}>
                <Pressable
                  testID="dl-action-open"
                  style={s.action}
                  onPress={() => { const it = menuFor; setMenuFor(null); if (it) router.push({ pathname: '/viewer', params: { url: api.downloadFileUrl(it.id), name: it.name } }); }}
                >
                  <Ionicons name="eye-outline" size={20} color={theme.colors.brand} />
                  <View>
                    <Text style={s.actionText}>Open</Text>
                    <Text style={s.actionSub}>View inside Bachein</Text>
                  </View>
                </Pressable>
                <Pressable testID="dl-action-share" style={s.action} onPress={() => menuFor && doShare(menuFor)}>
                  <Ionicons name="share-social-outline" size={20} color={theme.colors.brand} />
                  <View>
                    <Text style={s.actionText}>Share</Text>
                    <Text style={s.actionSub}>WhatsApp, Email, and more</Text>
                  </View>
                  {busy && <ActivityIndicator size="small" color={theme.colors.brand} style={{ marginLeft: 'auto' }} />}
                </Pressable>
                <Pressable testID="dl-action-rename" style={s.action} onPress={() => setRenaming(true)}>
                  <Ionicons name="pencil-outline" size={20} color={theme.colors.brand} />
                  <Text style={s.actionText}>Rename</Text>
                </Pressable>
                <Pressable testID="dl-action-delete" style={s.action} onPress={() => menuFor && doDelete(menuFor)}>
                  <Ionicons name="trash-outline" size={20} color={theme.colors.error} />
                  <Text style={[s.actionText, { color: theme.colors.error }]}>Delete</Text>
                </Pressable>
              </View>
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30, gap: 8 },
  emptyTitle: { color: theme.colors.brand, fontSize: 16, fontWeight: '500', marginTop: 6 },
  emptySub: { color: theme.colors.muted, fontSize: 12, textAlign: 'center', lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border, padding: 12, marginBottom: 10 },
  fileIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: theme.colors.card, alignItems: 'center', justifyContent: 'center' },
  name: { color: theme.colors.brand, fontSize: 14, fontWeight: '500' },
  meta: { color: theme.colors.muted, fontSize: 11, marginTop: 3 },
  moreBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 34 },
  grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: theme.colors.borderStrong, alignSelf: 'center', marginBottom: 12 },
  sheetTitle: { color: theme.colors.brand, fontSize: 15, fontWeight: '500' },
  action: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.colors.divider },
  actionText: { color: theme.colors.brand, fontSize: 15 },
  actionSub: { color: theme.colors.muted, fontSize: 11, marginTop: 2 },
  renameInput: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, color: theme.colors.brand, fontSize: 14, backgroundColor: theme.colors.surface },
  sheetCancel: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border },
  sheetCancelText: { color: theme.colors.brand, fontSize: 14 },
  sheetPrimary: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: theme.colors.brand },
  sheetPrimaryText: { color: '#fff', fontSize: 14, fontWeight: '500' },
});
