// The importer's honest report (D24, D50, L26): what of an SVG is not printed or printed differently, PDF notes.
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { t, type TranslationKey } from '@/i18n';
import type { AssetReport } from '@/import/assets';

export function AssetReportView({ report, testID }: { report: AssetReport | null; testID: string }) {
  const theme = useTheme();
  if (!report) return null;
  if (report.kind === 'svg') {
    const gaps = report.issues.filter((i) => i.severity !== 'info');
    const info = report.issues.filter((i) => i.severity === 'info');
    if (!report.issues.length) {
      return (
        <Text testID={testID} style={[styles.ok, { color: theme.textSecondary }]}>
          {t('report.svgComplete')}
        </Text>
      );
    }
    return (
      <View testID={testID} style={styles.box}>
        {(['notDrawn', 'approximated', 'info'] as const).map((sev) => {
          const list = (sev === 'info' ? info : gaps).filter((i) => i.severity === sev);
          if (!list.length) return null;
          return (
            <View key={sev} style={styles.group}>
              <Text style={[styles.head, { color: sev === 'notDrawn' ? theme.danger : theme.text }]}>{t(`svg.severity.${sev}` as TranslationKey)}</Text>
              {list.map((i) => (
                <Text key={i.code} testID={`${testID}-${i.code}`} style={[styles.line, { color: theme.text }]}>
                  • {t(`svg.issue.${i.code}` as TranslationKey, { count: i.count })}
                </Text>
              ))}
            </View>
          );
        })}
        {report.issues.some((i) => i.severity === 'notDrawn') ? <Text style={[styles.line, { color: theme.textSecondary }]}>{t('svg.recommendPdf')}</Text> : null}
      </View>
    );
  }
  if (report.kind === 'pdf') {
    const notes = [...new Set([...(report.restricted ? (['restricted'] as const) : []), ...report.pages.flatMap((p) => p.notes)])];
    if (!notes.length) return null;
    return (
      <View testID={testID} style={styles.box}>
        {notes.map((n) => (
          <Text key={n} style={[styles.line, { color: theme.text }]}>
            • {t(`pdf.note.${n}` as TranslationKey)}
          </Text>
        ))}
      </View>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  box: { gap: 6 },
  group: { gap: 2 },
  head: { fontSize: 13, fontWeight: '700' },
  line: { fontSize: 13, lineHeight: 18 },
  ok: { fontSize: 13 },
});
