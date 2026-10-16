// One printer profile (SPEC §9.5): name, notes, margins (learned / typed / not known; learned below 3 mm are used as
// 3 mm, D76), its saved corrections per paper × job kind, delete.
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { LengthField, SmallButton } from '@/components/fields';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { deleteCalibration, listCalibrations, type Calibration } from '@/db/calibrations';
import { deleteProfile, forgetProfilePrinter, getProfile, updateProfile, type Profile } from '@/db/profiles';
import { useSQLiteContext } from '@/db/provider';
import { getAppSettings, type AppSettings } from '@/db/settings';
import { usableProfileMargins } from '@/editor/output';
import { factor } from '@/editor/print-job';
import { getPaper, OFFICE_MARGIN_MM, uniformMargins, type Margins } from '@/engine/paper';
import { useTheme } from '@/hooks/use-theme';
import { getUiLanguage, t, type TranslationKey } from '@/i18n';
import { deviceRegion } from '@/lib/locale';

const fmt = (v: number) => (Math.round(v * 100) / 100).toString();
const SIDES = ['l', 't', 'r', 'b'] as const;

export default function ProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = Number(id);
  const db = useSQLiteContext();
  const theme = useTheme();
  const router = useRouter();
  const lang = getUiLanguage();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [calibrations, setCalibrations] = useState<Calibration[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');

  const reload = async () => {
    const p = await getProfile(db, pid);
    setProfile(p);
    setCalibrations(await listCalibrations(db, pid));
    return p;
  };
  useEffect(() => {
    let alive = true;
    Promise.all([getProfile(db, pid), listCalibrations(db, pid), getAppSettings(db, deviceRegion())]).then(([p, c, s]) => {
      if (!alive) return;
      setProfile(p);
      setCalibrations(c);
      setSettings(s);
      setName(p?.name ?? '');
      setNotes(p?.notes ?? '');
    });
    return () => {
      alive = false;
    };
  }, [db, pid]);

  if (!profile || !settings) return <View testID="profile-screen" style={[styles.flex, { backgroundColor: theme.background }]} />;
  const used = usableProfileMargins(profile);
  const typed = profile.marginsSource === 'typed' && profile.margins ? profile.margins : null;
  const setMargin = async (side: (typeof SIDES)[number], mm: number) => {
    const m: Margins = { ...(typed ?? profile.margins ?? uniformMargins(OFFICE_MARGIN_MM)), [side]: mm };
    await updateProfile(db, pid, { margins: m, marginsSource: 'typed' });
    await reload();
  };
  const prefs = { unit: settings.units, inchStyle: settings.inchStyle, locale: lang };

  return (
    <ScrollView testID="profile-screen" style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled">
      <ThemedText type="small" themeColor="textSecondary">
        {t('profiles.name')}
      </ThemedText>
      <TextInput
        testID="profile-name"
        value={name}
        onChangeText={setName}
        onEndEditing={() => name.trim() && updateProfile(db, pid, { name }).then(reload)}
        returnKeyType="done"
        style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
      />
      <ThemedText type="small" themeColor="textSecondary">
        {t('profiles.notes')}
      </ThemedText>
      <TextInput
        testID="profile-notes"
        value={notes}
        onChangeText={setNotes}
        onEndEditing={() => updateProfile(db, pid, { notes }).then(reload)}
        multiline
        style={[styles.input, styles.notes, { color: theme.text, backgroundColor: theme.backgroundElement }]}
      />
      {profile.lastPrinterName ? (
        <ThemedText type="small" themeColor="textSecondary">
          {t('profiles.lastPrinter', { name: profile.lastPrinterName })}
        </ThemedText>
      ) : null}
      {profile.printerId ? (
        <SmallButton label={t('profiles.forgetPrinter')} testID="profile-forget-printer" onPress={() => forgetProfilePrinter(db, pid).then(reload)} />
      ) : null}

      <ThemedText type="smallBold">{t('profiles.margins')}</ThemedText>
      <ThemedText testID="profile-margins" type="small">
        {profile.margins
          ? t('cal.ui.marginsKnown', { source: t(`cal.ui.source.${profile.marginsSource}` as TranslationKey), l: fmt(profile.margins.l), t: fmt(profile.margins.t), r: fmt(profile.margins.r), b: fmt(profile.margins.b) })
          : t('profiles.marginsDefault', { m: fmt(settings.defaultMarginMm) })}
      </ThemedText>
      {used && profile.margins && JSON.stringify(used) !== JSON.stringify(profile.margins) ? (
        <ThemedText testID="profile-margins-used" type="small" themeColor="textSecondary">
          {t('profiles.marginsUsed', { l: fmt(used.l), t: fmt(used.t), r: fmt(used.r), b: fmt(used.b) })}
        </ThemedText>
      ) : null}
      <ThemedText type="small" themeColor="textSecondary">
        {t('profiles.typeMargins')}
      </ThemedText>
      <View style={styles.fields}>
        {SIDES.map((side) => (
          <LengthField key={side} label={t(`profiles.side.${side}` as TranslationKey)} testID={`profile-margin-${side}`} valueMm={(typed ?? used ?? uniformMargins(settings.defaultMarginMm))[side]} prefs={prefs} kind="gap" onCommit={(mm) => setMargin(side, mm)} />
        ))}
      </View>
      {profile.margins ? <SmallButton label={t('profiles.forgetMargins')} testID="profile-forget-margins" onPress={() => updateProfile(db, pid, { margins: null }).then(reload)} /> : null}

      <ThemedText type="smallBold">{t('profiles.corrections')}</ThemedText>
      {calibrations.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          {t('profiles.noCorrections')}
        </ThemedText>
      ) : null}
      {calibrations.map((c) => (
        <View key={c.id} testID={`calibration-${c.paperKey}-${c.jobKind}`} style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="small">
            {t('profiles.correction', {
              paper: getPaper(c.paperKey).label,
              kind: t(`print.jobKind.${c.jobKind}` as TranslationKey),
              fx: factor(c.fx),
              fy: factor(c.fy),
              a: fmt(c.measuredX),
              na: fmt(c.nominalX),
              b: fmt(c.measuredY),
              nb: fmt(c.nominalY),
              date: new Date(c.measuredAt).toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric' }),
            })}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {c.printerName ? t('print.measuredOn', { printer: c.printerName }) : c.route === 'export' ? t('profiles.measuredElsewhere') : ''}
          </ThemedText>
          <SmallButton label={t('profiles.removeCorrection')} testID={`remove-calibration-${c.paperKey}-${c.jobKind}`} danger onPress={() => deleteCalibration(db, c.id).then(reload)} />
        </View>
      ))}

      <View style={styles.danger}>
        <SmallButton
          label={t('profiles.delete')}
          testID="profile-delete"
          danger
          onPress={() =>
            Alert.alert(t('profiles.deleteTitle', { name: profile.name }), t('profiles.deleteBody'), [
              { text: t('common.cancel'), style: 'cancel' },
              { text: t('projects.delete'), style: 'destructive', onPress: () => deleteProfile(db, pid).then(() => router.back()) },
            ])
          }
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.two, paddingBottom: 64 },
  input: { minHeight: 40, borderRadius: 8, paddingHorizontal: 10, fontSize: 16 },
  notes: { minHeight: 64, paddingTop: 8 },
  fields: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  card: { padding: Spacing.two, borderRadius: 10, gap: 6 },
  danger: { marginTop: Spacing.four, alignItems: 'flex-start' },
});
