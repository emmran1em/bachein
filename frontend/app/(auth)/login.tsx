import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { theme } from '@/src/theme';
import { api, setToken, setUser } from '@/src/api';

WebBrowser.maybeCompleteAuthSession();

function isValidEmail(e: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
}

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [err, setErr] = useState('');

  // Handle web magic redirect ?session_id=...
  useEffect(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const hash = window.location.hash || '';
      const search = window.location.search || '';
      const m = hash.match(/session_id=([^&]+)/) || search.match(/session_id=([^&]+)/);
      if (m && m[1]) {
        completeGoogle(m[1]);
        window.history.replaceState(null, '', window.location.pathname);
      }
    }
  }, []);

  const completeGoogle = async (session_id: string) => {
    setGoogleLoading(true);
    try {
      const res: any = await api.googleSession(session_id);
      await setToken(res.token);
      await setUser(res.user);
      router.replace('/(tabs)');
    } catch (e: any) { setErr(e.message || 'Google sign-in failed'); }
    finally { setGoogleLoading(false); }
  };

  const startGoogle = async () => {
    setErr('');
    try {
      const redirectUrl = Platform.OS === 'web'
        ? (typeof window !== 'undefined' ? window.location.origin + '/(auth)/login' : 'https://nda-hub-1.preview.emergentagent.com/(auth)/login')
        : Linking.createURL('auth');
      const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
      if (Platform.OS === 'web') {
        window.location.href = authUrl;
        return;
      }
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
      if (result.type === 'success' && (result as any).url) {
        const url = (result as any).url as string;
        const m = url.match(/session_id=([^&#]+)/);
        if (m && m[1]) await completeGoogle(m[1]);
      }
    } catch (e: any) { setErr(e.message); }
  };

  const onSubmit = async () => {
    setErr('');
    if (!isValidEmail(email)) { setErr('Please enter a valid email'); return; }
    if (password.length < 4) { setErr('Password is required'); return; }
    setLoading(true);
    try {
      const res: any = await api.login(email.trim(), password);
      await setToken(res.token);
      await setUser(res.user);
      router.replace('/(tabs)');
    } catch (e: any) { setErr(e.message || 'Login failed'); }
    finally { setLoading(false); }
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

            <Pressable testID="google-signin-btn" style={s.googleBtn} onPress={startGoogle} disabled={googleLoading}>
              {googleLoading ? <ActivityIndicator color={theme.colors.brand} /> : (
                <>
                  <View style={s.gIcon}>
                    <Text style={{ fontSize: 18, fontWeight: 'bold' }}>G</Text>
                  </View>
                  <Text style={s.googleText}>Continue with Google</Text>
                </>
              )}
            </Pressable>

            <View style={s.dividerRow}>
              <View style={s.dividerLine} /><Text style={s.dividerText}>OR EMAIL</Text><View style={s.dividerLine} />
            </View>

            <Text style={s.label}>Email *</Text>
            <TextInput
              testID="login-email-input"
              style={[s.input, err && !isValidEmail(email) && email ? s.inputError : null]}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="you@company.com"
              placeholderTextColor={theme.colors.muted}
            />

            <Text style={s.label}>Password *</Text>
            <TextInput testID="login-password-input" style={s.input} value={password} onChangeText={setPassword} secureTextEntry placeholder="••••••••" placeholderTextColor={theme.colors.muted} />

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
  header: { marginTop: 32, marginBottom: 32 },
  brand: { fontSize: 36, fontWeight: '500', color: theme.colors.brand, letterSpacing: -1.5 },
  tag: { color: theme.colors.muted, marginTop: 4, letterSpacing: 1, fontSize: 11 },
  form: { gap: 4 },
  title: { fontSize: 24, color: theme.colors.brand, fontWeight: '500' },
  subtitle: { color: theme.colors.muted, marginBottom: 20 },
  googleBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.borderStrong, paddingVertical: 14, borderRadius: 12, marginTop: 10 },
  gIcon: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  googleText: { color: theme.colors.brand, fontWeight: '500', fontSize: 15 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 18 },
  dividerLine: { flex: 1, height: 1, backgroundColor: theme.colors.border },
  dividerText: { color: theme.colors.muted, fontSize: 10, letterSpacing: 1 },
  label: { fontSize: 12, color: theme.colors.onSurfaceSecondary, marginTop: 12, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14, fontSize: 15, color: theme.colors.brand, backgroundColor: '#fff' },
  inputError: { borderColor: theme.colors.error },
  err: { color: theme.colors.error, marginTop: 12 },
  primaryBtn: { backgroundColor: theme.colors.brand, marginTop: 20, paddingVertical: 16, borderRadius: 12, alignItems: 'center' },
  primaryBtnText: { color: theme.colors.onBrandPrimary, fontWeight: '500', fontSize: 15 },
  linkBtn: { alignItems: 'center', marginTop: 20 },
  linkText: { color: theme.colors.muted },
});
