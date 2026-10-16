import { InvalidDataError } from './errors';
import { isJsonObject, readJson, requireOneOf, writeJson, type Json } from './guards';
import { touchProject } from './rows';
import { withRead, withTransaction } from './tx';
import type { Db } from './types';

export type AssetKind = 'image' | 'pdf' | 'svg';
export type Asset = {
  id: number;
  projectId: number;
  kind: AssetKind;
  /** Relative to Paths.document (D19) */
  file: string;
  originalName: string;
  bytes: number;
  pxW: number | null;
  pxH: number | null;
  pageCount: number | null;
  /** 96/72/90/custom; null when the SVG has physical units */
  svgPxPerIn: number | null;
  /** Unsupported SVG features, PDF notes (D24) */
  report: Json | null;
};

type AssetRow = {
  id: number;
  project_id: number;
  kind: AssetKind;
  file: string;
  original_name: string;
  bytes: number;
  px_w: number | null;
  px_h: number | null;
  page_count: number | null;
  svg_px_per_in: number | null;
  report: string | null;
};

const KINDS: readonly AssetKind[] = ['image', 'pdf', 'svg'];
const isReport = (v: unknown): v is Json | null => v === null || isJsonObject(v);

const toAsset = (r: AssetRow): Asset => ({
  id: r.id,
  projectId: r.project_id,
  kind: r.kind,
  file: r.file,
  originalName: r.original_name,
  bytes: r.bytes,
  pxW: r.px_w,
  pxH: r.px_h,
  pageCount: r.page_count,
  svgPxPerIn: r.svg_px_per_in,
  report: readJson(r.report, isReport, null),
});

export type NewAsset = Omit<Asset, 'id' | 'projectId'>;

function positiveIntOrNull(v: number | null, column: string) {
  if (v !== null && !(Number.isInteger(v) && v > 0)) throw new InvalidDataError(`Invalid ${column}: ${v}`);
  return v;
}

export async function addAsset(db: Db, projectId: number, a: NewAsset, now = Date.now()): Promise<number> {
  requireOneOf(a.kind, KINDS, 'kind');
  if (!a.file || a.file.startsWith('/') || a.file.includes('..')) throw new InvalidDataError(`Asset file must be a relative path: ${a.file}`);
  positiveIntOrNull(a.pxW, 'px_w');
  positiveIntOrNull(a.pxH, 'px_h');
  positiveIntOrNull(a.pageCount, 'page_count');
  if (a.svgPxPerIn !== null && !(Number.isFinite(a.svgPxPerIn) && a.svgPxPerIn > 0)) throw new InvalidDataError('Invalid svg_px_per_in');
  const report = writeJson(a.report, isJsonObject, 'report');
  return withTransaction(db, async (tx) => {
    const r = await tx.runAsync(
      `INSERT INTO assets (project_id, kind, file, original_name, bytes, px_w, px_h, page_count, svg_px_per_in, report, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      projectId,
      a.kind,
      a.file,
      a.originalName,
      Math.max(0, Math.round(a.bytes)),
      a.pxW,
      a.pxH,
      a.pageCount,
      a.svgPxPerIn,
      report,
      now,
      now
    );
    await touchProject(tx, projectId, now);
    return r.lastInsertRowId;
  });
}

export async function getAsset(db: Db, id: number): Promise<Asset | null> {
  const row = await withRead(db, (r) => r.getFirstAsync<AssetRow>('SELECT * FROM assets WHERE id = ?', id));
  return row ? toAsset(row) : null;
}

export async function listAssets(db: Db, projectId: number): Promise<Asset[]> {
  const rows = await withRead(db, (r) => r.getAllAsync<AssetRow>('SELECT * FROM assets WHERE project_id = ? ORDER BY id', projectId));
  return rows.map(toAsset);
}

/** The SVG units answer (96/72/90/custom, SPEC §8.9) — asked once per file. */
export async function setSvgPxPerIn(db: Db, id: number, ppi: number, now = Date.now()): Promise<void> {
  if (!(Number.isFinite(ppi) && ppi > 0)) throw new InvalidDataError(`Invalid svg_px_per_in: ${ppi}`);
  await withTransaction(db, (tx) => tx.runAsync('UPDATE assets SET svg_px_per_in = ?, updated_at = ? WHERE id = ?', ppi, now, id));
}

/** Removes an asset row (its objects go with it, ON DELETE CASCADE) — an import the user cancelled. */
export async function deleteAsset(db: Db, id: number, now = Date.now()): Promise<void> {
  await withTransaction(db, async (tx) => {
    const a = await tx.getFirstAsync<{ project_id: number }>('SELECT project_id FROM assets WHERE id = ?', id);
    if (!a) return;
    await tx.runAsync('DELETE FROM assets WHERE id = ?', id);
    await touchProject(tx, a.project_id, now);
  });
}
