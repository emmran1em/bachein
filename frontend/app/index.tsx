import { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { getToken } from '@/src/api';
import { theme } from '@/src/theme';
import { BacheinLogo } from '@/src/components/Logo';

export default function Index() {
  const router = useRouter();
  useEffect(() => {
    (async () => {
      const t = await getToken();
      if (t) router.replace('/(tabs)');
      else router.replace('/(auth)/login');
    })();
  }, []);
  return (
    <View style={styles.container} testID="splash-screen">
      <BacheinLogo size={40} />
      <Text style={styles.tag}>Secure. Signed. Verified.</Text>
      <ActivityIndicator color={theme.colors.brand} style={{ marginTop: 24 }} />
    </View>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface },
  tag: { color: theme.colors.muted, fontSize: 12, marginTop: 14, letterSpacing: 1 },
});
