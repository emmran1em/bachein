import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { clearAuth, getUser } from '@/src/api';

export default function Profile() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  useEffect(() => { getUser().then(setUser); }, []);
  const logout = async () => { await clearAuth(); router.replace('/(auth)/login'); };

  return (
    <SafeAreaView style={ss.container} edges={['top']} testID="profile-screen">
      <View style={{ padding: 24 }}>
        <Text style={ss.title}>Profile</Text>
        <View style={ss.card}>
          <View style={ss.avatar}><Text style={ss.avatarTxt}>{(user?.name || '?').slice(0,1).toUpperCase()}</Text></View>
          <Text style={ss.name}>{user?.name || '—'}</Text>
          <Text style={ss.email}>{user?.email || '—'}</Text>
        </View>

        <Text style={ss.sectionLabel}>WORKSPACE</Text>
        <View style={ss.menu}>
          <Pressable style={ss.row} testID="profile-settings">
            <Ionicons name="settings-outline" size={18} color={theme.colors.brand} />
            <Text style={ss.rowText}>Settings</Text>
            <Ionicons name="chevron-forward" size={16} color={theme.colors.muted} style={{ marginLeft: 'auto' }} />
          </Pressable>
          <Pressable style={ss.row} testID="profile-sync">
            <Ionicons name="sync-outline" size={18} color={theme.colors.brand} />
            <Text style={ss.rowText}>Sync</Text>
            <Ionicons name="chevron-forward" size={16} color={theme.colors.muted} style={{ marginLeft: 'auto' }} />
          </Pressable>
          <Pressable style={ss.row} testID="profile-scan">
            <Ionicons name="scan-outline" size={18} color={theme.colors.brand} />
            <Text style={ss.rowText}>Scan</Text>
            <Ionicons name="chevron-forward" size={16} color={theme.colors.muted} style={{ marginLeft: 'auto' }} />
          </Pressable>
        </View>

        <Pressable testID="logout-button" style={ss.logout} onPress={logout}>
          <Ionicons name="log-out-outline" size={18} color={theme.colors.error} />
          <Text style={ss.logoutText}>Log out</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const ss = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.surface },
  title: { fontSize: 28, color: theme.colors.brand, fontWeight: '500', letterSpacing: -0.5, marginBottom: 20 },
  card: { backgroundColor: '#fff', borderRadius: 18, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: theme.colors.border },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: theme.colors.brand, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { color: theme.colors.onBrandPrimary, fontSize: 26, fontWeight: '500' },
  name: { color: theme.colors.brand, fontSize: 18, fontWeight: '500', marginTop: 12 },
  email: { color: theme.colors.muted, marginTop: 2 },
  sectionLabel: { color: theme.colors.muted, fontSize: 11, letterSpacing: 1, marginTop: 28, marginBottom: 8 },
  menu: { backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: theme.colors.border, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.colors.divider },
  rowText: { color: theme.colors.brand, fontSize: 15 },
  logout: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 32, alignSelf: 'center' },
  logoutText: { color: theme.colors.error, fontSize: 15, fontWeight: '500' },
});
