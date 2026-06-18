import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Platform, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { theme } from '@/src/theme';
import { api, fileToolUpload } from '@/src/api';

type Tool = 'menu' | 'image-compress' | 'pdf-compress' | 'convert';

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

  useEffect(() => { api.fileFormats().then((f: any) => setFormats(f)).catch(() => {}); }, []);

  const pick = async (tool: Tool) => {
    setErr(''); setResult(null); setPicked(null);
    setDetected('');
    const types = tool === 'image-compress' ? ['image/*'] : tool === 'pdf-compress' ? ['application/pdf'] : ['*/*'];
    const res = await DocumentPicker.getDocumentAsync({ type: types, copyToCacheDirectory: true });
    if (res.canceled) return;
    const asset = res.assets[0];
    setPicked({ uri: asset.uri, name: asset.name, type: asset.mimeType || 'application/octet-stream' });
    if (tool === 'convert') {
      const ext = (asset.name.split('.').pop() || '').toLowerCase();
      setDetected(ext);
      setTarget(ext === 'pdf' ? 'docx' : 'pdf');
    }
  };

  const run = async () => {
    if (!picked) return;
    setBusy(true); setErr(''); setResult(null);
    try {
      let out;
      if (tool === 'image-compress') {
        out = await fileToolUpload('/file-tools/compress-image', picked, { quality: '60' });
      } else if (tool === 'pdf-compress') {
        out = await fileToolUpload('/file-tools/compress-pdf', picked, {});
      } else {
        out = await fileToolUpload('/file-tools/convert', picked, { target });
      }
      setResult(out);
    } catch (e: any) {
      setErr(e.message);
    } finally { setBusy(false); }
  };

  const download = async () => {
    if (!result?.blobUri) return;
    if (Platform.OS === 'web') {
      const a = document.createElement('a');
      a.href = result.blobUri;
      a.download = result.filename;
      a.click();
    } else {
      // On native, blobUri likely empty — we'd need an alternative. For now, alert
      await Linking.openURL(result.blobUri);
    }
  };

  if (tool === 'menu') {
    return (
      <SafeAreaView style={s.container} edges={['top']} testID="filekit-screen">
        <View style={s.header}>
          <Text style={s.title}>File Kit</Text>
          <Text style={s.subtitle}>Compress, convert and transform any document.</Text>
        </View>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 200 }}>
          <Pressable testID="tool-image-compress" style={s.toolCard} onPress={() => setTool('image-compress')}>
            <View style={[s.iconBox, { backgroundColor: '#FBE6DC' }]}><Ionicons name="image" size={22} color={theme.colors.brandSecondary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.toolTitle}>Image Compressor</Text>
              <Text style={s.toolDesc}>Reduce JPG / PNG / WEBP file size up to 80%</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} />
          </Pressable>
          <Pressable testID="tool-pdf-compress" style={s.toolCard} onPress={() => setTool('pdf-compress')}>
            <View style={[s.iconBox, { backgroundColor: '#EAF3EE' }]}><Ionicons name="document" size={22} color={theme.colors.success} /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.toolTitle}>PDF Compressor</Text>
              <Text style={s.toolDesc}>Optimize PDF streams and shrink file size</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} />
          </Pressable>
          <Pressable testID="tool-convert" style={s.toolCard} onPress={() => setTool('convert')}>
            <View style={[s.iconBox, { backgroundColor: '#F0F0EE' }]}><Ionicons name="swap-horizontal" size={22} color={theme.colors.brand} /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.toolTitle}>Document Converter</Text>
              <Text style={s.toolDesc}>PDF, DOCX, XLSX, PPTX, images — convert to any format</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} />
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const titleMap: Record<Tool, string> = {
    'menu': '',
    'image-compress': 'Image Compressor',
    'pdf-compress': 'PDF Compressor',
    'convert': 'Document Converter',
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
          {!picked && <Text style={s.dropSub}>Max 10MB</Text>}
        </Pressable>

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

        {err ? <Text style={s.err}>{err}</Text> : null}

        {picked && (
          <Pressable testID="run-btn" style={[s.primaryBtn, busy && { opacity: 0.6 }]} onPress={run} disabled={busy}>
            {busy ? <ActivityIndicator color={theme.colors.onBrandPrimary} /> : (
              <><Ionicons name="flash" size={16} color={theme.colors.onBrandPrimary} /><Text style={s.primaryBtnText}>{tool === 'convert' ? 'Convert' : 'Compress'}</Text></>
            )}
          </Pressable>
        )}

        {result && (
          <View style={s.resultCard} testID="result-card">
            <Ionicons name="checkmark-circle" size={32} color={theme.colors.success} />
            <Text style={s.resultTitle}>Done!</Text>
            <Text style={s.resultName}>{result.filename}</Text>
            {result.headers.original && result.headers.compressed && (
              <Text style={s.resultStat}>
                {Math.round(parseInt(result.headers.original) / 1024)}KB → {Math.round(parseInt(result.headers.compressed) / 1024)}KB
                ({Math.round((1 - parseInt(result.headers.compressed) / parseInt(result.headers.original)) * 100)}% smaller)
              </Text>
            )}
            <Pressable testID="download-btn" style={s.dlBtn} onPress={download}>
              <Ionicons name="download-outline" size={16} color={theme.colors.onBrandPrimary} />
              <Text style={s.dlBtnText}>Download</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.surface },
  header: { paddingHorizontal: 24, paddingTop: 12 },
  title: { fontSize: 28, color: theme.colors.brand, fontWeight: '500', letterSpacing: -0.5 },
  subtitle: { color: theme.colors.muted, marginTop: 4 },
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
  resultTitle: { color: theme.colors.brand, fontSize: 20, fontWeight: '500', marginTop: 8 },
  resultName: { color: theme.colors.muted, fontSize: 13, marginTop: 4 },
  resultStat: { color: theme.colors.success, fontSize: 12, marginTop: 6 },
  dlBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.colors.brand, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 999, marginTop: 14 },
  dlBtnText: { color: theme.colors.onBrandPrimary, fontWeight: '500' },
  err: { color: theme.colors.error, marginTop: 12 },
});
