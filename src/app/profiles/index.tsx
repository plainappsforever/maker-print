// Printer profiles (SPEC §9.5; D17, D18, D76): each printer keeps its margins and its corrections per paper × job kind.
import { Link, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { SmallButton } from '@/components/fields';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { listCalibrations } from '@/db/calibrations';
import { createProfile, listProfiles, type Profile } from '@/db/profiles';
import { useSQLiteContext } from '@/db/provider';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

type Row = Profile & { calibrations: number };

export default function ProfilesScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [name, setName] = useState('');
  const load = async () => {
    const ps = await listProfiles(db);
    return Promise.all(ps.map(async (p) => ({ ...p, calibrations: (await listCalibrations(db, p.id)).length })));
  };
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      load().then((r) => alive && setRows(r));
      return () => {
        alive = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [db])
  );
  async function add() {
    if (!name.trim()) return;
    const id = await createProfile(db, { name });
    setName('');
    router.push({ pathname: '/profiles/[id]', params: { id: String(id) } });
  }
  return (
    <ScrollView testID="profiles-screen" style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled">
      <ThemedText type="small" themeColor="textSecondary">
        {t('profiles.intro')}
      </ThemedText>
      {rows.length === 0 ? <ThemedText themeColor="textSecondary">{t('profiles.empty')}</ThemedText> : null}
      {rows.map((p) => (
        <Link key={p.id} href={{ pathname: '/profiles/[id]', params: { id: String(p.id) } }} asChild>
          <Pressable testID={`profile-${p.id}`} accessibilityRole="link" style={StyleSheet.flatten([styles.card, { backgroundColor: theme.backgroundElement }])}>
            <ThemedText type="smallBold">{p.name}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {[p.lastPrinterName ? t('profiles.lastPrinter', { name: p.lastPrinterName }) : null, t(p.margins ? 'profiles.marginsSet' : 'profiles.marginsUnknown'), t('profiles.calibrations', { n: p.calibrations })].filter(Boolean).join(' · ')}
            </ThemedText>
          </Pressable>
        </Link>
      ))}
      <View style={styles.row}>
        <TextInput
          testID="profiles-new"
          value={name}
          onChangeText={setName}
          placeholder={t('cal.ui.newPrinter')}
          placeholderTextColor={theme.textSecondary}
          returnKeyType="done"
          onSubmitEditing={() => void add()}
          style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        />
        <SmallButton label={t('cal.ui.addPrinter')} testID="profiles-add" disabled={!name.trim()} onPress={() => void add()} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.three },
  card: { padding: Spacing.three, borderRadius: 12, gap: 4 },
  row: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
  input: { flex: 1, minHeight: 40, borderRadius: 8, paddingHorizontal: 10, fontSize: 16 },
});
