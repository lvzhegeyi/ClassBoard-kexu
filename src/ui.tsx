import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { courseColor, useTheme, withAlpha, type Palette } from './theme';

export function AppScreen({
  children,
  edges = ['top', 'bottom'],
  style,
}: {
  children: React.ReactNode;
  edges?: ('top' | 'right' | 'bottom' | 'left')[];
  style?: StyleProp<ViewStyle>;
}) {
  const { palette } = useTheme();
  return (
    <SafeAreaView edges={edges} style={[{ flex: 1, backgroundColor: palette.paper }, style]}>
      {children}
    </SafeAreaView>
  );
}

export function TopBar({
  title,
  onBack,
  right,
  subtitle,
}: {
  title: string;
  onBack?: () => void;
  right?: React.ReactNode;
  subtitle?: string;
}) {
  const { palette } = useTheme();
  return (
    <View style={[styles.topbar, { borderColor: palette.line }]}>
      <View style={styles.topbarSide}>
        {onBack ? (
          <Pressable onPress={onBack} hitSlop={10} style={styles.backBtn}>
            <Text style={{ color: palette.accentDeep, fontSize: 16 }}>‹ 返回</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={{ flex: 1, alignItems: 'center' }}>
        <Text style={{ color: palette.ink, fontSize: 19, fontWeight: '600' }} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={{ color: palette.ink3, fontSize: 11, marginTop: 1 }}>{subtitle}</Text> : null}
      </View>
      <View style={[styles.topbarSide, { alignItems: 'flex-end' }]}>{right}</View>
    </View>
  );
}

export function Card({
  children,
  style,
  onPress,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
}) {
  const { palette } = useTheme();
  const content = (
    <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.line }, style]}>
      {children}
    </View>
  );
  if (!onPress) return content;
  return <Pressable onPress={onPress}>{content}</Pressable>;
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  const { palette } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12, marginBottom: 5 }}>
      <Text style={{ color: palette.ink3, fontSize: 12, fontWeight: '600', letterSpacing: 0.3 }}>{children}</Text>
      <View style={{ flex: 1 }} />
      {right}
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
  style,
  small,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  small?: boolean;
}) {
  const { palette } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: palette.accent,
          opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
          paddingVertical: small ? 8 : 12,
          paddingHorizontal: small ? 12 : 16,
        },
        style,
      ]}
    >
      <Text style={{ color: palette.onAccent, fontSize: small ? 13 : 15, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export function GhostButton({
  label,
  onPress,
  style,
  small,
  danger,
}: {
  label: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  small?: boolean;
  danger?: boolean;
}) {
  const { palette } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: palette.paperDeep,
          opacity: pressed ? 0.75 : 1,
          paddingVertical: small ? 8 : 12,
          paddingHorizontal: small ? 12 : 16,
        },
        style,
      ]}
    >
      <Text style={{ color: danger ? palette.danger : palette.ink2, fontSize: small ? 13 : 15, fontWeight: '500' }}>{label}</Text>
    </Pressable>
  );
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  keyboardType,
  multiline,
  minHeight,
  style,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'number-pad' | 'decimal-pad' | 'email-address';
  multiline?: boolean;
  minHeight?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { palette } = useTheme();
  return (
    <View style={[{ marginBottom: 10 }, style]}>
      <Text style={{ color: palette.ink3, fontSize: 12, marginBottom: 5 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.ink4}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        multiline={multiline}
        style={{
          color: palette.ink,
          fontSize: 15,
          backgroundColor: palette.surface,
          borderColor: palette.line,
          borderWidth: 1,
          borderRadius: 12,
          paddingHorizontal: 12,
          paddingVertical: 10,
          minHeight: minHeight || (multiline ? 120 : 44),
          textAlignVertical: multiline ? 'top' : 'center',
        }}
      />
    </View>
  );
}

export function SwitchRow({
  title,
  desc,
  value,
  onChange,
}: {
  title: string;
  desc?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const { palette } = useTheme();
  const anim = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: value ? 1 : 0, duration: 160, useNativeDriver: false }).start();
  }, [value, anim]);
  return (
    <Pressable onPress={() => onChange(!value)} style={styles.switchRow}>
      <View style={{ flex: 1, paddingRight: 10 }}>
        <Text style={{ color: palette.ink, fontSize: 15 }}>{title}</Text>
        {desc ? <Text style={{ color: palette.ink3, fontSize: 11.5, marginTop: 2 }}>{desc}</Text> : null}
      </View>
      <View
        style={{
          width: 48,
          height: 28,
          borderRadius: 14,
          backgroundColor: value ? palette.accent : palette.paperDeep,
          justifyContent: 'center',
          borderColor: value ? palette.accent : palette.line,
          borderWidth: 1,
        }}
      >
        <Animated.View
          style={{
            width: 22,
            height: 22,
            borderRadius: 11,
            backgroundColor: '#FFFFFF',
            transform: [{ translateX: anim.interpolate({ inputRange: [0, 1], outputRange: [3, 23] }) }],
          }}
        />
      </View>
    </Pressable>
  );
}

export function Chips({
  options,
  selected,
  onSelect,
  style,
}: {
  options: string[];
  selected: number;
  onSelect: (index: number) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { palette } = useTheme();
  return (
    <View style={[{ flexDirection: 'row', gap: 7 }, style]}>
      {options.map((label, index) => {
        const active = index === selected;
        return (
          <Pressable
            key={`${label}-${index}`}
            onPress={() => onSelect(index)}
            style={{
              flex: 1,
              paddingVertical: 9,
              alignItems: 'center',
              borderRadius: 10,
              backgroundColor: active ? palette.accent : palette.paperDeep,
              borderColor: active ? palette.accent : palette.line,
              borderWidth: 1,
            }}
          >
            <Text style={{ color: active ? palette.onAccent : palette.ink2, fontSize: 13 }}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ColorDots({ selected, onSelect }: { selected: number; onSelect: (i: number) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {Array.from({ length: 10 }).map((_, i) => (
        <Pressable
          key={i}
          onPress={() => onSelect(i)}
          style={{
            width: i === selected ? 30 : 26,
            height: i === selected ? 30 : 26,
            borderRadius: 999,
            backgroundColor: courseColor(i),
            borderWidth: i === selected ? 2 : 0,
            borderColor: '#FFFFFF',
          }}
        />
      ))}
    </View>
  );
}

export function Stepper({
  value,
  onChange,
  min,
  max,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
}) {
  const { palette } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Pressable
        onPress={() => onChange(Math.max(min, value - 1))}
        style={[styles.stepBtn, { backgroundColor: palette.paperDeep }]}
      >
        <Text style={{ color: palette.ink2, fontSize: 18 }}>−</Text>
      </Pressable>
      <Text style={{ color: palette.ink, fontSize: 17, fontWeight: '600', paddingHorizontal: 14 }}>{value}</Text>
      <Pressable
        onPress={() => onChange(Math.min(max, value + 1))}
        style={[styles.stepBtn, { backgroundColor: palette.paperDeep }]}
      >
        <Text style={{ color: palette.ink2, fontSize: 15 }}>＋</Text>
      </Pressable>
    </View>
  );
}

export function ModalSheet({
  visible,
  onClose,
  children,
  centered = false,
  title,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  centered?: boolean;
  title?: string;
}) {
  const { palette } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.modalRoot, centered && { justifyContent: 'center' }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View
          style={[
            centered ? styles.modalCenter : styles.modalBottom,
            { backgroundColor: palette.surface, borderColor: palette.line },
          ]}
        >
          {title ? (
            <Text style={{ color: palette.ink, fontSize: 17, fontWeight: '600', marginBottom: 10 }}>{title}</Text>
          ) : null}
          {children}
        </View>
      </View>
    </Modal>
  );
}

export function Empty({ text }: { text: string }) {
  const { palette } = useTheme();
  return (
    <View style={{ paddingVertical: 32, alignItems: 'center' }}>
      <Text style={{ color: palette.ink3, fontSize: 13 }}>{text}</Text>
    </View>
  );
}

export function Loading() {
  const { palette } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.paper }}>
      <ActivityIndicator color={palette.accent} />
    </View>
  );
}

export const styles = StyleSheet.create({
  topbar: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  topbarSide: { minWidth: 74, justifyContent: 'center' },
  backBtn: { paddingVertical: 6, paddingRight: 8 },
  card: { borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 10 },
  button: { borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  switchRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9 },
  stepBtn: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  modalRoot: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  modalBottom: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 18,
    paddingBottom: 30,
    borderWidth: 1,
  },
  modalCenter: {
    marginHorizontal: 18,
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
  },
});

export type { Palette };
