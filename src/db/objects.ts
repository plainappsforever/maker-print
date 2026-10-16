import type { Crop, FitMode } from '@/engine/geometry';

import { InvalidDataError } from './errors';
import { bool, int, isCrop, isJsonObject, isRepeat, readJson, requireFinite, requireLength, requireOneOf, writeJson, type Json, type Repeat } from './guards';
import { projectIdOfSheet, touchProject, updateRow, type Value } from './rows';
import { withRead, withTransaction } from './tx';
import type { Db } from './types';

export type ObjectKind =
  | 'image' | 'pdf_page' | 'svg' | 'text' | 'rect' | 'ellipse' | 'line'
  | 'ruler' | 'grid' | 'dots' | 'lines' | 'circles' | 'test_square';
export const OBJECT_KINDS: readonly ObjectKind[] = [
  'image', 'pdf_page', 'svg', 'text', 'rect', 'ellipse', 'line', 'ruler', 'grid', 'dots', 'lines', 'circles', 'test_square',
];
/** Kinds drawn from an imported file (they need an asset). */
export const ASSET_KINDS: readonly ObjectKind[] = ['image', 'pdf_page', 'svg'];

export type SheetObject = {
  id: number;
  sheetId: number;
  z: number;
  kind: ObjectKind;
  assetId: number | null;
  pageIndex: number;
  x: number;
  y: number;
  w: number;
  h: number;
  rotationDeg: number;
  mirrorX: boolean;
  mirrorY: boolean;
  lockAspect: boolean;
  crop: Crop | null;
  fit: FitMode;
  repeat: Repeat | null;
  /** Per kind: text, font size pt, colour, stroke mm, generator parameters */
  props: Json;
  name: string;
  locked: boolean;
  hidden: boolean;
};

type ObjectRow = {
  id: number;
  sheet_id: number;
  z: number;
  kind: ObjectKind;
  asset_id: number | null;
  page_index: number;
  x_mm: number;
  y_mm: number;
  w_mm: number;
  h_mm: number;
  rotation_deg: number;
  mirror_x: number;
  mirror_y: number;
  lock_aspect: number;
  crop: string | null;
  fit: FitMode;
  repeat: string | null;
  props: string;
  name: string;
  locked: number;
  hidden: number;
};

const FITS: readonly FitMode[] = ['fill', 'fit'];

const toObject = (r: ObjectRow): SheetObject => ({
  id: r.id,
  sheetId: r.sheet_id,
  z: r.z,
  kind: r.kind,
  assetId: r.asset_id,
  pageIndex: r.page_index,
  x: r.x_mm,
  y: r.y_mm,
  w: r.w_mm,
  h: r.h_mm,
  rotationDeg: r.rotation_deg,
  mirrorX: bool(r.mirror_x),
  mirrorY: bool(r.mirror_y),
  lockAspect: bool(r.lock_aspect),
  crop: readJson<Crop | null>(r.crop, (v): v is Crop | null => v === null || isCrop(v), null),
  fit: r.fit,
  repeat: readJson<Repeat | null>(r.repeat, (v): v is Repeat | null => v === null || isRepeat(v), null),
  props: readJson(r.props, isJsonObject, {}),
  name: r.name,
  locked: bool(r.locked),
  hidden: bool(r.hidden),
});

export type NewObject = Pick<SheetObject, 'kind' | 'x' | 'y' | 'w' | 'h'> &
  Partial<Omit<SheetObject, 'id' | 'sheetId' | 'z' | 'kind' | 'x' | 'y' | 'w' | 'h'>>;
export type ObjectPatch = Partial<Omit<SheetObject, 'id' | 'sheetId' | 'kind' | 'assetId' | 'z'>>;

function columns(o: ObjectPatch): Record<string, Value> {
  const c: Record<string, Value> = {};
  if (o.pageIndex !== undefined) {
    if (!(Number.isInteger(o.pageIndex) && o.pageIndex >= 0)) throw new InvalidDataError(`Invalid page_index: ${o.pageIndex}`);
    c.page_index = o.pageIndex;
  }
  if (o.x !== undefined) c.x_mm = requireFinite(o.x, 'x_mm');
  if (o.y !== undefined) c.y_mm = requireFinite(o.y, 'y_mm');
  if (o.w !== undefined) c.w_mm = requireLength(o.w, 'w_mm');
  if (o.h !== undefined) c.h_mm = requireLength(o.h, 'h_mm');
  if (o.rotationDeg !== undefined) c.rotation_deg = requireFinite(o.rotationDeg, 'rotation_deg');
  if (o.mirrorX !== undefined) c.mirror_x = int(o.mirrorX);
  if (o.mirrorY !== undefined) c.mirror_y = int(o.mirrorY);
  if (o.lockAspect !== undefined) c.lock_aspect = int(o.lockAspect);
  if (o.crop !== undefined) c.crop = writeJson(o.crop, isCrop, 'crop');
  if (o.fit !== undefined) c.fit = requireOneOf(o.fit, FITS, 'fit');
  if (o.repeat !== undefined) c.repeat = writeJson(o.repeat, isRepeat, 'repeat');
  if (o.props !== undefined) c.props = writeJson(o.props, isJsonObject, 'props');
  if (o.name !== undefined) c.name = o.name.trim().slice(0, 200);
  if (o.locked !== undefined) c.locked = int(o.locked);
  if (o.hidden !== undefined) c.hidden = int(o.hidden);
  return c;
}

/** Adds an object on top of the sheet's stack (z = max + 1); returns its id. */
export async function addObject(db: Db, sheetId: number, input: NewObject, now = Date.now()): Promise<number> {
  requireOneOf(input.kind, OBJECT_KINDS, 'kind');
  const assetId = input.assetId ?? null;
  if (ASSET_KINDS.includes(input.kind) !== (assetId !== null)) {
    throw new InvalidDataError(`${input.kind} objects ${assetId === null ? 'need' : 'take no'} asset`);
  }
  const cols = columns(input);
  return withTransaction(db, async (tx) => {
    const projectId = await projectIdOfSheet(tx, sheetId);
    if (projectId === null) throw new InvalidDataError(`No sheet ${sheetId}`);
    if (assetId !== null) {
      const a = await tx.getFirstAsync<{ project_id: number }>('SELECT project_id FROM assets WHERE id = ?', assetId);
      if (a?.project_id !== projectId) throw new InvalidDataError(`Asset ${assetId} is not in project ${projectId}`);
    }
    const names = ['sheet_id', 'z', 'kind', 'asset_id', ...Object.keys(cols), 'created_at', 'updated_at'];
    const r = await tx.runAsync(
      `INSERT INTO objects (${names.join(', ')})
       VALUES (?, (SELECT COALESCE(MAX(z) + 1, 0) FROM objects WHERE sheet_id = ?), ?, ?, ${Object.keys(cols).map(() => '?, ').join('')}?, ?)`,
      sheetId,
      sheetId,
      input.kind,
      assetId,
      ...Object.values(cols),
      now,
      now
    );
    await touchProject(tx, projectId, now);
    return r.lastInsertRowId;
  });
}

export async function getObject(db: Db, id: number): Promise<SheetObject | null> {
  const row = await withRead(db, (r) => r.getFirstAsync<ObjectRow>('SELECT * FROM objects WHERE id = ?', id));
  return row ? toObject(row) : null;
}

/** Objects of a sheet, bottom to top. */
export async function listObjects(db: Db, sheetId: number): Promise<SheetObject[]> {
  const rows = await withRead(db, (r) => r.getAllAsync<ObjectRow>('SELECT * FROM objects WHERE sheet_id = ? ORDER BY z, id', sheetId));
  return rows.map(toObject);
}

async function projectOfObject(tx: Db, id: number): Promise<number | null> {
  const r = await tx.getFirstAsync<{ project_id: number }>('SELECT s.project_id FROM objects o JOIN sheets s ON s.id = o.sheet_id WHERE o.id = ?', id);
  return r?.project_id ?? null;
}

/** Autosave entry point for the editor (debounced during drags, flushed on release). */
export async function updateObject(db: Db, id: number, patch: ObjectPatch, now = Date.now()): Promise<void> {
  const cols = columns(patch);
  await withTransaction(db, async (tx) => {
    const projectId = await projectOfObject(tx, id);
    if (projectId === null) return; // deleted meanwhile: a late autosave is dropped, not an error
    await updateRow(tx, 'objects', id, cols, now);
    await touchProject(tx, projectId, now);
  });
}

export async function deleteObject(db: Db, id: number, now = Date.now()): Promise<void> {
  await withTransaction(db, async (tx) => {
    const projectId = await projectOfObject(tx, id);
    if (projectId === null) return;
    await tx.runAsync('DELETE FROM objects WHERE id = ?', id);
    await touchProject(tx, projectId, now);
  });
}

/** Copy on top of the stack, offset by (dx, dy) mm; returns the new id. */
export async function duplicateObject(db: Db, id: number, offset = { dx: 5, dy: 5 }, now = Date.now()): Promise<number> {
  return withTransaction(db, async (tx) => {
    const o = await getObject(tx, id);
    if (!o) throw new InvalidDataError(`No object ${id}`);
    const { id: _id, sheetId, z: _z, ...rest } = o;
    return addObject(tx, sheetId, { ...rest, x: o.x + offset.dx, y: o.y + offset.dy, name: o.name }, now);
  });
}

/** Layers: sets z = position in `idsBottomToTop` (must be exactly the sheet's objects). */
export async function setObjectOrder(db: Db, sheetId: number, idsBottomToTop: number[], now = Date.now()): Promise<void> {
  await withTransaction(db, async (tx) => {
    const current = await tx.getAllAsync<{ id: number }>('SELECT id FROM objects WHERE sheet_id = ?', sheetId);
    const a = current.map((r) => r.id).sort((x, y) => x - y);
    const b = [...idsBottomToTop].sort((x, y) => x - y);
    if (a.length !== b.length || a.some((v, i) => v !== b[i])) throw new InvalidDataError('Layer order must list every object of the sheet once');
    for (let i = 0; i < idsBottomToTop.length; i++) {
      await tx.runAsync('UPDATE objects SET z = ?, updated_at = ? WHERE id = ?', i, now, idsBottomToTop[i]);
    }
    const projectId = await projectIdOfSheet(tx, sheetId);
    if (projectId !== null) await touchProject(tx, projectId, now);
  });
}
