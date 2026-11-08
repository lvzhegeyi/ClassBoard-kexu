export type ThemeMode = 'flat' | 'dark' | 'auto';

export interface SectionTime {
  index: number;
  start: string;
  end: string;
  period: string;
}

export interface Slot {
  weekday: number;
  startSection: number;
  endSection: number;
  weeks: number[];
  room?: string;
  teacher?: string;
}

export interface Course {
  id: string;
  name: string;
  teacher: string;
  room: string;
  category: string;
  credit: number | null;
  color: number;
  colorManual?: boolean;
  hidden?: boolean;
  slots: Slot[];
}

export interface FloatingCourse {
  name: string;
  teacher?: string;
  weeks: number[];
  color: number;
  done?: boolean;
}

export interface Adjustment {
  type: 'off' | 'swap' | 'makeup';
  date?: string;
  from?: string;
  to?: string;
  weekday?: number;
  note?: string;
}

export interface TermConfig {
  startDate: string;
  weekCount: number;
  sections: SectionTime[];
}

export interface MobileSettings {
  theme: ThemeMode;
  showFields: {
    name: boolean;
    teacher: boolean;
    room: boolean;
    time: boolean;
    category: boolean;
    credit: boolean;
  };
  weekdayStart: 1 | 7;
  weekViewMode: 0 | 1;
  weekFontScale: number;
  reminderEnabled: boolean;
  leadMinutes: number;
  sound: boolean;
  vibration: boolean;
  ongoingNotification: boolean;
  liveActivity: boolean;
}

export interface AppState {
  version: number;
  meta: any;
  termConfig: TermConfig;
  courses: Course[];
  floatingCourses: FloatingCourse[];
  adjustments: Adjustment[];
  settings: MobileSettings;
}

export const DEFAULT_MOBILE_SETTINGS: MobileSettings = {
  theme: 'flat',
  showFields: { name: true, teacher: true, room: true, time: true, category: false, credit: false },
  weekdayStart: 1,
  weekViewMode: 0,
  weekFontScale: 1,
  reminderEnabled: true,
  leadMinutes: 10,
  sound: true,
  vibration: true,
  ongoingNotification: true,
  liveActivity: false,
};
