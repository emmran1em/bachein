import { View, Text, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';

export default function EditorPlaceholder() {
  const router = useRouter();
  return (
    <SafeAreaView style={s.container} edges={['top']} testID="editor-placeholder">
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.closeBtn} testID="back-button">
          <Ionicons name="chevron-back" size={22} color={theme.colors.brand} />
        </Pressable>
        <Text style={s.eyebrow}>WRITE DOCUMENT · AI EDITOR</Text>
      </View>
      <View style={s.body}>
        <Ionicons name="create-outline" size={48} color={theme.colors.accent} />
        <Text style={s.title}>Word-class AI editor</Text>
        <Text style={s.sub}>Coming in the next build: rich text, AI Command Bar, profession-mode assistants (Director / Lawyer / Teacher / Novelist), real-time collaboration, version history, PDF/DOCX export.</Text>
        <View style={s.card}>
          <Text style={s.cardLabel}>DOCUMENT TYPES</Text>
          {['Movie Story', 'Novel', 'Legal Agreement', 'NDA', 'Patent', 'Business Proposal', 'Investor Pitch', 'Research Paper', 'Teacher Question Paper', 'Resume', 'Meeting Notes'].map((t) => (
            <View style={s.chip} key={t}><Text style={s.chipText}>{t}</Text></View>
          ))}
        </View>
        <Pressable style={s.cta} onPress={() => router.push('/(tabs)/chat')} testID="use-ai-chat">
          <Ionicons name="sparkles" size={16} color={theme.colors.onBrandPrimary} />
          <Text style={s.ctaText}>Draft with Bachein AI meanwhile</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  closeBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border },
  eyebrow: { color: theme.colors.muted, fontSize: 11, letterSpacing: 1 },
  body: { padding: 24, alignItems: 'flex-start' },
  title: { color: theme.colors.brand, fontSize: 26, fontWeight: '500', marginTop: 16, letterSpacing: -0.5 },
  sub: { color: theme.colors.muted, marginTop: 10, lineHeight: 22 },
  card: { marginTop: 24, backgroundColor: theme.colors.card, padding: 16, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border, width: '100%' },
  cardLabel: { color: theme.colors.muted, fontSize: 10, letterSpacing: 1, marginBottom: 10 },
  chip: { backgroundColor: theme.colors.surfaceSecondary, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, alignSelf: 'flex-start', marginBottom: 6 },
  chipText: { color: theme.colors.brand, fontSize: 12 },
  cta: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: theme.colors.brand, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 999, marginTop: 20 },
  ctaText: { color: theme.colors.onBrandPrimary, fontWeight: '500' },
});
