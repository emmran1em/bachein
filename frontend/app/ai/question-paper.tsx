import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, Switch, ActivityIndicator, Linking, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { api, getToken } from '@/src/api';
import BacheinAiLogo from '@/src/components/BacheinAiLogo';
import DotsLoader from '@/src/components/DotsLoader';

const BOARDS = ['CBSE', 'ICSE', 'State', 'IB', 'Other'];
const CLASSES = ['6', '7', '8', '9', '10', '11', '12'];
const DIFFS = ['easy', 'medium', 'hard', 'mixed'];

export default function QuestionPaperCreator() {
  const router = useRouter();
  const [board, setBoard] = useState('CBSE');
  const [classLevel, setClassLevel] = useState('10');
  const [subject, setSubject] = useState('Mathematics');
  const [chaptersText, setChaptersText] = useState('');
  const [totalMarks, setTotalMarks] = useState('80');
  const [duration, setDuration] = useState('180');
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard' | 'mixed'>('mixed');
  const [caseStudies, setCaseStudies] = useState(true);
  const [diagrams, setDiagrams] = useState(true);
  const [maps, setMaps] = useState(false);
  const [graphs, setGraphs] = useState(false);
  const [tables, setTables] = useState(true);
  const [sections, setSections] = useState('5');
  const [language, setLanguage] = useState('English');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState('');

  const generate = async () => {
    setBusy(true); setErr(''); setResult(null);
    try {
      const body = {
        board, class_level: classLevel, subject,
        chapters: chaptersText.split(',').map((c) => c.trim()).filter(Boolean),
        total_marks: parseInt(totalMarks) || 80,
        duration_minutes: parseInt(duration) || 180,
        difficulty,
        include_case_studies: caseStudies,
        include_diagrams: diagrams,
        include_maps: maps,
        include_graphs: graphs,
        include_tables: tables,
        num_sections: parseInt(sections) || 5,
        language,
      };
      const r: any = await api.aiwQuestionPaper(body);
      setResult(r);
    } catch (e: any) { setErr(e.message || 'Generation failed'); }
    finally { setBusy(false); }
  };

  const downloadPdf = async () => {
    if (!result?.id) return;
    try {
      const token = await getToken();
      const url = `${api.aiwQuestionPaperPdfUrl(result.id)}?token=${token}`;
      await Linking.openURL(url);
    } catch (e) { /* ignore */ }
  };

  const paper = result?.paper;

  return (
    <SafeAreaView style={s.container} edges={['top']} testID="qp-screen">
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.iconBtn} testID="qp-back">
          <Ionicons name="chevron-back" size={22} color={theme.colors.brand} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <BacheinAiLogo size={22} />
            <Text style={s.title}>Question Paper Creator</Text>
          </View>
          <Text style={s.subtitle}>Board-exam-accurate — analyzed from previous years</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
        {!result && (
          <>
            <Row label="Board">
              <ChipRow options={BOARDS} value={board} onChange={setBoard} testIdPrefix="qp-board" />
            </Row>
            <Row label="Class">
              <ChipRow options={CLASSES} value={classLevel} onChange={setClassLevel} testIdPrefix="qp-class" />
            </Row>
            <Row label="Subject">
              <TextInput style={s.input} value={subject} onChangeText={setSubject} placeholder="e.g. Mathematics" placeholderTextColor={theme.colors.muted} testID="qp-subject" />
            </Row>
            <Row label="Chapters (comma-separated)">
              <TextInput style={[s.input, { minHeight: 60, textAlignVertical: 'top' as any }]} value={chaptersText} onChangeText={setChaptersText} placeholder="Real Numbers, Polynomials, Triangles" placeholderTextColor={theme.colors.muted} multiline testID="qp-chapters" />
            </Row>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Row label="Total marks" flex>
                <TextInput style={s.input} value={totalMarks} onChangeText={setTotalMarks} keyboardType="number-pad" testID="qp-marks" />
              </Row>
              <Row label="Duration (min)" flex>
                <TextInput style={s.input} value={duration} onChangeText={setDuration} keyboardType="number-pad" testID="qp-duration" />
              </Row>
            </View>
            <Row label="Difficulty">
              <ChipRow options={DIFFS} value={difficulty} onChange={(v) => setDifficulty(v as any)} testIdPrefix="qp-diff" />
            </Row>
            <Row label="Sections">
              <TextInput style={s.input} value={sections} onChangeText={setSections} keyboardType="number-pad" testID="qp-sections" />
            </Row>
            <Row label="Language">
              <TextInput style={s.input} value={language} onChangeText={setLanguage} testID="qp-lang" />
            </Row>
            <Text style={s.groupLabel}>INCLUDE</Text>
            <ToggleRow label="Case studies" value={caseStudies} onValueChange={setCaseStudies} />
            <ToggleRow label="Diagrams" value={diagrams} onValueChange={setDiagrams} />
            <ToggleRow label="Maps" value={maps} onValueChange={setMaps} />
            <ToggleRow label="Graphs" value={graphs} onValueChange={setGraphs} />
            <ToggleRow label="Tables" value={tables} onValueChange={setTables} />

            {!!err && <Text style={s.err}>{err}</Text>}
            <Pressable testID="qp-generate" style={[s.primaryBtn, busy && { opacity: 0.6 }]} disabled={busy} onPress={generate}>
              {busy ? <DotsLoader color="#fff" /> : (
                <>
                  <Ionicons name="sparkles" size={16} color="#fff" />
                  <Text style={s.primaryText}>Generate Paper</Text>
                </>
              )}
            </Pressable>
            <Text style={s.disclaimer}>AI can make mistake, please check important info.</Text>
          </>
        )}

        {result && (
          <View>
            <View style={s.resultHead}>
              <Text style={s.paperTitle}>{paper?.title || `${board} Class ${classLevel} — ${subject}`}</Text>
              <Text style={s.paperMeta}>Total: {totalMarks} marks · {duration} min · {language}</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              <Pressable testID="qp-new" style={s.secondaryBtn} onPress={() => setResult(null)}>
                <Ionicons name="add-circle-outline" size={14} color={theme.colors.brand} />
                <Text style={s.secondaryText}>New Paper</Text>
              </Pressable>
              <Pressable testID="qp-download-pdf" style={s.primaryBtn} onPress={downloadPdf}>
                <Ionicons name="download-outline" size={16} color="#fff" />
                <Text style={s.primaryText}>Download PDF</Text>
              </Pressable>
            </View>

            {(paper?.general_instructions || []).length > 0 && (
              <View style={s.card}>
                <Text style={s.sectionHead}>General Instructions</Text>
                {paper.general_instructions.map((ins: string, i: number) => (
                  <Text key={i} style={s.instr}>• {ins}</Text>
                ))}
              </View>
            )}

            {(paper?.sections || []).map((sec: any, i: number) => (
              <View key={i} style={s.card}>
                <Text style={s.sectionHead}>{sec.name}</Text>
                {sec.description && <Text style={s.sectionDesc}>{sec.description}</Text>}
                {(sec.questions || []).map((q: any, j: number) => (
                  <View key={j} style={s.q}>
                    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'baseline' }}>
                      <Text style={s.qNo}>Q{q.q_no}.</Text>
                      <Text style={s.qMarks}>({q.marks}m)</Text>
                      {q.type && <Text style={s.qType}>[{q.type}]</Text>}
                    </View>
                    <Text style={s.qText}>{q.text}</Text>
                    {(q.options || []).map((o: string, k: number) => (
                      <Text key={k} style={s.qOpt}>({String.fromCharCode(97 + k)}) {o}</Text>
                    ))}
                    {q.figure?.kind && q.figure.kind !== 'none' && (
                      <View style={s.figBox}>
                        <Text style={s.figLabel}>[{q.figure.kind}]  {q.figure.caption}</Text>
                        {q.figure.ascii && <Text style={s.figAscii}>{q.figure.ascii}</Text>}
                      </View>
                    )}
                    {(q.sub_questions || []).map((sq: any, k: number) => (
                      <Text key={k} style={s.qSub}>({String.fromCharCode(97 + k)}) {typeof sq === 'string' ? sq : sq.text}</Text>
                    ))}
                  </View>
                ))}
              </View>
            ))}

            {!paper && result?.raw_text && (
              <View style={s.card}>
                <Text style={s.instr}>{result.raw_text}</Text>
              </View>
            )}
            <Text style={s.disclaimer}>{result?.disclaimer || 'AI can make mistake, please check important info.'}</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, children, flex }: any) {
  return (
    <View style={{ marginTop: 14, flex: flex ? 1 : undefined }}>
      <Text style={s.label}>{label}</Text>
      {children}
    </View>
  );
}
function ChipRow({ options, value, onChange, testIdPrefix }: any) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
      {options.map((o: string) => (
        <Pressable key={o} testID={`${testIdPrefix}-${o}`} onPress={() => onChange(o)} style={[s.chip, value === o && s.chipActive]}>
          <Text style={[s.chipText, value === o && s.chipTextActive]}>{o}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
function ToggleRow({ label, value, onValueChange }: any) {
  return (
    <View style={s.toggleRow}>
      <Text style={s.toggleLabel}>{label}</Text>
      <Switch value={value} onValueChange={onValueChange} trackColor={{ true: theme.colors.brand } as any} />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center' },
  title: { color: theme.colors.brand, fontSize: 18, fontWeight: '500' },
  subtitle: { color: theme.colors.muted, fontSize: 11, marginTop: 2 },
  label: { color: theme.colors.muted, fontSize: 11, letterSpacing: 0.8, marginBottom: 6 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, color: theme.colors.brand, fontSize: 14 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: '#fff' },
  chipActive: { backgroundColor: theme.colors.brand, borderColor: theme.colors.brand },
  chipText: { color: theme.colors.brand, fontSize: 12, fontWeight: '500' },
  chipTextActive: { color: '#fff' },
  groupLabel: { color: theme.colors.muted, fontSize: 10, letterSpacing: 1, marginTop: 22, marginBottom: 6 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
  toggleLabel: { color: theme.colors.brand, fontSize: 13 },
  primaryBtn: { marginTop: 20, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 14, backgroundColor: theme.colors.brand, flex: 1 },
  primaryText: { color: '#fff', fontWeight: '500', fontSize: 14 },
  secondaryBtn: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: 14, paddingHorizontal: 16, borderRadius: 14, backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border },
  secondaryText: { color: theme.colors.brand, fontWeight: '500', fontSize: 13 },
  err: { color: theme.colors.error, marginTop: 12, fontSize: 12 },
  disclaimer: { color: theme.colors.muted, fontSize: 11, textAlign: 'center', marginTop: 16, fontStyle: 'italic' },
  resultHead: { marginTop: 4 },
  paperTitle: { color: theme.colors.brand, fontSize: 20, fontWeight: '500', letterSpacing: -0.3 },
  paperMeta: { color: theme.colors.muted, fontSize: 12, marginTop: 4 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: theme.colors.border, marginTop: 14 },
  sectionHead: { color: theme.colors.brand, fontSize: 15, fontWeight: '500', marginBottom: 4 },
  sectionDesc: { color: theme.colors.muted, fontSize: 12, marginBottom: 8 },
  instr: { color: theme.colors.brand, fontSize: 13, lineHeight: 20, marginTop: 2 },
  q: { marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: theme.colors.divider },
  qNo: { color: theme.colors.brand, fontSize: 14, fontWeight: '600' },
  qMarks: { color: theme.colors.muted, fontSize: 11 },
  qType: { color: theme.colors.accent, fontSize: 10, fontWeight: '600', letterSpacing: 0.5, marginLeft: 6 },
  qText: { color: theme.colors.brand, fontSize: 14, lineHeight: 20, marginTop: 4 },
  qOpt: { color: theme.colors.onSurfaceSecondary, fontSize: 13, marginLeft: 12, marginTop: 2 },
  qSub: { color: theme.colors.onSurfaceSecondary, fontSize: 13, marginLeft: 12, marginTop: 4 },
  figBox: { marginTop: 8, backgroundColor: theme.colors.card, borderRadius: 8, padding: 10, borderWidth: 1, borderColor: theme.colors.border },
  figLabel: { color: theme.colors.brand, fontWeight: '500', fontSize: 12 },
  figAscii: { color: theme.colors.onSurfaceSecondary, fontFamily: Platform.select({ web: 'monospace', default: 'Courier' }), fontSize: 11, marginTop: 6 },
});
