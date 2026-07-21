import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, setToken, setUser } from '@/src/api';
import { theme } from '@/src/theme';

export default function MagicLanding() {
  const { token, doc, editor } = useLocalSearchParams<{ token: string; doc?: string; editor?: string }>();
  const router = useRouter();
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        if (!token) throw new Error('Missing token');
        const r: any = await api.magicConsume(token);
        await setToken(r.token);
        await setUser(r.user);
        if (editor) router.replace(`/editor?id=${editor}`);
        else if (doc) router.replace(`/receive/${doc}`);
        else router.replace('/(tabs)');
      } catch (e: any) {
        setErr(e.message || 'Sign-in failed');
        setTimeout(() => router.replace('/(auth)/login'), 1800);
      }
    })();
  }, [token, doc, editor]);

  return (
    <SafeAreaView style={s.container} testID="magic-screen">
      <Text style={s.brand}>bachein</Text>
      <Text style={s.tag}>Signing you in…</Text>
      {err ? <Text style={s.err}>{err}</Text> : <ActivityIndicator color={theme.colors.brand} style={{ marginTop: 16 }} />}
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface },
  brand: { fontSize: 36, fontWeight: '500', color: theme.colors.brand, letterSpacing: -1.5 },
  tag: { color: theme.colors.muted, marginTop: 8 },
  err: { color: theme.colors.error, marginTop: 12 },
});
