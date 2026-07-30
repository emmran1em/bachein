import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { theme } from '@/src/theme';
import { api } from '@/src/api';
import { sharePdf } from '@/src/share';
import BacheinAiLogo from '@/src/components/BacheinAiLogo';
import DotsLoader from '@/src/components/DotsLoader';

const DETAILS = [
  { id: 'concise', label: 'Concise' },
  { id: 'standard', label: 'Standard' },
  { id: 'detailed', label: 'Detailed' },
];

export default function AnswerPaperScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<'upload' | 'paste'>('upload');
  const [file, setFile] = useState<{ name: string; base64: string } | null>(null);
  const [pasted, setPasted] = useState('');
  const [subject, setSubject] = useState('');
  const [classLevel, setClassLevel] = useState('');
  const [board, setBoard] = useState('');
  const [detail, setDetail] = useState('standard');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState('');

  const pickFile = async () => {
    setErr('');
    try {
      const r = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'text/plain', 'image/*'],
        copyToCacheDirectory: true,
      });
      if (r.canceled || !r.assets?.length) return;
      const a = r.assets[0];
      let base64 = '';
      if (Platform.OS === 'web') {
        const fetched = await fetch(a.uri);
        const blob = await fetched.blob();
        base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } else {
        base64 = await FileSystem.readAsStringAsync(a.uri, { encoding: 'base64' as any });
      }
      if (!base64) { setErr('Could not read the file'); return; }
      setFile({ name: a.name || 'paper.pdf', base64 });
    } catch (e: any) { setErr(e.message || 'File pick failed'); }
  };

  const generate = async () => {
    setErr('');
    if (mode === 'upload' && !file) { setErr('Upload a question paper first'); return; }
    if (mode === 'paste' && pasted.trim().length < 10) { setErr('Paste the question paper text first'); return; }
    setBusy(true); setResult(null);
    try {
      const body: any = {
        subject, class_level: classLevel, board, detail, language: 'English',
      };
      if (mode === 'upload' && file) { body.file_base64 = file.base64; body.filename = file.name; }
      else body.text = pasted;
      const r: any = await api.aiwAnswerPaper(body);
      setResult(r);
    } catch (e: any) { setErr(e.message || 'Analysis failed'); }
    finally { setBusy(false); }
  };

  const download = async () => {
    if (!result?.id) return;
    try { await sharePdf(api.aiwAnswerPaperPdfUrl(result.id), 'answer-booklet.pdf'); } catch {}
  };

  const ans = result?.answers;

  return (
    <SafeAreaView style={s.container} edges={['top']} testID="ap-screen">
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.iconBtn} testID="ap-back">
          <Ionicons name="chevron-back" size={22} color={theme.colors.brand} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <BacheinAiLogo size={22} />
            <Text style={s.title}>Topper Answers</Text>
          </View>
          <Text style={s.subtitle}>Upload a paper — get a ruled answer booklet with step-wise marks</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
        {!result && (
          <>
            <View style={s.segment}>
              <Pressable testID="ap-mode-upload" style={[s.segBtn, mode === 'upload' && s.segActive]} onPress={() => setMode('upload')}>
                <Ionicons name="cloud-upload-outline" size={14} color={mode === 'upload' ? '#fff' : theme.colors.brand} />
                <Text style={[s.segText, mode === 'upload' && s.segTextActive]}>Upload</Text>
              </Pressable>
              <Pressable testID="ap-mode-paste" style={[s.segBtn, mode === 'paste' && s.segActive]} onPress={() => setMode('paste')}>
                <Ionicons name="clipboard-outline" size={14} color={mode === 'paste' ? '#fff' : theme.colors.brand} />
                <Text style={[s.segText, mode === 'paste' && s.segTextActive]}>Paste text</Text>
              </Pressable>
            </View>

            {mode === 'upload' ? (
              <Pressable testID="ap-pick-file" style={s.dropZone} onPress={pickFile}>
                <Ionicons name={file ? 'document-text' : 'cloud-upload-outline'} size={30} color={file ? theme.colors.brand : theme.colors.muted} />
                <Text style={s.dropTitle}>{file ? file.name : 'Tap to upload question paper'}</Text>
                <Text style={s.dropSub}>{file ? 'Tap to change' : 'PDF · image · text file'}</Text>
              </Pressable>
            ) : (
              <TextInput
                testID="ap-paste-input"
                style={s.pasteInput}
                value={pasted}
                onChangeText={setPasted}
                placeholder={'Paste the question paper here…\ne.g.\nQ1. (2 marks) Define photosynthesis.'}
                placeholderTextColor={theme.colors.muted}
                multiline
              />
            )}

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>Subject (optional)</Text>
                <TextInput style={s.input} value={subject} onChangeText={setSubject} placeholder="Maths" placeholderTextColor={theme.colors.muted} testID="ap-subject" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>Class (optional)</Text>
                <TextInput style={s.input} value={classLevel} onChangeText={setClassLevel} placeholder="10" placeholderTextColor={theme.colors.muted} testID="ap-class" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>Board (optional)</Text>
                <TextInput style={s.input} value={board} onChangeText={setBoard} placeholder="CBSE" placeholderTextColor={theme.colors.muted} testID="ap-board" />
              </View>
            </View>

            <Text style={s.label}>Answer detail</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {DETAILS.map((d) => (
                <Pressable key={d.id} testID={`ap-detail-${d.id}`} onPress={() => setDetail(d.id)} style={[s.chip, detail === d.id && s.chipActive]}>
                  <Text style={[s.chipText, detail === d.id && s.chipTextActive]}>{d.label}</Text>
                </Pressable>
              ))}
            </View>

            {!!err && <Text style={s.err}>{err}</Text>}
            <Pressable testID="ap-generate" style={[s.primaryBtn, busy && { opacity: 0.6 }]} disabled={busy} onPress={generate}>
              {busy ? <DotsLoader color="#fff" /> : (
                <>
                  <Ionicons name="school-outline" size={16} color="#fff" />
                  <Text style={s.primaryText}>Write Topper Answers</Text>
                </>
              )}
            </Pressable>
            {busy && <Text style={s.busyHint}>Analyzing the paper and writing your booklet — this can take up to a minute…</Text>}
            <Text style={s.disclaimer}>AI can make mistake, please check important info.</Text>
          </>
        )}

        {result && (
          <View>
            <Text style={s.paperTitle}>{ans?.title || 'Answer Booklet'}</Text>
            {!!ans?.total_marks && <Text style={s.paperMeta}>Total: {ans.total_marks} marks · {(ans?.answers || []).length} answers</Text>}
            <View style={s.savedRow}>
              <Ionicons name="checkmark-circle" size={14} color="#16a34a" />
              <Text style={s.savedText}>Saved to your Downloads</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              <Pressable testID="ap-new" style={s.secondaryBtn} onPress={() => { setResult(null); setFile(null); }}>
                <Ionicons name="add-circle-outline" size={14} color={theme.colors.brand} />
                <Text style={s.secondaryText}>New</Text>
              </Pressable>
              <Pressable testID="ap-download" style={s.primaryBtn} onPress={download}>
                <Ionicons name="share-outline" size={16} color="#fff" />
                <Text style={s.primaryText}>Booklet PDF</Text>
              </Pressable>
            </View>

            {(ans?.answers || []).map((a: any, i: number) => (
              <View key={i} style={s.card}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
                  <Text style={s.qNo}>Q{a.q_no}.</Text>
                  {!!a.marks && <Text style={s.qMarks}>[{a.marks}m]</Text>}
                </View>
                {!!a.question && <Text style={s.question}>{a.question}</Text>}
                {(a.steps || []).map((st: any, j: number) => (
                  <View key={j} style={s.stepRow}>
                    <Text style={s.stepText}>{typeof st === 'string' ? st : st.text}</Text>
                    {!!st?.marks && <Text style={s.stepMarks}>+{st.marks}</Text>}
                  </View>
                ))}
                {!!a.final_answer && <Text style={s.finalAns}>∴ {a.final_answer}</Text>}
                {!!a.examiner_tip && <Text style={s.tip}>Examiner: {a.examiner_tip}</Text>}
              </View>
            ))}
            {!ans && result?.raw_text && (
              <View style={s.card}><Text style={s.stepText}>{result.raw_text}</Text></View>
            )}
            <Text style={s.disclaimer}>{result?.disclaimer || 'AI can make mistake, please check important info.'}</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center' },
  title: { color: theme.colors.brand, fontSize: 18, fontWeight: '500' },
  subtitle: { color: theme.colors.muted, fontSize: 11, marginTop: 2 },
  segment: { flexDirection: 'row', gap: 6, marginBottom: 14 },
  segBtn: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: '#fff' },
  segActive: { backgroundColor: theme.colors.brand, borderColor: theme.colors.brand },
  segText: { color: theme.colors.brand, fontSize: 13, fontWeight: '500' },
  segTextActive: { color: '#fff' },
  dropZone: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: theme.colors.borderStrong, borderRadius: 16, paddingVertical: 34, alignItems: 'center', gap: 6, backgroundColor: '#fff' },
  dropTitle: { color: theme.colors.brand, fontSize: 14, fontWeight: '500', paddingHorizontal: 20, textAlign: 'center' },
  dropSub: { color: theme.colors.muted, fontSize: 11 },
  pasteInput: { backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border, borderRadius: 14, padding: 14, minHeight: 160, textAlignVertical: 'top' as any, color: theme.colors.brand, fontSize: 13, lineHeight: 19 },
  label: { color: theme.colors.muted, fontSize: 11, letterSpacing: 0.8, marginBottom: 6, marginTop: 14 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, color: theme.colors.brand, fontSize: 14 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: '#fff' },
  chipActive: { backgroundColor: theme.colors.brand, borderColor: theme.colors.brand },
  chipText: { color: theme.colors.brand, fontSize: 12, fontWeight: '500' },
  chipTextActive: { color: '#fff' },
  primaryBtn: { marginTop: 20, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 14, backgroundColor: theme.colors.brand, flex: 1 },
  primaryText: { color: '#fff', fontWeight: '500', fontSize: 14 },
  secondaryBtn: { marginTop: 20, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: 14, paddingHorizontal: 16, borderRadius: 14, backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border },
  secondaryText: { color: theme.colors.brand, fontWeight: '500', fontSize: 13 },
  err: { color: theme.colors.error, marginTop: 12, fontSize: 12 },
  busyHint: { color: theme.colors.muted, fontSize: 11, textAlign: 'center', marginTop: 10 },
  disclaimer: { color: theme.colors.muted, fontSize: 11, textAlign: 'center', marginTop: 16, fontStyle: 'italic' },
  paperTitle: { color: theme.colors.brand, fontSize: 20, fontWeight: '500', letterSpacing: -0.3 },
  paperMeta: { color: theme.colors.muted, fontSize: 12, marginTop: 4 },
  savedRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 },
  savedText: { color: '#16a34a', fontSize: 12, fontWeight: '500' },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: theme.colors.border, marginTop: 14 },
  qNo: { color: theme.colors.brand, fontSize: 15, fontWeight: '600' },
  qMarks: { color: '#16a34a', fontSize: 11, fontWeight: '600' },
  question: { color: theme.colors.muted, fontSize: 12, marginTop: 4, fontStyle: 'italic' },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 8 },
  stepText: { flex: 1, color: theme.colors.brand, fontSize: 13.5, lineHeight: 20 },
  stepMarks: { color: '#16a34a', fontSize: 11, fontWeight: '600', marginTop: 3 },
  finalAns: { color: theme.colors.brand, fontSize: 14, fontWeight: '600', marginTop: 10 },
  tip: { color: '#8a6d3b', fontSize: 11, marginTop: 8, fontStyle: 'italic' },
});
