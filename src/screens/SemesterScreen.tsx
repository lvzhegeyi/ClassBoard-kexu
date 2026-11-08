import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
// @ts-ignore - 复用桌面端纯逻辑 core（schedule/model/weeks/util）
import * as C from '../core/index.js';
import { useStore } from '../store';
import { courseColor, useTheme, withAlpha, type Palette } from '../theme';
import { Loading, SectionTitle } from '../ui';

export interface SemesterScreenProps {
  onOpenWeek: (week: number) => void;
}

type WeekColorMap = number[][];

function sectionLabel(startSection: number, endSection: number): string {
  return startSection === endSection
    ? `第 ${startSection} 节`
    : `第 ${startSection}-${endSection} 节`;
}

function StatCard({
  value,
  unit,
  label,
  palette,
  tone,
}: {
  value: number | string;
  unit: string;
  label: string;
  palette: Palette;
  tone?: 'danger';
}) {
  return (
    <View
      style={[
        styles.statCard,
        { backgroundColor: palette.surface, borderColor: palette.line },
      ]}
    >
      <Text
        style={{
          color: tone === 'danger' ? palette.danger : palette.ink,
          fontSize: 22,
          fontWeight: '700',
          fontVariant: ['tabular-nums'],
        }}
      >
        {value}
        <Text style={{ color: palette.ink4, fontSize: 10.5, fontWeight: '500' }}> {unit}</Text>
      </Text>
      <Text style={{ color: palette.ink3, fontSize: 10.5, marginTop: 2 }}>{label}</Text>
    </View>
  );
}

function WeekMini({
  week,
  colors,
  isCurrent,
  isPast,
  palette,
  onPress,
}: {
  week: any;
  colors: WeekColorMap;
  isCurrent: boolean;
  isPast: boolean;
  palette: Palette;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.weekCard,
        {
          backgroundColor: isCurrent ? palette.accentSoft : palette.surface,
          borderColor: isCurrent ? palette.accent : palette.line,
          opacity: pressed ? 0.75 : isPast ? 0.62 : 1,
        },
        isCurrent && { borderWidth: 1.5 },
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
        <Text style={{ color: palette.ink, fontSize: 11.5, fontWeight: '600' }}>
          第 {week.week} 周
        </Text>
        <View style={{ flex: 1 }} />
        {isCurrent ? (
          <Text
            style={{
              color: palette.accentDeep,
              fontSize: 8.5,
              fontWeight: '700',
            }}
          >
            本周
          </Text>
        ) : null}
      </View>
      <Text style={{ color: palette.ink4, fontSize: 9.5, marginTop: 2 }}>{week.count} 节</Text>
      <View style={styles.miniDays}>
        {colors.map((dayColors, index) => (
          <View key={index} style={styles.miniDay}>
            {dayColors.length ? (
              dayColors.map((colorIndex, barIndex) => (
                <View
                  key={barIndex}
                  style={[styles.miniBar, { backgroundColor: withAlpha(courseColor(colorIndex), 0.72) }]}
                />
              ))
            ) : (
              <View style={[styles.miniBar, { backgroundColor: palette.line }]} />
            )}
          </View>
        ))}
      </View>
    </Pressable>
  );
}

export function SemesterScreen({ onOpenWeek }: SemesterScreenProps) {
  const { ready, state, now } = useStore();
  const { palette } = useTheme();

  const overview = useMemo(() => C.semesterOverview(state), [state]);
  const conflicts = useMemo(() => C.conflicts(state), [state]);
  const currentWeek = C.currentWeek(state, now);

  const startDate = state.termConfig.startDate;
  const weeks: any[] = overview?.weeks ?? [];
  const totalWeeks = Math.max(1, overview?.weekCount ?? state.termConfig.weekCount ?? 1);

  const totalCourses = (state.courses ?? []).filter((course) => !course.hidden).length;

  /** 每周 7 天的课程颜色（缩略色条），仅在 state 变化时重算 */
  const weekColors = useMemo(() => {
    const map: Record<number, WeekColorMap> = {};
    for (const week of weeks) {
      const days: WeekColorMap = [];
      for (let weekday = 1; weekday <= 7; weekday += 1) {
        const iso = C.dateOfWeekWeekday(week.week, weekday, startDate);
        const entries = C.resolveDay(state, iso).entries as any[];
        days.push(entries.slice(0, 3).map((entry) => Number(entry.color) || 0));
      }
      map[week.week] = days;
    }
    return map;
  }, [state, weeks, startDate]);

  /** 冲突去重：同一排法按周合并 */
  const conflictPatterns = useMemo(() => {
    const map = new Map<
      string,
      { weekday: number; startSection: number; endSection: number; courses: string[]; weeks: number }
    >();
    for (const item of conflicts as any[]) {
      const courses = [...(item.courses ?? [])].sort();
      const key = `${item.weekday}|${item.startSection}|${item.endSection}|${courses.join('|')}`;
      const prev = map.get(key);
      if (prev) prev.weeks += 1;
      else {
        map.set(key, {
          weekday: item.weekday,
          startSection: item.startSection,
          endSection: item.endSection,
          courses,
          weeks: 1,
        });
      }
    }
    return [...map.values()];
  }, [conflicts]);

  if (!ready) return <Loading />;

  const weekIndex = currentWeek.status === 'in' ? Math.min(Math.max(currentWeek.week, 0), totalWeeks) : 0;
  const percent = Math.round((weekIndex / totalWeeks) * 100);
  const progressText =
    currentWeek.status === 'before'
      ? '尚未开学'
      : currentWeek.status === 'after'
        ? '学期已结束'
        : `第 ${currentWeek.week} / ${totalWeeks} 周`;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: palette.paper }}
      contentContainerStyle={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 32 }}
      showsVerticalScrollIndicator={false}
    >
      {/* 4 统计卡 */}
      <View style={styles.statRow}>
        <StatCard value={totalCourses} unit="门" label="本学期课程" palette={palette} />
        <StatCard value={overview?.totalOccurrences ?? 0} unit="节" label="总课次" palette={palette} />
        <StatCard value={totalWeeks} unit="周" label="教学周数" palette={palette} />
        <StatCard value={conflicts.length} unit="处" label="时间冲突" palette={palette} tone="danger" />
      </View>

      {/* 学期进度 */}
      <View
        style={[
          styles.progressCard,
          { backgroundColor: palette.surface, borderColor: palette.line },
        ]}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ color: palette.ink2, fontSize: 12, fontWeight: '500' }}>{progressText}</Text>
          <View style={{ flex: 1 }} />
          <Text style={{ color: palette.ink4, fontSize: 10.5 }}>{percent}%</Text>
        </View>
        <View style={[styles.progressTrack, { backgroundColor: palette.paperDeep }]}>
          <View
            style={{
              width: `${percent}%`,
              height: 4,
              borderRadius: 2,
              backgroundColor: palette.accent,
            }}
          />
        </View>
        <Text style={{ color: palette.ink4, fontSize: 10, marginTop: 5 }}>
          {state.meta?.term?.label || '本学期'} · 第 1 周 {startDate} 开学
        </Text>
      </View>

      {/* 教学周缩略 */}
      <SectionTitle right={<Text style={{ color: palette.ink4, fontSize: 10.5 }}>点按查看该周</Text>}>
        教学周
      </SectionTitle>
      <View style={styles.weekGrid}>
        {weeks.map((week: any) => (
          <WeekMini
            key={week.week}
            week={week}
            colors={weekColors[week.week] ?? []}
            isCurrent={currentWeek.status === 'in' && week.week === currentWeek.week}
            isPast={currentWeek.status === 'in' && week.week < currentWeek.week}
            palette={palette}
            onPress={() => onOpenWeek(week.week)}
          />
        ))}
      </View>

      {/* 冲突检查 */}
      <SectionTitle
        right={
          conflicts.length ? (
            <Text style={{ color: palette.danger, fontSize: 10.5, fontWeight: '600' }}>
              {conflicts.length} 处
            </Text>
          ) : null
        }
      >
        冲突检查
      </SectionTitle>
      <View style={[styles.conflictCard, { backgroundColor: palette.surface, borderColor: palette.line }]}>
        {conflictPatterns.length === 0 ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
            <View style={[styles.okDot, { backgroundColor: palette.accent }]} />
            <Text style={{ color: palette.ink3, fontSize: 12 }}>没有时间冲突，课表排得很清爽</Text>
          </View>
        ) : (
          conflictPatterns.slice(0, 6).map((item, index) => (
            <View
              key={`${item.weekday}-${item.startSection}-${item.endSection}-${index}`}
              style={[
                styles.conflictRow,
                index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line },
              ]}
            >
              <View style={[styles.conflictDot, { backgroundColor: palette.danger }]} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: palette.ink2, fontSize: 12, fontWeight: '600' }}>
                  {C.weekdayName(item.weekday)} · {sectionLabel(item.startSection, item.endSection)}
                </Text>
                <Text style={{ color: palette.ink3, fontSize: 11, marginTop: 1 }} numberOfLines={2}>
                  {item.courses.join(' / ')}
                  {item.weeks > 1 ? ` · 连续 ${item.weeks} 周` : ''}
                </Text>
              </View>
            </View>
          ))
        )}
        {conflictPatterns.length > 6 ? (
          <Text style={{ color: palette.ink4, fontSize: 10.5, marginTop: 6 }}>
            还有 {conflictPatterns.length - 6} 种排法未展开
          </Text>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  statRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  statCard: {
    width: '48%',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  progressCard: {
    marginTop: 12,
    borderRadius: 14,
    borderWidth: 1,
    padding: 13,
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: 9,
  },
  weekGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  weekCard: {
    width: '31.5%',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  miniDays: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    height: 14,
    marginTop: 7,
  },
  miniDay: {
    flex: 1,
    justifyContent: 'flex-end',
    gap: 1.5,
    height: '100%',
  },
  miniBar: {
    height: 3,
    borderRadius: 1.5,
  },
  conflictCard: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  conflictRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 7,
  },
  conflictDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 5,
  },
  okDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
});

export default SemesterScreen;
