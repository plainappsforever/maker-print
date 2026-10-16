import { createTestDb } from '../../test/node-sqlite-db';
import { addAsset, getAsset, listAssets, type Asset } from '@/db/assets';
import { openDatabase } from '@/db/migrations';
import { listObjects } from '@/db/objects';
import { createProject } from '@/db/projects';
import { getSheet, listSheets } from '@/db/sheets';
import { withRead } from '@/db/tx';
import type { Db } from '@/db/types';

import type { Inspected } from '@/import/assets';
import { LIMITS } from '@/import/limits';

import { capBatch, importBatch, placeBatch, summariseBatch, uniqueNames, type BatchPhoto, type PhotoFileStore } from './place-batch';

const OUT = { paperKey: 'a4' as const, margins: { l: 6.35, t: 6.35, r: 6.35, b: 6.35 }, ppiTarget: 300 };

async function photo(db: Db, projectId: number, name: string, px: [number, number], sizeMm: { w: number; h: number } | null = null): Promise<Asset> {
  const id = await addAsset(db, projectId, {
    kind: 'image',
    file: `assets/${projectId}/${name}`,
    originalName: name,
    bytes: 1000,
    pxW: px[0],
    pxH: px[1],
    pageCount: null,
    svgPxPerIn: null,
    report: { v: 1, kind: 'image', format: 'jpeg', orientation: 1, density: null, sizeMm },
  });
  return (await getAsset(db, id)) as Asset;
}

describe('placeBatch (V15 X06 glue)', () => {
  it('new project: the first sheet is reused, the rest added; objects in pick order, at the planned boxes, named', async () => {
    const db = createTestDb();
    await openDatabase(db);
    const { projectId, sheetId } = await createProject(db, { name: 'Batch', paperKey: 'a4' }, 1);
    const assets = [await photo(db, projectId, 'a.jpg', [3024, 4032]), await photo(db, projectId, 'b.jpg', [600, 450]), await photo(db, projectId, 'c.jpg', [600, 450])];
    const placed = await placeBatch(db, projectId, assets, { mode: 'new', sheetId }, OUT);
    expect(placed.map((p) => p.assetId)).toEqual(assets.map((a) => a.id));
    expect(placed[0].sheetId).toBe(sheetId);
    const sheets = await withRead(db, (db) => listSheets(db, projectId));
    expect(sheets).toHaveLength(2);
    const second = await withRead(db, (db) => listObjects(db, sheets[1].id));
    expect(second.map((o) => o.name)).toEqual(['b.jpg', 'c.jpg']);
    expect(second.every((o) => o.kind === 'image' && o.lockAspect)).toBe(true);
    expect(second[0].w).toBeCloseTo((600 / 300) * 25.4, 9);
  });

  it('add mode leaves the current sheet’s size alone; a failure places nothing (one transaction)', async () => {
    const db = createTestDb();
    await openDatabase(db);
    const { projectId, sheetId } = await createProject(db, { name: 'P', paperKey: 'a4' }, 1);
    const before = await withRead(db, (db) => getSheet(db, sheetId));
    const a = await photo(db, projectId, 'a.jpg', [600, 450]);
    await placeBatch(db, projectId, [a], { mode: 'add', sheetId, sheet: { widthMm: before!.widthMm, heightMm: before!.heightMm } }, OUT);
    expect(await withRead(db, (db) => getSheet(db, sheetId))).toMatchObject({ widthMm: before!.widthMm, heightMm: before!.heightMm });
    // the last photo's row is gone (deleted elsewhere) → addObject throws after sheets and objects were written:
    // the whole batch is rolled back
    const objectsBefore = (await withRead(db, (db) => listObjects(db, sheetId))).length;
    const b = await photo(db, projectId, 'b.jpg', [600, 450]);
    const ghost: Asset = { ...b, id: 9999 };
    const many = [...Array.from({ length: 19 }, () => b), ghost];
    await expect(placeBatch(db, projectId, many, { mode: 'add', sheetId, sheet: { widthMm: 210, heightMm: 297 } }, OUT)).rejects.toThrow(/9999/);
    expect((await withRead(db, (db) => listSheets(db, projectId))).length).toBe(1);
    expect((await withRead(db, (db) => listObjects(db, sheetId))).length).toBe(objectsBefore);
    // only this project's photos
    const other = await createProject(db, { name: 'O', paperKey: 'a4' }, 2);
    const foreign = await photo(db, other.projectId, 'x.jpg', [10, 10]);
    await expect(placeBatch(db, projectId, [foreign], { mode: 'new', sheetId }, OUT)).rejects.toThrow(/this project/);
  });

  it('review S4: the 20-photo cap is enforced in code (capBatch trims in pick order; placeBatch refuses 21)', async () => {
    expect(LIMITS.batchPhotos).toBe(20);
    const ids = Array.from({ length: 26 }, (_, i) => i);
    expect(capBatch(ids)).toEqual({ take: ids.slice(0, 20), dropped: 6 });
    expect(capBatch(ids.slice(0, 20))).toEqual({ take: ids.slice(0, 20), dropped: 0 });
    const db = createTestDb();
    await openDatabase(db);
    const { projectId, sheetId } = await createProject(db, { name: 'Cap', paperKey: 'a4' }, 1);
    const b = await photo(db, projectId, 'b.jpg', [600, 450]);
    await expect(placeBatch(db, projectId, Array.from({ length: 21 }, () => b), { mode: 'new', sheetId }, OUT)).rejects.toThrow(/at most 20/);
    expect((await withRead(db, (db) => listObjects(db, sheetId))).length).toBe(0);
    expect((await placeBatch(db, projectId, Array.from({ length: 20 }, () => b), { mode: 'new', sheetId }, OUT)).length).toBe(20);
  });

  describe('importBatch: files first, then rows; a failure leaves no rows and no files (review S5)', () => {
    const inspected = (w: number, h: number): Inspected => ({ kind: 'image', pxW: w, pxH: h, pageCount: null, needsPpi: false, report: { v: 1, kind: 'image', format: 'jpeg', orientation: 1, density: null, sizeMm: null } as Inspected['report'] });
    const shot = (name: string, w = 600, h = 450): BatchPhoto => ({ kind: 'image', name, bytes: new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), inspected: inspected(w, h) });
    /** A Map as the documents folder; `failWriteAt` = the n-th write throws (disk full). */
    function memStore(failWriteAt = -1): PhotoFileStore & { files: Map<string, Uint8Array>; previews: string[]; writes: number } {
      const st = {
        files: new Map<string, Uint8Array>(),
        previews: [] as string[],
        writes: 0,
        write(projectId: number, name: string, bytes: Uint8Array) {
          if (st.writes++ === failWriteAt) throw new Error('disk full');
          const rel = `assets/${projectId}/${st.writes}-${name}`;
          st.files.set(rel, bytes);
          return rel;
        },
        async preview(rel: string) {
          st.previews.push(rel);
          if (rel.includes('nopreview')) throw new Error('preview failed');
        },
        remove(rel: string) {
          st.files.delete(rel);
        },
      };
      return st;
    }
    async function setup() {
      const db = createTestDb();
      await openDatabase(db);
      const { projectId, sheetId } = await createProject(db, { name: 'B', paperKey: 'a4' }, 1);
      return { db, projectId, sheetId };
    }
    const counts = async (db: Db, projectId: number, sheetId: number) => ({
      assets: (await withRead(db, (db) => listAssets(db, projectId))).length,
      sheets: (await withRead(db, (db) => listSheets(db, projectId))).length,
      objects: (await withRead(db, (db) => listObjects(db, sheetId))).length,
    });

    it('success: one file + one row per photo, placed in pick order; same names numbered; a failed preview is harmless', async () => {
      const { db, projectId, sheetId } = await setup();
      const store = memStore();
      const r = await importBatch(db, projectId, [shot('IMG.jpg'), shot('nopreview.jpg'), shot('img.JPG'), shot('IMG.jpg')], { mode: 'new', sheetId }, OUT, store);
      expect(r.dropped).toBe(0);
      expect(r.placed).toHaveLength(4);
      expect(store.files.size).toBe(4);
      const assets = await withRead(db, (db) => listAssets(db, projectId));
      expect(assets.map((a) => a.originalName)).toEqual(['IMG.jpg', 'nopreview.jpg', 'img (2).JPG', 'IMG (3).jpg']);
      expect(assets.every((a) => store.files.has(a.file))).toBe(true);
      const objs = await withRead(db, (db) => listObjects(db, sheetId));
      expect(objs.map((o) => o.name)).toEqual(['IMG.jpg', 'nopreview.jpg', 'img (2).JPG', 'IMG (3).jpg']);
    });

    it('26 picked: the first 20 are stored and placed, 6 dropped (and said)', async () => {
      const { db, projectId, sheetId } = await setup();
      const store = memStore();
      const r = await importBatch(db, projectId, Array.from({ length: 26 }, (_, i) => shot(`p${i}.jpg`)), { mode: 'new', sheetId }, OUT, store);
      expect(r).toMatchObject({ dropped: 6 });
      expect(r.placed).toHaveLength(20);
      expect(store.files.size).toBe(20);
      expect((await withRead(db, (db) => listAssets(db, projectId))).map((a) => a.originalName)).toEqual(Array.from({ length: 20 }, (_, i) => `p${i}.jpg`));
    });

    it('a row failing after 4 files and rows were written: rolled back, all 5 files removed', async () => {
      const { db, projectId, sheetId } = await setup();
      const before = await counts(db, projectId, sheetId);
      const store = memStore();
      // px 0 is refused by addAsset (InvalidDataError) on the 5th photo, after 4 asset rows were inserted
      const photos = [shot('a.jpg'), shot('b.jpg'), shot('c.jpg'), shot('d.jpg'), shot('bad.jpg', 0, 450)];
      await expect(importBatch(db, projectId, photos, { mode: 'new', sheetId }, OUT, store)).rejects.toThrow(/px_w/);
      expect(store.writes).toBe(5);
      expect(store.files.size).toBe(0);
      expect(await counts(db, projectId, sheetId)).toEqual(before);
    });

    it('a placement failing after every row was written: rolled back, files removed', async () => {
      const { db, projectId } = await setup();
      const other = await createProject(db, { name: 'O', paperKey: 'a4' }, 2);
      const store = memStore();
      // a target sheet that does not exist: addObject fails (foreign key) after both asset rows were inserted
      await expect(importBatch(db, projectId, [shot('a.jpg'), shot('b.jpg')], { mode: 'add', sheetId: 99999, sheet: { widthMm: 210, heightMm: 297 } }, OUT, store)).rejects.toThrow();
      expect(store.files.size).toBe(0);
      expect((await withRead(db, (db) => listAssets(db, projectId))).length).toBe(0);
      expect((await withRead(db, (db) => listAssets(db, other.projectId))).length).toBe(0);
    });

    it('a write failing (disk full) on the 3rd file: the 2 written files are removed, no rows', async () => {
      const { db, projectId, sheetId } = await setup();
      const before = await counts(db, projectId, sheetId);
      const store = memStore(2);
      await expect(importBatch(db, projectId, [shot('a.jpg'), shot('b.jpg'), shot('c.jpg'), shot('d.jpg')], { mode: 'new', sheetId }, OUT, store)).rejects.toThrow('disk full');
      expect(store.writes).toBe(3);
      expect(store.files.size).toBe(0);
      expect(await counts(db, projectId, sheetId)).toEqual(before);
    });

    it('uniqueNames: case-insensitive, extension kept, no extension', () => {
      expect(uniqueNames(['a.jpg', 'A.jpg', 'a.jpg', 'Foto', 'Foto', 'b.png'])).toEqual(['a.jpg', 'A (2).jpg', 'a (3).jpg', 'Foto', 'Foto (2)', 'b.png']);
    });
  });

  it('summariseBatch names every refused file with its reason', () => {
    expect(summariseBatch([{ name: 'a.jpg', ok: true }, { name: 'b.heic', ok: false, error: 'unsupportedFormat' }, { name: 'c.jpg', ok: true }])).toEqual({
      imported: 2,
      total: 3,
      refused: [{ name: 'b.heic', error: 'unsupportedFormat' }],
    });
  });
});
