import React from 'react';
import { Image, View } from 'react-native';

/**
 * BacheIn AI logo — uses the actual "b\" mark image supplied by the user.
 * Size prop is total width; height maintains aspect ratio.
 */
export default function BacheinAiLogo({ size = 40 }: { size?: number }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Image
        source={require('../../assets/images/ai_logo.jpg')}
        style={{ width: size, height: size, resizeMode: 'contain' }}
      />
    </View>
  );
}
