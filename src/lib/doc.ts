// Loads a project with everything the editor and the page preview draw (reads through withRead, D19).
import { listAssets } from '@/db/assets';
import { listObjects } from '@/db/objects';
import { getProfile, type Profile } from '@/db/profiles';
import { getProject } from '@/db/projects';
import { getAppSettings, type AppSettings } from '@/db/settings';
import { listSheets } from '@/db/sheets';
import type { Db } from '@/db/types';
import type { ProjectDoc } from '@/editor/output';
import { isPaperKey } from '@/engine/paper';
import { decodeSvgText } from '@/import/assets';
import type { AssetLoader } from '@/pdf/assets';

import { documentFileExists, documentUri, previewRel, readFileBytes } from './files';
import { deviceRegion } from './locale';
import { makePdfPagePreview, pagePreviewRel } from './previews';

export async function loadProjectDoc(db: Db, projectId: number): Promise<ProjectDoc | null> {
  const project = await getProject(db, projectId);
  if (!project) return null;
  const sheets = await listSheets(db, projectId);
  const objects = (await Promise.all(sheets.map((s) => listObjects(db, s.id)))).flat();
  const assets = await listAssets(db, projectId);
  return { project, sheets, objects, assets };
}

/** Settings (region defaults from the device, D22) and the profile the margins come from. */
export async function loadOutputContext(db: Db, profileId: number | null): Promise<{ settings: AppSettings; profile: Profile | null }> {
  const settings = await getAppSettings(db, deviceRegion());
  const id = profileId ?? settings.lastProfileId;
  const profile = id != null ? await getProfile(db, id) : null;
  if (!isPaperKey(settings.defaultPaper)) settings.defaultPaper = 'a4';
  return { settings, profile };
}

/**
 * Preview URI per `${assetId}:${pageIndex}` for every asset object of the doc: images → the ≤ 2048 px copy (or the
 * original when small and upright); SVG → its PNG; PDF pages → rasterised now if missing (D30).
 */
export async function previewUris(doc: ProjectDoc): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const byId = new Map(doc.assets.map((a) => [a.id, a]));
  for (const o of doc.objects) {
    if (o.assetId == null) continue;
    const a = byId.get(o.assetId);
    if (!a) continue;
    const key = `${a.id}:${o.pageIndex}`;
    if (out[key]) continue;
    let rel: string | null = null;
    if (a.kind === 'image') rel = [previewRel(a.file, 'jpg'), previewRel(a.file, 'png')].find(documentFileExists) ?? a.file;
    else if (a.kind === 'svg') rel = documentFileExists(pagePreviewRel(a.file, 0)) ? pagePreviewRel(a.file, 0) : null;
    else rel = await makePdfPagePreview(a.file, o.pageIndex).catch(() => null);
    if (rel) out[key] = documentUri(rel);
  }
  return out;
}

/** The PDF writer's asset source for a project: always the ORIGINAL files, never the editor previews (D68). */
export function projectAssetLoader(doc: ProjectDoc): AssetLoader {
  const byId = new Map(doc.assets.map((a) => [a.id, a]));
  return async (assetId) => {
    const a = byId.get(assetId);
    if (!a || !documentFileExists(a.file)) return null;
    const bytes = await readFileBytes(documentUri(a.file));
    if (a.kind !== 'svg') return { kind: a.kind, bytes };
    const d = decodeSvgText(bytes);
    return d.ok ? { kind: 'svg', text: d.text } : null;
  };
}
