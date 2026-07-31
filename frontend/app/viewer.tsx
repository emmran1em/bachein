import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Platform, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { getToken } from '@/src/api';
import { sharePdf } from '@/src/share';

let WebView: any = null;
if (Platform.OS !== 'web') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  WebView = require('react-native-webview').WebView;
}

/** Bachein document viewer — opens PDFs / docs inside the app. Params: url, name */
export default function ViewerScreen() {
  const router = useRouter();
  const { url, name } = useLocalSearchParams<{ url: string; name?: string }>();
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!url) return;
      const token = await getToken();
      const authed = `${url}${String(url).includes('?') ? '&' : '?'}token=${token}`;
      if (Platform.OS === 'android') {
        // Android WebView cannot render PDFs natively — use Google viewer
        setSrc(`https://docs.google.com/viewer?embedded=true&url=${encodeURIComponent(authed)}`);
      } else {
        setSrc(authed);
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
        <Pressable onPress={doShare} style={s.iconBtn} testID="viewer-share">
          <Ionicons name="share-outline" size={19} color={theme.colors.brand} />
        </Pressable>
      </View>
      <View style={{ flex: 1, backgroundColor: '#3c3f44' }}>
        {!src ? (
          <View style={s.center}><ActivityIndicator color="#fff" /></View>
        ) : Platform.OS === 'web' ? (
          React.createElement('iframe', {
            src,
            style: { border: 'none', width: '100%', height: '100%' },
            title: name || 'Document',
          })
        ) : (
          <WebView
            source={{ uri: src }}
            style={{ flex: 1 }}
            onLoadEnd={() => setLoading(false)}
            startInLoadingState
            renderLoading={() => <View style={s.center}><ActivityIndicator color="#fff" /></View>}
          />
        )}
        {loading && Platform.OS !== 'web' && <View style={s.loadingBadge}><Text style={s.loadingText}>Opening…</Text></View>}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 8 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, color: theme.colors.brand, fontSize: 15, fontWeight: '500' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingBadge: { position: 'absolute', top: 10, alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  loadingText: { color: '#fff', fontSize: 11 },
});
