import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { theme } from '@/src/theme';
import PlansSheet from '@/src/components/PlansSheet';
import { api } from '@/src/api';

export default function PlansScreen() {
  const router = useRouter();
  const [tier, setTier] = useState<'free' | 'pro' | 'byo'>('free');

  useEffect(() => {
    api.aiwSettings().then((s: any) => { setTier(s?.tier || 'free'); }).catch(() => {});
  }, []);

  return (
    <View style={s.container}>
      <PlansSheet visible={true} onClose={() => router.back()} currentTier={tier} />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.surface },
});
