import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
// @ts-ignore - 复用桌面端纯逻辑 core（schedule/model/weeks/util）
import * as C from '../core/index.js';
import { useStore } from '../store';
import { courseColor, useTheme, withAlpha, type Palette } from '../theme';
import { GhostButton, Loading, ModalSheet, PrimaryButton } from '../ui';
import type { Course } from '../types';

export interface WeekScreenProps {
  week: number;
  onWeekChange: (week: number) => void;
  onEdit?: (course: Course) => void;
}

const HEADER_H = 34;
const TIME_W = 46;
const HAIR = StyleSheet.hairlineWidth;

type ShowFields = {
  name: boolean;
  teacher: boolean;
  room: boolean;
  time: boolean;
  category: boolean;
  credit: boolean;
};

function sectionLabel(startSection: number, endSection: number): string {
  return startSection === endSection
    ? `第 ${startSection} 节`
    : `第 ${startSection}-${endSection} 节`;
}

/** 同一天内课程按节次排布：重叠时并排（冲突） */
function layoutEntries(entries: any[]): { entry: any; lane: number; lanes: number; span: number }[] {
  const items = (entries ?? [])
    .map((entry) => ({
      entry,
      lane: 0,
      lanes: 1,
      span: Math.max(1, (entry.endSection ?? 1) - (entry.startSection ?? 1) + 1),
    }))
    .sort(
      (a, b) =>
        (a.entry.startSection ?? 0) - (b.entry.startSection ?? 0) ||
        (a.entry.endSection ?? 0) - (b.entry.endSection ?? 0),
    );

  const out: { entry: any; lane: number; lanes: number; span: number }[] = [];
  let cluster: typeof items = [];
  let clusterEnd = 0;

  const flush = () => {
    if (!cluster.length) return;
    const laneEnds: number[] = [];
    for (const it of cluster) {
      let lane = laneEnds.findIndex((end) => end < (it.entry.startSection ?? 1));
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(it.entry.endSection ?? it.entry.startSection ?? 1);
      } else {
        laneEnds[lane] = it.entry.endSection ?? it.entry.startSection ?? 1;
      }
      it.lane = lane;
    }
    const lanes = Math.max(1, laneEnds.length);
    for (const it of cluster) {
      it.lanes = lanes;
      out.push(it);
    }
    cluster = [];
    clusterEnd = 0;
  };

  for (const it of items) {
    if (cluster.length && (it.entry.startSection ?? 1) > clusterEnd) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.entry.endSection ?? it.entry.startSection ?? 1);
  }
  flush();
  return out;
}

function DayHeader({
  day,
  palette,
  isWeekend,
}: {
  day: any;
  palette: Palette;
  isWeekend: boolean;
}) {
  const isToday = Boolean(day.isToday);
  const badge = day.kind === 'off' ? '休' : day.kind === 'makeup' ? '补' : '';
  return (
    <View style={[styles.dayHeader, { borderLeftColor: palette.line }]}>
      <Text
        style={{
          color: isToday ? palette.accentDeep : isWeekend ? palette.ink4 : palette.ink3,
          fontSize: 10.5,
          fontWeight: isToday ? '700' : '500',
        }}
        numberOfLines={1}
      >
        {isToday ? '今天' : day.weekdayName}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
        <Text
          style={{
            color: isToday ? palette.accentDeep : palette.ink2,
            fontSize: 13,
            fontWeight: '600',
            fontVariant: ['tabular-nums'],
          }}
        >
          {Number(String(day.iso).slice(8, 10))}
        </Text>
        {badge ? (
          <Text
            style={{
              color: day.kind === 'off' ? palette.danger : palette.accent,
              fontSize: 8,
              fontWeight: '700',
            }}
          >
            {badge}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function CourseBlock({
  item,
  rowH,
  fontScale,
  mode,
  show,
  palette,
  onPress,
}: {
  item: { entry: any; lane: number; lanes: number; span: number };
  rowH: number;
  fontScale: number;
  mode: 0 | 1;
  show: ShowFields;
  palette: Palette;
  onPress: () => void;
}) {
  const { entry, lane, lanes, span } = item;
  const course = entry.course ?? {};
  const color = courseColor(entry.color ?? course.color ?? 0);
  const height = span * rowH - 2;
  const baseName = mode === 0 ? 9.5 : 10.5;
  const nameSize = Math.min(15, Math.max(8, baseName * fontScale));
  const metaSize = Math.max(7, nameSize - 2);
  const title = show.name ? course.name : course.room || '课程';

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.blockWrap,
        {
          top: (entry.startSection ?? 1) * rowH - rowH + 1,
          height,
          left: `${(lane / lanes) * 100}%`,
          width: `${100 / lanes}%`,
        },
      ]}
    >
      <View
        style={[
          styles.block,
          {
            backgroundColor: withAlpha(color, palette.isDark ? 0.22 : 0.13),
            borderColor: withAlpha(color, palette.isDark ? 0.42 : 0.3),
            borderLeftColor: color,
          },
        ]}
      >
        <Text
          numberOfLines={2}
          style={{ color: palette.ink, fontSize: nameSize, fontWeight: '600', lineHeight: nameSize * 1.25 }}
        >
          {title}
        </Text>
        {height >= 40 && show.room && (entry.room || course.room) ? (
          <Text numberOfLines={1} style={{ color: palette.ink2, fontSize: metaSize, marginTop: 1 }}>
            {entry.room || course.room}
          </Text>
        ) : null}
        {height >= 54 && show.teacher && (entry.teacher || course.teacher) ? (
          <Text numberOfLines={1} style={{ color: palette.ink3, fontSize: metaSize, marginTop: 1 }}>
            {entry.teacher || course.teacher}
          </Text>
        ) : null}
        {height >= 68 && show.category && course.category ? (
          <Text numberOfLines={1} style={{ color: palette.ink4, fontSize: metaSize, marginTop: 1 }}>
            {course.category}
            {show.credit && course.credit != null ? ` · ${course.credit} 学分` : ''}
          </Text>
        ) : height >= 68 && show.credit && course.credit != null ? (
          <Text numberOfLines={1} style={{ color: palette.ink4, fontSize: metaSize, marginTop: 1 }}>
            {course.credit} 学分
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export function WeekScreen({ week, onWeekChange, onEdit }: WeekScreenProps) {
  const { ready, state, now } = useStore();
  const { palette } = useTheme();
  const router = useRouter();

  const settings = state.settings;
  const show: ShowFields = settings.showFields;
  const fontScale = Math.min(1.6, Math.max(0.8, Number(settings.weekFontScale) || 1));
  const mode: 0 | 1 = settings.weekViewMode === 1 ? 1 : 0;
  const sectionCount = Math.max(1, state.termConfig.sections.length);

  const grid = useMemo(
    () => C.weekGrid(state, week, { weekdayStart: settings.weekdayStart }),
    [state, week, settings.weekdayStart],
  );
  const days: any[] = grid?.days ?? [];
  const sections: any[] = state.termConfig.sections;

  const [box, setBox] = useState({ width: 0, height: 0 });
  const [detail, setDetail] = useState<{ course: Course; entry: any } | null>(null);

  const widthRef = useRef(0);
  const translateX = useRef(new Animated.Value(0)).current;

  const availableH = Math.max(240, box.height - HEADER_H - 12);
  const rowH =
    mode === 0
      ? Math.max(36, availableH / sectionCount)
      : Math.max(56, Math.round(68 * fontScale));
  const bodyH = rowH * sectionCount;
  const maxShift = Math.max(80, (box.width || 320) * 0.4);

  const handleLayout = useCallback((event: any) => {
    const { width, height } = event.nativeEvent.layout;
    widthRef.current = width;
    setBox((prev) =>
      Math.abs(prev.width - width) > 0.5 || Math.abs(prev.height - height) > 0.5 ? { width, height } : prev,
    );
  }, []);

  const springBack = useCallback(() => {
    Animated.spring(translateX, { toValue: 0, useNativeDriver: true, friction: 8, tension: 80 }).start();
  }, [translateX]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_evt, gesture) =>
          Math.abs(gesture.dx) > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.8,
        onPanResponderMove: (_evt, gesture) => {
          translateX.setValue(Math.max(-maxShift, Math.min(maxShift, gesture.dx)));
        },
        onPanResponderRelease: (_evt, gesture) => {
          const width = widthRef.current || 320;
          const threshold = Math.min(64, width * 0.16);
          if (Math.abs(gesture.dx) < threshold) {
            springBack();
            return;
          }
          const dir = gesture.dx > 0 ? -1 : 1; // 右滑=上一周
          const total = Number(state.termConfig.weekCount) || 20;
          const target = Math.min(total, Math.max(1, week + dir));
          if (target === week) {
            springBack();
            return;
          }
          const out = dir > 0 ? -maxShift : maxShift;
          const back = dir > 0 ? maxShift * 0.6 : -maxShift * 0.6;
          Animated.timing(translateX, {
            toValue: out,
            duration: 150,
            useNativeDriver: true,
          }).start(({ finished }) => {
            if (!finished) return;
            onWeekChange(target);
            translateX.setValue(back);
            Animated.timing(translateX, {
              toValue: 0,
              duration: 190,
              useNativeDriver: true,
            }).start();
          });
        },
        onPanResponderTerminate: springBack,
      }),
    [maxShift, onWeekChange, springBack, state.termConfig.weekCount, translateX, week],
  );

  const handleEdit = useCallback(
    (course: Course) => {
      setDetail(null);
      if (onEdit) onEdit(course);
      else router.push({ pathname: '/course-edit', params: { id: course.id } });
    },
    [onEdit, router],
  );

  if (!ready) return <Loading />;

  const gridBody = (
    <View style={{ flexDirection: 'row', height: bodyH }}>
      {/* 时间列：节次 / 开始 / 结束 */}
      <View style={{ width: TIME_W }}>
        {sections.map((section: any, index: number) => (
          <View
            key={section.index ?? index}
            style={[
              styles.timeCell,
              {
                height: rowH,
                borderTopColor: palette.line,
                borderTopWidth: index === 0 ? 0 : HAIR,
              },
            ]}
          >
            <Text
              style={{
                color: palette.ink3,
                fontSize: Math.min(11, Math.max(7, 8.5 * fontScale)),
                fontWeight: '600',
              }}
            >
              {section.index}
            </Text>
            <Text
              style={{
                color: palette.ink4,
                fontSize: Math.min(10, Math.max(7, 7.5 * fontScale)),
                fontVariant: ['tabular-nums'],
              }}
            >
              {section.start}
            </Text>
            <Text
              style={{
                color: palette.ink4,
                fontSize: Math.min(9, Math.max(6, 6.5 * fontScale)),
                fontVariant: ['tabular-nums'],
              }}
            >
              {section.end}
            </Text>
          </View>
        ))}
      </View>

      {/* 7 天 */}
      {days.map((day: any) => (
        <View
          key={day.iso}
          style={[
            styles.dayColumn,
            {
              borderLeftColor: palette.line,
              backgroundColor: day.isToday ? palette.accentSoft : 'transparent',
            },
          ]}
        >
          {sections.map((section: any, index: number) => (
            <View
              key={section.index ?? index}
              style={[
                styles.slotCell,
                {
                  height: rowH,
                  borderTopColor: palette.line,
                  borderTopWidth: index === 0 ? 0 : HAIR,
                },
              ]}
            />
          ))}
          {layoutEntries(day.entries ?? []).map((item, index) => (
            <CourseBlock
              key={`${item.entry.course?.id ?? item.entry.course?.name}-${item.entry.startSection}-${index}`}
              item={item}
              rowH={rowH}
              fontScale={fontScale}
              mode={mode}
              show={show}
              palette={palette}
              onPress={() => setDetail({ course: item.entry.course, entry: item.entry })}
            />
          ))}
        </View>
      ))}
    </View>
  );

  return (
    <View
      style={{ flex: 1, backgroundColor: palette.paper, paddingHorizontal: 10, paddingTop: 8 }}
      onLayout={handleLayout}
    >
      <Animated.View
        style={{ flex: 1, transform: [{ translateX }] }}
        {...panResponder.panHandlers}
      >
        {/* 星期表头（不显示周次/箭头） */}
        <View style={{ height: HEADER_H, flexDirection: 'row' }}>
          <View style={{ width: TIME_W }} />
          {days.map((day: any) => (
            <DayHeader
              key={day.iso}
              day={day}
              palette={palette}
              isWeekend={Number(day.weekday) >= 6}
            />
          ))}
        </View>

        {mode === 1 ? (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 24 }}
            showsVerticalScrollIndicator={false}
          >
            {gridBody}
          </ScrollView>
        ) : (
          <View style={{ flex: 1, overflow: 'hidden' }}>{gridBody}</View>
        )}

        {grid.totalEntries === 0 ? (
          <View pointerEvents="none" style={styles.emptyOverlay}>
            <Text style={{ color: palette.ink3, fontSize: 12.5 }}>这一周没有课</Text>
          </View>
        ) : null}
      </Animated.View>

      <ModalSheet
        visible={Boolean(detail)}
        onClose={() => setDetail(null)}
        title="课程详情"
        centered
      >
        {detail ? (
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  backgroundColor: courseColor(detail.entry?.color ?? detail.course.color ?? 0),
                }}
              />
              <Text style={{ color: palette.ink, fontSize: 18, fontWeight: '700', flex: 1 }} numberOfLines={2}>
                {detail.course.name}
              </Text>
            </View>

            {(detail.course.category || detail.course.credit != null) ? (
              <Text style={{ color: palette.ink3, fontSize: 12, marginTop: 6 }}>
                {[detail.course.category, detail.course.credit != null ? `${detail.course.credit} 学分` : '']
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            ) : null}

            <View style={{ marginTop: 12, gap: 8 }}>
              {(detail.course.slots ?? []).map((slot: any, index: number) => (
                <View
                  key={`${slot.weekday}-${slot.startSection}-${index}`}
                  style={{
                    backgroundColor: palette.paperDeep,
                    borderRadius: 10,
                    paddingHorizontal: 10,
                    paddingVertical: 8,
                  }}
                >
                  <Text style={{ color: palette.ink, fontSize: 13, fontWeight: '600' }}>
                    {C.weekdayName(slot.weekday)} · {sectionLabel(slot.startSection, slot.endSection)}
                  </Text>
                  <Text style={{ color: palette.ink3, fontSize: 11.5, marginTop: 2 }}>
                    {[
                      C.formatWeeks(slot.weeks ?? []),
                      slot.room || detail.course.room,
                      slot.teacher || detail.course.teacher,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </View>
              ))}
            </View>

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
              <GhostButton label="关闭" onPress={() => setDetail(null)} style={{ flex: 1 }} />
              <PrimaryButton
                label="编辑"
                onPress={() => handleEdit(detail.course)}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        ) : null}
      </ModalSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  dayHeader: {
    flex: 1,
    borderLeftWidth: HAIR,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeCell: {
    paddingRight: 3,
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
    paddingTop: 2,
  },
  dayColumn: {
    flex: 1,
    position: 'relative',
    borderLeftWidth: HAIR,
  },
  slotCell: {
    borderTopWidth: 0,
  },
  blockWrap: {
    position: 'absolute',
    padding: 1,
  },
  block: {
    flex: 1,
    borderRadius: 6,
    borderWidth: 1,
    borderLeftWidth: 3,
    paddingHorizontal: 4,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  emptyOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '46%',
    alignItems: 'center',
  },
});

export default WeekScreen;
