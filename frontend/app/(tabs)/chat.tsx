import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator, Modal, Animated, Easing, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { api } from '@/src/api';
import ThinkingLoader from '@/src/components/ThinkingLoader';

type Msg = { id?: string; role: 'user' | 'assistant'; content: string; provider?: string; ts?: string; source?: string };
type Provider = {
  id: string; name: string; tagline: string; models: string[]; default_model: string;
  byo_key_url: string; supports_images: boolean; supports_web: boolean;
  has_bachein_key: boolean; connected_byo: boolean;
};
type Conv = { id: string; title: string; provider: string; pinned: boolean; updated_at: string; message_count: number };

const QUICK_ACTIONS = [
  { id: 'summarize', label: 'Summarize', icon: 'reader-outline' as const },
  { id: 'rewrite', label: 'Rewrite', icon: 'refresh-outline' as const },
  { id: 'improve', label: 'Improve', icon: 'sparkles-outline' as const },
  { id: 'translate', label: 'Translate', icon: 'globe-outline' as const },
  { id: 'explain', label: 'Explain', icon: 'help-circle-outline' as const },
  { id: 'draft_nda', label: 'Draft NDA', icon: 'shield-checkmark-outline' as const },
  { id: 'generate_contract', label: 'Contract', icon: 'document-text-outline' as const },
  { id: 'review_code', label: 'Review Code', icon: 'code-slash-outline' as const },
  { id: 'continue_writing', label: 'Continue', icon: 'arrow-forward-outline' as const },
  { id: 'create_pdf', label: 'Create PDF', icon: 'document-attach-outline' as const },
];

export default function AiWorkspace() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [convs, setConvs] = useState<Conv[]>([]);
  const [activeConv, setActiveConv] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [thinkingMode, setThinkingMode] = useState<'thinking' | 'drafting' | 'analyzing'>('thinking');
  const [provider, setProvider] = useState<string>('gemini');
  const [showProviderPicker, setShowProviderPicker] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showByo, setShowByo] = useState<string | null>(null);
  const [byoKey, setByoKey] = useState('');
  const [byoBusy, setByoBusy] = useState(false);
  const [byoError, setByoError] = useState('');
  const [voiceOn, setVoiceOn] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const recogRef = useRef<any>(null);

  // Load providers, settings, convs
  useEffect(() => {
    (async () => {
      try {
        const [p, s, c] = await Promise.all([api.aiwProviders(), api.aiwSettings(), api.aiwConversations()]);
        setProviders((p as any).providers);
        setSettings(s);
        setProvider((s as any).default_provider || 'gemini');
        setConvs((c as any).conversations);
      } catch (e) { /* ignore */ }
    })();
  }, []);

  const activeProvider = useMemo(() => providers.find((p) => p.id === provider) || providers[0], [providers, provider]);
  const quota = settings?.quota;
  const tier = settings?.tier || 'free';
  const canSend = (provider && (activeProvider?.has_bachein_key || activeProvider?.connected_byo)) && !!input.trim() && !sending;

  const openConv = async (id: string) => {
    setActiveConv(id);
    setShowHistory(false);
    try {
      const r: any = await api.aiwConversation(id);
      setProvider(r.conversation.provider);
      setMessages(r.messages.map((m: any) => ({ ...m })));
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 100);
    } catch {}
  };

  const newChat = () => {
    setActiveConv(null); setMessages([]); setInput('');
    setShowHistory(false);
  };

  const pickThinkingMode = (text: string, action?: string): 'thinking' | 'drafting' | 'analyzing' => {
    const t = text.toLowerCase();
    if (action === 'draft_nda' || action === 'generate_contract' || action === 'create_pdf' || /(draft|contract|nda|write|create|pdf)/.test(t)) return 'drafting';
    if (action === 'summarize' || action === 'review_code' || /(analy[sz]e|review|check|examine)/.test(t)) return 'analyzing';
    return 'thinking';
  };

  const send = async (opts?: { quick_action?: string; overrideText?: string }) => {
    const text = (opts?.overrideText ?? input).trim();
    if (!text || sending) return;
    setInput('');
    setThinkingMode(pickThinkingMode(text, opts?.quick_action));
    const userMsg: Msg = { role: 'user', content: text, ts: new Date().toISOString() };
    setMessages((m) => [...m, userMsg]);
    setSending(true);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    try {
      const r: any = await api.aiwChat({
        conversation_id: activeConv || undefined,
        message: text,
        provider,
        quick_action: opts?.quick_action,
      });
      setActiveConv(r.conversation_id);
      setMessages((m) => [...m, { role: 'assistant', content: r.reply, provider: r.provider, source: r.source, ts: new Date().toISOString() }]);
      // Refresh quota
      const s: any = await api.aiwSettings(); setSettings(s);
      // Refresh convs (in background)
      api.aiwConversations().then((c: any) => setConvs(c.conversations)).catch(() => {});
    } catch (e: any) {
      const err = String(e?.message || e);
      setMessages((m) => [...m, { role: 'assistant', content: `⚠️ ${err}`, provider }]);
    } finally {
      setSending(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  };

  const startVoice = () => {
    if (Platform.OS !== 'web') { alert('Voice input works best in the web browser (Chrome, Edge, Safari)'); return; }
    // @ts-ignore
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { alert('Your browser does not support voice input. Try Chrome or Safari.'); return; }
    const r = new SR();
    r.lang = 'en-US'; r.interimResults = true; r.continuous = false;
    r.onresult = (e: any) => {
      let t = '';
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      setInput(t);
    };
    r.onend = () => { setVoiceOn(false); };
    r.onerror = () => { setVoiceOn(false); };
    r.start();
    recogRef.current = r;
    setVoiceOn(true);
  };
  const stopVoice = () => { try { recogRef.current?.stop(); } catch {}; setVoiceOn(false); };

  const savePinned = async (id: string, pinned: boolean) => {
    try { await api.aiwPatchConversation(id, { pinned }); const c: any = await api.aiwConversations(); setConvs(c.conversations); } catch {}
  };
  const deleteConv = async (id: string) => {
    try { await api.aiwDeleteConversation(id); const c: any = await api.aiwConversations(); setConvs(c.conversations); if (activeConv === id) newChat(); } catch {}
  };

  const connectByo = async (pid: string) => {
    if (!byoKey.trim() || byoKey.trim().length < 10) { setByoError('Enter a valid API key'); return; }
    setByoBusy(true); setByoError('');
    try {
      await api.aiwSaveKey(pid, byoKey.trim());
      try { await api.aiwTestKey(pid); } catch (e: any) {
        setByoError('Saved, but test call failed: ' + (e.message || e).toString().slice(0, 120));
      }
      const [p, s] = await Promise.all([api.aiwProviders(), api.aiwSettings()]);
      setProviders((p as any).providers); setSettings(s);
      setShowByo(null); setByoKey('');
    } catch (e: any) { setByoError(e.message || 'Failed to connect'); }
    finally { setByoBusy(false); }
  };

  const disconnectByo = async (pid: string) => {
    try { await api.aiwDeleteKey(pid); const [p, s] = await Promise.all([api.aiwProviders(), api.aiwSettings()]); setProviders((p as any).providers); setSettings(s); } catch {}
  };

  const changeProvider = async (pid: string) => {
    setProvider(pid); setShowProviderPicker(false);
    try { await api.aiwPatchSettings({ default_provider: pid }); const s: any = await api.aiwSettings(); setSettings(s); } catch {}
  };

  return (
    <SafeAreaView style={s.container} edges={['top']} testID="ai-workspace">
      {/* Header */}
      <View style={s.header}>
        <Pressable testID="ai-history-btn" onPress={() => setShowHistory(true)} style={s.iconBtn}>
          <Ionicons name="time-outline" size={20} color={theme.colors.brand} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Bachein AI</Text>
          <Text style={s.subtitle}>{tier === 'byo' ? 'Your own keys' : tier === 'pro' ? 'Pro' : `Free · ${quota?.daily_used ?? 0}/${quota?.daily_limit ?? 20} today`}</Text>
        </View>
        <Pressable testID="ai-provider-btn" onPress={() => setShowProviderPicker(true)} style={s.providerChip}>
          <View style={s.providerDot} />
          <Text style={s.providerChipText}>{activeProvider?.name || 'Choose'}</Text>
          <Ionicons name="chevron-down" size={12} color={theme.colors.brand} />
        </Pressable>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{ padding: 20, paddingBottom: 200 }}
          keyboardShouldPersistTaps="handled"
        >
          {messages.length === 0 && (
            <View style={s.welcome}>
              <View style={s.welcomeIcon}><Ionicons name="sparkles" size={26} color={theme.colors.brand} /></View>
              <Text style={s.welcomeTitle}>How can I help today?</Text>
              <Text style={s.welcomeSub}>Ask anything — draft NDAs, review documents, explain clauses, write code, or brainstorm ideas.</Text>

              <View style={s.starterGrid}>
                {[
                  { t: 'Draft a mutual NDA between two startups', a: 'draft_nda' },
                  { t: 'Summarize this contract in 5 bullets', a: 'summarize' },
                  { t: 'Explain the indemnification clause', a: 'explain' },
                  { t: 'Rewrite this to sound professional', a: 'rewrite' },
                ].map((x, i) => (
                  <Pressable key={i} style={s.starter} onPress={() => send({ quick_action: x.a, overrideText: x.t })}>
                    <Text style={s.starterText}>{x.t}</Text>
                    <Ionicons name="arrow-forward" size={14} color={theme.colors.brand} />
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {messages.map((m, i) => (
            <View key={i} style={m.role === 'user' ? s.msgUser : s.msgAi}>
              {m.role === 'assistant' && (
                <View style={s.aiHeader}>
                  <View style={s.aiDot} />
                  <Text style={s.aiName}>{providers.find((p) => p.id === m.provider)?.name || 'AI'}</Text>
                  {m.source === 'byo' && <View style={s.byoBadge}><Text style={s.byoBadgeText}>YOUR KEY</Text></View>}
                </View>
              )}
              <Text style={m.role === 'user' ? s.msgUserText : s.msgAiText} selectable>{m.content}</Text>
              {m.role === 'assistant' && (
                <Text style={s.aiDisclaimer}>AI can make mistakes. Please double-check important information.</Text>
              )}
            </View>
          ))}

          {sending && (
            <View style={s.msgAi}>
              <View style={s.aiHeader}>
                <View style={s.aiDot} />
                <Text style={s.aiName}>{activeProvider?.name || 'AI'}</Text>
              </View>
              <ThinkingLoader mode={thinkingMode} />
            </View>
          )}
        </ScrollView>

        {/* Quick actions */}
        <View style={s.qaBar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 14 }}>
            {QUICK_ACTIONS.map((qa) => (
              <Pressable key={qa.id} testID={`qa-${qa.id}`} style={s.qaChip} onPress={() => {
                if (input.trim()) send({ quick_action: qa.id });
                else setInput(`${qa.label}: `);
              }}>
                <Ionicons name={qa.icon} size={13} color={theme.colors.brand} />
                <Text style={s.qaText}>{qa.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        {/* Composer */}
        <View style={s.composer}>
          <Pressable testID="ai-mic-btn" onPress={voiceOn ? stopVoice : startVoice} style={[s.micBtn, voiceOn && s.micBtnOn]}>
            <Ionicons name={voiceOn ? 'stop' : 'mic-outline'} size={18} color={voiceOn ? '#fff' : theme.colors.brand} />
          </Pressable>
          <TextInput
            testID="ai-input"
            style={s.input}
            value={input}
            onChangeText={setInput}
            placeholder={voiceOn ? 'Listening…' : `Message ${activeProvider?.name || 'AI'}…`}
            placeholderTextColor={theme.colors.muted}
            multiline
            onSubmitEditing={() => send()}
          />
          <Pressable testID="ai-send-btn" style={[s.sendBtn, !canSend && { opacity: 0.4 }]} disabled={!canSend} onPress={() => send()}>
            <Ionicons name={sending ? 'ellipse' : 'arrow-up'} size={18} color={theme.colors.onBrandPrimary} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      {/* ============== Provider picker modal ============== */}
      <Modal visible={showProviderPicker} transparent animationType="slide" onRequestClose={() => setShowProviderPicker(false)}>
        <View style={s.overlay}>
          <Pressable style={s.backdrop} onPress={() => setShowProviderPicker(false)} />
          <View style={s.sheet}>
            <View style={s.handle} />
            <View style={s.sheetHead}>
              <View style={{ flex: 1 }}>
                <Text style={s.sheetTitle}>AI Providers</Text>
                <Text style={s.sheetSub}>Pick your default or connect your own key</Text>
              </View>
              <Pressable onPress={() => setShowProviderPicker(false)} style={s.closeBtn2}>
                <Ionicons name="close" size={20} color={theme.colors.brand} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
              {providers.map((p) => (
                <View key={p.id} style={[s.provCard, provider === p.id && s.provCardActive]}>
                  <Pressable style={s.provTop} onPress={() => changeProvider(p.id)}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={s.provName}>{p.name}</Text>
                        {p.connected_byo && <View style={s.byoBadge}><Text style={s.byoBadgeText}>YOUR KEY</Text></View>}
                        {!p.connected_byo && p.has_bachein_key && <View style={s.freeBadge}><Text style={s.freeBadgeText}>FREE</Text></View>}
                        {!p.connected_byo && !p.has_bachein_key && <View style={s.lockedBadge}><Text style={s.lockedBadgeText}>BYO ONLY</Text></View>}
                      </View>
                      <Text style={s.provTag}>{p.tagline}</Text>
                    </View>
                    {provider === p.id && <Ionicons name="checkmark-circle" size={20} color={theme.colors.success} />}
                  </Pressable>

                  {showByo === p.id ? (
                    <View style={s.byoBox}>
                      <Text style={s.byoLabel}>Paste your {p.name} API key</Text>
                      <TextInput
                        testID={`byo-key-${p.id}`}
                        style={s.byoInput}
                        value={byoKey}
                        onChangeText={setByoKey}
                        placeholder={p.byo_key_url}
                        placeholderTextColor={theme.colors.muted}
                        secureTextEntry
                        autoCorrect={false}
                        autoCapitalize="none"
                      />
                      {!!byoError && <Text style={s.err}>{byoError}</Text>}
                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                        <Pressable style={s.byoCancel} onPress={() => { setShowByo(null); setByoKey(''); setByoError(''); }}>
                          <Text style={s.byoCancelText}>Cancel</Text>
                        </Pressable>
                        <Pressable testID={`byo-connect-${p.id}`} style={[s.byoConnect, byoBusy && { opacity: 0.6 }]} onPress={() => connectByo(p.id)} disabled={byoBusy}>
                          {byoBusy ? <ActivityIndicator color="#fff" /> : (
                            <>
                              <Ionicons name="link" size={13} color="#fff" />
                              <Text style={s.byoConnectText}>Connect</Text>
                            </>
                          )}
                        </Pressable>
                      </View>
                      <Text style={s.byoNote}>Get your key at {p.byo_key_url}</Text>
                    </View>
                  ) : (
                    <View style={s.provFoot}>
                      {p.connected_byo ? (
                        <Pressable testID={`byo-disconnect-${p.id}`} onPress={() => disconnectByo(p.id)}>
                          <Text style={s.footAction}>Disconnect my key</Text>
                        </Pressable>
                      ) : (
                        <Pressable testID={`byo-open-${p.id}`} onPress={() => { setShowByo(p.id); setByoKey(''); setByoError(''); }}>
                          <Text style={s.footAction}>+ Connect your own key</Text>
                        </Pressable>
                      )}
                    </View>
                  )}
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ============== History modal ============== */}
      <Modal visible={showHistory} transparent animationType="slide" onRequestClose={() => setShowHistory(false)}>
        <View style={s.overlay}>
          <Pressable style={s.backdrop} onPress={() => setShowHistory(false)} />
          <View style={s.sheet}>
            <View style={s.handle} />
            <View style={s.sheetHead}>
              <View style={{ flex: 1 }}>
                <Text style={s.sheetTitle}>Chat History</Text>
                <Text style={s.sheetSub}>{convs.length} conversations</Text>
              </View>
              <Pressable onPress={() => { newChat(); }} style={s.newChatBtn}>
                <Ionicons name="add" size={16} color={theme.colors.onBrandPrimary} />
                <Text style={s.newChatText}>New</Text>
              </Pressable>
              <Pressable onPress={() => setShowHistory(false)} style={s.closeBtn2}>
                <Ionicons name="close" size={20} color={theme.colors.brand} />
              </Pressable>
            </View>
            <FlatList
              data={convs}
              keyExtractor={(c) => c.id}
              contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
              ListEmptyComponent={<Text style={s.emptyHist}>No chats yet. Start one!</Text>}
              renderItem={({ item }) => (
                <Pressable style={s.convRow} onPress={() => openConv(item.id)} testID={`conv-${item.id}`}>
                  <View style={s.convIcon}><Ionicons name={item.pinned ? 'pin' : 'chatbubble-ellipses-outline'} size={14} color={theme.colors.brand} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.convTitle} numberOfLines={1}>{item.title}</Text>
                    <Text style={s.convMeta}>{new Date(item.updated_at).toLocaleString()} · {item.provider}</Text>
                  </View>
                  <Pressable style={s.convAction} onPress={() => savePinned(item.id, !item.pinned)} testID={`pin-${item.id}`}>
                    <Ionicons name={item.pinned ? 'pin' : 'pin-outline'} size={16} color={item.pinned ? theme.colors.accent : theme.colors.muted} />
                  </Pressable>
                  <Pressable style={s.convAction} onPress={() => deleteConv(item.id)} testID={`del-${item.id}`}>
                    <Ionicons name="trash-outline" size={16} color={theme.colors.muted} />
                  </Pressable>
                </Pressable>
              )}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, color: theme.colors.brand, fontWeight: '500', letterSpacing: -0.3 },
  subtitle: { color: theme.colors.muted, fontSize: 11 },
  providerChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border },
  providerDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors.success },
  providerChipText: { color: theme.colors.brand, fontSize: 12, fontWeight: '500' },
  welcome: { alignItems: 'center', marginTop: 30 },
  welcomeIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border },
  welcomeTitle: { color: theme.colors.brand, fontSize: 24, fontWeight: '500', marginTop: 16, letterSpacing: -0.5 },
  welcomeSub: { color: theme.colors.muted, fontSize: 13, marginTop: 8, textAlign: 'center', lineHeight: 18, paddingHorizontal: 20 },
  starterGrid: { marginTop: 26, gap: 10, alignSelf: 'stretch' },
  starter: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border },
  starterText: { flex: 1, color: theme.colors.brand, fontSize: 13, lineHeight: 18 },
  msgUser: { backgroundColor: theme.colors.brand, alignSelf: 'flex-end', maxWidth: '85%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18, borderBottomRightRadius: 4, marginTop: 12 },
  msgAi: { backgroundColor: '#fff', alignSelf: 'flex-start', maxWidth: '92%', paddingHorizontal: 14, paddingVertical: 12, borderRadius: 18, borderBottomLeftRadius: 4, marginTop: 12, borderWidth: 1, borderColor: theme.colors.border },
  msgUserText: { color: theme.colors.onBrandPrimary, fontSize: 14, lineHeight: 20 },
  msgAiText: { color: theme.colors.brand, fontSize: 14, lineHeight: 20 },
  aiHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  aiDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors.accent },
  aiName: { color: theme.colors.muted, fontSize: 11, letterSpacing: 0.5, fontWeight: '500' },
  aiDisclaimer: { color: theme.colors.muted, fontSize: 10, marginTop: 8, fontStyle: 'italic' },
  qaBar: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: theme.colors.divider },
  qaChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border, marginRight: 8 },
  qaText: { color: theme.colors.brand, fontSize: 12, fontWeight: '500' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 12, paddingBottom: 20, backgroundColor: theme.colors.surface },
  micBtn: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  micBtnOn: { backgroundColor: theme.colors.error, borderColor: theme.colors.error },
  input: { flex: 1, minHeight: 44, maxHeight: 120, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff', color: theme.colors.brand, fontSize: 14 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.colors.brand, alignItems: 'center', justifyContent: 'center' },
  // Modal
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  sheet: { backgroundColor: theme.colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '90%' },
  handle: { alignSelf: 'center', width: 42, height: 4, borderRadius: 2, backgroundColor: theme.colors.borderStrong, marginTop: 8 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 8 },
  sheetTitle: { color: theme.colors.brand, fontSize: 18, fontWeight: '500' },
  sheetSub: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  closeBtn2: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border },
  newChatBtn: { flexDirection: 'row', gap: 4, alignItems: 'center', backgroundColor: theme.colors.brand, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  newChatText: { color: theme.colors.onBrandPrimary, fontSize: 12, fontWeight: '500' },
  provCard: { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: theme.colors.border },
  provCardActive: { borderColor: theme.colors.brand, borderWidth: 2 },
  provTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  provName: { color: theme.colors.brand, fontSize: 15, fontWeight: '500' },
  provTag: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  provFoot: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: theme.colors.divider },
  footAction: { color: theme.colors.accent, fontSize: 12, fontWeight: '500' },
  byoBadge: { backgroundColor: '#DCEBE2', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  byoBadgeText: { color: theme.colors.success, fontSize: 9, fontWeight: '500', letterSpacing: 0.5 },
  freeBadge: { backgroundColor: theme.colors.surfaceSecondary, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  freeBadgeText: { color: theme.colors.brand, fontSize: 9, fontWeight: '500', letterSpacing: 0.5 },
  lockedBadge: { backgroundColor: '#FBE6DC', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  lockedBadgeText: { color: theme.colors.brandSecondary, fontSize: 9, fontWeight: '500', letterSpacing: 0.5 },
  byoBox: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: theme.colors.divider },
  byoLabel: { color: theme.colors.muted, fontSize: 11, letterSpacing: 0.5, marginBottom: 6 },
  byoInput: { backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, padding: 12, color: theme.colors.brand, fontSize: 13 },
  byoNote: { color: theme.colors.muted, fontSize: 11, marginTop: 8 },
  byoCancel: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, backgroundColor: '#fff' },
  byoCancelText: { color: theme.colors.brand, fontWeight: '500', fontSize: 13 },
  byoConnect: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 10, backgroundColor: theme.colors.brand },
  byoConnectText: { color: '#fff', fontWeight: '500', fontSize: 13 },
  err: { color: theme.colors.error, marginTop: 8, fontSize: 12 },
  emptyHist: { color: theme.colors.muted, textAlign: 'center', marginTop: 20, fontSize: 13 },
  convRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, backgroundColor: '#fff', borderRadius: 12, marginBottom: 8, borderWidth: 1, borderColor: theme.colors.border },
  convIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: theme.colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center' },
  convTitle: { color: theme.colors.brand, fontSize: 13, fontWeight: '500' },
  convMeta: { color: theme.colors.muted, fontSize: 11, marginTop: 2 },
  convAction: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
});
