/**
 * 课序 — 数据模型：默认值、归一化、校验、去重工具
 * normalizeState 必须幂等：对同一份数据反复调用结果稳定（含 id 不重新生成）。
 */
import { isIsoDate, mondayOf, todayIso, isoWeekday, addDays, clamp } from './util.js';
import { normalizeWeeks, maxWeek, parseWeeks } from './weeks.js';

export const PALETTE_COUNT = 10;

/** 默认节次时间（文华学院正方教务实测值：xskbcx_cxRjc.html；可在设置里改） */
export const DEFAULT_SECTIONS = [
  { index: 1, start: '08:10', end: '08:55', period: '上午' },
  { index: 2, start: '09:00', end: '09:45', period: '上午' },
  { index: 3, start: '10:05', end: '10:50', period: '上午' },
  { index: 4, start: '10:55', end: '11:40', period: '上午' },
  { index: 5, start: '14:00', end: '14:45', period: '下午' },
  { index: 6, start: '14:50', end: '15:35', period: '下午' },
  { index: 7, start: '15:50', end: '16:35', period: '下午' },
  { index: 8, start: '16:40', end: '17:25', period: '下午' },
  { index: 9, start: '18:30', end: '19:15', period: '晚上' },
  { index: 10, start: '19:20', end: '20:05', period: '晚上' },
  { index: 11, start: '20:10', end: '20:55', period: '晚上' },
  { index: 12, start: '21:00', end: '21:45', period: '晚上' },
];

export const PERIOD_NAMES = { 上午: '上午', 下午: '下午', 晚上: '晚上' };

export function periodOfSection(index) {
  const i = Number(index);
  if (i <= 4) return '上午';
  if (i <= 8) return '下午';
  return '晚上';
}

export const TERM_LABELS = { 3: '第一学期', 12: '第二学期', 16: '第三学期' };

let seq = 0;
/** 轻量唯一 id（无 crypto 依赖，避免重复） */
export function uid(prefix = 'c') {
  seq = (seq + 1) % 46656;
  const t = Date.now().toString(36).slice(-5);
  const r = Math.random().toString(36).slice(2, 6);
  return `${prefix}_${t}${seq.toString(36).padStart(3, '0')}${r}`;
}

export const DEFAULT_SETTINGS = {
  theme: 'flat',
  view: 'week',
  weekdayStart: 1,
  showFields: { name: true, teacher: true, room: true, time: true, category: false, credit: false },
  courseColorMode: 'auto',
  reminder: {
    enabled: true,
    leadMinutes: [15, 5],
    sound: 'chime',
    effect: 'pulse',
    volume: 0.55,
    dailyBrief: true,
  },
  autostart: false,
  widgetTheme: 'auto', // auto=跟随主界面主题；flat / glass / dark 单独指定
  wallpaperTheme: 'auto', // 同上，壁纸页/WE 工程用
  widget: { enabled: false, alwaysOnTop: true, opacity: 0.92, scale: 1, show: 'today' },
  // Wallpaper Engine 壁纸页：整体/时间/日期/课程分别缩放 + 元素显隐
  wallpaper: {
    scale: 1,
    clockScale: 1,
    dateScale: 1,
    courseScale: 1,
    showClock: true,
    showDate: true,
    showNow: true,
    showFloating: true,
    showFoot: true,
  },
  display: { mode: 'app' },
};

export function defaultSections() {
  return DEFAULT_SECTIONS.map((s) => ({ ...s }));
}

export function defaultTermConfig(startDate) {
  const start = isIsoDate(startDate) ? mondayOf(startDate) : mondayOf(todayIso());
  return { startDate: start, weekCount: 20, sections: defaultSections() };
}

export function defaultState() {
  return {
    version: 1,
    meta: {
      school: '文华学院',
      term: { year: String(new Date().getFullYear()), term: '3', label: '' },
      student: { name: '', id: '', className: '', major: '', campus: '' },
      importedAt: '',
      source: 'manual',
    },
    termConfig: defaultTermConfig(),
    courses: [],
    floatingCourses: [],
    adjustments: [],
    settings: structuredCloneish(DEFAULT_SETTINGS),
  };
}

function structuredCloneish(v) {
  return JSON.parse(JSON.stringify(v));
}

const str = (v) => (v == null ? '' : String(v)).replace(/\u00a0/g, ' ').trim();
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** 稳定字符串哈希 -> 0..9 */
export function hashColor(name) {
  const s = String(name ?? '');
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h % PALETTE_COUNT;
}

export function courseColorIndex(courseOrName, state) {
  if (state?.settings?.courseColorMode === 'byCourse') {
    return hashColor(typeof courseOrName === 'string' ? courseOrName : courseOrName?.name);
  }
  if (courseOrName && typeof courseOrName === 'object' && Number.isInteger(courseOrName.color)) {
    return ((courseOrName.color % PALETTE_COUNT) + PALETTE_COUNT) % PALETTE_COUNT;
  }
  return hashColor(typeof courseOrName === 'string' ? courseOrName : courseOrName?.name);
}

export function courseKey(c) {
  return [str(c?.name), str(c?.teacher)].join('|');
}

export function createCourse(partial = {}) {
  const name = str(partial.name) || '未命名课程';
  return {
    id: partial.id || uid('c'),
    name,
    teacher: str(partial.teacher),
    room: str(partial.room),
    building: str(partial.building),
    campus: str(partial.campus),
    category: str(partial.category),
    credit: num(partial.credit),
    examType: str(partial.examType),
    classInfo: str(partial.classInfo),
    note: str(partial.note),
    color: Number.isInteger(partial.color) ? clamp(partial.color, 0, PALETTE_COUNT - 1) : hashColor(name),
    // 颜色是否由用户手动指定：决定「重新导入 / 调色模式」时是否保留
    colorManual: Boolean(partial.colorManual),
    hidden: Boolean(partial.hidden),
    slots: Array.isArray(partial.slots) ? partial.slots.map(normalizeSlot).filter(Boolean) : [],
    source: partial.source && typeof partial.source === 'object' ? { ...partial.source } : undefined,
  };
}

function normalizeSlot(slot) {
  if (!slot || typeof slot !== 'object') return null;
  const weekday = Math.round(Number(slot.weekday));
  if (!(weekday >= 1 && weekday <= 7)) return null;
  let startSection = Math.round(Number(slot.startSection ?? slot.start ?? 1));
  let endSection = Math.round(Number(slot.endSection ?? slot.end ?? startSection));
  if (!Number.isFinite(startSection) || startSection < 1) startSection = 1;
  if (!Number.isFinite(endSection) || endSection < startSection) endSection = startSection;
  startSection = Math.min(startSection, 20);
  endSection = Math.min(endSection, 20);
  const weeks = normalizeWeeks(Array.isArray(slot.weeks) ? slot.weeks : parseWeeks(slot.weeks));
  if (!weeks.length) return null;
  const out = { weekday, startSection, endSection, weeks };
  const room = str(slot.room);
  if (room) out.room = room;
  const teacher = str(slot.teacher);
  if (teacher) out.teacher = teacher;
  const note = str(slot.note);
  if (note) out.note = note;
  return out;
}

function normalizeSections(sections) {
  const arr = Array.isArray(sections) ? sections : [];
  const map = new Map();
  for (const s of arr) {
    const idx = Math.round(Number(s?.index));
    if (!(idx >= 1 && idx <= 20)) continue;
    const start = /^\d{1,2}:\d{2}$/.test(str(s.start)) ? str(s.start) : '';
    const end = /^\d{1,2}:\d{2}$/.test(str(s.end)) ? str(s.end) : '';
    if (!start || !end) continue;
    const period = ['上午', '下午', '晚上'].includes(str(s.period)) ? str(s.period) : periodOfSection(idx);
    map.set(idx, { index: idx, start, end, period });
  }
  const maxIdx = Math.max(12, ...map.keys());
  const out = [];
  for (let i = 1; i <= maxIdx; i += 1) {
    out.push(map.get(i) ?? { ...(DEFAULT_SECTIONS[i - 1] ?? { index: i, start: '08:00', end: '08:45', period: periodOfSection(i) }) });
  }
  return out;
}

function normalizeSettings(input) {
  const base = structuredCloneish(DEFAULT_SETTINGS);
  const s = input && typeof input === 'object' ? input : {};
  const theme = ['flat', 'glass', 'dark'].includes(s.theme) ? s.theme : base.theme;
  const view = ['today', 'week', 'semester'].includes(s.view) ? s.view : base.view;
  const showFields = { ...base.showFields };
  for (const k of Object.keys(showFields)) {
    if (s.showFields && typeof s.showFields[k] === 'boolean') showFields[k] = s.showFields[k];
  }
  const r = s.reminder && typeof s.reminder === 'object' ? s.reminder : {};
  const lead = Array.isArray(r.leadMinutes)
    ? [...new Set(r.leadMinutes.map((n) => Math.round(Number(n))).filter((n) => n >= 0 && n <= 180))].sort((a, b) => b - a)
    : base.reminder.leadMinutes;
  const w = s.widget && typeof s.widget === 'object' ? s.widget : {};
  const wp = s.wallpaper && typeof s.wallpaper === 'object' ? s.wallpaper : {};
  return {
    theme,
    view,
    weekdayStart: s.weekdayStart === 7 ? 7 : 1,
    showFields,
    courseColorMode: ['auto', 'byCourse'].includes(s.courseColorMode) ? s.courseColorMode : base.courseColorMode,
    reminder: {
      enabled: typeof r.enabled === 'boolean' ? r.enabled : base.reminder.enabled,
      leadMinutes: lead.length ? lead : base.reminder.leadMinutes,
      sound: ['chime', 'bell', 'soft', 'none'].includes(r.sound) ? r.sound : base.reminder.sound,
      effect: ['pulse', 'shake', 'toast', 'none'].includes(r.effect) ? r.effect : base.reminder.effect,
      volume: typeof r.volume === 'number' ? clamp(r.volume, 0, 1) : base.reminder.volume,
      dailyBrief: typeof r.dailyBrief === 'boolean' ? r.dailyBrief : base.reminder.dailyBrief,
    },
    autostart: Boolean(s.autostart),
    widgetTheme: ['auto', 'flat', 'glass', 'dark'].includes(s.widgetTheme) ? s.widgetTheme : base.widgetTheme,
    wallpaperTheme: ['auto', 'flat', 'glass', 'dark'].includes(s.wallpaperTheme) ? s.wallpaperTheme : base.wallpaperTheme,
    widget: {
      enabled: typeof w.enabled === 'boolean' ? w.enabled : base.widget.enabled,
      alwaysOnTop: typeof w.alwaysOnTop === 'boolean' ? w.alwaysOnTop : base.widget.alwaysOnTop,
      opacity: typeof w.opacity === 'number' ? clamp(w.opacity, 0.3, 1) : base.widget.opacity,
      scale: typeof w.scale === 'number' ? clamp(w.scale, 0.7, 1.6) : base.widget.scale,
      show: ['today', 'week'].includes(w.show) ? w.show : base.widget.show,
    },
    display: { mode: ['app', 'widget', 'wallpaper'].includes(s.display?.mode) ? s.display.mode : 'app' },
    wallpaper: {
      scale: typeof wp.scale === 'number' ? clamp(wp.scale, 0.6, 2.5) : base.wallpaper.scale,
      clockScale: typeof wp.clockScale === 'number' ? clamp(wp.clockScale, 0.6, 2.5) : base.wallpaper.clockScale,
      dateScale: typeof wp.dateScale === 'number' ? clamp(wp.dateScale, 0.6, 2.5) : base.wallpaper.dateScale,
      courseScale: typeof wp.courseScale === 'number' ? clamp(wp.courseScale, 0.6, 2) : base.wallpaper.courseScale,
      showClock: typeof wp.showClock === 'boolean' ? wp.showClock : base.wallpaper.showClock,
      showDate: typeof wp.showDate === 'boolean' ? wp.showDate : base.wallpaper.showDate,
      showNow: typeof wp.showNow === 'boolean' ? wp.showNow : base.wallpaper.showNow,
      showFloating: typeof wp.showFloating === 'boolean' ? wp.showFloating : base.wallpaper.showFloating,
      showFoot: typeof wp.showFoot === 'boolean' ? wp.showFoot : base.wallpaper.showFoot,
    },
  };
}

/**
 * 归一化整份 state（幂等）。非法数据降级并记录 warnings，绝不抛异常。
 * @param {any} input
 * @returns {{state:any, warnings:string[]}}
 */
export function normalizeState(input) {
  const warnings = [];
  const src = input && typeof input === 'object' ? input : {};
  const state = defaultState();

  // meta
  const meta = src.meta && typeof src.meta === 'object' ? src.meta : {};
  state.meta = {
    school: str(meta.school) || '文华学院',
    term: {
      year: str(meta.term?.year) || String(new Date().getFullYear()),
      term: ['3', '12', '16'].includes(str(meta.term?.term)) ? str(meta.term.term) : '3',
      label: str(meta.term?.label),
    },
    student: {
      name: str(meta.student?.name),
      id: str(meta.student?.id),
      className: str(meta.student?.className),
      major: str(meta.student?.major),
      campus: str(meta.student?.campus),
    },
    importedAt: str(meta.importedAt),
    source: ['jwxt', 'manual', 'file'].includes(meta.source) ? meta.source : 'manual',
  };

  // termConfig
  const tc = src.termConfig && typeof src.termConfig === 'object' ? src.termConfig : {};
  const startDate = isIsoDate(tc.startDate) ? mondayOf(tc.startDate) : mondayOf(todayIso());
  state.termConfig = {
    startDate,
    weekCount: Math.max(1, Math.min(60, Math.round(Number(tc.weekCount) || 20))),
    sections: normalizeSections(tc.sections),
  };

  // courses
  const seenIds = new Set();
  const courses = [];
  for (const raw of Array.isArray(src.courses) ? src.courses : []) {
    if (!raw || typeof raw !== 'object') continue;
    const c = createCourse(raw);
    if (!c.slots.length) {
      warnings.push(`课程「${c.name}」没有有效时间片，已隐藏`);
      c.hidden = true;
    }
    if (seenIds.has(c.id)) c.id = uid('c');
    seenIds.add(c.id);
    // 周次裁剪到学期范围
    c.slots = c.slots.map((slot) => ({ ...slot, weeks: slot.weeks.filter((w) => w <= 60) }));
    courses.push(c);
  }
  state.courses = courses;

  // 星期与节次上限：保证 sections 覆盖所有用到的节次
  let maxSection = 12;
  for (const c of courses) for (const slot of c.slots) maxSection = Math.max(maxSection, slot.endSection);
  if (maxSection > state.termConfig.sections.length) {
    for (let i = state.termConfig.sections.length + 1; i <= maxSection; i += 1) {
      state.termConfig.sections.push(DEFAULT_SECTIONS[i - 1] ?? { index: i, start: '08:00', end: '08:45' });
    }
  }
  state.termConfig.weekCount = Math.max(state.termConfig.weekCount, maxWeek(courses), 1);

  // floatingCourses
  state.floatingCourses = (Array.isArray(src.floatingCourses) ? src.floatingCourses : [])
    .filter((f) => f && typeof f === 'object' && str(f.name))
    .map((f) => ({
      id: str(f.id) || uid('f'),
      name: str(f.name),
      teacher: str(f.teacher),
      weeks: normalizeWeeks(f.weeks),
      credit: num(f.credit),
      category: str(f.category),
      kind: str(f.kind) || '网络课',
      note: str(f.note),
      color: Number.isInteger(f.color) ? ((f.color % PALETTE_COUNT) + PALETTE_COUNT) % PALETTE_COUNT : hashColor(str(f.name)),
      done: Boolean(f.done),
    }));

  // adjustments
  state.adjustments = (Array.isArray(src.adjustments) ? src.adjustments : [])
    .map((a) => {
      if (!a || typeof a !== 'object') return null;
      const type = str(a.type);
      const id = str(a.id) || uid('a');
      if (type === 'off') return isIsoDate(a.date) ? { id, type, date: a.date, note: str(a.note) } : null;
      if (type === 'swap') {
        return isIsoDate(a.from) && isIsoDate(a.to) && a.from !== a.to
          ? { id, type, from: a.from, to: a.to, note: str(a.note) }
          : null;
      }
      if (type === 'makeup') {
        const wd = Math.round(Number(a.weekday));
        return isIsoDate(a.date) && wd >= 1 && wd <= 7 ? { id, type, date: a.date, weekday: wd, note: str(a.note) } : null;
      }
      return null;
    })
    .filter(Boolean);
  state.adjustments = dedupeAdjustments(state.adjustments, warnings);

  state.settings = normalizeSettings(src.settings);

  return { state, warnings };
}

function dedupeAdjustments(list, warnings) {
  const out = [];
  const swapSeen = new Map();
  const dateSeen = new Map();
  for (const a of list) {
    if (a.type === 'swap') {
      const key = [a.from, a.to].sort().join('~');
      if (swapSeen.has(key)) { warnings.push(`重复的对调规则已合并：${a.from} ↔ ${a.to}`); continue; }
      swapSeen.set(key, a.id);
      out.push(a);
    } else {
      if (dateSeen.has(a.date)) warnings.push(`日期 ${a.date} 有多条调休规则，后一条生效`);
      dateSeen.set(a.date, a.id);
      out.push(a);
    }
  }
  return out;
}

/** 去重后的课程清单（给“从已有课程快速选择”用） */
export function uniqueCourses(state) {
  const map = new Map();
  for (const c of state?.courses ?? []) {
    const key = [str(c.name), str(c.teacher), str(c.room)].join('|');
    if (!key.trim()) continue;
    const item = map.get(key);
    if (item) item.count += 1;
    else {
      map.set(key, {
        key,
        name: c.name,
        teacher: c.teacher,
        room: c.room,
        building: c.building,
        campus: c.campus,
        category: c.category,
        credit: c.credit,
        color: c.color,
        count: 1,
      });
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'));
}

/** 课程在某一周是否上课 */
export function courseActiveInWeek(course, week) {
  return (course?.slots ?? []).some((slot) => (slot.weeks ?? []).includes(Number(week)));
}

/** 课程的所有时间片按 星期/节次 升序 */
export function sortedSlots(course) {
  return [...(course?.slots ?? [])].sort((a, b) => a.weekday - b.weekday || a.startSection - b.startSection);
}

/** 生成“某天是第几周/星期几”的人类可读描述 */
export function describeDate(iso, startDate) {
  const { weekOf, weekdayName } = { weekOf: null, weekdayName: null };
  return iso;
}

export { isoWeekday, addDays };
