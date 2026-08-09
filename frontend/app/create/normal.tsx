import { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { api } from '@/src/api';
import TemplatePicker from '@/src/components/TemplatePicker';

const SUBTYPES = ['Question Paper', 'Report', 'Notes', 'Presentation', 'Assignment', 'Summary'];

export default function NormalCreate() {
  const router = useRouter();
  const { category } = useLocalSearchParams<{ category: string }>();
  const [prompt, setPrompt] = useState('');
  const [subType, setSubType] = useState('Report');
  const [template, setTemplate] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ title: string; content: string; cover_page: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const generate = async () => {
    setErr(''); setLoading(true);
    try {
      const r: any = await api.generate({ prompt, category: category || 'Normal PDF', sub_type: subType, template: template || undefined });
      setResult(r);
    } catch (e: any) {
      setErr(e.message || 'Generation failed');
    } finally { setLoading(false); }
  };

  const save = async () => {
    if (!result) return;
    setSaving(true);
    try {
      const doc: any = await api.createDocument({
        title: result.title,
        category: category || 'Normal PDF',
        mode: 'normal',
        content: result.content,
      });
      router.replace(`/document/${doc.id}`);
    } catch (e: any) { setErr(e.message); } finally { setSaving(false); }
  };

  return (
    <SafeAreaView style={s.container} edges={['top']} testID="create-normal-screen">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View style={s.header}>
          <Pressable testID="back-button" onPress={() => router.back()} style={s.closeBtn}>
            <Ionicons name="chevron-back" size={22} color={theme.colors.brand} />
          </Pressable>
          <Text style={s.eyebrow}>{category} • AI</Text>
        </View>

        <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
          <Text style={s.title}>AI Document Generator</Text>
          <Text style={s.subtitle}>Describe what you need. Gemini will draft a complete document for you.</Text>

          <Text style={s.label}>Type</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
            {SUBTYPES.map(t => (
              <Pressable
                key={t}
                testID={`subtype-${t.replace(/\s+/g, '-').toLowerCase()}`}
                onPress={() => setSubType(t)}
                style={[s.chip, subType === t && s.chipActive, { flexShrink: 0 }]}>
                <Text style={[s.chipText, subType === t && s.chipTextActive]}>{t}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <Text style={s.label}>Your prompt</Text>
          <TextInput
            testID="ai-prompt-input"
            style={s.textArea}
            value={prompt}
            onChangeText={setPrompt}
            placeholder="e.g. Create a board exam 2026 most important question paper for Physics class 12"
            placeholderTextColor={theme.colors.muted}
            multiline
            numberOfLines={5}
          />

          <TemplatePicker category={category} selected={template} onSelect={setTemplate} />

          {err ? <Text style={s.err}>{err}</Text> : null}

          <Pressable testID="generate-btn" style={[s.primaryBtn, (!prompt || loading) && { opacity: 0.6 }]} onPress={generate} disabled={!prompt || loading}>
            {loading ? <ActivityIndicator color={theme.colors.onBrandPrimary} /> : (
              <><Ionicons name="sparkles" size={16} color={theme.colors.onBrandPrimary} /><Text style={s.primaryBtnText}>Generate with AI</Text></>
            )}
          </Pressable>

          {result && (
            <View style={s.resultCard} testID="ai-result">
              <Text style={s.resultLabel}>TITLE</Text>
              <Text style={s.resultTitle}>{result.title}</Text>
              <Text style={s.resultLabel}>COVER</Text>
              <Text style={s.resultBody}>{result.cover_page}</Text>
              <Text style={s.resultLabel}>CONTENT</Text>
              <Text style={s.resultBody}>{result.content.slice(0, 1200)}{result.content.length > 1200 ? '…' : ''}</Text>

              <Pressable testID="save-doc-btn" style={[s.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
                {saving ? <ActivityIndicator color={theme.colors.onBrandPrimary} /> : <Text style={s.saveBtnText}>Save Document</Text>}
              </Pressable>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
  closeBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border },
  eyebrow: { color: theme.colors.muted, fontSize: 11, letterSpacing: 1 },
  title: { fontSize: 26, color: theme.colors.brand, fontWeight: '500', letterSpacing: -0.5 },
  subtitle: { color: theme.colors.muted, marginTop: 6, lineHeight: 20 },
  label: { color: theme.colors.muted, fontSize: 11, letterSpacing: 1, marginTop: 24, marginBottom: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: theme.colors.border, height: 36, alignItems: 'center', justifyContent: 'center' },
  chipActive: { backgroundColor: theme.colors.brand, borderColor: theme.colors.brand },
  chipText: { color: theme.colors.brand, fontSize: 12 },
  chipTextActive: { color: theme.colors.onBrandPrimary, fontWeight: '500' },
  textArea: { backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border, borderRadius: 14, padding: 14, fontSize: 15, color: theme.colors.brand, minHeight: 130, textAlignVertical: 'top' },
  err: { color: theme.colors.error, marginTop: 12 },
  primaryBtn: { flexDirection: 'row', gap: 8, marginTop: 20, backgroundColor: theme.colors.brand, padding: 16, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: theme.colors.onBrandPrimary, fontWeight: '500', fontSize: 15 },
  resultCard: { backgroundColor: '#fff', borderRadius: 16, padding: 18, marginTop: 24, borderWidth: 1, borderColor: theme.colors.border },
  resultLabel: { color: theme.colors.muted, fontSize: 11, letterSpacing: 1, marginTop: 12 },
  resultTitle: { color: theme.colors.brand, fontSize: 18, fontWeight: '500', marginTop: 4 },
  resultBody: { color: theme.colors.onSurfaceSecondary, marginTop: 4, lineHeight: 20 },
  saveBtn: { backgroundColor: theme.colors.brandSecondary, padding: 14, borderRadius: 12, marginTop: 18, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: '500' },
});
