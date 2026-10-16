// Help: printing at the right size (SPEC §9.6; D11, D12, L26) — per platform "Actual size" steps, including the iOS
// print dialog's Scaling control that no app can hide (P4).
import { Platform, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t, type TranslationKey } from '@/i18n';

const ORDER = Platform.OS === 'android' ? ['android', 'ios', 'acrobat', 'mac', 'shop'] : ['ios', 'android', 'acrobat', 'mac', 'shop'];

export default function HelpScreen() {
  const theme = useTheme();
  return (
    <ScrollView testID="help-screen" style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
      <ThemedText>{t('help.intro')}</ThemedText>
      {ORDER.map((k) => (
        <View key={k} testID={`help-${k}`} style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="smallBold">{t(`help.${k}.title` as TranslationKey)}</ThemedText>
          <ThemedText type="small">{t(`help.${k}.body` as TranslationKey)}</ThemedText>
        </View>
      ))}
      <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="smallBold">{t('help.check.title')}</ThemedText>
        <ThemedText type="small">{t('help.check.body')}</ThemedText>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.three, paddingBottom: 64 },
  card: { padding: Spacing.three, borderRadius: 12, gap: Spacing.two },
});
