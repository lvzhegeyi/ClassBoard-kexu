import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../store';
import { useTheme, withAlpha } from '../theme';
import {
  AppScreen,
  Card,
  Chips,
  ColorDots,
  Field,
  GhostButton,
  ModalSheet,
  PrimaryButton,
  SectionTitle,
  Stepper,
  TopBar,
} from '../ui';
import type { Course, Slot } from '../types';
// @ts-ignore - 复用平台无关的 core 纯函数（周次/颜色/时间）
import * as C from '../core/index.js';

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];
const CATEGORIES = ['必修', '选修', '限选', '通识', '实践', '网络课'];

function cloneCourse(course: Course): Course {
  return {
    ...course,
    slots: course.slots.map((s) => ({ ...s, weeks: [...s.weeks] })),
  };
}

function defaultWeeks(weekCount: number): number[] {
  const max = Math.max(1, Math.min(weekCount, 16));
  return Array.from({ length: max }, (_, i) => i + 1);
}

function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, () => setVisible(true));
    const hide = Keyboard.addListener(hideEvent, () => setVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}

/** 周次点选网格（最小 1、最大 max，禁止手写文本） */
function WeekGrid({ weeks, max, onChange }: { weeks: number[]; max: number; onChange: (next: number[]) => void }) {
  const { palette } = useTheme();
  const selected = useMemo(() => new Set(weeks), [weeks]);
  const toggle = (week: number) => {
    const next = new Set(selected);
    if (next.has(week)) next.delete(week);
    else next.add(week);
    onChange([...next].sort((a, b) => a - b));
  };
  return (
    <View style={styles.weekGrid}>
      {Array.from({ length: max }, (_, i) => i + 1).map((week) => {
        const on = selected.has(week);
        return (
          <Pressable
            key={week}
            onPress={() => toggle(week)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={[
              styles.weekCell,
              {
                backgroundColor: on ? palette.accent : palette.surface,
                borderColor: on ? palette.accent : palette.line,
              },
            ]}
          >
            <Text style={{ color: on ? palette.onAccent : palette.ink2, fontSize: 12, fontWeight: on ? '600' : '400' }}>
              {week}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** 与 ui.Field 视觉一致、但点击弹出选择器的字段 */
function FieldButton({
  label,
  value,
  placeholder,
  onPress,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onPress: () => void;
}) {
  const { palette } = useTheme();
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={{ color: palette.ink3, fontSize: 12, marginBottom: 5 }}>{label}</Text>
      <Pressable
        onPress={onPress}
        style={{
          minHeight: 44,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: palette.line,
          backgroundColor: palette.surface,
          paddingHorizontal: 12,
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        <Text style={{ flex: 1, color: value ? palette.ink : palette.ink4, fontSize: 15 }} numberOfLines={1}>
          {value || placeholder || '请选择'}
        </Text>
        <Text style={{ color: palette.ink4, fontSize: 17 }}>›</Text>
      </Pressable>
    </View>
  );
}

function DangerButton({ label, onPress, style }: { label: string; onPress: () => void; style?: any }) {
  const { palette } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.dangerBtn,
        { backgroundColor: palette.danger, opacity: pressed ? 0.8 : 1 },
        style,
      ]}
    >
      <Text style={{ color: palette.isDark ? '#17201B' : '#FFFFFF', fontSize: 15, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export function CourseEditScreen() {
  const router = useRouter();
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();
  const { state, upsertCourse, deleteCourse } = useStore();
  const params = useLocalSearchParams<{ id?: string; weekday?: string; week?: string }>();

  const courseId = typeof params.id === 'string' ? params.id : '';
  const isNew = !courseId;
  const existing = useMemo(
    () => (courseId ? state.courses.find((c) => c.id === courseId) : undefined),
    [courseId, state.courses],
  );
  const missing = !!courseId && !existing;

  const sections = useMemo(
    () => (state.termConfig.sections?.length ? state.termConfig.sections : (C.DEFAULT_SECTIONS as typeof state.termConfig.sections)),
    [state.termConfig.sections],
  );
  const maxSection = Math.max(1, Math.min(sections.length || 12, 20));
  const weekCount = Math.max(1, Math.min(60, Number(state.termConfig.weekCount) || 20));

  const [draft, setDraft] = useState<Course>(() => {
    if (existing) return cloneCourse(existing);
    const weekdayRaw = Number(params.weekday);
    const weekday = weekdayRaw >= 1 && weekdayRaw <= 7 ? Math.round(weekdayRaw) : 1;
    const weekRaw = Number(params.week);
    const weeks = weekRaw >= 1 && weekRaw <= 60 ? [Math.round(weekRaw)] : defaultWeeks(weekCount);
    return {
      id: '',
      name: '',
      teacher: '',
      room: '',
      category: '必修',
      credit: null,
      color: (C.hashColor('') as number) % 10,
      colorManual: false,
      hidden: false,
      slots: [{ weekday, startSection: 1, endSection: 2, weeks }],
    };
  });
  const [creditText, setCreditText] = useState(() => (draft.credit != null ? String(draft.credit) : ''));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteVisible, setDeleteVisible] = useState(false);
  const [categoryVisible, setCategoryVisible] = useState(false);
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const savingRef = useRef(false);
  const deletingRef = useRef(false);

  const resolvedColor = draft.colorManual
    ? draft.color
    : isNew
      ? ((C.hashColor(draft.name) as number) % 10)
      : draft.color;

  const weekMax = useMemo(() => {
    const used = draft.slots.reduce((max, slot) => Math.max(max, ...(slot.weeks.length ? slot.weeks : [0])), 0);
    return Math.max(4, Math.min(60, Math.max(weekCount, used)));
  }, [draft.slots, weekCount]);

  const update = useCallback((patch: Partial<Course>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  }, []);

  const patchSlot = useCallback((index: number, patch: Partial<Slot>) => {
    setDraft((prev) => ({
      ...prev,
      slots: prev.slots.map((slot, i) => (i === index ? { ...slot, ...patch } : slot)),
    }));
  }, []);

  const addSlot = useCallback(() => {
    setDraft((prev) => {
      if (prev.slots.length >= 6) return prev;
      const last = prev.slots[prev.slots.length - 1];
      return {
        ...prev,
        slots: [
          ...prev.slots,
          {
            weekday: ((last?.weekday ?? 1) % 7) + 1,
            startSection: 1,
            endSection: 2,
            weeks: [...(last?.weeks ?? defaultWeeks(weekCount))],
          },
        ],
      };
    });
  }, [weekCount]);

  const removeSlot = useCallback((index: number) => {
    setDraft((prev) => (
      prev.slots.length <= 1 ? prev : { ...prev, slots: prev.slots.filter((_, i) => i !== index) }
    ));
  }, []);

  const weekQuick = useCallback((index: number, mode: 'all' | 'none' | 'odd' | 'even' | 'first') => {
    const all = Array.from({ length: weekMax }, (_, i) => i + 1);
    const next = mode === 'none' ? []
      : mode === 'odd' ? all.filter((w) => w % 2 === 1)
        : mode === 'even' ? all.filter((w) => w % 2 === 0)
          : mode === 'first' ? all.slice(0, Math.ceil(weekMax / 2))
            : all;
    patchSlot(index, { weeks: next });
  }, [patchSlot, weekMax]);

  const save = useCallback(async () => {
    const name = draft.name.trim();
    if (!name) {
      setError('请先填写课程名');
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      return;
    }
    if (!draft.slots.length) {
      setError('至少需要一个上课时间');
      return;
    }
    for (let i = 0; i < draft.slots.length; i += 1) {
      const slot = draft.slots[i];
      if (!slot.weeks.length) {
        setError(`第 ${i + 1} 个上课时间还没有选择周次`);
        return;
      }
    }
    // 同步加锁：避免连点保存触发两次写入/两次 router.back()
    if (savingRef.current) return;
    savingRef.current = true;
    const creditRaw = creditText.trim() === '' ? null : Number(creditText);
    const credit = creditRaw != null && Number.isFinite(creditRaw) ? creditRaw : null;
    const cleaned: Course = {
      ...draft,
      name,
      teacher: draft.teacher.trim(),
      room: draft.room.trim(),
      category: draft.category.trim() || '必修',
      credit,
      color: Math.max(0, Math.min(9, resolvedColor)),
      colorManual: !!draft.colorManual,
      slots: draft.slots.map((slot) => ({
        weekday: Math.max(1, Math.min(7, slot.weekday)),
        startSection: Math.max(1, Math.min(maxSection, slot.startSection)),
        endSection: Math.max(Math.max(1, slot.startSection), Math.min(maxSection, slot.endSection)),
        weeks: [...new Set(slot.weeks)].filter((w) => w >= 1 && w <= 60).sort((a, b) => a - b),
      })),
    };
    setError('');
    setSaving(true);
    Keyboard.dismiss();
    try {
      await upsertCourse(cleaned);
      router.back();
    } catch (err: any) {
      setError(err?.message || '保存失败，请重试');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [creditText, draft, maxSection, resolvedColor, router, upsertCourse]);

  const removeCourse = useCallback(async () => {
    if (!courseId || deletingRef.current) return;
    deletingRef.current = true;
    setDeleteVisible(false);
    try {
      await deleteCourse(courseId);
      router.back();
    } catch (err: any) {
      setError(err?.message || '删除失败，请重试');
      deletingRef.current = false;
    }
  }, [courseId, deleteCourse, router]);

  if (missing) {
    return (
      <AppScreen edges={['top']}>
        <TopBar title="编辑课程" onBack={() => router.back()} />
        <View style={styles.center}>
          <Text style={{ color: palette.ink3, fontSize: 14 }}>课程不存在或已被删除</Text>
          <GhostButton label="返回" onPress={() => router.back()} style={{ marginTop: 14 }} />
        </View>
      </AppScreen>
    );
  }

  return (
    <AppScreen edges={['top']}>
      <TopBar
        title={isNew ? '新增课程' : '编辑课程'}
        subtitle={isNew ? '保存后加入本机课表' : existing?.name}
        onBack={() => router.back()}
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {error ? (
            <View style={[styles.errorBox, { backgroundColor: withAlpha(palette.danger, 0.1), borderColor: palette.danger }]}>
              <Text style={{ color: palette.danger, fontSize: 13 }}>{error}</Text>
            </View>
          ) : null}

          <SectionTitle>基本信息</SectionTitle>
          <Card>
            <Field
              label="课程名"
              value={draft.name}
              onChangeText={(v) => { update({ name: v }); if (error) setError(''); }}
              placeholder="例如 计算机组成原理"
            />
            <Field
              label="教师"
              value={draft.teacher}
              onChangeText={(v) => update({ teacher: v })}
              placeholder="例如 李龙腾"
            />
            <Field
              label="地点"
              value={draft.room}
              onChangeText={(v) => update({ room: v })}
              placeholder="例如 多媒体 3506"
            />
            <FieldButton label="类别" value={draft.category} onPress={() => setCategoryVisible(true)} />
            <Field
              label="学分（可留空）"
              value={creditText}
              onChangeText={setCreditText}
              keyboardType="decimal-pad"
              placeholder="例如 3"
            />
          </Card>

          <SectionTitle>课程颜色</SectionTitle>
          <Card>
            <ColorDots
              selected={resolvedColor}
              onSelect={(i) => update({ color: i, colorManual: true })}
            />
            <Text style={{ color: palette.ink3, fontSize: 11.5, marginTop: 10 }}>
              {draft.colorManual ? '已手动指定颜色' : '默认按课程名自动配色'}
            </Text>
          </Card>

          <SectionTitle right={<Text style={{ color: palette.ink4, fontSize: 11 }}>共 {draft.slots.length} 个</Text>}>
            上课安排
          </SectionTitle>

          {draft.slots.map((slot, index) => {
            const startTime = sections[slot.startSection - 1]?.start ?? '';
            const endTime = sections[slot.endSection - 1]?.end ?? '';
            return (
              <Card key={`slot-${index}`}>
                <View style={styles.slotHeader}>
                  <Text style={{ color: palette.ink, fontSize: 14, fontWeight: '600' }}>上课时间 {index + 1}</Text>
                  {draft.slots.length > 1 ? (
                    <Pressable onPress={() => removeSlot(index)} hitSlop={8}>
                      <Text style={{ color: palette.danger, fontSize: 13 }}>删除</Text>
                    </Pressable>
                  ) : null}
                </View>

                <Text style={[styles.slotLabel, { color: palette.ink3 }]}>星期</Text>
                <Chips
                  options={WEEKDAY_LABELS}
                  selected={slot.weekday - 1}
                  onSelect={(i) => patchSlot(index, { weekday: i + 1 })}
                />

                <View style={styles.stepRow}>
                  <Text style={[styles.slotLabel, { marginTop: 0, color: palette.ink3 }]}>起止节次</Text>
                  <View style={styles.stepRight}>
                    <Stepper
                      value={slot.startSection}
                      min={1}
                      max={slot.endSection}
                      onChange={(v) => patchSlot(index, { startSection: v })}
                    />
                    <Text style={{ color: palette.ink4, fontSize: 14, marginHorizontal: 6 }}>至</Text>
                    <Stepper
                      value={slot.endSection}
                      min={slot.startSection}
                      max={maxSection}
                      onChange={(v) => patchSlot(index, { endSection: v })}
                    />
                  </View>
                </View>
                <Text style={{ color: palette.ink3, fontSize: 11.5, marginTop: 2 }}>
                  第 {slot.startSection}–{slot.endSection} 节
                  {startTime && endTime ? ` · ${startTime}–${endTime}` : ''}
                </Text>

                <View style={[styles.slotHeader, { marginTop: 14 }]}>
                  <Text style={[styles.slotLabel, { color: palette.ink3 }]}>周次</Text>
                  <Text style={{ color: palette.ink4, fontSize: 11 }}>
                    {slot.weeks.length ? `已选 ${slot.weeks.length} 周` : '尚未选择'}
                  </Text>
                </View>
                <WeekGrid
                  weeks={slot.weeks}
                  max={weekMax}
                  onChange={(weeks) => patchSlot(index, { weeks })}
                />
                <View style={styles.quickRow}>
                  {([
                    ['全选', 'all'],
                    ['清空', 'none'],
                    ['单周', 'odd'],
                    ['双周', 'even'],
                    ['前半', 'first'],
                  ] as const).map(([label, mode]) => (
                    <Pressable
                      key={mode}
                      onPress={() => weekQuick(index, mode)}
                      style={({ pressed }) => [
                        styles.quickBtn,
                        { backgroundColor: palette.paperDeep, opacity: pressed ? 0.7 : 1 },
                      ]}
                    >
                      <Text style={{ color: palette.ink2, fontSize: 11.5 }}>{label}</Text>
                    </Pressable>
                  ))}
                </View>
              </Card>
            );
          })}

          <Pressable
            onPress={addSlot}
            style={({ pressed }) => [
              styles.addSlot,
              { borderColor: palette.line, backgroundColor: pressed ? palette.paperDeep : 'transparent' },
            ]}
          >
            <Text style={{ color: palette.accentDeep, fontSize: 14, fontWeight: '500' }}>＋ 添加上课时间</Text>
          </Pressable>
        </ScrollView>

        <View
          style={[
            styles.bottomBar,
            {
              backgroundColor: palette.surface,
              borderTopColor: palette.line,
              paddingBottom: keyboardVisible ? 10 : Math.max(10, insets.bottom),
            },
          ]}
        >
          {!isNew ? (
            <GhostButton label="删除" danger onPress={() => setDeleteVisible(true)} style={styles.barBtn} />
          ) : null}
          <View style={{ flex: 1 }} />
          <GhostButton label="取消" onPress={() => router.back()} style={styles.barBtn} />
          <PrimaryButton
            label={saving ? '保存中…' : '保存'}
            onPress={save}
            disabled={saving}
            style={styles.barPrimary}
          />
        </View>
      </KeyboardAvoidingView>

      <ModalSheet visible={categoryVisible} onClose={() => setCategoryVisible(false)} title="选择类别">
        {CATEGORIES.map((category) => {
          const active = draft.category === category;
          return (
            <Pressable
              key={category}
              onPress={() => { update({ category }); setCategoryVisible(false); }}
              style={{
                paddingVertical: 12,
                paddingHorizontal: 4,
                flexDirection: 'row',
                alignItems: 'center',
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: palette.line,
              }}
            >
              <Text style={{ flex: 1, color: active ? palette.accentDeep : palette.ink, fontSize: 15, fontWeight: active ? '600' : '400' }}>
                {category}
              </Text>
              {active ? <Text style={{ color: palette.accentDeep, fontSize: 15 }}>✓</Text> : null}
            </Pressable>
          );
        })}
        <GhostButton label="取消" onPress={() => setCategoryVisible(false)} style={{ marginTop: 14 }} />
      </ModalSheet>

      <ModalSheet visible={deleteVisible} onClose={() => setDeleteVisible(false)} centered title="删除课程">
        <Text style={{ color: palette.ink2, fontSize: 14, lineHeight: 21, marginBottom: 16 }}>
          {draft.name ? `删除后不可恢复，确定删除「${draft.name}」吗？` : '删除后不可恢复，确定删除这门课程吗？'}
        </Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <GhostButton label="取消" onPress={() => setDeleteVisible(false)} style={{ flex: 1 }} />
          <DangerButton label="删除" onPress={removeCourse} style={{ flex: 1 }} />
        </View>
      </ModalSheet>
    </AppScreen>
  );
}

export default CourseEditScreen;

const styles = StyleSheet.create({
  content: { paddingHorizontal: 14, paddingTop: 6, paddingBottom: 28 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorBox: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  slotHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  slotLabel: { fontSize: 12, marginTop: 12, marginBottom: 6 },
  stepRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  stepRight: { flexDirection: 'row', alignItems: 'center' },
  weekGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  weekCell: {
    width: 32,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickRow: { flexDirection: 'row', gap: 7, marginTop: 10 },
  quickBtn: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8 },
  addSlot: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  barBtn: { paddingVertical: 11, paddingHorizontal: 14 },
  barPrimary: { minWidth: 104, paddingVertical: 12 },
  dangerBtn: {
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
});
