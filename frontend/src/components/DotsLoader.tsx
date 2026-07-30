import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Easing } from 'react-native';
import { theme } from '@/src/theme';

/** 3-dot pulsing loader — GPT / Manus style. */
export default function DotsLoader({ color, size = 8 }: { color?: string; size?: number }) {
  const c = color || theme.colors.brand;
  const dots = useRef([0, 1, 2].map(() => new Animated.Value(0.25))).current;

  useEffect(() => {
    const loops = dots.map((d, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 160),
          Animated.timing(d, { toValue: 1, duration: 380, easing: Easing.out(Easing.quad), useNativeDriver: false }),
          Animated.timing(d, { toValue: 0.25, duration: 380, easing: Easing.in(Easing.quad), useNativeDriver: false }),
        ])
      )
    );
    loops.forEach((l) => l.start());
    return () => { loops.forEach((l) => l.stop()); };
  }, [dots]);

  return (
    <View style={s.row}>
      {dots.map((d, i) => (
        <Animated.View
          key={i}
          style={[
            {
              width: size, height: size, borderRadius: size / 2,
              backgroundColor: c,
              opacity: d,
              transform: [{ scale: d.interpolate({ inputRange: [0.25, 1], outputRange: [0.75, 1.15] }) }],
              marginHorizontal: 3,
            },
          ]}
        />
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
});
