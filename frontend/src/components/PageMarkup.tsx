import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Image, Modal, ActivityIndicator, PanResponder } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Polyline } from 'react-native-svg';
import { api } from '@/src/api';

const COLORS = ['#e11d48', '#1d4ed8', '#111111', '#15803d', '#f59e0b'];

/** Freehand markup over a scanned page — strokes flattened onto the image by the backend. */
export default function PageMarkup({ visible, image, onClose, onApply }: {
  visible: boolean;
  image: string; // base64
  onClose: () => void;
  onApply: (newB64: string) => void;
}) {
  const [strokes, setStrokes] = useState<number[][][]>([]);
  const [current, setCurrent] = useState<number[][]>([]);
  const currentRef = useRef<number[][]>([]);
  const [color, setColor] = useState(COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const boxRef = useRef(box);
  boxRef.current = box;

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        const { locationX, locationY } = e.nativeEvent;
        currentRef.current = [[locationX, locationY]];
        setCurrent([...currentRef.current]);
      },
      onPanResponderMove: (e) => {
        const { locationX, locationY } = e.nativeEvent;
        currentRef.current = [...currentRef.current, [locationX, locationY]];
        setCurrent([...currentRef.current]);
      },
      onPanResponderRelease: () => {
        if (currentRef.current.length > 0) {
          const b = boxRef.current;
          const norm = currentRef.current.map(([x, y]) => [x / (b.w || 1), y / (b.h || 1)]);
          setStrokes((sk) => [...sk, norm]);
        }
        currentRef.current = [];
        setCurrent([]);
      },
    })
  ).current;

  const apply = async () => {
    if (!strokes.length) { onClose(); return; }
    setBusy(true);
    try {
      const r: any = await api.scannerAnnotate({ image_base64: image, strokes, color, width: 0.006 });
      onApply(r.image_base64);
      setStrokes([]);
    } catch {}
    setBusy(false);
  };

  return (
    <Modal visible={visible} transparent={false} animationType="fade" onRequestClose={onClose}>
      <SafeAreaView style={s.wrap} edges={['top', 'bottom']}>
        <View style={s.top}>
          <Pressable onPress={() => { setStrokes([]); onClose(); }} style={s.roundBtn} testID="markup-cancel">
            <Ionicons name="close" size={20} color="#fff" />
          </Pressable>
          <Text style={s.title}>Markup</Text>
          <Pressable onPress={() => setStrokes((sk) => sk.slice(0, -1))} style={s.roundBtn} testID="markup-undo">
            <Ionicons name="arrow-undo" size={18} color="#fff" />
          </Pressable>
          <Pressable onPress={apply} style={s.doneBtn} testID="markup-apply" disabled={busy}>
            {busy ? <ActivityIndicator size="small" color="#0b0d10" /> : <Ionicons name="checkmark" size={16} color="#0b0d10" />}
            <Text style={s.doneText}>Apply</Text>
          </Pressable>
        </View>
        <View
          style={{ flex: 1, margin: 12 }}
          onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
          {...pan.panHandlers}
        >
          <Image source={{ uri: `data:image/jpeg;base64,${image}` }} style={StyleSheet.absoluteFill} resizeMode="contain" />
          <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
            {strokes.map((st, i) => (
              <Polyline key={i} points={st.map(([x, y]) => `${x * box.w},${y * box.h}`).join(' ')} stroke={color} strokeWidth={4} fill="none" strokeLinecap="round" />
            ))}
            {current.length > 0 && (
              <Polyline points={current.map(([x, y]) => `${x},${y}`).join(' ')} stroke={color} strokeWidth={4} fill="none" strokeLinecap="round" />
            )}
          </Svg>
        </View>
        <View style={s.colors}>
          {COLORS.map((c) => (
            <Pressable key={c} testID={`markup-color-${c.slice(1)}`} onPress={() => setColor(c)} style={[s.dot, { backgroundColor: c }, color === c && s.dotOn]} />
          ))}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#0b0d10' },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
  title: { flex: 1, color: '#fff', fontSize: 15, fontWeight: '600' },
  roundBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  doneBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#2dc17c', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
  doneText: { color: '#0b0d10', fontWeight: '700', fontSize: 13 },
  colors: { flexDirection: 'row', justifyContent: 'center', gap: 14, paddingVertical: 14, paddingBottom: 22 },
  dot: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: 'transparent' },
  dotOn: { borderColor: '#fff', transform: [{ scale: 1.18 }] },
});
