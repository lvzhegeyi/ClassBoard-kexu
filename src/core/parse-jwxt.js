/**
 * 课序 — 正方 jwglxt 课表响应解析（纯逻辑，网络由 adapters/jwxt-client.mjs 负责）
 * 真实字段见 docs/CONTRACT.md §5 与 tests/fixtures/jwxt-2026-3.json
 */
import { normalizeState, defaultState, createCourse, hashColor, PALETTE_COUNT } from './model.js';
import { parseWeeks, maxWeek } from './weeks.js';
import { isIsoDate, mondayOf, todayIso, WEEKDAY_NAMES } from './util.js';

const TERM_LABELS = { 3: '第一学期', 12: '第二学期', 16: '第三学期' };

const str = (v) => (v == null ? '' : String(v)).replace(/\u00a0/g, ' ').trim();

/** 学年起始年 + 学期 -> 猜测的第 1 周周一（用户可在导入向导里改） */
export function guessStartDate(year, term) {
  const y = Number(year) || new Date().getFullYear();
  let iso;
  if (String(term) === '12') iso = `${y + 1}-02-24`;
  else if (String(term) === '16') iso = `${y + 1}-07-06`;
  else iso = `${y}-09-01`;
  const monday = mondayOf(iso);
  // 极端占位保护：非法年份
  return isIsoDate(monday) ? monday : mondayOf(todayIso());
}

/**
 * 正方 kbList 的节次字段辨析（实测 2026-11-04，文华学院）：
 *   jc    = 实际上课节次文本，如 "1-2节" / "3-4节" / "1-4节"  ← 唯一可信的“实际节次”
 *   jcs   = 同 jc 的紧凑写法，如 "1-2"
 *   oldjc = 节次位掩码，3 => 1-2 节，12 => 3-4 节，15 => 1-4 节，48 => 5-6 节  ← 交叉校验
 *   jcor  = 表格合并块范围（为了对齐同一格的其它课，可能比实际更大）  ← 不能当实际节次用！
 * 反例：周二 09:00 的「Python核心编程」jc=1-2节 / oldjc=3，而 jcor=1-4；
 *       同一时段「数据库系统与应用Ⅰ」jc=3-4节 / oldjc=12，jcor 同样是 1-4。
 *       若用 jcor 会把两门课都算成 1-4 节 -> 虚构出 8 周“节次冲突”。
 */

/** 位掩码 -> [起始节, 结束节] */
function maskToRange(mask) {
  const n = Number(mask);
  if (!Number.isFinite(n) || n <= 0) return null;
  const idx = [];
  for (let i = 0; i < 24; i += 1) if (n & (1 << i)) idx.push(i + 1);
  if (!idx.length) return null;
  return [idx[0], idx[idx.length - 1]];
}

/** 从文本解析节次："1-2节" / "第3-4节" / "9-12" / "1节" */
function parseSectionText(raw) {
  const text = str(raw);
  if (!text) return null;
  let m = /(\d{1,2})\s*[-~～至—]\s*(\d{1,2})/.exec(text);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a >= 1 && b >= a && b <= 24) return [a, b];
  }
  m = /^第?\s*(\d{1,2})\s*节?$/.exec(text);
  if (m) {
    const a = Number(m[1]);
    if (a >= 1 && a <= 24) return [a, a];
  }
  return null;
}

/** 实际节次范围：jc/jcs 优先，oldjc 位掩码兜底，jcor 仅最后兜底 */
function sectionRange(entry) {
  for (const field of [entry?.jc, entry?.jcs]) {
    const range = parseSectionText(field);
    if (range) return range;
  }
  const fromMask = maskToRange(entry?.oldjc);
  if (fromMask) return fromMask;
  // 兼容其它学校/旧版本：jcor 只是合并块，仅当没有 jc/jcs/oldjc 时退化使用
  const fallback = parseSectionText(entry?.jcor);
  if (fallback) return fallback;
  return [1, 2];
}

function termLabel(year, term) {
  const label = TERM_LABELS[String(term)] || '';
  const y = Number(year);
  if (!y) return label;
  return `${y}-${y + 1} 学年 ${label}`.trim();
}

/**
 * 解析正方课表 JSON。
 * @param {object|string} json 原始响应（字符串会尝试 JSON.parse）
 * @param {{year?:string|number, term?:string|number, label?:string, startDate?:string,
 *          weekCount?:number, sections?:Array<{index:number,start:string,end:string,period?:string}>}} opts
 *        sections 来自正方 xskbcx_cxRjc.html（真实节次时间），传入则覆盖默认节次
 * @returns {{statePatch:object, summary:object, warnings:string[]}}
 */
export function parseJwxtResponse(json, opts = {}) {
  const warnings = [];
  let data = json;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { data = null; warnings.push('响应不是合法 JSON'); }
  }
  if (!data || typeof data !== 'object') {
    return {
      statePatch: { meta: null, termConfig: null, courses: [], floatingCourses: [] },
      summary: { courseCount: 0, slotCount: 0, floatingCount: 0, weekCount: 0, startDate: '', source: 'jwxt' },
      warnings: [...warnings, '解析失败：响应为空'],
    };
  }

  const xsxx = data.xsxx && typeof data.xsxx === 'object' ? data.xsxx : {};
  const year = String(opts.year ?? xsxx.XNM ?? '').trim() || String(new Date().getFullYear());
  const term = String(opts.term ?? xsxx.XQM ?? '').trim() || '3';
  const label = str(opts.label) || termLabel(year, term);

  // ---- 固定时间课程：按教学班聚合为课程 + 多个时间片 ----
  const byClass = new Map();
  const kbList = Array.isArray(data.kbList) ? data.kbList : [];

  for (const entry of kbList) {
    if (!entry || typeof entry !== 'object') continue;
    const name = str(entry.kcmc);
    if (!name) continue;
    const weekday = Math.round(Number(entry.xqj));
    if (!(weekday >= 1 && weekday <= 7)) continue;
    const weeks = parseWeeks(entry.zcd);
    if (!weeks.length) {
      warnings.push(`课程「${name}」周次为空或无法识别（zcd=${str(entry.zcd)}），已跳过该时间片`);
      continue;
    }
    const [startSection, endSection] = sectionRange(entry);
    const classKey = str(entry.jxb_id) || str(entry.jxbmc) || `${name}|${str(entry.xm)}`;
    const teacher = str(entry.xm);
    const room = str(entry.cdmc);

    let course = byClass.get(classKey);
    if (!course) {
      course = {
        name,
        teacher,
        room,
        building: str(entry.lh),
        campus: str(entry.xqmc),
        category: str(entry.kclb) || str(entry.kcxz),
        credit: Number.isFinite(Number(entry.xf)) && str(entry.xf) !== '' ? Number(entry.xf) : null,
        examType: str(entry.khfsmc),
        classInfo: str(entry.jxbzc),
        color: hashColor(name),
        slots: [],
        source: { kch: str(entry.kch), jxbmc: str(entry.jxbmc), jxb_id: str(entry.jxb_id) },
      };
      byClass.set(classKey, course);
    } else {
      // 同一教学班内教师/教室可能有变化，主字段取第一次出现的值，单时间片保留差异
      if (!course.teacher && teacher) course.teacher = teacher;
      if (!course.room && room) course.room = room;
    }

    const slot = { weekday, startSection, endSection, weeks, sourceKey: classKey };
    if (room && room !== course.room) slot.room = room;
    if (teacher && teacher !== course.teacher) slot.teacher = teacher;
    // 合并完全相同的时间片（同星期/节次/周次/教室）
    const dup = course.slots.find(
      (s) => s.weekday === slot.weekday && s.startSection === slot.startSection
        && s.endSection === slot.endSection && (s.room || course.room) === (slot.room || course.room)
        && s.weeks.join(',') === slot.weeks.join(','),
    );
    if (!dup) course.slots.push(slot);
  }

  // 颜色策略：「按课表顺序」= 按课程出现顺序轮转 10 色调色板（每次导入都重新分配）；
  // 「按课程名哈希」在渲染时由 core.courseColorIndex 现算，不用这里存的值。
  // 注意：以前这里存的是哈希值，导致两种模式颜色完全一样、用户以为设置没生效。
  const courses = [...byClass.values()].map((c, idx) => createCourse({
    ...c,
    color: idx % PALETTE_COUNT,
    colorManual: false,
    source: c.source,
  }));
  for (const c of courses) c.slots = c.slots.map(({ sourceKey, ...rest }) => rest);

  // ---- 无固定时间课程（网络课/实践课） ----
  const floatingCourses = [];
  for (const entry of Array.isArray(data.sjkList) ? data.sjkList : []) {
    const name = str(entry?.kcmc);
    if (!name) continue;
    if (floatingCourses.some((f) => f.name === name)) continue;
    const weeksText = str(entry.qsjsz) || str(entry.sjkcgs) || str(entry.qtkcgs);
    const weeks = parseWeeks(weeksText);
    floatingCourses.push({
      name,
      teacher: str(entry.jsxm),
      weeks,
      credit: Number.isFinite(Number(entry.xf)) && str(entry.xf) !== '' ? Number(entry.xf) : null,
      category: str(entry.kclb),
      kind: String(entry.kklxdm) === '10' ? '网络课' : '实践课',
      note: str(entry.qtkcgs),
    });
  }

  const startDate = isIsoDate(opts.startDate) ? mondayOf(opts.startDate) : guessStartDate(year, term);
  const maxW = maxWeek(courses);
  const weekCount = Math.max(1, Math.round(Number(opts.weekCount) || 0) || Math.max(maxW, 20));
  const sections = Array.isArray(opts.sections) && opts.sections.length ? opts.sections : undefined;
  if (!isIsoDate(opts.startDate)) {
    warnings.push(`第 1 周周一日期为自动推测（${startDate}），请在导入确认页按校历核对`);
  }
  if (weekCount < maxW) warnings.push(`学期总周数(${weekCount})小于课程最大周次(${maxW})，已自动放大`);
  if (!kbList.length) warnings.push('该学期没有固定时间课程（kbList 为空）');

  const slotCount = courses.reduce((n, c) => n + c.slots.length, 0);

  return {
    statePatch: {
      meta: {
        school: '文华学院',
        term: { year, term, label },
        student: {
          name: str(xsxx.XM),
          id: str(xsxx.XH ?? xsxx.XH_ID),
          className: str(xsxx.BJMC),
          major: str(xsxx.ZYMC),
          campus: str(data.sjkList?.[0]?.xqmc ?? '') || '本校',
        },
        importedAt: new Date().toISOString(),
        source: 'jwxt',
      },
      termConfig: {
        startDate,
        weekCount: Math.max(weekCount, maxW, 1),
        // 传入真实节次时间则覆盖；否则 undefined 让 normalizeState 用默认值
        sections,
      },
      courses,
      floatingCourses,
    },
    summary: {
      courseCount: courses.length,
      slotCount,
      floatingCount: floatingCourses.length,
      weekCount: Math.max(weekCount, maxW, 1),
      startDate,
      source: 'jwxt',
    },
    warnings,
  };
}

/**
 * 把导入结果合并进已有 state：保留 settings / adjustments / 已修正的学期起始日 / 课程颜色。
 * @param {object|null} baseState
 * @param {object} patch statePatch
 * @param {{startDate?:string, weekCount?:number}} opts
 * @returns {{state:object, warnings:string[]}}
 */
export function mergeImported(baseState, patch, opts = {}) {
  const base = baseState ? normalizeState(baseState).state : defaultState();
  const warnings = [];
  if (!patch || !patch.meta) {
    warnings.push('没有可合并的导入数据');
    return { state: base, warnings };
  }

  // 只有“已经导入过同一学期”时才沿用用户在 UI 里修正过的开学日期；
  // 全新的默认 state（source=manual 且无课程）不算，否则会把今天当成第 1 周。
  const baseImported = base.meta?.source !== 'manual' && (base.courses?.length ?? 0) > 0;
  const sameTerm = baseImported
    && base.meta?.term?.year === patch.meta.term.year
    && base.meta?.term?.term === patch.meta.term.term;

  // 课程颜色沿用：只保留用户「手动指定」过的颜色；自动配色的课程每次导入按新顺序重排，
  // 这样「按课表顺序 / 按课程名哈希」两种模式才会真正不同。
  const colorMap = new Map();
  for (const c of base.courses ?? []) {
    if (c.colorManual) colorMap.set(`${c.name}|${c.teacher}`, c.color);
  }
  const courses = (patch.courses ?? []).map((c) => {
    const kept = colorMap.get(`${c.name}|${c.teacher}`);
    return Number.isInteger(kept)
      ? { ...c, color: kept, colorManual: true }
      : { ...c, colorManual: false };
  });

  const startDate = isIsoDate(opts.startDate)
    ? mondayOf(opts.startDate)
    : (sameTerm && isIsoDate(base.termConfig?.startDate) ? base.termConfig.startDate : patch.termConfig?.startDate);
  const weekCount = Math.max(
    Math.round(Number(opts.weekCount) || 0),
    Number(patch.termConfig?.weekCount) || 0,
    maxWeek(courses),
    1,
  );

  const merged = {
    ...base,
    meta: {
      ...base.meta,
      ...patch.meta,
      school: base.meta?.school || patch.meta.school,
    },
    termConfig: {
      startDate: isIsoDate(startDate) ? startDate : guessStartDate(patch.meta.term.year, patch.meta.term.term),
      weekCount,
      // 真实节次时间随导入更新；没有则保留已有（用户可能在设置里改过）
      sections: Array.isArray(patch.termConfig?.sections) && patch.termConfig.sections.length
        ? patch.termConfig.sections
        : base.termConfig?.sections,
    },
    courses,
    floatingCourses: patch.floatingCourses ?? [],
    // adjustments 保留：调休规则与学期无关，跨学期也常需保留
    adjustments: base.adjustments ?? [],
    settings: base.settings,
  };

  const { state, warnings: nw } = normalizeState(merged);
  return { state, warnings: [...warnings, ...nw] };
}

export { WEEKDAY_NAMES };
