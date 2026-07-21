import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput, ActivityIndicator, Platform, KeyboardAvoidingView, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { RichEditor, RichToolbar, actions } from 'react-native-pell-rich-editor';
import { theme } from '@/src/theme';
import { api, getToken, API_BASE } from '@/src/api';
import { useToast } from '@/src/components/Toast';
import { playSent } from '@/src/lib/sound';

const DOC_TYPES = [
  'Movie Story', 'Novel', 'Legal Agreement', 'NDA', 'Patent',
  'Business Proposal', 'Investor Pitch', 'Research Paper',
  'Technical Documentation', 'Teacher Question Paper', 'Resume',
  'Meeting Notes', 'Contract', 'Policy Document', 'Other',
];

type Step = 'picker' | 'editor';

export default function Editor() {
  const router = useRouter();
  const toast = useToast();
  const { id: idParam } = useLocalSearchParams<{ id?: string }>();
  const [step, setStep] = useState<Step>(idParam ? 'editor' : 'picker');
  const [docType, setDocType] = useState<string>('Novel');
  const [title, setTitle] = useState('Untitled document');
  const [html, setHtml] = useState('');
  const [docId, setDocId] = useState<string | undefined>(idParam);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string>('');
  const [aiCmd, setAiCmd] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMode, setAiMode] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePerm, setInvitePerm] = useState<'view' | 'comment' | 'edit' | 'admin'>('edit');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [collabs, setCollabs] = useState<any[]>([]);
  const richRef = useRef<any>(null);
  const autosaveT = useRef<any>(null);

  // Load existing doc when id provided
  useEffect(() => {
    if (!idParam) return;
    api.editorGet(idParam).then((d: any) => {
      setDocId(d.id); setTitle(d.title); setDocType(d.doc_type);
      setHtml(d.html || ''); setCollabs(d.collaborators || []);
    }).catch(() => {});
  }, [idParam]);

  // Autosave 3s after last change
  const scheduleAutosave = useCallback(() => {
    if (autosaveT.current) clearTimeout(autosaveT.current);
    autosaveT.current = setTimeout(() => save(true), 3000);
  }, [title, html, docType, docId]);

  const save = async (silent = false) => {
    setSaving(true);
    try {
      const res: any = await api.editorSave({ id: docId, title, doc_type: docType, html });
      setDocId(res.id);
      setSavedAt(new Date(res.saved_at).toLocaleTimeString());
      if (!silent) toast.show('Saved ✓', 'success');
    } catch (e: any) {
      if (!silent) toast.show(e.message, 'error');
    } finally { setSaving(false); }
  };

  const runAi = async () => {
    if (!aiCmd.trim()) return;
    setAiBusy(true);
    try {
      const r: any = await api.editorAi({ doc_type: docType, current_html: html, instruction: aiCmd });
      if (r.html) {
        setHtml(r.html);
        richRef.current?.setContentHTML?.(r.html);
      }
      if (r.mode) setAiMode(r.mode);
      setAiCmd('');
      toast.show(`${r.mode || 'AI'}: applied ✓`, 'success');
    } catch (e: any) { toast.show(e.message, 'error'); }
    finally { setAiBusy(false); }
  };

  const invite = async () => {
    if (!docId) { await save(true); }
    if (!inviteEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail)) {
      toast.show('Enter a valid email', 'error'); return;
    }
    setInviteBusy(true);
    try {
      const r: any = await api.editorInvite({ document_id: docId!, email: inviteEmail.trim(), permission: invitePerm });
      setCollabs((c) => {
        const others = c.filter((x) => x.email !== r.email);
        return [...others, { email: r.email, permission: r.permission, invited_at: new Date().toISOString() }];
      });
      playSent();
      toast.show(`Invited ${r.email} as ${r.permission} ✓`, 'success');
      setInviteEmail(''); setInviteOpen(false);
    } catch (e: any) { toast.show(e.message, 'error'); }
    finally { setInviteBusy(false); }
  };

  const exportPdf = async () => {
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/editor/export-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id: docId, title, doc_type: docType, html }),
      });
      const blob = await res.blob();
      if (Platform.OS === 'web') {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `${title}.pdf`; a.click();
      }
      toast.show('PDF exported ✓', 'success');
    } catch (e: any) { toast.show(e.message, 'error'); }
  };

  if (step === 'picker') {
    return (
      <SafeAreaView style={s.container} edges={['top']} testID="editor-picker">
        <View style={s.header}>
          <Pressable onPress={() => router.back()} style={s.closeBtn} testID="picker-back">
            <Ionicons name="close" size={22} color={theme.colors.brand} />
          </Pressable>
          <Text style={s.eyebrow}>WRITE DOCUMENT</Text>
        </View>
        <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 60 }}>
          <Text style={s.title}>What are you writing?</Text>
          <Text style={s.subtitle}>Bachein AI switches to the right assistant for you — Director for stories, Lawyer for legal, Teacher for question papers, and more.</Text>
          <View style={s.typeGrid}>
            {DOC_TYPES.map((t) => (
              <Pressable
                key={t}
                testID={`type-${t.replace(/\s+/g, '-').toLowerCase()}`}
                onPress={() => setDocType(t)}
                style={[s.typeTile, docType === t && s.typeTileActive]}
              >
                <Text style={[s.typeText, docType === t && s.typeTextActive]}>{t}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={s.label}>Document title</Text>
          <TextInput
            testID="title-input"
            style={s.input}
            value={title} onChangeText={setTitle}
            placeholder="Untitled document" placeholderTextColor={theme.colors.muted}
          />
          <Pressable testID="start-editor-btn" style={s.primaryBtn} onPress={() => setStep('editor')}>
            <Ionicons name="create-outline" size={16} color={theme.colors.onBrandPrimary} />
            <Text style={s.primaryBtnText}>Open Editor</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container} edges={['top']} testID="editor-screen">
      <View style={s.editorHead}>
        <Pressable testID="editor-back" onPress={() => router.back()} style={s.closeBtn}>
          <Ionicons name="chevron-back" size={22} color={theme.colors.brand} />
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <TextInput
            testID="title-inline"
            style={s.titleInline}
            value={title} onChangeText={(v) => { setTitle(v); scheduleAutosave(); }}
            placeholder="Untitled" placeholderTextColor={theme.colors.muted}
          />
          <Text style={s.modeLine}>
            {docType}{aiMode ? ` · ${aiMode}` : ''}{savedAt ? ` · saved ${savedAt}` : ''}{saving ? ' · saving…' : ''}
          </Text>
        </View>
        <Pressable testID="invite-btn" onPress={() => setInviteOpen(true)} style={s.headBtn}>
          <Ionicons name="person-add-outline" size={16} color={theme.colors.brand} />
          <Text style={s.headBtnText}>{collabs.length > 0 ? `${collabs.length}` : 'Invite'}</Text>
        </Pressable>
        <Pressable testID="export-btn" onPress={exportPdf} style={s.headBtn}>
          <Ionicons name="download-outline" size={16} color={theme.colors.brand} />
        </Pressable>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }} keyboardVerticalOffset={80}>
        {/* AI Command Bar */}
        <View style={s.aiBar}>
          <Ionicons name="sparkles" size={14} color={theme.colors.accent} />
          <TextInput
            testID="ai-cmd-input"
            style={s.aiInput}
            value={aiCmd} onChangeText={setAiCmd}
            placeholder='Ask AI e.g. "Make all headings Times New Roman size 22"'
            placeholderTextColor={theme.colors.muted}
            onSubmitEditing={runAi}
          />
          <Pressable testID="ai-run-btn" onPress={runAi} disabled={aiBusy || !aiCmd.trim()} style={[s.aiBtn, (aiBusy || !aiCmd.trim()) && { opacity: 0.5 }]}>
            {aiBusy ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="arrow-up" size={14} color="#fff" />}
          </Pressable>
        </View>

        {/* Rich toolbar */}
        <RichToolbar
          editor={richRef}
          selectedIconTint={theme.colors.accent}
          iconTint={theme.colors.brand}
          style={s.toolbar}
          actions={[
            actions.setBold, actions.setItalic, actions.setUnderline,
            actions.heading1, actions.heading2, actions.heading3,
            actions.insertBulletsList, actions.insertOrderedList,
            actions.blockquote, actions.code, actions.insertLink,
            actions.alignLeft, actions.alignCenter, actions.alignRight,
            actions.undo, actions.redo,
          ]}
          iconMap={{
            [actions.heading1]: () => <Text style={s.tbTxt}>H1</Text>,
            [actions.heading2]: () => <Text style={s.tbTxt}>H2</Text>,
            [actions.heading3]: () => <Text style={s.tbTxt}>H3</Text>,
          }}
        />

        <RichEditor
          ref={richRef}
          initialContentHTML={html}
          placeholder="Start writing your document…"
          onChange={(v) => { setHtml(v); scheduleAutosave(); }}
          style={s.editor}
          editorStyle={{
            backgroundColor: '#fff',
            color: '#22201C',
            contentCSSText: 'font-family: -apple-system, Segoe UI, Roboto, sans-serif; font-size: 15px; line-height: 1.5; padding: 20px;',
          }}
          initialHeight={480}
        />

        {collabs.length > 0 && (
          <View style={s.collabRow}>
            <Ionicons name="people-outline" size={14} color={theme.colors.muted} />
            <Text style={s.collabText}>{collabs.length} collaborator{collabs.length > 1 ? 's' : ''}: {collabs.slice(0, 3).map(c => c.email).join(', ')}{collabs.length > 3 ? '…' : ''}</Text>
          </View>
        )}
      </KeyboardAvoidingView>

      <Modal visible={inviteOpen} transparent animationType="fade" onRequestClose={() => setInviteOpen(false)}>
        <View style={s.modalOverlay}>
          <View style={s.inviteSheet}>
            <Text style={s.inviteTitle}>Invite a collaborator</Text>
            <Text style={s.inviteSub}>They'll get an email with a magic link to open this document.</Text>
            <TextInput
              testID="invite-email-input"
              style={s.input} value={inviteEmail} onChangeText={setInviteEmail}
              placeholder="collaborator@example.com" placeholderTextColor={theme.colors.muted}
              autoCapitalize="none" keyboardType="email-address"
            />
            <Text style={s.label}>Permission</Text>
            <View style={s.permRow}>
              {(['view', 'comment', 'edit', 'admin'] as const).map(p => (
                <Pressable key={p} testID={`perm-${p}`} onPress={() => setInvitePerm(p)} style={[s.permBtn, invitePerm === p && s.permBtnActive]}>
                  <Text style={[s.permText, invitePerm === p && s.permTextActive]}>{p}</Text>
                </Pressable>
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
              <Pressable testID="cancel-invite" style={s.cancelBtn} onPress={() => setInviteOpen(false)}>
                <Text style={s.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable testID="send-invite-btn" style={[s.primaryBtn, { flex: 1, marginTop: 0 }, inviteBusy && { opacity: 0.6 }]} onPress={invite} disabled={inviteBusy}>
                {inviteBusy ? <ActivityIndicator color="#fff" /> : (
                  <><Ionicons name="paper-plane" size={14} color="#fff" /><Text style={s.primaryBtnText}>Send invite</Text></>
                )}
              </Pressable>
            </View>
            {collabs.length > 0 && (
              <View style={{ marginTop: 18, borderTopWidth: 1, borderTopColor: theme.colors.divider, paddingTop: 14 }}>
                <Text style={s.label}>CURRENT COLLABORATORS</Text>
                {collabs.map((c, i) => (
                  <View key={i} style={s.collabItem}>
                    <Text style={{ color: theme.colors.brand, fontSize: 13, flex: 1 }} numberOfLines={1}>{c.email}</Text>
                    <View style={s.permBadge}><Text style={s.permBadgeText}>{c.permission}</Text></View>
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  closeBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border },
  eyebrow: { color: theme.colors.muted, fontSize: 11, letterSpacing: 1 },
  title: { color: theme.colors.brand, fontSize: 26, fontWeight: '500', letterSpacing: -0.5 },
  subtitle: { color: theme.colors.muted, marginTop: 6, lineHeight: 20 },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 20 },
  typeTile: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border },
  typeTileActive: { backgroundColor: theme.colors.brand, borderColor: theme.colors.brand },
  typeText: { color: theme.colors.brand, fontSize: 13, fontWeight: '500' },
  typeTextActive: { color: theme.colors.onBrandPrimary },
  label: { color: theme.colors.muted, fontSize: 11, letterSpacing: 1, marginTop: 24, marginBottom: 8 },
  input: { backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, padding: 14, fontSize: 15, color: theme.colors.brand },
  primaryBtn: { flexDirection: 'row', gap: 8, marginTop: 24, backgroundColor: theme.colors.brand, padding: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: theme.colors.onBrandPrimary, fontWeight: '500' },
  editorHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.border, backgroundColor: theme.colors.card },
  titleInline: { color: theme.colors.brand, fontSize: 15, fontWeight: '500', paddingVertical: 4 },
  modeLine: { color: theme.colors.muted, fontSize: 10 },
  headBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.card },
  headBtnText: { color: theme.colors.brand, fontSize: 11, fontWeight: '500' },
  aiBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: theme.colors.surfaceSecondary, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  aiInput: { flex: 1, backgroundColor: '#fff', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999, fontSize: 12, color: theme.colors.brand, borderWidth: 1, borderColor: theme.colors.border },
  aiBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: theme.colors.accent, alignItems: 'center', justifyContent: 'center' },
  toolbar: { backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  tbTxt: { color: theme.colors.brand, fontWeight: '600', fontSize: 12 },
  editor: { flex: 1, backgroundColor: '#fff' },
  collabRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: theme.colors.border, backgroundColor: theme.colors.card },
  collabText: { color: theme.colors.muted, fontSize: 11 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 20 },
  inviteSheet: { backgroundColor: theme.colors.card, borderRadius: 20, padding: 20 },
  inviteTitle: { color: theme.colors.brand, fontSize: 20, fontWeight: '500' },
  inviteSub: { color: theme.colors.muted, fontSize: 13, marginTop: 4, marginBottom: 16 },
  permRow: { flexDirection: 'row', gap: 6, marginTop: 4 },
  permBtn: { flex: 1, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: '#fff', alignItems: 'center' },
  permBtnActive: { backgroundColor: theme.colors.brand, borderColor: theme.colors.brand },
  permText: { color: theme.colors.brand, fontSize: 12, fontWeight: '500', textTransform: 'capitalize' },
  permTextActive: { color: theme.colors.onBrandPrimary },
  cancelBtn: { paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center' },
  cancelText: { color: theme.colors.brand, fontWeight: '500' },
  collabItem: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  permBadge: { backgroundColor: theme.colors.surfaceSecondary, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  permBadgeText: { color: theme.colors.muted, fontSize: 10, fontWeight: '500', textTransform: 'uppercase' },
});
