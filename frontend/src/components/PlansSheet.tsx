import React from 'react';
import { View, Text, StyleSheet, Modal, Pressable, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import BacheinAiLogo from './BacheinAiLogo';

type Tier = 'free' | 'pro' | 'byo';

const PLANS = [
  {
    id: 'free',
    title: 'Free',
    price: '₹0',
    priceNote: 'forever',
    tagline: 'Everyday help, on us.',
    accent: false,
    cta: 'Current plan',
    features: [
      '20 AI messages / day',
      '200 AI messages / month',
      'Access to Gemini · Claude · ChatGPT',
      'AI drafting for NDAs & contracts',
      'Ask BacheIn inside documents',
    ],
  },
  {
    id: 'pro',
    title: 'Pro',
    price: '₹499',
    priceNote: '/ month',
    tagline: 'For daily creators.',
    accent: true,
    cta: 'Upgrade',
    features: [
      '500 AI messages / day',
      '10,000 AI messages / month',
      'Priority AI speed',
      'Larger document context',
      'Advanced doc generation & analysis',
      'Premium collaboration features',
    ],
  },
  {
    id: 'byo',
    title: 'Advanced',
    price: 'Your keys',
    priceNote: 'no limits',
    tagline: 'Bring your own AI.',
    accent: false,
    cta: 'Connect key',
    features: [
      'Unlimited AI usage',
      'Connect Claude, Gemini, GPT, xAI',
      'Uses your own subscription & billing',
      'Switch providers anytime',
      'Multi-provider workflow',
    ],
  },
];

export default function PlansSheet({ visible, onClose, currentTier = 'free' as Tier }: { visible: boolean; onClose: () => void; currentTier?: Tier }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <Pressable style={s.backdrop} onPress={onClose} />
        <View style={s.sheet}>
          <View style={s.handle} />
          <View style={s.head}>
            <BacheinAiLogo size={24} />
            <View style={{ flex: 1 }}>
              <Text style={s.title}>Upgrade to BacheIn Pro</Text>
              <Text style={s.subtitle}>Pick a plan that grows with your work</Text>
            </View>
            <Pressable style={s.closeBtn} onPress={onClose} testID="plans-close">
              <Ionicons name="close" size={20} color={theme.colors.brand} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40, gap: 12 }}>
            {PLANS.map((p) => {
              const isCurrent = (p.id === 'free' && currentTier === 'free') ||
                                (p.id === 'pro' && currentTier === 'pro') ||
                                (p.id === 'byo' && currentTier === 'byo');
              return (
                <View key={p.id} style={[s.card, p.accent && s.cardAccent, isCurrent && s.cardCurrent]}>
                  <View style={s.cardHead}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.planTitle}>{p.title}</Text>
                      <Text style={s.planTag}>{p.tagline}</Text>
                    </View>
                    {isCurrent && <View style={s.currentBadge}><Text style={s.currentText}>CURRENT</Text></View>}
                  </View>
                  <View style={s.priceRow}>
                    <Text style={[s.price, p.accent && s.priceAccent]}>{p.price}</Text>
                    <Text style={s.priceNote}>{p.priceNote}</Text>
                  </View>
                  <View style={s.divider} />
                  {p.features.map((f, i) => (
                    <View key={i} style={s.featureRow}>
                      <Ionicons name="checkmark-circle" size={14} color={p.accent ? theme.colors.accent : theme.colors.success} />
                      <Text style={s.featureText}>{f}</Text>
                    </View>
                  ))}
                  {!isCurrent && (
                    <Pressable style={[s.cta, p.accent && s.ctaAccent]} testID={`plans-cta-${p.id}`}>
                      <Text style={[s.ctaText, p.accent && s.ctaTextAccent]}>{p.cta}</Text>
                    </Pressable>
                  )}
                </View>
              );
            })}

            <Text style={s.footNote}>Cancel anytime. Prices in INR. Free plan uses BacheIn&apos;s AI allocation.</Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  sheet: { backgroundColor: theme.colors.surface, borderTopLeftRadius: 26, borderTopRightRadius: 26, maxHeight: '92%' },
  handle: { alignSelf: 'center', width: 42, height: 4, borderRadius: 2, backgroundColor: theme.colors.borderStrong, marginTop: 8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 6 },
  title: { color: theme.colors.brand, fontSize: 20, fontWeight: '500', letterSpacing: -0.4 },
  subtitle: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  closeBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border },
  card: { backgroundColor: '#fff', borderRadius: 18, padding: 18, borderWidth: 1, borderColor: theme.colors.border },
  cardAccent: { borderColor: theme.colors.brand, borderWidth: 2 },
  cardCurrent: { backgroundColor: theme.colors.card },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start' },
  planTitle: { color: theme.colors.brand, fontSize: 18, fontWeight: '600', letterSpacing: -0.3 },
  planTag: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  currentBadge: { backgroundColor: '#DCEBE2', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  currentText: { color: theme.colors.success, fontSize: 9, fontWeight: '600', letterSpacing: 0.5 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 12 },
  price: { color: theme.colors.brand, fontSize: 28, fontWeight: '600', letterSpacing: -0.5 },
  priceAccent: { color: theme.colors.brand },
  priceNote: { color: theme.colors.muted, fontSize: 12 },
  divider: { height: 1, backgroundColor: theme.colors.divider, marginVertical: 12 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  featureText: { color: theme.colors.onSurfaceSecondary, fontSize: 13, flex: 1 },
  cta: { marginTop: 14, borderRadius: 12, paddingVertical: 12, alignItems: 'center', backgroundColor: theme.colors.brand },
  ctaAccent: { backgroundColor: theme.colors.brand },
  ctaText: { color: '#fff', fontWeight: '500', fontSize: 14 },
  ctaTextAccent: { color: '#fff' },
  footNote: { color: theme.colors.muted, fontSize: 11, textAlign: 'center', marginTop: 10, lineHeight: 16 },
});
