import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Image, ScrollView, ActivityIndicator, TextInput, Modal, Linking, PanResponder } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import Svg, { Polygon, Circle } from 'react-native-svg';
import { api } from '@/src/api';
import { scanStore } from '@/src/lib/scanStore';
import PageMarkup from '@/src/components/PageMarkup';
import PageSign from '@/src/components/PageSign';
import { sharePdf } from '@/src/share';

type Filter = 'color' | 'bw' | 'original';
type Page = {
  id: string;
  raw: string;                 // original capture (base64)
  processed?: string;          // cropped + filtered result
  corners?: number[][];        // normalized [tl,tr,br,bl]
  imgW?: number; imgH?: number;
  filter: Filter;
  rotate: number;              // 0 | 90 | 180 | 270
  status: 'processing' | 'ready' | 'error';
};

const FILTER_LABEL: Record<Filter, string> = { color: 'Color', bw: 'B&W', original: 'Original' };
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const clamp = (v: number, a: number, b: number) => Math.min(Math.max(v, a), b);

/** Professional document scanner: fast capture → background processing → review/crop/filter → PDF or hand-off. */
export default function ScannerScreen() {
  const router = useRouter();
  const { return: returnTo } = useLocalSearchParams<{ return?: string }>();
  const camRef = useRef<CameraView | null>(null);
  const [perm, requestPerm] = useCameraPermissions();
  const [ready, setReady] = useState(false);
  const [torch, setTorch] = useState(false);
  const [pages, setPages] = useState<Page[]>([]);
  const pagesRef = useRef<Page[]>([]);
  pagesRef.current = pages;
  const [flash, setFlash] = useState(false); // shutter blink
  const [reviewIdx, setReviewIdx] = useState<number | null>(null);
  const [cropIdx, setCropIdx] = useState<number | null>(null);
  const [markupIdx, setMarkupIdx] = useState<number | null>(null);
  const [signIdx, setSignIdx] = useState<number | null>(null);
  const [view, setView] = useState<'camera' | 'gallery'>('camera');
  const [sharing, setSharing] = useState(false);
  const [nameOpen, setNameOpen] = useState(false);
  const [docName, setDocName] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const updatePage = useCallback((id: string, patch: Partial<Page>) => {
    setPages((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }, []);

  /** One fast round-trip: server auto-detects corners + crops + enhances. */
  const processPage = useCallback(async (id: string, raw: string, filter: Filter, rotate: number, corners?: number[][]) => {
    try {
      const r: any = await api.scannerApply({ image_base64: raw, corners, filter, rotate });
      updatePage(id, { processed: r.image_base64, status: 'ready', ...(corners ? { corners } : {}) });
    } catch {
      updatePage(id, { processed: raw, status: 'ready' });
    }
  }, [updatePage]);

  const addRawPage = useCallback((raw: string) => {
    const p: Page = { id: uid(), raw, filter: 'color', rotate: 0, status: 'processing' };
    setPages((ps) => [...ps, p]);
    processPage(p.id, raw, 'color', 0);
  }, [processPage]);

  const capture = async () => {
    if (!camRef.current) return;
    setErr('');
    try {
      setFlash(true);
      setTimeout(() => setFlash(false), 140);
      const shot = await camRef.current.takePictureAsync({ quality: 0.55, base64: true, skipProcessing: true });
      if (!shot?.base64) throw new Error('Capture failed');
      addRawPage(shot.base64); // instant — processing continues in background
    } catch (e: any) { setErr(e.message || 'Scan failed'); }
  };

  const importFromGallery = async () => {
    setErr('');
    try {
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, base64: true, quality: 0.7, selectionLimit: 10 });
      if (r.canceled || !r.assets?.length) return;
      r.assets.forEach((a) => { if (a.base64) addRawPage(a.base64); });
    } catch (e: any) { setErr(e.message || 'Import failed'); }
  };

  const reprocess = (idx: number, patch: Partial<Pick<Page, 'filter' | 'rotate' | 'corners'>>) => {
    const p = pagesRef.current[idx];
    if (!p) return;
    const filter = patch.filter ?? p.filter;
    const rotate = patch.rotate ?? p.rotate;
    const corners = patch.corners ?? p.corners;
    updatePage(p.id, { ...patch, status: 'processing' });
    processPage(p.id, p.raw, filter, rotate, corners);
  };

  const cycleFilter = (idx: number) => {
    const order: Filter[] = ['color', 'bw', 'original'];
    const p = pages[idx];
    reprocess(idx, { filter: order[(order.indexOf(p.filter) + 1) % order.length] });
  };

  const rotatePage = (idx: number) => reprocess(idx, { rotate: ((pages[idx].rotate + 90) % 360) });

  const deletePage = (idx: number) => {
    setPages((ps) => ps.filter((_, i) => i !== idx));
    setReviewIdx(null);
  };

  const movePage = (idx: number, dir: -1 | 1) => {
    setPages((ps) => {
      const n = [...ps];
      const j = idx + dir;
      if (j < 0 || j >= n.length) return ps;
      [n[idx], n[j]] = [n[j], n[idx]];
      return n;
    });
    setReviewIdx((i) => (i === null ? null : clamp(i + dir, 0, pages.length - 1)));
  };

  const anyProcessing = pages.some((p) => p.status === 'processing');

  const done = () => {
    if (!pages.length) return;
    if (returnTo === 'create') {
      scanStore.set(pages.map((p) => p.processed || p.raw));
      router.back();
      return;
    }
    setView('gallery'); // professional post-capture gallery (crop/markup/share/signature/add)
  };

  const shareAsPdf = async () => {
    if (!pages.length || sharing) return;
    setSharing(true);
    try {
      const imgs = pages.map((p) => p.processed || p.raw);
      const r: any = await api.scannerCreatePdf(imgs, docName.trim() || undefined);
      await sharePdf(api.downloadFileUrl(r.download_id), `${r.name}.pdf`);
    } catch (e: any) { setErr(e.message || 'Share failed'); }
    finally { setSharing(false); }
  };

  const createPdf = async () => {
    setSaving(true);
    try {
      const imgs = pages.map((p) => p.processed || p.raw);
      const r: any = await api.scannerCreatePdf(imgs, docName.trim() || undefined);
      setNameOpen(false);
      setPages([]);
      router.replace({ pathname: '/viewer', params: { url: api.downloadFileUrl(r.download_id), name: r.name } });
    } catch (e: any) { setErr(e.message || 'Could not create PDF'); }
    finally { setSaving(false); }
  };

  if (!perm?.granted) {
    return (
      <SafeAreaView style={s.container} edges={['top']} testID="scanner-screen">
        <View style={s.topBar}>
          <Pressable onPress={() => router.back()} style={s.roundBtn} testID="scanner-back">
            <Ionicons name="close" size={20} color="#fff" />
          </Pressable>
          <Text style={s.topTitle}>Scan document</Text>
          <View style={{ width: 38 }} />
        </View>
        <View style={s.permBox}>
          <Ionicons name="scan-outline" size={44} color="#8a94a3" />
          <Text style={s.permTitle}>Scan documents with your camera</Text>
          <Text style={s.permSub}>Bachein finds the page edges, fixes perspective and saves a clean PDF — like a real scanner.</Text>
          {perm?.canAskAgain !== false ? (
            <Pressable style={s.primaryBtn} onPress={requestPerm} testID="scanner-grant">
              <Ionicons name="camera-outline" size={16} color="#fff" />
              <Text style={s.primaryText}>Allow camera</Text>
            </Pressable>
          ) : (
            <Pressable style={s.primaryBtn} onPress={() => Linking.openSettings()} testID="scanner-settings">
              <Ionicons name="settings-outline" size={16} color="#fff" />
              <Text style={s.primaryText}>Open Settings</Text>
            </Pressable>
          )}
          <Pressable style={[s.secondaryBtn, { marginTop: 10 }]} onPress={importFromGallery} testID="scanner-import-noperm">
            <Ionicons name="images-outline" size={16} color="#fff" />
            <Text style={s.secondaryText}>Import from gallery instead</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container} edges={['top']} testID="scanner-screen">
      {view === 'gallery' ? (
        <>
          {/* ── Post-capture gallery (sc2-style) ── */}
          <View style={s.topBar}>
            <Pressable onPress={() => setView('camera')} style={s.roundBtn} testID="gallery-back">
              <Ionicons name="chevron-back" size={20} color="#fff" />
            </Pressable>
            <TextInput
              testID="gallery-name"
              style={s.galleryName}
              value={docName}
              onChangeText={setDocName}
              placeholder={`Scan ${new Date().toLocaleDateString()}`}
              placeholderTextColor="#7b8494"
            />
            <Ionicons name="pencil-outline" size={15} color="#7b8494" />
          </View>
          <ScrollView contentContainerStyle={s.grid}>
            {pages.map((p, i) => (
              <Pressable key={p.id} style={s.gridTile} testID={`gallery-page-${i}`} onPress={() => setReviewIdx(i)}>
                <Image source={{ uri: `data:image/jpeg;base64,${p.processed || p.raw}` }} style={s.gridImg} />
                <View style={s.gridNo}><Text style={s.gridNoText}>{String(i + 1).padStart(2, '0')}</Text></View>
                {p.status === 'processing' && <View style={s.thumbBusy}><ActivityIndicator color="#fff" /></View>}
                <View style={s.gridArrows}>
                  {i > 0 ? (
                    <Pressable testID={`gallery-move-left-${i}`} onPress={() => movePage(i, -1)} style={s.gridArrowBtn} hitSlop={8}>
                      <Ionicons name="chevron-back" size={14} color="#fff" />
                    </Pressable>
                  ) : <View style={{ width: 24 }} />}
                  {i < pages.length - 1 ? (
                    <Pressable testID={`gallery-move-right-${i}`} onPress={() => movePage(i, 1)} style={s.gridArrowBtn} hitSlop={8}>
                      <Ionicons name="chevron-forward" size={14} color="#fff" />
                    </Pressable>
                  ) : <View style={{ width: 24 }} />}
                </View>
              </Pressable>
            ))}
            <Pressable style={s.addTile} onPress={() => setView('camera')} testID="gallery-add-tile">
              <Ionicons name="camera-outline" size={26} color="#8a94a3" />
              <Text style={s.addTileText}>Tap to add new pages</Text>
            </Pressable>
          </ScrollView>
          {!!err && <Text style={s.galleryErr}>{err}</Text>}
          <View style={s.galleryBar}>
            <ToolBtn icon="camera-outline" label="Add" tid="gallery-add" onPress={() => setView('camera')} />
            <ToolBtn icon="share-social-outline" label={sharing ? 'Sharing…' : 'Share'} tid="gallery-share" onPress={shareAsPdf} />
            <ToolBtn icon="create-outline" label="Sign" tid="gallery-sign" onPress={() => pages.length > 0 && setSignIdx(0)} />
            <ToolBtn icon="document-text-outline" label="Save PDF" tid="gallery-save" onPress={() => setNameOpen(true)} />
          </View>
        </>
      ) : (
      <>
      {/* Top bar */}
      <View style={s.topBar}>
        <Pressable onPress={() => router.back()} style={s.roundBtn} testID="scanner-back">
          <Ionicons name="close" size={20} color="#fff" />
        </Pressable>
        <Pressable onPress={() => setTorch((t) => !t)} style={s.roundBtn} testID="scanner-torch">
          <Ionicons name={torch ? 'flash' : 'flash-off-outline'} size={18} color="#fff" />
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable
          testID="scanner-done"
          onPress={done}
          disabled={!pages.length || anyProcessing}
          style={[s.doneBtn, (!pages.length || anyProcessing) && { opacity: 0.45 }]}
        >
          {anyProcessing ? <ActivityIndicator size="small" color="#0b0d10" /> : <Ionicons name="checkmark" size={16} color="#0b0d10" />}
          <Text style={s.doneText}>{anyProcessing ? 'Processing…' : `Done${pages.length ? ` (${pages.length})` : ''}`}</Text>
        </Pressable>
      </View>

      {/* Camera */}
      <View style={s.camWrap}>
        <CameraView
          ref={(r) => { camRef.current = r; }}
          style={{ flex: 1 }}
          facing="back"
          enableTorch={torch}
          animateShutter={false}
          onCameraReady={() => setReady(true)}
        />
        {/* Document guide frame */}
        <View pointerEvents="none" style={s.guide}>
          {[s.gTL, s.gTR, s.gBL, s.gBR].map((st, i) => <View key={i} style={[s.gCorner, st]} />)}
          <Text style={s.guideText}>Align the document inside the frame</Text>
        </View>
        {flash && <View pointerEvents="none" style={s.flashOverlay} />}
        {!!err && <View style={s.errBox}><Text style={s.errText}>{err}</Text></View>}
      </View>

      {/* Thumbnails strip */}
      {pages.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 84, backgroundColor: '#0b0d10' }} contentContainerStyle={{ gap: 8, paddingHorizontal: 14, paddingVertical: 8 }}>
          {pages.map((p, i) => (
            <Pressable key={p.id} style={s.thumbWrap} testID={`scan-thumb-${i}`} onPress={() => setReviewIdx(i)}>
              <Image source={{ uri: `data:image/jpeg;base64,${p.processed || p.raw}` }} style={s.thumb} />
              {p.status === 'processing' && (
                <View style={s.thumbBusy}><ActivityIndicator size="small" color="#fff" /></View>
              )}
              <Text style={s.thumbNo}>{i + 1}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {/* Bottom controls */}
      <View style={s.bottomBar}>
        <Pressable style={s.sideBtn} onPress={importFromGallery} testID="scan-import">
          <Ionicons name="images-outline" size={22} color="#fff" />
          <Text style={s.sideLabel}>Import</Text>
        </Pressable>
        <Pressable style={[s.shutter, !ready && { opacity: 0.5 }]} disabled={!ready} onPress={capture} testID="scan-capture">
          <View style={s.shutterInner} />
        </Pressable>
        <Pressable style={s.sideBtn} onPress={() => pages.length && setView('gallery')} testID="scan-review" disabled={!pages.length}>
          <Ionicons name="albums-outline" size={22} color={pages.length ? '#fff' : '#4a5057'} />
          <Text style={[s.sideLabel, !pages.length && { color: '#4a5057' }]}>Pages</Text>
        </Pressable>
      </View>
      </>
      )}

      {/* ── Review modal ── */}
      <Modal visible={reviewIdx !== null} transparent={false} animationType="slide" onRequestClose={() => setReviewIdx(null)}>
        {reviewIdx !== null && pages[reviewIdx] && (
          <SafeAreaView style={s.reviewWrap} edges={['top', 'bottom']}>
            <View style={s.topBar}>
              <Pressable onPress={() => setReviewIdx(null)} style={s.roundBtn} testID="review-back">
                <Ionicons name="chevron-back" size={20} color="#fff" />
              </Pressable>
              <Text style={s.topTitle}>Page {reviewIdx + 1} / {pages.length}</Text>
              <Pressable onPress={() => { setReviewIdx(null); }} style={s.roundBtn} testID="review-add-page">
                <Ionicons name="add" size={22} color="#fff" />
              </Pressable>
            </View>
            <View style={{ flex: 1, justifyContent: 'center' }}>
              <Image
                source={{ uri: `data:image/jpeg;base64,${pages[reviewIdx].processed || pages[reviewIdx].raw}` }}
                style={{ flex: 1, margin: 14, borderRadius: 8 }}
                resizeMode="contain"
              />
              {pages[reviewIdx].status === 'processing' && (
                <View style={s.reviewBusy}><ActivityIndicator color="#fff" /><Text style={s.reviewBusyText}>Enhancing…</Text></View>
              )}
            </View>
            {/* pager arrows */}
            <View style={s.pagerRow}>
              <Pressable disabled={reviewIdx === 0} onPress={() => setReviewIdx(reviewIdx - 1)} style={[s.pagerBtn, reviewIdx === 0 && { opacity: 0.3 }]} testID="review-prev">
                <Ionicons name="chevron-back" size={18} color="#fff" />
              </Pressable>
              <Pressable disabled={reviewIdx >= pages.length - 1} onPress={() => setReviewIdx(reviewIdx + 1)} style={[s.pagerBtn, reviewIdx >= pages.length - 1 && { opacity: 0.3 }]} testID="review-next">
                <Ionicons name="chevron-forward" size={18} color="#fff" />
              </Pressable>
            </View>
            <View style={s.toolRow}>
              <ToolBtn icon="crop-outline" label="Crop" tid="review-crop" onPress={() => setCropIdx(reviewIdx)} />
              <ToolBtn icon="brush-outline" label="Markup" tid="review-markup" onPress={() => setMarkupIdx(reviewIdx)} />
              <ToolBtn icon="create-outline" label="Sign" tid="review-sign" onPress={() => setSignIdx(reviewIdx)} />
              <ToolBtn icon="refresh-outline" label="Rotate" tid="review-rotate" onPress={() => rotatePage(reviewIdx)} />
              <ToolBtn icon="color-filter-outline" label={FILTER_LABEL[pages[reviewIdx].filter]} tid="review-filter" onPress={() => cycleFilter(reviewIdx)} />
              <ToolBtn icon="camera-outline" label="Retake" tid="review-retake" onPress={() => { deletePage(reviewIdx); setView('camera'); }} />
              <ToolBtn icon="trash-outline" label="Delete" tid="review-delete" danger onPress={() => deletePage(reviewIdx)} />
            </View>
          </SafeAreaView>
        )}
      </Modal>

      {/* ── Crop (drag corners) modal ── */}
      <Modal visible={cropIdx !== null} transparent={false} animationType="fade" onRequestClose={() => setCropIdx(null)}>
        {cropIdx !== null && pages[cropIdx] && (
          <CropEditor
            page={pages[cropIdx]}
            onCancel={() => setCropIdx(null)}
            onApply={(corners) => { reprocess(cropIdx, { corners }); setCropIdx(null); }}
          />
        )}
      </Modal>

      {/* ── Markup & Sign on page ── */}
      {markupIdx !== null && pages[markupIdx] && (
        <PageMarkup
          visible
          image={pages[markupIdx].processed || pages[markupIdx].raw}
          onClose={() => setMarkupIdx(null)}
          onApply={(b64) => { updatePage(pages[markupIdx].id, { processed: b64 }); setMarkupIdx(null); }}
        />
      )}
      {signIdx !== null && pages[signIdx] && (
        <PageSign
          visible
          image={pages[signIdx].processed || pages[signIdx].raw}
          onClose={() => setSignIdx(null)}
          onApply={(b64) => { updatePage(pages[signIdx].id, { processed: b64 }); setSignIdx(null); }}
        />
      )}

      {/* ── Name & save modal ── */}
      <Modal visible={nameOpen} transparent animationType="fade" onRequestClose={() => setNameOpen(false)}>
        <View style={s.modalOverlay}>
          <View style={s.sheet}>
            <Text style={s.sheetTitle}>Save scanned PDF</Text>
            <TextInput
              testID="scan-name-input"
              style={s.input}
              value={docName}
              onChangeText={setDocName}
              placeholder={`Scan ${new Date().toLocaleDateString()}`}
              placeholderTextColor="#8a94a3"
            />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
              <Pressable style={[s.secondaryBtn, { flex: 1, borderColor: '#3a3f46' }]} onPress={() => setNameOpen(false)} testID="scan-name-cancel">
                <Text style={s.secondaryText}>Cancel</Text>
              </Pressable>
              <Pressable style={[s.primaryBtn, { flex: 1 }]} onPress={createPdf} disabled={saving} testID="scan-name-save">
                {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.primaryText}>Create PDF ({pages.length})</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function ToolBtn({ icon, label, onPress, tid, danger }: { icon: any; label: string; onPress: () => void; tid: string; danger?: boolean }) {
  return (
    <Pressable style={s.toolBtn} onPress={onPress} testID={tid}>
      <Ionicons name={icon} size={21} color={danger ? '#f87171' : '#fff'} />
      <Text style={[s.toolLabel, danger && { color: '#f87171' }]}>{label}</Text>
    </Pressable>
  );
}

/** Draggable 4-corner crop editor over the original capture. */
function CropEditor({ page, onCancel, onApply }: { page: Page; onCancel: () => void; onApply: (corners: number[][]) => void }) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [corners, setCorners] = useState<number[][]>(page.corners || [[0.06, 0.06], [0.94, 0.06], [0.94, 0.94], [0.06, 0.94]]);
  const cornersRef = useRef(corners);
  cornersRef.current = corners;
  const [imgDim, setImgDim] = useState<{ w: number; h: number } | null>(page.imgW ? { w: page.imgW, h: page.imgH! } : null);

  useEffect(() => {
    if (!imgDim) {
      Image.getSize(`data:image/jpeg;base64,${page.raw}`, (w, h) => setImgDim({ w, h }), () => setImgDim({ w: 3, h: 4 }));
    }
  }, [imgDim, page.raw]);

  // displayed image rect (contain-fit)
  const fit = (() => {
    if (!imgDim || !box.w || !box.h) return { x: 0, y: 0, w: 0, h: 0 };
    const scale = Math.min(box.w / imgDim.w, box.h / imgDim.h);
    const w = imgDim.w * scale, h = imgDim.h * scale;
    return { x: (box.w - w) / 2, y: (box.h - h) / 2, w, h };
  })();
  const fitRef = useRef(fit);
  fitRef.current = fit;

  const toPx = (c: number[]) => [fit.x + c[0] * fit.w, fit.y + c[1] * fit.h];

  return (
    <SafeAreaView style={s.reviewWrap} edges={['top', 'bottom']}>
      <View style={s.topBar}>
        <Pressable onPress={onCancel} style={s.roundBtn} testID="crop-cancel">
          <Ionicons name="close" size={20} color="#fff" />
        </Pressable>
        <Text style={s.topTitle}>Adjust corners</Text>
        <Pressable onPress={() => onApply(cornersRef.current)} style={s.doneBtn} testID="crop-apply">
          <Ionicons name="checkmark" size={16} color="#0b0d10" />
          <Text style={s.doneText}>Apply</Text>
        </Pressable>
      </View>
      <View style={{ flex: 1, margin: 12 }} onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        <Image source={{ uri: `data:image/jpeg;base64,${page.raw}` }} style={{ position: 'absolute', left: fit.x, top: fit.y, width: fit.w, height: fit.h }} />
        {fit.w > 0 && (
          <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
            <Polygon
              points={corners.map((c) => toPx(c).join(',')).join(' ')}
              fill="rgba(45,193,124,0.14)"
              stroke="#2dc17c"
              strokeWidth={2.5}
            />
            {corners.map((c, i) => {
              const [px, py] = toPx(c);
              return <Circle key={i} cx={px} cy={py} r={11} fill="rgba(45,193,124,0.35)" stroke="#2dc17c" strokeWidth={2.5} />;
            })}
          </Svg>
        )}
        {fit.w > 0 && corners.map((c, i) => (
          <CornerHandle
            key={i}
            idx={i}
            corner={c}
            fitRef={fitRef}
            cornersRef={cornersRef}
            onMove={(nc) => setCorners(nc)}
          />
        ))}
      </View>
      <Text style={s.cropHint}>Drag the green corners to the document edges</Text>
    </SafeAreaView>
  );
}

function CornerHandle({ idx, corner, fitRef, cornersRef, onMove }: {
  idx: number; corner: number[];
  fitRef: React.MutableRefObject<{ x: number; y: number; w: number; h: number }>;
  cornersRef: React.MutableRefObject<number[][]>;
  onMove: (corners: number[][]) => void;
}) {
  const startRef = useRef([0, 0]);
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => { startRef.current = [...cornersRef.current[idx]]; },
      onPanResponderMove: (_, g) => {
        const f = fitRef.current;
        if (!f.w) return;
        const nx = clamp(startRef.current[0] + g.dx / f.w, 0, 1);
        const ny = clamp(startRef.current[1] + g.dy / f.h, 0, 1);
        const next = cornersRef.current.map((c, i) => (i === idx ? [nx, ny] : c));
        onMove(next);
      },
    })
  ).current;
  const f = fitRef.current;
  const px = f.x + corner[0] * f.w;
  const py = f.y + corner[1] * f.h;
  return (
    <View
      {...pan.panHandlers}
      testID={`crop-corner-${idx}`}
      style={{ position: 'absolute', left: px - 24, top: py - 24, width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}
    />
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0d10' },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
  topTitle: { flex: 1, color: '#fff', fontSize: 15, fontWeight: '600', textAlign: 'center' },
  roundBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  doneBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#2dc17c', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9 },
  doneText: { color: '#0b0d10', fontWeight: '700', fontSize: 13 },
  camWrap: { flex: 1, overflow: 'hidden', borderRadius: 14, marginHorizontal: 10 },
  guide: { ...StyleSheet.absoluteFillObject, margin: 26, justifyContent: 'flex-end', alignItems: 'center' },
  gCorner: { position: 'absolute', width: 34, height: 34, borderColor: '#2dc17c', borderWidth: 0 },
  gTL: { top: 0, left: 0, borderTopWidth: 3.5, borderLeftWidth: 3.5, borderTopLeftRadius: 8 },
  gTR: { top: 0, right: 0, borderTopWidth: 3.5, borderRightWidth: 3.5, borderTopRightRadius: 8 },
  gBL: { bottom: 0, left: 0, borderBottomWidth: 3.5, borderLeftWidth: 3.5, borderBottomLeftRadius: 8 },
  gBR: { bottom: 0, right: 0, borderBottomWidth: 3.5, borderRightWidth: 3.5, borderBottomRightRadius: 8 },
  guideText: { color: 'rgba(255,255,255,0.85)', fontSize: 12, marginBottom: 8, backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, overflow: 'hidden' },
  flashOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: '#fff', opacity: 0.7 },
  errBox: { position: 'absolute', bottom: 12, left: 12, right: 12, backgroundColor: 'rgba(220,38,38,0.9)', borderRadius: 10, padding: 10 },
  errText: { color: '#fff', fontSize: 12.5, textAlign: 'center' },
  thumbWrap: { width: 52, height: 68, borderRadius: 8, overflow: 'hidden', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.25)' },
  thumb: { width: '100%', height: '100%' },
  thumbBusy: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  thumbNo: { position: 'absolute', bottom: 2, left: 4, color: '#fff', fontSize: 10, fontWeight: '700', textShadowColor: '#000', textShadowRadius: 3 },
  bottomBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingVertical: 16, paddingBottom: 26, backgroundColor: '#0b0d10' },
  sideBtn: { alignItems: 'center', gap: 4, minWidth: 64 },
  sideLabel: { color: '#fff', fontSize: 11 },
  shutter: { width: 72, height: 72, borderRadius: 36, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#fff' },
  permBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  permTitle: { color: '#fff', fontSize: 17, fontWeight: '600', textAlign: 'center' },
  permSub: { color: '#9aa4b2', fontSize: 13, textAlign: 'center', lineHeight: 19 },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#2dc17c', borderRadius: 12, paddingHorizontal: 20, paddingVertical: 13, marginTop: 8 },
  primaryText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  secondaryText: { color: '#fff', fontWeight: '500', fontSize: 13.5 },
  reviewWrap: { flex: 1, backgroundColor: '#0b0d10' },
  reviewBusy: { position: 'absolute', alignSelf: 'center', top: '46%', flexDirection: 'row', gap: 8, backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9, alignItems: 'center' },
  reviewBusyText: { color: '#fff', fontSize: 12.5 },
  pagerRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 18, marginTop: -46, marginBottom: 8 },
  pagerBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  toolRow: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 12, paddingBottom: 18, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)' },
  toolBtn: { alignItems: 'center', gap: 4, minWidth: 52 },
  toolLabel: { color: '#fff', fontSize: 10.5 },
  cropHint: { color: '#9aa4b2', fontSize: 12, textAlign: 'center', paddingBottom: 16 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 24 },
  sheet: { backgroundColor: '#16191d', borderRadius: 18, padding: 20 },
  sheetTitle: { color: '#fff', fontSize: 17, fontWeight: '600', marginBottom: 12 },
  input: { backgroundColor: '#0b0d10', borderWidth: 1, borderColor: '#3a3f46', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: '#fff', fontSize: 14 },
  // gallery
  galleryName: { flex: 1, color: '#fff', fontSize: 16, fontWeight: '600', paddingVertical: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, padding: 14, paddingBottom: 30 },
  gridTile: { width: '47%', aspectRatio: 0.72, borderRadius: 10, overflow: 'hidden', backgroundColor: '#16191d', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  gridImg: { width: '100%', height: '100%' },
  gridNo: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.55)', paddingVertical: 4, paddingHorizontal: 8 },
  gridNoText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  gridArrows: { position: 'absolute', top: 6, left: 6, right: 6, flexDirection: 'row', justifyContent: 'space-between' },
  gridArrowBtn: { width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  addTile: { width: '47%', aspectRatio: 0.72, borderRadius: 10, borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#3a3f46', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 10 },
  addTileText: { color: '#8a94a3', fontSize: 12, textAlign: 'center' },
  galleryBar: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 12, paddingBottom: 24, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)', backgroundColor: '#0b0d10' },
  galleryErr: { color: '#f87171', textAlign: 'center', paddingVertical: 6, fontSize: 12 },
});
