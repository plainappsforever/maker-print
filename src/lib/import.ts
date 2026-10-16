// File import (SPEC §9.1, §11, §12; D23, D24, D50, D68): real pickers → limits → (platform conversion for HEIC/WebP)
// → inspect (our importers) → copy into the project folder + editor preview → asset row → objects at 100 %.
// Nothing is imported when any step refuses; every refusal is an `import.error.*` message (never a crash, D54).
import * as DocumentPicker from 'expo-document-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { addAsset, deleteAsset, getAsset, type Asset } from '@/db/assets';
import { addObject } from '@/db/objects';
import { addSheet, updateSheet } from '@/db/sheets';
import type { Db } from '@/db/types';
import { centreOn, photoStartSize, sheetForImport, type Size } from '@/editor/place';
import { paperSize, safeArea, type Margins, type PaperKey } from '@/engine/paper';
import { decodeSvgText, inspectAsset, svgSizeAt, type AssetKind, type AssetReport, type Inspected } from '@/import/assets';
import { focalFromPickerExif } from '@/import/image-meta';
import { routeFile } from '@/import/incoming';
import { checkFileBytes } from '@/import/limits';
import { unwrapSvgz } from '@/import/svgz';

import type { PickedFile } from './capture/api';
import type { PhotoFileStore } from './place-batch';

import { fileSize, readFileBytes, removeDocumentFiles, writeProjectAsset } from './files';
import { makeImagePreview, makePdfPagePreview, makeSvgPreview } from './previews';

export type { PickedFile };
export type ImportError = string; // an `import.error.<code>` suffix
export type Prepared = { kind: AssetKind; name: string; bytes: Uint8Array; inspected: Inspected; svgText?: string };

/** Document picker: PDF, SVG and pictures (Files / Drive / iCloud on iOS, the system picker on Android). */
export async function pickFile(): Promise<PickedFile | null> {
  const r = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/svg+xml', 'image/*', 'application/octet-stream', 'text/xml'], copyToCacheDirectory: true, multiple: false });
  if (r.canceled || !r.assets?.length) return null;
  const a = r.assets[0];
  return { uri: a.uri, name: a.name, mimeType: a.mimeType, size: a.size };
}

/**
 * Photo library (PHPicker / Android photo picker): no permission needed (A10). `exif: true` only to carry the 35 mm
 * focal length past the HEIC → JPEG conversion (review S7, `PickedFile.focal35mm`); nothing else of the EXIF is kept.
 */
export async function pickPhoto(): Promise<PickedFile | null> {
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 1, exif: true, allowsMultipleSelection: false });
  if (r.canceled || !r.assets?.length) return null;
  const a = r.assets[0];
  return { uri: a.uri, name: a.fileName ?? a.uri.split('/').pop() ?? 'photo.jpg', mimeType: a.mimeType, size: a.fileSize ?? null, focal35mm: focalFromPickerExif(a.exif) };
}

async function toJpeg(uri: string): Promise<string> {
  const ref = await ImageManipulator.manipulate(uri).renderAsync();
  const out = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.95 });
  return out.uri;
}

/**
 * Reads and checks a picked file; nothing is stored yet. Size limit first (a 51 MB file is refused before it is read,
 * A13), then the platform conversion of HEIC/WebP/GIF to JPEG, then our importers (`languages` = app language, D59).
 */
export async function prepareImport(picked: PickedFile, languages: readonly string[]): Promise<{ ok: true; file: Prepared } | { ok: false; error: ImportError }> {
  const t0 = Date.now();
  const r = await prepare(picked, languages);
  // development builds: one line per import in the Metro log (P5 device measurements)
  if (__DEV__) console.log(`[import] ${picked.name} ${picked.size ?? '?'} B → ${r.ok ? r.file.kind : r.error} in ${Date.now() - t0} ms`);
  return r;
}

async function prepare(picked: PickedFile, languages: readonly string[]): Promise<{ ok: true; file: Prepared } | { ok: false; error: ImportError }> {
  try {
    const lim = checkFileBytes(picked.size ?? fileSize(picked.uri) ?? 1);
    if (lim) return { ok: false, error: lim };
    let bytes = await readFileBytes(picked.uri);
    // the same routing as open-in (review S6): DXF and .makerprint get their "not yet" sentences, unknown types theirs
    const kind = routeFile(bytes, picked.name, picked.mimeType);
    if (kind.action === 'refuse') return { ok: false, error: kind.error };
    let name = picked.name;
    if (kind.kind === 'svg') {
      // .svgz (V15 X03): the plain SVG is stored, so import and print read the same text
      const u = unwrapSvgz(bytes, name);
      if (!u.ok) return { ok: false, error: u.error };
      bytes = u.bytes;
      name = u.name;
    }
    if (kind.kind === 'image' && kind.convert) {
      try {
        bytes = await readFileBytes(await toJpeg(picked.uri));
        name = name.replace(/\.\w+$/, '') + '.jpg';
      } catch {
        return { ok: false, error: 'unsupportedFormat' };
      }
    }
    const r = await inspectAsset(kind.kind, bytes, { languages });
    if (!r.ok) return { ok: false, error: r.error };
    let svgText: string | undefined;
    if (kind.kind === 'svg') {
      const d = decodeSvgText(bytes);
      svgText = d.ok ? d.text : undefined;
    }
    return { ok: true, file: { kind: kind.kind, name, bytes, inspected: r.asset, svgText } };
  } catch {
    return { ok: false, error: 'corrupt' };
  }
}

/** Copies the file into the project, makes the editor preview, adds the asset row. */
export async function storeAsset(db: Db, projectId: number, f: Prepared, languages: readonly string[]): Promise<Asset> {
  const rel = writeProjectAsset(projectId, f.name, f.bytes);
  const rep = f.inspected.report;
  try {
    if (rep.kind === 'image') await makeImagePreview(rel, { pxW: f.inspected.pxW ?? 1, pxH: f.inspected.pxH ?? 1, orientation: rep.orientation, format: rep.format });
    else if (rep.kind === 'pdf') await makePdfPagePreview(rel, 0);
    else if (f.svgText) await makeSvgPreview(rel, f.svgText, svgSizeAt(rep, 96) ?? { w: 100, h: 100 }, languages);
  } catch {
    // a missing preview shows a placeholder box in the editor; the output never uses previews
  }
  const id = await addAsset(db, projectId, {
    kind: f.kind,
    file: rel,
    originalName: f.name,
    bytes: f.bytes.length,
    pxW: f.inspected.pxW,
    pxH: f.inspected.pxH,
    pageCount: f.inspected.pageCount,
    svgPxPerIn: null,
    report: rep as unknown as Record<string, unknown>,
  });
  return (await getAsset(db, id)) as Asset;
}

/** The device's file store for `importBatch` (src/lib/place-batch.ts): files first, removed again if the batch fails. */
export const photoFileStore: PhotoFileStore = {
  write: (projectId, name, bytes) => writeProjectAsset(projectId, name, bytes),
  preview: async (rel, p) => {
    const rep = p.inspected.report;
    if (rep.kind === 'image') await makeImagePreview(rel, { pxW: p.inspected.pxW ?? 1, pxH: p.inspected.pxH ?? 1, orientation: rep.orientation, format: rep.format });
  },
  remove: (rel) => removeDocumentFiles(rel),
};

/** Natural size of what gets placed: PDF page / SVG in mm (ppi answer given), photo start size (no true size). */
export function placeSize(asset: Asset, pageIndex: number, ppi: number | null, ctx: { ppiTarget: number; fitIn: Size | null }): Size | null {
  const rep = asset.report as unknown as AssetReport | null;
  if (!rep) return null;
  if (rep.kind === 'pdf') return rep.pages[pageIndex] ? { w: rep.pages[pageIndex].w, h: rep.pages[pageIndex].h } : null;
  if (rep.kind === 'svg') return svgSizeAt(rep, ppi ?? asset.svgPxPerIn ?? 96);
  return photoStartSize({ w: asset.pxW ?? 1, h: asset.pxH ?? 1 }, rep.sizeMm, ctx.ppiTarget, ctx.fitIn);
}

export type PlaceTarget =
  /** New project from "Open file": its first (empty) sheet is resized to fit the first page */
  | { mode: 'new'; sheetId: number }
  /** Add to the current sheet: first page centred on it, further pages get their own sheets */
  | { mode: 'add'; sheetId: number; sheet: { widthMm: number; heightMm: number } };

/** Places the chosen pages (images/SVG: page 0) at 100 % and returns the first object's sheet and id. */
export async function placeAsset(
  db: Db,
  asset: Asset,
  pages: number[],
  target: PlaceTarget,
  out: { paperKey: PaperKey; margins: Margins; ppiTarget: number }
): Promise<{ sheetId: number; objectId: number } | null> {
  const kind = asset.kind === 'image' ? 'image' : asset.kind === 'pdf' ? 'pdf_page' : 'svg';
  const paper = paperSize(out.paperKey);
  const fitIn = safeArea(paper, out.margins);
  let first: { sheetId: number; objectId: number } | null = null;
  for (const [i, pageIndex] of pages.entries()) {
    const size = placeSize(asset, pageIndex, null, { ppiTarget: out.ppiTarget, fitIn });
    if (!size) continue;
    let sheetId: number;
    let box: { x: number; y: number; w: number; h: number };
    if (i === 0 && target.mode === 'add') {
      sheetId = target.sheetId;
      box = centreOn(target.sheet, size);
    } else {
      // photos have no true size: their sheet is the paper (the start size already fits its safe area)
      const placed = sheetForImport(size, out.paperKey, out.margins);
      if (i === 0 && target.mode === 'new') {
        sheetId = target.sheetId;
        await updateSheet(db, sheetId, placed.sheet);
      } else {
        sheetId = await addSheet(db, asset.projectId, placed.sheet);
      }
      box = placed.box;
    }
    const name = asset.kind === 'pdf' && (asset.pageCount ?? 1) > 1 ? `${asset.originalName} · ${pageIndex + 1}` : asset.originalName;
    const objectId = await addObject(db, sheetId, { kind, assetId: asset.id, pageIndex, ...box, lockAspect: true, name });
    if (kind === 'pdf_page' && pageIndex > 0) await makePdfPagePreview(asset.file, pageIndex).catch(() => null);
    first ??= { sheetId, objectId };
  }
  return first;
}

/** The user cancelled a question (units, pages) for a file just stored: remove its row (objects cascade). */
export async function discardAsset(db: Db, asset: Asset): Promise<void> {
  await deleteAsset(db, asset.id);
  removeDocumentFiles(asset.file);
}
