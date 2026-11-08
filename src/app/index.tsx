import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../store';
import { useTheme } from '../theme';
import { AppScreen, TopBar } from '../ui';
import { TodayScreen } from '../screens/TodayScreen';
import { WeekScreen } from '../screens/WeekScreen';
import { SemesterScreen } from '../screens/SemesterScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
// @ts-ignore
import * as C from '../core/index.js';

type Tab = 'today' | 'week' | 'semester' | 'settings';

const TABS: { key: Tab; label: string; icon: any; activeIcon: any }[] = [
  { key: 'today', label: '今日', icon: 'home-outline', activeIcon: 'home' },
  { key: 'week', label: '周', icon: 'calendar-outline', activeIcon: 'calendar' },
  { key: 'semester', label: '全学期', icon: 'list-outline', activeIcon: 'list' },
  { key: 'settings', label: '设置', icon: 'settings-outline', activeIcon: 'settings' },
];

export default function MainScreen() {
  const { palette } = useTheme();
  const { state, now } = useStore();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('today');
  const currentWeek = useMemo(() => {
    try {
      const cw = C.currentWeek(state, now);
      return Math.max(1, Number(cw?.week) || 1);
    } catch {
      return 1;
    }
  }, [state, now]);
  const [week, setWeek] = useState(currentWeek);
  const totalWeeks = Math.max(1, state.termConfig.weekCount || 20);

  const title = tab === 'today' ? '今天'
    : tab === 'week' ? `第 ${week} 周`
      : tab === 'semester' ? '全学期'
        : '设置';

  const right = tab === 'week' ? (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      {week !== currentWeek ? (
        <Pressable onPress={() => setWeek(currentWeek)} hitSlop={8} style={{ paddingHorizontal: 6, paddingVertical: 6 }}>
          <Text style={{ color: palette.accentDeep, fontSize: 12 }}>回到本周</Text>
        </Pressable>
      ) : null}
      <Pressable onPress={() => router.push('/course-edit')} hitSlop={8} style={{ padding: 6 }}>
        <Ionicons name="add" size={26} color={palette.accentDeep} />
      </Pressable>
    </View>
  ) : null;

  return (
    <AppScreen edges={['top']}>
      <TopBar title={title} right={right} />
      <View style={{ flex: 1 }}>
        {tab === 'today' ? <TodayScreen /> : null}
        {tab === 'week' ? (
          <WeekScreen
            week={week}
            onWeekChange={(w: number) => setWeek(Math.max(1, Math.min(totalWeeks, w)))}
            onEdit={(course) => router.push({ pathname: '/course-edit', params: { id: course.id } })}
          />
        ) : null}
        {tab === 'semester' ? (
          <SemesterScreen onOpenWeek={(w) => { setWeek(w); setTab('week'); }} />
        ) : null}
        {tab === 'settings' ? <SettingsScreen /> : null}
      </View>
      <View style={[styles.tabbar, { backgroundColor: palette.surface, borderTopColor: palette.line, paddingBottom: Math.max(8, insets.bottom) }]}>
        {TABS.map((item) => {
          const active = tab === item.key;
          return (
            <Pressable
              key={item.key}
              onPress={() => setTab(item.key)}
              style={styles.tabItem}
            >
              <View style={{ alignItems: 'center', justifyContent: 'center' }}>
                <View style={{
                  width: 42,
                  height: 28,
                  borderRadius: 14,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: active ? palette.accent : 'transparent',
                }}>
                  <Ionicons
                    name={active ? item.activeIcon : item.icon}
                    size={20}
                    color={active ? palette.onAccent : palette.ink3}
                  />
                </View>
                <Text style={{ marginTop: 2, color: active ? palette.accentDeep : palette.ink3, fontSize: 10.5 }}>{item.label}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  tabbar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 6,
    paddingHorizontal: 10,
  },
  tabItem: { flex: 1, alignItems: 'center', paddingVertical: 2 },
});
