import { Link, type Href } from 'expo-router';
import { Pressable, ScrollView, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

/** Title-only screen until its phase builds it (V1_PLAN P1 step 3). */
export function Placeholder({ testID, links = [] }: { testID: string; links?: { href: Href; label: string; testID: string }[] }) {
  const theme = useTheme();
  return (
    <ScrollView
      testID={testID}
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic">
      <ThemedText themeColor="textSecondary">{t('placeholder.comingSoon')}</ThemedText>
      {links.map((l) => (
        <Link key={l.testID} href={l.href} asChild>
          <Pressable testID={l.testID} accessibilityRole="link" hitSlop={8}>
            <ThemedText themeColor="tint">{l.label}</ThemedText>
          </Pressable>
        </Link>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.three },
});
