/**
 * 课序 — 日期/时间工具（零依赖，平台无关；浏览器与 Node 通用）
 * 约定：日期一律 "YYYY-MM-DD" 本地日历日；运算用 UTC 毫秒避免夏令时/时区漂移。
 */

const DAY_MS = 86400000;

export const pad2 = (n) => String(n).padStart(2, '0');

export function isIsoDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  // 必须做回环校验，否则 Date.UTC(2026, 12, 40) 会滚动成 2027-02-09 而被误判为合法
  return fromUtc(toUtc(s)) === s;
}

/** "2026-09-07" -> UTC 毫秒（当天 00:00 UTC，仅作算术基准） */
export function toUtc(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1);
}

/** UTC 毫秒 -> "YYYY-MM-DD" */
export function fromUtc(ms) {
  const dt = new Date(ms);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

export function addDays(iso, n) {
  if (!isIsoDate(iso)) return '';
  return fromUtc(toUtc(iso) + Math.round(n) * DAY_MS);
}

/** 1=周一 … 7=周日 */
export function isoWeekday(iso) {
  if (!isIsoDate(iso)) return 0;
  const wd = new Date(toUtc(iso)).getUTCDay();
  return wd === 0 ? 7 : wd;
}

/** 所在周的周一 */
export function mondayOf(iso) {
  if (!isIsoDate(iso)) return '';
  return addDays(iso, -(isoWeekday(iso) - 1));
}

/** 日期属于第几教学周（1 起算，可能 <=0 或超出总周数） */
export function weekOf(iso, startDate) {
  if (!isIsoDate(iso) || !isIsoDate(startDate)) return 0;
  const base = toUtc(mondayOf(startDate));
  return Math.floor((toUtc(iso) - base) / (7 * DAY_MS)) + 1;
}

/** 第 week 周星期 weekday 的日期 */
export function dateOfWeekWeekday(week, weekday, startDate) {
  if (!isIsoDate(startDate)) return '';
  return addDays(mondayOf(startDate), (Number(week) - 1) * 7 + (Number(weekday) - 1));
}

/** "08:00" -> 480（分钟）；非法返回 null */
export function parseHm(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

export function fmtHm(min) {
  const m = Math.max(0, Math.round(Number(min) || 0));
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

/** 本地“今天”的 ISO 日期 */
export function todayIso(now = new Date()) {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/** ISO 日期 + "HH:mm" -> 本地 Date 对象 */
export function toLocalDate(iso, hm) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const mins = parseHm(hm);
  if (mins == null) return null;
  return new Date(y, (m || 1) - 1, d || 1, Math.floor(mins / 60), mins % 60, 0, 0);
}

/** 本地 Date -> 无时区的 ISO 本地时间串 "2026-11-04T08:00:00" */
export function toLocalIsoString(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

export const WEEKDAY_NAMES = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
export const WEEKDAY_SHORT = ['', '一', '二', '三', '四', '五', '六', '日'];

export function weekdayName(wd) {
  return WEEKDAY_NAMES[Number(wd)] || '';
}

export function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, Number(n) || 0));
}

/** "2026年11月4日" / "2026-11-4" -> "2026-11-04" */
export function normalizeCnDate(s) {
  const t = String(s ?? '').trim();
  let m = /(\d{4})\s*[-/年]\s*(\d{1,2})\s*[-/月]\s*(\d{1,2})/.exec(t);
  if (!m) m = /(\d{1,2})\s*[-/]\s*(\d{1,2})\s*[-/]\s*(\d{4})/.exec(t);
  if (!m) return '';
  let y; let mo; let d;
  if (m[1].length === 4) { y = +m[1]; mo = +m[2]; d = +m[3]; } else { y = +m[3]; mo = +m[2]; d = +m[1]; }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  return `${y}-${pad2(mo)}-${pad2(d)}`;
}

/** 相差天数（a-b） */
export function diffDays(a, b) {
  if (!isIsoDate(a) || !isIsoDate(b)) return 0;
  return Math.round((toUtc(a) - toUtc(b)) / DAY_MS);
}
