// Print & export decisions (SPEC §9.3, §11; D12, D18, D74, D75). Pure: no React/Expo imports.
import type { Calibration } from '@/db/calibrations';
import type { JobKind, StoredCorrection } from '@/engine/calibration';
import type { PaperKey } from '@/engine/paper';
import type { PrintPlan } from '@/engine/plan';
import { CONFIRM_PAGES } from '@/engine/tiles';

export type Os = 'ios' | 'android' | 'other';

/** `<project>-<paper>-<YYYY-MM-DD>.pdf` (SPEC §11), safe for every file system and share target. */
export function exportFileName(projectName: string, paperKey: PaperKey, date: Date): string {
  const base =
    projectName
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/ß/g, 'ss')
      .replace(/[^A-Za-z0-9._ -]+/g, ' ')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/^[.-]+/, '')
      .slice(0, 60) || 'maker-print';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${base}-${paperKey}-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.pdf`;
}

/** Page `i` of a plan as its own one-page job (Android "Print pages one by one (exact)", D12). */
export function singlePagePlan(plan: PrintPlan, i: number): PrintPlan {
  return { ...plan, pages: [plan.pages[i]], jobKind: 'single' };
}

/** Stored calibrations → the engine's corrections (exact paper + job kind only, D18). */
export const correctionsOf = (calibrations: readonly Calibration[]): StoredCorrection[] =>
  calibrations.map((c) => ({ paperKey: c.paperKey, jobKind: c.jobKind, fx: c.fx, fy: c.fy }));

/**
 * How a job goes to the print system (D74):
 * - iOS: one job; the renderer draws every page at scale 1 whatever the page count (P4), so the single-page
 *   correction applies to every job and there is no one-by-one option.
 * - Android, one page: one job, single-page correction.
 * - Android, several pages: the Default Print Service fits multi-page jobs into the printable area on printers without
 *   PDF support (×0.9394 on A4, measured P4). With a multi-page calibration for this printer and paper the job goes as
 *   one, corrected; without one, "one by one" is on by default (exact, one dialog per page) and the user may switch it
 *   off.
 */
export function printMode(os: Os, pages: number, calibrations: readonly Pick<Calibration, 'paperKey' | 'jobKind'>[], paperKey: PaperKey) {
  const multiCalibrated = calibrations.some((c) => c.paperKey === paperKey && c.jobKind === 'multi');
  const offerOneByOne = os === 'android' && pages > 1;
  return {
    offerOneByOne,
    defaultOneByOne: offerOneByOne && !multiCalibrated,
    multiCalibrated,
    /** The job kind whose correction applies when printing as one job */
    correctionJobKind: (os === 'android' ? (pages > 1 ? 'multi' : 'single') : 'single') as JobKind,
  };
}

/** "×1.0067" — corrections are shown to 4 decimals (U3). */
export const factor = (c: number) => `×${c.toFixed(4)}`;

/** Status of a profile for one paper (SPEC §9.3 "Calibrated 12 Sep ✓ ×1.000 / not calibrated"). */
export function calibrationStatus(calibrations: readonly Calibration[], paperKey: PaperKey, jobKind: JobKind): Calibration | null {
  return calibrations.find((c) => c.paperKey === paperKey && c.jobKind === jobKind) ?? null;
}

/** Pages of a series that are still to print after page `done` (0-based count) — for "Continue from page n". */
export function remainingPages(total: number, done: number): number[] {
  return Array.from({ length: Math.max(0, total - done) }, (_, k) => done + k);
}

/** SPEC §12: more than 60 pages → the user confirms before the print dialog opens (REVIEW_V1 finding 9). */
export const needsConfirm = (pages: number) => pages > CONFIRM_PAGES;
