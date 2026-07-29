import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';

const MODES = {
  thinking: {
    icon: 'bulb-outline' as const,
    label: 'Bachein is thinking',
    hints: ['Reasoning through your request…', 'Considering multiple angles…', 'Formulating a response…'],
  },
  drafting: {
    icon: 'document-text-outline' as const,
    label: 'Drafting your document',
    hints: ['Structuring sections…', 'Choosing precise language…', 'Adding clauses & formatting…'],
  },
  analyzing: {
    icon: 'search-outline' as const,
    label: 'Analyzing content',
    hints: ['Reading carefully…', 'Cross-checking details…', 'Summarizing key points…'],
  },
};

export default function ThinkingLoader({ mode = 'thinking' as keyof typeof MODES }: { mode?: keyof typeof MODES }) {
  const dots = useRef([0, 1, 2].map(() => new Animated.Value(0.3))).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const bar = useRef(new Animated.Value(0)).current;
  const hintIdx = useRef(0);
  const [hint, setHint] = React.useState(MODES[mode].hints[0]);

  useEffect(() => {
    // Dot bounce
    const loops = dots.map((d, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 180),
          Animated.timing(d, { toValue: 1, duration: 380, easing: Easing.out(Easing.quad), useNativeDriver: false }),
          Animated.timing(d, { toValue: 0.3, duration: 380, easing: Easing.in(Easing.quad), useNativeDriver: false }),
        ])
      )
    );
    loops.forEach((l) => l.start());
    // Pulse
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      ])
    );
    pulseLoop.start();
    // Shimmer bar
    const barLoop = Animated.loop(
      Animated.timing(bar, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: false })
    );
    barLoop.start();
    // Rotate hints
    const hintTimer = setInterval(() => {
      hintIdx.current = (hintIdx.current + 1) % MODES[mode].hints.length;
      setHint(MODES[mode].hints[hintIdx.current]);
    }, 1800);
    return () => {
      loops.forEach((l) => l.stop());
      pulseLoop.stop();
      barLoop.stop();
      clearInterval(hintTimer);
    };
  }, [mode, dots, pulse, bar]);

  return (
    <View style={s.wrap}>
      <View style={s.row}>
        <Animated.View style={[s.iconWrap, {
          opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }),
          transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1.06] }) }],
        }]}>
          <Ionicons name={MODES[mode].icon} size={16} color={theme.colors.brand} />
        </Animated.View>
        <View style={{ flex: 1 }}>
          <Text style={s.label}>{MODES[mode].label}</Text>
          <Text style={s.hint}>{hint}</Text>
        </View>
        <View style={s.dotRow}>
          {dots.map((d, i) => (
            <Animated.View
              key={i}
              style={[s.dot, {
                opacity: d,
                transform: [{ scale: d.interpolate({ inputRange: [0.3, 1], outputRange: [0.7, 1] }) }],
              }]}
            />
          ))}
        </View>
      </View>

      {/* Shimmer bar */}
      <View style={s.barTrack}>
        <Animated.View style={[s.barFill, {
          left: bar.interpolate({ inputRange: [0, 1], outputRange: ['-40%', '100%'] }),
        }]} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { minWidth: 240 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconWrap: { width: 32, height: 32, borderRadius: 16, backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center' },
  label: { color: theme.colors.brand, fontSize: 13, fontWeight: '500' },
  hint: { color: theme.colors.muted, fontSize: 11, marginTop: 2 },
  dotRow: { flexDirection: 'row', gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors.brand },
  barTrack: { height: 3, backgroundColor: theme.colors.divider, borderRadius: 2, marginTop: 10, overflow: 'hidden', position: 'relative' },
  barFill: { position: 'absolute', top: 0, bottom: 0, width: '40%', backgroundColor: theme.colors.brand, borderRadius: 2 },
});
