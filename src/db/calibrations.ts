import { isPaperKey, type PaperKey } from '@/engine/paper';

import { InvalidDataError } from './errors';
import { requireLength, requireOneOf } from './guards';
import { requirePaperKey } from './projects';
import { withRead, withTransaction } from './tx';
import type { Db } from './types';

export type JobKind = 'single' | 'multi';
export type PrintRoute = 'exact' | 'fallback' | 'export';
export type Calibration = {
  id: number;
  profileId: number;
  paperKey: PaperKey;
  jobKind: JobKind;
  nominalX: number;
  measuredX: number;
  nominalY: number;
  measuredY: number;
  /** Correction c = 1/s = nominal / measured (SPEC §8.7) */
  fx: number;
  fy: number;
  route: PrintRoute;
  measuredAt: number;
  /** The print system's id of the printer the sheet was printed on (null: not known — measured from another print) */
  printerId: string | null;
  printerName: string | null;
};

type CalibrationRow = {
  id: number;
  profile_id: number;
  paper_key: string;
  job_kind: JobKind;
  nominal_x_mm: number;
  measured_x_mm: number;
  nominal_y_mm: number;
  measured_y_mm: number;
  fx: number;
  fy: number;
  route: PrintRoute;
  measured_at: number;
  printer_id: string | null;
  printer_name: string | null;
};

const KINDS: readonly JobKind[] = ['single', 'multi'];
const ROUTES: readonly PrintRoute[] = ['exact', 'fallback', 'export'];

const toCalibration = (r: CalibrationRow): Calibration | null =>
  isPaperKey(r.paper_key)
    ? {
        id: r.id,
        profileId: r.profile_id,
        paperKey: r.paper_key,
        jobKind: r.job_kind,
        nominalX: r.nominal_x_mm,
        measuredX: r.measured_x_mm,
        nominalY: r.nominal_y_mm,
        measuredY: r.measured_y_mm,
        fx: r.fx,
        fy: r.fy,
        route: r.route,
        measuredAt: r.measured_at,
        printerId: r.printer_id ?? null,
        printerName: r.printer_name ?? null,
      }
    : null;

export type NewCalibration = Omit<Calibration, 'id' | 'fx' | 'fy' | 'measuredAt' | 'printerId' | 'printerName'> & { printerId?: string | null; printerName?: string | null };

/**
 * Saves a measurement for profile × paper × job kind; the newest replaces the previous one (UNIQUE key, D18).
 * The correction is derived here so a stored row is always self-consistent: fx = nominal / measured.
 */
export async function saveCalibration(db: Db, c: NewCalibration, now = Date.now()): Promise<Calibration> {
  requirePaperKey(c.paperKey);
  requireOneOf(c.jobKind, KINDS, 'job_kind');
  requireOneOf(c.route, ROUTES, 'route');
  for (const [v, col] of [
    [c.nominalX, 'nominal_x_mm'],
    [c.measuredX, 'measured_x_mm'],
    [c.nominalY, 'nominal_y_mm'],
    [c.measuredY, 'measured_y_mm'],
  ] as const) {
    requireLength(v, col);
  }
  const fx = c.nominalX / c.measuredX;
  const fy = c.nominalY / c.measuredY;
  return withTransaction(db, async (tx) => {
    const profile = await tx.getFirstAsync<{ id: number }>('SELECT id FROM profiles WHERE id = ?', c.profileId);
    if (!profile) throw new InvalidDataError(`No profile ${c.profileId}`);
    await tx.runAsync(
      `INSERT INTO calibrations (profile_id, paper_key, job_kind, nominal_x_mm, measured_x_mm, nominal_y_mm, measured_y_mm, fx, fy, route,
         measured_at, created_at, updated_at, printer_id, printer_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (profile_id, paper_key, job_kind) DO UPDATE SET
         nominal_x_mm = excluded.nominal_x_mm, measured_x_mm = excluded.measured_x_mm,
         nominal_y_mm = excluded.nominal_y_mm, measured_y_mm = excluded.measured_y_mm,
         fx = excluded.fx, fy = excluded.fy, route = excluded.route, measured_at = excluded.measured_at,
         updated_at = excluded.updated_at, printer_id = excluded.printer_id, printer_name = excluded.printer_name`,
      c.profileId,
      c.paperKey,
      c.jobKind,
      c.nominalX,
      c.measuredX,
      c.nominalY,
      c.measuredY,
      fx,
      fy,
      c.route,
      now,
      now,
      now,
      c.printerId ?? null,
      c.printerName ?? null
    );
    const row = await tx.getFirstAsync<CalibrationRow>(
      'SELECT * FROM calibrations WHERE profile_id = ? AND paper_key = ? AND job_kind = ?',
      c.profileId,
      c.paperKey,
      c.jobKind
    );
    return toCalibration(row as CalibrationRow) as Calibration;
  });
}

/** The correction for exactly this paper and job kind — never another paper's or job kind's (D18). */
export async function getCalibration(db: Db, profileId: number, paperKey: PaperKey, jobKind: JobKind): Promise<Calibration | null> {
  const row = await withRead(db, (r) => r.getFirstAsync<CalibrationRow>(
    'SELECT * FROM calibrations WHERE profile_id = ? AND paper_key = ? AND job_kind = ?',
    profileId,
    paperKey,
    jobKind
  ));
  return row ? toCalibration(row) : null;
}

export async function listCalibrations(db: Db, profileId: number): Promise<Calibration[]> {
  const rows = await withRead(db, (r) => r.getAllAsync<CalibrationRow>('SELECT * FROM calibrations WHERE profile_id = ? ORDER BY paper_key, job_kind', profileId));
  return rows.map(toCalibration).filter((c): c is Calibration => c !== null);
}

export async function deleteCalibration(db: Db, id: number): Promise<void> {
  await withTransaction(db, (tx) => tx.runAsync('DELETE FROM calibrations WHERE id = ?', id));
}
