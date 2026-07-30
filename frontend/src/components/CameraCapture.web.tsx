import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState('');
  const [previewB64, setPreviewB64] = useState<string | null>(null);
  const [faceOk, setFaceOk] = useState(false);
  const detectBusyRef = useRef(false);
  const hitsRef = useRef(0);
  const autoDoneRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setErr('Camera not supported in this browser');
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          // @ts-ignore
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
          setReady(true);
        }
      } catch (e: any) {
        setErr(e?.message || 'Camera permission denied. Please allow camera access in your browser.');
      }
    })();
    return () => {
      cancelled = true;
      const s = streamRef.current;
      if (s) s.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  // Live face detection → green oval → auto-capture
  useEffect(() => {
    if (!ready || previewB64) { setFaceOk(false); return; }
    autoDoneRef.current = false;
    hitsRef.current = 0;
    const grabFrame = (): string | null => {
      const v = videoRef.current;
      const c = canvasRef.current;
      if (!v || !c || !v.videoWidth) return null;
      const scale = 320 / v.videoWidth;
      c.width = 320; c.height = Math.round(v.videoHeight * scale);
      const ctx = c.getContext('2d');
      if (!ctx) return null;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(v, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.5).split(',')[1] || null;
    };
    const iv = setInterval(async () => {
      if (detectBusyRef.current || autoDoneRef.current) return;
      detectBusyRef.current = true;
      try {
        const frame = grabFrame();
        if (!frame) return;
        const r: any = await api.faceDetect(frame);
        if (r?.face) {
          hitsRef.current += 1;
          setFaceOk(true);
          if (hitsRef.current >= 2 && !autoDoneRef.current) {
            autoDoneRef.current = true;
            setTimeout(() => capture(), 500);
          }
        } else {
          hitsRef.current = 0;
          setFaceOk(false);
        }
      } catch {} finally { detectBusyRef.current = false; }
    }, 1200);
    return () => clearInterval(iv);
  }, [ready, previewB64]);

  const capture = () => {
    try {
      const v = videoRef.current;
      const c = canvasRef.current;
      if (!v || !c || !ready) return;
      const w = v.videoWidth || 640;
      const h = v.videoHeight || 480;
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      // Mirror horizontally for selfie
      ctx.translate(w, 0); ctx.scale(-1, 1);
      ctx.drawImage(v, 0, 0, w, h);
      const dataUrl = c.toDataURL('image/jpeg', 0.7);
      setPreviewB64(dataUrl);
    } catch (e: any) {
      setErr(e?.message || 'Capture failed');
    }
  };

  const submit = () => {
    if (!previewB64) return;
    const base64 = previewB64.replace(/^data:image\/[a-z]+;base64,/, '');
    onCapture({ base64 });
  };

  const retake = () => setPreviewB64(null);

  return (
    <View style={s.wrap}>
      <View style={s.frame}>
        {!previewB64 && (
          // @ts-ignore — raw HTML on web
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' } as any}
          />
        )}
        {previewB64 && (
          // @ts-ignore
          <img src={previewB64} style={{ width: '100%', height: '100%', objectFit: 'cover' } as any} />
        )}
        {!ready && !err && !previewB64 && (
          <View style={s.loading}><ActivityIndicator color="#fff" /><Text style={s.loadTxt}>Starting camera…</Text></View>
        )}
        {!!err && (
          <View style={s.errBox}>
            <Ionicons name="warning-outline" size={24} color="#fff" />
            <Text style={s.errTxt}>{err}</Text>
          </View>
        )}
        <View style={s.guideOverlay} pointerEvents="none">
          <View style={[s.guideOval, faceOk && s.guideOvalOk]} />
          {!previewB64 && ready && !err && (
            <View style={[s.statusPill, faceOk && s.statusPillOk]}>
              <Ionicons name={faceOk ? 'checkmark-circle' : 'scan-outline'} size={13} color="#fff" />
              <Text style={s.statusText}>{faceOk ? 'Face detected — hold still…' : 'Align your face inside the oval'}</Text>
            </View>
          )}
        </View>
      </View>

      {/* @ts-ignore */}
      <canvas ref={canvasRef} style={{ display: 'none' } as any} />

      <View style={s.controls}>
        {!previewB64 ? (
          <>
            {onCancel && (
              <Pressable style={s.secondaryBtn} onPress={onCancel} testID="cam-cancel">
                <Text style={s.secondaryText}>Cancel</Text>
              </Pressable>
            )}
            <Pressable
              testID="capture-selfie-btn"
              style={[s.captureBtn, !ready && { opacity: 0.5 }]}
              onPress={capture}
              disabled={!ready}
            >
              <View style={s.captureInner} />
            </Pressable>
            <View style={{ width: 60 }} />
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
  loading: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 8 },
  loadTxt: { color: '#fff', fontSize: 12 },
  errBox: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', padding: 20, backgroundColor: 'rgba(0,0,0,0.7)', gap: 10 },
  errTxt: { color: '#fff', textAlign: 'center', fontSize: 13, lineHeight: 18 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 16, paddingHorizontal: 4 },
  captureBtn: { width: 68, height: 68, borderRadius: 34, backgroundColor: '#fff', borderWidth: 3, borderColor: theme.colors.brand, alignItems: 'center', justifyContent: 'center' },
  captureInner: { width: 54, height: 54, borderRadius: 27, backgroundColor: theme.colors.brand },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: '#fff' },
  secondaryText: { color: theme.colors.brand, fontWeight: '500', fontSize: 13 },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 999, backgroundColor: theme.colors.brand },
  primaryText: { color: '#fff', fontWeight: '500', fontSize: 13 },
});
