import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { api } from '@/src/api';

export default function Received() {
  const router = useRouter();
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    api.listReceived().then((list: any) => setDocs(list)).catch(() => {}).finally(() => setLoading(false));
  }, []));

  return (
    <SafeAreaView style={ss.container} edges={['top']} testID="received-screen">
      <View style={ss.header}>
        <Text style={ss.title}>Received</Text>
        <Text style={ss.subtitle}>Documents awaiting your verification</Text>
      </View>
      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={theme.colors.brand} />
      ) : docs.length === 0 ? (
        <View style={ss.empty}>
          <Ionicons name="mail-open-outline" size={48} color={theme.colors.muted} />
          <Text style={ss.emptyTitle}>Nothing received</Text>
          <Text style={ss.emptySub}>Documents sent to your email will appear here.</Text>
        </View>
      ) : (
        <FlatList
          data={docs}
          keyExtractor={(d) => d.id}
          contentContainerStyle={{ padding: 20, paddingBottom: 160 }}
          renderItem={({ item }) => (
            <Pressable
              testID={`received-card-${item.id}`}
              style={ss.card}
              onPress={() => {
                if (item.mode === 'secure' && item.signature_status !== 'signed') {
                  router.push(`/receive/${item.id}`);
                } else {
                  router.push(`/document/${item.id}`);
                }
              }}
            >
              <View style={ss.rowBetween}>
                <Text style={ss.docCategory}>{item.category}</Text>
                <View style={[ss.badge, { backgroundColor: item.signature_status === 'signed' ? '#DCEBE2' : '#FCEAD8' }]}>
                  <Text style={[ss.badgeText, { color: item.signature_status === 'signed' ? '#3A6B4C' : '#D9882B' }]}>
                    {item.signature_status === 'signed' ? 'SIGNED' : 'PENDING'}
                  </Text>
                </View>
              </View>
              <Text style={ss.docTitle} numberOfLines={2}>{item.title}</Text>
              <Text style={ss.docMeta}>From {item.sender_email} • {new Date(item.created_at).toLocaleDateString()}</Text>
              <View style={ss.cta}>
                <Text style={ss.ctaText}>{item.signature_status === 'signed' ? 'View' : 'Verify & Sign'}</Text>
                <Ionicons name="arrow-forward" size={14} color={theme.colors.onBrandPrimary} />
              </View>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const ss = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.surface },
  header: { paddingHorizontal: 24, paddingTop: 12 },
  title: { fontSize: 28, color: theme.colors.brand, fontWeight: '500', letterSpacing: -0.5 },
  subtitle: { color: theme.colors.muted, marginTop: 4 },
  empty: { alignItems: 'center', marginTop: 80, paddingHorizontal: 40 },
  emptyTitle: { color: theme.colors.brand, fontSize: 18, fontWeight: '500', marginTop: 16 },
  emptySub: { color: theme.colors.muted, textAlign: 'center', marginTop: 8 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: theme.colors.border },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  docCategory: { color: theme.colors.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  docTitle: { color: theme.colors.brand, fontSize: 16, fontWeight: '500', marginTop: 6 },
  docMeta: { color: theme.colors.muted, fontSize: 12, marginTop: 6 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  badgeText: { fontSize: 10, fontWeight: '500', letterSpacing: 0.5 },
  cta: { flexDirection: 'row', alignSelf: 'flex-start', marginTop: 12, backgroundColor: theme.colors.brand, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, alignItems: 'center', gap: 6 },
  ctaText: { color: theme.colors.onBrandPrimary, fontSize: 12, fontWeight: '500' },
});
