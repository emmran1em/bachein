import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Image, ScrollView, ActivityIndicator, TextInput, Modal, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { theme } from '@/src/theme';
import { api } from '@/src/api';

/** Phase 11 — Document Scanner: capture → edge detect → perspective correct → multi-page PDF */
export default function ScannerScreen() {
  const router = useRouter();
  const camRef = useRef<CameraView | null>(null);
  const [perm, requestPerm] = useCameraPermissions();
  const [ready, setReady] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [preview, setPreview] = useState<string | null>(null); // corrected page awaiting confirm
  const [foundDoc, setFoundDoc] = useState(false);
  const [pages, setPages] = useState<string[]>([]);
  const [mode, setMode] = useState<'color' | 'bw'>('color');
  const [nameOpen, setNameOpen] = useState(false);
  const [docName, setDocName] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const capture = async () => {
    if (!camRef.current || processing) return;
    setErr('');
    setProcessing(true);
    try {
      const shot = await camRef.current.takePictureAsync({ quality: 0.7, base64: true, skipProcessing: true });
      if (!shot?.base64) throw new Error('Capture failed');
      const r: any = await api.scannerProcess(shot.base64, mode);
      setPreview(r.image_base64);
      setFoundDoc(!!r.found_document);
    } catch (e: any) { setErr(e.message || 'Scan failed'); }
    finally { setProcessing(false); }
  };

  const addPage = () => {
    if (preview) setPages((p) => [...p, preview]);
    setPreview(null);
  };

  const finish = async () => {
    const all = preview ? [...pages, preview] : pages;
    if (!all.length) return;
    setSaving(true);
    try {
      const r: any = await api.scannerCreatePdf(all, docName.trim() || undefined);
      setNameOpen(false);
      setPages([]); setPreview(null);
      router.replace({ pathname: '/viewer', params: { url: api.downloadFileUrl(r.download_id), name: r.name } });
    } catch (e: any) { setErr(e.message || 'Could not create PDF'); }
    finally { setSaving(false); }
  };

  if (!perm?.granted) {
    return (
      <SafeAreaView style={s.container} edges={['top']} testID="scanner-screen">
        <Header router={router} pages={0} />
        <View style={s.permBox}>
          <Ionicons name="scan-outline" size={44} color={theme.colors.borderStrong} />
          <Text style={s.permTitle}>Scan documents with your camera</Text>
          <Text style={s.permSub}>Bachein straightens the page, fixes perspective and saves a clean PDF — like a real scanner.</Text>
          {perm?.canAskAgain !== false ? (
            <Pressable style={s.primaryBtn} onPress={requestPerm} testID="scanner-grant">
              <Ionicons name="camera-outline" size={16} color="#fff" />
              <Text style={s.primaryText}>Allow camera</Text>
            </Pressable>
          ) : (
            <Pressable style={s.primaryBtn} onPress={() => Linking.openSettings()} testID="scanner-settings">
              <Ionicons name="settings-outline" size={16} color="#fff" />
              <Text style={s.primaryText}>Open Settings</Text>
            </Pressable>
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container} edges={['top']} testID="scanner-screen">
      <Header router={router} pages={pages.length} />
      <View style={s.camWrap}>
        {preview ? (
          <Image source={{ uri: `data:image/jpeg;base64,${preview}` }} style={{ flex: 1 }} resizeMode="contain" />
        ) : (
          <CameraView ref={(r) => { camRef.current = r; }} style={{ flex: 1 }} facing="back" animateShutter={false} onCameraReady={() => setReady(true)} />
        )}
        {processing && (
          <View style={s.busyOverlay}>
            <ActivityIndicator color="#fff" />
            <Text style={s.busyText}>Detecting edges & straightening…</Text>
          </View>
        )}
        {preview && (
          <View style={[s.foundPill, { backgroundColor: foundDoc ? 'rgba(22,163,74,0.85)' : 'rgba(0,0,0,0.55)' }]}>
            <Ionicons name={foundDoc ? 'checkmark-circle' : 'information-circle-outline'} size={13} color="#fff" />
            <Text style={s.foundText}>{foundDoc ? 'Document detected & straightened' : 'Full frame kept (no page edges found)'}</Text>
          </View>
        )}
      </View>

      {!!err && <Text style={s.err}>{err}</Text>}

      {pages.length > 0 && !preview && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 74 }} contentContainerStyle={{ gap: 6, paddingHorizontal: 14 }}>
          {pages.map((p, i) => (
            <View key={i} style={s.thumbWrap}>
              <Image source={{ uri: `data:image/jpeg;base64,${p}` }} style={s.thumb} />
              <Pressable style={s.thumbX} onPress={() => setPages((arr) => arr.filter((_, j) => j !== i))}>
                <Ionicons name="close" size={11} color="#fff" />
              </Pressable>
              <Text style={s.thumbNo}>{i + 1}</Text>
            </View>
          ))}
        </ScrollView>
      )}

      <View style={s.controls}>
        {preview ? (
          <>
            <Pressable style={s.secondaryBtn} onPress={() => setPreview(null)} testID="scan-retake">
              <Ionicons name="refresh" size={15} color={theme.colors.brand} />
              <Text style={s.secondaryText}>Retake</Text>
            </Pressable>
            <Pressable style={s.primaryBtn} onPress={addPage} testID="scan-add-page">
              <Ionicons name="add" size={16} color="#fff" />
              <Text style={s.primaryText}>Add page</Text>
            </Pressable>
            <Pressable style={s.primaryBtn} onPress={() => setNameOpen(true)} testID="scan-done">
              <Ionicons name="checkmark" size={16} color="#fff" />
              <Text style={s.primaryText}>Done{pages.length ? ` (${pages.length + 1})` : ''}</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Pressable style={s.modeBtn} onPress={() => setMode(mode === 'color' ? 'bw' : 'color')} testID="scan-mode">
              <Ionicons name={mode === 'color' ? 'color-palette-outline' : 'contrast-outline'} size={16} color={theme.colors.brand} />
              <Text style={s.secondaryText}>{mode === 'color' ? 'Color' : 'B&W'}</Text>
            </Pressable>
            <Pressable style={[s.shutter, (!ready || processing) && { opacity: 0.5 }]} disabled={!ready || processing} onPress={capture} testID="scan-capture">
              <View style={s.shutterInner} />
            </Pressable>
            {pages.length > 0 ? (
              <Pressable style={s.modeBtn} onPress={() => setNameOpen(true)} testID="scan-finish">
                <Ionicons name="checkmark-done" size={16} color={theme.colors.brand} />
                <Text style={s.secondaryText}>Finish ({pages.length})</Text>
              </Pressable>
            ) : <View style={{ width: 84 }} />}
          </>
        )}
      </View>

      <Modal visible={nameOpen} transparent animationType="fade" onRequestClose={() => setNameOpen(false)}>
        <View style={s.modalOverlay}>
          <View style={s.sheet}>
            <Text style={s.sheetTitle}>Save scan as PDF</Text>
            <TextInput
              testID="scan-name-input"
              style={s.input}
              value={docName}
              onChangeText={setDocName}
              placeholder="Document name (optional)"
              placeholderTextColor={theme.colors.muted}
            />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
              <Pressable style={s.secondaryBtn} onPress={() => setNameOpen(false)}>
                <Text style={s.secondaryText}>Cancel</Text>
              </Pressable>
              <Pressable style={[s.primaryBtn, { flex: 1 }, saving && { opacity: 0.6 }]} disabled={saving} onPress={finish} testID="scan-save">
                {saving ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="download-outline" size={16} color="#fff" />}
                <Text style={s.primaryText}>{saving ? 'Saving…' : 'Save to Downloads'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Header({ router, pages }: any) {
  return (
    <View style={s.header}>
      <Pressable onPress={() => router.back()} style={s.iconBtn} testID="scanner-back">
        <Ionicons name="chevron-back" size={22} color={theme.colors.brand} />
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={s.title}>Document Scanner</Text>
        <Text style={s.subtitle}>{pages > 0 ? `${pages} page${pages > 1 ? 's' : ''} captured` : 'Edge detection · perspective fix · PDF'}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 8 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center' },
  title: { color: theme.colors.brand, fontSize: 17, fontWeight: '500' },
  subtitle: { color: theme.colors.muted, fontSize: 11, marginTop: 1 },
  camWrap: { flex: 1, margin: 14, borderRadius: 18, overflow: 'hidden', backgroundColor: '#111' },
  busyOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,0.35)' },
  busyText: { color: '#fff', fontSize: 12 },
  foundPill: { position: 'absolute', top: 12, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  foundText: { color: '#fff', fontSize: 11, fontWeight: '500' },
  err: { color: theme.colors.error, textAlign: 'center', fontSize: 12, paddingHorizontal: 20 },
  thumbWrap: { position: 'relative' },
  thumb: { width: 50, height: 66, borderRadius: 6, borderWidth: 1, borderColor: theme.colors.border },
  thumbX: { position: 'absolute', top: -4, right: -4, width: 17, height: 17, borderRadius: 9, backgroundColor: '#d64545', alignItems: 'center', justifyContent: 'center' },
  thumbNo: { position: 'absolute', bottom: 2, left: 4, color: '#fff', fontSize: 9, fontWeight: '700', textShadowColor: '#000', textShadowRadius: 3 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: 16, paddingBottom: 22 },
  shutter: { width: 68, height: 68, borderRadius: 34, backgroundColor: '#fff', borderWidth: 3, borderColor: theme.colors.brand, alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 54, height: 54, borderRadius: 27, backgroundColor: theme.colors.brand },
  modeBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: '#fff', minWidth: 84, justifyContent: 'center' },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: '#fff', justifyContent: 'center' },
  secondaryText: { color: theme.colors.brand, fontWeight: '500', fontSize: 13 },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, backgroundColor: theme.colors.brand, justifyContent: 'center' },
  primaryText: { color: '#fff', fontWeight: '500', fontSize: 13 },
  permBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  permTitle: { color: theme.colors.brand, fontSize: 17, fontWeight: '500', textAlign: 'center' },
  permSub: { color: theme.colors.muted, fontSize: 12.5, textAlign: 'center', lineHeight: 18, marginBottom: 8 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  sheet: { backgroundColor: '#fff', borderRadius: 18, padding: 20, alignSelf: 'stretch' },
  sheetTitle: { color: theme.colors.brand, fontSize: 16, fontWeight: '500', marginBottom: 12 },
  input: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, color: theme.colors.brand, fontSize: 14, backgroundColor: theme.colors.surface },
});
