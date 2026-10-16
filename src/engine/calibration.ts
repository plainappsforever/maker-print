// Calibration (SPEC §8.7, W7; D18, D44). Pure.
import type { Affine } from './geometry';
import type { PaperKey } from './paper';

export type Verdict = 'exact' | 'slight' | 'explain' | 'refused';
export type Cause = 'fitToPage' | 'paperMismatch';
export type JobKind = 'single' | 'multi';
export type AxisResult = { nominal: number; measured: number; scale: number; correction: number; verdict: Verdict; causes: Cause[] };

/** Paper-mismatch ratios named in SPEC §8.7 (A4 on Letter height, Letter on A4 width, and their inverses). */
export const MISMATCH_RATIOS = [0.9407, 0.9727, 1.0281, 1.063] as const;

/**
 * s = M/N, c = 1/s. |s−1| ≤ 0.002 exact; ≤ 0.02 slight; ≤ 0.15 explain (fit to page when s ∈ [0.93, 0.985]; paper
 * mismatch when s is within 0.003 of a ratio); otherwise refused. Measured ≤ 0 or not finite → refused.
 */
export function axisResult(nominal: number, measured: number): AxisResult {
  if (!(measured > 0) || !Number.isFinite(measured) || !(nominal > 0)) {
    return { nominal, measured, scale: NaN, correction: NaN, verdict: 'refused', causes: [] };
  }
  const scale = measured / nominal;
  const correction = nominal / measured;
  const d = Math.abs(scale - 1);
  // 1e-12 keeps exact decimal boundaries (e.g. 100.2 / 100) on the inclusive side despite binary rounding
  const verdict: Verdict = d <= 0.002 + 1e-12 ? 'exact' : d <= 0.02 + 1e-12 ? 'slight' : d <= 0.15 + 1e-12 ? 'explain' : 'refused';
  const causes: Cause[] = [];
  if (verdict === 'explain') {
    if (scale >= 0.93 - 1e-12 && scale <= 0.985 + 1e-12) causes.push('fitToPage');
    if (MISMATCH_RATIOS.some((q) => Math.abs(scale - q) <= 0.003 + 1e-12)) causes.push('paperMismatch');
  }
  return { nominal, measured, scale, correction, verdict, causes };
}

const RANK: Record<Verdict, number> = { exact: 0, slight: 1, explain: 2, refused: 3 };

/** Both axes; the overall verdict is the worse one; refused on either axis refuses the measurement. */
export function calibrationResult(x: { nominal: number; measured: number }, y: { nominal: number; measured: number }) {
  const ax = axisResult(x.nominal, x.measured);
  const ay = axisResult(y.nominal, y.measured);
  const verdict = RANK[ax.verdict] >= RANK[ay.verdict] ? ax.verdict : ay.verdict;
  const causes = [...new Set([...ax.causes, ...ay.causes])];
  return { x: ax, y: ay, verdict, causes, canSave: verdict !== 'refused' };
}

export type Correction = { fx: number; fy: number };
export type StoredCorrection = Correction & { paperKey: PaperKey; jobKind: JobKind };

/** p' = C + c(p − C) per axis, C = page centre (SPEC §8.7): inverts a centred fit-to-page exactly. */
export function correctionMatrix(page: { w: number; h: number }, c: Correction): Affine {
  const cx = page.w / 2;
  const cy = page.h / 2;
  return [c.fx, 0, 0, c.fy, cx - c.fx * cx, cy - c.fy * cy];
}

export const isIdentityCorrection = (c: Correction | null | undefined) => !c || (c.fx === 1 && c.fy === 1);

/** The stored correction for exactly this paper and job kind — never another paper's or job kind's (D18). */
export function pickCorrection(stored: readonly StoredCorrection[], paperKey: PaperKey, jobKind: JobKind): StoredCorrection | null {
  return stored.find((s) => s.paperKey === paperKey && s.jobKind === jobKind) ?? null;
}

/** Calibration bar lengths (D18): the largest of 200/150/100/50 mm with L ≤ safe side − 2 × 12 mm. */
export const CALIBRATION_BARS = [200, 150, 100, 50] as const;
export const CALIBRATION_INSET_MM = 12;
export function calibrationBar(safeSide: number): number | null {
  return CALIBRATION_BARS.find((L) => L <= safeSide - 2 * CALIBRATION_INSET_MM + 1e-9) ?? null;
}
