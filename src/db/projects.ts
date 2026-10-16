import { isPaperKey, paperSize, type PaperKey } from '@/engine/paper';

import { InvalidDataError } from './errors';
import { boolOrNull, bool, int, isTileLabels, readJson, requireLength, requireOneOf, writeJson } from './guards';
import { touchProject, updateRow, type Value } from './rows';
import { withRead, withTransaction } from './tx';
import type { Db } from './types';

export type ProjectOrientation = 'auto' | 'portrait' | 'landscape';
export type Marks = 'registration' | 'none';
export type AssemblyMap = 'auto' | 'on' | 'off';

export type Project = {
  id: number;
  name: string;
  paperKey: PaperKey;
  orientation: ProjectOrientation;
  /** null → profile/settings default */
  marginMm: number | null;
  overlapMm: number;
  marks: Marks;
  pageLabels: boolean;
  assemblyMap: AssemblyMap;
  skipBlank: boolean;
  excludedTiles: string[];
  /** null → settings default */
  checkBar: boolean | null;
  profileId: number | null;
  thumbnailPath: string | null;
  createdAt: number;
  updatedAt: number;
};

export type ProjectSummary = Pick<Project, 'id' | 'name' | 'paperKey' | 'thumbnailPath' | 'updatedAt'> & {
  sheetCount: number;
  /** First sheet's size */
  widthMm: number;
  heightMm: number;
};

type ProjectRow = {
  id: number;
  name: string;
  paper_key: string;
  orientation: ProjectOrientation;
  margin_mm: number | null;
  overlap_mm: number;
  marks: Marks;
  page_labels: number;
  assembly_map: AssemblyMap;
  skip_blank: number;
  excluded_tiles: string;
  check_bar: number | null;
  profile_id: number | null;
  thumbnail_path: string | null;
  created_at: number;
  updated_at: number;
};

const ORIENTATIONS: readonly ProjectOrientation[] = ['auto', 'portrait', 'landscape'];
const MARKS: readonly Marks[] = ['registration', 'none'];
const MAPS: readonly AssemblyMap[] = ['auto', 'on', 'off'];
export const DEFAULT_OVERLAP_MM = 10;
export const MAX_SHEET_MM = 3000; // D27

function toProject(r: ProjectRow): Project {
  return {
    id: r.id,
    name: r.name,
    paperKey: isPaperKey(r.paper_key) ? r.paper_key : 'a4',
    orientation: r.orientation,
    marginMm: r.margin_mm,
    overlapMm: r.overlap_mm,
    marks: r.marks,
    pageLabels: bool(r.page_labels),
    assemblyMap: r.assembly_map,
    skipBlank: bool(r.skip_blank),
    excludedTiles: readJson(r.excluded_tiles, isTileLabels, []),
    checkBar: boolOrNull(r.check_bar),
    profileId: r.profile_id,
    thumbnailPath: r.thumbnail_path,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function cleanName(name: string): string {
  const n = name.trim();
  if (!n) throw new InvalidDataError('Project name is empty');
  return n.slice(0, 200);
}

export function requirePaperKey(key: string, column = 'paper_key'): PaperKey {
  if (!isPaperKey(key)) throw new InvalidDataError(`Invalid ${column}: ${key}`);
  return key;
}

export function requireSheetSize(w: number, h: number) {
  requireLength(w, 'width_mm');
  requireLength(h, 'height_mm');
  if (w > MAX_SHEET_MM || h > MAX_SHEET_MM) throw new InvalidDataError(`Sheet larger than ${MAX_SHEET_MM} mm`);
}

export type NewProject = {
  name: string;
  /** Output paper */
  paperKey: PaperKey;
  /** First sheet; default = the output paper, portrait. */
  sheet?: { widthMm: number; heightMm: number; paperKey?: PaperKey | null; name?: string };
  overlapMm?: number;
  profileId?: number | null;
};

/** Creates the project and its first sheet in one transaction; returns the project id. */
export async function createProject(db: Db, input: NewProject, now = Date.now()): Promise<{ projectId: number; sheetId: number }> {
  const name = cleanName(input.name);
  const paperKey = requirePaperKey(input.paperKey);
  const size = paperSize(paperKey);
  const sheet = input.sheet ?? { widthMm: size.w, heightMm: size.h, paperKey };
  requireSheetSize(sheet.widthMm, sheet.heightMm);
  if (sheet.paperKey != null) requirePaperKey(sheet.paperKey, 'sheet paper_key');
  const overlap = requireLength(input.overlapMm ?? DEFAULT_OVERLAP_MM, 'overlap_mm', true);
  return withTransaction(db, async (tx) => {
    const p = await tx.runAsync(
      'INSERT INTO projects (name, paper_key, overlap_mm, profile_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      name,
      paperKey,
      overlap,
      input.profileId ?? null,
      now,
      now
    );
    const s = await tx.runAsync(
      'INSERT INTO sheets (project_id, position, width_mm, height_mm, paper_key, name, created_at, updated_at) VALUES (?, 0, ?, ?, ?, ?, ?, ?)',
      p.lastInsertRowId,
      sheet.widthMm,
      sheet.heightMm,
      sheet.paperKey ?? null,
      sheet.name ?? '',
      now,
      now
    );
    return { projectId: p.lastInsertRowId, sheetId: s.lastInsertRowId };
  });
}

export async function getProject(db: Db, id: number): Promise<Project | null> {
  const row = await withRead(db, (r) => r.getFirstAsync<ProjectRow>('SELECT * FROM projects WHERE id = ?', id));
  return row ? toProject(row) : null;
}

/** Projects list: last edited first. */
export async function listProjects(db: Db): Promise<ProjectSummary[]> {
  const rows = await withRead(db, (r) =>
    r.getAllAsync<ProjectRow & { sheet_count: number; width_mm: number; height_mm: number }>(
    `SELECT p.*,
       (SELECT COUNT(*) FROM sheets s WHERE s.project_id = p.id) AS sheet_count,
       f.width_mm, f.height_mm
     FROM projects p
     LEFT JOIN sheets f ON f.id = (SELECT id FROM sheets WHERE project_id = p.id ORDER BY position, id LIMIT 1)
     ORDER BY p.updated_at DESC, p.id DESC`
    )
  );
  return rows.map((r) => {
    const p = toProject(r);
    return {
      id: p.id,
      name: p.name,
      paperKey: p.paperKey,
      thumbnailPath: p.thumbnailPath,
      updatedAt: p.updatedAt,
      sheetCount: r.sheet_count,
      widthMm: r.width_mm,
      heightMm: r.height_mm,
    };
  });
}

export type ProjectPatch = Partial<Omit<Project, 'id' | 'createdAt' | 'updatedAt'>>;

export async function updateProject(db: Db, id: number, patch: ProjectPatch, now = Date.now()): Promise<void> {
  const sets: Record<string, Value> = {};
  if (patch.name !== undefined) sets.name = cleanName(patch.name);
  if (patch.paperKey !== undefined) sets.paper_key = requirePaperKey(patch.paperKey);
  if (patch.orientation !== undefined) sets.orientation = requireOneOf(patch.orientation, ORIENTATIONS, 'orientation');
  if (patch.marginMm !== undefined) sets.margin_mm = patch.marginMm === null ? null : requireLength(patch.marginMm, 'margin_mm', true);
  if (patch.overlapMm !== undefined) sets.overlap_mm = requireLength(patch.overlapMm, 'overlap_mm', true);
  if (patch.marks !== undefined) sets.marks = requireOneOf(patch.marks, MARKS, 'marks');
  if (patch.pageLabels !== undefined) sets.page_labels = int(patch.pageLabels);
  if (patch.assemblyMap !== undefined) sets.assembly_map = requireOneOf(patch.assemblyMap, MAPS, 'assembly_map');
  if (patch.skipBlank !== undefined) sets.skip_blank = int(patch.skipBlank);
  if (patch.excludedTiles !== undefined) sets.excluded_tiles = writeJson(patch.excludedTiles, isTileLabels, 'excluded_tiles');
  if (patch.checkBar !== undefined) sets.check_bar = patch.checkBar === null ? null : int(patch.checkBar);
  if (patch.profileId !== undefined) sets.profile_id = patch.profileId;
  if (patch.thumbnailPath !== undefined) sets.thumbnail_path = patch.thumbnailPath;
  await withTransaction(db, (tx) => updateRow(tx, 'projects', id, sets, now));
}

/**
 * Deletes the project; sheets, objects and assets go with it (ON DELETE CASCADE). Returns the asset files the caller
 * must remove from the documents folder (D19: the user's own data, confirmed once in the UI).
 */
export async function deleteProject(db: Db, id: number): Promise<string[]> {
  return withTransaction(db, async (tx) => {
    const files = await tx.getAllAsync<{ file: string }>('SELECT file FROM assets WHERE project_id = ? ORDER BY id', id);
    await tx.runAsync('DELETE FROM projects WHERE id = ?', id);
    return files.map((f) => f.file);
  });
}

/**
 * Deep copy: project row, sheets, assets and objects (asset ids remapped). Asset rows get the file path returned by
 * `assetFile(oldFile, newProjectId)`; the caller copies the files listed in `copies` (each project owns its folder).
 */
export async function duplicateProject(
  db: Db,
  id: number,
  options: { name: string; assetFile: (oldFile: string, newProjectId: number) => string },
  now = Date.now()
): Promise<{ projectId: number; copies: { from: string; to: string }[] }> {
  const name = cleanName(options.name);
  return withTransaction(db, async (tx) => {
    const src = await tx.getFirstAsync<ProjectRow>('SELECT * FROM projects WHERE id = ?', id);
    if (!src) throw new InvalidDataError(`No project ${id}`);
    const p = await tx.runAsync(
      `INSERT INTO projects (name, paper_key, orientation, margin_mm, overlap_mm, marks, page_labels, assembly_map, skip_blank,
         excluded_tiles, check_bar, profile_id, thumbnail_path, created_at, updated_at)
       SELECT ?, paper_key, orientation, margin_mm, overlap_mm, marks, page_labels, assembly_map, skip_blank,
         excluded_tiles, check_bar, profile_id, NULL, ?, ? FROM projects WHERE id = ?`,
      name,
      now,
      now,
      id
    );
    const newId = p.lastInsertRowId;
    const assetMap = new Map<number, number>();
    const copies: { from: string; to: string }[] = [];
    const assets = await tx.getAllAsync<{ id: number; file: string }>('SELECT id, file FROM assets WHERE project_id = ? ORDER BY id', id);
    for (const a of assets) {
      const to = options.assetFile(a.file, newId);
      const r = await tx.runAsync(
        `INSERT INTO assets (project_id, kind, file, original_name, bytes, px_w, px_h, page_count, svg_px_per_in, report, created_at, updated_at)
         SELECT ?, kind, ?, original_name, bytes, px_w, px_h, page_count, svg_px_per_in, report, ?, ? FROM assets WHERE id = ?`,
        newId,
        to,
        now,
        now,
        a.id
      );
      assetMap.set(a.id, r.lastInsertRowId);
      copies.push({ from: a.file, to });
    }
    const sheets = await tx.getAllAsync<{ id: number }>('SELECT id FROM sheets WHERE project_id = ? ORDER BY position, id', id);
    for (const s of sheets) {
      const r = await tx.runAsync(
        `INSERT INTO sheets (project_id, position, width_mm, height_mm, paper_key, name, created_at, updated_at)
         SELECT ?, position, width_mm, height_mm, paper_key, name, ?, ? FROM sheets WHERE id = ?`,
        newId,
        now,
        now,
        s.id
      );
      const objects = await tx.getAllAsync<{ id: number; asset_id: number | null }>('SELECT id, asset_id FROM objects WHERE sheet_id = ? ORDER BY z, id', s.id);
      for (const o of objects) {
        await tx.runAsync(
          `INSERT INTO objects (sheet_id, z, kind, asset_id, page_index, x_mm, y_mm, w_mm, h_mm, rotation_deg, mirror_x, mirror_y,
             lock_aspect, crop, fit, repeat, props, name, locked, hidden, created_at, updated_at)
           SELECT ?, z, kind, ?, page_index, x_mm, y_mm, w_mm, h_mm, rotation_deg, mirror_x, mirror_y,
             lock_aspect, crop, fit, repeat, props, name, locked, hidden, ?, ? FROM objects WHERE id = ?`,
          r.lastInsertRowId,
          o.asset_id === null ? null : (assetMap.get(o.asset_id) ?? null),
          now,
          now,
          o.id
        );
      }
    }
    return { projectId: newId, copies };
  });
}

export { touchProject };
