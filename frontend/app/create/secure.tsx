import { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { theme } from '@/src/theme';
import { api, uploadFile } from '@/src/api';

type Step = 'intent' | 'draft' | 'attach' | 'security' | 'recipient';

const TOGGLES: { key: string; label: string; sub: string }[] = [
  { key: 'otp_verification', label: 'OTP Verification', sub: 'Email/SMS one-time code before access' },
  { key: 'voice_oath', label: 'Voice Oath', sub: 'Record audio confidentiality affirmation' },
  { key: 'digital_signature', label: 'Digital Signature', sub: 'Recipient must sign electronically' },
  { key: 'face_verification', label: 'Face Verification', sub: 'Capture selfie before access' },
  { key: 'device_verification', label: 'Device Verification', sub: 'Bind to recipient device' },
  { key: 'dynamic_watermark', label: 'Dynamic Watermark', sub: 'Embed viewer identity on content' },
  { key: 'disable_download', label: 'Disable Download', sub: 'Prevent file download' },
  { key: 'disable_forwarding', label: 'Disable Forwarding', sub: 'Block sharing the link' },
  { key: 'disable_printing', label: 'Disable Printing', sub: 'Block print dialog' },
  { key: 'screenshot_detection', label: 'Screenshot Detection', sub: 'Log if screenshot detected' },
  { key: 'geo_restriction', label: 'Geo Restriction', sub: 'Restrict by region' },
  { key: 'time_limited_viewing', label: 'Time-Limited Viewing', sub: 'Expire after first view + N hours' },
  { key: 'evidence_logging', label: 'Evidence Logging', sub: 'Audit all interactions' },
];

export default function SecureCreate() {
  const router = useRouter();
  const { category } = useLocalSearchParams<{ category: string }>();
  const [step, setStep] = useState<Step>('intent');
  const [intent, setIntent] = useState('');
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<{ title: string; content: string; cover_page: string } | null>(null);
  const [review, setReview] = useState<any>(null);
  const [reviewing, setReviewing] = useState(false);
  const [config, setConfig] = useState<Record<string, any>>({
    otp_verification: true, voice_oath: true, digital_signature: true,
    dynamic_watermark: true, disable_forwarding: true, evidence_logging: true,
    face_verification: false, device_verification: false, disable_download: false,
    disable_printing: false, screenshot_detection: false, geo_restriction: false,
    time_limited_viewing: false, access_expiry_hours: 168,
  });
  const [recipient, setRecipient] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');
  const [attached, setAttached] = useState<Array<{ name: string; type: string; size: number; extracted_text?: string }>>([]);
  const [uploading, setUploading] = useState(false);

  const pickAndUpload = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'image/*'],
        copyToCacheDirectory: true,
      });
      if (res.canceled) return;
      const asset = res.assets[0];
      setUploading(true);
      const up: any = await uploadFile({ uri: asset.uri, name: asset.name, type: asset.mimeType || 'application/octet-stream' });
      setAttached(prev => [...prev, { name: up.filename, type: up.content_type, size: up.size, extracted_text: up.extracted_text_preview }]);
    } catch (e: any) { setErr('Upload failed: ' + e.message); }
    finally { setUploading(false); }
  };

  const draftDoc = async () => {
    setErr(''); setLoading(true);
    try {
      const r: any = await api.generate({ prompt: intent, category: category || 'NDA' });
      setDraft(r);
      setReviewing(true);
      try {
        const rv: any = await api.review(r.content);
        setReview(rv);
      } catch {}
      setReviewing(false);
      setStep('draft');
    } catch (e: any) { setErr(e.message); } finally { setLoading(false); }
  };

  const send = async () => {
    if (!draft) return;
    if (!recipient.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.trim())) {
      setErr('Recipient email is required and must be valid.');
      return;
    }
    setSending(true); setErr('');
    try {
      const doc: any = await api.createDocument({
        title: draft.title,
        category: category || 'NDA',
        mode: 'secure',
        content: draft.content,
        recipient_email: recipient.trim() || undefined,
        security_config: config,
        attached_files: attached,
      });
      router.replace(`/document/${doc.id}`);
    } catch (e: any) { setErr(e.message); } finally { setSending(false); }
  };

  return (
    <SafeAreaView style={s.container} edges={['top']} testID="create-secure-screen">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View style={s.header}>
          <Pressable onPress={() => step === 'intent' ? router.back() : setStep(step === 'recipient' ? 'security' : step === 'security' ? 'attach' : step === 'attach' ? 'draft' : 'intent')} style={s.closeBtn} testID="back-button">
            <Ionicons name="chevron-back" size={22} color={theme.colors.brand} />
          </Pressable>
          <Text style={s.eyebrow}>{category} • SECURE</Text>
        </View>

        <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 140 }} keyboardShouldPersistTaps="handled">
          {step === 'intent' && (
            <>
              <Text style={s.title}>Describe what you want to protect</Text>
              <Text style={s.subtitle}>Bachein AI will draft a {category} with NDA, IP, confidentiality, and enforcement clauses.</Text>
              <TextInput
                testID="intent-input"
                style={s.textArea}
                value={intent}
                onChangeText={setIntent}
                placeholder="e.g. I want to share my startup technology with a manufacturer in Bangalore."
                placeholderTextColor={theme.colors.muted}
                multiline
              />
              {err ? <Text style={s.err}>{err}</Text> : null}
              <Pressable testID="draft-btn" style={[s.primaryBtn, (!intent || loading) && { opacity: 0.6 }]} disabled={!intent || loading} onPress={draftDoc}>
                {loading ? <ActivityIndicator color={theme.colors.onBrandPrimary} /> : (<><Ionicons name="sparkles" size={16} color={theme.colors.onBrandPrimary} /><Text style={s.primaryBtnText}>Draft with AI</Text></>)}
              </Pressable>
            </>
          )}

          {step === 'draft' && draft && (
            <>
              <Text style={s.title}>{draft.title}</Text>
              <Text style={s.subtitle}>{draft.cover_page}</Text>
              <View style={s.docBox}>
                <Text style={s.docBody}>{draft.content.slice(0, 1600)}{draft.content.length > 1600 ? '…' : ''}</Text>
              </View>

              {reviewing && <ActivityIndicator style={{ marginTop: 12 }} color={theme.colors.brand} />}
              {review && (
                <View style={s.reviewCard} testID="ai-review-card">
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Ionicons name="alert-circle" size={16} color={theme.colors.warning} />
                    <Text style={s.reviewTitle}>AI Legal Review</Text>
                  </View>
                  <Text style={s.reviewSummary}>{review.summary}</Text>
                  {(review.missing_clauses || []).slice(0, 3).map((c: string, i: number) => (
                    <Text key={i} style={s.reviewLine}>• Missing: {c}</Text>
                  ))}
                  {(review.recommendations || []).slice(0, 3).map((c: string, i: number) => (
                    <Text key={'r'+i} style={s.reviewLine}>• Tip: {c}</Text>
                  ))}
                </View>
              )}

              <Pressable testID="goto-security-btn" style={s.primaryBtn} onPress={() => setStep('attach')}>
                <Text style={s.primaryBtnText}>Continue to Attach Files</Text>
                <Ionicons name="arrow-forward" size={16} color={theme.colors.onBrandPrimary} />
              </Pressable>
            </>
          )}

          {step === 'attach' && (
            <>
              <Text style={s.title}>Attach Protected Files</Text>
              <Text style={s.subtitle}>Optional. Upload PDFs, Word, Excel, PPT, images, source-code archives. Bachein AI will auto-scan for sensitive content.</Text>
              <Pressable testID="pick-file-btn" style={s.secondaryBtn} onPress={pickAndUpload} disabled={uploading}>
                {uploading ? <ActivityIndicator color={theme.colors.brand} /> : (
                  <>
                    <Ionicons name="cloud-upload-outline" size={16} color={theme.colors.brand} />
                    <Text style={s.secondaryBtnText}>Upload file</Text>
                  </>
                )}
              </Pressable>
              {attached.length > 0 && (
                <View style={{ marginTop: 14 }}>
                  {attached.map((f, i) => (
                    <View key={i} style={s.fileRow} testID={`file-row-${i}`}>
                      <Ionicons name="document" size={16} color={theme.colors.brand} />
                      <View style={{ flex: 1, marginLeft: 8 }}>
                        <Text style={s.fileName} numberOfLines={1}>{f.name}</Text>
                        <Text style={s.fileMeta}>{Math.round(f.size / 1024)} KB</Text>
                      </View>
                      <Pressable testID={`remove-file-${i}`} onPress={() => setAttached(prev => prev.filter((_, j) => j !== i))}>
                        <Ionicons name="close" size={18} color={theme.colors.muted} />
                      </Pressable>
                    </View>
                  ))}
                </View>
              )}
              <Pressable testID="goto-security-btn-2" style={s.primaryBtn} onPress={() => setStep('security')}>
                <Text style={s.primaryBtnText}>Continue to Security</Text>
                <Ionicons name="arrow-forward" size={16} color={theme.colors.onBrandPrimary} />
              </Pressable>
            </>
          )}

          {step === 'security' && (
            <>
              <Text style={s.title}>Security Configuration</Text>
              <Text style={s.subtitle}>Toggle the protections required before the recipient can access this document.</Text>
              <View style={{ marginTop: 16 }}>
                {TOGGLES.map(t => (
                  <View key={t.key} style={s.toggleRow} testID={`toggle-${t.key}`}>
                    <View style={{ flex: 1, paddingRight: 12 }}>
                      <Text style={s.toggleLabel}>{t.label}</Text>
                      <Text style={s.toggleSub}>{t.sub}</Text>
                    </View>
                    <Switch
                      value={!!config[t.key]}
                      onValueChange={(v) => setConfig({ ...config, [t.key]: v })}
                      trackColor={{ false: '#E5E5E2', true: theme.colors.brand }}
                      thumbColor={'#fff'}
                    />
                  </View>
                ))}
              </View>
              <Pressable testID="goto-recipient-btn" style={s.primaryBtn} onPress={() => setStep('recipient')}>
                <Text style={s.primaryBtnText}>Continue</Text>
                <Ionicons name="arrow-forward" size={16} color={theme.colors.onBrandPrimary} />
              </Pressable>
            </>
          )}

          {step === 'recipient' && (
            <>
              <Text style={s.title}>Send to recipient</Text>
              <Text style={s.subtitle}>Enter the recipient's email. They will receive a notification and complete verification before viewing.</Text>
              <Text style={s.label}>Recipient email *</Text>
              <TextInput
                testID="recipient-email-input"
                style={[s.input, err && !recipient ? { borderColor: theme.colors.error } : null]}
                value={recipient}
                onChangeText={setRecipient}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="recipient@company.com"
                placeholderTextColor={theme.colors.muted}
              />
              <View style={s.confirmBox}>
                <Ionicons name="shield-checkmark" size={18} color={theme.colors.success} />
                <Text style={s.confirmText}>I confirm that I am authorized to share this information.</Text>
              </View>
              {err ? <Text style={s.err}>{err}</Text> : null}
              <Pressable testID="send-secure-btn" style={[s.primaryBtn, sending && { opacity: 0.6 }]} disabled={sending} onPress={send}>
                {sending ? <ActivityIndicator color={theme.colors.onBrandPrimary} /> : <Text style={s.primaryBtnText}>Send Securely</Text>}
              </Pressable>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
  closeBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border },
  eyebrow: { color: theme.colors.muted, fontSize: 11, letterSpacing: 1 },
  title: { fontSize: 24, color: theme.colors.brand, fontWeight: '500', letterSpacing: -0.5, lineHeight: 30 },
  subtitle: { color: theme.colors.muted, marginTop: 8, lineHeight: 20 },
  textArea: { backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border, borderRadius: 14, padding: 14, fontSize: 15, color: theme.colors.brand, minHeight: 130, marginTop: 16, textAlignVertical: 'top' },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, padding: 14, fontSize: 15, color: theme.colors.brand },
  label: { color: theme.colors.muted, fontSize: 11, letterSpacing: 1, marginTop: 20, marginBottom: 8 },
  err: { color: theme.colors.error, marginTop: 12 },
  primaryBtn: { flexDirection: 'row', gap: 8, marginTop: 24, backgroundColor: theme.colors.brand, padding: 16, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: theme.colors.onBrandPrimary, fontWeight: '500', fontSize: 15 },
  docBox: { backgroundColor: '#fff', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: theme.colors.border, marginTop: 16 },
  docBody: { color: theme.colors.onSurfaceSecondary, lineHeight: 20, fontSize: 13 },
  reviewCard: { backgroundColor: '#FFF8EF', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#F2DCB6', marginTop: 14 },
  reviewTitle: { fontWeight: '500', color: theme.colors.brand },
  reviewSummary: { color: theme.colors.onSurfaceSecondary, marginTop: 6, lineHeight: 18, fontSize: 13 },
  reviewLine: { color: theme.colors.onSurfaceSecondary, marginTop: 4, fontSize: 12 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: theme.colors.border, marginBottom: 8 },
  toggleLabel: { color: theme.colors.brand, fontWeight: '500', fontSize: 14 },
  toggleSub: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  confirmBox: { flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: '#EAF3EE', borderRadius: 12, padding: 14, marginTop: 16 },
  confirmText: { color: theme.colors.onSurfaceSecondary, flex: 1, fontSize: 13, lineHeight: 18 },
  fileRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, marginBottom: 8 },
  fileName: { color: theme.colors.brand, fontSize: 13, fontWeight: '500' },
  fileMeta: { color: theme.colors.muted, fontSize: 11 },
});
