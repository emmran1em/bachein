import React from 'react';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { theme } from '@/src/theme';

/**
 * BacheIn AI logo — the "b\" mark.
 * The `b` is drawn in the brand color, the backslash `\` in red/accent.
 * Size prop controls the total height in pixels; width auto.
 */
export default function BacheinAiLogo({ size = 40, colorB, colorSlash }: { size?: number; colorB?: string; colorSlash?: string }) {
  const w = size * 1.35; // aspect
  const h = size;
  const cb = colorB || theme.colors.brand;
  const cs = colorSlash || '#DC2626';
  const stroke = Math.max(2, Math.round(size * 0.055));
  return (
    <View style={{ width: w, height: h, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={w} height={h} viewBox="0 0 135 100">
        {/* Letter b — vertical stem + bottom circle */}
        <Path
          d="M 40 8 L 40 92"
          stroke={cb}
          strokeWidth={stroke * 1.5}
          strokeLinecap="round"
          fill="none"
        />
        <Path
          d="M 40 92 C 68 92 82 82 82 68 C 82 54 68 44 40 44"
          stroke={cb}
          strokeWidth={stroke * 1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        {/* Backslash "\" in red */}
        <Path
          d="M 92 20 L 118 88"
          stroke={cs}
          strokeWidth={stroke * 1.7}
          strokeLinecap="round"
          fill="none"
        />
      </Svg>
    </View>
  );
}
