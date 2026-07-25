import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, TextInput, Image, ActivityIndicator, Platform, KeyboardAvoidingView, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import * as ImagePicker from 'expo-image-picker';
import { theme } from '@/src/theme';

export type SignatureData = {
  mode: 'draw' | 'type' | 'upload';
  paths?: string[];
  text?: string;
  image_b64?: string;
  ts: string;
};

export default function SignatureBottomSheet({
  visible,
  onClose,
  onDone,
  title = 'Add Signature',
  role = '',
  busy = false,
}: {
  visible: boolean;
  onClose: () => void;
  onDone: (data: SignatureData) => void;
  title?: string;
  role?: string;
  busy?: boolean;
}) {
  const [mode, setMode] = useState<'draw' | 'type' | 'upload'>('draw');
  const [paths, setPaths] = useState<string[]>([]);
  const currentPath = useRef<string>('');
  const [text, setText] = useState('');
  const [imageB64, setImageB64] = useState<string | null>(null);
  const [err, setErr] = useState('');

  const reset = () => {
    setMode('draw'); setPaths([]); setText(''); setImageB64(null); setErr('');
    currentPath.current = '';
  };

  const close = () => { reset(); onClose(); };

  const pickImage = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { setErr('Photo library permission needed'); return; }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        base64: true,
        quality: 0.8,
      });
      if (res.canceled) return;
      const a = res.assets[0];
      if (a.base64) setImageB64('data:image/jpeg;base64,' + a.base64);
    } catch (e: any) { setErr(e.message); }
  };

  const submit = () => {
    if (mode === 'draw' && paths.length === 0) { setErr('Please draw your signature'); return; }
    if (mode === 'type' && !text.trim()) { setErr('Please type your signature'); return; }
    if (mode === 'upload' && !imageB64) { setErr('Please attach a signature image'); return; }
    onDone({
      mode,
      paths: mode === 'draw' ? paths : undefined,
      text: mode === 'type' ? text : undefined,
      image_b64: mode === 'upload' ? imageB64 || undefined : undefined,
      ts: new Date().toISOString(),
    });
    reset();
  };

  // Signature pad handlers
  const onTouchStart = (e: any) => {
    const { locationX, locationY } = e.nativeEvent;
    currentPath.current = `M${locationX.toFixed(1)},${locationY.toFixed(1)}`;
    setPaths((p) => [...p, currentPath.current]);
  };
  const onTouchMove = (e: any) => {
    const { locationX, locationY } = e.nativeEvent;
    currentPath.current += ` L${locationX.toFixed(1)},${locationY.toFixed(1)}`;
    setPaths((p) => [...p.slice(0, -1), currentPath.current]);
  };
  const onTouchEnd = () => { currentPath.current = ''; };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={s.overlay}>
        <Pressable style={s.backdrop} onPress={close} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.sheet}>
          <View style={s.handle} />
          <View style={s.headRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.title}>{title}</Text>
              {!!role && <Text style={s.role}>{role}</Text>}
            </View>
            <Pressable onPress={close} style={s.closeBtn}>
              <Ionicons name="close" size={20} color={theme.colors.brand} />
            </Pressable>
          </View>

          <View style={s.modeRow}>
            <Pressable style={[s.modeBtn, mode === 'draw' && s.modeActive]} onPress={() => setMode('draw')}>
              <Ionicons name="brush-outline" size={14} color={mode === 'draw' ? '#fff' : theme.colors.brand} />
              <Text style={[s.modeText, mode === 'draw' && s.modeTextActive]}>Draw</Text>
            </Pressable>
            <Pressable style={[s.modeBtn, mode === 'type' && s.modeActive]} onPress={() => setMode('type')}>
              <Ionicons name="text-outline" size={14} color={mode === 'type' ? '#fff' : theme.colors.brand} />
              <Text style={[s.modeText, mode === 'type' && s.modeTextActive]}>Type</Text>
            </Pressable>
            <Pressable style={[s.modeBtn, mode === 'upload' && s.modeActive]} onPress={() => setMode('upload')}>
              <Ionicons name="attach-outline" size={14} color={mode === 'upload' ? '#fff' : theme.colors.brand} />
              <Text style={[s.modeText, mode === 'upload' && s.modeTextActive]}>Attach</Text>
            </Pressable>
          </View>

          {mode === 'draw' && (
            <>
              <View
                style={s.pad}
                onStartShouldSetResponder={() => true}
                onMoveShouldSetResponder={() => true}
                onResponderGrant={onTouchStart}
                onResponderMove={onTouchMove}
                onResponderRelease={onTouchEnd}
                onResponderTerminate={onTouchEnd}
              >
                <Svg width="100%" height="100%">
                  {paths.map((p, i) => (
                    <Path key={i} d={p} stroke={theme.colors.brand} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  ))}
                </Svg>
                {paths.length === 0 && <Text style={s.hint}>Sign here with your finger</Text>}
              </View>
              <Pressable onPress={() => setPaths([])} style={s.clearBtn}>
                <Ionicons name="refresh" size={13} color={theme.colors.brand} />
                <Text style={s.clearText}>Clear</Text>
              </Pressable>
            </>
          )}

          {mode === 'type' && (
            <TextInput
              style={s.typed}
              value={text}
              onChangeText={setText}
              placeholder="Type your full name"
              placeholderTextColor={theme.colors.muted}
              autoCorrect={false}
            />
          )}

          {mode === 'upload' && (
            <View style={{ marginTop: 12 }}>
              {imageB64 ? (
                <View style={s.uploadPreview}>
                  <Image source={{ uri: imageB64 }} style={{ flex: 1, resizeMode: 'contain' }} />
                </View>
              ) : (
                <Pressable onPress={pickImage} style={s.uploadZone}>
                  <Ionicons name="images-outline" size={26} color={theme.colors.brand} />
                  <Text style={s.uploadText}>Attach signature image</Text>
                  <Text style={s.uploadSub}>JPG or PNG · transparent background works best</Text>
                </Pressable>
              )}
              {imageB64 && (
                <Pressable onPress={() => setImageB64(null)} style={s.clearBtn}>
                  <Ionicons name="close-circle-outline" size={14} color={theme.colors.brand} />
                  <Text style={s.clearText}>Replace</Text>
                </Pressable>
              )}
            </View>
          )}

          {!!err && <Text style={s.err}>{err}</Text>}

          <Pressable style={[s.doneBtn, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy}>
            {busy ? <ActivityIndicator color={theme.colors.onBrandPrimary} /> : (
              <>
                <Ionicons name="checkmark" size={16} color={theme.colors.onBrandPrimary} />
                <Text style={s.doneText}>Apply Signature</Text>
              </>
            )}
          </Pressable>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

/* ── Reusable renderer to display any signature inline in a document ── */
export function SignatureView({ data, height = 62 }: { data: string | SignatureData | null | undefined; height?: number }) {
  if (!data) return null;
  let sig: SignatureData | null = null;
  if (typeof data === 'string') {
    try { sig = JSON.parse(data); } catch { return null; }
  } else { sig = data; }
  if (!sig) return null;

  if (sig.mode === 'draw' && sig.paths && sig.paths.length > 0) {
    const w = Dimensions.get('window').width - 90;
    return (
      <View style={[sigStyles.wrap, { height }]}> 
        <Svg width={w} height={height} viewBox={`0 0 ${w} 200`} preserveAspectRatio="xMidYMid meet">
          {sig.paths.map((p, i) => (
            <Path key={i} d={p} stroke={theme.colors.brand} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          ))}
        </Svg>
      </View>
    );
  }
  if (sig.mode === 'type' && sig.text) {
    return (
      <View style={[sigStyles.wrap, { height }]}> 
        <Text style={sigStyles.typed}>{sig.text}</Text>
      </View>
    );
  }
  if (sig.mode === 'upload' && sig.image_b64) {
    return (
      <View style={[sigStyles.wrap, { height }]}> 
        <Image source={{ uri: sig.image_b64 }} style={{ flex: 1, resizeMode: 'contain' }} />
      </View>
    );
  }
  return null;
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  sheet: { backgroundColor: theme.colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40 },
  handle: { alignSelf: 'center', width: 42, height: 4, borderRadius: 2, backgroundColor: theme.colors.borderStrong, marginBottom: 12 },
  headRow: { flexDirection: 'row', alignItems: 'center' },
  title: { fontSize: 18, color: theme.colors.brand, fontWeight: '500' },
  role: { color: theme.colors.muted, fontSize: 12, marginTop: 2, letterSpacing: 0.5 },
  closeBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border },
  modeRow: { flexDirection: 'row', gap: 8, marginTop: 16 },
  modeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 999, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: '#fff' },
  modeActive: { backgroundColor: theme.colors.brand, borderColor: theme.colors.brand },
  modeText: { color: theme.colors.brand, fontSize: 13, fontWeight: '500' },
  modeTextActive: { color: '#fff' },
  pad: { height: 200, backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.borderStrong, borderRadius: 14, marginTop: 12, overflow: 'hidden' },
  hint: { position: 'absolute', top: 88, alignSelf: 'center', color: theme.colors.muted, fontSize: 13 },
  clearBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-end', paddingHorizontal: 10, paddingVertical: 6, marginTop: 8 },
  clearText: { color: theme.colors.brand, fontSize: 12, fontWeight: '500' },
  typed: { backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border, borderRadius: 14, padding: 22, fontSize: 30, color: theme.colors.brand, marginTop: 12, fontStyle: 'italic', textAlign: 'center' },
  uploadPreview: { height: 160, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, overflow: 'hidden', padding: 8 },
  uploadZone: { height: 160, backgroundColor: '#fff', borderRadius: 12, borderWidth: 2, borderColor: theme.colors.border, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 6 },
  uploadText: { color: theme.colors.brand, fontWeight: '500' },
  uploadSub: { color: theme.colors.muted, fontSize: 11 },
  err: { color: theme.colors.error, marginTop: 10, fontSize: 12 },
  doneBtn: { flexDirection: 'row', gap: 8, marginTop: 16, backgroundColor: theme.colors.brand, padding: 15, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  doneText: { color: theme.colors.onBrandPrimary, fontWeight: '500', fontSize: 15 },
});

const sigStyles = StyleSheet.create({
  wrap: { backgroundColor: '#fff', borderRadius: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.brand, paddingHorizontal: 8, justifyContent: 'center' },
  typed: { fontSize: 26, fontStyle: 'italic', color: theme.colors.brand, textAlign: 'left' },
});
