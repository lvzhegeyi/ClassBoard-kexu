import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useStore } from '../store';
import { useTheme } from '../theme';
import {
  Card,
  Chips,
  GhostButton,
  ModalSheet,
  SectionTitle,
  Stepper,
  SwitchRow,
} from '../ui';
import { CalendarPicker, ValueSlider } from '../pickers';
import type { MobileSettings, ThemeMode } from '../types';
import { setupNotifications, scheduleTestReminder } from '../notifications/reminders';
// @ts-ignore - core 纯函数（当前周）
import * as C from '../core/index.js';

const THEME_MODES: ThemeMode[] = ['flat', 'dark', 'auto'];
const THEME_LABELS = ['白天', '黑暗', '跟随系统'];
const WEEKDAY_START_OPTIONS = ['周一', '周日'];
const WEEK_VIEW_LABELS = ['全屏', '纵向拉伸'];
const LEAD_MINUTES = [5, 10, 15, 20, 30];

const FIELD_DEFS: { key: keyof MobileSettings['showFields']; label: string }[] = [
  { key: 'name', label: '课程名' },
  { key: 'teacher', label: '教师' },
  { key: 'room', label: '教室' },
  { key: 'time', label: '时间' },
  { key: 'category', label: '类别' },
  { key: 'credit', label: '学分' },
];

function GroupCard({ children }: { children: React.ReactNode }) {
  const { palette } = useTheme();
  return (
    <View
      style={{
        backgroundColor: palette.surface,
        borderColor: palette.line,
        borderWidth: 1,
        borderRadius: 16,
        marginBottom: 12,
        overflow: 'hidden',
      }}
    >
      {children}
    </View>
  );
}

function FieldLabel({ children, first }: { children: React.ReactNode; first?: boolean }) {
  const { palette } = useTheme();
  return (
    <Text style={{ color: palette.ink3, fontSize: 12, marginBottom: 7, marginTop: first ? 0 : 14 }}>
      {children}
    </Text>
  );
}

function SettingsRow({
  label,
  value,
  onPress,
  danger,
  last,
}: {
  label: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
  last?: boolean;
}) {
  const { palette } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 14,
        paddingVertical: 13,
        borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
        borderBottomColor: palette.line,
        backgroundColor: pressed && onPress ? palette.paperDeep : 'transparent',
      })}
    >
      <Text style={{ flex: 1, color: danger ? palette.danger : palette.ink, fontSize: 15 }}>{label}</Text>
      {value ? (
        <Text style={{ color: palette.ink3, fontSize: 13, marginRight: onPress ? 6 : 0 }} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {onPress ? <Text style={{ color: palette.ink4, fontSize: 17 }}>›</Text> : null}
    </Pressable>
  );
}

function SwitchCell({
  title,
  desc,
  value,
  onChange,
  last,
}: {
  title: string;
  desc?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  last?: boolean;
}) {
  const { palette } = useTheme();
  return (
    <View
      style={{
        paddingHorizontal: 14,
        borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
        borderBottomColor: palette.line,
      }}
    >
      <SwitchRow title={title} desc={desc} value={value} onChange={onChange} />
    </View>
  );
}

function DangerButton({ label, onPress, style }: { label: string; onPress: () => void; style?: any }) {
  const { palette } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          backgroundColor: palette.danger,
          opacity: pressed ? 0.8 : 1,
          borderRadius: 12,
          alignItems: 'center',
          justifyContent: 'center',
          paddingVertical: 12,
          paddingHorizontal: 16,
        },
        style,
      ]}
    >
      <Text style={{ color: palette.isDark ? '#17201B' : '#FFFFFF', fontSize: 15, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export function SettingsScreen() {
  const router = useRouter();
  const { palette } = useTheme();
  const {
    state,
    now,
    updateSettings,
    setStartDate,
    updateWeekCount,
    clearData,
  } = useStore();
  const settings = state.settings;

  const [calendarVisible, setCalendarVisible] = useState(false);
  const [clearVisible, setClearVisible] = useState(false);
  const [testHint, setTestHint] = useState('');
  const [fontScale, setFontScale] = useState(settings.weekFontScale);
  const fontTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setFontScale(settings.weekFontScale);
  }, [settings.weekFontScale]);

  useEffect(() => () => {
    if (fontTimer.current) clearTimeout(fontTimer.current);
  }, []);

  const version = Constants.expoConfig?.version ?? '1.0.0';
  const themeIndex = Math.max(0, THEME_MODES.indexOf(settings.theme));
  const courseCount = state.courses.length;
  const slotCount = state.courses.reduce((total, course) => total + course.slots.length, 0);
  const adjustmentCount = state.adjustments.length;
  const sectionCount = state.termConfig.sections?.length ?? 0;
  const leadIndex = Math.max(0, LEAD_MINUTES.indexOf(settings.leadMinutes));

  const currentWeek = useMemo(() => {
    try {
      const cw = C.currentWeek(state, now);
      return Math.max(1, Number(cw?.week) || 1);
    } catch {
      return 1;
    }
  }, [state, now]);

  const changeFontScale = useCallback((raw: number) => {
    const next = Math.round(raw) / 100;
    setFontScale(next);
    if (fontTimer.current) clearTimeout(fontTimer.current);
    fontTimer.current = setTimeout(() => {
      updateSettings({ weekFontScale: next });
    }, 220);
  }, [updateSettings]);

  const toggleField = useCallback((key: keyof MobileSettings['showFields']) => {
    updateSettings({ showFields: { ...settings.showFields, [key]: !settings.showFields[key] } });
  }, [settings.showFields, updateSettings]);

  const toggleReminder = useCallback(async (value: boolean) => {
    await updateSettings({ reminderEnabled: value });
    if (value) {
      try {
        await setupNotifications();
      } catch {
        // 权限被拒绝时仍保留设置，提醒会在通知中心不可见
      }
    }
  }, [updateSettings]);

  const toggleOngoing = useCallback(async (value: boolean) => {
    await updateSettings({ ongoingNotification: value });
    if (value) {
      try {
        await setupNotifications();
      } catch {
        // 忽略权限错误
      }
    }
  }, [updateSettings]);

  const sendTest = useCallback(async () => {
    setTestHint('');
    try {
      const granted = await setupNotifications();
      if (!granted) {
        setTestHint('通知权限未开启，请在系统设置中允许「课序」发送通知');
        return;
      }
      await scheduleTestReminder(settings);
      setTestHint('测试通知已发送，大约 5 秒后出现');
      setTimeout(() => setTestHint(''), 5000);
    } catch (err: any) {
      setTestHint(err?.message || '发送测试通知失败');
    }
  }, [settings]);

  const doClear = useCallback(async () => {
    setClearVisible(false);
    try {
      await clearData();
    } catch {
      // 清空失败时保持当前数据
    }
  }, [clearData]);

  const startDateText = state.termConfig.startDate
    ? state.termConfig.startDate.replace(/-/g, '/')
    : '未设置';

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <SectionTitle>导入课表</SectionTitle>
      <GroupCard>
        <SettingsRow label="教务网导入" value="正方教务" onPress={() => router.push('/import-jwxt')} />
        <SettingsRow label="粘贴 JSON" value="解析课表数据" onPress={() => router.push('/import-json')} />
        <SettingsRow label="从电脑导入" value="同一 Wi-Fi 下" onPress={() => router.push('/import-computer')} last />
      </GroupCard>

      <SectionTitle>外观</SectionTitle>
      <Card>
        <FieldLabel first>主题</FieldLabel>
        <Chips options={THEME_LABELS} selected={themeIndex} onSelect={(i) => updateSettings({ theme: THEME_MODES[i] })} />

        <FieldLabel>每周从</FieldLabel>
        <Chips
          options={WEEKDAY_START_OPTIONS}
          selected={settings.weekdayStart === 7 ? 1 : 0}
          onSelect={(i) => updateSettings({ weekdayStart: i === 1 ? 7 : 1 })}
        />

        <FieldLabel>周课表模式</FieldLabel>
        <Chips
          options={WEEK_VIEW_LABELS}
          selected={settings.weekViewMode === 1 ? 1 : 0}
          onSelect={(i) => updateSettings({ weekViewMode: i === 1 ? 1 : 0 })}
        />

        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 14 }}>
          <Text style={{ flex: 1, color: palette.ink3, fontSize: 12 }}>课表字号</Text>
          <Text style={{ color: palette.accentDeep, fontSize: 12, fontWeight: '600' }}>
            {Math.round(fontScale * 100)}%
          </Text>
        </View>
        <ValueSlider value={fontScale * 100} min={80} max={160} onChange={changeFontScale} />
      </Card>

      <SectionTitle>显示内容</SectionTitle>
      <Card style={{ padding: 0 }}>
        {FIELD_DEFS.map((field, index) => (
          <SwitchCell
            key={field.key}
            title={field.label}
            value={settings.showFields[field.key]}
            onChange={() => toggleField(field.key)}
            last={index === FIELD_DEFS.length - 1}
          />
        ))}
      </Card>

      <SectionTitle>学期</SectionTitle>
      <GroupCard>
        <SettingsRow label="开学日期" value={startDateText} onPress={() => setCalendarVisible(true)} />
        <View style={[styles.stepperRow, { borderBottomColor: palette.line }]}>
          <Text style={{ flex: 1, color: palette.ink, fontSize: 15 }}>教学周数</Text>
          <Text style={{ color: palette.ink3, fontSize: 13, marginRight: 10 }}>{state.termConfig.weekCount} 周</Text>
          <Stepper
            value={state.termConfig.weekCount}
            min={1}
            max={60}
            onChange={(value) => updateWeekCount(value)}
          />
        </View>
        <SettingsRow label="当前周" value={`第 ${currentWeek} 周`} />
        <SettingsRow label="节次时间" value={`${sectionCount} 节`} onPress={() => router.push('/section-times')} />
        <SettingsRow
          label="调休安排"
          value={adjustmentCount ? `${adjustmentCount} 条` : '未设置'}
          onPress={() => router.push('/adjust')}
          last
        />
      </GroupCard>

      <SectionTitle>提醒</SectionTitle>
      <GroupCard>
        <SwitchCell
          title="启用提醒"
          desc="按提前分钟数发送课前通知"
          value={settings.reminderEnabled}
          onChange={toggleReminder}
          last={!settings.reminderEnabled}
        />
        {settings.reminderEnabled ? (
          <>
            <View style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line }}>
              <FieldLabel first>提前提醒</FieldLabel>
              <Chips
                options={LEAD_MINUTES.map((m) => `${m} 分钟`)}
                selected={leadIndex}
                onSelect={(i) => updateSettings({ leadMinutes: LEAD_MINUTES[i] })}
              />
            </View>
            <SwitchCell title="提示音" desc="通知到达时播放系统提示音" value={settings.sound} onChange={(v) => updateSettings({ sound: v })} />
            <SwitchCell title="震动" desc="通知到达时震动提醒" value={settings.vibration} onChange={(v) => updateSettings({ vibration: v })} />
            <SwitchCell
              title="系统通知"
              desc="在通知中心保留今日课程动态"
              value={settings.ongoingNotification}
              onChange={toggleOngoing}
            />
            <SwitchCell
              title="Live Activity"
              desc="锁屏与灵动岛显示下一节课（iOS 16.1+）"
              value={settings.liveActivity}
              onChange={(v) => updateSettings({ liveActivity: v })}
            />
            {testHint ? (
              <Text style={{ color: palette.ink3, fontSize: 11.5, paddingHorizontal: 14, paddingTop: 8 }}>{testHint}</Text>
            ) : null}
            <SettingsRow label="发送测试提醒" value="5 秒后" onPress={sendTest} last />
          </>
        ) : null}
      </GroupCard>

      <SectionTitle>数据</SectionTitle>
      <GroupCard>
        <SettingsRow label="清空所有数据" danger onPress={() => setClearVisible(true)} last />
      </GroupCard>
      <Text style={{ color: palette.ink4, fontSize: 11, lineHeight: 17, marginTop: -4, marginBottom: 12 }}>
        清空会删除全部课程、浮动课程与调休记录；主题、提醒等设置会保留。
      </Text>

      <SectionTitle>关于</SectionTitle>
      <GroupCard>
        <SettingsRow label="版本" value={`v${version}`} />
        <SettingsRow label="课程数据" value={`${courseCount} 门 · ${slotCount} 段`} />
        <SettingsRow label="调休规则" value={`${adjustmentCount} 条`} />
        <SettingsRow label="数据存储" value="仅保存在本机" last />
      </GroupCard>
      <Text style={{ color: palette.ink4, fontSize: 11, textAlign: 'center', marginTop: 2, marginBottom: 24 }}>
        课序 ClassBoard · 本地优先的课程表
      </Text>

      <CalendarPicker
        visible={calendarVisible}
        initial={state.termConfig.startDate || new Date().toISOString().slice(0, 10)}
        onClose={() => setCalendarVisible(false)}
        onSelect={(iso) => {
          setCalendarVisible(false);
          setStartDate(iso);
        }}
      />

      <ModalSheet visible={clearVisible} onClose={() => setClearVisible(false)} centered title="清空数据">
        <Text style={{ color: palette.ink2, fontSize: 14, lineHeight: 21, marginBottom: 16 }}>
          将删除本机全部课程、浮动课程与调休记录，设置会保留。此操作不可恢复，确定继续吗？
        </Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <GhostButton label="取消" onPress={() => setClearVisible(false)} style={{ flex: 1 }} />
          <DangerButton label="清空" onPress={doClear} style={{ flex: 1 }} />
        </View>
      </ModalSheet>
    </ScrollView>
  );
}

export default SettingsScreen;

const styles = StyleSheet.create({
  content: { paddingHorizontal: 14, paddingTop: 4, paddingBottom: 24 },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
