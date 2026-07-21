import { View, Text, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';

export default function GithubWorkspace() {
  const router = useRouter();
  return (
    <SafeAreaView style={s.container} edges={['top']} testID="github-placeholder">
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.closeBtn} testID="back-button">
          <Ionicons name="chevron-back" size={22} color={theme.colors.brand} />
        </Pressable>
        <Text style={s.eyebrow}>GITHUB WORKSPACE</Text>
      </View>
      <View style={s.body}>
        <Ionicons name="logo-github" size={48} color={theme.colors.brand} />
        <Text style={s.title}>Connect your GitHub</Text>
        <Text style={s.sub}>Browse repos, view files with syntax highlighting, and ask Bachein AI about your code — all inside Bachein.</Text>
        <View style={s.card}>
          <Text style={s.cardLabel}>WHAT YOU'LL GET</Text>
          <Row icon="folder-open-outline" text="Repository & folder browser" />
          <Row icon="code-slash-outline" text="Syntax-highlighted code viewer" />
          <Row icon="sparkles-outline" text="AI understands your repo context" />
          <Row icon="bug-outline" text="Explain, refactor, document code" />
        </View>
        <Pressable style={s.cta} testID="connect-github-btn" disabled>
          <Ionicons name="logo-github" size={16} color={theme.colors.onBrandPrimary} />
          <Text style={s.ctaText}>Connect GitHub (coming next build)</Text>
        </Pressable>
        <Text style={s.note}>OAuth credentials configured. Full connector shipping in the next session.</Text>
      </View>
    </SafeAreaView>
  );
}

function Row({ icon, text }: { icon: any; text: string }) {
  return (
    <View style={s.row}><Ionicons name={icon} size={16} color={theme.colors.brand} /><Text style={s.rowText}>{text}</Text></View>
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
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  rowText: { color: theme.colors.brand, fontSize: 13 },
  cta: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: theme.colors.brand, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 999, marginTop: 20, opacity: 0.6 },
  ctaText: { color: theme.colors.onBrandPrimary, fontWeight: '500' },
  note: { color: theme.colors.muted, fontSize: 11, marginTop: 12, fontStyle: 'italic' },
});
