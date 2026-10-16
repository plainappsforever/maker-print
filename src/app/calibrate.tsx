// Calibrate (SPEC §9.4; D17, D18, D66, D75, D76). Step 1: printer profile + paper → print the calibration sheet through
// the exact route (and, on Android, the optional 2-page multi-page check). Step 2: type the measured bars (or answer the
// coarse bank-card check). Step 3: verdict and Save correction → used by the next print on that paper and job kind;
// "Print the corrected sheet" checks it.
import { useState, useEffect } from 'react';
import { Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { Chips, SmallButton } from '@/components/fields';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { listCalibrations, saveCalibration, type Calibration } from '@/db/calibrations';
import { createProfile, listProfiles, type Profile } from '@/db/profiles';
import { useSQLiteContext } from '@/db/provider';
import { getAppSettings, setAppSetting } from '@/db/settings';
import { calibrationTarget, cardCheckLine, evaluateCalibration, type PrintedSheet, type VerdictLine } from '@/editor/calibrate';
import { usableProfileMargins } from '@/editor/output';
import { correctionsOf, factor, type Os } from '@/editor/print-job';
import type { JobKind } from '@/engine/calibration';
import { getPaper, MIN_LEARNED_MARGIN_MM, OFFICE_MARGIN_MM, type PaperKey } from '@/engine/paper';
import { planCalibration } from '@/engine/plan';
import { useTheme } from '@/hooks/use-theme';
import { getUiLanguage, printTranslator, t, type TranslationKey } from '@/i18n';
import { deviceRegion } from '@/lib/locale';
import { printPdfFile, writePlanPdf } from '@/lib/print';
import { describeOutcome, type Line } from '@/lib/print-outcome';

const PAPERS: PaperKey[] = ['a4', 'letter', 'a3', 'a5', 'legal', 'tabloid'];
const OS: Os = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'other';
const fmt = (v: number) => (Math.round(v * 10) / 10).toString();
/**
 * The calibration sheet keeps at least 6.35 mm blank, more when the printer said it needs more (REVIEW_V1 finding 20):
 * on Android ink in the printer's strip would make the print service fit the sheet and the "correction" would be the fit.
 */
const sheetMargins = (p: Profile | null) => {
  const m = p ? usableProfileMargins(p) : null;
  const f = (v: number | undefined) => Math.max(OFFICE_MARGIN_MM, v ?? 0);
  return { l: f(m?.l), t: f(m?.t), r: f(m?.r), b: f(m?.b) };
};

export default function CalibrateScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const lang = getUiLanguage();
  const [paperKey, setPaperKey] = useState<PaperKey>('a4');
  const [profileId, setProfileId] = useState<number | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [calibrations, setCalibrations] = useState<Calibration[]>([]);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [route, setRoute] = useState<'exact' | 'fallback'>('exact');
  const [jobKind, setJobKind] = useState<JobKind>('single');
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [card, setCard] = useState<VerdictLine | null>(null);
  const [saved, setSaved] = useState<Calibration | null>(null);
  // the last calibration sheet printed in this session (finding 11, D85): the measurement is saved for THAT sheet —
  // its profile, paper and printer — whatever the chips say now
  const [printed, setPrinted] = useState<PrintedSheet | null>(null);

  const refresh = async (pid: number | null) => {
    setProfiles(await listProfiles(db));
    setCalibrations(pid ? await listCalibrations(db, pid) : []);
  };
  useEffect(() => {
    Promise.all([getAppSettings(db, deviceRegion()), listProfiles(db)]).then(async ([s, ps]) => {
      const pid = s.lastProfileId ?? ps[0]?.id ?? null;
      setProfiles(ps);
      setProfileId(pid);
      setCalibrations(pid ? await listCalibrations(db, pid) : []);
      if (PAPERS.includes(s.defaultPaper)) setPaperKey(s.defaultPaper);
    });
  }, [db]);

  async function chooseProfile(id: number) {
    setProfileId(id);
    setSaved(null);
    await setAppSetting(db, 'lastProfileId', id);
    await refresh(id);
  }
  async function addProfile() {
    const name = newName.trim();
    if (!name) return;
    const id = await createProfile(db, { name });
    setNewName('');
    await chooseProfile(id);
  }
  const profile = profiles.find((p) => p.id === profileId) ?? null;
  const ctx = { locale: lang, unit: 'mm' as const, inchStyle: 'fraction16' as const, t: printTranslator(lang) };
  const target = calibrationTarget(printed, { profileId, paperKey });
  const targetProfile = profiles.find((p) => p.id === target.profileId) ?? null;
  const chipsMoved = target.chipsMoved;
  const sheet = planCalibration({ paperKey: target.paperKey, margins: sheetMargins(targetProfile), pages: 1, ctx }).sheet;
  const nominalA = sheet.barA?.length ?? 0;
  const nominalB = sheet.barB?.length ?? 0;
  const evaluation = evaluateCalibration({ a, b, nominalA, nominalB, locale: lang, jobKind, os: OS });
  const existing = target.profileId === profileId ? (calibrations.find((c) => c.paperKey === target.paperKey && c.jobKind === jobKind) ?? null) : null;

  async function print(pages: 1 | 2, corrected = false) {
    setBusy(true);
    setLines([{ text: t('cal.ui.printing'), level: 'info' }]);
    try {
      const plan = planCalibration({ paperKey, margins: sheetMargins(profile), pages, ctx, corrections: corrected ? correctionsOf(calibrations) : undefined, applyCorrection: corrected });
      const file = await writePlanPdf(plan, { fileName: `calibration-${paperKey}-${pages}${corrected ? '-corrected' : ''}.pdf`, title: t('nav.calibrate'), checkBarCaption: t('check.measure') });
      const used = corrected ? calibrations.find((c) => c.paperKey === paperKey && c.jobKind === (pages === 2 ? 'multi' : 'single')) : undefined;
      const r = await printPdfFile(file, {
        jobName: `Maker Print calibration ${getPaper(paperKey).label}${pages === 2 ? ' (2 pages)' : ''}`,
        plan,
        db,
        profileId,
        paperKey,
        correctionFrom: used ? { printerId: used.printerId, printerName: used.printerName } : null,
      });
      if (r.completed) {
        setRoute(r.route);
        if (!corrected) {
          setPrinted({ profileId, paperKey, printerId: r.printerId, printerName: r.printerName });
          setSaved(null);
        }
        if (!corrected) setJobKind(pages === 2 ? 'multi' : 'single');
      }
      setLines(describeOutcome(r, { paperKey, os: OS, pages, profileName: profile?.name ?? null, measure: corrected ? t('cal.ui.measureAfter', { a: fmt(nominalA), b: fmt(nominalB) }) : t('cal.ui.measure', { a: fmt(nominalA), b: fmt(nominalB) }) }));
    } catch (e) {
      setLines([{ text: t('cal.ui.error', { error: String((e as Error)?.message ?? e) }), level: 'warn' }]);
    } finally {
      setBusy(false);
      await refresh(profileId);
    }
  }

  async function save() {
    if (evaluation.state !== 'result' || !evaluation.canSave || !targetProfile) return;
    const c = await saveCalibration(db, {
      profileId: targetProfile.id,
      paperKey: target.paperKey,
      jobKind,
      nominalX: nominalA,
      measuredX: evaluation.result.x.measured,
      nominalY: nominalB,
      measuredY: evaluation.result.y.measured,
      // no sheet printed from this phone in this session: measured from another print (e.g. the sample PDF on a computer)
      route: target.fromAnotherPrint ? 'export' : route,
      printerId: target.printerId,
      printerName: target.printerName,
    });
    setSaved(c);
    await refresh(profileId);
  }

  const marginsLine = !profile
    ? t('cal.ui.noPrinter')
    : profile.margins
      ? t('cal.ui.marginsKnown', { source: t(`cal.ui.source.${profile.marginsSource}` as TranslationKey), l: fmt(profile.margins.l), t: fmt(profile.margins.t), r: fmt(profile.margins.r), b: fmt(profile.margins.b) }) +
        (profile.marginsSource === 'learned' && Math.min(profile.margins.l, profile.margins.t, profile.margins.r, profile.margins.b) < MIN_LEARNED_MARGIN_MM ? ` ${t('cal.ui.marginFloor')}` : '')
      : t('cal.ui.marginsUnknown');
  const kindLabel = (k: JobKind) => t(`print.jobKind.${k}` as TranslationKey);

  return (
    <ScrollView testID="calibrate-screen" style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled">
      <ThemedText>{t('cal.ui.intro')}</ThemedText>
      <ThemedText type="smallBold">{t('cal.ui.step1')}</ThemedText>
      {profiles.length ? <Chips testID="cal-profile" value={profileId} onChange={(id) => void chooseProfile(id)} options={profiles.map((p) => ({ value: p.id, label: p.name }))} /> : null}
      <View style={styles.row}>
        <TextInput
          testID="cal-new-profile"
          value={newName}
          onChangeText={setNewName}
          placeholder={t('cal.ui.newPrinter')}
          placeholderTextColor={theme.textSecondary}
          returnKeyType="done"
          onSubmitEditing={() => void addProfile()}
          style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        />
        <SmallButton label={t('cal.ui.addPrinter')} testID="cal-add-profile" disabled={!newName.trim()} onPress={() => void addProfile()} />
      </View>
      <ThemedText testID="cal-profile-margins" type="small" themeColor="textSecondary">
        {marginsLine}
      </ThemedText>
      <ThemedText type="smallBold">{t('cal.ui.paper')}</ThemedText>
      <Chips testID="paper" value={paperKey} onChange={(k) => { setPaperKey(k); setSaved(null); }} options={PAPERS.map((k) => ({ value: k, label: getPaper(k).label }))} />
      <ThemedText testID="cal-guidance" type="small">
        {t(OS === 'ios' ? 'print.guidance.ios' : 'print.guidance.android', { paper: getPaper(paperKey).label })}
      </ThemedText>
      <Button testID="print-calibration" label={t('cal.ui.print')} disabled={busy} onPress={() => print(1)} />
      {OS === 'android' ? (
        <>
          <Button testID="print-calibration-multi" variant="secondary" label={t('cal.ui.printMulti')} disabled={busy} onPress={() => print(2)} />
          <ThemedText type="small" themeColor="textSecondary">
            {t('cal.ui.multiWhy')}
          </ThemedText>
        </>
      ) : null}
      <View testID="calibration-outcome" style={styles.outcome}>
        {lines.map((l, i) => (
          <ThemedText key={i} testID={`calibration-outcome-${i}`} type="small" style={l.level === 'warn' ? styles.warn : undefined}>
            {l.text}
          </ThemedText>
        ))}
      </View>

      <ThemedText type="smallBold">{t('cal.ui.step2')}</ThemedText>
      {OS === 'android' ? (
        <Chips testID="cal-kind" value={jobKind} onChange={(k) => { setJobKind(k); setSaved(null); }} options={(['single', 'multi'] as const).map((k) => ({ value: k, label: t(`cal.ui.kind.${k}` as TranslationKey) }))} />
      ) : null}
      <View style={styles.row}>
        <View style={styles.flex}>
          <ThemedText type="small" themeColor="textSecondary">
            {t('cal.ui.fieldA', { a: fmt(nominalA) })}
          </ThemedText>
          <TextInput testID="cal-a" value={a} onChangeText={(v) => { setA(v); setSaved(null); }} placeholder={fmt(nominalA)} placeholderTextColor={theme.textSecondary} keyboardType="numbers-and-punctuation" returnKeyType="done" autoCorrect={false} style={[styles.field, { color: theme.text, backgroundColor: theme.backgroundElement }]} />
        </View>
        <View style={styles.flex}>
          <ThemedText type="small" themeColor="textSecondary">
            {t('cal.ui.fieldB', { b: fmt(nominalB) })}
          </ThemedText>
          <TextInput testID="cal-b" value={b} onChangeText={(v) => { setB(v); setSaved(null); }} placeholder={fmt(nominalB)} placeholderTextColor={theme.textSecondary} keyboardType="numbers-and-punctuation" returnKeyType="done" autoCorrect={false} style={[styles.field, { color: theme.text, backgroundColor: theme.backgroundElement }]} />
        </View>
      </View>
      {evaluation.state === 'invalid' ? (
        <ThemedText testID="cal-error" type="small" style={styles.warn}>
          {`${evaluation.field.toUpperCase()}: ${t(`units.error.${evaluation.error}` as TranslationKey)}`}
        </ThemedText>
      ) : null}
      <ThemedText type="small" themeColor="textSecondary">
        {t('cal.ui.cardIntro')}
      </ThemedText>
      <Chips testID="cal-card" value={null} onChange={(v) => setCard(cardCheckLine(v))} options={(['smaller', 'matches', 'larger'] as const).map((v) => ({ value: v, label: t(`cal.card.opt.${v}` as TranslationKey) }))} />
      {card ? (
        <ThemedText testID="cal-card-result" type="small">
          {t(card.key as TranslationKey)}
        </ThemedText>
      ) : null}

      <ThemedText type="smallBold">{t('cal.ui.step3')}</ThemedText>
      {evaluation.state === 'result' ? (
        <View style={styles.outcome}>
          {evaluation.lines.map((l, i) => (
            <ThemedText key={i} testID={`cal-verdict-${i}`} type="small">
              {t(l.key as TranslationKey, l.params)}
            </ThemedText>
          ))}
        </View>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          {t('cal.ui.enterBoth')}
        </ThemedText>
      )}
      {existing && !saved ? (
        <ThemedText testID="cal-existing" type="small" themeColor="textSecondary">
          {t('cal.ui.existing', { fx: factor(existing.fx), fy: factor(existing.fy), date: new Date(existing.measuredAt).toLocaleDateString(lang, { day: 'numeric', month: 'short' }) })}
        </ThemedText>
      ) : null}
      {!profile && evaluation.state === 'result' ? (
        <ThemedText type="small" style={styles.warn}>
          {t('cal.ui.needPrinter')}
        </ThemedText>
      ) : null}
      {evaluation.state === 'result' && !saved ? (
        <ThemedText testID="cal-target" type="small" style={chipsMoved ? styles.warn : undefined} themeColor={chipsMoved ? undefined : 'textSecondary'}>
          {!printed
            ? t('cal.ui.notPrintedHere')
            : chipsMoved
              ? t('cal.ui.printedOther', { paper: getPaper(printed.paperKey).label, printer: targetProfile?.name ?? '', now: getPaper(paperKey).label })
              : t('cal.ui.savesFor', { paper: getPaper(printed.paperKey).label, printer: targetProfile?.name ?? '' })}
        </ThemedText>
      ) : null}
      <Button testID="cal-save" label={t('cal.ui.save')} disabled={!(evaluation.state === 'result' && evaluation.canSave && targetProfile) || saved !== null} onPress={save} />
      {saved && targetProfile ? (
        <>
          <ThemedText testID="cal-saved" type="small">
            {t('cal.ui.saved', { printer: targetProfile.name, paper: getPaper(saved.paperKey).label, kind: kindLabel(saved.jobKind), fx: factor(saved.fx), fy: factor(saved.fy) })}
          </ThemedText>
          <Button testID="print-calibration-after" variant="secondary" label={t('cal.ui.printAfter')} disabled={busy} onPress={() => print(saved.jobKind === 'multi' ? 2 : 1, true)} />
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.three, paddingBottom: 64 },
  outcome: { gap: Spacing.two },
  row: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-end' },
  flex: { flex: 1, gap: 4 },
  input: { flex: 1, minHeight: 40, borderRadius: 8, paddingHorizontal: 10, fontSize: 16 },
  field: { minHeight: 40, borderRadius: 8, paddingHorizontal: 10, fontSize: 16 },
  warn: { color: '#E65100' },
});
