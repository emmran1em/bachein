import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { api, getToken } from '@/src/api';
import { sharePdf } from '@/src/share';
import BacheinAiLogo from '@/src/components/BacheinAiLogo';
import DotsLoader from '@/src/components/DotsLoader';

type Phase = 'setup' | 'generating' | 'preview';

export default function QuestionPaperCreator() {
  const router = useRouter();
  const [opts, setOpts] = useState<any>(null);
  const [board, setBoard] = useState('CBSE');
  const [year, setYear] = useState('2025-26');
  const [classLevel, setClassLevel] = useState('10');
  const [subject, setSubject] = useState('Mathematics (Standard)');
  const [difficulty, setDifficulty] = useState('Board Level');
  const [numSets, setNumSets] = useState(1);
  const [chaptersText, setChaptersText] = useState('');
  const [phase, setPhase] = useState<Phase>('setup');
  const [jobId, setJobId] = useState<string | null>(null);
  const [record, setRecord] = useState<any>(null);
  const [err, setErr] = useState('');
  const [busyAction, setBusyAction] = useState('');
  const pollRef = useRef<any>(null);

  useEffect(() => {
    api.qpOptions().then((r: any) => setOpts(r)).catch(() => {});
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  // Reset subject when class list changes
  useEffect(() => {
    const list = opts?.subjects?.[classLevel] || [];
    if (list.length && !list.includes(subject)) setSubject(list[0]);
  }, [classLevel, opts]);

  const startPolling = (id: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    setJobId(id);
    pollRef.current = setInterval(async () => {
      try {
        const r: any = await api.aiwQuestionPaper1(id);
        setRecord(r);
        if (r.status === 'ready') {
          clearInterval(pollRef.current); pollRef.current = null;
          setPhase('preview'); setBusyAction('');
          if (r.error) setErr(r.error);
        } else if (r.status === 'failed') {
          clearInterval(pollRef.current); pollRef.current = null;
          setErr(r.error || 'Generation failed — please retry');
          setPhase('setup'); setBusyAction('');
        }
      } catch {}
    }, 4000);
  };

  const generate = async () => {
    setErr('');
    try {
      const r: any = await api.aiwQuestionPaper({
        board, academic_year: year, class_level: classLevel, subject,
        difficulty, num_sets: numSets,
        chapters: chaptersText.split(',').map((c) => c.trim()).filter(Boolean),
      });
      setRecord(null);
      setPhase('generating');
      startPolling(r.id);
    } catch (e: any) { setErr(e.message || 'Could not start generation'); }
  };

  const regen = async (payload: { q_no?: string; section?: string }) => {
    if (!jobId) return;
    setErr('');
    setBusyAction(payload.q_no ? `q-${payload.q_no}` : `s-${payload.section}`);
    try {
      await api.aiwQpRegenerate(jobId, payload);
      startPolling(jobId);
    } catch (e: any) { setErr(e.message || 'Regeneration failed'); setBusyAction(''); }
  };

  const newSet = async () => {
    if (!jobId) return;
    setErr('');
    try {
      const r: any = await api.aiwQpNewSet(jobId);
      setRecord(null);
      setPhase('generating');
      startPolling(r.id);
    } catch (e: any) { setErr(e.message || 'Could not start new set'); }
  };

  const downloadPdf = async () => {
    if (!jobId) return;
    try { await sharePdf(api.aiwQuestionPaperPdfUrl(jobId), `${board}-class-${classLevel}-${subject}-set${record?.params?.set_no || 1}.pdf`); } catch {}
  };

  const printPdf = async () => {
    if (!jobId) return;
    const token = await getToken();
    if (Platform.OS === 'web') {
      // @ts-ignore
      window.open(`${api.aiwQuestionPaperPdfUrl(jobId)}?token=${token}`, '_blank');
    } else {
      await downloadPdf();
    }
  };

  const paper = record?.paper;
  const classes = opts?.classes || ['6', '7', '8', '9', '10', '11', '12'];
  const subjects = opts?.subjects?.[classLevel] || [];

  return (
    <SafeAreaView style={s.container} edges={['top']} testID="qp-screen">
      <View style={s.header}>
        <Pressable onPress={() => (phase === 'preview' ? setPhase('setup') : router.back())} style={s.iconBtn} testID="qp-back">
          <Ionicons name="chevron-back" size={22} color={theme.colors.brand} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <BacheinAiLogo size={22} />
            <Text style={s.title}>Question Paper Creator</Text>
          </View>
          <Text style={s.subtitle}>Official board-format papers — blueprint, figures & print-ready PDF</Text>
        </View>
      </View>

      {phase === 'generating' && (
        <View style={s.genWrap} testID="qp-generating">
          <BacheinAiLogo size={54} />
          <Text style={s.genTitle}>Setting your paper…</Text>
          <View style={s.progressTrack}>
            <View style={[s.progressFill, { width: `${Math.max(4, record?.progress_pct || 0)}%` }]} />
          </View>
          <Text style={s.genStage}>{record?.progress || 'Queued…'}</Text>
          <Text style={s.genHint}>Following the official {board} blueprint for {year}. Accuracy over speed — this can take a few minutes.</Text>
          <DotsLoader color={theme.colors.brand} />
        </View>
      )}

      {phase !== 'generating' && (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
          {phase === 'setup' && (
            <>
              <Field label="Board"><Chips options={opts?.boards || ['CBSE']} value={board} onChange={setBoard} tid="qp-board" /></Field>
              <Field label="Academic year"><Chips options={opts?.academic_years || []} value={year} onChange={setYear} tid="qp-year" /></Field>
              <Field label="Class"><Chips options={classes} value={classLevel} onChange={setClassLevel} tid="qp-class" /></Field>
              <Field label="Subject"><Chips options={subjects} value={subject} onChange={setSubject} tid="qp-subject" wrap /></Field>
              <Field label="Difficulty level"><Chips options={opts?.difficulties || []} value={difficulty} onChange={setDifficulty} tid="qp-diff" /></Field>
              <Field label="Number of sets (optional)">
                <Chips options={['1', '2', '3']} value={String(numSets)} onChange={(v: string) => setNumSets(parseInt(v))} tid="qp-sets" />
              </Field>
              <Field label="Specific chapters (optional, comma-separated)">
                <TextInput style={s.input} value={chaptersText} onChangeText={setChaptersText}
                  placeholder="Leave empty for the full syllabus" placeholderTextColor={theme.colors.muted} testID="qp-chapters" />
              </Field>
              {!!err && <Text style={s.err}>{err}</Text>}
              <Pressable testID="qp-generate" style={s.primaryBtn} onPress={generate}>
                <Ionicons name="sparkles" size={16} color="#fff" />
                <Text style={s.primaryText}>Generate Board Paper{numSets > 1 ? `s (${numSets} sets)` : ''}</Text>
              </Pressable>
              <Text style={s.disclaimer}>AI can make mistake, please check important info.</Text>
            </>
          )}

          {phase === 'preview' && paper && (
            <View>
              <View style={s.paperHead}>
                <Text style={s.paperTitle}>{paper.title}</Text>
                <Text style={s.paperMeta}>
                  Q.P. Code {paper.qp_code || '—'} · Set {paper.set_no || record?.params?.set_no || 1} · {paper.time_allowed} · Max Marks: {paper.max_marks}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 }}>
                  <Ionicons name="checkmark-circle" size={14} color="#16a34a" />
                  <Text style={s.savedText}>Saved to your Downloads · print-ready PDF with embedded figures</Text>
                </View>
              </View>
              {!!err && <Text style={s.err}>{err}</Text>}

              <View style={s.actionsRow}>
                <ActionBtn tid="qp-download-pdf" icon="share-outline" label="PDF / Share" onPress={downloadPdf} primary />
                <ActionBtn tid="qp-print" icon="print-outline" label="Print" onPress={printPdf} />
                <ActionBtn tid="qp-new-set" icon="copy-outline" label="Another Set" onPress={newSet} />
                <ActionBtn tid="qp-new" icon="add-circle-outline" label="New" onPress={() => { setPhase('setup'); setRecord(null); setJobId(null); }} />
              </View>

              {(paper.general_instructions || []).length > 0 && (
                <View style={s.card}>
                  <Text style={s.sectionHead}>General Instructions</Text>
                  {paper.general_instructions.map((ins: string, i: number) => (
                    <Text key={i} style={s.instr}>({i + 1}) {ins}</Text>
                  ))}
                </View>
              )}

              {(paper.sections || []).map((sec: any, i: number) => (
                <View key={i} style={s.card}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.sectionHead}>{sec.name}</Text>
                      {!!sec.description && <Text style={s.sectionDesc}>{sec.description}  {sec.marks_line}</Text>}
                    </View>
                    <Pressable
                      testID={`qp-regen-sec-${i}`}
                      style={s.regenBtn}
                      onPress={() => regen({ section: sec.name })}
                    >
                      <Ionicons name="refresh" size={13} color={theme.colors.brand} />
                      <Text style={s.regenText}>Section</Text>
                    </Pressable>
                  </View>
                  {(sec.questions || []).map((q: any, j: number) => (
                    <View key={j} style={s.q}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={s.qNo}>Q{q.q_no}.</Text>
                        <Text style={s.qMarks}>[{q.marks}m]</Text>
                        {!!q.type && <Text style={s.qType}>{q.type}</Text>}
                        <Pressable
                          testID={`qp-regen-q-${q.q_no}`}
                          style={[s.qRegen, busyAction === `q-${q.q_no}` && { opacity: 0.4 }]}
                          onPress={() => regen({ q_no: String(q.q_no) })}
                        >
                          <Ionicons name="refresh" size={13} color={theme.colors.muted} />
                        </Pressable>
                      </View>
                      <Text style={s.qText}>{q.text}</Text>
                      {(q.options || []).map((o: string, k: number) => (
                        <Text key={k} style={s.qOpt}>({String.fromCharCode(97 + k)}) {o}</Text>
                      ))}
                      {(q.sub_questions || []).map((sq: any, k: number) => (
                        <Text key={k} style={s.qSub}>{sq?.label || `(${String.fromCharCode(105)})`} {typeof sq === 'string' ? sq : sq.text}{sq?.marks ? `  [${sq.marks}]` : ''}</Text>
                      ))}
                      {q.figure?.kind && q.figure.kind !== 'none' && (
                        <View style={s.figBox}>
                          <Ionicons name="image-outline" size={13} color={theme.colors.muted} />
                          <Text style={s.figLabel}>{q.figure.caption || `Figure (${q.figure.kind})`} — rendered inside the PDF</Text>
                        </View>
                      )}
                      {!!q.or_choice && (
                        <View style={{ marginTop: 6 }}>
                          <Text style={s.orLabel}>OR</Text>
                          <Text style={s.qText}>{typeof q.or_choice === 'string' ? q.or_choice : q.or_choice.text}</Text>
                          {(q.or_choice?.options || []).map((o: string, k: number) => (
                            <Text key={k} style={s.qOpt}>({String.fromCharCode(97 + k)}) {o}</Text>
                          ))}
                        </View>
                      )}
                    </View>
                  ))}
                </View>
              ))}
              <Text style={s.disclaimer}>AI can make mistake, please check important info.</Text>
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Field({ label, children }: any) {
  return (
    <View style={{ marginTop: 16 }}>
      <Text style={s.label}>{label.toUpperCase()}</Text>
      {children}
    </View>
  );
}

function Chips({ options, value, onChange, tid, wrap }: any) {
  const inner = (options || []).map((o: string) => (
    <Pressable key={o} testID={`${tid}-${o}`} onPress={() => onChange(o)} style={[s.chip, value === o && s.chipActive]}>
      <Text style={[s.chipText, value === o && s.chipTextActive]}>{o}</Text>
    </Pressable>
  ));
  if (wrap) return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{inner}</View>;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
      {inner}
    </ScrollView>
  );
}

function ActionBtn({ tid, icon, label, onPress, primary }: any) {
  return (
    <Pressable testID={tid} style={[s.actionBtn, primary && s.actionBtnPrimary]} onPress={onPress}>
      <Ionicons name={icon} size={15} color={primary ? '#fff' : theme.colors.brand} />
      <Text style={[s.actionText, primary && { color: '#fff' }]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center' },
  title: { color: theme.colors.brand, fontSize: 18, fontWeight: '500' },
  subtitle: { color: theme.colors.muted, fontSize: 11, marginTop: 2 },
  label: { color: theme.colors.muted, fontSize: 10, letterSpacing: 1, marginBottom: 7 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, color: theme.colors.brand, fontSize: 14 },
  chip: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: '#fff' },
  chipActive: { backgroundColor: theme.colors.brand, borderColor: theme.colors.brand },
  chipText: { color: theme.colors.brand, fontSize: 12, fontWeight: '500' },
  chipTextActive: { color: '#fff' },
  primaryBtn: { marginTop: 24, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingVertical: 15, borderRadius: 14, backgroundColor: theme.colors.brand },
  primaryText: { color: '#fff', fontWeight: '500', fontSize: 14 },
  err: { color: theme.colors.error, marginTop: 12, fontSize: 12 },
  disclaimer: { color: theme.colors.muted, fontSize: 11, textAlign: 'center', marginTop: 16, fontStyle: 'italic' },
  genWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 14 },
  genTitle: { color: theme.colors.brand, fontSize: 20, fontWeight: '500', letterSpacing: -0.3 },
  progressTrack: { alignSelf: 'stretch', height: 6, borderRadius: 3, backgroundColor: theme.colors.border, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: theme.colors.brand },
  genStage: { color: theme.colors.brand, fontSize: 13, fontWeight: '500', textAlign: 'center' },
  genHint: { color: theme.colors.muted, fontSize: 11.5, textAlign: 'center', lineHeight: 17 },
  paperHead: { marginTop: 4 },
  paperTitle: { color: theme.colors.brand, fontSize: 20, fontWeight: '600', letterSpacing: -0.3 },
  paperMeta: { color: theme.colors.muted, fontSize: 12, marginTop: 4 },
  savedText: { color: '#16a34a', fontSize: 11.5, fontWeight: '500', flex: 1 },
  actionsRow: { flexDirection: 'row', gap: 6, marginTop: 14, flexWrap: 'wrap' },
  actionBtn: { flexDirection: 'row', gap: 5, alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border },
  actionBtnPrimary: { backgroundColor: theme.colors.brand, borderColor: theme.colors.brand },
  actionText: { color: theme.colors.brand, fontWeight: '500', fontSize: 12.5 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: theme.colors.border, marginTop: 14 },
  sectionHead: { color: theme.colors.brand, fontSize: 15, fontWeight: '600' },
  sectionDesc: { color: theme.colors.muted, fontSize: 12, marginTop: 3 },
  regenBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: theme.colors.border },
  regenText: { color: theme.colors.brand, fontSize: 11, fontWeight: '500' },
  instr: { color: theme.colors.brand, fontSize: 12.5, lineHeight: 19, marginTop: 4, fontStyle: 'italic' },
  q: { marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: theme.colors.divider },
  qNo: { color: theme.colors.brand, fontSize: 14, fontWeight: '600' },
  qMarks: { color: '#16a34a', fontSize: 11, fontWeight: '600' },
  qType: { color: theme.colors.accent, fontSize: 10, fontWeight: '600', letterSpacing: 0.5 },
  qRegen: { marginLeft: 'auto', width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  qText: { color: theme.colors.brand, fontSize: 13.5, lineHeight: 20, marginTop: 4 },
  qOpt: { color: theme.colors.onSurfaceSecondary, fontSize: 13, marginLeft: 12, marginTop: 2 },
  qSub: { color: theme.colors.onSurfaceSecondary, fontSize: 13, marginLeft: 12, marginTop: 4 },
  figBox: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, backgroundColor: theme.colors.card, borderRadius: 8, padding: 9, borderWidth: 1, borderColor: theme.colors.border },
  figLabel: { color: theme.colors.muted, fontSize: 11, flex: 1 },
  orLabel: { color: theme.colors.brand, fontSize: 12, fontWeight: '700', textAlign: 'center', marginVertical: 4 },
});
