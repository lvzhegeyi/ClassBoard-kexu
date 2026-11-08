/**
 * 课序 — 课表展开 / 调休解析 / 视图数据（纯函数，UI 与测试唯一的课程排布来源）
 */
import {
  addDays, dateOfWeekWeekday, isIsoDate, isoWeekday, mondayOf, parseHm,
  toLocalDate, toLocalIsoString, todayIso, weekOf, weekdayName, WEEKDAY_SHORT,
} from './util.js';
import { courseColorIndex } from './model.js';

const SECTION_FALLBACK = { start: '08:00', end: '08:45' };

function sectionTimes(state, startSection, endSection) {
  const secs = state?.termConfig?.sections ?? [];
  const find = (i) => secs.find((s) => Number(s.index) === Number(i));
  const s = find(startSection) ?? secs[0] ?? SECTION_FALLBACK;
  const e = find(endSection) ?? s;
  return {
    start: s.start,
    end: e.end,
    startMin: parseHm(s.start) ?? 480,
    endMin: parseHm(e.end) ?? 525,
  };
}

/** 调休索引（每次调用重建，数据量小） */
export function adjustmentsIndex(state) {
  const off = new Map();
  const swap = new Map();
  const makeup = new Map();
  for (const a of state?.adjustments ?? []) {
    if (!a) continue;
    if (a.type === 'off') off.set(a.date, a);
    else if (a.type === 'swap') {
      if (isIsoDate(a.from) && isIsoDate(a.to)) {
        swap.set(a.from, a.to);
        swap.set(a.to, a.from);
      }
    } else if (a.type === 'makeup') makeup.set(a.date, a);
  }
  return { off, swap, makeup };
}

/** 共用的时间片 -> 条目 */
function toEntry(state, course, slot, week, extra = {}) {
  const t = sectionTimes(state, slot.startSection, slot.endSection);
  const start = toLocalDate(extra.iso, t.start);
  const end = toLocalDate(extra.iso, t.end);
  return {
    course,
    slot,
    week,
    startSection: slot.startSection,
    endSection: slot.endSection,
    start: t.start,
    end: t.end,
    startMin: t.startMin,
    endMin: t.endMin,
    startAt: start ? toLocalIsoString(start) : '',
    endAt: end ? toLocalIsoString(end) : '',
    room: slot.room || course.room || '',
    teacher: slot.teacher || course.teacher || '',
    color: courseColorIndex(course, state),
    adjusted: Boolean(extra.adjusted),
    sourceIso: extra.sourceIso || '',
  };
}

/** 某一日期、某一星期几、某一周的基础课程（不含调休） */
function baseEntries(state, iso, weekday, week, adjusted) {
  const out = [];
  for (const course of state?.courses ?? []) {
    if (!course || course.hidden) continue;
    for (const slot of course.slots ?? []) {
      if (Number(slot.weekday) !== Number(weekday)) continue;
      if (!(slot.weeks ?? []).includes(Number(week))) continue;
      out.push(toEntry(state, course, slot, week, { iso, adjusted }));
    }
  }
  return out.sort((a, b) => a.startSection - b.startSection || a.startMin - b.startMin);
}

/**
 * 解析某一天的最终课程（应用 off / swap / makeup）。
 * @returns {{iso:string, week:number, weekday:number, weekdayName:string, kind:'normal'|'off'|'swapped'|'makeup',
 *            adjusted:boolean, sourceIso:string, note:string, entries:any[], warnings:string[]}}
 */
export function resolveDay(state, iso) {
  const warnings = [];
  const startDate = state?.termConfig?.startDate;
  const week = weekOf(iso, startDate);
  const weekday = isoWeekday(iso);
  const base = {
    iso,
    week,
    weekday,
    weekdayName: weekdayName(weekday),
    kind: 'normal',
    adjusted: false,
    sourceIso: '',
    note: '',
    entries: [],
    warnings,
  };
  if (!isIsoDate(iso)) {
    warnings.push('日期不合法');
    return { ...base, kind: 'off', entries: [] };
  }

  const { off, swap, makeup } = adjustmentsIndex(state);

  // 1) 放假优先
  const offRule = off.get(iso);
  if (offRule) {
    return { ...base, kind: 'off', adjusted: true, note: offRule.note || '调休放假', entries: [] };
  }

  // 2) 对调：跟随源日期（处理链与环）
  if (swap.has(iso)) {
    let cursor = iso;
    let sourceIso = '';
    const visited = new Set([iso]);
    let guard = 0;
    while (swap.has(cursor)) {
      const next = swap.get(cursor);
      if (visited.has(next) || guard > 30) { warnings.push('对调规则存在环，已截断'); break; }
      visited.add(next);
      guard += 1;
      sourceIso = next;
      cursor = next;
      if (off.has(next)) {
        return { ...base, kind: 'swapped', adjusted: true, sourceIso, note: '对调目标日放假', entries: [] };
      }
    }
    const srcWeekday = isoWeekday(sourceIso);
    const srcWeek = weekOf(sourceIso, startDate);
    const entries = baseEntries(state, iso, srcWeekday, srcWeek, true);
    return {
      ...base,
      kind: 'swapped',
      adjusted: true,
      sourceIso,
      note: `按 ${sourceIso}（${weekdayName(srcWeekday)}）课表`,
      entries,
    };
  }

  // 3) 补课：按指定星期上课，周次用当天所在周
  const mk = makeup.get(iso);
  if (mk) {
    const entries = baseEntries(state, iso, mk.weekday, week, true);
    return {
      ...base,
      kind: 'makeup',
      adjusted: true,
      note: mk.note || `按${weekdayName(mk.weekday)}课表补课`,
      entries,
    };
  }

  return { ...base, entries: baseEntries(state, iso, weekday, week, false) };
}

/** 闭区间内所有上课条目（扁平） */
export function occurrencesBetween(state, fromIso, toIso) {
  if (!isIsoDate(fromIso) || !isIsoDate(toIso)) return [];
  const out = [];
  let cursor = fromIso;
  let guard = 0;
  while (cursor <= toIso && guard < 400) {
    guard += 1;
    const day = resolveDay(state, cursor);
    for (const e of day.entries) {
      out.push({
        iso: cursor,
        week: day.week,
        weekday: day.weekday,
        kind: day.kind,
        adjusted: day.adjusted,
        sourceIso: day.sourceIso,
        note: day.note,
        ...e,
        courseId: e.course.id,
      });
    }
    cursor = addDays(cursor, 1);
  }
  return out.sort((a, b) => (a.iso === b.iso ? a.startMin - b.startMin : a.iso < b.iso ? -1 : 1));
}

/** 今日视图 */
export function dayList(state, iso = todayIso()) {
  const day = resolveDay(state, iso);
  const now = new Date();
  const nowIso = todayIso(now);
  const isToday = iso === nowIso;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const entries = day.entries.map((e) => ({
    ...e,
    running: isToday && nowMin >= e.startMin && nowMin <= e.endMin,
    finished: isToday && nowMin > e.endMin,
    upcoming: isToday && nowMin < e.startMin,
    minutesUntil: isToday ? Math.round((e.startMin - nowMin)) : null,
  }));
  const floating = (state?.floatingCourses ?? []).filter((f) => (f.weeks ?? []).includes(day.week));
  const next = entries.find((e) => e.upcoming) ?? null;
  return {
    ...day,
    isToday,
    entries,
    floating,
    count: entries.length,
    running: entries.find((e) => e.running) ?? null,
    next,
    currentWeek: weekOf(iso, state?.termConfig?.startDate),
  };
}

/** 周视图 */
export function weekGrid(state, week, opts = {}) {
  const startDate = state?.termConfig?.startDate;
  const total = state?.termConfig?.weekCount ?? 20;
  const weekdayStart = opts.weekdayStart === 7 ? 7 : 1;
  const order = weekdayStart === 1 ? [1, 2, 3, 4, 5, 6, 7] : [7, 1, 2, 3, 4, 5, 6];
  const today = todayIso();
  const days = order.map((wd) => {
    const iso = dateOfWeekWeekday(week, wd, startDate);
    const day = resolveDay(state, iso);
    return {
      iso,
      weekday: wd,
      weekdayName: weekdayName(wd),
      short: WEEKDAY_SHORT[wd],
      isToday: iso === today,
      inTerm: week >= 1 && week <= total,
      kind: day.kind,
      note: day.note,
      adjusted: day.adjusted,
      entries: day.entries,
    };
  });
  const floating = (state?.floatingCourses ?? []).filter((f) => (f.weeks ?? []).includes(Number(week)));
  return {
    week: Number(week),
    weekCount: total,
    startIso: days[0]?.iso ?? '',
    endIso: days[days.length - 1]?.iso ?? '',
    isCurrent: weekOf(today, startDate) === Number(week),
    days,
    floating,
    conflicts: weekConflicts(state, Number(week)),
    totalEntries: days.reduce((n, d) => n + d.entries.length, 0),
  };
}

/** 一周内同一天节次重叠 */
export function weekConflicts(state, week) {
  const grid = weekGridDays(state, week);
  const out = [];
  for (const day of grid) {
    const list = [...day.entries].sort((a, b) => a.startSection - b.startSection);
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i];
        const b = list[j];
        if (a.startSection <= b.endSection && b.startSection <= a.endSection) {
          if (a.course.id === b.course.id) continue;
          out.push({
            iso: day.iso,
            weekday: day.weekday,
            startSection: Math.max(a.startSection, b.startSection),
            endSection: Math.min(a.endSection, b.endSection),
            courses: [a.course.name, b.course.name],
          });
        }
      }
    }
  }
  return out;
}

function weekGridDays(state, week) {
  const startDate = state?.termConfig?.startDate;
  const out = [];
  for (let wd = 1; wd <= 7; wd += 1) {
    const iso = dateOfWeekWeekday(week, wd, startDate);
    out.push({ iso, weekday: wd, entries: resolveDay(state, iso).entries });
  }
  return out;
}

/** 全学期总览 */
export function semesterOverview(state) {
  const total = state?.termConfig?.weekCount ?? 20;
  const startDate = state?.termConfig?.startDate;
  const weeks = [];
  let totalOccurrences = 0;
  const byName = new Map();
  for (let w = 1; w <= total; w += 1) {
    let count = 0;
    const names = new Set();
    const perDay = [0, 0, 0, 0, 0, 0, 0, 0];
    for (let wd = 1; wd <= 7; wd += 1) {
      const iso = dateOfWeekWeekday(w, wd, startDate);
      const day = resolveDay(state, iso);
      count += day.entries.length;
      perDay[wd] = day.entries.length;
      for (const e of day.entries) { names.add(e.course.name); }
    }
    totalOccurrences += count;
    weeks.push({
      week: w,
      startIso: dateOfWeekWeekday(w, 1, startDate),
      endIso: dateOfWeekWeekday(w, 7, startDate),
      count,
      perDay,
      courses: [...names],
    });
    for (const e of occurrencesBetween(state, weeks[weeks.length - 1].startIso, weeks[weeks.length - 1].endIso)) {
      const cur = byName.get(e.course.name) ?? { name: e.course.name, teacher: e.teacher, count: 0, weeks: new Set(), color: e.color };
      cur.count += 1;
      cur.weeks.add(e.week);
      byName.set(e.course.name, cur);
    }
  }
  return {
    weekCount: total,
    weeks,
    totalOccurrences,
    courses: [...byName.values()].map((c) => ({ ...c, weeks: [...c.weeks].sort((a, b) => a - b) })),
    currentWeek: weekOf(todayIso(), startDate),
  };
}

/** 学期状态 */
export function currentWeek(state, now = new Date()) {
  const total = state?.termConfig?.weekCount ?? 20;
  const startDate = state?.termConfig?.startDate;
  const iso = todayIso(now);
  const week = weekOf(iso, startDate);
  let status = 'in';
  if (week < 1) status = 'before';
  else if (week > total) status = 'after';
  return { week, status, total, iso, startDate, daysToStart: week < 1 ? -Math.round((new Date(iso) - new Date(startDate)) / 86400000) + 1 : 0 };
}

/** 下一节课（含正在上的） */
export function nextOccurrence(state, now = new Date()) {
  const nowIso = toLocalIsoString(now);
  const from = todayIso(now);
  const to = addDays(from, 45);
  const list = occurrencesBetween(state, from, to);
  for (const o of list) {
    if (o.startAt >= nowIso) {
      return { ...o, minutesUntil: Math.max(0, Math.round((new Date(o.startAt) - now) / 60000)) };
    }
  }
  return null;
}

/** 正在上的课 */
export function currentOccurrence(state, now = new Date()) {
  const nowIso = toLocalIsoString(now);
  const iso = todayIso(now);
  const day = resolveDay(state, iso);
  return day.entries.find((e) => e.startAt <= nowIso && e.endAt >= nowIso) ?? null;
}

/** 全学期冲突 */
export function conflicts(state) {
  const total = state?.termConfig?.weekCount ?? 20;
  const out = [];
  for (let w = 1; w <= total; w += 1) out.push(...weekConflicts(state, w));
  return out;
}

/** 第 1 周周一 */
export function termStart(state) {
  return mondayOf(state?.termConfig?.startDate ?? todayIso());
}

export { sectionTimes };
