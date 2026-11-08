import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  Empty,
  GhostButton,
  Loading,
  ModalSheet,
  PrimaryButton,
  SectionTitle,
} from '../ui';
import type { Course, FloatingCourse } from '../types';

/* ------------------------------ 展示工具 ------------------------------ */
type ShowFields = {
  name: boolean;
  teacher: boolean;
  room: boolean;
  time: boolean;
  category: boolean;
  credit: boolean;
};

function fmtMonthDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? `${Number(m[2])}月${Number(m[3])}日` : iso;
}

function sectionLabel(startSection: number, endSection: number): string {
  return startSection === endSection
    ? `第 ${startSection} 节`
    : `第 ${startSection}-${endSection} 节`;
}

/** 无固定时间课程颜色：优先自带 color，否则按名称稳定取色 */
function floatingColor(item: any): number {
  if (Number.isInteger(item?.color)) return item.color;
  const name = String(item?.name ?? '');
  let h = 5381;
  for (let i = 0; i < name.length; i += 1) h = ((h << 5) + h + name.charCodeAt(i)) >>> 0;
  return h % 10;
}

function floatingKey(item: any): string {
  return `${item?.name ?? ''}|${item?.teacher ?? ''}|${(item?.weeks ?? []).join(',')}`;
}

function timeOfDay(now: Date): number {
  return now.getHours() * 60 + now.getMinutes();
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/* ------------------------------ 小部件 -------------------------------- */
function MetaLine({
  entry,
  show,
  palette,
  numberOfLines = 1,
  fontSize = 11.5,
}: {
  entry: any;
  show: ShowFields;
  palette: Palette;
  numberOfLines?: number;
  fontSize?: number;
}) {
  const course = entry?.course ?? {};
  const parts: string[] = [];
  const room = entry?.room || course.room;
  const teacher = entry?.teacher || course.teacher;
  if (show.room && room) parts.push(room);
  if (show.teacher && teacher) parts.push(teacher);
  if (show.category && course.category) parts.push(course.category);
  if (show.credit && course.credit != null) parts.push(`${course.credit} 学分`);
  if (!parts.length) return null;
  return (
    <Text style={{ color: palette.ink3, fontSize }} numberOfLines={numberOfLines}>
      {parts.join(' · ')}
    </Text>
  );
}

/* --------------------------- 当前 / 下一节大卡 -------------------------- */
function HeroCard({
  state,
  day,
  now,
  todayIso,
  palette,
}: {
  state: any;
  day: any;
  now: Date;
  todayIso: string;
  palette: Palette;
}) {
  const running = day.running as any | null;
  const next = day.next as any | null;
  const future = !running && !next ? (C.nextOccurrence(state, now) as any | null) : null;

  let label = '今天已无课';
  let name = '今天没有排课';
  let timeText = '';
  let metaText = '';
  let progress: number | null = null;
  let countdown = '';
  let color = palette.accent;

  if (running) {
    label = '正在上课';
    name = running.course?.name ?? '课程';
    color = courseColor(running.color ?? 0);
    const startMin = Number(running.startMin) || 0;
    const endMin = Number(running.endMin) || startMin + 45;
    const nowMin = timeOfDay(now);
    progress = clamp01((nowMin - startMin) / Math.max(1, endMin - startMin));
    countdown = `还剩 ${Math.max(0, endMin - nowMin)} 分钟`;
    timeText = `${running.start} – ${running.end} · ${sectionLabel(running.startSection, running.endSection)}`;
    metaText = [running.room || running.course?.room, running.teacher || running.course?.teacher]
      .filter(Boolean)
      .join(' · ');
  } else if (next) {
    label = '下一节';
    name = next.course?.name ?? '课程';
    color = courseColor(next.color ?? 0);
    const mins = Math.max(0, Math.round(Number(next.minutesUntil) || 0));
    progress = Math.min(0.94, Math.max(0.06, 1 - mins / 120));
    countdown = mins <= 0 ? '即将开始' : `还有 ${mins} 分钟`;
    timeText = `${next.start} – ${next.end} · ${sectionLabel(next.startSection, next.endSection)}`;
    metaText = [next.room || next.course?.room, next.teacher || next.course?.teacher]
      .filter(Boolean)
      .join(' · ');
  } else if (future) {
    label = '下一节课';
    name = future.course?.name ?? '课程';
    color = courseColor(future.color ?? 0);
    const iso: string = future.iso || todayIso;
    const diff: number = C.diffDays(iso, todayIso);
    const when = diff === 1 ? '明天' : diff > 1 && diff < 7 ? C.weekdayName(C.isoWeekday(iso)) : fmtMonthDay(iso);
    countdown = `${when} ${future.start}`;
    timeText = `${future.start} – ${future.end} · ${sectionLabel(future.startSection, future.endSection)}`;
    metaText = [future.room || future.course?.room, future.teacher || future.course?.teacher]
      .filter(Boolean)
      .join(' · ');
  }

  return (
    <View
      style={[
        styles.hero,
        {
          backgroundColor: palette.surface,
          borderColor: withAlpha(color, palette.isDark ? 0.5 : 0.3),
        },
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View
          style={[
            styles.heroPill,
            {
              backgroundColor: withAlpha(color, palette.isDark ? 0.22 : 0.14),
              borderColor: withAlpha(color, 0.4),
            },
          ]}
        >
          <View style={[styles.heroDot, { backgroundColor: color }]} />
          <Text style={{ color: palette.ink2, fontSize: 11, fontWeight: '600' }}>{label}</Text>
        </View>
        <View style={{ flex: 1 }} />
        {countdown ? (
          <Text style={{ color: palette.accentDeep, fontSize: 11.5, fontWeight: '600' }}>{countdown}</Text>
        ) : null}
      </View>

      <Text style={{ color: palette.ink, fontSize: 22, fontWeight: '700', marginTop: 10 }} numberOfLines={2}>
        {name}
      </Text>
      {timeText ? (
        <Text style={{ color: palette.ink2, fontSize: 12.5, marginTop: 5 }}>{timeText}</Text>
      ) : null}
      {metaText ? (
        <Text style={{ color: palette.ink3, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
          {metaText}
        </Text>
      ) : null}

      {progress != null ? (
        <View style={[styles.track, { backgroundColor: palette.paperDeep }]}>
          <View
            style={[styles.trackFill, { width: `${Math.round(clamp01(progress) * 100)}%`, backgroundColor: color }]}
          />
        </View>
      ) : null}
    </View>
  );
}

/* ------------------------------ 今日课程行 ----------------------------- */
function TodayRow({
  entry,
  show,
  palette,
  isNext,
  onPress,
}: {
  entry: any;
  show: ShowFields;
  palette: Palette;
  isNext: boolean;
  onPress: () => void;
}) {
  const color = courseColor(entry.color ?? entry.course?.color ?? 0);
  const past = Boolean(entry.finished);
  const isNow = Boolean(entry.running);
  const course = entry.course ?? {};
  const title = show.name ? course.name : course.room || '课程';

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, { opacity: past ? 0.55 : pressed ? 0.75 : 1 }]}
    >
      {show.time ? (
        <View style={styles.rowTime}>
          <Text style={[styles.rowTimeStart, { color: past ? palette.ink4 : palette.ink2 }]}>{entry.start}</Text>
          <Text style={[styles.rowTimeEnd, { color: palette.ink4 }]}>{entry.end}</Text>
        </View>
      ) : null}

      <View
        style={[
          styles.rowCard,
          {
            backgroundColor: withAlpha(color, palette.isDark ? 0.16 : 0.1),
            borderColor: withAlpha(color, palette.isDark ? 0.4 : 0.26),
          },
          isNow && { borderColor: withAlpha(color, 0.75), borderWidth: 1.5 },
        ]}
      >
        <View style={[styles.rowBar, { backgroundColor: color }]} />
        <View style={{ flex: 1, paddingLeft: 9 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={[styles.rowName, { color: palette.ink }]} numberOfLines={2}>
              {title}
            </Text>
            <View style={{ flex: 1 }} />
            {isNow ? (
              <Text style={[styles.badge, { color: palette.accentDeep, backgroundColor: palette.accentSoft }]}>
                进行中
              </Text>
            ) : isNext ? (
              <Text style={[styles.badge, { color }]}>下一节</Text>
            ) : null}
          </View>
          <MetaLine entry={entry} show={show} palette={palette} />
          <Text style={{ color: palette.ink4, fontSize: 10, marginTop: 3 }}>
            {sectionLabel(entry.startSection, entry.endSection)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

/* --------------------------- 无固定时间课程卡 -------------------------- */
function FloatingRow({
  item,
  palette,
  completing,
  onRequestComplete,
  onCompleted,
}: {
  item: any;
  palette: Palette;
  completing: boolean;
  onRequestComplete: () => void;
  onCompleted: () => void;
}) {
  const color = courseColor(floatingColor(item));
  const translateX = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const doneRef = useRef(onCompleted);
  doneRef.current = onCompleted;

  useEffect(() => {
    if (!completing) return;
    Animated.parallel([
      Animated.timing(scale, { toValue: 0.86, duration: 180, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (finished) doneRef.current();
    });
  }, [completing, scale, opacity]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_evt, gesture) =>
          Math.abs(gesture.dx) > 10 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.6,
        onPanResponderMove: (_evt, gesture) => {
          translateX.setValue(Math.max(-96, Math.min(0, gesture.dx)));
        },
        onPanResponderRelease: (_evt, gesture) => {
          if (gesture.dx < -48) {
            Animated.timing(translateX, { toValue: -96, duration: 120, useNativeDriver: true }).start(() => {
              onRequestComplete();
              Animated.spring(translateX, { toValue: 0, useNativeDriver: true, friction: 7 }).start();
            });
          } else {
            Animated.spring(translateX, { toValue: 0, useNativeDriver: true, friction: 7 }).start();
          }
        },
        onPanResponderTerminate: () => {
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
        },
      }),
    [onRequestComplete, translateX],
  );

  return (
    <Animated.View style={{ transform: [{ translateX }, { scale }], opacity }} {...panResponder.panHandlers}>
      <Pressable
        onLongPress={onRequestComplete}
        delayLongPress={380}
        style={[styles.floatingCard, { backgroundColor: palette.surface, borderColor: palette.line }]}
      >
        <View style={[styles.floatingBar, { backgroundColor: color }]} />
        <View style={{ flex: 1, paddingLeft: 10 }}>
          <Text style={{ color: palette.ink, fontSize: 14, fontWeight: '600' }} numberOfLines={2}>
            {item.name}
          </Text>
          <Text style={{ color: palette.ink3, fontSize: 11, marginTop: 2 }} numberOfLines={1}>
            {[item.kind || '网络课', item.teacher, (item.weeks ?? []).length ? C.formatWeeks(item.weeks) : '']
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
        <Text style={{ color: palette.ink4, fontSize: 10.5, alignSelf: 'center' }}>长按完成</Text>
      </Pressable>
    </Animated.View>
  );
}

/* ------------------------------ 主界面 -------------------------------- */
export function TodayScreen() {
  const { ready, state, now, completeFloating } = useStore();
  const { palette } = useTheme();
  const router = useRouter();

  const todayIso = C.todayIso(now);
  const day = useMemo(() => C.dayList(state, todayIso), [state, todayIso, now]);
  const show: ShowFields = state.settings.showFields;
  const nextEntry = day.next as any | null;
  const currentWeek = C.currentWeek(state, now);

  const [confirmItem, setConfirmItem] = useState<any | null>(null);
  const [completingKey, setCompletingKey] = useState<string | null>(null);
  const [hiddenKeys, setHiddenKeys] = useState<string[]>([]);
  const [banner, setBanner] = useState('');
  const bannerAnim = useRef(new Animated.Value(0)).current;

  const showBanner = useCallback(
    (text: string) => {
      setBanner(text);
      bannerAnim.setValue(0);
      Animated.sequence([
        Animated.timing(bannerAnim, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.delay(1700),
        Animated.timing(bannerAnim, { toValue: 0, duration: 220, useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (finished) setBanner('');
      });
    },
    [bannerAnim],
  );

  const floating = useMemo(
    () =>
      ((day.floating ?? []) as any[]).filter(
        (item) => !item.done && !hiddenKeys.includes(floatingKey(item)),
      ),
    [day.floating, hiddenKeys],
  );

  const entries = (day.entries ?? []) as any[];

  const openCourse = useCallback(
    (course: Course) => {
      router.push({ pathname: '/course-edit', params: { id: course.id } });
    },
    [router],
  );

  /** 动画结束后的收尾：隐藏 -> 提示 -> 持久化 */
  const finishFloating = useCallback(
    (item: any) => {
      const key = floatingKey(item);
      setHiddenKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));
      setCompletingKey(null);
      showBanner(`已完成 · ${item.name}`);
      completeFloating(item as FloatingCourse).catch(() => {
        // 持久化失败：恢复卡片，避免用户以为已经保存
        setHiddenKeys((prev) => prev.filter((k) => k !== key));
        showBanner('保存失败，请重试');
      });
    },
    [completeFloating, showBanner],
  );

  if (!ready) return <Loading />;

  const totalSections = entries.reduce(
    (n, e) => n + Math.max(1, (e.endSection ?? 1) - (e.startSection ?? 1) + 1),
    0,
  );

  return (
    <View style={{ flex: 1, backgroundColor: palette.paper }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ flexDirection: 'row', alignItems: 'baseline', marginBottom: 8, paddingHorizontal: 2 }}>
          <Text style={{ color: palette.ink2, fontSize: 13, fontWeight: '600' }}>
            {fmtMonthDay(todayIso)} {C.weekdayName(C.isoWeekday(todayIso))}
          </Text>
          <View style={{ flex: 1 }} />
          <Text style={{ color: palette.ink4, fontSize: 11 }}>
            {currentWeek.status === 'before'
              ? '未开学'
              : currentWeek.status === 'after'
                ? '学期已结束'
                : `第 ${currentWeek.week} 周`}
          </Text>
        </View>

        <HeroCard state={state} day={day} now={now} todayIso={todayIso} palette={palette} />

        <SectionTitle
          right={
            <Text style={{ color: palette.ink4, fontSize: 11 }}>
              {entries.length ? `${entries.length} 个时段 · ${totalSections} 节` : ''}
            </Text>
          }
        >
          今日课程
        </SectionTitle>

        {entries.length ? (
          entries.map((entry) => (
            <TodayRow
              key={`${entry.course?.id ?? entry.course?.name}-${entry.startSection}-${entry.endSection}`}
              entry={entry}
              show={show}
              palette={palette}
              isNext={Boolean(nextEntry) && entry === nextEntry}
              onPress={() => openCourse(entry.course)}
            />
          ))
        ) : (
          <Empty text="今天没有固定时间的课程" />
        )}

        {floating.length ? (
          <>
            <SectionTitle right={<Text style={{ color: palette.ink4, fontSize: 11 }}>{floating.length} 门</Text>}>
              网络 / 实践课
            </SectionTitle>
            {floating.map((item) => {
              const key = floatingKey(item);
              return (
                <FloatingRow
                  key={key}
                  item={item}
                  palette={palette}
                  completing={completingKey === key}
                  onRequestComplete={() => setConfirmItem(item)}
                  onCompleted={() => finishFloating(item)}
                />
              );
            })}
            <Text style={{ color: palette.ink4, fontSize: 10.5, marginTop: 2 }}>
              左滑或长按课程卡片，可标记为已完成
            </Text>
          </>
        ) : null}

        <View style={{ height: 20 }} />
      </ScrollView>

      {/* 完成提示（自绘，不使用原生 Toast） */}
      {banner ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.banner,
            {
              backgroundColor: palette.ink,
              opacity: bannerAnim,
              transform: [
                { translateY: bannerAnim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) },
              ],
            },
          ]}
        >
          <Text style={{ color: palette.paper, fontSize: 12.5, fontWeight: '600' }}>{banner}</Text>
        </Animated.View>
      ) : null}

      {/* 二次确认（ModalSheet，不使用原生 Alert） */}
      <ModalSheet visible={Boolean(confirmItem)} onClose={() => setConfirmItem(null)} centered title="标记为已完成？">
        <Text style={{ color: palette.ink2, fontSize: 13, lineHeight: 20 }}>
          {confirmItem
            ? `「${confirmItem.name}」将从网络 / 实践课列表移除，重新导入课表可恢复。`
            : ''}
        </Text>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
          <GhostButton label="取消" onPress={() => setConfirmItem(null)} style={{ flex: 1 }} />
          <PrimaryButton
            label="标记完成"
            onPress={() => {
              if (!confirmItem) return;
              setConfirmItem(null);
              setCompletingKey(floatingKey(confirmItem));
            }}
            style={{ flex: 1 }}
          />
        </View>
      </ModalSheet>
    </View>
  );
}

/* ------------------------------ 样式 ---------------------------------- */
const styles = StyleSheet.create({
  hero: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    marginBottom: 4,
  },
  heroPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  heroDot: { width: 6, height: 6, borderRadius: 3 },
  track: { height: 5, borderRadius: 3, overflow: 'hidden', marginTop: 14 },
  trackFill: { height: 5, borderRadius: 3 },
  row: { flexDirection: 'row', alignItems: 'stretch', marginBottom: 8 },
  rowTime: {
    width: 44,
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
    paddingTop: 9,
    paddingRight: 7,
  },
  rowTimeStart: { fontSize: 12, fontWeight: '600' },
  rowTimeEnd: { fontSize: 9.5, marginTop: 1 },
  rowCard: {
    flex: 1,
    flexDirection: 'row',
    borderRadius: 13,
    borderWidth: 1,
    paddingVertical: 9,
    paddingRight: 10,
    overflow: 'hidden',
  },
  rowBar: { width: 3, borderRadius: 2, marginLeft: 1, marginVertical: 1 },
  rowName: { fontSize: 14.5, fontWeight: '600', flexShrink: 1, paddingRight: 6 },
  badge: {
    fontSize: 9.5,
    fontWeight: '600',
    overflow: 'hidden',
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  floatingCard: {
    flexDirection: 'row',
    borderRadius: 13,
    borderWidth: 1,
    paddingVertical: 11,
    paddingRight: 10,
    paddingLeft: 1,
    marginBottom: 8,
    overflow: 'hidden',
  },
  floatingBar: { width: 3, borderRadius: 2, marginLeft: 1, marginVertical: 1 },
  banner: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 20,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 999,
    alignItems: 'center',
  },
});

export default TodayScreen;
