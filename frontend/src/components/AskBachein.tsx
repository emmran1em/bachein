import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Modal, TextInput, ScrollView, Animated, Easing, ActivityIndicator, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { api } from '@/src/api';
import ThinkingLoader from './ThinkingLoader';

const STYLES = [
  { id: 'simple', label: 'Simple', icon: 'sparkles-outline' as const },
  { id: 'eli5', label: "ELI5", icon: 'happy-outline' as const },
  { id: 'detailed', label: 'Detailed', icon: 'library-outline' as const },
  { id: 'technical', label: 'Technical', icon: 'construct-outline' as const },
];

export default function AskBachein({
  visible,
  onClose,
  initialText,
  context,
}: {
  visible: boolean;
  onClose: () => void;
  initialText?: string;
  context?: string;
}) {
  const [text, setText] = useState(initialText || '');
  const [style, setStyle] = useState<'simple' | 'eli5' | 'detailed' | 'technical'>('simple');
  const [busy, setBusy] = useState(false);
  const [explanation, setExplanation] = useState<string>('');
  const [err, setErr] = useState('');
  const float = useRef(new Animated.Value(0)).current;

  useEffect(() => { setText(initialText || ''); }, [initialText]);
  useEffect(() => {
    if (visible) {
      Animated.timing(float, { toValue: 1, duration: 350, easing: Easing.out(Easing.back(1.3)), useNativeDriver: true }).start();
    } else {
      float.setValue(0);
      setExplanation(''); setErr(''); setBusy(false);
    }
  }, [visible, float]);

  const ask = async () => {
    if (!text.trim()) { setErr('Please enter or select something to explain'); return; }
    setBusy(true); setErr(''); setExplanation('');
    try {
      const r: any = await api.aiwExplain({ text: text.trim(), style, context });
      setExplanation(r.explanation);
    } catch (e: any) { setErr(e.message || 'AI failed to explain'); }
    finally { setBusy(false); }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.overlay}>
        <Pressable style={s.backdrop} onPress={onClose} />
        <Animated.View
          style={[s.bubble, {
            opacity: float,
            transform: [{ translateY: float.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) }, { scale: float.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }],
          }]}
        >
          <View style={s.head}>
            <View style={s.headIcon}><Ionicons name="sparkles" size={16} color={theme.colors.brand} /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.headTitle}>Ask BacheIn</Text>
              <Text style={s.headSub}>Explain the selection in your own words</Text>
            </View>
            <Pressable onPress={onClose} style={s.closeBtn}>
              <Ionicons name="close" size={18} color={theme.colors.brand} />
            </Pressable>
          </View>

          {/* Style selector */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 4, paddingVertical: 4 }}>
            {STYLES.map((st) => (
              <Pressable
                key={st.id}
                testID={`explain-style-${st.id}`}
                onPress={() => setStyle(st.id as any)}
                style={[s.styleChip, style === st.id && s.styleChipActive]}
              >
                <Ionicons name={st.icon} size={12} color={style === st.id ? '#fff' : theme.colors.brand} />
                <Text style={[s.styleText, style === st.id && s.styleTextActive]}>{st.label}</Text>
              </Pressable>
            ))}
          </ScrollView>

          {/* Selection preview / input */}
          <TextInput
            testID="ask-bachein-input"
            style={s.textArea}
            value={text}
            onChangeText={setText}
            placeholder="Paste or type what you'd like BacheIn to explain…"
            placeholderTextColor={theme.colors.muted}
            multiline
          />

          {/* Ask button */}
          {!explanation && !busy && (
            <Pressable testID="ask-bachein-btn" style={[s.askBtn, !text.trim() && { opacity: 0.4 }]} onPress={ask} disabled={!text.trim()}>
              <Ionicons name="sparkles" size={14} color="#fff" />
              <Text style={s.askText}>Ask BacheIn</Text>
            </Pressable>
          )}

          {busy && (
            <View style={{ padding: 12 }}>
              <ThinkingLoader mode="thinking" />
            </View>
          )}

          {!!explanation && (
            <ScrollView style={s.resultBox} contentContainerStyle={{ padding: 4 }}>
              <Text style={s.explanation} selectable>{explanation}</Text>
              <Text style={s.disclaimer}>AI can make mistakes. Please double-check important information.</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                <Pressable style={s.smallBtn} onPress={() => { setExplanation(''); }}>
                  <Ionicons name="refresh" size={12} color={theme.colors.brand} />
                  <Text style={s.smallBtnText}>Ask again</Text>
                </Pressable>
                <Pressable style={[s.smallBtn, { backgroundColor: theme.colors.brand }]} onPress={onClose}>
                  <Text style={[s.smallBtnText, { color: '#fff' }]}>Done</Text>
                </Pressable>
              </View>
            </ScrollView>
          )}

          {!!err && <Text style={s.err}>{err}</Text>}
        </Animated.View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end', padding: 16, paddingBottom: 32 },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  bubble: { backgroundColor: theme.colors.surface, borderRadius: 24, padding: 18, maxHeight: '75%', ...Platform.select({ web: { boxShadow: '0 10px 30px rgba(0,0,0,0.15)' } as any, default: { elevation: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.15, shadowRadius: 20 } }) },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  headIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center' },
  headTitle: { color: theme.colors.brand, fontSize: 15, fontWeight: '500' },
  headSub: { color: theme.colors.muted, fontSize: 11, marginTop: 1 },
  closeBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border },
  styleChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: '#fff', marginRight: 6 },
  styleChipActive: { backgroundColor: theme.colors.brand, borderColor: theme.colors.brand },
  styleText: { color: theme.colors.brand, fontSize: 11, fontWeight: '500' },
  styleTextActive: { color: '#fff' },
  textArea: { marginTop: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, padding: 12, minHeight: 80, maxHeight: 140, color: theme.colors.brand, fontSize: 13, textAlignVertical: 'top' as any },
  askBtn: { marginTop: 14, backgroundColor: theme.colors.brand, borderRadius: 12, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  askText: { color: '#fff', fontWeight: '500', fontSize: 14 },
  resultBox: { marginTop: 14, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, padding: 12, maxHeight: 300 },
  explanation: { color: theme.colors.brand, fontSize: 13, lineHeight: 20 },
  disclaimer: { color: theme.colors.muted, fontSize: 10, marginTop: 8, fontStyle: 'italic' },
  smallBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: '#fff' },
  smallBtnText: { color: theme.colors.brand, fontSize: 11, fontWeight: '500' },
  err: { color: theme.colors.error, marginTop: 10, fontSize: 12 },
});
