import { Platform } from 'react-native';
import type { AppState, MobileSettings } from '../types';
import { buildStatus } from '../notifications/status';

let activityId: string | null = null;
let lastKey = '';

function module(): any | null {
  if (Platform.OS !== 'ios') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('expo-live-activity');
  } catch {
    return null;
  }
}

function supported(): boolean {
  const LA = module();
  return Boolean(LA?.startActivity && LA?.updateActivity && LA?.stopActivity);
}

export function liveActivityAvailable(): boolean {
  return supported();
}

export function syncLiveActivity(state: AppState, settings: MobileSettings, now: Date = new Date()): void {
  if (Platform.OS !== 'ios') return;
  const LA = module();
  if (!LA) return;

  if (!settings.liveActivity) {
    stopLiveActivity();
    return;
  }

  const status = buildStatus(state, now);
  if (!status.hasClass) {
    stopLiveActivity();
    return;
  }

  const progressBar = status.dateMs
    ? { date: status.dateMs }
    : undefined;
  const stateObj = {
    title: status.title,
    subtitle: status.subtitle,
    progressBar,
  };
  const key = JSON.stringify(stateObj);
  if (key === lastKey) return;

  try {
    if (!activityId) {
      activityId = LA.startActivity(stateObj, {
        deepLinkUrl: 'classboard:///',
        timerType: 'digital',
        progressViewTint: '#6B8A78',
        titleColor: '#23282A',
        subtitleColor: '#4C5353',
      }) ?? null;
    } else {
      LA.updateActivity(activityId, stateObj);
    }
    lastKey = key;
  } catch {
    activityId = null;
  }
}

export function stopLiveActivity(): void {
  if (!activityId) return;
  const LA = module();
  try {
    LA?.stopActivity(activityId, { title: '课序', subtitle: '' });
  } catch {
    // ignore
  }
  activityId = null;
  lastKey = '';
}
