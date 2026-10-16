import { isPaperKey, type PaperKey } from '@/engine/paper';

import { InvalidDataError } from './errors';
import { requirePaperKey, requireSheetSize } from './projects';
import { projectIdOfSheet, touchProject, updateRow, type Value } from './rows';
import { withRead, withTransaction } from './tx';
import type { Db } from './types';

export type Sheet = {
  id: number;
  projectId: number;
  position: number;
  widthMm: number;
  heightMm: number;
  /** null = custom size */
  paperKey: PaperKey | null;
  name: string;
};

type SheetRow = { id: number; project_id: number; position: number; width_mm: number; height_mm: number; paper_key: string | null; name: string };

const toSheet = (r: SheetRow): Sheet => ({
  id: r.id,
  projectId: r.project_id,
  position: r.position,
  widthMm: r.width_mm,
  heightMm: r.height_mm,
  paperKey: isPaperKey(r.paper_key) ? r.paper_key : null,
  name: r.name,
});

export async function listSheets(db: Db, projectId: number): Promise<Sheet[]> {
  const rows = await withRead(db, (r) => r.getAllAsync<SheetRow>('SELECT * FROM sheets WHERE project_id = ? ORDER BY position, id', projectId));
  return rows.map(toSheet);
}

export async function getSheet(db: Db, id: number): Promise<Sheet | null> {
  const row = await withRead(db, (r) => r.getFirstAsync<SheetRow>('SELECT * FROM sheets WHERE id = ?', id));
  return row ? toSheet(row) : null;
}

export type NewSheet = { widthMm: number; heightMm: number; paperKey?: PaperKey | null; name?: string };

/** Appends a sheet at the end of the project. */
export async function addSheet(db: Db, projectId: number, input: NewSheet, now = Date.now()): Promise<number> {
  requireSheetSize(input.widthMm, input.heightMm);
  if (input.paperKey != null) requirePaperKey(input.paperKey);
  return withTransaction(db, async (tx) => {
    const r = await tx.runAsync(
      `INSERT INTO sheets (project_id, position, width_mm, height_mm, paper_key, name, created_at, updated_at)
       VALUES (?, (SELECT COALESCE(MAX(position) + 1, 0) FROM sheets WHERE project_id = ?), ?, ?, ?, ?, ?, ?)`,
      projectId,
      projectId,
      input.widthMm,
      input.heightMm,
      input.paperKey ?? null,
      input.name ?? '',
      now,
      now
    );
    await touchProject(tx, projectId, now);
    return r.lastInsertRowId;
  });
}

export async function updateSheet(db: Db, id: number, patch: Partial<NewSheet>, now = Date.now()): Promise<void> {
  const sets: Record<string, Value> = {};
  return withTransaction(db, async (tx) => {
    const current = await tx.getFirstAsync<SheetRow>('SELECT * FROM sheets WHERE id = ?', id);
    if (!current) throw new InvalidDataError(`No sheet ${id}`);
    const w = patch.widthMm ?? current.width_mm;
    const h = patch.heightMm ?? current.height_mm;
    requireSheetSize(w, h);
    if (patch.widthMm !== undefined) sets.width_mm = w;
    if (patch.heightMm !== undefined) sets.height_mm = h;
    if (patch.paperKey !== undefined) sets.paper_key = patch.paperKey === null ? null : requirePaperKey(patch.paperKey);
    if (patch.name !== undefined) sets.name = patch.name.trim().slice(0, 200);
    await updateRow(tx, 'sheets', id, sets, now);
    await touchProject(tx, current.project_id, now);
  });
}

/** Deletes a sheet and its objects; refuses to delete the project's last sheet (returns false). */
export async function deleteSheet(db: Db, id: number, now = Date.now()): Promise<boolean> {
  return withTransaction(db, async (tx) => {
    const projectId = await projectIdOfSheet(tx, id);
    if (projectId === null) return false;
    const n = await tx.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM sheets WHERE project_id = ?', projectId);
    if ((n?.n ?? 0) <= 1) return false;
    await tx.runAsync('DELETE FROM sheets WHERE id = ?', id);
    await touchProject(tx, projectId, now);
    return true;
  });
}
