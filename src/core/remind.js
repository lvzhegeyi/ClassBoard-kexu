/**
 * 课序 — 倒计时提醒规划（纯函数）
 * 服务端调度器每秒调用 dueReminders；前端也用它做离线兜底，同一 key 去重。
 */
import { occurrencesBetween } from './schedule.js';
import { addDays, todayIso, toLocalIsoString } from './util.js';

export function reminderKey(occ, kind, minutesBefore) {
  return `${occ.courseId || occ.course?.id}|${occ.iso}|${occ.startSection}-${occ.endSection}|${kind}${minutesBefore ? `-${minutesBefore}` : ''}`;
}

/**
 * 规划未来一段时间内的提醒。
 * @param {object} state
 * @param {Date} now
 * @param {{horizonDays?:number, maxCount?:number}} opts
 * @returns {Array<{key:string, kind:'lead'|'start', minutesBefore:number, at:string, occurrence:object}>}
 */
export function planReminders(state, now = new Date(), opts = {}) {
  const horizonDays = Math.max(1, Math.min(30, Number(opts.horizonDays) || 8));
  const maxCount = Math.max(1, Math.min(2000, Number(opts.maxCount) || 400));
  const reminder = state?.settings?.reminder;
  if (!reminder?.enabled) return [];
  const leads = Array.isArray(reminder.leadMinutes) && reminder.leadMinutes.length ? reminder.leadMinutes : [15];
  const from = todayIso(now);
  const to = addDays(from, horizonDays);
  const occurrences = occurrencesBetween(state, from, to);
  const out = [];
  for (const occ of occurrences) {
    if (!occ.startAt) continue;
    const start = new Date(occ.startAt);
    if (Number.isNaN(start.getTime())) continue;
    for (const m of leads) {
      const at = new Date(start.getTime() - m * 60000);
      if (at <= now) continue;
      out.push({ key: reminderKey(occ, 'lead', m), kind: 'lead', minutesBefore: m, at: toLocalIsoString(at), occurrence: occ });
    }
    if (start > now) {
      out.push({ key: reminderKey(occ, 'start', 0), kind: 'start', minutesBefore: 0, at: toLocalIsoString(start), occurrence: occ });
    }
  }
  out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return out.slice(0, maxCount);
}

/**
 * 到期提醒（调度器每秒调用）。
 * @param {object} state
 * @param {Date} now
 * @param {Set<string>} firedKeys 已触发集合（调用方维护，可每天清空）
 * @param {{windowMs?:number}} opts
 * @returns {Array<{key,kind,minutesBefore,at,occurrence}>}
 */
export function dueReminders(state, now = new Date(), firedKeys = new Set(), opts = {}) {
  const windowMs = Math.max(1000, Number(opts.windowMs) || 90000);
  const horizonDays = Math.max(1, Math.min(30, Math.ceil(windowMs / 86400000) + 2));
  const planned = planReminders(state, new Date(now.getTime() - windowMs - 1000), { horizonDays });
  const out = [];
  for (const item of planned) {
    const at = new Date(item.at);
    if (Number.isNaN(at.getTime())) continue;
    if (at > now) continue;
    if (now.getTime() - at.getTime() > windowMs) continue;
    if (firedKeys.has(item.key)) continue;
    out.push(item);
  }
  return out;
}

/** 当天课程简报（每日首节课前，可选功能） */
export function dailyBrief(state, iso = todayIso()) {
  const day = state?.courses ? { entries: [] } : null;
  return day;
}
