import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { theme } from '@/src/theme';
import { api } from '@/src/api';

type Msg = { role: 'user' | 'assistant' | 'system'; content: string; ts?: string; meta?: any };

export default function ChatScreen() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const [attachedPdf, setAttachedPdf] = useState<{ name: string; b64: string } | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    // Seed welcome message
    if (messages.length === 0) {
      setMessages([{
        role: 'assistant',
        content: "Hi! I'm Bachein AI. I can read your PDFs, summarize, edit, draft new docs, set passwords, and email them to people. Try: \"Summarize this PDF\" or \"Set password 1234 on this PDF and email it to friend@example.com\".",
      }]);
    }
  }, []);

  const pickPdf = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: ['application/pdf'], copyToCacheDirectory: true });
      if (res.canceled) return;
      const asset = res.assets[0];
      const b64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: 'base64' as any });
      setAttachedPdf({ name: asset.name, b64 });
    } catch (e: any) {
      setMessages((m) => [...m, { role: 'system', content: `Could not attach: ${e.message}` }]);
    }
  };

  const send = async () => {
    if (!input.trim() && !attachedPdf) return;
    const userMsg: Msg = { role: 'user', content: input + (attachedPdf ? `\n[Attached: ${attachedPdf.name}]` : '') };
    setMessages((m) => [...m, userMsg]);
    const msgText = input;
    const pdf = attachedPdf?.b64;
    setInput(''); setSending(true);
    const pendingAttachName = attachedPdf?.name;
    setAttachedPdf(null);
    try {
      const r: any = await api.chat({ session_id: sessionId, message: msgText || (pendingAttachName ? `Please read this PDF and summarize it: ${pendingAttachName}` : ''), pdf_context: pdf });
      setSessionId(r.session_id);
      const assistantMsg: Msg = { role: 'assistant', content: r.reply, meta: r.action };
      setMessages((m) => [...m, assistantMsg]);
      // Auto-confirm action? Show button instead
    } catch (e: any) {
      setMessages((m) => [...m, { role: 'system', content: `Error: ${e.message}` }]);
    } finally {
      setSending(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  };

  const runAction = async (action: any) => {
    if (!sessionId || !action?.tool) return;
    setSending(true);
    try {
      const r: any = await api.chatAction({ session_id: sessionId, action: action.tool, payload: action });
      const txt = r.sent
        ? `📧 Sent to ${r.to} ${r.password_protected ? '(password-protected)' : ''}`
        : `⚠️ Email could not be delivered. Note: free Resend may only send to your own account email.`;
      setMessages((m) => [...m, { role: 'system', content: txt }]);
    } catch (e: any) {
      setMessages((m) => [...m, { role: 'system', content: `Error: ${e.message}` }]);
    } finally { setSending(false); }
  };

  return (
    <SafeAreaView style={s.container} edges={['top']} testID="chat-screen">
      <View style={s.header}>
        <View>
          <Text style={s.title}>Bachein AI</Text>
          <Text style={s.subtitle}>Read · Summarize · Modify · Email</Text>
        </View>
        <Pressable testID="new-chat-btn" onPress={() => { setSessionId(undefined); setMessages([{ role: 'assistant', content: 'New session. How can I help?' }]); }} style={s.iconBtn}>
          <Ionicons name="add-outline" size={20} color={theme.colors.brand} />
        </Pressable>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }} keyboardVerticalOffset={80}>
        <ScrollView ref={scrollRef} contentContainerStyle={{ padding: 16, paddingBottom: 160 }} keyboardShouldPersistTaps="handled">
          {messages.map((m, i) => (
            <View key={i} style={[s.row, m.role === 'user' ? s.rowUser : s.rowAi]} testID={`chat-msg-${i}`}>
              {m.role !== 'user' && m.role !== 'system' && (
                <View style={s.avatar}><Ionicons name="sparkles" size={14} color={theme.colors.brandSecondary} /></View>
              )}
              <View style={[s.bubble, m.role === 'user' ? s.bubbleUser : m.role === 'system' ? s.bubbleSystem : s.bubbleAi]}>
                <Text style={[s.bubbleText, m.role === 'user' ? { color: '#fff' } : { color: theme.colors.brand }]}>{m.content}</Text>
                {m.meta && m.meta.tool === 'send_pdf_email' && (
                  <View style={s.actionCard}>
                    <Text style={s.actionTitle}>📧 Email PDF</Text>
                    <Text style={s.actionLine}>To: {m.meta.to}</Text>
                    <Text style={s.actionLine}>Subject: {m.meta.subject}</Text>
                    {m.meta.password && <Text style={s.actionLine}>🔐 Password: {m.meta.password}</Text>}
                    <Pressable testID={`run-action-${i}`} style={s.actionBtn} onPress={() => runAction(m.meta)}>
                      <Ionicons name="send" size={14} color="#fff" />
                      <Text style={s.actionBtnText}>Send Email</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            </View>
          ))}
          {sending && <ActivityIndicator color={theme.colors.brand} style={{ marginTop: 8 }} />}
        </ScrollView>

        <View style={s.composer}>
          {attachedPdf && (
            <View style={s.attachChip}>
              <Ionicons name="document-attach" size={14} color={theme.colors.brand} />
              <Text style={s.attachText} numberOfLines={1}>{attachedPdf.name}</Text>
              <Pressable onPress={() => setAttachedPdf(null)} testID="remove-attach">
                <Ionicons name="close" size={14} color={theme.colors.muted} />
              </Pressable>
            </View>
          )}
          <View style={s.inputRow}>
            <Pressable testID="attach-pdf-btn" onPress={pickPdf} style={s.attachBtn}>
              <Ionicons name="attach" size={20} color={theme.colors.brand} />
            </Pressable>
            <TextInput
              testID="chat-input"
              value={input}
              onChangeText={setInput}
              placeholder="Ask Bachein AI anything…"
              placeholderTextColor={theme.colors.muted}
              style={s.input}
              multiline
              maxLength={2000}
            />
            <Pressable testID="chat-send-btn" onPress={send} disabled={sending} style={[s.sendBtn, sending && { opacity: 0.5 }]}>
              <Ionicons name="arrow-up" size={18} color={theme.colors.onBrandPrimary} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.surface },
  header: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 26, color: theme.colors.brand, fontWeight: '500', letterSpacing: -0.5 },
  subtitle: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  iconBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', marginBottom: 12, gap: 8 },
  rowUser: { justifyContent: 'flex-end' },
  rowAi: { alignItems: 'flex-end' },
  avatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#FBE6DC', alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-end' },
  bubble: { maxWidth: '82%', padding: 12, borderRadius: 16 },
  bubbleUser: { backgroundColor: theme.colors.brand, borderBottomRightRadius: 4 },
  bubbleAi: { backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border, borderBottomLeftRadius: 4 },
  bubbleSystem: { backgroundColor: '#FFF8EF', borderWidth: 1, borderColor: '#F2DCB6' },
  bubbleText: { fontSize: 14, lineHeight: 20 },
  actionCard: { marginTop: 10, padding: 12, backgroundColor: theme.colors.surfaceSecondary, borderRadius: 10 },
  actionTitle: { color: theme.colors.brand, fontWeight: '500', fontSize: 13 },
  actionLine: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.colors.brandSecondary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, marginTop: 10, alignSelf: 'flex-start' },
  actionBtnText: { color: '#fff', fontSize: 12, fontWeight: '500' },
  composer: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 12, paddingBottom: 24, backgroundColor: theme.colors.surface, borderTopWidth: 1, borderTopColor: theme.colors.border },
  attachChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, alignSelf: 'flex-start', marginBottom: 8, borderWidth: 1, borderColor: theme.colors.border },
  attachText: { fontSize: 12, color: theme.colors.brand, maxWidth: 200 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  attachBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, maxHeight: 100, fontSize: 14, color: theme.colors.brand },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.brand, alignItems: 'center', justifyContent: 'center' },
});
