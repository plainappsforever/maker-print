import { DarkTheme, DefaultTheme, Stack, ThemeProvider, type Theme } from 'expo-router';
import type { SQLiteDatabase } from 'expo-sqlite';
import { useSyncExternalStore } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { BrandFonts, Colors } from '@/constants/theme';
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

// D24: header, back button and screen backgrounds follow the brand tokens instead of React Navigation's iOS blue.
function navigationTheme(dark: boolean): Theme {
  const base = dark ? DarkTheme : DefaultTheme;
  const c = Colors[dark ? 'dark' : 'light'];
  const font = (f: Theme['fonts']['regular']) => ({ ...f, fontFamily: BrandFonts.body });
  return {
    ...base,
    colors: { ...base.colors, primary: c.tintText, background: c.background, card: c.background, text: c.text, border: c.border },
    fonts: {
      regular: font(base.fonts.regular),
      medium: font(base.fonts.medium),
      bold: font(base.fonts.bold),
      heavy: font(base.fonts.heavy),
    },
  };
}
const NAV_THEMES = { light: navigationTheme(false), dark: navigationTheme(true) };

function Navigator() {
  const scheme = useColorScheme();
  // A language change (Settings) re-mounts the screens (key) with titles from `tt`, which depends on `language` so the
  // React Compiler does not keep the old titles memoised. The navigation state is kept: the user stays on Settings.
  const language = useSyncExternalStore(subscribeUiLanguage, getUiLanguage);
  const tt = (key: TranslationKey) => translate(language, key);
  return (
    <ThemeProvider value={NAV_THEMES[scheme === 'dark' ? 'dark' : 'light']}>
      <Stack key={language} screenOptions={{ headerTitleStyle: { fontFamily: BrandFonts.title } }}>
        <Stack.Screen name="index" options={{ title: tt('nav.projects'), headerLargeTitle: true, headerLargeTitleStyle: { fontFamily: BrandFonts.title } }} />
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
