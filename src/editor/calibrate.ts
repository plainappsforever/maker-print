// Calibrate wizard steps 2–3 (SPEC §8.7, §9.4; D18, D75): typed measurements → verdict lines → what may be saved.
// Pure: the screen turns the lines into words (keys + params, both languages).
import type { PaperKey } from '@/engine/paper';
import { calibrationResult, type JobKind } from '@/engine/calibration';
import { parseLength, type Locale, type ParseError } from '@/engine/units';

export type VerdictLine = { key: string; params?: Record<string, string | number> };
export type Evaluation =
  | { state: 'incomplete' }
  | { state: 'invalid'; field: 'a' | 'b'; error: ParseError }
  | { state: 'result'; result: ReturnType<typeof calibrationResult>; lines: VerdictLine[]; canSave: boolean; fx: number; fy: number };

const pct = (s: number) => (Math.round(s * 1000) / 10).toFixed(1);

/**
 * `a` / `b` are what the user typed for bar A (horizontal, nominal `nominalA`) and bar B (vertical). Numbers without a
 * unit are millimetres; any unit and the decimal comma are accepted (A11). `os`/`jobKind`: on Android a multi-page job
 * fitted into the printable area is the expected behaviour of the print service, not a dialog setting (D12, D74).
 */
export function evaluateCalibration(
  input: { a: string; b: string; nominalA: number; nominalB: number; locale: Locale; jobKind: JobKind; os: 'ios' | 'android' | 'other' }
): Evaluation {
  if (!input.a.trim() || !input.b.trim()) return { state: 'incomplete' };
  const opts = { unit: 'mm' as const, locale: input.locale, positive: true };
  const a = parseLength(input.a, opts);
  if (!a.ok) return { state: 'invalid', field: 'a', error: a.error };
  const b = parseLength(input.b, opts);
  if (!b.ok) return { state: 'invalid', field: 'b', error: b.error };
  const result = calibrationResult({ nominal: input.nominalA, measured: a.mm }, { nominal: input.nominalB, measured: b.mm });
  const lines: VerdictLine[] = [];
  const scales = { a: pct(result.x.scale), b: pct(result.y.scale) };
  if (result.verdict === 'refused') {
    lines.push({ key: 'cal.v.refused', params: { a: input.nominalA, b: input.nominalB } });
    return { state: 'result', result, lines, canSave: false, fx: NaN, fy: NaN };
  }
  const multiFit = input.os === 'android' && input.jobKind === 'multi' && result.causes.includes('fitToPage');
  if (result.verdict === 'exact') lines.push({ key: 'cal.v.exact', params: scales });
  else if (result.verdict === 'slight') lines.push({ key: 'cal.v.slight', params: scales });
  else {
    lines.push({ key: 'cal.v.explain', params: scales });
    if (multiFit) lines.push({ key: 'cal.v.multiFit' });
    else if (result.causes.includes('fitToPage')) lines.push({ key: 'cal.v.fitToPage' });
    // ×0.9394 (Android's multi-page fit on A4, P4) is also within 0.003 of A4-on-Letter (0.9407): on the multi-page
    // check the fit is the expected cause, so the mix-up is not named (the single-page sheet already proved the paper)
    if (result.causes.includes('paperMismatch') && !multiFit) lines.push({ key: 'cal.v.paperMismatch' });
    if (!result.causes.length) lines.push({ key: 'cal.v.unknownCause' });
  }
  const fx = result.x.correction;
  const fy = result.y.correction;
  lines.push({ key: result.verdict === 'exact' ? 'cal.v.saveExact' : multiFit || result.verdict === 'slight' ? 'cal.v.saveOffer' : 'cal.v.saveAnyway', params: { fx: `×${fx.toFixed(4)}`, fy: `×${fy.toFixed(4)}` } });
  return { state: 'result', result, lines, canSave: true, fx, fy };
}

/** The coarse bank-card check (SPEC §9.4): it says which way the printer is off, never by how much. */
export function cardCheckLine(answer: 'smaller' | 'matches' | 'larger'): VerdictLine {
  return { key: `cal.card.${answer}` };
}

export type PrintedSheet = { profileId: number | null; paperKey: PaperKey; printerId: string | null; printerName: string | null };
/**
 * What a measurement is saved for (REVIEW_V1 finding 11): the sheet printed last in this session — its profile, paper
 * and printer — whatever the chips say now; without a print in this session the chips, marked as measured from another
 * print (route 'export', no printer).
 */
export function calibrationTarget(printed: PrintedSheet | null, chips: { profileId: number | null; paperKey: PaperKey }) {
  return {
    profileId: printed ? printed.profileId : chips.profileId,
    paperKey: printed?.paperKey ?? chips.paperKey,
    printerId: printed?.printerId ?? null,
    printerName: printed?.printerName ?? null,
    fromAnotherPrint: printed === null,
    chipsMoved: printed !== null && (printed.paperKey !== chips.paperKey || printed.profileId !== chips.profileId),
  };
}
