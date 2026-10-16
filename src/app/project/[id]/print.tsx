// Print & export (SPEC §9.3; D12, D17, D18, D72, D74). Output paper, orientation, printer profile with its calibration
// status and correction switch, margins, overlap, marks / labels / assembly map / skip blank / check bar; the page
// preview rasterised from the real output PDF (tap a tile to leave it out); warnings; Print (exact route), Export PDF
// (share sheet) and, on Android for multi-page jobs, "Print pages one by one (exact)".
import { Link, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Image, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { Button } from '@/components/button';
import { paperLabel } from '@/components/editor-panels';
import { BusyOverlay, Chips, LengthField, nextFrame, ToggleRow } from '@/components/fields';
import { PageView } from '@/components/page-view';
import { listCalibrations, type Calibration } from '@/db/calibrations';
import { listProfiles, updateProfile, type Profile } from '@/db/profiles';
import { useSQLiteContext } from '@/db/provider';
import { updateProject, type ProjectPatch } from '@/db/projects';
import { setAppSetting, type AppSettings } from '@/db/settings';
import { effectiveMargins, marginsBelowPrinter, planProject, planSummary, printerReportedMargins, printPlanFor, type ProjectDoc } from '@/editor/output';
import { calibrationStatus, correctionsOf, exportFileName, factor, needsConfirm, printMode, singlePagePlan, type Os } from '@/editor/print-job';
import { pickCorrection } from '@/engine/calibration';
import type { GenContext } from '@/engine/generators';
import { getPaper, type PaperKey } from '@/engine/paper';
import type { PrintPlan, Warning } from '@/engine/plan';
import { tileKey } from '@/engine/tiles';
import { useTheme } from '@/hooks/use-theme';
import { usePdfPreview } from '@/hooks/use-pdf-preview';
import { getUiLanguage, printTranslator, t, type TranslationKey } from '@/i18n';
import { loadOutputContext, loadProjectDoc, previewUris, projectAssetLoader } from '@/lib/doc';
import { printPdfFile, writePlanPdf, type PrintOutcome } from '@/lib/print';
import { describeOutcome, type Line } from '@/lib/print-outcome';
import { sharePdf } from '@/lib/share';

const OUTPUT_PAPERS: PaperKey[] = ['a4', 'letter', 'a3', 'a5', 'legal', 'tabloid'];
const OS: Os = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'other';
type Loaded = { doc: ProjectDoc; settings: AppSettings; profile: Profile | null; profiles: Profile[]; calibrations: Calibration[]; previews: Record<string, string> };

/** SVGs from this size on make the preview write take seconds on a phone (D64, finding 10) */
const HEAVY_SVG_BYTES = 1_000_000;
const fileBase = (name: string) => name.replace(/[^\w-]+/g, '_').slice(0, 40) || 'print';

export default function PrintScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const projectId = Number(id);
  const db = useSQLiteContext();
  const theme = useTheme();
  const { width, scale } = useWindowDimensions();
  const lang = getUiLanguage();
  const [data, setData] = useState<Loaded | null>(null);
  const [applyCorrection, setApplyCorrection] = useState(true);
  const [oneByOneChoice, setOneByOneChoice] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [resumeFrom, setResumeFrom] = useState<number | null>(null);
  // D85: the last print went to another printer than the correction's — offer the uncorrected safe route
  const [offerSafeRoute, setOfferSafeRoute] = useState(false);

  const load = async (): Promise<Loaded | null> => {
    const doc = await loadProjectDoc(db, projectId);
    if (!doc) return null;
    const o = await loadOutputContext(db, doc.project.profileId);
    const profiles = await listProfiles(db);
    const calibrations = o.profile ? await listCalibrations(db, o.profile.id) : [];
    return { doc, settings: o.settings, profile: o.profile, profiles, calibrations, previews: await previewUris(doc) };
  };
  const reload = async () => {
    const d = await load();
    if (d) setData(d);
  };
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      load().then((d) => alive && d && setData(d));
      return () => {
        alive = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [db, projectId])
  );

  const ctx: GenContext = { locale: lang, unit: data?.settings.units ?? 'mm', inchStyle: data?.settings.inchStyle ?? 'fraction16', t: printTranslator(lang) };
  const paperKey = data?.doc.project.paperKey ?? 'a4';
  const base = data ? planProject(data.doc, data.settings, data.profile, ctx) : null;
  const mode = printMode(OS, base?.pages.length ?? 0, data?.calibrations ?? [], paperKey);
  const oneByOne = mode.offerOneByOne && (oneByOneChoice ?? mode.defaultOneByOne);
  const corrections = correctionsOf(data?.calibrations ?? []);
  const kind = oneByOne ? 'single' : mode.correctionJobKind;
  const available = pickCorrection(corrections, paperKey, kind);
  // an enlarging correction widens the margins so the corrected ink stays inside the printer's margins (D77, D83)
  const printing = data ? printPlanFor(data.doc, data.settings, data.profile, ctx, { os: OS, corrections, applyCorrection, oneByOne, correctionJobKind: mode.correctionJobKind }) : null;
  const planFor = (opts: { forExport?: boolean } = {}): PrintPlan | null =>
    data ? (opts.forExport ? planProject(data.doc, data.settings, data.profile, ctx, { applyCorrection: false }) : printing!.plan) : null;
  const plan = planFor();
  const blocked = !plan || plan.pages.length === 0 || plan.warnings.some((w) => w.level === 'error');
  const checkCaption = t('check.measure');
  const write = (p: PrintPlan, fileName: string, caption = checkCaption) =>
    writePlanPdf(p, { fileName, title: data!.doc.project.name, checkBarCaption: caption, loadAsset: projectAssetLoader(data!.doc), languages: [lang] });

  const cols = width > 600 ? 4 : 3;
  const thumbW = Math.floor((width - 32 - (cols - 1) * 10) / cols);
  // everything the written PDF depends on (finding 18: settings and units too), so the preview is never stale and Print
  // can reuse the preview's PDF instead of writing it again (finding 10)
  const previewKey =
    data && plan && !blocked
      ? JSON.stringify([data.doc.project, data.doc.sheets, data.doc.objects, data.doc.assets.map((a) => [a.id, a.file, a.svgPxPerIn]), data.settings, data.profile, corrections, applyCorrection, oneByOne, mode.correctionJobKind, lang, checkCaption])
      : null;
  // a big drawing blocks the JS thread while the preview PDF is written (D64): say so instead of a frozen screen
  const heavy = !!data && data.doc.assets.some((a) => a.kind === 'svg' && a.bytes >= HEAVY_SVG_BYTES);
  const preview = usePdfPreview(previewKey, () => (plan ? write(plan, 'preview.pdf') : Promise.resolve(null)), Math.round(thumbW * Math.min(scale, 2) * 1.414), heavy ? nextFrame : undefined);
  const rastered = preview.pages;

  const set = async (p: ProjectPatch) => {
    await updateProject(db, projectId, p);
    await reload();
  };

  if (!data || !plan || !base) return <View testID="print-screen" style={[styles.flex, { backgroundColor: theme.background }]} />;
  const { doc, settings, profile, profiles, calibrations } = data;
  const s = planSummary(plan);
  const tiled = s.tiles > 0;
  const checkBar = doc.project.checkBar ?? settings.checkBar;
  const { own, margins } = printing!;
  const widened = JSON.stringify(margins) !== JSON.stringify(own);
  // finding 8: own / typed / default margins smaller than what the profile's printer reported
  const printerNeeds = profile ? marginsBelowPrinter(own, printerReportedMargins(profile)) : null;
  async function takePrinterMargins() {
    if (!printerNeeds || !profile) return;
    if (doc.project.marginMm !== null) await updateProject(db, projectId, { marginMm: null });
    const after = effectiveMargins({ ...doc.project, marginMm: null }, profile, settings);
    if (marginsBelowPrinter(after, printerNeeds)) await updateProfile(db, profile.id, { margins: printerNeeds, marginsSource: 'learned' });
    await reload();
  }
  const paper = getPaper(paperKey);
  const status = profile ? calibrationStatus(calibrations, paperKey, kind) : null;
  const multiSheet = doc.sheets.length > 1;
  const excluded = plan.sheets.flatMap((st) => st.excluded.map((label) => ({ key: tileKey(st.sheetIndex, label), label: multiSheet ? `${st.sheetIndex + 1}:${label}` : label })));
  const jobName = `Maker Print ${doc.project.name}`;
  const correctionFrom = applyCorrection && available && status ? { printerId: status.printerId, printerName: status.printerName } : null;
  const printOpts = { db, profileId: profile?.id ?? null, paperKey, correctionFrom };
  const describe = (r: PrintOutcome, pages: number) =>
    describeOutcome(r, { paperKey, os: OS, pages, multiCorrected: pages > 1 && mode.multiCalibrated && applyCorrection, measure, profileName: profile?.name ?? null });
  const measure = plan.pages.some((p) => p.ops.some((op) => op.op === 'checkBar')) ? t('print.out.measureBar') : t('print.out.noBar');

  const summary = [
    s.pages === 1 ? t('print.page1') : t('print.pages', { n: s.pages }),
    s.tiles ? t('print.tiles', { n: s.tiles, paper: paperLabel(plan.paperKey), orientation: t(`orientation.${s.orientation === 'mixed' ? 'portrait' : s.orientation}` as TranslationKey) }) : t(`print.mode.${s.mode === 'mixed' ? 'single' : s.mode}` as TranslationKey, { paper: paperLabel(plan.paperKey) }),
    s.maps ? t('print.map') : null,
  ].filter(Boolean);

  const warningText = (w: Warning) => {
    const params = { ...w.params };
    if (w.code === 'correctionApplied' || w.code === 'correctionEnlarges') {
      params.fx = factor(Number(w.params.fx)).slice(1);
      params.fy = factor(Number(w.params.fy)).slice(1);
      if (w.code === 'correctionApplied') {
        params.paper = paperLabel(String(w.params.paper) as PaperKey);
        params.jobKind = t(`print.jobKind.${w.params.jobKind}` as TranslationKey);
      }
    }
    if (w.code === 'assetIncomplete') {
      params.details = (['notDrawn', 'approximated', 'notes'] as const)
        .filter((k) => Number(w.params[k]) > 0)
        .map((k) => t(`warn.assetIncomplete.${k}`, { n: Number(w.params[k]) }))
        .join(', ');
    }
    return t(`warn.${w.code}` as TranslationKey, params);
  };

  const toggleTile = (key: string) => {
    const now = doc.project.excludedTiles;
    void set({ excludedTiles: now.includes(key) ? now.filter((k) => k !== key) : [...now, key] });
  };
  const chooseProfile = async (pid: number) => {
    await setAppSetting(db, 'lastProfileId', pid);
    await set({ profileId: pid });
  };

  function takeSafeRoute() {
    setApplyCorrection(false);
    if (mode.offerOneByOne) setOneByOneChoice(true);
    setOfferSafeRoute(false);
    setLines([{ text: t('print.safeRouteSet', { oneByOne: mode.offerOneByOne ? t('print.safeRouteOneByOne') : '' }), level: 'info' }]);
  }

  const confirmMany = (n: number) =>
    new Promise<boolean>((resolve) =>
      Alert.alert(
        t('print.confirm.title', { n }),
        t(oneByOne ? 'print.confirm.oneByOne' : 'print.confirm.body', { n }),
        [
          { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
          { text: t('print.print'), onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) }
      )
    );

  async function printAll() {
    if (needsConfirm(plan!.pages.length) && !(await confirmMany(plan!.pages.length))) return;
    setLines([]);
    setResumeFrom(null);
    setOfferSafeRoute(false);
    if (oneByOne) return printPages(0);
    setBusy(t('print.busy.writing'));
    try {
      await nextFrame();
      const file = preview.file ?? (await write(plan!, `${fileBase(doc.project.name)}.pdf`));
      setBusy(null);
      const r = await printPdfFile(file, { jobName, plan: plan!, ...printOpts });
      setOfferSafeRoute(r.correctionOtherPrinter !== null);
      setLines(withNotes(describe(r, plan!.pages.length), file.notes.length));
    } catch (e) {
      setLines([{ text: t('cal.ui.error', { error: String((e as Error)?.message ?? e) }), level: 'warn' }]);
    } finally {
      setBusy(null);
      await reload();
    }
  }

  // Android "Print pages one by one (exact)" (D12, D74): every page is its own single-page job; the series stops at the
  // first page that is not printed and can continue from there.
  async function printPages(from: number) {
    const n = plan!.pages.length;
    let last: PrintOutcome | null = null;
    let notes = 0;
    setResumeFrom(null);
    try {
      for (let i = from; i < n; i++) {
        setBusy(t('print.busy.page', { n: i + 1, total: n }));
        await nextFrame();
        const one = singlePagePlan(plan!, i);
        const file = await write(one, `${fileBase(doc.project.name)}-p${i + 1}.pdf`);
        notes += file.notes.length;
        setBusy(null);
        const r = await printPdfFile(file, { jobName: `${jobName} ${i + 1}/${n}`, plan: one, ...printOpts });
        if (!r.completed) {
          setLines([{ text: i === from ? t('cal.ui.cancelled') : t('print.oneByOne.stopped', { done: i, total: n, next: i + 1 }), level: 'warn' }]);
          setResumeFrom(i);
          return;
        }
        last = r;
      }
      const tail = last ? describe(last, 1) : [];
      setOfferSafeRoute(last?.correctionOtherPrinter != null);
      setLines(withNotes([{ text: t('print.oneByOne.done', { total: n }), level: 'ok' }, ...tail], notes));
    } catch (e) {
      setLines([{ text: t('cal.ui.error', { error: String((e as Error)?.message ?? e) }), level: 'warn' }]);
    } finally {
      setBusy(null);
      await reload();
    }
  }

  async function exportPdf() {
    setLines([]);
    setResumeFrom(null);
    setBusy(t('print.busy.writing'));
    try {
      await nextFrame();
      const p = planFor({ forExport: true })!;
      const name = exportFileName(doc.project.name, paperKey, new Date());
      // an exported PDF is printed from another app: the bar also says how (REVIEW_V1 finding 17)
      const file = await write(p, name, t('check.measureExport'));
      setBusy(null);
      const shared = await sharePdf(file.uri, t('print.export'));
      setLines(
        withNotes(
          shared === 'shared'
            ? [{ text: t('print.exported', { file: name, pages: p.pages.length }), level: 'ok' }]
            : [{ text: t('print.shareUnavailable', { file: name }), level: 'warn' }],
          file.notes.length
        )
      );
    } catch (e) {
      setLines([{ text: t('cal.ui.error', { error: String((e as Error)?.message ?? e) }), level: 'warn' }]);
    } finally {
      setBusy(null);
    }
  }

  const lineColour = (l: Line) => (l.level === 'warn' ? '#E65100' : l.level === 'ok' ? theme.text : theme.textSecondary);

  return (
    <View style={styles.flex}>
      <ScrollView testID="print-screen" style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
        <Text testID="plan-summary" style={[styles.summary, { color: theme.text }]}>
          {summary.join(' · ')}
        </Text>
        <Text testID="print-guidance" style={[styles.guide, { color: theme.text, backgroundColor: theme.backgroundElement }]}>
          {t(OS === 'ios' ? 'print.guidance.ios' : 'print.guidance.android', { paper: paper.label })}
        </Text>

        {plan.warnings.length ? (
          <View testID="plan-warnings" style={styles.warnings}>
            {plan.warnings.map((w, i) => (
              <Text key={i} testID={`warning-${w.code}`} style={[styles.warning, { color: w.level === 'error' ? theme.danger : w.level === 'warn' ? '#E65100' : theme.textSecondary }]}>
                • {warningText(w)}
              </Text>
            ))}
          </View>
        ) : null}

        {mode.offerOneByOne ? (
          <View style={styles.box}>
            <ToggleRow label={t('print.oneByOne')} testID="toggle-one-by-one" value={oneByOne} onChange={setOneByOneChoice} />
            <Text testID="one-by-one-why" style={[styles.small, { color: theme.textSecondary }]}>
              {oneByOne ? t('print.oneByOne.on', { total: plan.pages.length }) : mode.multiCalibrated ? t('print.oneByOne.offCalibrated') : t('print.oneByOne.offRisk')}
            </Text>
          </View>
        ) : null}

        <View style={styles.buttons}>
          <Button testID="print-button" label={oneByOne ? t('print.printPages', { total: plan.pages.length }) : t('print.print')} disabled={blocked || busy !== null} onPress={printAll} style={styles.flex} />
          <Button testID="export-button" variant="secondary" label={t('print.export')} disabled={blocked || busy !== null} onPress={exportPdf} style={styles.flex} />
        </View>
        {lines.length ? (
          <View testID="print-outcome" style={styles.warnings}>
            {lines.map((l, i) => (
              <Text key={i} testID={`print-outcome-${i}`} style={[styles.warning, { color: lineColour(l) }]}>
                {l.text}
              </Text>
            ))}
            {resumeFrom !== null ? <Button testID="print-continue" variant="secondary" label={t('print.oneByOne.continue', { next: resumeFrom + 1 })} onPress={() => printPages(resumeFrom)} /> : null}
            {offerSafeRoute ? <Button testID="print-safe-route" variant="secondary" label={t('print.safeRoute')} onPress={takeSafeRoute} /> : null}
          </View>
        ) : null}

        <Text style={[styles.sub, { color: theme.textSecondary }]}>{t('print.preview')}</Text>
        {tiled ? <Text style={[styles.small, { color: theme.textSecondary }]}>{t('print.tapToExclude')}</Text> : null}
        <View style={styles.grid}>
          {plan.pages.map((p, i) => {
            const img = rastered?.[i];
            const landscape = p.orientation === 'landscape';
            const frameH = Math.round(thumbW * (landscape ? p.widthMm / p.heightMm : p.heightMm / p.widthMm));
            const body = img ? (
              <View testID={`page-${i + 1}-raster`} style={[styles.thumb, { width: thumbW, height: frameH }]}>
                <Image
                  source={{ uri: img.uri }}
                  style={
                    landscape
                      ? { position: 'absolute', width: frameH, height: thumbW, left: (thumbW - frameH) / 2, top: (frameH - thumbW) / 2, transform: [{ rotate: '90deg' }] }
                      : { width: thumbW, height: frameH }
                  }
                />
              </View>
            ) : (
              <PageView page={p} plan={plan} previews={data.previews} caption={checkCaption} width={thumbW} index={i} />
            );
            return (
              <Pressable key={i} testID={`page-${i + 1}`} disabled={!p.tile} onPress={() => p.tile && toggleTile(p.tile.key)} accessibilityRole={p.tile ? 'button' : undefined} style={{ width: thumbW, gap: 4 }}>
                {body}
                <Text style={[styles.label, { color: theme.textSecondary }]} numberOfLines={1}>
                  {i + 1} · {p.kind === 'map' ? t('print.mapLabel') : p.label || t(`print.kind.${p.kind}` as TranslationKey)}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {excluded.length ? (
          <View style={styles.box}>
            <Text style={[styles.small, { color: theme.textSecondary }]}>{t('print.leftOut')}</Text>
            <View style={styles.chips}>
              {excluded.map((x) => (
                <Pressable key={x.key} testID={`excluded-${x.key}`} accessibilityRole="button" onPress={() => toggleTile(x.key)} style={[styles.chip, { backgroundColor: theme.backgroundElement }]}>
                  <Text style={{ color: theme.text }}>{x.label} ↺</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
        <Text testID="preview-source" style={[styles.small, { color: theme.textSecondary }]}>
          {rastered ? t('print.previewReal') : t('print.previewPlan')}
        </Text>
        <Text style={[styles.sub, { color: theme.textSecondary }]}>{t('print.printer')}</Text>
        {profiles.length ? <Chips testID="print-profile" value={profile?.id ?? null} onChange={(pid) => void chooseProfile(pid)} options={profiles.map((p) => ({ value: p.id, label: p.name }))} /> : null}
        <Text testID="print-profile-status" style={[styles.small, { color: theme.textSecondary }]}>
          {!profile
            ? t('print.noProfile')
            : status
              ? t('print.calibrated', { date: new Date(status.measuredAt).toLocaleDateString(lang, { day: 'numeric', month: 'short' }), fx: factor(status.fx), fy: factor(status.fy), kind: t(`print.jobKind.${kind}` as TranslationKey), paper: paper.label })
              : t('print.notCalibrated', { paper: paper.label, kind: t(`print.jobKind.${kind}` as TranslationKey) })}
          {status?.printerName ? ` ${t('print.measuredOn', { printer: status.printerName })}` : ''}
        </Text>
        {!status ? (
          <Link href="/calibrate" asChild>
            <Pressable testID="print-open-calibrate" accessibilityRole="link" hitSlop={6}>
              <Text style={[styles.small, { color: theme.tint }]}>{t('nav.calibrate')} ›</Text>
            </Pressable>
          </Link>
        ) : null}
        {available ? (
          <ToggleRow label={t('print.applyCorrection', { fx: factor(available.fx), fy: factor(available.fy) })} testID="toggle-correction" value={applyCorrection} onChange={setApplyCorrection} />
        ) : null}

        <Text style={[styles.sub, { color: theme.textSecondary }]}>{t('print.paper')}</Text>
        <Chips testID="print-paper" value={doc.project.paperKey} onChange={(k) => set({ paperKey: k })} options={OUTPUT_PAPERS.map((k) => ({ value: k, label: paperLabel(k) }))} />
        <Text style={[styles.sub, { color: theme.textSecondary }]}>{t('print.orientation')}</Text>
        <Chips
          testID="print-orientation"
          value={doc.project.orientation}
          onChange={(orientation) => set({ orientation })}
          options={(['auto', 'portrait', 'landscape'] as const).map((o) => ({ value: o, label: t(`print.or.${o}` as TranslationKey) }))}
        />

        <Text testID="print-margins" style={[styles.small, { color: theme.textSecondary }]}>
          {t('print.marginsNow', { l: fmt(margins.l), t: fmt(margins.t), r: fmt(margins.r), b: fmt(margins.b), source: t(doc.project.marginMm !== null ? 'print.marginSource.project' : profile?.margins ? (profile.marginsSource === 'typed' ? 'print.marginSource.typed' : 'print.marginSource.learned') : 'print.marginSource.default') })}
        </Text>
        {widened ? (
          <Text testID="print-margins-widened" style={[styles.small, { color: theme.textSecondary }]}>
            {t('print.marginsWidened')}
          </Text>
        ) : null}
        {printerNeeds ? (
          <View testID="print-margins-below-printer" style={styles.box}>
            <Text style={[styles.small, { color: '#E65100' }]}>
              {t('print.marginsBelowPrinter', { l: fmt(printerNeeds.l), t: fmt(printerNeeds.t), r: fmt(printerNeeds.r), b: fmt(printerNeeds.b) })}
            </Text>
            <Button testID="print-use-printer-margins" variant="secondary" label={t('print.usePrinterMargins')} onPress={() => void takePrinterMargins()} />
          </View>
        ) : null}
        <ToggleRow label={t('print.ownMargin')} testID="toggle-own-margin" value={doc.project.marginMm !== null} onChange={(v) => set({ marginMm: v ? Math.round(Math.max(own.l, own.t, own.r, own.b) * 100) / 100 : null })} />
        {doc.project.marginMm !== null ? (
          <LengthField label={t('print.margin')} testID="field-margin" valueMm={doc.project.marginMm} prefs={{ unit: settings.units, inchStyle: settings.inchStyle, locale: lang }} kind="gap" onCommit={(mm) => set({ marginMm: mm })} />
        ) : null}

        {tiled ? (
          <>
            <LengthField label={t('print.overlap')} testID="field-overlap" valueMm={doc.project.overlapMm} prefs={{ unit: settings.units, inchStyle: settings.inchStyle, locale: lang }} kind="gap" onCommit={(mm) => set({ overlapMm: mm })} />
            <ToggleRow label={t('print.marks')} testID="toggle-marks" value={doc.project.marks === 'registration'} onChange={(v) => set({ marks: v ? 'registration' : 'none' })} />
            <ToggleRow label={t('print.labels')} testID="toggle-labels" value={doc.project.pageLabels} onChange={(v) => set({ pageLabels: v })} />
            <ToggleRow label={t('print.skipBlank')} testID="toggle-skip-blank" value={doc.project.skipBlank} onChange={(v) => set({ skipBlank: v })} />
            <Text style={[styles.sub, { color: theme.textSecondary }]}>{t('print.mapOption')}</Text>
            <Chips testID="print-map" value={doc.project.assemblyMap} onChange={(assemblyMap) => set({ assemblyMap })} options={(['auto', 'on', 'off'] as const).map((o) => ({ value: o, label: t(`print.mapOpt.${o}` as TranslationKey) }))} />
          </>
        ) : null}
        <ToggleRow label={t('print.checkBar')} testID="toggle-check-bar" value={checkBar} onChange={(v) => set({ checkBar: v })} />

      </ScrollView>
      <BusyOverlay text={busy ?? (heavy && preview.writing ? t('print.busy.preview') : null)} />
    </View>
  );
}

function withNotes(lines: Line[], notes: number): Line[] {
  return notes ? [...lines, { text: t('print.out.notes', { n: notes }), level: 'warn' }] : lines;
}
const fmt = (v: number) => (Math.round(v * 100) / 100).toString();

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, gap: 10, paddingBottom: 48 },
  sub: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', marginTop: 6 },
  summary: { fontSize: 17, fontWeight: '600' },
  guide: { fontSize: 14, padding: 10, borderRadius: 8, overflow: 'hidden' },
  warnings: { gap: 4 },
  warning: { fontSize: 13, lineHeight: 18 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  label: { fontSize: 12 },
  small: { fontSize: 13 },
  buttons: { flexDirection: 'row', gap: 10 },
  box: { gap: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16 },
  thumb: { overflow: 'hidden', backgroundColor: 'white', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgb(150,150,150)' },
});
