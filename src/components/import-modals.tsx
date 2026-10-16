// Import questions (SPEC §8.9, §9.7): the SVG units question (96 / 72 / 90 / custom, each with the size it gives),
// asked once per unit-less file, with the importer's report; and the PDF page chooser.
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { Asset } from '@/db/assets';
import { formatLength } from '@/engine/units';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';
import { svgSizeAt, type AssetReport } from '@/import/assets';

import { AssetReportView } from './asset-report';
import { Button } from './button';
import { NumberField, type UnitPrefs } from './fields';

const PPI_CHOICES = [
  { ppi: 96, key: 'svgUnits.96' },
  { ppi: 72, key: 'svgUnits.72' },
  { ppi: 90, key: 'svgUnits.90' },
] as const;

export function SvgUnitsModal({ asset, prefs, onPlace, onCancel }: { asset: Asset; prefs: UnitPrefs; onPlace: (ppi: number) => void; onCancel: () => void }) {
  const theme = useTheme();
  const report = asset.report as unknown as AssetReport;
  const [ppi, setPpi] = useState(96);
  const size = (v: number) => {
    const s = svgSizeAt(report, v);
    const f = (mm: number) => formatLength(mm, { unit: prefs.unit, inchStyle: prefs.inchStyle, locale: prefs.locale, withUnit: false });
    return s ? `${f(s.w)} × ${f(s.h)} ${prefs.unit}` : '—';
  };
  const custom = !PPI_CHOICES.some((c) => c.ppi === ppi);
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onCancel}>
      <ScrollView testID="svg-units" style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
        <Text style={[styles.title, { color: theme.text }]}>{t('svgUnits.title')}</Text>
        <Text style={[styles.body, { color: theme.textSecondary }]}>{t('svgUnits.why', { name: asset.originalName })}</Text>
        {PPI_CHOICES.map((c) => (
          <Pressable
            key={c.ppi}
            testID={`svg-ppi-${c.ppi}`}
            accessibilityRole="radio"
            accessibilityState={{ selected: ppi === c.ppi }}
            onPress={() => setPpi(c.ppi)}
            style={[styles.choice, { backgroundColor: ppi === c.ppi ? theme.backgroundSelected : theme.backgroundElement }]}>
            <Text style={[styles.choiceTitle, { color: theme.text }]}>{t(c.key)}</Text>
            <Text style={[styles.body, { color: theme.textSecondary }]}>{size(c.ppi)}</Text>
          </Pressable>
        ))}
        <View style={[styles.choice, { backgroundColor: custom ? theme.backgroundSelected : theme.backgroundElement }]}>
          <NumberField label={t('svgUnits.custom')} testID="svg-ppi-custom" value={ppi} min={1} max={10000} suffix="px/in" onCommit={setPpi} />
          {custom ? <Text style={[styles.body, { color: theme.textSecondary }]}>{size(ppi)}</Text> : null}
        </View>
        <Text testID="svg-size" style={[styles.size, { color: theme.text }]}>
          {t('svgUnits.result', { size: size(ppi) })}
        </Text>
        <AssetReportView report={report} testID="svg-report" />
        <Button label={t('svgUnits.place')} testID="svg-place" onPress={() => onPlace(ppi)} />
        <Button label={t('common.cancel')} testID="svg-cancel" variant="secondary" onPress={onCancel} />
      </ScrollView>
    </Modal>
  );
}

export function PdfPagesModal({ asset, prefs, onPlace, onCancel }: { asset: Asset; prefs: UnitPrefs; onPlace: (pages: number[]) => void; onCancel: () => void }) {
  const theme = useTheme();
  const report = asset.report as unknown as AssetReport;
  const pages = report.kind === 'pdf' ? report.pages : [];
  const [chosen, setChosen] = useState<Set<number>>(() => new Set([0]));
  const f = (mm: number) => formatLength(mm, { unit: prefs.unit, inchStyle: prefs.inchStyle, locale: prefs.locale, withUnit: false });
  const toggle = (i: number) =>
    setChosen((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onCancel}>
      <ScrollView testID="pdf-pages" style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
        <Text style={[styles.title, { color: theme.text }]}>{t('pdfPages.title', { n: pages.length })}</Text>
        <Text style={[styles.body, { color: theme.textSecondary }]}>{t('pdfPages.why')}</Text>
        <View style={styles.row}>
          <Button label={t('pdfPages.all')} testID="pdf-all" variant="secondary" onPress={() => setChosen(new Set(pages.map((_, i) => i)))} />
          <Button label={t('pdfPages.none')} testID="pdf-none" variant="secondary" onPress={() => setChosen(new Set())} />
        </View>
        {pages.map((p, i) => (
          <Pressable
            key={i}
            testID={`pdf-page-${i + 1}`}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: chosen.has(i) }}
            onPress={() => toggle(i)}
            style={[styles.choice, { backgroundColor: chosen.has(i) ? theme.backgroundSelected : theme.backgroundElement }]}>
            <Text style={[styles.choiceTitle, { color: theme.text }]}>
              {chosen.has(i) ? '☑ ' : '☐ '}
              {t('pdfPages.page', { n: i + 1, size: `${f(p.w)} × ${f(p.h)} ${prefs.unit}` })}
            </Text>
          </Pressable>
        ))}
        <AssetReportView report={report} testID="pdf-report" />
        <Button label={t('pdfPages.place', { n: chosen.size })} testID="pdf-place" disabled={!chosen.size} onPress={() => onPlace([...chosen].sort((a, b) => a - b))} />
        <Button label={t('common.cancel')} testID="pdf-cancel" variant="secondary" onPress={onCancel} />
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 12, paddingBottom: 48 },
  title: { fontSize: 22, fontWeight: '700' },
  body: { fontSize: 14, lineHeight: 20 },
  size: { fontSize: 16, fontWeight: '600' },
  choice: { padding: 12, borderRadius: 10, gap: 4 },
  choiceTitle: { fontSize: 16, fontWeight: '600' },
  row: { flexDirection: 'row', gap: 10 },
});
