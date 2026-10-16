import { useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from '@/db/provider';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';
import { isDevBuild, isSeedName, loadSeed } from '@/lib/debug';
import { applyThemePreference } from '@/lib/theme-preference';

/** `makerprint-dev://debug/seed?set=<name>`: wipes the data and loads a named seed (Maestro preconditions). Dev only. */
export default function SeedScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const { set } = useLocalSearchParams<{ set?: string }>();
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!isDevBuild()) return;
    if (!isSeedName(set)) return;
    loadSeed(db, set).then(() => {
      applyThemePreference('system');
      setStatus({ ok: true, text: t('debug.seedDone', { name: set }) });
    });
  }, [db, set]);

  return (
    <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
      {!isSeedName(set) ? <ThemedText testID="seed-error">{t('debug.seedUnknown', { name: String(set) })}</ThemedText> : null}
      {status ? <ThemedText testID={status.ok ? 'seed-done' : 'seed-error'}>{status.text}</ThemedText> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({ content: { padding: Spacing.three } });
