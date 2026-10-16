// Batch photo import (V15 X06, phase A1): photos → files → asset rows, sheets and objects in ONE transaction (a failure
// places nothing and leaves no files: review S5). Layout: `planBatch` (src/editor/place.ts). At most 20 photos per pick,
// enforced here (review S4). The picker's multi-select is phase A2. No Expo imports: the file store is injected.
import { addAsset, getAsset, type Asset } from '@/db/assets';
import { addObject } from '@/db/objects';
import { addSheet, updateSheet } from '@/db/sheets';
import { withTransaction } from '@/db/tx';
import type { Db } from '@/db/types';
import { planBatch, type BatchTarget } from '@/editor/place';
import type { Margins, PaperKey } from '@/engine/paper';
import type { AssetReport, Inspected } from '@/import/assets';
import { LIMITS } from '@/import/limits';

export type BatchPlaceTarget = { mode: 'new'; sheetId: number } | { mode: 'add'; sheetId: number; sheet: { widthMm: number; heightMm: number } };
type Out = { paperKey: PaperKey; margins: Margins; ppiTarget: number };
export type Placed = { sheetId: number; objectId: number; assetId: number };

/**
 * The cap in code (review S4): Android's photo-picker fallback and `SEND_MULTIPLE` ignore `selectionLimit`. The first
 * `max` in pick order are taken; `dropped` > 0 → the message `import.batch.tooMany` ({max}, {total}).
 */
export function capBatch<T>(items: readonly T[], max: number = LIMITS.batchPhotos): { take: T[]; dropped: number } {
  return { take: items.slice(0, max), dropped: Math.max(0, items.length - max) };
}

/** Places image assets in pick order; returns each placed object (asset order) with its sheet. At most 20. */
export async function placeBatch(db: Db, projectId: number, assets: readonly Asset[], target: BatchPlaceTarget, out: Out): Promise<Placed[]> {
  checkBatch(projectId, assets);
  return withTransaction(db, (tx) => placeIn(tx, projectId, assets, target, out));
}

function checkBatch(projectId: number, assets: readonly Asset[]) {
  if (assets.length > LIMITS.batchPhotos) throw new Error(`placeBatch takes at most ${LIMITS.batchPhotos} photos (capBatch first)`);
  if (assets.some((a) => a.kind !== 'image' || a.projectId !== projectId)) throw new Error('placeBatch takes this project’s photos only');
}

/** The placement itself, on an open transaction's handle. */
async function placeIn(db: Db, projectId: number, assets: readonly Asset[], target: BatchPlaceTarget, out: Out): Promise<Placed[]> {
  const items = assets.map((a) => {
    const rep = a.report as unknown as AssetReport | null;
    return { px: { w: a.pxW ?? 1, h: a.pxH ?? 1 }, declaredMm: rep?.kind === 'image' ? rep.sizeMm : null };
  });
  const bt: BatchTarget = target.mode === 'new' ? { mode: 'new' } : { mode: 'add', sheet: target.sheet };
  const sheets = planBatch(items, { ...out, target: bt });
  const placed: Placed[] = [];
  for (const s of sheets) {
    let sheetId: number;
    if (s.use === 'target') {
      sheetId = target.sheetId;
      if (target.mode === 'new') await updateSheet(db, sheetId, s.sheet);
    } else sheetId = await addSheet(db, projectId, s.sheet);
    for (const b of s.boxes) {
      const a = assets[b.index];
      const objectId = await addObject(db, sheetId, { kind: 'image', assetId: a.id, pageIndex: 0, x: b.x, y: b.y, w: b.w, h: b.h, lockAspect: true, name: a.originalName });
      placed[b.index] = { sheetId, objectId, assetId: a.id };
    }
  }
  return placed;
}

/** A checked photo, not stored yet (`Prepared` of src/lib/import.ts with kind 'image'). */
export type BatchPhoto = { kind: 'image'; name: string; bytes: Uint8Array; inspected: Inspected };

/** Where the photo files go (src/lib/import.ts `photoFileStore` on a device; a Map in tests). */
export type PhotoFileStore = {
  /** Writes the file into the project folder; returns its path relative to the documents folder */
  write(projectId: number, name: string, bytes: Uint8Array): string;
  /** Editor preview; best effort (a missing preview shows a placeholder box) */
  preview?(rel: string, photo: BatchPhoto): Promise<void>;
  /** Removes a file written by `write` and its previews */
  remove(rel: string): void;
};

/** Same names in one batch get " (2)", " (3)" before the extension (I43 captions, review N6). */
export function uniqueNames(names: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const k = n.toLowerCase();
    const c = (seen.get(k) ?? 0) + 1;
    seen.set(k, c);
    if (c === 1) return n;
    const ext = /\.[a-z0-9]{1,10}$/i.exec(n)?.[0] ?? '';
    return `${n.slice(0, n.length - ext.length)} (${c})${ext}`;
  });
}

/**
 * Stores and places a batch of picked photos (review S5: files first, then rows). The first 20 are taken (S4). Every
 * file is written before the transaction; the asset rows, sheets and objects are ONE transaction; if anything fails,
 * the transaction rolls back and every file this call wrote is removed again — nothing is left behind, then the error
 * is rethrown for the batch's message.
 */
export async function importBatch(
  db: Db,
  projectId: number,
  photos: readonly BatchPhoto[],
  target: BatchPlaceTarget,
  out: Out,
  store: PhotoFileStore
): Promise<{ placed: Placed[]; dropped: number }> {
  const { take, dropped } = capBatch(photos);
  if (take.some((p) => p.kind !== 'image')) throw new Error('importBatch takes photos only');
  const names = uniqueNames(take.map((p) => p.name));
  const written: string[] = [];
  try {
    for (const [i, p] of take.entries()) {
      const rel = store.write(projectId, names[i], p.bytes);
      written.push(rel);
      try {
        await store.preview?.(rel, p);
      } catch {
        // a missing preview shows a placeholder box in the editor; the output never uses previews
      }
    }
    const placed = await withTransaction(db, async (tx) => {
      const assets: Asset[] = [];
      for (const [i, p] of take.entries()) {
        const id = await addAsset(tx, projectId, {
          kind: 'image',
          file: written[i],
          originalName: names[i],
          bytes: p.bytes.length,
          pxW: p.inspected.pxW,
          pxH: p.inspected.pxH,
          pageCount: null,
          svgPxPerIn: null,
          report: p.inspected.report as unknown as Record<string, unknown>,
        });
        assets.push((await getAsset(tx, id)) as Asset);
      }
      checkBatch(projectId, assets);
      return placeIn(tx, projectId, assets, target, out);
    });
    return { placed, dropped };
  } catch (error) {
    for (const rel of written) {
      try {
        store.remove(rel);
      } catch {
        // the original error is what the user hears about
      }
    }
    throw error;
  }
}

export type BatchOutcome<E extends string> = { imported: number; total: number; refused: { name: string; error: E }[] };

/** What a batch did, for the one message after it (every refused file named with its reason, never silent). */
export function summariseBatch<E extends string>(results: readonly ({ name: string; ok: true } | { name: string; ok: false; error: E })[]): BatchOutcome<E> {
  const refused = results.flatMap((r) => (r.ok ? [] : [{ name: r.name, error: r.error }]));
  return { imported: results.length - refused.length, total: results.length, refused };
}
