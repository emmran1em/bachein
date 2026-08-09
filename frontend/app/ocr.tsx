import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Platform, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { theme } from '@/src/theme';
import { api } from '@/src/api';
import AskBachein from '@/src/components/AskBachein';

/** Dedicated OCR tool — modular engine behind /api/ocr/extract */
export default function OcrScreen() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [fileName, setFileName] = useState('');
  const [err, setErr] = useState('');
  const [askOpen, setAskOpen] = useState(false);
  const [opening, setOpening] = useState(false);

  const pick = async () => {
    setErr('');
    try {
      const r = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
        copyToCacheDirectory: true,
      });
      if (r.canceled || !r.assets?.length) return;
      const a = r.assets[0];
      setBusy(true); setResult(null); setFileName(a.name || 'document');
      let base64 = '';
      if (Platform.OS === 'web') {
        const blob = await (await fetch(a.uri)).blob();
        base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } else {
        base64 = await FileSystem.readAsStringAsync(a.uri, { encoding: 'base64' as any });
      }
      const res: any = await api.ocrExtract({ file_base64: base64, filename: a.name || 'document.pdf' });
      setResult(res);
    } catch (e: any) { setErr(e.message || 'OCR failed'); }
    finally { setBusy(false); }
  };

  const openInEditor = async () => {
    if (!result?.html) return;
    setOpening(true);
    try {
      const saved: any = await api.editorSave({ title: fileName.replace(/\.[^.]+$/, '') || 'OCR document', doc_type: 'Other', html: result.html });
      router.push({ pathname: '/editor', params: { id: saved.id || saved.doc_id || '' } });
    } catch (e: any) { setErr(e.message); }
    setOpening(false);
  };

  const plain = result?.text || '';

  return (
    <SafeAreaView style={s.container} edges={['top']} testID="ocr-screen">
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.iconBtn} testID="ocr-back">
          <Ionicons name="chevron-back" size={22} color={theme.colors.brand} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>OCR</Text>
          <Text style={s.subtitle}>Scanned docs & photos → editable, structured text</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
        {!result && (
          <>
            <Pressable testID="ocr-pick" style={[s.dropZone, busy && { opacity: 0.6 }]} disabled={busy} onPress={pick}>
              {busy ? <ActivityIndicator color={theme.colors.brand} /> : <Ionicons name="scan-outline" size={32} color={theme.colors.muted} />}
              <Text style={s.dropTitle}>{busy ? `Reading ${fileName}…` : 'Upload PDF, scan or photo'}</Text>
              <Text style={s.dropSub}>{busy ? 'Advanced document parsing — can take a minute' : 'PDF · JPG · PNG · DOCX (up to 6 pages per run)'}</Text>
            </Pressable>
            <Pressable testID="ocr-scan-camera" style={s.scanBtn} onPress={() => router.push('/scanner')}>
              <Ionicons name="camera-outline" size={16} color={theme.colors.brand} />
              <Text style={s.scanText}>Or scan with camera first (auto edge-detection)</Text>
            </Pressable>
            {!!err && <Text style={s.err}>{err}</Text>}
            <View style={s.pipeline}>
              <Text style={s.pipelineTitle}>PIPELINE</Text>
              <Text style={s.pipelineText}>Upload → document detection → perspective & deskew → enhancement → OCR parsing → validation (uncertain text flagged ⚠) → AI understanding</Text>
            </View>
          </>
        )}
        {result && (
          <View>
            <View style={s.resultHead}>
              <Text style={s.resultTitle}>{fileName}</Text>
              <Text style={s.resultMeta}>
                {result.pages} page{result.pages > 1 ? 's' : ''} · engine: {result.engine}
                {result.warnings > 0 ? ` · ⚠ ${result.warnings} uncertain token${result.warnings > 1 ? 's' : ''} flagged` : ' · clean read ✓'}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <Pressable testID="ocr-new" style={s.secondaryBtn} onPress={() => setResult(null)}>
                <Ionicons name="add-circle-outline" size={14} color={theme.colors.brand} />
                <Text style={s.secondaryText}>New</Text>
              </Pressable>
              <Pressable testID="ocr-open-editor" style={s.primaryBtn} onPress={openInEditor} disabled={opening}>
                {opening ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="create-outline" size={15} color="#fff" />}
                <Text style={s.primaryText}>Edit in Write</Text>
              </Pressable>
              <Pressable testID="ocr-ask-ai" style={s.secondaryBtn} onPress={() => setAskOpen(true)}>
                <Ionicons name="sparkles-outline" size={14} color={theme.colors.brand} />
                <Text style={s.secondaryText}>Ask AI</Text>
              </Pressable>
            </View>
            <View style={s.textCard}>
              <Text style={s.extracted}>{plain.slice(0, 12000) || '(no text found)'}</Text>
            </View>
          </View>
        )}
      </ScrollView>
      <AskBachein visible={askOpen} onClose={() => setAskOpen(false)} context={plain.slice(0, 4000)} />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center' },
  title: { color: theme.colors.brand, fontSize: 18, fontWeight: '500' },
  subtitle: { color: theme.colors.muted, fontSize: 11, marginTop: 2 },
  dropZone: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: theme.colors.borderStrong, borderRadius: 16, paddingVertical: 40, alignItems: 'center', gap: 6, backgroundColor: '#fff' },
  dropTitle: { color: theme.colors.brand, fontSize: 14, fontWeight: '500', paddingHorizontal: 20, textAlign: 'center' },
  dropSub: { color: theme.colors.muted, fontSize: 11, textAlign: 'center' },
  scanBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 12, padding: 13, borderRadius: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border },
  scanText: { color: theme.colors.brand, fontSize: 12.5, fontWeight: '500' },
  err: { color: theme.colors.error, marginTop: 12, fontSize: 12 },
  pipeline: { marginTop: 22, backgroundColor: theme.colors.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: theme.colors.border },
  pipelineTitle: { color: theme.colors.muted, fontSize: 10, letterSpacing: 1, marginBottom: 6 },
  pipelineText: { color: theme.colors.onSurfaceSecondary, fontSize: 12, lineHeight: 18 },
  resultHead: {},
  resultTitle: { color: theme.colors.brand, fontSize: 18, fontWeight: '600' },
  resultMeta: { color: theme.colors.muted, fontSize: 11.5, marginTop: 4 },
  primaryBtn: { flexDirection: 'row', gap: 6, alignItems: 'center', paddingVertical: 11, paddingHorizontal: 16, borderRadius: 12, backgroundColor: theme.colors.brand },
  primaryText: { color: '#fff', fontWeight: '500', fontSize: 13 },
  secondaryBtn: { flexDirection: 'row', gap: 6, alignItems: 'center', paddingVertical: 11, paddingHorizontal: 14, borderRadius: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border },
  secondaryText: { color: theme.colors.brand, fontWeight: '500', fontSize: 12.5 },
  textCard: { backgroundColor: '#fff', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: theme.colors.border, marginTop: 14 },
  extracted: { color: theme.colors.brand, fontSize: 13, lineHeight: 20 },
});
