import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';

type ToastKind = 'success' | 'error' | 'info';
type Toast = { id: number; message: string; kind: ToastKind };
type Ctx = { show: (message: string, kind?: ToastKind) => void };

const ToastCtx = createContext<Ctx>({ show: () => {} });

export function useToast() { return useContext(ToastCtx); }

export function ToastHost({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);
  const show = (message: string, kind: ToastKind = 'success') => {
    const id = ++idRef.current;
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  };
  return (
    <ToastCtx.Provider value={{ show }}>
      {children}
      <View pointerEvents="box-none" style={styles.host}>
        {toasts.map((t) => <ToastItem key={t.id} toast={t} onDismiss={() => setToasts((cur) => cur.filter((x) => x.id !== t.id))} />)}
      </View>
    </ToastCtx.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(anim, { toValue: 1, useNativeDriver: true, friction: 8, tension: 60 }).start();
  }, []);
  const bg = toast.kind === 'success' ? '#4C8161' : toast.kind === 'error' ? '#B84C3A' : theme.colors.brand;
  const icon = toast.kind === 'success' ? 'checkmark-circle' : toast.kind === 'error' ? 'alert-circle' : 'information-circle';
  return (
    <Animated.View
      testID={`toast-${toast.kind}`}
      style={[styles.toast, { backgroundColor: bg, opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-20, 0] }) }] }]}
    >
      <Ionicons name={icon as any} size={18} color="#fff" />
      <Text style={styles.msg} numberOfLines={2}>{toast.message}</Text>
      <Pressable onPress={onDismiss} testID="toast-close"><Ionicons name="close" size={16} color="#fff" /></Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', top: 60, left: 16, right: 16, alignItems: 'stretch', gap: 8, zIndex: 9999 },
  toast: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  msg: { color: '#fff', fontSize: 13, fontWeight: '500', flex: 1 },
});
