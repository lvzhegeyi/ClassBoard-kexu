import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import type { ThemeMode } from './types';

export interface Palette {
  paper: string;
  paperDeep: string;
  surface: string;
  surfaceHi: string;
  ink: string;
  ink2: string;
  ink3: string;
  ink4: string;
  line: string;
  accent: string;
  accentDeep: string;
  onAccent: string;
  accentSoft: string;
  danger: string;
  isDark: boolean;
}

export const LIGHT: Palette = {
  paper: '#F3F4F0',
  paperDeep: '#E9EDE6',
  surface: '#FCFCFA',
  surfaceHi: '#FFFFFF',
  ink: '#23282A',
  ink2: '#4C5353',
  ink3: '#7C8382',
  ink4: '#A8AEAA',
  line: '#E1E4DC',
  accent: '#6B8A78',
  accentDeep: '#587564',
  onAccent: '#FFFFFF',
  accentSoft: 'rgba(107,138,120,0.10)',
  danger: '#B06A5E',
  isDark: false,
};

export const DARK: Palette = {
  paper: '#141715',
  paperDeep: '#101312',
  surface: '#1D2220',
  surfaceHi: '#232928',
  ink: '#E7EBE6',
  ink2: '#BDC6BF',
  ink3: '#8E978F',
  ink4: '#6A746D',
  line: '#2E3733',
  accent: '#8FB49D',
  accentDeep: '#A8C9B4',
  onAccent: '#10140F',
  accentSoft: 'rgba(143,180,157,0.14)',
  danger: '#CF9187',
  isDark: true,
};

export const COURSE_COLORS = [
  '#7E9B84', '#B2866F', '#BFAA7E', '#7F93A3', '#96A06F',
  '#A28898', '#79999A', '#B99A5D', '#8B8FA6', '#B08585',
];

export function courseColor(index: number): string {
  return COURSE_COLORS[((index % 10) + 10) % 10];
}

export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

interface ThemeContextValue {
  mode: ThemeMode;
  palette: Palette;
}

const ThemeContext = createContext<ThemeContextValue>({ mode: 'flat', palette: LIGHT });

export function ThemeProvider({ theme, children }: { theme: ThemeMode; children: React.ReactNode }) {
  const system = useColorScheme();
  const mode = theme === 'auto' ? (system === 'dark' ? 'dark' : 'flat') : theme;
  const palette = mode === 'dark' ? DARK : LIGHT;
  const value = useMemo(() => ({ mode, palette }), [mode, palette]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

export const typography = {
  title: 21,
  heading: 17,
  body: 15,
  caption: 12,
  tiny: 10,
};
