import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';

import native from '../../../modules/maker-print-native';
import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { pageSizePt } from '@/engine/route';
import { useTheme } from '@/hooks/use-theme';
import { decodeSvgText } from '@/import/assets';
import { t } from '@/i18n';
import { isDebugScreenBuild } from '@/lib/debug';
import { writeDocumentText } from '@/lib/files';
import { printPdfFile } from '@/lib/print';
import { runCaps, type CapRow } from '@/lib/selftest/caps';
import { fixtureFile, runSelfTest, writeFixturePdf } from '@/lib/selftest';

/**
 * Debug (development and preview builds only, V1_PLAN rule 15, D82): engine self-test on Hermes ("SELFTEST OK n/n"), engine limits,
 * and the referee fixture PDFs through both print routes for the virtual-printer measurements (A7). Results are written
 * to the app's documents folder (selftest.json, caps.json, prints.json) for the Mac to pull.
 * Deep link: makerprint-dev://debug?run=selftest|caps
 */
const PRINT_FIXTURES = ['09-calibration-a4', '10-calibration-letter', '08-ruler-w4', '14-letter-turned-assets', '15-a4-landscape-single-corrected'];
const prints: unknown[] = [];

export default function DebugScreen() {
  const theme = useTheme();
  const { run } = useLocalSearchParams<{ run?: string }>();
  const [selftest, setSelftest] = useState('');
  const [failures, setFailures] = useState<string[]>([]);
  const [caps, setCaps] = useState('');
  const [capRows, setCapRows] = useState<CapRow[]>([]);
  const [printOut, setPrintOut] = useState('');
  const started = useRef(false);

  async function doSelftest() {
    setSelftest(t('debug.running', { done: 0 }));
    const r = await runSelfTest((done) => setSelftest(t('debug.running', { done })));
    const passed = r.checks.filter((c) => c.ok).length;
    writeDocumentText('selftest.json', JSON.stringify({ platform: Platform.OS, ms: r.ms, checks: r.checks }, null, 1));
    setFailures(r.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail ?? ''}`));
    setSelftest(`${passed === r.checks.length ? 'SELFTEST OK' : 'SELFTEST FAIL'} ${passed}/${r.checks.length} (${r.ms} ms)`);
  }

  async function doCaps() {
    const rows: CapRow[] = [];
    setCaps(t('debug.running', { done: 0 }));
    const decoded = decodeSvgText(fixtureFile('svg/h04-use-bomb.svg'));
    const bomb = decoded.ok ? decoded.text : '';
    await runCaps(bomb, (row) => {
      rows.push(row);
      setCapRows([...rows]);
      setCaps(t('debug.running', { done: rows.length }));
      writeDocumentText('caps.json', JSON.stringify({ platform: Platform.OS, done: false, rows }, null, 1));
    });
    writeDocumentText('caps.json', JSON.stringify({ platform: Platform.OS, done: true, rows }, null, 1));
    setCaps(`CAPS DONE ${rows.length} rows`);
  }

  async function doPrint(name: string, forceFallback: boolean) {
    setPrintOut('…');
    try {
      const f = await writeFixturePdf(name);
      const size = pageSizePt(f.plan.pages[0]);
      const r = await printPdfFile(
        { uri: f.uri, bytes: f.bytes.length, notes: [], pageWidthPt: size.w, pageHeightPt: size.h, pages: f.plan.pages.length },
        { jobName: `${name}${forceFallback ? '-fallback' : '-exact'}`, plan: f.plan, forceFallback }
      );
      prints.push({ name, at: new Date().toISOString(), ...r });
      writeDocumentText('prints.json', JSON.stringify(prints, null, 1));
      setPrintOut(`PRINT ${name} ${r.route} completed=${r.completed} paper=${r.paperMm ? `${r.paperMm.w.toFixed(2)}x${r.paperMm.h.toFixed(2)}` : '-'} margins=${JSON.stringify(r.learnedMarginsMm)}`);
    } catch (e) {
      setPrintOut(`PRINT ERROR ${String((e as Error)?.message ?? e)}`);
    }
  }

  async function doDryRun(name: string) {
    try {
      const f = await writeFixturePdf(name);
      const size = pageSizePt(f.plan.pages[0]);
      const m = 18; // 6.35 mm printable inset, like a typical office printer
      const uri = await native!.printDryRun!(f.uri, size.w, size.h, { x: m, y: m, w: size.w - 2 * m, h: size.h - 2 * m });
      prints.push({ name, dryRun: uri });
      writeDocumentText('prints.json', JSON.stringify(prints, null, 1));
      setPrintOut(`DRYRUN ${name} ${uri.split('/').pop()}`);
    } catch (e) {
      setPrintOut(`DRYRUN ERROR ${String((e as Error)?.message ?? e)}`);
    }
  }

  useEffect(() => {
    if (started.current || !isDebugScreenBuild()) return;
    started.current = true;
    // started from a deep link: run after this render (never setState synchronously inside the effect)
    const id = setTimeout(() => {
      if (run === 'selftest') doSelftest();
      else if (run === 'caps') doCaps();
    }, 0);
    return () => clearTimeout(id);
  }, [run]);

  // production: a stray makerprint://debug link lands on the projects list instead of a blank screen (REVIEW_V1 finding 19)
  if (!isDebugScreenBuild()) return <Redirect href="/" />;
  return (
    <ScrollView testID="debug-screen" style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
      <Button testID="run-selftest" label={t('debug.selftest')} onPress={doSelftest} />
      <ThemedText testID="selftest-result">{selftest}</ThemedText>
      {failures.map((f) => (
        <ThemedText key={f} type="small">
          {f}
        </ThemedText>
      ))}
      <Button testID="run-caps" label={t('debug.caps')} variant="secondary" onPress={doCaps} />
      <ThemedText testID="caps-result">{caps}</ThemedText>
      {capRows.map((r, i) => (
        <ThemedText key={i} type="small">{`${r.ok ? 'ok' : 'NO'} ${r.probe}${r.n ? ` ${r.n}` : ''}: ${r.ms} ms${r.maxBlockMs !== undefined ? `, block ${r.maxBlockMs} ms` : ''} ${r.detail ?? ''}`}</ThemedText>
      ))}
      <ThemedText testID="print-outcome">{printOut}</ThemedText>
      {PRINT_FIXTURES.map((name) => (
        <View key={name} style={styles.row}>
          <Button testID={`print-${name}-exact`} label={t('debug.printExact', { name })} variant="secondary" onPress={() => doPrint(name, false)} />
          <Button testID={`print-${name}-fallback`} label={t('debug.printFallback', { name })} variant="secondary" onPress={() => doPrint(name, true)} />
          {Platform.OS === 'ios' && native?.printDryRun ? <Button testID={`dryrun-${name}`} label={t('debug.dryRun', { name })} variant="secondary" onPress={() => doDryRun(name)} /> : null}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.two },
  row: { gap: Spacing.one },
});
