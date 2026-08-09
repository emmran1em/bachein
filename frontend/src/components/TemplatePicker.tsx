import React from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';

export type DocTemplate = { id: string; name: string; desc: string; icon: any };

export const NDA_TEMPLATES: DocTemplate[] = [
  { id: 'Mutual NDA', name: 'Mutual NDA', desc: 'Both parties exchange confidential information', icon: 'swap-horizontal-outline' },
  { id: 'One-way (Unilateral) NDA', name: 'One-way NDA', desc: 'You disclose — the other party only receives', icon: 'arrow-forward-outline' },
  { id: 'Employee / Contractor NDA', name: 'Employee NDA', desc: 'For staff, freelancers and contractors', icon: 'briefcase-outline' },
  { id: 'Startup–Investor NDA', name: 'Investor NDA', desc: 'Pitch decks, fundraising and diligence', icon: 'trending-up-outline' },
  { id: 'Vendor / Manufacturing NDA', name: 'Vendor NDA', desc: 'Suppliers, manufacturers and partners', icon: 'construct-outline' },
];

export const GENERIC_TEMPLATES: DocTemplate[] = [
  { id: 'Formal & Legal', name: 'Formal Legal', desc: 'Precise clauses, numbered sections', icon: 'library-outline' },
  { id: 'Business Professional', name: 'Business', desc: 'Corporate tone, executive-ready', icon: 'business-outline' },
  { id: 'Academic / Research', name: 'Academic', desc: 'Citations-friendly research structure', icon: 'school-outline' },
  { id: 'Simple & Clear', name: 'Simple', desc: 'Plain language, easy to read', icon: 'sunny-outline' },
  { id: 'Detailed & Comprehensive', name: 'Detailed', desc: 'Every section covered in depth', icon: 'layers-outline' },
];

/** Professional template chooser shown before AI drafting. */
export default function TemplatePicker({ category, selected, onSelect }: {
  category?: string;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const isNda = (category || '').toLowerCase().includes('nda');
  const templates = isNda ? NDA_TEMPLATES : GENERIC_TEMPLATES;
  return (
    <View style={{ marginTop: 16 }}>
      <Text style={s.label}>CHOOSE A TEMPLATE</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingVertical: 8, paddingRight: 12 }}>
        {templates.map((t) => {
          const on = selected === t.id;
          return (
            <Pressable key={t.id} testID={`template-${t.name.replace(/ /g, '-')}`} style={[s.card, on && s.cardOn]} onPress={() => onSelect(t.id)}>
              <View style={[s.iconWrap, on && { backgroundColor: 'rgba(255,255,255,0.18)' }]}>
                <Ionicons name={t.icon} size={20} color={on ? '#fff' : theme.colors.brand} />
              </View>
              <Text style={[s.name, on && { color: '#fff' }]}>{t.name}</Text>
              <Text style={[s.desc, on && { color: 'rgba(255,255,255,0.8)' }]} numberOfLines={3}>{t.desc}</Text>
              {on && <Ionicons name="checkmark-circle" size={16} color="#fff" style={s.check} />}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  label: { color: theme.colors.muted, fontSize: 10, letterSpacing: 1 },
  card: { width: 150, backgroundColor: theme.colors.card, borderRadius: 16, borderWidth: 1, borderColor: theme.colors.border, padding: 14, gap: 6 },
  cardOn: { backgroundColor: theme.colors.brand, borderColor: theme.colors.brand },
  iconWrap: { width: 38, height: 38, borderRadius: 12, backgroundColor: theme.colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center' },
  name: { color: theme.colors.brand, fontWeight: '600', fontSize: 13.5 },
  desc: { color: theme.colors.muted, fontSize: 11, lineHeight: 15 },
  check: { position: 'absolute', top: 10, right: 10 },
});
