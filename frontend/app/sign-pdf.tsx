import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Image, ScrollView, ActivityIndicator, PanResponder } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import Svg, { Path } from 'react-native-svg';
import { theme } from '@/src/theme';
import { api, uploadForm } from '@/src/api';
import { useToast } from '@/src/components/Toast';
import SignatureBottomSheet, { SignatureData } from '@/src/components/SignatureBottomSheet';
import { sharePdf } from '@/src/share';

const clamp = (v: number, a: number, b: number) => Math.min(Math.max(v, a), b);
const SIZES: { label: string; w: number }[] = [{ label: 'S', w: 0.22 }, { label: 'M', w: 0.32 }, { label: 'L', w: 0.45 }];

/** File Kit — Sign Document: upload PDF → draw/type/upload signature → drag into place → embed. */
export default function SignPdf() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState<{ session_id: string; pages: { image_base64: string; width: number; height: number }[]; total_pages: number } | null>(null);
  const [pageIdx, setPageIdx] = useState(0);
  const [sig, setSig] = useState<SignatureData | null>(null);
  const [sigOpen, setSigOpen] = useState(false);
  const [sizeW, setSizeW] = useState(0.32);
  const sizeWRef = useRef(0.32);
  const [pos, setPos] = useState({ x: 0.55, y: 0.78 });
  const posRef = useRef(pos);
  posRef.current = pos;
  const [disp, setDisp] = useState({ w: 0, h: 0 });
  const dispRef = useRef(disp);
  dispRef.current = disp;
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<{ download_id: string; name: string } | null>(null);
  const [err, setErr] = useState('');

  const pick = async () => {
    setErr('');
    try {
      const r = await DocumentPicker.getDocumentAsync({ type: ['application/pdf'], copyToCacheDirectory: true });
      if (r.canceled || !r.assets?.length) return;
      const a = r.assets[0];
      setBusy(true);
      const res: any = await uploadForm('/file-tools/sign-prepare', { uri: a.uri, name: a.name || 'document.pdf', type: 'application/pdf' });
      setSession(res);
      setPageIdx(0);
      setResult(null);
      setSig(null);
    } catch (e: any) { setErr(e.message || 'Could not read PDF'); }
    finally { setBusy(false); }
  };

  const startRef = useRef({ x: 0, y: 0 });
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => { startRef.current = { ...posRef.current }; },
      onPanResponderMove: (_, g) => {
        const d = dispRef.current;
        if (!d.w) return;
        setPos({
          x: clamp(startRef.current.x + g.dx / d.w, 0, 1 - sizeWRef.current),
          y: clamp(startRef.current.y + g.dy / d.h, 0, 0.96),
        });
      },
    })
  ).current;

  const embed = async () => {
    if (!session || !sig) return;
    setApplying(true);
    setErr('');
    try {
      const r: any = await api.signApply({
        session_id: session.session_id, page_index: pageIdx,
        x: pos.x, y: pos.y, w: sizeW,
        signature: { mode: sig.mode, paths: sig.paths, text: sig.text, image_b64: sig.image_b64 },
      });
      setResult(r);
      toast.show('Signature embedded into the PDF ✓', 'success');
    } catch (e: any) { setErr(e.message || 'Could not sign PDF'); }
    finally { setApplying(false); }
  };

  const page = session?.pages[pageIdx];
  const aspect = page ? page.width / page.height : 0.707;
  const boxW = disp.w * sizeW;
  const boxH = boxW * 0.38;

  return (
    <SafeAreaView style={s.container} edges={['top']} testID="sign-pdf-screen">
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.iconBtn} testID="sign-back">
          <Ionicons name="chevron-back" size={22} color={theme.colors.brand} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Sign Document</Text>
          <Text style={s.subtitle}>Place your signature anywhere — embedded into the PDF</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 140 }}>
        {!session && (
          <Pressable testID="sign-pick" style={[s.dropZone, busy && { opacity: 0.6 }]} disabled={busy} onPress={pick}>
            {busy ? <ActivityIndicator color={theme.colors.brand} /> : <Ionicons name="document-text-outline" size={32} color={theme.colors.muted} />}
            <Text style={s.dropTitle}>{busy ? 'Preparing pages…' : 'Upload a PDF to sign'}</Text>
            <Text style={s.dropSub}>PDF only · up to 12 pages shown for placement</Text>
          </Pressable>
        )}

        {!!err && <Text style={s.err}>{err}</Text>}

        {session && !result && page && (
          <>
            {/* page selector */}
            {session.pages.length > 1 && (
              <View style={s.pageRow}>
                <Pressable disabled={pageIdx === 0} onPress={() => setPageIdx(pageIdx - 1)} style={[s.pageBtn, pageIdx === 0 && { opacity: 0.35 }]} testID="sign-prev-page">
                  <Ionicons name="chevron-back" size={16} color={theme.colors.brand} />
                </Pressable>
                <Text style={s.pageLabel}>Page {pageIdx + 1} of {session.pages.length}</Text>
                <Pressable disabled={pageIdx >= session.pages.length - 1} onPress={() => setPageIdx(pageIdx + 1)} style={[s.pageBtn, pageIdx >= session.pages.length - 1 && { opacity: 0.35 }]} testID="sign-next-page">
                  <Ionicons name="chevron-forward" size={16} color={theme.colors.brand} />
                </Pressable>
              </View>
            )}

            {/* page + draggable signature */}
            <View
              style={[s.pageWrap, { aspectRatio: aspect }]}
              onLayout={(e) => setDisp({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
            >
              <Image source={{ uri: `data:image/jpeg;base64,${page.image_base64}` }} style={StyleSheet.absoluteFill} resizeMode="stretch" />
              {sig && disp.w > 0 && (
                <View
                  {...pan.panHandlers}
                  testID="sign-drag-box"
                  style={[s.sigBox, { left: pos.x * disp.w, top: pos.y * disp.h, width: boxW, height: boxH }]}
                >
                  <SigPreview sig={sig} w={boxW} h={boxH} />
                  <View style={s.dragHint}><Ionicons name="move" size={11} color="#fff" /></View>
                </View>
              )}
            </View>

            {!sig ? (
              <Pressable testID="sign-add-signature" style={s.primaryBtn} onPress={() => setSigOpen(true)}>
                <Ionicons name="create-outline" size={17} color={theme.colors.onBrandPrimary} />
                <Text style={s.primaryText}>Add signature</Text>
              </Pressable>
            ) : (
              <>
                <View style={s.sizeRow}>
                  <Text style={s.sizeLabel}>SIZE</Text>
                  {SIZES.map((sz) => (
                    <Pressable key={sz.label} testID={`sign-size-${sz.label}`} style={[s.sizeChip, sizeW === sz.w && s.sizeChipOn]} onPress={() => { setSizeW(sz.w); sizeWRef.current = sz.w; setPos((p) => ({ x: clamp(p.x, 0, 1 - sz.w), y: p.y })); }}>
                      <Text style={[s.sizeText, sizeW === sz.w && { color: '#fff' }]}>{sz.label}</Text>
                    </Pressable>
                  ))}
                  <View style={{ flex: 1 }} />
                  <Pressable testID="sign-change" onPress={() => setSigOpen(true)}>
                    <Text style={s.changeText}>Change signature</Text>
                  </Pressable>
                </View>
                <Text style={s.hint}>Drag the signature to where it should appear</Text>
                <Pressable testID="sign-embed" style={[s.primaryBtn, applying && { opacity: 0.6 }]} disabled={applying} onPress={embed}>
                  {applying ? <ActivityIndicator color={theme.colors.onBrandPrimary} /> : (
                    <><Ionicons name="checkmark-done-outline" size={17} color={theme.colors.onBrandPrimary} /><Text style={s.primaryText}>Embed signature & save</Text></>
                  )}
                </Pressable>
              </>
            )}
            <Pressable testID="sign-restart" style={s.linkBtn} onPress={() => { setSession(null); setSig(null); }}>
              <Text style={s.linkText}>Choose a different PDF</Text>
            </Pressable>
          </>
        )}

        {result && (
          <View style={s.doneCard}>
            <Ionicons name="checkmark-circle" size={44} color={theme.colors.success} />
            <Text style={s.doneTitle}>{result.name}.pdf</Text>
            <Text style={s.doneSub}>Signature embedded — saved to Downloads</Text>
            <Pressable testID="sign-open" style={[s.primaryBtn, { alignSelf: 'stretch' }]} onPress={() => router.push({ pathname: '/viewer', params: { url: api.downloadFileUrl(result.download_id), name: result.name } })}>
              <Ionicons name="eye-outline" size={17} color={theme.colors.onBrandPrimary} />
              <Text style={s.primaryText}>View signed PDF</Text>
            </Pressable>
            <Pressable testID="sign-share" style={s.secondaryBtn} onPress={() => sharePdf(api.downloadFileUrl(result.download_id), `${result.name}.pdf`).catch((e) => toast.show(e.message, 'error'))}>
              <Ionicons name="share-social-outline" size={16} color={theme.colors.brand} />
              <Text style={s.secondaryText}>Share</Text>
            </Pressable>
            <Pressable testID="sign-another" style={s.linkBtn} onPress={() => { setSession(null); setSig(null); setResult(null); }}>
              <Text style={s.linkText}>Sign another PDF</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      <SignatureBottomSheet
        visible={sigOpen}
        onClose={() => setSigOpen(false)}
        onDone={(d) => { setSig(d); setSigOpen(false); }}
        title="Your signature"
      />
    </SafeAreaView>
  );
}

/** Small live preview of the signature inside the draggable box. */
function SigPreview({ sig, w, h }: { sig: SignatureData; w: number; h: number }) {
  if (sig.mode === 'type' && sig.text) {
    return <Text style={{ fontSize: Math.min(22, h * 0.5), fontStyle: 'italic', color: '#1a1f59' }} numberOfLines={1}>{sig.text}</Text>;
  }
  if (sig.mode === 'upload' && sig.image_b64) {
    const uri = sig.image_b64.startsWith('data:') ? sig.image_b64 : `data:image/png;base64,${sig.image_b64}`;
    return <Image source={{ uri }} style={{ width: w - 8, height: h - 8 }} resizeMode="contain" />;
  }
  if (sig.mode === 'draw' && sig.paths?.length) {
    const nums = sig.paths.join(' ').match(/-?[\d.]+/g)?.map(Number) || [];
    const xs = nums.filter((_, i) => i % 2 === 0), ys = nums.filter((_, i) => i % 2 === 1);
    if (xs.length) {
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      return (
        <Svg width={w - 10} height={h - 10} viewBox={`${minX - 4} ${minY - 4} ${Math.max(10, maxX - minX + 8)} ${Math.max(10, maxY - minY + 8)}`} preserveAspectRatio="xMidYMid meet">
          {sig.paths.map((p, i) => <Path key={i} d={p} stroke="#1a1f59" strokeWidth={3} fill="none" strokeLinecap="round" />)}
        </Svg>
      );
    }
  }
  return <Ionicons name="create-outline" size={20} color="#1a1f59" />;
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10 },
  iconBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center' },
  title: { color: theme.colors.brand, fontSize: 20, fontWeight: '500' },
  subtitle: { color: theme.colors.muted, fontSize: 11.5, marginTop: 1 },
  dropZone: { borderWidth: 2, borderStyle: 'dashed', borderColor: theme.colors.border, borderRadius: 18, paddingVertical: 44, alignItems: 'center', gap: 8, backgroundColor: theme.colors.card },
  dropTitle: { color: theme.colors.brand, fontWeight: '500', fontSize: 15 },
  dropSub: { color: theme.colors.muted, fontSize: 12 },
  err: { color: theme.colors.error, fontSize: 13, marginTop: 12, textAlign: 'center' },
  pageRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, marginBottom: 10 },
  pageBtn: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  pageLabel: { color: theme.colors.brand, fontSize: 13, fontWeight: '500' },
  pageWrap: { width: '100%', borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: theme.colors.border, backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  sigBox: { position: 'absolute', borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#3b5bdb', borderRadius: 6, backgroundColor: 'rgba(59,91,219,0.07)', alignItems: 'center', justifyContent: 'center' },
  dragHint: { position: 'absolute', top: -9, right: -9, width: 20, height: 20, borderRadius: 10, backgroundColor: '#3b5bdb', alignItems: 'center', justifyContent: 'center' },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: theme.colors.brand, borderRadius: 14, paddingVertical: 15, marginTop: 16 },
  primaryText: { color: theme.colors.onBrandPrimary, fontWeight: '500', fontSize: 14.5 },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, paddingVertical: 13, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: '#fff', marginTop: 10, alignSelf: 'stretch' },
  secondaryText: { color: theme.colors.brand, fontWeight: '500', fontSize: 13.5 },
  sizeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 },
  sizeLabel: { color: theme.colors.muted, fontSize: 10, letterSpacing: 1, marginRight: 4 },
  sizeChip: { width: 36, height: 32, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  sizeChipOn: { backgroundColor: theme.colors.brand, borderColor: theme.colors.brand },
  sizeText: { color: theme.colors.brand, fontSize: 12.5, fontWeight: '600' },
  changeText: { color: theme.colors.accent, fontSize: 12.5, fontWeight: '500' },
  hint: { color: theme.colors.muted, fontSize: 12, marginTop: 10, textAlign: 'center' },
  linkBtn: { alignItems: 'center', marginTop: 16 },
  linkText: { color: theme.colors.muted, fontSize: 13, textDecorationLine: 'underline' },
  doneCard: { alignItems: 'center', gap: 8, backgroundColor: theme.colors.card, borderRadius: 18, borderWidth: 1, borderColor: theme.colors.border, padding: 26, marginTop: 8 },
  doneTitle: { color: theme.colors.brand, fontSize: 16, fontWeight: '600' },
  doneSub: { color: theme.colors.muted, fontSize: 12.5 },
});
