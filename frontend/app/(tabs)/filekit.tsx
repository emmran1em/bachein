import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Platform, Modal, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { theme } from '@/src/theme';
import { api, fileToolUpload } from '@/src/api';

type Tool = 'menu' | 'image-compress' | 'pdf-compress' | 'convert' | 'downloads';

type DlItem = { filename: string; ts: string; original?: number; compressed?: number; localPath?: string; contentType: string };

export default function FileKit() {
  const [tool, setTool] = useState<Tool>('menu');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [picked, setPicked] = useState<{ uri: string; name: string; type: string } | null>(null);
  const [formats, setFormats] = useState<{ inputs: string[]; outputs: string[] }>({ inputs: [], outputs: [] });
  const [target, setTarget] = useState<string>('pdf');
  const [detected, setDetected] = useState<string>('');
  const [err, setErr] = useState('');
  const [showTargetMenu, setShowTargetMenu] = useState(false);
  const [quality, setQuality] = useState(25);
  const [showMenu, setShowMenu] = useState(false);
  const [password, setPassword] = useState('');
  const [downloads, setDownloads] = useState<DlItem[]>([]);

  useEffect(() => {
    api.fileFormats().then((f: any) => setFormats(f)).catch(() => {});
    AsyncStorage.getItem('bachein_downloads').then((raw) => { if (raw) setDownloads(JSON.parse(raw)); });
  }, []);

  const saveDownloadRecord = async (item: DlItem) => {
    const next = [item, ...downloads].slice(0, 50);
    setDownloads(next);
    await AsyncStorage.setItem('bachein_downloads', JSON.stringify(next));
  };

  const readableError = (e: any): string => {
    if (!e) return 'Unknown error';
    if (typeof e === 'string') return e;
    if (e.message) return typeof e.message === 'string' ? e.message : JSON.stringify(e.message);
    try { return JSON.stringify(e); } catch { return String(e); }
  };

  const pick = async (tool: Tool) => {
    setErr(''); setResult(null); setPicked(null);
    setDetected('');
    const types = tool === 'image-compress' ? ['image/*'] : (tool === 'pdf-compress' || tool === 'protect' || tool === 'unlock') ? ['application/pdf'] : ['*/*'];
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: types, copyToCacheDirectory: true });
      if (res.canceled) return;
      const asset = res.assets[0];
      // Force mime detection when picker returns null
      let mimeType = asset.mimeType;
      if (!mimeType || mimeType === 'application/octet-stream') {
        const ext = (asset.name || '').split('.').pop()?.toLowerCase() || '';
        const map: Record<string, string> = {
          jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
          pdf: 'application/pdf',
          docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          txt: 'text/plain', md: 'text/plain',
        };
        mimeType = map[ext] || 'application/octet-stream';
      }
      setPicked({ uri: asset.uri, name: asset.name, type: mimeType });
      if (tool === 'convert') {
        const ext = (asset.name.split('.').pop() || '').toLowerCase();
        setDetected(ext);
        setTarget(ext === 'pdf' ? 'docx' : 'pdf');
      }
    } catch (e: any) { setErr(readableError(e)); }
  };

  const run = async () => {
    if (!picked) return;
    setBusy(true); setErr(''); setResult(null);
    try {
      let out;
      if (tool === 'image-compress') {
        out = await fileToolUpload('/file-tools/compress-image', picked, { quality: String(quality) });
      } else if (tool === 'pdf-compress') {
        out = await fileToolUpload('/file-tools/compress-pdf', picked, {});
      } else if (tool === 'protect' || tool === 'unlock') {
        if (!password.trim()) { setErr('Enter a password first'); setBusy(false); return; }
        out = await fileToolUpload(`/file-tools/${tool}`, picked, { password: password.trim() });
      } else {
        out = await fileToolUpload('/file-tools/convert', picked, { target });
      }
      setResult(out);
    } catch (e: any) {
      setErr(readableError(e));
    } finally { setBusy(false); }
  };

  const download = async () => {
    if (!result) return;
    setErr('');
    try {
      if (Platform.OS === 'web') {
        const a = document.createElement('a');
        a.href = result.blobUri;
        a.download = result.filename;
        a.click();
        await saveDownloadRecord({
          filename: result.filename, ts: new Date().toISOString(),
          original: result.headers.original ? parseInt(result.headers.original) : undefined,
          compressed: result.headers.compressed ? parseInt(result.headers.compressed) : undefined,
          contentType: result.contentType,
        });
      } else {
        const base64 = (result.base64 || result.blobUri || '').split(',').pop() || '';
        const dirUri = `${FileSystem.documentDirectory}Downloads/`;
        await FileSystem.makeDirectoryAsync(dirUri, { intermediates: true }).catch(() => {});
        const localPath = `${dirUri}${result.filename}`;
        await FileSystem.writeAsStringAsync(localPath, base64, { encoding: 'base64' as any });
        await saveDownloadRecord({
          filename: result.filename, ts: new Date().toISOString(),
          original: result.headers.original ? parseInt(result.headers.original) : undefined,
          compressed: result.headers.compressed ? parseInt(result.headers.compressed) : undefined,
          localPath,
          contentType: result.contentType,
        });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(localPath, { mimeType: result.contentType, dialogTitle: 'Save or share' });
        }
      }
    } catch (e: any) {
      setErr('Download failed: ' + readableError(e));
    }
  };

  const openLocal = async (item: DlItem) => {
    if (!item.localPath) { setErr('File not available on device'); return; }
    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(item.localPath, { mimeType: item.contentType });
      }
    } catch (e: any) { setErr(readableError(e)); }
  };

  const openMenu = () => setShowMenu(true);
  const closeMenu = () => setShowMenu(false);

  if (tool === 'menu') {
    return (
      <SafeAreaView style={s.container} edges={['top']} testID="filekit-screen">
        <View style={s.headerBar}>
          <Pressable testID="menu-btn" onPress={openMenu} style={s.iconBtn}>
            <Ionicons name="ellipsis-vertical" size={20} color={theme.colors.brand} />
          </Pressable>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={s.title}>File Kit</Text>
            <Text style={s.subtitle}>Compress, convert and transform files.</Text>
          </View>
        </View>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 200 }}>
          <Pressable testID="tool-image-compress" style={s.toolCard} onPress={() => setTool('image-compress')}>
            <View style={[s.iconBox, { backgroundColor: '#FBE6DC' }]}><Ionicons name="image" size={22} color={theme.colors.brandSecondary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.toolTitle}>Image Compressor</Text>
              <Text style={s.toolDesc}>Reduce JPG / PNG / WEBP up to 90%</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} />
          </Pressable>
          <Pressable testID="tool-pdf-compress" style={s.toolCard} onPress={() => setTool('pdf-compress')}>
            <View style={[s.iconBox, { backgroundColor: '#EAF3EE' }]}><Ionicons name="document" size={22} color={theme.colors.success} /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.toolTitle}>PDF Compressor</Text>
              <Text style={s.toolDesc}>Optimize PDF streams to shrink file size</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} />
          </Pressable>
          <Pressable testID="tool-convert" style={s.toolCard} onPress={() => setTool('convert')}>
            <View style={[s.iconBox, { backgroundColor: '#F0F0EE' }]}><Ionicons name="swap-horizontal" size={22} color={theme.colors.brand} /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.toolTitle}>Document Converter</Text>
              <Text style={s.toolDesc}>PDF, DOCX, XLSX, PPTX, images — any format</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} />
          </Pressable>
          <Pressable testID="tool-protect" style={s.toolCard} onPress={() => { setPassword(''); setTool('protect'); }}>
            <View style={[s.iconBox, { backgroundColor: '#E8ECF7' }]}><Ionicons name="lock-closed" size={22} color="#3b5bdb" /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.toolTitle}>Protect Document</Text>
              <Text style={s.toolDesc}>Password-protect any PDF (AES-256)</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} />
          </Pressable>
          <Pressable testID="tool-unlock" style={s.toolCard} onPress={() => { setPassword(''); setTool('unlock'); }}>
            <View style={[s.iconBox, { backgroundColor: '#FFF4E0' }]}><Ionicons name="lock-open" size={22} color="#d97706" /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.toolTitle}>Unlock Document</Text>
              <Text style={s.toolDesc}>Remove a PDF password (with the password)</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} />
          </Pressable>
        </ScrollView>

        <Modal visible={showMenu} transparent animationType="fade" onRequestClose={closeMenu}>
          <Pressable style={s.modalOverlay} onPress={closeMenu} testID="menu-overlay">
            <View style={s.menuSheet}>
              <Pressable testID="menu-downloads" style={s.menuItem} onPress={() => { closeMenu(); setTool('downloads'); }}>
                <Ionicons name="cloud-download-outline" size={18} color={theme.colors.brand} />
                <Text style={s.menuText}>Downloads ({downloads.length})</Text>
              </Pressable>
              <Pressable testID="menu-clear" style={s.menuItem} onPress={async () => { closeMenu(); await AsyncStorage.removeItem('bachein_downloads'); setDownloads([]); }}>
                <Ionicons name="trash-outline" size={18} color={theme.colors.error} />
                <Text style={[s.menuText, { color: theme.colors.error }]}>Clear history</Text>
              </Pressable>
            </View>
          </Pressable>
        </Modal>
      </SafeAreaView>
    );
  }

  if (tool === 'downloads') {
    return (
      <SafeAreaView style={s.container} edges={['top']} testID="downloads-screen">
        <View style={s.headerRow}>
          <Pressable testID="back-button" onPress={() => setTool('menu')} style={s.closeBtn}>
            <Ionicons name="chevron-back" size={22} color={theme.colors.brand} />
          </Pressable>
          <Text style={s.headerTitle}>Downloads</Text>
        </View>
        {downloads.length === 0 ? (
          <View style={s.empty}>
            <Ionicons name="cloud-offline-outline" size={40} color={theme.colors.muted} />
            <Text style={s.emptyTitle}>No downloads yet</Text>
            <Text style={s.emptySub}>Compressed and converted files will appear here.</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 200 }}>
            {downloads.map((d, i) => (
              <Pressable key={i} testID={`dl-${i}`} style={s.dlRow} onPress={() => openLocal(d)}>
                <Ionicons name="document" size={20} color={theme.colors.brand} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={s.dlName} numberOfLines={1}>{d.filename}</Text>
                  <Text style={s.dlMeta}>
                    {new Date(d.ts).toLocaleString()}
                    {d.compressed ? ` • ${Math.round(d.compressed / 1024)} KB` : ''}
                  </Text>
                </View>
                {d.localPath && <Ionicons name="share-outline" size={18} color={theme.colors.muted} />}
              </Pressable>
            ))}
          </ScrollView>
        )}
      </SafeAreaView>
    );
  }

  const titleMap: Record<Tool, string> = {
    'menu': '', 'downloads': 'Downloads',
    'image-compress': 'Image Compressor',
    'pdf-compress': 'PDF Compressor',
    'convert': 'Document Converter',
    'protect': 'Protect Document',
    'unlock': 'Unlock Document',
  };

  return (
    <SafeAreaView style={s.container} edges={['top']} testID={`filekit-${tool}-screen`}>
      <View style={s.headerRow}>
        <Pressable testID="back-button" onPress={() => { setTool('menu'); setPicked(null); setResult(null); setErr(''); }} style={s.closeBtn}>
          <Ionicons name="chevron-back" size={22} color={theme.colors.brand} />
        </Pressable>
        <Text style={s.headerTitle}>{titleMap[tool]}</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 200 }}>
        <Pressable testID="pick-file-btn" onPress={() => pick(tool)} style={s.dropZone}>
          <Ionicons name={picked ? 'document-attach' : 'cloud-upload-outline'} size={32} color={theme.colors.brand} />
          <Text style={s.dropTitle}>{picked ? picked.name : 'Tap to choose a file'}</Text>
          {!picked && <Text style={s.dropSub}>Any size · any type</Text>}
        </Pressable>
        {(tool === 'protect' || tool === 'unlock') && (
          <View style={{ marginTop: 14 }}>
            <Text style={s.dropSub}>{tool === 'protect' ? 'SET A PASSWORD (AES-256)' : 'ENTER THE PDF PASSWORD'}</Text>
            <TextInput
              testID="pdf-password-input"
              style={{ marginTop: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, color: theme.colors.brand, fontSize: 14 }}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="Password"
              placeholderTextColor={theme.colors.muted}
            />
          </View>
        )}

        {tool === 'image-compress' && picked && (
          <View style={{ marginTop: 20 }}>
            <Text style={s.fromLabel}>COMPRESSION LEVEL</Text>
            <View style={s.qualityRow}>
              {[
                { label: 'Extreme', q: 10, hint: '~90% smaller' },
                { label: 'Strong', q: 25, hint: '~80% smaller' },
                { label: 'Balanced', q: 50, hint: '~60% smaller' },
                { label: 'Light', q: 75, hint: '~30% smaller' },
              ].map((opt) => (
                <Pressable key={opt.q} testID={`quality-${opt.q}`} onPress={() => setQuality(opt.q)} style={[s.qBtn, quality === opt.q && s.qBtnActive]}>
                  <Text style={[s.qBtnLabel, quality === opt.q && s.qBtnLabelActive]}>{opt.label}</Text>
                  <Text style={[s.qBtnHint, quality === opt.q && { color: theme.colors.onBrandPrimary }]}>{opt.hint}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {tool === 'convert' && picked && (
          <View style={{ marginTop: 24 }}>
            <View style={s.formatRow}>
              <View style={s.fromBox}>
                <Text style={s.fromLabel}>FROM</Text>
                <Text style={s.fromValue}>.{detected || '?'}</Text>
              </View>
              <Ionicons name="arrow-forward" size={20} color={theme.colors.muted} />
              <Pressable testID="target-dropdown" style={s.toBox} onPress={() => setShowTargetMenu(!showTargetMenu)}>
                <Text style={s.fromLabel}>TO</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Text style={s.fromValue}>.{target}</Text>
                  <Ionicons name="chevron-down" size={14} color={theme.colors.brand} />
                </View>
              </Pressable>
            </View>
            {showTargetMenu && (
              <View style={s.dropdown}>
                {formats.outputs.map(out => (
                  <Pressable key={out} testID={`target-${out}`} style={s.dropOpt} onPress={() => { setTarget(out); setShowTargetMenu(false); }}>
                    <Text style={[s.dropOptText, target === out && { fontWeight: '500', color: theme.colors.brand }]}>.{out}</Text>
                    {target === out && <Ionicons name="checkmark" size={16} color={theme.colors.brand} />}
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        )}

        {err ? <Text style={s.err} testID="filekit-err">{err}</Text> : null}

        {picked && !result && (
          <Pressable testID="run-btn" style={[s.primaryBtn, busy && { opacity: 0.6 }]} onPress={run} disabled={busy}>
            {busy ? <ActivityIndicator color={theme.colors.onBrandPrimary} /> : (
              <><Ionicons name="flash" size={16} color={theme.colors.onBrandPrimary} /><Text style={s.primaryBtnText}>{tool === 'convert' ? 'Convert' : 'Compress'}</Text></>
            )}
          </Pressable>
        )}

        {result && (
          <View style={s.resultCard} testID="result-card">
            <Ionicons name="checkmark-circle" size={40} color={theme.colors.success} />
            <Text style={s.resultTitle}>Ready!</Text>
            <Text style={s.resultName}>{result.filename}</Text>
            {result.headers.original && result.headers.compressed && (
              <Text style={s.resultStat}>
                {Math.round(parseInt(result.headers.original) / 1024)}KB → {Math.round(parseInt(result.headers.compressed) / 1024)}KB
                {'  '}({Math.round((1 - parseInt(result.headers.compressed) / parseInt(result.headers.original)) * 100)}% smaller)
              </Text>
            )}
            <Pressable testID="download-btn" style={s.dlBtn} onPress={download}>
              <Ionicons name="download-outline" size={18} color={theme.colors.onBrandPrimary} />
              <Text style={s.dlBtnText}>Download</Text>
            </Pressable>
            <Pressable testID="do-another-btn" style={s.againBtn} onPress={() => { setResult(null); setPicked(null); setErr(''); }}>
              <Text style={s.againBtnText}>Do another</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.surface },
  headerBar: { flexDirection: 'row', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8, alignItems: 'center' },
  iconBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 26, color: theme.colors.brand, fontWeight: '500', letterSpacing: -0.5 },
  subtitle: { color: theme.colors.muted, marginTop: 2, fontSize: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 8 },
  closeBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border },
  headerTitle: { fontSize: 18, color: theme.colors.brand, fontWeight: '500' },
  toolCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#fff', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: theme.colors.border, marginBottom: 10 },
  iconBox: { width: 46, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  toolTitle: { color: theme.colors.brand, fontWeight: '500', fontSize: 15 },
  toolDesc: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  dropZone: { backgroundColor: '#fff', borderRadius: 18, borderWidth: 2, borderColor: theme.colors.border, borderStyle: 'dashed', padding: 32, alignItems: 'center', gap: 8 },
  dropTitle: { color: theme.colors.brand, fontWeight: '500', fontSize: 15, marginTop: 8 },
  dropSub: { color: theme.colors.muted, fontSize: 12 },
  formatRow: { flexDirection: 'row', alignItems: 'center', gap: 12, justifyContent: 'space-between' },
  fromBox: { flex: 1, backgroundColor: theme.colors.surfaceSecondary, padding: 14, borderRadius: 12 },
  toBox: { flex: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.brand, padding: 14, borderRadius: 12 },
  fromLabel: { color: theme.colors.muted, fontSize: 10, letterSpacing: 1 },
  fromValue: { color: theme.colors.brand, fontWeight: '500', fontSize: 18, marginTop: 4 },
  dropdown: { backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, marginTop: 8, padding: 4 },
  dropOpt: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10 },
  dropOptText: { color: theme.colors.onSurfaceSecondary, fontSize: 14 },
  primaryBtn: { flexDirection: 'row', gap: 8, marginTop: 20, backgroundColor: theme.colors.brand, padding: 16, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: theme.colors.onBrandPrimary, fontWeight: '500', fontSize: 15 },
  resultCard: { backgroundColor: '#fff', borderRadius: 18, padding: 24, alignItems: 'center', marginTop: 24, borderWidth: 1, borderColor: theme.colors.border },
  resultTitle: { color: theme.colors.brand, fontSize: 22, fontWeight: '500', marginTop: 8 },
  resultName: { color: theme.colors.muted, fontSize: 13, marginTop: 4 },
  resultStat: { color: theme.colors.success, fontSize: 13, marginTop: 8 },
  dlBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: theme.colors.brand, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 999, marginTop: 16 },
  dlBtnText: { color: theme.colors.onBrandPrimary, fontWeight: '500', fontSize: 15 },
  againBtn: { marginTop: 10, paddingHorizontal: 16, paddingVertical: 8 },
  againBtnText: { color: theme.colors.muted, fontSize: 13 },
  err: { color: theme.colors.error, marginTop: 12, backgroundColor: '#FDECEA', padding: 12, borderRadius: 10 },
  qualityRow: { flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' },
  qBtn: { flex: 1, minWidth: '22%', paddingVertical: 12, paddingHorizontal: 6, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: '#fff', alignItems: 'center' },
  qBtnActive: { backgroundColor: theme.colors.brand, borderColor: theme.colors.brand },
  qBtnLabel: { color: theme.colors.brand, fontSize: 12, fontWeight: '500' },
  qBtnLabelActive: { color: theme.colors.onBrandPrimary },
  qBtnHint: { color: theme.colors.muted, fontSize: 10, marginTop: 2 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-start', alignItems: 'flex-start', paddingTop: 90, paddingLeft: 16 },
  menuSheet: { backgroundColor: '#fff', borderRadius: 16, minWidth: 220, borderWidth: 1, borderColor: theme.colors.border, padding: 4, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10 },
  menuText: { color: theme.colors.brand, fontSize: 14, fontWeight: '500' },
  empty: { alignItems: 'center', marginTop: 80, paddingHorizontal: 40 },
  emptyTitle: { color: theme.colors.brand, fontSize: 16, fontWeight: '500', marginTop: 14 },
  emptySub: { color: theme.colors.muted, textAlign: 'center', marginTop: 6, fontSize: 12 },
  dlRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, marginBottom: 8 },
  dlName: { color: theme.colors.brand, fontWeight: '500', fontSize: 14 },
  dlMeta: { color: theme.colors.muted, fontSize: 11, marginTop: 2 },
});
