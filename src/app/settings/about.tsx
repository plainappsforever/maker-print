// Privacy & about (SPEC §13): what the app keeps, what it never does, the privacy policy online and the open-source
// parts it is built from (v1.1, RELEASE_KIT 1c items 12, 13, 15).
import Constants from 'expo-constants';
import { Link, type Href } from 'expo-router';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { PRIVACY_URL } from '@/constants/links';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

export default function AboutScreen() {
  const theme = useTheme();
  const row = StyleSheet.flatten([styles.link, { backgroundColor: theme.backgroundElement }]);
  return (
    <ScrollView testID="about-screen" style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
      <ThemedText type="smallBold">{t('about.privacy.title')}</ThemedText>
      <ThemedText testID="about-privacy">{t('about.privacy.body')}</ThemedText>
      <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="small">{t('about.files')}</ThemedText>
        {/* Android: allowBackup is off (D82), so the phone's backup does NOT hold the projects (RELEASE_KIT 1c item 12) */}
        <ThemedText testID="about-backup" type="small">
          {t(Platform.OS === 'android' ? 'about.backup.android' : 'about.backup.ios')}
        </ThemedText>
      </View>
      <Pressable testID="about-privacy-link" accessibilityRole="link" hitSlop={6} style={row} onPress={() => void Linking.openURL(PRIVACY_URL)}>
        <ThemedText>{t('about.privacyLink')}</ThemedText>
        <ThemedText themeColor="textSecondary">↗</ThemedText>
      </Pressable>
      <ThemedText type="small" themeColor="textSecondary">
        {t('about.privacyLinkNote')}
      </ThemedText>
      <ThemedText type="smallBold">{t('about.honest.title')}</ThemedText>
      <ThemedText type="small">{t('about.honest.body')}</ThemedText>
      <ThemedText type="smallBold">{t('about.credits.title')}</ThemedText>
      <ThemedText type="small">{t('about.credits.body')}</ThemedText>
      <Link href={'/settings/licences' as Href} asChild>
        <Pressable testID="open-licences" accessibilityRole="link" hitSlop={6} style={row}>
          <ThemedText>{t('nav.licences')}</ThemedText>
          <ThemedText themeColor="textSecondary">›</ThemedText>
        </Pressable>
      </Link>
      <ThemedText type="small" themeColor="textSecondary">
        {t('settings.version', { version: String(Constants.expoConfig?.version), variant: String(Constants.expoConfig?.extra?.appVariant) })}
      </ThemedText>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.three, paddingBottom: 64 },
  card: { padding: Spacing.three, borderRadius: 12, gap: Spacing.two },
  link: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: Spacing.three, borderRadius: 12 },
});
