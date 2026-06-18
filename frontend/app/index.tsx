import { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { getToken } from '@/src/api';
import { theme } from '@/src/theme';

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
      <Text style={styles.brand}>bachein</Text>
      <Text style={styles.tag}>Secure. Signed. Verified.</Text>
      <ActivityIndicator color={theme.colors.brand} style={{ marginTop: 24 }} />
    </View>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface },
  brand: { fontSize: 40, fontWeight: '500', color: theme.colors.brand, letterSpacing: -1.5 },
  tag: { color: theme.colors.muted, fontSize: 13, marginTop: 8, letterSpacing: 1 },
});
