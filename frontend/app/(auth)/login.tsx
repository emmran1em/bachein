import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '@/src/theme';
import { api, setToken, setUser } from '@/src/api';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const onSubmit = async () => {
    setErr(''); setLoading(true);
    try {
      const res: any = await api.login(email.trim(), password);
      await setToken(res.token);
      await setUser(res.user);
      router.replace('/(tabs)');
    } catch (e: any) {
      setErr(e.message || 'Login failed');
    } finally { setLoading(false); }
  };

  return (
    <SafeAreaView style={s.container} testID="login-screen">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <View style={s.header}>
            <Text style={s.brand}>bachein</Text>
            <Text style={s.tag}>Secure. Signed. Verified.</Text>
          </View>
          <View style={s.form}>
            <Text style={s.title}>Welcome back</Text>
            <Text style={s.subtitle}>Sign in to your secure workspace</Text>

            <Text style={s.label}>Email</Text>
            <TextInput
              testID="login-email-input"
              style={s.input}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="you@company.com"
              placeholderTextColor={theme.colors.muted}
            />

            <Text style={s.label}>Password</Text>
            <TextInput
              testID="login-password-input"
              style={s.input}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="••••••••"
              placeholderTextColor={theme.colors.muted}
            />

            {err ? <Text style={s.err} testID="login-error">{err}</Text> : null}

            <Pressable testID="login-submit-button" style={s.primaryBtn} onPress={onSubmit} disabled={loading}>
              {loading ? <ActivityIndicator color={theme.colors.onBrandPrimary} /> : <Text style={s.primaryBtnText}>Sign in</Text>}
            </Pressable>

            <Link href="/(auth)/signup" asChild>
              <Pressable testID="login-go-signup" style={s.linkBtn}>
                <Text style={s.linkText}>New here? <Text style={{ color: theme.colors.brand, fontWeight: '500' }}>Create account</Text></Text>
              </Pressable>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.surface },
  scroll: { flexGrow: 1, padding: 24 },
  header: { marginTop: 32, marginBottom: 48 },
  brand: { fontSize: 36, fontWeight: '500', color: theme.colors.brand, letterSpacing: -1.5 },
  tag: { color: theme.colors.muted, marginTop: 4, letterSpacing: 1, fontSize: 11 },
  form: { gap: 4 },
  title: { fontSize: 24, color: theme.colors.brand, fontWeight: '500' },
  subtitle: { color: theme.colors.muted, marginBottom: 24 },
  label: { fontSize: 12, color: theme.colors.onSurfaceSecondary, marginTop: 12, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14, fontSize: 15, color: theme.colors.brand, backgroundColor: '#fff' },
  err: { color: theme.colors.error, marginTop: 12 },
  primaryBtn: { backgroundColor: theme.colors.brand, marginTop: 24, paddingVertical: 16, borderRadius: 12, alignItems: 'center' },
  primaryBtnText: { color: theme.colors.onBrandPrimary, fontWeight: '500', fontSize: 15 },
  linkBtn: { alignItems: 'center', marginTop: 20 },
  linkText: { color: theme.colors.muted },
});
