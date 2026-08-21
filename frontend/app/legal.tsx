import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';

const SECTIONS: Record<string, { title: string; icon: any; body: string[] }> = {
  terms: {
    title: 'Terms & Conditions',
    icon: 'document-text-outline',
    body: [
      '1. Acceptance — By creating a Bachein account or using the app you agree to these Terms. If you do not agree, please do not use Bachein.',
      '2. The Service — Bachein provides AI-assisted document creation, secure document sharing, e-signing, scanning, OCR and related tools. Features may change, improve or be withdrawn at any time.',
      '3. Your Account — You are responsible for keeping your login credentials safe and for all activity on your account. Notify us immediately of any unauthorised use.',
      '4. Your Content — You own the documents you create and upload. You grant Bachein a limited licence to process, store and transmit your content solely to provide the service (e.g. generating PDFs, running OCR, delivering documents to recipients you choose).',
      '5. Acceptable Use — You must not use Bachein for unlawful content, to infringe others\u2019 rights, to send spam, or to attempt to breach the security of the service.',
      '6. E-Signatures — Signatures collected through Bachein are electronic signatures. You are responsible for confirming that electronic signatures are legally valid for your specific document type and jurisdiction.',
      '7. Disclaimer — Bachein documents and AI outputs are provided \u201cas is\u201d without warranties. Bachein is not a law firm and does not provide legal advice.',
      '8. Limitation of Liability — To the maximum extent permitted by law, Bachein is not liable for indirect or consequential losses arising from use of the service.',
      '9. Termination — We may suspend accounts that violate these Terms. You may delete your account at any time.',
      '10. Changes — We may update these Terms; continued use after an update means you accept the new Terms.',
    ],
  },
  children: {
    title: 'Children\u2019s Privacy Policy',
    icon: 'shield-half-outline',
    body: [
      'Bachein is not directed at children under 13 (or the minimum digital-consent age in your country).',
      'We do not knowingly collect personal information from children. If you believe a child has created an account, contact us and we will delete the account and associated data promptly.',
      'Students using Bachein for study tools (question papers, answer booklets, notes) should do so under the guidance of a parent, guardian or school.',
      'Parents/guardians may request access to, correction of, or deletion of their child\u2019s data at any time.',
      'We apply the same security controls (encryption in transit, access controls, verification gates) to every account regardless of age.',
    ],
  },
  ai: {
    title: 'Usage of AI Policy',
    icon: 'sparkles-outline',
    body: [
      'What AI does in Bachein — drafting documents, generating question papers and answers, summarising, proofreading, OCR text extraction, voice assistance, and explaining content you select.',
      'AI can make mistake, please check important info. Always review AI-generated documents before sending, signing or submitting them.',
      'Your prompts and document context are sent to the AI provider you select (or Bachein\u2019s managed provider) only to generate the response you asked for.',
      'Bring-Your-Own-Key — if you add your own API key, requests are made with your key and are subject to that provider\u2019s terms.',
      'AI outputs are not legal, medical or financial advice. For legally binding documents, have a qualified professional review the final text.',
      'Do not use Bachein AI to generate unlawful, harmful, or deceptive content. We may restrict AI features for accounts that abuse them.',
      'Exam tools generate practice material based on public exam patterns; they are study aids, not leaked or official papers.',
    ],
  },
  legal: {
    title: 'NDA & Legal',
    icon: 'ribbon-outline',
    body: [
      'NDA Templates — Bachein offers template structures (Mutual, One-way, Employee, Investor, Vendor). Templates are starting points, not legal advice; laws differ by jurisdiction.',
      'Verification Gates — Senders may require Email OTP, face check or voice oath before a recipient can view an NDA. These controls raise assurance but do not by themselves constitute identity proof for court purposes.',
      'Signatures & Dates — Bachein embeds both parties\u2019 signatures and the signing dates into the final PDF. Keep your downloaded copy; both parties receive the same signed document.',
      'Audit Trail — Bachein records document events (sent, viewed, verified, signed) to support the integrity of the agreement.',
      'Confidentiality of your documents — Bachein staff do not read your documents. Access is protected by your account credentials and the security features you enable.',
      'Disputes — Any dispute about the underlying agreement is between the signing parties. Bachein provides the tooling, not representation.',
      'Contact — For legal or privacy requests, contact the Bachein team from the Profile section.',
    ],
  },
};

export default function LegalScreen() {
  const router = useRouter();
  const { section } = useLocalSearchParams<{ section?: string }>();
  const sec = SECTIONS[String(section || 'terms')] || SECTIONS.terms;
  return (
    <SafeAreaView style={s.container} edges={['top']} testID="legal-screen">
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.iconBtn} testID="legal-back">
          <Ionicons name="chevron-back" size={22} color={theme.colors.brand} />
        </Pressable>
        <Ionicons name={sec.icon} size={18} color={theme.colors.brand} />
        <Text style={s.title}>{sec.title}</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
        <Text style={s.updated}>Last updated: June 2026</Text>
        {sec.body.map((p, i) => (
          <View key={i} style={s.para}>
            <Text style={s.paraText}>{p}</Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10 },
  iconBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, color: theme.colors.brand, fontSize: 17, fontWeight: '600' },
  updated: { color: theme.colors.muted, fontSize: 11.5, marginBottom: 14 },
  para: { backgroundColor: theme.colors.card, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border, padding: 14, marginBottom: 10 },
  paraText: { color: theme.colors.onSurfaceSecondary, fontSize: 13.5, lineHeight: 20 },
});
