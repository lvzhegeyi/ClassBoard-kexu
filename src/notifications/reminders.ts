import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { AppState, MobileSettings } from '../types';
// @ts-ignore
import * as C from '../core/index.js';

let handlerInstalled = false;

export async function setupNotifications(): Promise<boolean> {
  if (!handlerInstalled) {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    handlerInstalled = true;
  }
  if (Platform.OS === 'web') return false;
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const asked = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowSound: true, allowBadge: false },
  });
  return asked.granted;
}

export async function rescheduleReminders(state: AppState, settings: MobileSettings): Promise<number> {
  if (Platform.OS === 'web') return 0;
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
    if (!settings.reminderEnabled) return 0;
    const from = C.todayIso(new Date());
    const to = C.addDays(from, 14);
    const all = C.occurrencesBetween(state, from, to) as any[];
    const now = Date.now();
    const lead = Math.max(0, settings.leadMinutes | 0);
    let scheduled = 0;
    for (const occurrence of all) {
      if (scheduled >= 60) break;
      const startMs = new Date(occurrence.startAt).getTime();
      const fireMs = startMs - lead * 60_000;
      if (!Number.isFinite(fireMs) || fireMs <= now + 2_000) continue;
      await Notifications.scheduleNotificationAsync({
        identifier: `class-${occurrence.iso}-${occurrence.course?.id ?? occurrence.course?.name}-${occurrence.startSection}`,
        content: {
          title: `上课提醒 · ${occurrence.course?.name ?? ''}`,
          body: [
            `${occurrence.start} 开始`,
            occurrence.room,
            occurrence.teacher,
            lead > 0 ? `提前 ${lead} 分钟` : '',
          ].filter(Boolean).join(' · '),
          sound: settings.sound ? 'default' : undefined,
          data: { iso: occurrence.iso, courseId: occurrence.course?.id ?? '' },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(fireMs),
        },
      });
      scheduled += 1;
    }
    return scheduled;
  } catch {
    return 0;
  }
}

export async function scheduleTestReminder(settings: MobileSettings): Promise<void> {
  if (Platform.OS === 'web') return;
  await setupNotifications();
  await Notifications.scheduleNotificationAsync({
    content: {
      title: '测试提醒 · 课序',
      body: '如果你看到这条通知，课前提醒已经可以正常工作。',
      sound: settings.sound ? 'default' : undefined,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 5,
      repeats: false,
    },
  });
}
