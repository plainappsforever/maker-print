// Settings (SPEC §9.6, §7 settings; D22): units and inch style, default paper, margin, overlap, check bar, PPI target,
// language, theme; links to printer profiles, calibration, help and privacy. Every change is saved at once.
import Constants from 'expo-constants';
import { Link, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { paperLabel } from '@/components/editor-panels';
import { Chips, LengthField, ToggleRow } from '@/components/fields';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useSQLiteContext } from '@/db/provider';
import { getAppSettings, setAppSetting, type AppSettings } from '@/db/settings';
import type { PaperKey } from '@/engine/paper';
import { useTheme } from '@/hooks/use-theme';
import { getUiLanguage, setUiLanguage, t, type TranslationKey } from '@/i18n';
import { isDevBuild } from '@/lib/debug';
import { deviceRegion, resolveLanguage } from '@/lib/locale';
import { applyThemePreference } from '@/lib/theme-preference';

const PAPERS: PaperKey[] = ['a4', 'letter', 'a3', 'a5', 'a6', 'legal', 'tabloid'];

export default function SettingsScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const [s, setS] = useState<AppSettings | null>(null);
  const lang = getUiLanguage();

  useEffect(() => {
    getAppSettings(db, deviceRegion()).then(setS);
  }, [db]);

  async function change<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    if (!s) return;
    setS({ ...s, [key]: value });
    await setAppSetting(db, key, value);
    if (key === 'theme') applyThemePreference(value as AppSettings['theme']);
    // a new language re-mounts the screens (the app returns to Projects, now in that language)
    if (key === 'language') setUiLanguage(resolveLanguage(value as AppSettings['language']));
  }

  if (!s) return <View testID="settings-screen" style={[styles.flex, { backgroundColor: theme.background }]} />;
  const prefs = { unit: s.units, inchStyle: s.inchStyle, locale: lang };
  const link = (href: Href, label: string, testID: string) => (
    <Link href={href} asChild>
      <Pressable testID={testID} accessibilityRole="link" hitSlop={6} style={StyleSheet.flatten([styles.link, { backgroundColor: theme.backgroundElement }])}>
        <ThemedText>{label}</ThemedText>
        <ThemedText themeColor="textSecondary">›</ThemedText>
      </Pressable>
    </Link>
  );

  return (
    <ScrollView testID="settings-screen" style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled">
      {link('/settings/help', t('nav.help'), 'open-help')}
      {link('/profiles', t('nav.profiles'), 'open-profiles')}
      {link('/calibrate', t('nav.calibrate'), 'open-calibrate-settings')}

      <ThemedText type="smallBold" style={styles.section}>
        {t('settings.language')}
      </ThemedText>
      <Chips testID="set-language" value={s.language} onChange={(v) => change('language', v)} options={(['system', 'en', 'de'] as const).map((v) => ({ value: v, label: t(`settings.lang.${v}` as TranslationKey) }))} />

      <ThemedText type="smallBold" style={styles.section}>
        {t('settings.appearance')}
      </ThemedText>
      <Chips testID="theme" value={s.theme} onChange={(v) => change('theme', v)} options={(['system', 'light', 'dark'] as const).map((v) => ({ value: v, label: t(`settings.theme.${v}` as TranslationKey) }))} />


      <ThemedText type="smallBold" style={styles.section}>
        {t('settings.units')}
      </ThemedText>
      <Chips testID="set-units" value={s.units} onChange={(v) => change('units', v)} options={(['mm', 'cm', 'in'] as const).map((v) => ({ value: v, label: t(`settings.unit.${v}` as TranslationKey) }))} />
      {s.units === 'in' ? (
        <Chips testID="set-inch" value={s.inchStyle} onChange={(v) => change('inchStyle', v)} options={(['fraction16', 'fraction32', 'decimal'] as const).map((v) => ({ value: v, label: t(`settings.inch.${v}` as TranslationKey) }))} />
      ) : null}

      <ThemedText type="smallBold" style={styles.section}>
        {t('settings.defaultPaper')}
      </ThemedText>
      <Chips testID="set-paper" value={s.defaultPaper} onChange={(v) => change('defaultPaper', v)} options={PAPERS.map((k) => ({ value: k, label: paperLabel(k) }))} />

      <View style={styles.fields}>
        <LengthField label={t('settings.margin')} testID="set-margin" valueMm={s.defaultMarginMm} prefs={prefs} kind="gap" onCommit={(mm) => change('defaultMarginMm', Math.min(mm, 50))} />
        <LengthField label={t('settings.overlap')} testID="set-overlap" valueMm={s.defaultOverlapMm} prefs={prefs} kind="gap" onCommit={(mm) => change('defaultOverlapMm', Math.min(mm, 100))} />
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {t('settings.marginWhy')}
      </ThemedText>
      <ToggleRow label={t('print.checkBar')} testID="set-check-bar" value={s.checkBar} onChange={(v) => change('checkBar', v)} />

      <ThemedText type="smallBold" style={styles.section}>
        {t('settings.ppi')}
      </ThemedText>
      <Chips testID="set-ppi" value={s.ppiTarget} onChange={(v) => change('ppiTarget', v)} options={([150, 300, 600] as const).map((v) => ({ value: v, label: `${v} PPI` }))} />

      <View style={styles.section}>{link('/settings/about', t('nav.about'), 'open-about')}</View>
      {isDevBuild() ? (
        <Link href="/debug" asChild>
          <Pressable testID="open-debug" accessibilityRole="link" hitSlop={8}>
            <ThemedText themeColor="tint">{t('debug.open')}</ThemedText>
          </Pressable>
        </Link>
      ) : null}
      <ThemedText type="small" themeColor="textSecondary">
        {t('settings.version', { version: String(Constants.expoConfig?.version), variant: String(Constants.expoConfig?.extra?.appVariant) })}
      </ThemedText>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.two, paddingBottom: 64 },
  section: { marginTop: Spacing.three },
  fields: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.two },
  link: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: Spacing.three, borderRadius: 12 },
});
