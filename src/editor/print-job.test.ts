import { calibrationResult } from '@/engine/calibration';
import { planCalibration } from '@/engine/plan';
import { uniformMargins } from '@/engine/paper';
import { printTranslator } from '@/i18n';

import { calibrationTarget, evaluateCalibration } from './calibrate';
import { calibrationStatus, correctionsOf, exportFileName, factor, needsConfirm, printMode, remainingPages, singlePagePlan } from './print-job';

const ctx = { locale: 'en' as const, unit: 'mm' as const, inchStyle: 'fraction16' as const, t: printTranslator('en') };
const cal = (paperKey: 'a4' | 'letter', jobKind: 'single' | 'multi', fx = 1.01, fy = 1.02) => ({
  id: 1, profileId: 1, paperKey, jobKind, nominalX: 150, measuredX: 150 / fx, nominalY: 200, measuredY: 200 / fy, fx, fy, route: 'exact' as const, measuredAt: 0, printerId: null, printerName: null,
});

describe('export file name (SPEC §11)', () => {
  it('is <project>-<paper>-<YYYY-MM-DD>.pdf with a safe project part', () => {
    const d = new Date(2026, 9, 4);
    expect(exportFileName('Sewing pattern', 'a4', d)).toBe('Sewing-pattern-a4-2026-10-04.pdf');
    expect(exportFileName('Größe/Maß: 1:1 ✂', 'letter', d)).toBe('Grosse-Mass-1-1-letter-2026-10-04.pdf');
    expect(exportFileName('   ', 'a3', d)).toBe('maker-print-a3-2026-10-04.pdf');
    expect(exportFileName('../../etc', 'a4', d)).toBe('etc-a4-2026-10-04.pdf');
  });
});

describe('print mode (D74)', () => {
  it('iOS: one job, single-page correction, no one-by-one option', () => {
    expect(printMode('ios', 9, [], 'a4')).toEqual({ offerOneByOne: false, defaultOneByOne: false, multiCalibrated: false, correctionJobKind: 'single' });
  });
  it('Android multi-page: one by one by default until a multi-page check exists for this paper', () => {
    expect(printMode('android', 9, [cal('a4', 'single')], 'a4')).toMatchObject({ offerOneByOne: true, defaultOneByOne: true, correctionJobKind: 'multi' });
    expect(printMode('android', 9, [cal('a4', 'multi')], 'a4')).toMatchObject({ offerOneByOne: true, defaultOneByOne: false, multiCalibrated: true });
    expect(printMode('android', 9, [cal('letter', 'multi')], 'a4')).toMatchObject({ defaultOneByOne: true, multiCalibrated: false });
    expect(printMode('android', 1, [], 'a4')).toMatchObject({ offerOneByOne: false, defaultOneByOne: false, correctionJobKind: 'single' });
  });
  it('helpers: corrections, status, factor, remaining pages, single-page plans', () => {
    expect(correctionsOf([cal('a4', 'multi', 1.0645, 1.0645)])).toEqual([{ paperKey: 'a4', jobKind: 'multi', fx: 1.0645, fy: 1.0645 }]);
    expect(calibrationStatus([cal('a4', 'multi')], 'a4', 'single')).toBeNull();
    expect(calibrationStatus([cal('a4', 'single')], 'a4', 'single')?.fx).toBe(1.01);
    expect(factor(150 / 149)).toBe('×1.0067');
    expect(remainingPages(9, 3)).toEqual([3, 4, 5, 6, 7, 8]);
    const two = planCalibration({ paperKey: 'a4', margins: uniformMargins(6.35), pages: 2, ctx });
    const p = singlePagePlan(two, 1);
    expect(p.pages).toHaveLength(1);
    expect(p.pages[0]).toBe(two.pages[1]);
    expect(p.jobKind).toBe('single');
  });
});

describe('calibrate wizard (SPEC §8.7, U3, W7)', () => {
  const base = { nominalA: 150, nominalB: 200, locale: 'en' as const, jobKind: 'single' as const, os: 'ios' as const };
  it('U3: 149.0 and 199.5 → slightly off, correction ×1.0067 / ×1.0025', () => {
    const e = evaluateCalibration({ ...base, a: '149.0', b: '199.5' });
    if (e.state !== 'result') throw new Error(e.state);
    expect(e.result.verdict).toBe('slight');
    expect(e.canSave).toBe(true);
    expect(e.lines.map((l) => l.key)).toEqual(['cal.v.slight', 'cal.v.saveOffer']);
    expect(e.lines[1].params).toEqual({ fx: '×1.0067', fy: '×1.0025' });
    expect(e.fx).toBeCloseTo(150 / 149, 12);
  });
  it('German decimal comma, units, exact, refused, fit to page, paper mismatch, Android multi-page fit', () => {
    const de = evaluateCalibration({ ...base, locale: 'de', a: '150,1', b: '20 cm' });
    expect(de.state === 'result' && de.result.verdict).toBe('exact');
    const refused = evaluateCalibration({ ...base, a: '15', b: '20' });
    expect(refused.state === 'result' && [refused.canSave, refused.lines[0].key]).toEqual([false, 'cal.v.refused']);
    const fit = evaluateCalibration({ ...base, a: '144.75', b: '193' }); // s = 0.965 (W7)
    expect(fit.state === 'result' && fit.lines.map((l) => l.key)).toEqual(['cal.v.explain', 'cal.v.fitToPage', 'cal.v.saveAnyway']);
    const mismatch = evaluateCalibration({ ...base, a: String(150 * 0.9727), b: String(200 * 0.9727) });
    expect(mismatch.state === 'result' && mismatch.lines.map((l) => l.key)).toContain('cal.v.paperMismatch');
    const multi = evaluateCalibration({ ...base, os: 'android', jobKind: 'multi', a: '140.9', b: '187.9' }); // ×0.9394 (P4)
    expect(multi.state === 'result' && multi.lines.map((l) => l.key)).toEqual(['cal.v.explain', 'cal.v.multiFit', 'cal.v.saveOffer']);
    expect(evaluateCalibration({ ...base, a: '', b: '1' }).state).toBe('incomplete');
    expect(evaluateCalibration({ ...base, a: 'abc', b: '1' })).toEqual({ state: 'invalid', field: 'a', error: 'invalid' });
    expect(calibrationResult({ nominal: 150, measured: 149 }, { nominal: 200, measured: 199.5 }).verdict).toBe('slight');
  });
});

describe('finding 9: more than 60 pages asks first (SPEC §12)', () => {
  it('60 prints at once, 61 asks', () => {
    expect(needsConfirm(60)).toBe(false);
    expect(needsConfirm(61)).toBe(true);
  });
});

describe('finding 11: a measurement is saved for the sheet that was printed', () => {
  const sheet = { profileId: 1, paperKey: 'a4' as const, printerId: 'urn:uuid:b', printerName: 'Brother' };
  it('chips changed after printing → still the printed sheet, and said', () => {
    expect(calibrationTarget(sheet, { profileId: 1, paperKey: 'letter' })).toMatchObject({ paperKey: 'a4', profileId: 1, printerId: 'urn:uuid:b', chipsMoved: true, fromAnotherPrint: false });
    expect(calibrationTarget(sheet, { profileId: 2, paperKey: 'a4' })).toMatchObject({ profileId: 1, chipsMoved: true });
    expect(calibrationTarget(sheet, { profileId: 1, paperKey: 'a4' })).toMatchObject({ chipsMoved: false });
  });
  it('no print in this session → the chips, as measured from another print, no printer', () => {
    expect(calibrationTarget(null, { profileId: 3, paperKey: 'letter' })).toEqual({ profileId: 3, paperKey: 'letter', printerId: null, printerName: null, fromAnotherPrint: true, chipsMoved: false });
  });
});
