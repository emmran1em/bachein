import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Image, Modal, ActivityIndicator, PanResponder } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { api } from '@/src/api';
import SignatureBottomSheet, { SignatureData } from '@/src/components/SignatureBottomSheet';

const clamp = (v: number, a: number, b: number) => Math.min(Math.max(v, a), b);

/** Sign directly on a scanned page — drag the signature into place, backend embeds it. */
export default function PageSign({ visible, image, onClose, onApply }: {
  visible: boolean;
  image: string; // base64
  onClose: () => void;
  onApply: (newB64: string) => void;
}) {
  const [sig, setSig] = useState<SignatureData | null>(null);
  const [sheetOpen, setSheetOpen] = useState(true);
  const [pos, setPos] = useState({ x: 0.55, y: 0.8 });
  const posRef = useRef(pos);
  posRef.current = pos;
  const [busy, setBusy] = useState(false);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const boxRef = useRef(box);
  boxRef.current = box;
  const W = 0.32;

  const startRef = useRef({ x: 0, y: 0 });
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => { startRef.current = { ...posRef.current }; },
      onPanResponderMove: (_, g) => {
        const b = boxRef.current;
        if (!b.w) return;
        setPos({
          x: clamp(startRef.current.x + g.dx / b.w, 0, 1 - W),
          y: clamp(startRef.current.y + g.dy / b.h, 0, 0.95),
        });
      },
    })
  ).current;

  const apply = async () => {
    if (!sig) return;
    setBusy(true);
    try {
      const r: any = await api.scannerSignImage({
        image_base64: image, x: pos.x, y: pos.y, w: W,
        signature: { mode: sig.mode, paths: sig.paths, text: sig.text, image_b64: sig.image_b64 },
      });
      onApply(r.image_base64);
      setSig(null);
      setSheetOpen(true);
    } catch {}
    setBusy(false);
  };

  const boxW = box.w * W;
  const boxH = boxW * 0.38;

  return (
    <Modal visible={visible} transparent={false} animationType="fade" onRequestClose={onClose}>
      <SafeAreaView style={s.wrap} edges={['top', 'bottom']}>
        <View style={s.top}>
          <Pressable onPress={() => { setSig(null); setSheetOpen(true); onClose(); }} style={s.roundBtn} testID="pagesign-cancel">
            <Ionicons name="close" size={20} color="#fff" />
          </Pressable>
          <Text style={s.title}>Sign this page</Text>
          {sig && (
            <Pressable onPress={apply} style={s.doneBtn} testID="pagesign-apply" disabled={busy}>
              {busy ? <ActivityIndicator size="small" color="#0b0d10" /> : <Ionicons name="checkmark" size={16} color="#0b0d10" />}
              <Text style={s.doneText}>Embed</Text>
            </Pressable>
          )}
        </View>
        <View style={{ flex: 1, margin: 12 }} onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
          <Image source={{ uri: `data:image/jpeg;base64,${image}` }} style={StyleSheet.absoluteFill} resizeMode="contain" />
          {sig && box.w > 0 && (
            <View {...pan.panHandlers} testID="pagesign-box" style={[s.sigBox, { left: pos.x * box.w, top: pos.y * box.h, width: boxW, height: boxH }]}>
              <SigMini sig={sig} w={boxW} h={boxH} />
              <View style={s.dragHint}><Ionicons name="move" size={11} color="#fff" /></View>
            </View>
          )}
        </View>
        {sig && <Text style={s.hint}>Drag the signature to where it should appear, then tap Embed</Text>}
        <SignatureBottomSheet
          visible={sheetOpen && visible}
          onClose={() => { setSheetOpen(false); if (!sig) onClose(); }}
          onDone={(d) => { setSig(d); setSheetOpen(false); }}
          title="Your signature"
        />
      </SafeAreaView>
    </Modal>
  );
}

function SigMini({ sig, w, h }: { sig: SignatureData; w: number; h: number }) {
  if (sig.mode === 'type' && sig.text) {
    return <Text style={{ fontSize: Math.min(20, h * 0.5), fontStyle: 'italic', color: '#1a1f59' }} numberOfLines={1}>{sig.text}</Text>;
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
  return <Ionicons name="create-outline" size={18} color="#1a1f59" />;
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#0b0d10' },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
  title: { flex: 1, color: '#fff', fontSize: 15, fontWeight: '600' },
  roundBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  doneBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#2dc17c', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
  doneText: { color: '#0b0d10', fontWeight: '700', fontSize: 13 },
  sigBox: { position: 'absolute', borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#3b82f6', borderRadius: 6, backgroundColor: 'rgba(59,130,246,0.1)', alignItems: 'center', justifyContent: 'center' },
  dragHint: { position: 'absolute', top: -9, right: -9, width: 20, height: 20, borderRadius: 10, backgroundColor: '#3b82f6', alignItems: 'center', justifyContent: 'center' },
  hint: { color: '#9aa4b2', fontSize: 12, textAlign: 'center', paddingBottom: 16 },
});
