/**
 * 课序 — 教学周次解析
 * 真实数据样例（来自文华学院正方教务）：
 *   "3-14周"  "1-8周"  "10-15周"  "3-4周,6-14周"  "4-6周(双),7周"
 *   "9周"  "5周"  "12-15周"  "1-16周(单)"  "1-16周（双）"  "第3-14周"
 */

/** 全角转半角 + 统一分隔符 */
function normalizeInput(input) {
  return String(input ?? '')
    .replace(/[\uFF10-\uFF19]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[，；、;]/g, ',')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/[～~—－–至到]/g, '-')
    .replace(/\s+/g, '');
}

/**
 * 解析周次表达式 -> 升序去重周号数组。无法识别时返回 []（不抛异常）。
 * @param {string|number[]} input
 * @returns {number[]}
 */
export function parseWeeks(input) {
  if (Array.isArray(input)) return normalizeWeeks(input);
  const s = normalizeInput(input);
  if (!s) return [];
  const set = new Set();

  for (const rawToken of s.split(',')) {
    if (!rawToken) continue;
    const parity = /单/.test(rawToken) ? 'odd' : /双/.test(rawToken) ? 'even' : null;
    // 去掉 "(双)"、"(单)"、"(周)" 之类括注，再去掉“第”“周”字
    const token = rawToken
      .replace(/\([^)]*\)?/g, '')
      .replace(/^第/, '')
      .replace(/周$/, '')
      .replace(/周/g, '');
    const m = /^(\d{1,2})(?:-(\d{1,2}))?$/.exec(token);
    if (!m) continue;
    let a = Number(m[1]);
    let b = m[2] ? Number(m[2]) : a;
    if (b < a) [a, b] = [b, a];
    for (let w = a; w <= b && w <= 60; w += 1) {
      if (w < 1) continue;
      if (parity === 'odd' && w % 2 === 0) continue;
      if (parity === 'even' && w % 2 === 1) continue;
      set.add(w);
    }
  }
  return [...set].sort((x, y) => x - y);
}

/** 数字数组 -> 去重升序（过滤非法） */
export function normalizeWeeks(weeks) {
  const set = new Set();
  for (const w of weeks ?? []) {
    const n = Math.round(Number(w));
    if (Number.isFinite(n) && n >= 1 && n <= 60) set.add(n);
  }
  return [...set].sort((x, y) => x - y);
}

/** [1,2,3,5,6,7] -> "1-3周,5-7周" */
export function formatWeeks(weeks) {
  const list = normalizeWeeks(weeks);
  if (!list.length) return '';
  const parts = [];
  let start = list[0];
  let prev = list[0];
  const push = (a, b) => parts.push(a === b ? `${a}周` : `${a}-${b}周`);
  for (let i = 1; i < list.length; i += 1) {
    const w = list[i];
    if (w === prev + 1) { prev = w; continue; }
    push(start, prev);
    start = w;
    prev = w;
  }
  push(start, prev);
  return parts.join(',');
}

/** 课程/时间片集合里出现过的最大周号 */
export function maxWeek(courses = []) {
  let max = 0;
  for (const c of courses) {
    for (const slot of c?.slots ?? []) {
      for (const w of slot.weeks ?? []) if (w > max) max = w;
    }
  }
  return max;
}

export function isWeekActive(weeks, week) {
  return Array.isArray(weeks) && weeks.includes(Number(week));
}
