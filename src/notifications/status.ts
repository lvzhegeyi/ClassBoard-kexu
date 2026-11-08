import type { AppState } from '../types';
// @ts-ignore
import * as C from '../core/index.js';

export interface StatusSnapshot {
  title: string;
  subtitle: string;
  short: string;
  dateMs: number | null;
  running: boolean;
  hasClass: boolean;
}

function timeToDate(iso: string, hm: string): number | null {
  if (!iso || !hm) return null;
  const [h, m] = hm.split(':').map(Number);
  const [y, mo, d] = iso.split('-').map(Number);
  if (!y || !mo || !d) return null;
  return new Date(y, mo - 1, d, h || 0, m || 0, 0).getTime();
}

export function buildStatus(state: AppState, now: Date = new Date()): StatusSnapshot {
  try {
    const running = C.currentOccurrence(state, now);
    if (running) {
      const endMs = timeToDate(running.iso, running.end);
      const left = endMs ? Math.max(0, Math.round((endMs - now.getTime()) / 60000)) : 0;
      return {
        title: `正在上 ${running.course?.name ?? ''}`,
        subtitle: [running.room, running.teacher, `还剩 ${left} 分`].filter(Boolean).join(' · '),
        short: `还剩 ${left} 分`,
        dateMs: endMs,
        running: true,
        hasClass: true,
      };
    }
    const next = C.nextOccurrence(state, now);
    if (next) {
      const startMs = timeToDate(next.iso, next.start);
      const dayText = next.iso === C.todayIso(now) ? '今天' : next.iso === C.addDays(C.todayIso(now), 1) ? '明天' : `${Number(next.iso.slice(5, 7))}/${Number(next.iso.slice(8, 10))}`;
      return {
        title: `下一节 ${next.course?.name ?? ''}`,
        subtitle: [dayText, next.start, next.room].filter(Boolean).join(' · '),
        short: startMs ? `距上课 ${Math.max(0, Math.round((startMs - now.getTime()) / 60000))} 分` : next.start,
        dateMs: startMs,
        running: false,
        hasClass: true,
      };
    }
  } catch {
    // ignore
  }
  return {
    title: '今天已无课',
    subtitle: '好好休息，或预习一下',
    short: '今天已无课',
    dateMs: null,
    running: false,
    hasClass: false,
  };
}
