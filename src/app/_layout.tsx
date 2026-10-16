import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import type { SQLiteDatabase } from 'expo-sqlite';
import { useSyncExternalStore } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { openDatabase } from '@/db/migrations';
import { DatabaseProvider } from '@/db/provider';
import { getAppSettings } from '@/db/settings';
import { getUiLanguage, setUiLanguage, subscribeUiLanguage, translate, type TranslationKey } from '@/i18n';
import { deviceRegion, resolveLanguage } from '@/lib/locale';
import { applyThemePreference } from '@/lib/theme-preference';

async function initDatabase(db: SQLiteDatabase) {
  await openDatabase(db);
  // Region decides paper and unit defaults; 'system' language = the device language (D22).
  const settings = await getAppSettings(db, deviceRegion());
  setUiLanguage(resolveLanguage(settings.language));
  applyThemePreference(settings.theme);
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <DatabaseProvider onInit={initDatabase}>
        <Navigator />
      </DatabaseProvider>
    </GestureHandlerRootView>
  );
}

function Navigator() {
  const scheme = useColorScheme();
  // A language change (Settings) re-mounts the screens (key) with titles from `tt`, which depends on `language` so the
  // React Compiler does not keep the old titles memoised. The navigation state is kept: the user stays on Settings.
  const language = useSyncExternalStore(subscribeUiLanguage, getUiLanguage);
  const tt = (key: TranslationKey) => translate(language, key);
  return (
    <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack key={language}>
        <Stack.Screen name="index" options={{ title: tt('nav.projects') }} />
        <Stack.Screen name="project/[id]/index" options={{ title: tt('nav.editor') }} />
        <Stack.Screen name="project/[id]/print" options={{ title: tt('nav.print') }} />
        <Stack.Screen name="calibrate" options={{ title: tt('nav.calibrate') }} />
        <Stack.Screen name="profiles/index" options={{ title: tt('nav.profiles') }} />
        <Stack.Screen name="profiles/[id]" options={{ title: tt('nav.profile') }} />
        <Stack.Screen name="settings/index" options={{ title: tt('nav.settings') }} />
        <Stack.Screen name="settings/help" options={{ title: tt('nav.help') }} />
        <Stack.Screen name="settings/about" options={{ title: tt('nav.about') }} />
        <Stack.Screen name="settings/licences" options={{ title: tt('nav.licences') }} />
        <Stack.Screen name="debug/index" options={{ title: tt('nav.debug') }} />
        <Stack.Screen name="debug/seed" options={{ title: tt('nav.debug') }} />
      </Stack>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
