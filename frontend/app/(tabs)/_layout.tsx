import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { View, StyleSheet, Pressable, Text, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '@/src/theme';
import BacheinAiLogo from '@/src/components/BacheinAiLogo';

const TABS = [
  { name: 'index', label: 'Home', icon: 'home-outline', iconActive: 'home' },
  { name: 'received', label: 'Documents', icon: 'folder-open-outline', iconActive: 'folder-open' },
  { name: '__create', label: '', icon: 'add', iconActive: 'add' },
  { name: 'filekit', label: 'File Kit', icon: 'construct-outline', iconActive: 'construct' },
  { name: 'chat', label: 'AI', icon: null, iconActive: null },
];

/** Floating dock-style tab bar — rounded container lifted off the bottom edge. */
function FloatingDock({ state, navigation }: any) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const visible = ['index', 'received', '__create', 'filekit', 'chat'];
  return (
    <View style={[s.dockWrap, { paddingBottom: Math.max(insets.bottom, 12) }]} pointerEvents="box-none">
      <View style={s.dock}>
        {TABS.map((tab) => {
          const routeIndex = state.routes.findIndex((r: any) => r.name === tab.name);
          const focused = state.index === routeIndex;
          if (!visible.includes(tab.name)) return null;
          if (tab.name === '__create') {
            return (
              <Pressable key={tab.name} testID="tabbar-create-btn" onPress={() => router.push('/create')} style={s.centerBtnWrap}>
                <View style={s.centerBtn}>
                  <Ionicons name="add" size={30} color={theme.colors.onBrandPrimary} />
                </View>
              </Pressable>
            );
          }
          const onPress = () => {
            const route = state.routes[routeIndex];
            const event = navigation.emit({ type: 'tabPress', target: route?.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented && route) navigation.navigate(route.name);
          };
          return (
            <Pressable key={tab.name} testID={`tab-${tab.name}`} onPress={onPress} style={s.tabItem}>
              <View style={[s.iconWrap, focused && s.iconWrapActive]}>
                {tab.name === 'chat' ? (
                  <BacheinAiLogo size={24} />
                ) : (
                  <Ionicons
                    name={(focused ? tab.iconActive : tab.icon) as any}
                    size={23}
                    color={focused ? theme.colors.brand : theme.colors.muted}
                  />
                )}
              </View>
              <Text style={[s.tabLabel, focused && s.tabLabelActive]}>{tab.label || 'AI'}</Text>
              {focused && <View style={s.activeDot} />}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <FloatingDock {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="received" options={{ title: 'Documents' }} />
      <Tabs.Screen name="__create" options={{ title: '' }} listeners={{ tabPress: (e) => e.preventDefault() }} />
      <Tabs.Screen name="filekit" options={{ title: 'File Kit' }} />
      <Tabs.Screen name="chat" options={{ title: 'AI' }} />
      {/* Hidden but reachable via drawer / links */}
      <Tabs.Screen name="vault" options={{ href: null }} />
      <Tabs.Screen name="profile" options={{ href: null }} />
    </Tabs>
  );
}

const s = StyleSheet.create({
  dockWrap: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    alignItems: 'center', paddingHorizontal: 16,
    backgroundColor: 'transparent',
  },
  dock: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    alignSelf: 'stretch', maxWidth: 460,
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.05)',
    shadowColor: '#1a2233', shadowOpacity: 0.14, shadowRadius: 22, shadowOffset: { width: 0, height: 10 },
    elevation: 14,
    ...Platform.select({ web: { marginHorizontal: 'auto' as any, width: '100%' } }),
  },
  tabItem: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 4, gap: 3, minHeight: 52 },
  iconWrap: { width: 40, height: 30, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  iconWrapActive: { backgroundColor: 'rgba(20,30,60,0.06)' },
  tabLabel: { fontSize: 10.5, color: theme.colors.muted, fontWeight: '500' },
  tabLabelActive: { color: theme.colors.brand, fontWeight: '700' },
  activeDot: { position: 'absolute', top: 0, width: 4, height: 4, borderRadius: 2, backgroundColor: theme.colors.brand },
  centerBtnWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', top: -22 },
  centerBtn: {
    width: 58, height: 58, borderRadius: 29,
    backgroundColor: theme.colors.brand,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: theme.colors.brand, shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 6 },
    elevation: 10,
    borderWidth: 4, borderColor: '#fff',
  },
});
