import React, { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';
import { StoreProvider, useStore } from '../store';
import { ThemeProvider, useTheme } from '../theme';
import { setupNotifications, rescheduleReminders } from '../notifications/reminders';
import { syncLiveActivity } from '../native/liveActivity';

function ThemedStack() {
  const { palette } = useTheme();
  return (
    <>
      <StatusBar style={palette.isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          contentStyle: { backgroundColor: palette.paper },
        }}
      >
        <Stack.Screen name="index" options={{ animation: 'none' }} />
        <Stack.Screen name="course-edit" />
        <Stack.Screen name="section-times" />
        <Stack.Screen name="adjust" />
        <Stack.Screen name="import-jwxt" />
        <Stack.Screen name="import-json" />
        <Stack.Screen name="import-computer" />
      </Stack>
    </>
  );
}

function Root() {
  const { ready, state, now } = useStore();
  useColorScheme();

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled) return;
      await setupNotifications();
      if (cancelled) return;
      await rescheduleReminders(state, state.settings);
    }, 700);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ready, state.courses, state.termConfig, state.adjustments, state.settings.reminderEnabled, state.settings.leadMinutes, state.settings.sound]);

  useEffect(() => {
    if (!ready) return;
    syncLiveActivity(state, state.settings, now);
  }, [ready, state, state.settings, now]);

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ThemeProvider theme={state.settings.theme}>
      <ThemedStack />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StoreProvider>
        <Root />
      </StoreProvider>
    </SafeAreaProvider>
  );
}
