import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator, Modal, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { api } from '@/src/api';
import DotsLoader from '@/src/components/DotsLoader';
import BacheinAiLogo from '@/src/components/BacheinAiLogo';
import PlansSheet from '@/src/components/PlansSheet';
import * as DocumentPicker from 'expo-document-picker';

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
  const [showPlans, setShowPlans] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);
  const [historyQuery, setHistoryQuery] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const scrollRef = useRef<ScrollView>(null);
  const recogRef = useRef<any>(null);

  // Date grouping for chat history
  const formatRelative = (iso: string) => {
    try {
      const then = new Date(iso).getTime();
      const now = Date.now();
      const diffMin = Math.floor((now - then) / 60000);
      if (diffMin < 1) return 'just now';
      if (diffMin < 60) return `${diffMin}m ago`;
      if (diffMin < 60 * 24) return `${Math.floor(diffMin / 60)}h ago`;
      const days = Math.floor(diffMin / (60 * 24));
      if (days === 1) return 'yesterday';
      if (days < 7) return `${days} days ago`;
      return new Date(iso).toLocaleDateString();
    } catch { return ''; }
  };

  const groupedConvs = useMemo(() => {
    const q = historyQuery.trim().toLowerCase();
    const filtered = q ? convs.filter((c) => c.title.toLowerCase().includes(q) || c.provider.toLowerCase().includes(q)) : convs;
    // Split pinned first, then group by date
    const pinned = filtered.filter((c) => c.pinned);
    const rest = filtered.filter((c) => !c.pinned);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const yest = new Date(today.getTime() - 86400000);
    const weekAgo = new Date(today.getTime() - 6 * 86400000);
    const monthAgo = new Date(today.getTime() - 30 * 86400000);
    const buckets = { today: [] as Conv[], yesterday: [] as Conv[], week: [] as Conv[], month: [] as Conv[], older: [] as Conv[] };
    rest.forEach((c) => {
      const t = new Date(c.updated_at);
      if (t >= today) buckets.today.push(c);
      else if (t >= yest) buckets.yesterday.push(c);
      else if (t >= weekAgo) buckets.week.push(c);
      else if (t >= monthAgo) buckets.month.push(c);
      else buckets.older.push(c);
    });
    const out: any[] = [];
    if (pinned.length) { out.push({ type: 'header', title: 'PINNED' }); pinned.forEach((c) => out.push({ ...c, type: 'conv' })); }
    if (buckets.today.length) { out.push({ type: 'header', title: 'TODAY' }); buckets.today.forEach((c) => out.push({ ...c, type: 'conv' })); }
    if (buckets.yesterday.length) { out.push({ type: 'header', title: 'YESTERDAY' }); buckets.yesterday.forEach((c) => out.push({ ...c, type: 'conv' })); }
    if (buckets.week.length) { out.push({ type: 'header', title: 'THIS WEEK' }); buckets.week.forEach((c) => out.push({ ...c, type: 'conv' })); }
    if (buckets.month.length) { out.push({ type: 'header', title: 'LAST 30 DAYS' }); buckets.month.forEach((c) => out.push({ ...c, type: 'conv' })); }
    if (buckets.older.length) { out.push({ type: 'header', title: 'OLDER' }); buckets.older.forEach((c) => out.push({ ...c, type: 'conv' })); }
    return out;
  }, [convs, historyQuery]);

  const startRename = (c: Conv) => { setRenamingId(c.id); setRenameValue(c.title); };
  const commitRename = async (id: string) => {
    const val = renameValue.trim();
    setRenamingId(null);
    if (!val || val.length < 1) return;
    try {
      await api.aiwPatchConversation(id, { title: val });
      const r: any = await api.aiwConversations();
      setConvs(r.conversations);
    } catch {}
  };

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

  const pickAttachment = async () => {
    try {
      const r = await DocumentPicker.getDocumentAsync({ type: ['image/*', 'application/pdf', 'text/*', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'], multiple: false, copyToCacheDirectory: true });
      if (r.canceled) return;
      const f = r.assets?.[0]; if (!f) return;
      setInput((prev) => (prev ? prev + '\n' : '') + `[Attached: ${f.name}] `);
    } catch (e) { /* ignore */ }
  };

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
      {/* Header — clean, Manus-style */}
      <View style={s.header}>
        <Pressable testID="ai-history-btn" onPress={() => setShowHistory(true)} style={s.iconBtn}>
          <Ionicons name="menu-outline" size={20} color={theme.colors.brand} />
        </Pressable>
        <View style={{ flex: 1 }} />
        {/* Free plan | Upgrade chip */}
        <Pressable testID="ai-plan-chip" onPress={() => setShowPlans(true)} style={s.planChip}>
          <Text style={[s.planChipTextMuted, tier === 'free' && s.planChipTextActive]}>Free plan</Text>
          <Text style={s.planChipDivider}>|</Text>
          <Text style={s.planChipTextUpgrade}>Upgrade</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[{ paddingBottom: 200, flexGrow: 1 }, messages.length === 0 && s.centerContent]}
          keyboardShouldPersistTaps="handled"
        >
          {messages.length === 0 ? (
            <View style={s.welcome}>
              <BacheinAiLogo size={72} />
              <Text style={s.welcomeTitle}>What can I do for you?</Text>
            </View>
          ) : (
            <View style={{ padding: 20 }}>
              {messages.map((m, i) => (
                <View key={i} style={m.role === 'user' ? s.msgUser : s.msgAiWrap}>
                  {m.role === 'assistant' && (
                    <View style={s.aiHeaderRow}>
                      <BacheinAiLogo size={22} />
                      <Text style={s.aiName}>BacheIn</Text>
                    </View>
                  )}
                  {m.role === 'user' ? (
                    <Text style={s.msgUserText} selectable>{m.content}</Text>
                  ) : (
                    <View style={s.msgAi}>
                      <Text style={s.msgAiText} selectable>{m.content}</Text>
                    </View>
                  )}
                </View>
              ))}

              {sending && (
                <View style={s.msgAiWrap}>
                  <View style={s.aiHeaderRow}>
                    <BacheinAiLogo size={22} />
                    <Text style={s.aiName}>BacheIn</Text>
                  </View>
                  <View style={[s.msgAi, { paddingVertical: 14 }]}>
                    <DotsLoader />
                  </View>
                </View>
              )}

              {messages.length > 0 && !sending && messages[messages.length - 1]?.role === 'assistant' && (
                <Text style={s.convDisclaimer}>AI can make mistake, please check important info.</Text>
              )}
            </View>
          )}
        </ScrollView>

        {/* Composer — Manus-style: single rounded card with inline model selector + mic + send */}
        <View style={s.composerWrap}>
          <View style={s.composerCard}>
            <TextInput
              testID="ai-input"
              style={s.input}
              value={input}
              onChangeText={setInput}
              placeholder={voiceOn ? 'Listening…' : 'Ask BacheIn anything'}
              placeholderTextColor={theme.colors.muted}
              multiline
            />
            <View style={s.composerRow}>
              <Pressable testID="ai-attach-btn" onPress={pickAttachment} style={s.micBtn}>
                <Ionicons name="attach" size={16} color={theme.colors.brand} />
              </Pressable>
              <Pressable testID="ai-provider-btn" onPress={() => setShowProviderPicker(true)} style={s.modelChipInline}>
                <View style={s.modelDot} />
                <Text style={s.modelChipText}>{activeProvider?.name || 'Model'}</Text>
                <Ionicons name="chevron-down" size={11} color={theme.colors.brand} />
              </Pressable>
              <View style={{ flex: 1 }} />
              <Pressable testID="ai-mic-btn" onPress={voiceOn ? stopVoice : startVoice} style={[s.micBtn, voiceOn && s.micBtnOn]}>
                <Ionicons name={voiceOn ? 'stop' : 'mic-outline'} size={16} color={voiceOn ? '#fff' : theme.colors.brand} />
              </Pressable>
              <Pressable testID="ai-send-btn" style={[s.sendBtn, !canSend && s.sendBtnDisabled]} disabled={!canSend} onPress={() => send()}>
                <Ionicons name="arrow-up" size={16} color={canSend ? '#fff' : theme.colors.muted} />
              </Pressable>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* ============== Plans modal ============== */}
      <PlansSheet visible={showPlans} onClose={() => setShowPlans(false)} currentTier={tier as any} />

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

            {/* Search */}
            <View style={s.searchBar}>
              <Ionicons name="search" size={14} color={theme.colors.muted} />
              <TextInput
                testID="history-search"
                value={historyQuery}
                onChangeText={setHistoryQuery}
                placeholder="Search chats…"
                placeholderTextColor={theme.colors.muted}
                style={s.searchInput}
              />
              {!!historyQuery && (
                <Pressable onPress={() => setHistoryQuery('')}>
                  <Ionicons name="close-circle" size={14} color={theme.colors.muted} />
                </Pressable>
              )}
            </View>

            <FlatList
              data={groupedConvs}
              keyExtractor={(item, i) => item.type === 'header' ? `h-${item.title}-${i}` : `c-${(item as any).id}`}
              contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
              ListEmptyComponent={<Text style={s.emptyHist}>{historyQuery ? 'No matches' : 'No chats yet. Start one!'}</Text>}
              renderItem={({ item }) => {
                if (item.type === 'header') {
                  return <Text style={s.groupHeader}>{item.title}</Text>;
                }
                const c = item as any as Conv;
                const isRenaming = renamingId === c.id;
                return (
                  <View style={s.convRow} testID={`conv-${c.id}`}>
                    <Pressable style={{ flexDirection: 'row', flex: 1, alignItems: 'center', gap: 10 }} onPress={() => !isRenaming && openConv(c.id)}>
                      <View style={s.convIcon}><Ionicons name={c.pinned ? 'pin' : 'chatbubble-ellipses-outline'} size={14} color={theme.colors.brand} /></View>
                      <View style={{ flex: 1 }}>
                        {isRenaming ? (
                          <TextInput
                            testID={`rename-input-${c.id}`}
                            style={s.renameInput}
                            value={renameValue}
                            onChangeText={setRenameValue}
                            autoFocus
                            onSubmitEditing={() => commitRename(c.id)}
                            onBlur={() => commitRename(c.id)}
                          />
                        ) : (
                          <Text style={s.convTitle} numberOfLines={1}>{c.title}</Text>
                        )}
                        <Text style={s.convMeta}>{formatRelative(c.updated_at)} · {c.provider}</Text>
                      </View>
                    </Pressable>
                    <Pressable style={s.convAction} onPress={() => savePinned(c.id, !c.pinned)} testID={`pin-${c.id}`}>
                      <Ionicons name={c.pinned ? 'pin' : 'pin-outline'} size={16} color={c.pinned ? theme.colors.accent : theme.colors.muted} />
                    </Pressable>
                    <Pressable style={s.convAction} onPress={() => startRename(c)} testID={`rename-${c.id}`}>
                      <Ionicons name="pencil-outline" size={16} color={theme.colors.muted} />
                    </Pressable>
                    <Pressable style={s.convAction} onPress={() => deleteConv(c.id)} testID={`del-${c.id}`}>
                      <Ionicons name="trash-outline" size={16} color={theme.colors.muted} />
                    </Pressable>
                  </View>
                );
              }}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center' },
  planChip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border },
  planChipTextMuted: { color: theme.colors.muted, fontSize: 12, fontWeight: '500' },
  planChipTextActive: { color: theme.colors.brand },
  planChipTextUpgrade: { color: theme.colors.accent, fontSize: 12, fontWeight: '600' },
  planChipDivider: { color: theme.colors.borderStrong, fontSize: 12 },
  centerContent: { justifyContent: 'center', alignItems: 'center' },
  welcome: { alignItems: 'center', paddingHorizontal: 24 },
  welcomeTitle: { color: theme.colors.brand, fontSize: 28, fontWeight: '500', marginTop: 22, letterSpacing: -0.5, textAlign: 'center' },
  msgUser: { alignSelf: 'flex-end', maxWidth: '85%', paddingHorizontal: 16, paddingVertical: 11, borderRadius: 20, borderBottomRightRadius: 6, marginTop: 12, backgroundColor: theme.colors.brand },
  msgUserText: { color: '#fff', fontSize: 14, lineHeight: 20 },
  msgAiWrap: { alignSelf: 'flex-start', maxWidth: '95%', marginTop: 14 },
  msgAi: { paddingHorizontal: 0, paddingVertical: 6, marginTop: 4 },
  msgAiText: { color: theme.colors.brand, fontSize: 15, lineHeight: 22 },
  aiHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  aiName: { color: theme.colors.brand, fontSize: 13, letterSpacing: 0.2, fontWeight: '500' },
  aiDisclaimer: { color: theme.colors.muted, fontSize: 10, marginTop: 8, fontStyle: 'italic' },
  convDisclaimer: { color: theme.colors.muted, fontSize: 11, textAlign: 'center', marginTop: 20, fontStyle: 'italic' },
  composerWrap: { padding: 12, paddingBottom: 20, backgroundColor: theme.colors.surface },
  composerCard: { backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border, borderRadius: 24, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10 },
  input: { minHeight: 30, maxHeight: 140, color: theme.colors.brand, fontSize: 14, paddingVertical: 4 },
  composerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  modelChipInline: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
  modelDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: theme.colors.accent },
  modelChipText: { color: theme.colors.brand, fontSize: 11, fontWeight: '500' },
  micBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  micBtnOn: { backgroundColor: theme.colors.error, borderColor: theme.colors.error },
  sendBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.colors.brand, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border },
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
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 20, marginTop: 6, backgroundColor: theme.colors.card, borderRadius: 12, paddingHorizontal: 12, height: 40, borderWidth: 1, borderColor: theme.colors.border },
  searchInput: { flex: 1, color: theme.colors.brand, fontSize: 13, paddingVertical: 0 },
  groupHeader: { color: theme.colors.muted, fontSize: 10, letterSpacing: 1, fontWeight: '500', marginTop: 14, marginBottom: 6, paddingHorizontal: 4 },
  renameInput: { color: theme.colors.brand, fontSize: 13, fontWeight: '500', borderBottomWidth: 1, borderBottomColor: theme.colors.brand, paddingVertical: 2 },
});
