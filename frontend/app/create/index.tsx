import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';

const CATEGORIES = [
  { name: 'Normal PDF', icon: 'sparkles', secure: false, desc: 'AI document generator' },
  { name: 'NDA', icon: 'shield-checkmark', secure: true, desc: 'Non-disclosure agreement' },
  { name: 'Patent / IP Agreement', icon: 'bulb', secure: true, desc: 'IP protection' },
  { name: 'Legal Documents', icon: 'briefcase', secure: true, desc: 'Contracts & legal' },
  { name: 'Confidential Documents', icon: 'lock-closed', secure: true, desc: 'Top-secret material' },
  { name: 'Financial Reports', icon: 'cash', secure: true, desc: 'Financial statements' },
  { name: 'Organization Documents', icon: 'business', secure: true, desc: 'Corporate docs' },
  { name: 'Employment Agreements', icon: 'people', secure: true, desc: 'HR contracts' },
  { name: 'Freelancer Agreements', icon: 'person', secure: true, desc: 'Contractor terms' },
  { name: 'Investor Agreements', icon: 'trending-up', secure: true, desc: 'SAFE / Term sheets' },
  { name: 'Manufacturing Agreements', icon: 'cube', secure: true, desc: 'Supplier contracts' },
  { name: 'Secure PDF', icon: 'document-lock', secure: true, desc: 'Custom secure doc' },
];

export default function CreatePicker() {
  const router = useRouter();
  return (
    <SafeAreaView style={s.container} edges={['top']} testID="create-picker-screen">
      <View style={s.header}>
        <Pressable testID="create-close" onPress={() => router.back()} style={s.closeBtn}>
          <Ionicons name="close" size={22} color={theme.colors.brand} />
        </Pressable>
        <Text style={s.eyebrow}>CREATE</Text>
      </View>
      <View style={{ paddingHorizontal: 24, marginBottom: 12 }}>
        <Text style={s.title}>What would you like to create?</Text>
        <Text style={s.subtitle}>Choose a category to begin. Secure documents are encrypted and require verification.</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 }}>
        <View style={s.grid}>
          {CATEGORIES.map(cat => (
            <Pressable
              key={cat.name}
              testID={`category-${cat.name.replace(/\s+/g, '-').toLowerCase()}`}
              style={[s.tile, !cat.secure && s.tileAccent]}
              onPress={() => {
                router.push({ pathname: '/create/mode', params: { category: cat.name, secure: cat.secure ? '1' : '0' } });
              }}
            >
              <View style={s.tileTop}>
                <Ionicons name={cat.icon as any} size={22} color={cat.secure ? theme.colors.brand : theme.colors.brandSecondary} />
                {cat.secure ? (
                  <View style={s.tag}><Text style={s.tagText}>SECURE</Text></View>
                ) : (
                  <View style={[s.tag, { backgroundColor: '#FBE6DC' }]}><Text style={[s.tagText, { color: theme.colors.brandSecondary }]}>AI</Text></View>
                )}
              </View>
              <Text style={s.tileTitle} numberOfLines={2}>{cat.name}</Text>
              <Text style={s.tileDesc}>{cat.desc}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 },
  closeBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border },
  eyebrow: { color: theme.colors.muted, fontSize: 11, letterSpacing: 1 },
  title: { fontSize: 26, color: theme.colors.brand, fontWeight: '500', letterSpacing: -0.5, lineHeight: 32 },
  subtitle: { color: theme.colors.muted, marginTop: 8, lineHeight: 20 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: '48.5%', backgroundColor: '#fff', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: theme.colors.border, minHeight: 130 },
  tileAccent: { borderColor: theme.colors.brandSecondary, backgroundColor: '#FFFAF6' },
  tileTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tag: { backgroundColor: '#F0F0EE', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  tagText: { fontSize: 9, fontWeight: '500', color: theme.colors.muted, letterSpacing: 0.5 },
  tileTitle: { color: theme.colors.brand, fontWeight: '500', fontSize: 14, marginTop: 16 },
  tileDesc: { color: theme.colors.muted, fontSize: 11, marginTop: 4 },
});
