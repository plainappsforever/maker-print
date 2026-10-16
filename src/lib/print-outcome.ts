// Words for a print outcome (SPEC §9.3/§9.4, §12; D11, D12, D17, D74): what the print system did, what Maker Print could
// not control, and what only paper proves (L26). Shared by Print & export and Calibrate.
import { getPaper, type PaperKey } from '@/engine/paper';
import { t } from '@/i18n';

import type { PrintOutcome } from './print';

export type Line = { text: string; level: 'ok' | 'info' | 'warn' };
const fmt = (v: number) => (Math.round(v * 10) / 10).toString();

export function describeOutcome(
  r: PrintOutcome,
  o: { paperKey: PaperKey; os: 'ios' | 'android' | 'other'; pages: number; multiCorrected?: boolean; measure: string; profileName?: string | null }
): Line[] {
  if (!r.completed) return [{ text: t('cal.ui.cancelled'), level: 'info' }];
  const out: Line[] = [];
  const paper = getPaper(o.paperKey);
  if (r.route === 'fallback') out.push({ text: t('cal.ui.fallback'), level: 'warn' });
  else {
    const p = r.paperMm ?? { w: paper.widthMm, h: paper.heightMm };
    out.push({ text: t('cal.ui.exact', { printer: r.printerName ?? t('cal.ui.unknownPrinter'), w: fmt(p.w), h: fmt(p.h) }), level: 'ok' });
    if (r.paperMm && r.advice === 'paperDiffers') {
      const params = { w: fmt(r.paperMm.w), h: fmt(r.paperMm.h), paper: paper.label };
      out.push({ text: o.os === 'android' ? t('print.out.paperDiffersAndroid', params) : t('cal.ui.paperDiffers', params), level: 'warn' });
    }
    if (r.advice === 'marginsNotBlank') out.push({ text: t('print.out.marginsNotBlank'), level: 'warn' });
    if (r.advice === 'mayBeCut' && r.learnedMarginsMm) {
      const m = r.learnedMarginsMm;
      out.push({ text: t('print.out.mayBeCut', { l: fmt(m.l), t: fmt(m.t), r: fmt(m.r), b: fmt(m.b) }), level: 'warn' });
    }
    if (r.advice === 'oneByOneOrMultiCorrection' && o.os === 'android') {
      out.push({ text: o.multiCorrected ? t('print.out.multiCorrected') : t('print.out.multiMayShrink'), level: o.multiCorrected ? 'info' : 'warn' });
    }
    // D85: the print went to another printer than the profile's, or the correction was measured on another printer
    if (r.otherPrinter) out.push({ text: t('print.out.otherPrinter', { profile: o.profileName ?? '', printer: r.profilePrinterName ?? t('cal.ui.unknownPrinter') }), level: 'warn' });
    if (r.correctionOtherPrinter !== null) out.push({ text: t('print.out.correctionOtherPrinter', { printer: r.correctionOtherPrinter || t('print.out.anotherPrinter') }), level: 'warn' });
    const m = r.learnedMarginsMm;
    if (m && r.marginsStored) out.push({ text: t('cal.ui.margins', { l: fmt(m.l), t: fmt(m.t), r: fmt(m.r), b: fmt(m.b) }), level: 'info' });
    if (m && r.marginsStored && Math.min(m.l, m.t, m.r, m.b) < 3) out.push({ text: t('print.out.marginFloor'), level: 'info' });
  }
  out.push({ text: o.measure, level: 'info' });
  return out;
}
