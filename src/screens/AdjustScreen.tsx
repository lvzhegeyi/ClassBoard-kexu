import React, { useCallback, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../store';
import { useTheme, withAlpha, type Palette } from '../theme';
import {
  AppScreen,
  Card,
  Chips,
  Empty,
  Field,
  GhostButton,
  ModalSheet,
  PrimaryButton,
  TopBar,
} from '../ui';
import { CalendarPicker } from '../pickers';
import type { Adjustment } from '../types';
// @ts-ignore - core 纯函数（日期 / 星期）
import * as C from '../core/index.js';

const TYPE_VALUES: Adjustment['type'][] = ['off', 'swap', 'makeup'];
const TYPE_LABELS = ['放假', '对调', '补课'];
const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];
const WEEK_CHARS = ['一', '二', '三', '四', '五', '六', '日'];

type CalField = 'date' | 'from' | 'to';

interface Draft {
  type: Adjustment['type'];
  date: string;
  from: string;
  to: string;
  weekday: number;
  note: string;
}

function fmtDate(iso?: string): string {
  if (!iso || !C.isIsoDate(iso)) return '未选择';
  const parts = iso.split('-').map(Number);
  return `${parts[1]} 月 ${parts[2]} 日`;
}

function fmtWeekday(iso?: string): string {
  if (!iso || !C.isIsoDate(iso)) return '';
  const weekday = Number(C.isoWeekday(iso)) || 1;
  return `周${WEEK_CHARS[(weekday - 1) % 7]}`;
}

function rowTitle(adjustment: Adjustment): string {
  if (adjustment.type === 'off') return `放假 · ${fmtDate(adjustment.date)}`;
  if (adjustment.type === 'swap') return `对调 · ${fmtDate(adjustment.from)} ↔ ${fmtDate(adjustment.to)}`;
  return `补课 · ${fmtDate(adjustment.date)} 按周${WEEK_CHARS[((adjustment.weekday || 1) - 1) % 7]}课表上课`;
}

function rowSub(adjustment: Adjustment): string {
  if (adjustment.type === 'off') return adjustment.note || '当天课程全部取消';
  if (adjustment.type === 'swap') return `${fmtWeekday(adjustment.from)} ↔ ${fmtWeekday(adjustment.to)} 互换`;
  return adjustment.note || '按指定星期的课表上课';
}

function typeColor(type: Adjustment['type'], palette: Palette): string {
  if (type === 'off') return palette.danger;
  if (type === 'swap') return palette.accent;
  return palette.accentDeep;
}

function DateRow({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  const { palette } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.dateRow,
        {
          borderColor: palette.line,
          backgroundColor: pressed ? palette.paperDeep : palette.surface,
        },
      ]}
    >
      <Text style={{ color: palette.ink3, fontSize: 13, width: 84 }}>{label}</Text>
      <Text style={{ flex: 1, color: value === '未选择' ? palette.ink4 : palette.ink, fontSize: 14, textAlign: 'right' }} numberOfLines={1}>
        {value}
      </Text>
      <Text style={{ color: palette.ink4, fontSize: 17, marginLeft: 8 }}>›</Text>
    </Pressable>
  );
}

export function AdjustScreen() {
  const router = useRouter();
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();
  const { state, addAdjustment, removeAdjustment } = useStore();

  const today = (C.todayIso() as string) || new Date().toISOString().slice(0, 10);
  const [draft, setDraft] = useState<Draft>(() => ({
    type: 'off',
    date: today,
    from: today,
    to: (C.addDays(today, 1) as string) || today,
    weekday: 1,
    note: '',
  }));
  const [editing, setEditing] = useState(false);
  const [calField, setCalField] = useState<CalField | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const adjustments = state.adjustments;
  const typeIndex = TYPE_VALUES.indexOf(draft.type);

  const calInitial = useMemo(() => {
    if (!calField) return today;
    const value = draft[calField];
    return C.isIsoDate(value) ? value : today;
  }, [calField, draft, today]);

  const openSheet = useCallback(() => {
    setDraft({
      type: 'off',
      date: today,
      from: today,
      to: (C.addDays(today, 1) as string) || today,
      weekday: 1,
      note: '',
    });
    setError('');
    setEditing(true);
  }, [today]);

  // 日历选择器与新增表单是两个 Modal：iOS 上同时 present 会失败，
  // 因此先把表单收起，选完日期再展开（约 300ms 的过渡）。
  const openCalendar = useCallback((field: CalField) => {
    setEditing(false);
    setTimeout(() => setCalField(field), 300);
  }, []);

  const backToSheet = useCallback(() => {
    setCalField(null);
    setTimeout(() => setEditing(true), 300);
  }, []);

  const selectDate = useCallback((iso: string) => {
    setDraft((prev) => ({ ...prev, [calField || 'date']: iso }));
    setCalField(null);
    setTimeout(() => setEditing(true), 300);
  }, [calField]);

  const submit = useCallback(async () => {
    if (saving) return;
    setError('');
    setSaving(true);
    try {
      if (draft.type === 'swap') {
        if (!C.isIsoDate(draft.from) || !C.isIsoDate(draft.to)) {
          setError('请选择完整的两个日期');
          return;
        }
        if (draft.from === draft.to) {
          setError('对调的两个日期不能相同');
          return;
        }
        await addAdjustment({ type: 'swap', from: draft.from, to: draft.to });
      } else {
        if (!C.isIsoDate(draft.date)) {
          setError('请选择日期');
          return;
        }
        if (draft.type === 'off') {
          await addAdjustment({
            type: 'off',
            date: draft.date,
            note: draft.note.trim() || undefined,
          });
        } else {
          await addAdjustment({
            type: 'makeup',
            date: draft.date,
            weekday: draft.weekday,
            note: draft.note.trim() || undefined,
          });
        }
      }
      setEditing(false);
    } catch (err: any) {
      setError(err?.message || '添加失败，请重试');
    } finally {
      setSaving(false);
    }
  }, [addAdjustment, draft, saving]);

  const remove = useCallback(async (index: number) => {
    try {
      await removeAdjustment(index);
    } catch (err: any) {
      // 删除失败时保持列表原样即可，无需打断用户
    }
  }, [removeAdjustment]);

  return (
    <AppScreen edges={['top']}>
      <TopBar
        title="调休安排"
        subtitle={adjustments.length ? `已设置 ${adjustments.length} 条` : '放假 / 对调 / 补课'}
        onBack={() => router.back()}
      />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {error && !editing ? (
          <View style={[styles.errorBox, { backgroundColor: withAlpha(palette.danger, 0.1), borderColor: palette.danger }]}>
            <Text style={{ color: palette.danger, fontSize: 13 }}>{error}</Text>
          </View>
        ) : null}

        {adjustments.length === 0 ? (
          <Card>
            <Empty text="还没有调休安排" />
            <Text style={{ color: palette.ink3, fontSize: 12, lineHeight: 18, textAlign: 'center', paddingBottom: 8 }}>
              学校调整上课时间时，在这里登记放假、对调或补课{'\n'}周视图与提醒会自动跟着变化。
            </Text>
          </Card>
        ) : (
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {adjustments.map((adjustment, index) => (
              <View
                key={`adj-${index}-${adjustment.type}-${adjustment.date || adjustment.from || ''}`}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                  borderTopColor: palette.line,
                }}
              >
                <View
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    marginRight: 10,
                    backgroundColor: typeColor(adjustment.type, palette),
                  }}
                />
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={{ color: palette.ink, fontSize: 14, fontWeight: '500' }} numberOfLines={1}>
                    {rowTitle(adjustment)}
                  </Text>
                  <Text style={{ color: palette.ink3, fontSize: 11.5, marginTop: 2 }} numberOfLines={1}>
                    {rowSub(adjustment)}
                  </Text>
                </View>
                <Pressable onPress={() => remove(index)} hitSlop={10}>
                  <Text style={{ color: palette.danger, fontSize: 13 }}>删除</Text>
                </Pressable>
              </View>
            ))}
          </Card>
        )}

        <Text style={{ color: palette.ink4, fontSize: 11, lineHeight: 17, marginTop: 12 }}>
          放假优先于对调、补课；同一天被多条规则命中时，后加入的规则生效。
          {'\n'}调休只影响显示与提醒，不会修改原始课表。
        </Text>
      </ScrollView>

      <View
        style={[
          styles.bottomBar,
          {
            backgroundColor: palette.surface,
            borderTopColor: palette.line,
            paddingBottom: Math.max(10, insets.bottom),
          },
        ]}
      >
        <PrimaryButton label="＋ 新增调休" onPress={openSheet} style={{ flex: 1 }} />
      </View>

      <ModalSheet visible={editing} onClose={() => setEditing(false)} title="新增调休">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView style={{ maxHeight: 460 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={[styles.fieldLabel, { color: palette.ink3 }]}>类型</Text>
            <Chips
              options={TYPE_LABELS}
              selected={typeIndex < 0 ? 0 : typeIndex}
              onSelect={(index) => {
                setDraft((prev) => ({ ...prev, type: TYPE_VALUES[index] }));
                setError('');
              }}
            />

            {draft.type === 'off' ? (
              <View style={{ marginTop: 14 }}>
                <DateRow label="放假日期" value={fmtDate(draft.date)} onPress={() => openCalendar('date')} />
              </View>
            ) : null}

            {draft.type === 'swap' ? (
              <View style={{ marginTop: 14, gap: 10 }}>
                <DateRow label="原上课日期" value={fmtDate(draft.from)} onPress={() => openCalendar('from')} />
                <DateRow label="改到日期" value={fmtDate(draft.to)} onPress={() => openCalendar('to')} />
                <Text style={{ color: palette.ink4, fontSize: 11.5 }}>对调后两天的课程安排互换。</Text>
              </View>
            ) : null}

            {draft.type === 'makeup' ? (
              <View style={{ marginTop: 14 }}>
                <DateRow label="补课日期" value={fmtDate(draft.date)} onPress={() => openCalendar('date')} />
                <Text style={[styles.fieldLabel, { color: palette.ink3, marginTop: 14 }]}>按星期几上课</Text>
                <Chips
                  options={WEEKDAY_LABELS}
                  selected={draft.weekday - 1}
                  onSelect={(index) => setDraft((prev) => ({ ...prev, weekday: index + 1 }))}
                />
              </View>
            ) : null}

            <View style={{ marginTop: 14 }}>
              <Field
                label="备注（可留空）"
                value={draft.note}
                onChangeText={(value) => setDraft((prev) => ({ ...prev, note: value }))}
                placeholder="例如 国庆节 / 周六补周三课"
              />
            </View>

            {error ? (
              <Text style={{ color: palette.danger, fontSize: 12.5, marginBottom: 8 }}>{error}</Text>
            ) : null}

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
              <GhostButton label="取消" onPress={() => setEditing(false)} style={{ flex: 1 }} />
              <PrimaryButton
                label={saving ? '添加中…' : '添加'}
                onPress={submit}
                disabled={saving}
                style={{ flex: 1 }}
              />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </ModalSheet>

      <CalendarPicker
        visible={!!calField}
        initial={calInitial}
        onClose={backToSheet}
        onSelect={selectDate}
      />
    </AppScreen>
  );
}

export default AdjustScreen;

const styles = StyleSheet.create({
  content: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 28 },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  errorBox: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 10 },
  fieldLabel: {
    fontSize: 12,
    marginBottom: 6,
  },
});
