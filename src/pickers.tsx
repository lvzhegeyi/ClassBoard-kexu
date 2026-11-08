import React, { useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useTheme } from './theme';
import { ModalSheet } from './ui';

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

function isoOf(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function CalendarPicker({
  visible,
  initial,
  onClose,
  onSelect,
}: {
  visible: boolean;
  initial: string;
  onClose: () => void;
  onSelect: (iso: string) => void;
}) {
  const { palette } = useTheme();
  const base = useMemo(() => parseIso(initial), [initial, visible]);
  const [year, setYear] = useState(base.getFullYear());
  const [month, setMonth] = useState(base.getMonth());
  const [selected, setSelected] = useState(initial);

  React.useEffect(() => {
    if (!visible) return;
    const d = parseIso(initial);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
    setSelected(initial);
  }, [visible, initial]);

  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // 周一 = 0
  const days = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const todayIso = isoOf(today.getFullYear(), today.getMonth(), today.getDate());
  const cells: (number | null)[] = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: days }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <ModalSheet visible={visible} onClose={onClose} centered>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
        <Pressable onPress={() => {
          const d = new Date(year, month - 1, 1);
          setYear(d.getFullYear());
          setMonth(d.getMonth());
        }} hitSlop={10} style={{ padding: 8 }}>
          <Text style={{ color: palette.ink2, fontSize: 22 }}>‹</Text>
        </Pressable>
        <Text style={{ flex: 1, textAlign: 'center', color: palette.ink, fontSize: 16, fontWeight: '600' }}>
          {year} 年 {month + 1} 月
        </Text>
        <Pressable onPress={() => {
          const d = new Date(year, month + 1, 1);
          setYear(d.getFullYear());
          setMonth(d.getMonth());
        }} hitSlop={10} style={{ padding: 8 }}>
          <Text style={{ color: palette.ink2, fontSize: 22 }}>›</Text>
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row' }}>
        {WEEKDAYS.map((w) => (
          <Text key={w} style={{ flex: 1, textAlign: 'center', color: palette.ink4, fontSize: 11, paddingVertical: 4 }}>{w}</Text>
        ))}
      </View>
      {Array.from({ length: cells.length / 7 }).map((_, row) => (
        <View key={row} style={{ flexDirection: 'row' }}>
          {cells.slice(row * 7, row * 7 + 7).map((day, col) => {
            if (day == null) return <View key={col} style={{ flex: 1, height: 40 }} />;
            const iso = isoOf(year, month, day);
            const active = iso === selected;
            const isToday = iso === todayIso;
            return (
              <Pressable
                key={col}
                onPress={() => setSelected(iso)}
                style={{ flex: 1, height: 40, alignItems: 'center', justifyContent: 'center' }}
              >
                <View style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: active ? palette.accent : 'transparent',
                  borderWidth: isToday && !active ? 1 : 0,
                  borderColor: palette.accent,
                }}>
                  <Text style={{ color: active ? palette.onAccent : palette.ink, fontSize: 14 }}>{day}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 14 }}>
        <Pressable onPress={onClose} style={{ padding: 10 }}>
          <Text style={{ color: palette.ink3, fontSize: 14 }}>取消</Text>
        </Pressable>
        <Pressable onPress={() => onSelect(selected)} style={{ padding: 10 }}>
          <Text style={{ color: palette.accentDeep, fontSize: 14, fontWeight: '600' }}>确定</Text>
        </Pressable>
      </View>
    </ModalSheet>
  );
}

export function TimePicker({
  visible,
  initial,
  onClose,
  onSelect,
}: {
  visible: boolean;
  initial: string;
  onClose: () => void;
  onSelect: (time: string) => void;
}) {
  const { palette } = useTheme();
  const [hour, setHour] = useState(Number(initial.split(':')[0]) || 8);
  const [minute, setMinute] = useState(Number(initial.split(':')[1]) || 0);

  React.useEffect(() => {
    if (!visible) return;
    setHour(Number(initial.split(':')[0]) || 8);
    setMinute(Number(initial.split(':')[1]) || 0);
  }, [visible, initial]);

  return (
    <ModalSheet visible={visible} onClose={onClose} centered>
      <Text style={{ color: palette.ink, fontSize: 17, fontWeight: '600' }}>选择时间</Text>
      <Text style={{ color: palette.accentDeep, fontSize: 30, fontWeight: '600', marginVertical: 10 }}>
        {String(hour).padStart(2, '0')} : {String(minute).padStart(2, '0')}
      </Text>
      <View style={{ flexDirection: 'row', justifyContent: 'center' }}>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={{ color: palette.ink4, fontSize: 10 }}>时</Text>
          <ScrollView style={{ height: 190 }} showsVerticalScrollIndicator={false}>
            {Array.from({ length: 24 }).map((_, h) => (
              <Pressable
                key={h}
                onPress={() => setHour(h)}
                style={{
                  paddingVertical: 8,
                  marginVertical: 1,
                  borderRadius: 7,
                  alignItems: 'center',
                  backgroundColor: h === hour ? palette.accent : 'transparent',
                }}
              >
                <Text style={{ color: h === hour ? palette.onAccent : palette.ink2, fontSize: 15 }}>{h}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
        <Text style={{ color: palette.ink3, fontSize: 22, marginTop: 40 }}>:</Text>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={{ color: palette.ink4, fontSize: 10 }}>分</Text>
          <ScrollView style={{ height: 190 }} showsVerticalScrollIndicator={false}>
            {Array.from({ length: 60 }).map((_, m) => (
              <Pressable
                key={m}
                onPress={() => setMinute(m)}
                style={{
                  paddingVertical: 8,
                  marginVertical: 1,
                  borderRadius: 7,
                  alignItems: 'center',
                  backgroundColor: m === minute ? palette.accent : 'transparent',
                }}
              >
                <Text style={{ color: m === minute ? palette.onAccent : palette.ink2, fontSize: 15 }}>
                  {String(m).padStart(2, '0')}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 }}>
        <Pressable onPress={onClose} style={{ padding: 10 }}>
          <Text style={{ color: palette.ink3, fontSize: 14 }}>取消</Text>
        </Pressable>
        <Pressable
          onPress={() => onSelect(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`)}
          style={{ padding: 10 }}
        >
          <Text style={{ color: palette.accentDeep, fontSize: 14, fontWeight: '600' }}>确定</Text>
        </Pressable>
      </View>
    </ModalSheet>
  );
}

export function ValueSlider({
  value,
  min,
  max,
  onChange,
  style,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { palette } = useTheme();
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const minRef = useRef(min);
  const maxRef = useRef(max);
  minRef.current = min;
  maxRef.current = max;
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const x = evt.nativeEvent.locationX;
        const ratio = Math.max(0, Math.min(1, x / Math.max(1, widthRef.current)));
        onChangeRef.current(minRef.current + ratio * (maxRef.current - minRef.current));
      },
      onPanResponderMove: (evt) => {
        const x = evt.nativeEvent.locationX;
        const ratio = Math.max(0, Math.min(1, x / Math.max(1, widthRef.current)));
        onChangeRef.current(minRef.current + ratio * (maxRef.current - minRef.current));
      },
    }),
  ).current;
  const ratio = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return (
    <View
      {...pan.panHandlers}
      onLayout={(e) => {
        widthRef.current = e.nativeEvent.layout.width;
        setWidth(e.nativeEvent.layout.width);
      }}
      style={[{ height: 36, justifyContent: 'center' }, style]}
    >
      <View style={{ height: 4, borderRadius: 2, backgroundColor: palette.paperDeep }}>
        <View style={{ width: `${ratio * 100}%`, height: 4, borderRadius: 2, backgroundColor: palette.accent }} />
      </View>
      <View
        style={{
          position: 'absolute',
          left: Math.max(0, Math.min(width - 20, ratio * width - 10)),
          width: 20,
          height: 20,
          borderRadius: 10,
          backgroundColor: palette.accent,
          borderWidth: 2,
          borderColor: '#FFFFFF',
        }}
      />
    </View>
  );
}

