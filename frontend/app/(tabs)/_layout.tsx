import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { View, StyleSheet, Pressable, Text } from 'react-native';
import { theme } from '@/src/theme';
import BacheinAiLogo from '@/src/components/BacheinAiLogo';

/**
 * Center create-button rendered as a Tab.Screen with a custom tabBarButton so
 * it sits inline in the tab bar between Documents and File Kit. It navigates
 * to /create instead of showing a route.
 */
function CenterCreateButton({ onPress }: any) {
  return (
    <View style={s.centerWrap} pointerEvents="box-none">
      <Pressable testID="tabbar-create-btn" onPress={onPress} style={s.centerBtn}>
        <Ionicons name="add" size={28} color={theme.colors.onBrandPrimary} />
      </Pressable>
    </View>
  );
}

export default function TabsLayout() {
  const router = useRouter();
  return (
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
      <Tabs.Screen name="received" options={{ title: 'Documents', tabBarIcon: ({ color, size }) => <Ionicons name="folder-open-outline" size={size} color={color} /> }} />
      <Tabs.Screen
        name="__create"
        options={{
          title: '',
          tabBarButton: (props) => <CenterCreateButton onPress={() => router.push('/create')} />,
        }}
        listeners={{ tabPress: (e) => { e.preventDefault(); router.push('/create'); } }}
      />
      <Tabs.Screen name="filekit" options={{ title: 'File Kit', tabBarIcon: ({ color, size }) => <Ionicons name="construct-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="chat" options={{ title: 'AI', tabBarIcon: ({ size }) => <BacheinAiLogo size={size + 2} /> }} />
      {/* Hidden but reachable via drawer / links */}
      <Tabs.Screen name="vault" options={{ href: null }} />
      <Tabs.Screen name="profile" options={{ href: null }} />
    </Tabs>
  );
}

const s = StyleSheet.create({
  centerWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', top: -14 },
  centerBtn: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: theme.colors.brand,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
    elevation: 6,
    borderWidth: 3, borderColor: '#fff',
  },
});
