import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Image, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { theme } from '@/src/theme';
import { api, uploadFile } from '@/src/api';
import { useToast } from '@/src/components/Toast';
import { playSent } from '@/src/lib/sound';
import { scanStore } from '@/src/lib/scanStore';

export default function CreateMode() {
  const router = useRouter();
  const toast = useToast();
  const { category, secure } = useLocalSearchParams<{ category: string; secure: string }>();
  const isSecure = secure === '1';
  const [showUpload, setShowUpload] = useState(false);
  const [busy, setBusy] = useState(false);
  const [captured, setCaptured] = useState<Array<{ name: string; uri: string; mime: string }>>([]);

  const draftWithAi = () => {
    if (isSecure) router.replace({ pathname: '/create/secure', params: { category } });
    else router.replace({ pathname: '/create/normal', params: { category } });
  };

  const writeOwn = () => {
    router.replace({ pathname: '/editor', params: {} as any });
  };

  // Professional scanner flow: capture → edge detect → review/crop → pages come back here
  const takePhoto = () => {
    router.push('/scanner?return=create');
  };

  // Consume pages handed back by the scanner
  useFocusEffect(
    useCallback(() => {
      (async () => {
        const pages = scanStore.consume();
        if (!pages.length) return;
        const items: { name: string; uri: string; mime: string }[] = [];
        for (const b64 of pages) {
          let uri = `data:image/jpeg;base64,${b64}`;
          if (Platform.OS !== 'web') {
            const dest = `${FileSystem.cacheDirectory}scan-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.jpg`;
            await FileSystem.writeAsStringAsync(dest, b64, { encoding: 'base64' as any });
            uri = dest;
          }
          items.push({ name: `scan-${Date.now()}.jpg`, uri, mime: 'image/jpeg' });
        }
        setCaptured((c) => [...c, ...items]);
        setShowUpload(true);
        toast.show(`${items.length} scanned page${items.length > 1 ? 's' : ''} added ✓`, 'success');
      })();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  const pickFromGallery = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'image/*'],
        multiple: true, copyToCacheDirectory: true,
      });
      if (res.canceled) return;
      const items = res.assets.map((a) => ({ name: a.name, uri: a.uri, mime: a.mimeType || 'application/octet-stream' }));
      setCaptured((c) => [...c, ...items]);
    } catch (e: any) { toast.show(e.message, 'error'); }
  };

  const uploadAll = async () => {
    if (captured.length === 0) { toast.show('Add a photo or file first', 'error'); return; }
    setBusy(true);
    try {
      const uploaded: any[] = [];
      for (const f of captured) {
        const up: any = await uploadFile({ uri: f.uri, name: f.name, type: f.mime });
        uploaded.push({ name: up.filename, type: up.content_type, size: up.size, extracted_text: up.extracted_text_preview });
      }
      if (isSecure) {
        // Hand off to secure flow so user can add security config + recipient
        router.replace({ pathname: '/create/secure', params: { category, prefill: JSON.stringify(uploaded) } });
      } else {
        // Save as a normal doc directly
        const title = captured[0].name.replace(/\.[^.]+$/, '');
        const doc: any = await api.createDocument({
          title, category: category || 'Normal PDF', mode: 'normal',
          content: `Uploaded: ${uploaded.map((u) => u.name).join(', ')}`,
          attached_files: uploaded,
        });
        playSent();
        toast.show('Saved to your documents ✓', 'success');
        router.replace(`/document/${doc.id}`);
      }
    } catch (e: any) { toast.show(e.message, 'error'); }
    finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={s.container} edges={['top']} testID="create-mode-screen">
      <View style={s.header}>
        <Pressable testID="back-button" onPress={() => router.back()} style={s.closeBtn}>
          <Ionicons name="chevron-back" size={22} color={theme.colors.brand} />
        </Pressable>
        <Text style={s.eyebrow}>{category?.toUpperCase()}</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 120 }}>
        {!showUpload ? (
          <>
            <Text style={s.title}>How do you want to create it?</Text>
            <Text style={s.subtitle}>Choose an approach — you can always switch later.</Text>

            <Pressable testID="mode-draft" style={s.optionCard} onPress={draftWithAi}>
              <View style={[s.optIcon, { backgroundColor: '#FBE6DC' }]}>
                <Ionicons name="sparkles" size={22} color={theme.colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.optTitle}>Draft with AI</Text>
                <Text style={s.optDesc}>Bachein AI writes the {category} for you based on your intent.</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} />
            </Pressable>

            <Pressable testID="mode-write" style={s.optionCard} onPress={writeOwn}>
              <View style={[s.optIcon, { backgroundColor: theme.colors.surfaceSecondary }]}>
                <Ionicons name="create-outline" size={22} color={theme.colors.brand} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.optTitle}>Write on your own</Text>
                <Text style={s.optDesc}>Open the Bachein editor with formatting, AI command bar, and collaborators.</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} />
            </Pressable>

            <Pressable testID="mode-upload" style={s.optionCard} onPress={() => setShowUpload(true)}>
              <View style={[s.optIcon, { backgroundColor: '#EAF3EE' }]}>
                <Ionicons name="cloud-upload-outline" size={22} color={theme.colors.success} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.optTitle}>Upload existing</Text>
                <Text style={s.optDesc}>Scan with camera or attach files from your device.</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} />
            </Pressable>
          </>
        ) : (
          <>
            <Text style={s.title}>Add your document</Text>
            <Text style={s.subtitle}>Capture with camera, or upload a PDF / DOCX / image from your device.</Text>

            <Pressable testID="capture-camera-btn" style={s.uploadCard} onPress={takePhoto}>
              <Ionicons name="camera-outline" size={28} color={theme.colors.brand} />
              <Text style={s.uploadTitle}>Take a photo of the document</Text>
              <Text style={s.uploadSub}>Use your camera to scan a printed page</Text>
            </Pressable>

            <Pressable testID="pick-gallery-btn" style={s.uploadCard} onPress={pickFromGallery}>
              <Ionicons name="images-outline" size={28} color={theme.colors.brand} />
              <Text style={s.uploadTitle}>Upload from your device</Text>
              <Text style={s.uploadSub}>PDF, DOCX, XLSX, PPTX, images</Text>
            </Pressable>

            {captured.length > 0 && (
              <View style={{ marginTop: 20 }}>
                <Text style={s.label}>ATTACHED ({captured.length})</Text>
                {captured.map((f, i) => (
                  <View key={i} style={s.fileRow} testID={`captured-${i}`}>
                    {f.mime.startsWith('image/') ? (
                      <Image source={{ uri: f.uri }} style={s.thumb} />
                    ) : (
                      <View style={s.docIcon}><Ionicons name="document" size={18} color={theme.colors.brand} /></View>
                    )}
                    <Text style={s.fileName} numberOfLines={1}>{f.name}</Text>
                    <Pressable testID={`remove-${i}`} onPress={() => setCaptured((c) => c.filter((_, j) => j !== i))}>
                      <Ionicons name="close-circle" size={18} color={theme.colors.muted} />
                    </Pressable>
                  </View>
                ))}
              </View>
            )}

            <Pressable testID="upload-next-btn" style={[s.primaryBtn, (busy || captured.length === 0) && { opacity: 0.5 }]} onPress={uploadAll} disabled={busy || captured.length === 0}>
              {busy ? <ActivityIndicator color={theme.colors.onBrandPrimary} /> : (
                <><Ionicons name="arrow-forward" size={16} color={theme.colors.onBrandPrimary} /><Text style={s.primaryBtnText}>{isSecure ? 'Continue to security' : 'Save document'}</Text></>
              )}
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8 },
  closeBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border },
  eyebrow: { color: theme.colors.muted, fontSize: 11, letterSpacing: 1 },
  title: { fontSize: 24, color: theme.colors.brand, fontWeight: '500', letterSpacing: -0.5 },
  subtitle: { color: theme.colors.muted, marginTop: 8, lineHeight: 20 },
  optionCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: theme.colors.card, padding: 16, borderRadius: 16, borderWidth: 1, borderColor: theme.colors.border, marginTop: 12 },
  optIcon: { width: 46, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  optTitle: { color: theme.colors.brand, fontWeight: '500', fontSize: 15 },
  optDesc: { color: theme.colors.muted, fontSize: 12, marginTop: 3, lineHeight: 16 },
  uploadCard: { backgroundColor: theme.colors.card, padding: 24, borderRadius: 16, borderWidth: 2, borderColor: theme.colors.border, borderStyle: 'dashed', alignItems: 'center', marginTop: 14, gap: 6 },
  uploadTitle: { color: theme.colors.brand, fontWeight: '500', fontSize: 15, marginTop: 6 },
  uploadSub: { color: theme.colors.muted, fontSize: 12 },
  label: { color: theme.colors.muted, fontSize: 10, letterSpacing: 1, marginBottom: 8 },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: theme.colors.card, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, marginBottom: 8 },
  thumb: { width: 32, height: 32, borderRadius: 8 },
  docIcon: { width: 32, height: 32, borderRadius: 8, backgroundColor: theme.colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center' },
  fileName: { flex: 1, color: theme.colors.brand, fontSize: 13 },
  primaryBtn: { flexDirection: 'row', gap: 8, marginTop: 24, backgroundColor: theme.colors.brand, padding: 16, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: theme.colors.onBrandPrimary, fontWeight: '500', fontSize: 15 },
});
