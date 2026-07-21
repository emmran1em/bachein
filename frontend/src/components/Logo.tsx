import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';

// Bachein AI avatar - minimal robot mark
export function AiAvatar({ size = 40 }: { size?: number }) {
  const inner = Math.round(size * 0.55);
  return (
    <View style={[styles.wrap, { width: size, height: size, borderRadius: Math.round(size * 0.22) }]}>
      <Ionicons name="hardware-chip-outline" size={inner} color={theme.colors.brand} />
      <View style={[styles.dot, { top: -2, right: size * 0.42 }]} />
    </View>
  );
}

// Bachein brand mark - stacked "b" with subtle underline
export function BacheinLogo({ size = 32 }: { size?: number }) {
  return (
    <View style={{ alignItems: 'flex-start' }}>
      <Text style={[styles.brand, { fontSize: size }]}>bachein</Text>
      <View style={[styles.brandUnderline, { width: size * 2.2 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: theme.colors.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: theme.colors.brand,
  },
  dot: { position: 'absolute', width: 4, height: 4, borderRadius: 2, backgroundColor: theme.colors.accent },
  brand: { fontWeight: '500', color: theme.colors.brand, letterSpacing: -1.5 },
  brandUnderline: { height: 2, backgroundColor: theme.colors.accent, marginTop: 2 },
});
