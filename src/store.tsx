import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
// @ts-ignore - 复用桌面端纯逻辑 core（schedule/model/weeks/util）
import * as C from './core/index.js';
import {
  DEFAULT_MOBILE_SETTINGS,
  type Adjustment,
  type AppState,
  type Course,
  type FloatingCourse,
  type MobileSettings,
  type SectionTime,
} from './types';

const STATE_KEY = 'classboard.state.v1';
const SETTINGS_KEY = 'classboard.settings.v1';

function desktopDefaults() {
  return {
    theme: 'flat',
    view: 'week',
    weekdayStart: 1,
    showFields: { name: true, teacher: true, room: true, time: true, category: false, credit: false },
    courseColorMode: 'auto',
    reminder: { enabled: true, leadMinutes: [10], sound: 'chime' },
    autostart: false,
    widgetTheme: 'auto',
    wallpaperTheme: 'auto',
    widget: { enabled: false, alwaysOnTop: true, opacity: 0.92, scale: 1, show: 'today' },
    wallpaper: { scale: 1, showClock: true, showDate: true, showNow: true, showFloating: true },
    display: { mode: 'app' },
  };
}

export function mergeSettings(mobile: MobileSettings): any {
  const base = desktopDefaults();
  return {
    ...base,
    theme: mobile.theme,
    weekdayStart: mobile.weekdayStart,
    showFields: mobile.showFields,
    reminder: { ...base.reminder, enabled: mobile.reminderEnabled, leadMinutes: [mobile.leadMinutes] },
  };
}

function normalizeMobileSettings(raw: any): MobileSettings {
  return {
    ...DEFAULT_MOBILE_SETTINGS,
    ...(raw || {}),
    theme: ['flat', 'dark', 'auto'].includes(raw?.theme) ? raw.theme : DEFAULT_MOBILE_SETTINGS.theme,
    showFields: { ...DEFAULT_MOBILE_SETTINGS.showFields, ...(raw?.showFields || {}) },
    weekdayStart: raw?.weekdayStart === 7 ? 7 : 1,
    weekViewMode: raw?.weekViewMode === 1 ? 1 : 0,
    weekFontScale: Math.min(1.6, Math.max(0.8, Number(raw?.weekFontScale) || 1)),
  };
}

export function normalizeImported(text: string, previous: AppState, source: string): AppState {
  const parsed = JSON.parse(text);
  const normalized: AppState = C.normalizeState(parsed).state;
  const next: AppState = {
    ...normalized,
    settings: previous.settings,
  };
  if (source === 'jwxt') next.adjustments = previous.adjustments;
  return next;
}

interface StoreValue {
  ready: boolean;
  state: AppState;
  now: Date;
  updateSettings: (patch: Partial<MobileSettings>) => Promise<void>;
  replaceState: (next: AppState) => Promise<void>;
  upsertCourse: (course: Course) => Promise<void>;
  deleteCourse: (id: string) => Promise<void>;
  completeFloating: (target: FloatingCourse) => Promise<void>;
  addAdjustment: (a: Adjustment) => Promise<void>;
  removeAdjustment: (index: number) => Promise<void>;
  importJson: (text: string, source: string) => Promise<{ ok: boolean; message: string }>;
  shiftStartDate: (days: number) => Promise<void>;
  setStartDate: (iso: string) => Promise<void>;
  updateWeekCount: (count: number) => Promise<void>;
  updateSections: (sections: SectionTime[]) => Promise<void>;
  clearData: () => Promise<void>;
  reload: () => Promise<void>;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<AppState>(() => {
    const base = C.defaultState();
    return { ...base, settings: DEFAULT_MOBILE_SETTINGS };
  });
  const [now, setNow] = useState(new Date());
  const stateRef = useRef(state);
  stateRef.current = state;

  const save = useCallback(async (next: AppState) => {
    const withSettings = { ...next, settings: mergeSettings(next.settings) };
    stateRef.current = next;
    setState(next);
    await AsyncStorage.setItem(STATE_KEY, JSON.stringify({ ...withSettings, settings: undefined }));
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(next.settings));
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [rawState, rawSettings] = await Promise.all([
          AsyncStorage.getItem(STATE_KEY),
          AsyncStorage.getItem(SETTINGS_KEY),
        ]);
        const settings = normalizeMobileSettings(rawSettings ? JSON.parse(rawSettings) : null);
        let base: AppState;
        if (rawState) {
          try {
            base = C.normalizeState(JSON.parse(rawState)).state;
          } catch {
            base = C.defaultState();
          }
        } else {
          base = C.defaultState();
        }
        base.settings = settings;
        stateRef.current = base;
        setState(base);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(timer);
  }, []);

  const updateSettings = useCallback(async (patch: Partial<MobileSettings>) => {
    const current = stateRef.current;
    const settings = normalizeMobileSettings({ ...current.settings, ...patch });
    await save({ ...current, settings });
  }, [save]);

  const replaceState = useCallback(async (next: AppState) => {
    await save({ ...next, settings: stateRef.current.settings });
  }, [save]);

  const upsertCourse = useCallback(async (course: Course) => {
    const current = stateRef.current;
    const id = course.id || C.uid('c');
    const fixed = { ...course, id };
    const list = current.courses.filter((c) => c.id !== id);
    list.push(fixed);
    list.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
    await save({ ...current, courses: list });
  }, [save]);

  const deleteCourse = useCallback(async (id: string) => {
    const current = stateRef.current;
    await save({ ...current, courses: current.courses.filter((c) => c.id !== id) });
  }, [save]);

  const completeFloating = useCallback(async (target: FloatingCourse) => {
    const current = stateRef.current;
    const floatingCourses = current.floatingCourses.map((f) => (
      !f.done && f.name === target.name && (f.teacher || '') === (target.teacher || '')
        && JSON.stringify(f.weeks) === JSON.stringify(target.weeks)
        ? { ...f, done: true }
        : f
    ));
    await save({ ...current, floatingCourses });
  }, [save]);

  const addAdjustment = useCallback(async (a: Adjustment) => {
    const current = stateRef.current;
    await save({ ...current, adjustments: [...current.adjustments, a] });
  }, [save]);

  const removeAdjustment = useCallback(async (index: number) => {
    const current = stateRef.current;
    await save({ ...current, adjustments: current.adjustments.filter((_, i) => i !== index) });
  }, [save]);

  const importJson = useCallback(async (text: string, source: string): Promise<{ ok: boolean; message: string }> => {
    try {
      const current = stateRef.current;
      const next = normalizeImported(text, current, source);
      await save(next);
      return { ok: true, message: `已导入 ${next.courses.length} 门课 / ${next.courses.reduce((n, c) => n + c.slots.length, 0)} 个时间片` };
    } catch (err: any) {
      return { ok: false, message: err?.message || 'JSON 格式不正确' };
    }
  }, [save]);

  const shiftStartDate = useCallback(async (days: number) => {
    const current = stateRef.current;
    const startDate = C.addDays(current.termConfig.startDate, days);
    await save({ ...current, termConfig: { ...current.termConfig, startDate } });
  }, [save]);

  const setStartDate = useCallback(async (iso: string) => {
    if (!C.isIsoDate(iso)) return;
    const current = stateRef.current;
    await save({ ...current, termConfig: { ...current.termConfig, startDate: C.mondayOf(iso) } });
  }, [save]);

  const updateWeekCount = useCallback(async (count: number) => {
    const current = stateRef.current;
    const weekCount = Math.max(1, Math.min(60, Math.round(count)));
    await save({ ...current, termConfig: { ...current.termConfig, weekCount } });
  }, [save]);

  const updateSections = useCallback(async (sections: SectionTime[]) => {
    if (!sections.length) return;
    const current = stateRef.current;
    await save({ ...current, termConfig: { ...current.termConfig, sections } });
  }, [save]);

  const clearData = useCallback(async () => {
    const base = C.defaultState();
    base.settings = stateRef.current.settings;
    await save(base);
  }, [save]);

  const reload = useCallback(async () => {
    const raw = await AsyncStorage.getItem(STATE_KEY);
    if (!raw) return;
    const next = C.normalizeState(JSON.parse(raw)).state;
    next.settings = stateRef.current.settings;
    setState(next);
    stateRef.current = next;
  }, []);

  const value = useMemo<StoreValue>(() => ({
    ready,
    state,
    now,
    updateSettings,
    replaceState,
    upsertCourse,
    deleteCourse,
    completeFloating,
    addAdjustment,
    removeAdjustment,
    importJson,
    shiftStartDate,
    setStartDate,
    updateWeekCount,
    updateSections,
    clearData,
    reload,
  }), [
    ready, state, now, updateSettings, replaceState, upsertCourse, deleteCourse,
    completeFloating, addAdjustment, removeAdjustment, importJson, shiftStartDate,
    setStartDate, updateWeekCount, updateSections, clearData, reload,
  ]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}
