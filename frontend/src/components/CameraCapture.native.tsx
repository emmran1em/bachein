import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Image, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { theme } from '@/src/theme';
import { api } from '@/src/api';

export type CaptureResult = { base64: string };

export default function CameraCapture({
  onCapture,
  onCancel,
}: {
  onCapture: (r: CaptureResult) => void;
  onCancel?: () => void;
}) {
  const cameraRef = useRef<CameraView | null>(null);
  const [camPerm, requestCamPerm] = useCameraPermissions();
  const [ready, setReady] = useState(false);
  const [previewB64, setPreviewB64] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [fallback, setFallback] = useState(false);
  const [faceOk, setFaceOk] = useState(false);
  const detectBusyRef = useRef(false);
  const hitsRef = useRef(0);
  const autoDoneRef = useRef(false);

  useEffect(() => {
    if (!camPerm) requestCamPerm();
  }, []);

  // Live face detection → green oval → auto-capture
  useEffect(() => {
    if (!ready || previewB64 || fallback || !camPerm?.granted) { setFaceOk(false); return; }
    autoDoneRef.current = false;
    hitsRef.current = 0;
    const iv = setInterval(async () => {
      if (detectBusyRef.current || autoDoneRef.current || !cameraRef.current) return;
      detectBusyRef.current = true;
      try {
        const probe = await cameraRef.current.takePictureAsync({ quality: 0.15, base64: true, skipProcessing: true });
        if (!probe?.base64 || autoDoneRef.current) return;
        const r: any = await api.faceDetect(probe.base64);
        if (r?.face) {
          hitsRef.current += 1;
          setFaceOk(true);
          if (hitsRef.current >= 2 && !autoDoneRef.current) {
            autoDoneRef.current = true;
            // auto-capture: reuse the last good probe at slightly better quality
            setTimeout(async () => {
              try {
                const shot = await cameraRef.current?.takePictureAsync({ quality: 0.65, base64: true, skipProcessing: false });
                if (shot?.base64 && shot.base64.length > 500) {
                  setPreviewB64('data:image/jpg;base64,' + shot.base64);
                } else if (probe.base64) {
                  setPreviewB64('data:image/jpg;base64,' + probe.base64);
                }
              } catch {
                if (probe.base64) setPreviewB64('data:image/jpg;base64,' + probe.base64);
              }
            }, 500);
          }
        } else {
          hitsRef.current = 0;
          setFaceOk(false);
        }
      } catch {} finally { detectBusyRef.current = false; }
    }, 1500);
    return () => clearInterval(iv);
  }, [ready, previewB64, fallback, camPerm?.granted]);

  // If camera didn't become ready in 5s, offer system-picker fallback
  useEffect(() => {
    if (!camPerm?.granted || ready) return;
    const t = setTimeout(() => setFallback(true), 5000);
    return () => clearTimeout(t);
  }, [camPerm?.granted, ready]);

  const capture = async () => {
    try {
      setErr('');
      if (!ready) { setErr('Camera warming up — please wait a moment'); return; }
      await new Promise((r) => setTimeout(r, 250));
      const photo = await cameraRef.current?.takePictureAsync({ quality: 0.65, base64: true, skipProcessing: false });
      if (photo?.base64 && photo.base64.length > 500) {
        setPreviewB64('data:image/jpg;base64,' + photo.base64);
      } else {
        setErr('Could not capture image. Ensure good lighting and retry.');
      }
    } catch (e: any) { setErr(e.message || 'Capture failed'); }
  };

  const captureFallback = async () => {
    try {
      setErr('');
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { setErr('Camera permission required'); return; }
      const r = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, base64: true, quality: 0.6, cameraType: ImagePicker.CameraType.front });
      if (r.canceled) return;
      const a = r.assets?.[0];
      if (a?.base64) setPreviewB64('data:image/jpg;base64,' + a.base64);
    } catch (e: any) { setErr(e.message || 'Capture failed'); }
  };

  const submit = () => {
    if (!previewB64) return;
    onCapture({ base64: previewB64.replace(/^data:image\/[a-z]+;base64,/, '') });
  };

  const retake = () => setPreviewB64(null);

  return (
    <View style={s.wrap}>
      <View style={s.frame}>
        {previewB64 ? (
          <Image source={{ uri: previewB64 }} style={{ flex: 1 }} />
        ) : camPerm?.granted && !fallback ? (
          <CameraView
            ref={(r) => { cameraRef.current = r; }}
            style={{ flex: 1 }}
            facing="front"
            animateShutter={false}
            onCameraReady={() => setReady(true)}
          />
        ) : fallback ? (
          <View style={s.fallbackBox}>
            <Ionicons name="camera-outline" size={38} color="#fff" />
            <Text style={s.fallbackText}>Live camera unavailable</Text>
            <Text style={s.fallbackSub}>Use the system camera instead</Text>
            <Pressable style={s.primaryBtn} onPress={captureFallback}>
              <Ionicons name="camera" size={16} color="#fff" />
              <Text style={s.primaryText}>Open camera</Text>
            </Pressable>
          </View>
        ) : (
          <View style={s.loading}>
            <Ionicons name="camera-outline" size={38} color="#fff" />
            <Text style={s.loadTxt}>Camera permission needed</Text>
            <Pressable style={s.primaryBtn} onPress={() => requestCamPerm()}>
              <Text style={s.primaryText}>Grant access</Text>
            </Pressable>
          </View>
        )}

        {!previewB64 && camPerm?.granted && !fallback && !ready && (
          <View style={s.loading} pointerEvents="none"><ActivityIndicator color="#fff" /><Text style={s.loadTxt}>Warming up camera…</Text></View>
        )}

        <View style={s.guideOverlay} pointerEvents="none">
          <View style={s.guideOval} />
        </View>
      </View>

      {!!err && <Text style={s.err}>{err}</Text>}

      <View style={s.controls}>
        {!previewB64 ? (
          <>
            {onCancel ? (
              <Pressable style={s.secondaryBtn} onPress={onCancel} testID="cam-cancel">
                <Text style={s.secondaryText}>Cancel</Text>
              </Pressable>
            ) : <View style={{ width: 60 }} />}
            {!fallback ? (
              <Pressable testID="capture-selfie-btn" style={[s.captureBtn, !ready && { opacity: 0.5 }]} onPress={capture} disabled={!ready}>
                <View style={s.captureInner} />
              </Pressable>
            ) : <View style={{ width: 68 }} />}
            <Pressable style={s.secondaryBtn} onPress={() => setFallback((f) => !f)}>
              <Ionicons name="swap-horizontal" size={14} color={theme.colors.brand} />
            </Pressable>
          </>
        ) : (
          <>
            <Pressable style={s.secondaryBtn} onPress={retake} testID="retake-btn">
              <Ionicons name="refresh" size={16} color={theme.colors.brand} />
              <Text style={s.secondaryText}>Retake</Text>
            </Pressable>
            <Pressable style={s.primaryBtn} onPress={submit} testID="submit-face-btn">
              <Ionicons name="checkmark" size={16} color="#fff" />
              <Text style={s.primaryText}>Use this photo</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginTop: 12 },
  frame: { position: 'relative', aspectRatio: 3 / 4, backgroundColor: '#000', borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: theme.colors.border },
  guideOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  guideOval: { width: '55%', height: '65%', borderRadius: 999, borderWidth: 2, borderColor: 'rgba(255,255,255,0.6)', borderStyle: 'dashed' },
  guideOvalOk: { borderColor: '#16a34a', borderStyle: 'solid', borderWidth: 3 },
  statusPill: { position: 'absolute', bottom: 14, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  statusPillOk: { backgroundColor: 'rgba(22,163,74,0.85)' },
  statusText: { color: '#fff', fontSize: 11, fontWeight: '500' },
  loading: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 20 },
  loadTxt: { color: '#fff', fontSize: 12 },
  fallbackBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 20, backgroundColor: '#111' },
  fallbackText: { color: '#fff', fontSize: 14, fontWeight: '500' },
  fallbackSub: { color: '#aaa', fontSize: 12, marginBottom: 8 },
  err: { color: theme.colors.error, marginTop: 10, textAlign: 'center', fontSize: 12 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 16, paddingHorizontal: 4 },
  captureBtn: { width: 68, height: 68, borderRadius: 34, backgroundColor: '#fff', borderWidth: 3, borderColor: theme.colors.brand, alignItems: 'center', justifyContent: 'center' },
  captureInner: { width: 54, height: 54, borderRadius: 27, backgroundColor: theme.colors.brand },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: '#fff' },
  secondaryText: { color: theme.colors.brand, fontWeight: '500', fontSize: 13 },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 999, backgroundColor: theme.colors.brand },
  primaryText: { color: '#fff', fontWeight: '500', fontSize: 13 },
});
rWidth: 1, borderColor: theme.colors.border, backgroundColor: '#fff' },
  secondaryText: { color: theme.colors.brand, fontWeight: '500', fontSize: 13 },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 999, backgroundColor: theme.colors.brand },
  primaryText: { color: '#fff', fontWeight: '500', fontSize: 13 },
});
