import { withRead } from './tx';
import type { Db } from './types';

export type Value = string | number | null;

/** UPDATE <table> SET <sets>, updated_at = now WHERE id = ?; no-op when `sets` is empty. Run inside a write unit. */
export async function updateRow(tx: Db, table: string, id: number, sets: Record<string, Value>, now: number): Promise<void> {
  const cols = Object.keys(sets);
  if (cols.length === 0) return;
  const assignments = [...cols.map((c) => `${c} = ?`), 'updated_at = ?'].join(', ');
  await tx.runAsync(`UPDATE ${table} SET ${assignments} WHERE id = ?`, ...cols.map((c) => sets[c]), now, id);
}

/** Marks a project as edited (Projects list order = last edited). */
export async function touchProject(tx: Db, projectId: number, now: number): Promise<void> {
  await tx.runAsync('UPDATE projects SET updated_at = ? WHERE id = ?', now, projectId);
}

export async function projectIdOfSheet(db: Db, sheetId: number): Promise<number | null> {
  const row = await withRead(db, (r) => r.getFirstAsync<{ project_id: number }>('SELECT project_id FROM sheets WHERE id = ?', sheetId));
  return row?.project_id ?? null;
}
