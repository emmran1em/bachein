import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { View, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { theme } from '@/src/theme';

function CreateFAB() {
  const router = useRouter();
  return (
    <View pointerEvents="box-none" style={s.fabWrap}>
      <Pressable testID="create-fab" onPress={() => router.push('/create')} style={s.fab}>
        <Ionicons name="add" size={32} color={theme.colors.onBrandPrimary} />
      </Pressable>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: theme.colors.brand,
          tabBarInactiveTintColor: theme.colors.muted,
          tabBarStyle: { backgroundColor: '#FFFFFF', borderTopColor: theme.colors.border, height: 78, paddingBottom: 18, paddingTop: 8 },
          tabBarLabelStyle: { fontSize: 11 },
        }}
      >
        <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color} /> }} />
        <Tabs.Screen name="received" options={{ title: 'Inbox', tabBarIcon: ({ color, size }) => <Ionicons name="mail-outline" size={size} color={color} /> }} />
        <Tabs.Screen name="chat" options={{ title: 'AI', tabBarIcon: ({ color, size }) => <Ionicons name="sparkles-outline" size={size} color={color} /> }} />
        <Tabs.Screen name="vault" options={{ title: 'Vault', tabBarIcon: ({ color, size }) => <Ionicons name="lock-closed-outline" size={size} color={color} /> }} />
        <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" size={size} color={color} /> }} />
      </Tabs>
      <CreateFAB />
    </View>
  );
}

const s = StyleSheet.create({
  fabWrap: { position: 'absolute', bottom: 62, left: 0, right: 0, alignItems: 'center' },
  fab: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: theme.colors.brand,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
});
