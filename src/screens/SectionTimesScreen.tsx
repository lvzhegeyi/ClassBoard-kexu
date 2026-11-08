import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../store';
import { useTheme, withAlpha } from '../theme';
import { AppScreen, Card, GhostButton, PrimaryButton, TopBar } from '../ui';
import { TimePicker } from '../pickers';
import type { SectionTime } from '../types';
// @ts-ignore - core 纯函数（时间解析 / 默认节次）
import * as C from '../core/index.js';

type PickerTarget = { index: number; field: 'start' | 'end' } | null;

/** core.parseHm 对非法输入返回 null，这里统一折算成分钟数（非法按 0 处理，便于校验） */
function minutesOf(value: string): number {
  const parsed = C.parseHm(value);
  return parsed == null ? 0 : Number(parsed);
}

export function SectionTimesScreen() {
  const router = useRouter();
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();
  const { state, updateSections } = useStore();

  const [sections, setSections] = useState<SectionTime[]>(() => {
    const base = state.termConfig.sections?.length
      ? state.termConfig.sections
      : (C.DEFAULT_SECTIONS as SectionTime[]);
    return base.map((s) => ({ ...s }));
  });
  const [picker, setPicker] = useState<PickerTarget>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const invalidIndexes = useMemo(() => {
    const invalid = new Set<number>();
    for (const section of sections) {
      if (minutesOf(section.end) <= minutesOf(section.start)) invalid.add(section.index);
    }
    return invalid;
  }, [sections]);

  const pickerSection = picker ? sections.find((s) => s.index === picker.index) : undefined;
  const pickerInitial = picker && pickerSection ? pickerSection[picker.field] : '08:00';

  const applyTime = useCallback((time: string) => {
    if (!picker) return;
    setSections((prev) => prev.map((section) => (
      section.index === picker.index ? { ...section, [picker.field]: time } : section
    )));
    setPicker(null);
    setError('');
  }, [picker]);

  const restoreDefaults = useCallback(() => {
    setSections((C.DEFAULT_SECTIONS as SectionTime[]).map((s) => ({ ...s })));
    setError('');
  }, []);

  const save = useCallback(async () => {
    if (saving) return;
    const bad = sections.find((section) => minutesOf(section.end) <= minutesOf(section.start));
    if (bad) {
      setError(`第 ${bad.index} 节的结束时间必须晚于开始时间`);
      return;
    }
    setSaving(true);
    setError('');
    try {
      await updateSections(sections.map((section) => ({
        index: section.index,
        start: section.start,
        end: section.end,
        period: section.period || C.periodOfSection(section.index),
      })));
      router.back();
    } catch (err: any) {
      setError(err?.message || '保存失败，请重试');
    } finally {
      setSaving(false);
    }
  }, [router, saving, sections, updateSections]);

  return (
    <AppScreen edges={['top']}>
      <TopBar title="节次时间" subtitle="点击时间即可修改" onBack={() => router.back()} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {error ? (
          <View style={[styles.errorBox, { backgroundColor: withAlpha(palette.danger, 0.1), borderColor: palette.danger }]}>
            <Text style={{ color: palette.danger, fontSize: 13 }}>{error}</Text>
          </View>
        ) : null}

        <Text style={{ color: palette.ink3, fontSize: 12, lineHeight: 18, marginBottom: 10 }}>
          每节课的起止时间会用于「下一节」倒计时与课前提醒。结束时间必须晚于开始时间。
        </Text>

        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {sections.map((section, index) => {
            const invalid = invalidIndexes.has(section.index);
            const minutes = minutesOf(section.end) - minutesOf(section.start);
            const period = section.period || C.periodOfSection(section.index);
            return (
              <View
                key={section.index}
                style={{
                  borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                  borderTopColor: palette.line,
                }}
              >
                <View style={styles.row}>
                  <View style={{ width: 54 }}>
                    <Text style={{ color: palette.ink, fontSize: 14, fontWeight: '600' }}>第 {section.index} 节</Text>
                    <Text style={{ color: palette.ink4, fontSize: 10.5, marginTop: 1 }}>{period}</Text>
                  </View>
                  <View style={{ flex: 1 }} />
                  <Pressable
                    onPress={() => setPicker({ index: section.index, field: 'start' })}
                    style={({ pressed }) => [
                      styles.timeBtn,
                      {
                        backgroundColor: pressed ? palette.accentSoft : palette.paperDeep,
                        borderColor: invalid ? palette.danger : palette.line,
                      },
                    ]}
                  >
                    <Text style={[styles.timeText, { color: palette.ink }]}>{section.start}</Text>
                  </Pressable>
                  <Text style={{ color: palette.ink4, fontSize: 14, marginHorizontal: 7 }}>–</Text>
                  <Pressable
                    onPress={() => setPicker({ index: section.index, field: 'end' })}
                    style={({ pressed }) => [
                      styles.timeBtn,
                      {
                        backgroundColor: pressed ? palette.accentSoft : palette.paperDeep,
                        borderColor: invalid ? palette.danger : palette.line,
                      },
                    ]}
                  >
                    <Text style={[styles.timeText, { color: palette.ink }]}>{section.end}</Text>
                  </Pressable>
                  <Text style={{ width: 52, textAlign: 'right', color: palette.ink4, fontSize: 10.5 }}>
                    {minutes > 0 ? `${minutes} 分` : '—'}
                  </Text>
                </View>
                {invalid ? (
                  <Text style={{ color: palette.danger, fontSize: 11.5, paddingHorizontal: 14, paddingBottom: 8 }}>
                    结束时间必须晚于开始时间
                  </Text>
                ) : null}
              </View>
            );
          })}
        </Card>

        <Text style={{ color: palette.ink4, fontSize: 11, marginTop: 10, lineHeight: 16 }}>
          「恢复默认」会填入文华学院正方教务的标准节次，点保存后才会写入本机。
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
        <GhostButton label="恢复默认" onPress={restoreDefaults} style={styles.barBtn} />
        <View style={{ flex: 1 }} />
        <PrimaryButton
          label={saving ? '保存中…' : '保存'}
          onPress={save}
          disabled={saving}
          style={styles.barPrimary}
        />
      </View>

      <TimePicker
        visible={!!picker}
        initial={pickerInitial}
        onClose={() => setPicker(null)}
        onSelect={applyTime}
      />
    </AppScreen>
  );
}

export default SectionTimesScreen;

const styles = StyleSheet.create({
  content: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 28 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 11 },
  timeBtn: {
    minWidth: 68,
    borderRadius: 9,
    borderWidth: 1,
    paddingVertical: 7,
    alignItems: 'center',
  },
  timeText: {
    fontSize: 15,
    fontVariant: ['tabular-nums'],
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
  errorBox: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 10 },
});
