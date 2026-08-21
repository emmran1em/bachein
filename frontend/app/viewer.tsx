import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Platform, ActivityIndicator, FlatList, Image, useWindowDimensions, Modal, PanResponder, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import Svg, { Polyline } from 'react-native-svg';
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
  // ── circle-to-explain (pointer mode) ──
  const [pointerOn, setPointerOn] = useState(false);
  const [stroke, setStroke] = useState<number[][]>([]);
  const strokeRef = useRef<number[][]>([]);
  const [expl, setExpl] = useState<string | null>(null);
  const [explBusy, setExplBusy] = useState(false);
  const [imgDim, setImgDim] = useState<{ w: number; h: number } | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const boxRef = useRef(box);
  boxRef.current = box;
  const pageNoRef = useRef(1);
  const pagesRef = useRef<string[] | null>(null);
  pagesRef.current = pages;

  const explain = async (points: number[][]) => {
    const b = boxRef.current;
    const dims = imgDim;
    const pgs = pagesRef.current;
    if (!pgs || !b.w || points.length < 3) return;
    // displayed page fit rect (contain, 10px padding)
    let fx = 10, fy = 10, fw = b.w - 20, fh = b.h - 20;
    if (dims) {
      const scale = Math.min((b.w - 20) / dims.w, (b.h - 20) / dims.h);
      fw = dims.w * scale; fh = dims.h * scale;
      fx = (b.w - fw) / 2; fy = (b.h - fh) / 2;
    }
    const xs = points.map((p) => p[0]); const ys = points.map((p) => p[1]);
    const bbox = [
      Math.max(0, (Math.min(...xs) - fx) / fw), Math.max(0, (Math.min(...ys) - fy) / fh),
      Math.min(1, (Math.max(...xs) - fx) / fw), Math.min(1, (Math.max(...ys) - fy) / fh),
    ];
    setExplBusy(true); setExpl('');
    try {
      const r: any = await api.viewerExplain({ image_base64: pgs[pageNoRef.current - 1], bbox });
      setExpl(r.explanation || 'No explanation found.');
    } catch (e: any) { setExpl(e.message || 'Could not explain this selection.'); }
    finally { setExplBusy(false); }
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        const { locationX, locationY } = e.nativeEvent;
        strokeRef.current = [[locationX, locationY]];
        setStroke([...strokeRef.current]);
      },
      onPanResponderMove: (e) => {
        const { locationX, locationY } = e.nativeEvent;
        strokeRef.current = [...strokeRef.current, [locationX, locationY]];
        setStroke([...strokeRef.current]);
      },
      onPanResponderRelease: () => {
        const pts = strokeRef.current;
        strokeRef.current = [];
        setStroke([]);
        explain(pts);
      },
    })
  ).current;

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
        Image.getSize(`data:image/jpeg;base64,${res.pages[0]}`, (w, h) => setImgDim({ w, h }), () => {});
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
        {pages && (
          <Pressable
            testID="viewer-pointer"
            onPress={() => { setPointerOn((v) => !v); setExpl(null); }}
            style={[s.iconBtn, pointerOn && { backgroundColor: theme.colors.brand }]}
          >
            <Ionicons name="color-wand-outline" size={18} color={pointerOn ? '#fff' : theme.colors.brand} />
          </Pressable>
        )}
        <Pressable onPress={doShare} style={s.iconBtn} testID="viewer-share">
          <Ionicons name="share-outline" size={19} color={theme.colors.brand} />
        </Pressable>
      </View>
      {pointerOn && (
        <View style={s.pointerHint}>
          <Ionicons name="ellipse-outline" size={13} color={theme.colors.brand} />
          <Text style={s.pointerHintText}>Circle any word — Bachein explains it</Text>
        </View>
      )}
      <View style={{ flex: 1, backgroundColor: '#3c3f44' }} onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        {loading ? (
          <View style={s.center}><ActivityIndicator color="#fff" /><Text style={s.loadingText}>Opening…</Text></View>
        ) : pages ? (
          <FlatList
            data={pages}
            keyExtractor={(_, i) => String(i)}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) => { const n = Math.round(e.nativeEvent.contentOffset.x / width) + 1; setPageNo(n); pageNoRef.current = n; }}
            scrollEnabled={!pointerOn}
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
        {/* pointer capture layer */}
        {pointerOn && pages && (
          <View style={StyleSheet.absoluteFill} {...pan.panHandlers}>
            <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
              {stroke.length > 1 && (
                <Polyline points={stroke.map(([x, y]) => `${x},${y}`).join(' ')} stroke="#ffd60a" strokeWidth={3.5} fill="rgba(255,214,10,0.12)" strokeLinecap="round" />
              )}
            </Svg>
          </View>
        )}
      </View>

      {/* explanation half-sheet */}
      <Modal visible={expl !== null} transparent animationType="slide" onRequestClose={() => setExpl(null)}>
        <View style={s.explOverlay}>
          <Pressable style={{ flex: 1 }} onPress={() => setExpl(null)} />
          <View style={s.explSheet} testID="explain-sheet">
            <View style={s.explHandle} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="sparkles" size={16} color={theme.colors.accent} />
              <Text style={s.explTitle}>Bachein explains</Text>
              <View style={{ flex: 1 }} />
              <Pressable onPress={() => setExpl(null)} testID="explain-close">
                <Ionicons name="close" size={20} color={theme.colors.muted} />
              </Pressable>
            </View>
            {explBusy ? (
              <View style={{ paddingVertical: 30, alignItems: 'center', gap: 8 }}>
                <ActivityIndicator color={theme.colors.brand} />
                <Text style={{ color: theme.colors.muted, fontSize: 12.5 }}>Reading your selection…</Text>
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 300 }} contentContainerStyle={{ paddingVertical: 12 }}>
                <Text style={s.explBody}>{expl}</Text>
                <Text style={s.explDisclaimer}>AI can make mistake, please check important info.</Text>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
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
  pointerHint: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 6, backgroundColor: '#FFF8E1' },
  pointerHintText: { color: theme.colors.brand, fontSize: 12, fontWeight: '500' },
  explOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  explSheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 30, minHeight: 220 },
  explHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: theme.colors.border, alignSelf: 'center', marginBottom: 12 },
  explTitle: { color: theme.colors.brand, fontSize: 15, fontWeight: '600' },
  explBody: { color: theme.colors.onSurfaceSecondary, fontSize: 14, lineHeight: 21 },
  explDisclaimer: { color: theme.colors.muted, fontSize: 10.5, marginTop: 14 },
});
