import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Platform, ActivityIndicator, FlatList, Image, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import { theme } from '@/src/theme';
import { getToken, api } from '@/src/api';
import { sharePdf } from '@/src/share';

let WebView: any = null;
if (Platform.OS !== 'web') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  WebView = require('react-native-webview').WebView;
}

/** Bachein PDF viewer — swipe pages horizontally (book-style). Params: url, name */
export default function ViewerScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { url, name } = useLocalSearchParams<{ url: string; name?: string }>();
  const [pages, setPages] = useState<string[] | null>(null);
  const [pageNo, setPageNo] = useState(1);
  const [fallbackSrc, setFallbackSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!url) return;
      const token = await getToken();
      const authed = `${url}${String(url).includes('?') ? '&' : '?'}token=${token}`;
      try {
        // Download PDF → render pages → horizontal swipe
        let b64 = '';
        if (Platform.OS === 'web') {
          const blob = await (await fetch(authed)).blob();
          b64 = await new Promise<string>((resolve, reject) => {
            const rd = new FileReader();
            rd.onload = () => resolve(String(rd.result || '').split(',')[1] || '');
            rd.onerror = reject;
            rd.readAsDataURL(blob);
          });
        } else {
          const dest = `${FileSystem.cacheDirectory}view-${Date.now()}.pdf`;
          const r = await FileSystem.downloadAsync(authed, dest);
          if (r.status && r.status !== 200) throw new Error(`Download failed (${r.status})`);
          b64 = await FileSystem.readAsStringAsync(r.uri, { encoding: 'base64' as any });
        }
        const res: any = await api.pdfPages(b64);
        if (!res.pages?.length) throw new Error('no pages');
        setPages(res.pages);
      } catch {
        // Fallback: embedded webview viewer
        if (Platform.OS === 'android') {
          setFallbackSrc(`https://docs.google.com/viewer?embedded=true&url=${encodeURIComponent(authed)}`);
        } else {
          setFallbackSrc(authed);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [url]);

  const doShare = async () => {
    if (!url) return;
    try { await sharePdf(String(url), String(name || 'document.pdf')); } catch {}
  };

  return (
    <SafeAreaView style={s.container} edges={['top']} testID="viewer-screen">
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.iconBtn} testID="viewer-back">
          <Ionicons name="chevron-back" size={22} color={theme.colors.brand} />
        </Pressable>
        <Text style={s.title} numberOfLines={1}>{name || 'Document'}</Text>
        {pages && <Text style={s.pageBadge}>{pageNo} / {pages.length}</Text>}
        <Pressable onPress={doShare} style={s.iconBtn} testID="viewer-share">
          <Ionicons name="share-outline" size={19} color={theme.colors.brand} />
        </Pressable>
      </View>
      <View style={{ flex: 1, backgroundColor: '#3c3f44' }}>
        {loading ? (
          <View style={s.center}><ActivityIndicator color="#fff" /><Text style={s.loadingText}>Opening…</Text></View>
        ) : pages ? (
          <FlatList
            data={pages}
            keyExtractor={(_, i) => String(i)}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) => setPageNo(Math.round(e.nativeEvent.contentOffset.x / width) + 1)}
            renderItem={({ item }) => (
              <View style={{ width, flex: 1, padding: 10, justifyContent: 'center' }}>
                <Image
                  source={{ uri: `data:image/jpeg;base64,${item}` }}
                  style={{ flex: 1, borderRadius: 6, backgroundColor: '#fff' }}
                  resizeMode="contain"
                />
              </View>
            )}
          />
        ) : fallbackSrc ? (
          Platform.OS === 'web' ? (
            React.createElement('iframe', {
              src: fallbackSrc,
              style: { border: 'none', width: '100%', height: '100%' },
              title: name || 'Document',
            })
          ) : (
            <WebView source={{ uri: fallbackSrc }} style={{ flex: 1 }} startInLoadingState />
          )
        ) : (
          <View style={s.center}><Text style={s.loadingText}>Could not open this document</Text></View>
        )}
        {pages && pages.length > 1 && (
          <View style={s.swipeHint} pointerEvents="none">
            <Ionicons name="chevron-back" size={13} color="rgba(255,255,255,0.7)" />
            <Text style={s.swipeText}>swipe</Text>
            <Ionicons name="chevron-forward" size={13} color="rgba(255,255,255,0.7)" />
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 8 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, color: theme.colors.brand, fontSize: 15, fontWeight: '500' },
  pageBadge: { color: theme.colors.muted, fontSize: 12, fontWeight: '600' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  loadingText: { color: 'rgba(255,255,255,0.8)', fontSize: 13 },
  swipeHint: { position: 'absolute', bottom: 14, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  swipeText: { color: 'rgba(255,255,255,0.8)', fontSize: 11 },
});
