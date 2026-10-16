/**
 * @jest-environment node
 */
import { createTestDb } from '../../test/node-sqlite-db';

import { addAsset, deleteAsset, getAsset, listAssets, setSvgPxPerIn, type NewAsset } from './assets';
import { getCalibration, listCalibrations, saveCalibration, type NewCalibration } from './calibrations';
import { InvalidDataError } from './errors';
import { LATEST_VERSION, migrate, MIGRATIONS as MIGRATIONS_FOR_TEST, openDatabase } from './migrations';
import { addObject, deleteObject, duplicateObject, getObject, listObjects, setObjectOrder, updateObject } from './objects';
import { createProfile, deleteProfile, forgetProfilePrinter, getProfile, recordPrinter, setLearnedMargins, updateProfile } from './profiles';
import { createProject, deleteProject, duplicateProject, getProject, listProjects, updateProject } from './projects';
import { defaultSettings, getAppSettings, getThemePreference, setAppSetting, setSetting, setThemePreference } from './settings';
import { addSheet, deleteSheet, getSheet, listSheets, updateSheet } from './sheets';
import type { Db } from './types';

async function freshDb() {
  const db = createTestDb();
  await openDatabase(db);
  return db;
}

const count = async (db: Db, table: string) => (await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))?.n;
const image = (file = 'assets/1/photo.jpg'): NewAsset => ({
  kind: 'image',
  file,
  originalName: 'photo.jpg',
  bytes: 1234,
  pxW: 4032,
  pxH: 3024,
  pageCount: null,
  svgPxPerIn: null,
  report: null,
});

describe('migrations', () => {
  it('reaches the latest version, is safe to run again, and turns foreign keys on', async () => {
    const db = await freshDb();
    await openDatabase(db);
    const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    expect(row?.user_version).toBe(LATEST_VERSION);
    expect(LATEST_VERSION).toBe(3);
    expect((await db.getFirstAsync<{ foreign_keys: number }>('PRAGMA foreign_keys'))?.foreign_keys).toBe(1);
  });

  it('upgrades a template v1 database: drops the demo items table, keeps settings', async () => {
    const db = createTestDb();
    await db.execAsync('PRAGMA foreign_keys = ON;');
    await migrate(db, [
      `CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
       CREATE TABLE settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);`,
    ]);
    await db.runAsync("INSERT INTO items (title, created_at) VALUES ('demo', 1)");
    await setThemePreference(db, 'dark');
    await migrate(db);
    expect(await db.getFirstAsync("SELECT name FROM sqlite_master WHERE name = 'items'")).toBeNull();
    expect(await getThemePreference(db)).toBe('dark');
  });

  it('CHECK constraints refuse invalid enums and sizes even for raw SQL', async () => {
    const db = await freshDb();
    await expect(db.runAsync("INSERT INTO projects (name, paper_key, orientation, created_at, updated_at) VALUES ('x', 'a4', 'diagonal', 1, 1)")).rejects.toThrow();
    const { projectId } = await createProject(db, { name: 'P', paperKey: 'a4' }, 1);
    await expect(db.runAsync('INSERT INTO sheets (project_id, position, width_mm, height_mm, created_at, updated_at) VALUES (?, 1, 0, 10, 1, 1)', projectId)).rejects.toThrow();
  });
});

describe('projects and sheets', () => {
  it('creates a project with a first sheet the size of the output paper', async () => {
    const db = await freshDb();
    const { projectId, sheetId } = await createProject(db, { name: '  Router template ', paperKey: 'letter' }, 100);
    const p = await getProject(db, projectId);
    expect(p).toMatchObject({ name: 'Router template', paperKey: 'letter', orientation: 'auto', marginMm: null, overlapMm: 10, marks: 'registration' });
    expect(p).toMatchObject({ pageLabels: true, assemblyMap: 'auto', skipBlank: true, excludedTiles: [], checkBar: null, profileId: null });
    expect(await getSheet(db, sheetId)).toMatchObject({ widthMm: 215.9, heightMm: 279.4, paperKey: 'letter', position: 0 });
  });

  it('lists projects last edited first, with sheet count and first sheet size', async () => {
    const db = await freshDb();
    const a = await createProject(db, { name: 'A', paperKey: 'a4' }, 1);
    const b = await createProject(db, { name: 'Big', paperKey: 'a4', sheet: { widthMm: 600, heightMm: 900 } }, 2);
    await addSheet(db, a.projectId, { widthMm: 105, heightMm: 148, paperKey: 'a6' }, 3);
    const list = await listProjects(db);
    expect(list.map((p) => [p.name, p.sheetCount, p.widthMm, p.heightMm])).toEqual([
      ['A', 2, 210, 297],
      ['Big', 1, 600, 900],
    ]);
    expect(b.projectId).toBeGreaterThan(a.projectId);
  });

  it('validates updates: names, enums, tile labels, sheet limits', async () => {
    const db = await freshDb();
    const { projectId, sheetId } = await createProject(db, { name: 'P', paperKey: 'a4' }, 1);
    await updateProject(db, projectId, { orientation: 'landscape', excludedTiles: ['A1', 'B12'], checkBar: false, marginMm: 3 }, 5);
    expect(await getProject(db, projectId)).toMatchObject({ orientation: 'landscape', excludedTiles: ['A1', 'B12'], checkBar: false, marginMm: 3, updatedAt: 5 });
    await expect(updateProject(db, projectId, { name: '   ' })).rejects.toBeInstanceOf(InvalidDataError);
    await expect(updateProject(db, projectId, { excludedTiles: ['a1'] })).rejects.toBeInstanceOf(InvalidDataError);
    // sheet-prefixed keys for sheets 2+ (D40); sheet 1 never carries a prefix
    await updateProject(db, projectId, { excludedTiles: ['A1', '2:B3', '12:AA10'] });
    expect((await getProject(db, projectId))?.excludedTiles).toEqual(['A1', '2:B3', '12:AA10']);
    for (const bad of ['1:A1', '0:A1', '2:', ':A1', '2:a1'])
      await expect(updateProject(db, projectId, { excludedTiles: [bad] })).rejects.toBeInstanceOf(InvalidDataError);
    await expect(updateProject(db, projectId, { paperKey: 'a9' as never })).rejects.toBeInstanceOf(InvalidDataError);
    await expect(updateSheet(db, sheetId, { widthMm: 3001 })).rejects.toBeInstanceOf(InvalidDataError);
    await expect(createProject(db, { name: 'X', paperKey: 'a4', sheet: { widthMm: -1, heightMm: 10 } })).rejects.toBeInstanceOf(InvalidDataError);
  });

  it('never deletes the last sheet; deleting another removes its objects', async () => {
    const db = await freshDb();
    const { projectId, sheetId } = await createProject(db, { name: 'P', paperKey: 'a4' }, 1);
    expect(await deleteSheet(db, sheetId)).toBe(false);
    const second = await addSheet(db, projectId, { widthMm: 100, heightMm: 100 }, 2);
    await addObject(db, second, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
    expect(await deleteSheet(db, second)).toBe(true);
    expect(await count(db, 'objects')).toBe(0);
    expect((await listSheets(db, projectId)).map((s) => s.id)).toEqual([sheetId]);
  });

  it('delete cascades sheets, objects and assets and returns the asset files', async () => {
    const db = await freshDb();
    const { projectId, sheetId } = await createProject(db, { name: 'P', paperKey: 'a4' }, 1);
    const assetId = await addAsset(db, projectId, image('assets/1/a.jpg'));
    await addObject(db, sheetId, { kind: 'image', assetId, x: 0, y: 0, w: 40, h: 30 });
    await addObject(db, sheetId, { kind: 'ruler', x: 0, y: 50, w: 150, h: 20, props: { lengthMm: 150 } });
    const other = await createProject(db, { name: 'Other', paperKey: 'a4' }, 2);
    await addObject(db, other.sheetId, { kind: 'rect', x: 1, y: 1, w: 1, h: 1 });

    expect(await deleteProject(db, projectId)).toEqual(['assets/1/a.jpg']);
    expect([await count(db, 'projects'), await count(db, 'sheets'), await count(db, 'objects'), await count(db, 'assets')]).toEqual([1, 1, 1, 0]);
  });

  it('duplicate copies sheets, objects and assets with remapped asset ids', async () => {
    const db = await freshDb();
    const { projectId, sheetId } = await createProject(db, { name: 'P', paperKey: 'a4' }, 1);
    const assetId = await addAsset(db, projectId, image(`assets/${projectId}/a.jpg`));
    await addObject(db, sheetId, { kind: 'image', assetId, x: 5, y: 6, w: 40, h: 30, crop: { l: 0.1, t: 0, r: 0, b: 0.2 } });
    await addSheet(db, projectId, { widthMm: 600, heightMm: 900 }, 2);
    await updateProject(db, projectId, { excludedTiles: ['A1'], thumbnailPath: 'thumbs/1.png' });

    const dup = await duplicateProject(db, projectId, { name: 'P copy', assetFile: (f, id) => f.replace(/^assets\/\d+\//, `assets/${id}/`) }, 9);
    expect(dup.copies).toEqual([{ from: `assets/${projectId}/a.jpg`, to: `assets/${dup.projectId}/a.jpg` }]);
    const copy = await getProject(db, dup.projectId);
    expect(copy).toMatchObject({ name: 'P copy', excludedTiles: ['A1'], thumbnailPath: null, createdAt: 9 });
    const sheets = await listSheets(db, dup.projectId);
    expect(sheets.map((s) => [s.widthMm, s.heightMm])).toEqual([
      [210, 297],
      [600, 900],
    ]);
    const [obj] = await listObjects(db, sheets[0].id);
    const [asset] = await listAssets(db, dup.projectId);
    expect(obj).toMatchObject({ kind: 'image', assetId: asset.id, x: 5, crop: { l: 0.1, t: 0, r: 0, b: 0.2 } });
    expect(asset.id).not.toBe(assetId);
    // the original is untouched
    expect((await listObjects(db, sheetId))[0].assetId).toBe(assetId);
  });
});

describe('objects', () => {
  it('stacks by z, edits through guards, touches the project', async () => {
    const db = await freshDb();
    const { projectId, sheetId } = await createProject(db, { name: 'P', paperKey: 'a4' }, 1);
    const a = await addObject(db, sheetId, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, 2);
    const b = await addObject(db, sheetId, { kind: 'text', x: 0, y: 0, w: 50, h: 10, props: { text: 'Hi', sizePt: 12 } }, 3);
    expect((await listObjects(db, sheetId)).map((o) => [o.id, o.z])).toEqual([
      [a, 0],
      [b, 1],
    ]);
    await updateObject(db, a, { x: -5, rotationDeg: 90, mirrorX: true, repeat: { cols: 3, rows: 8, gap_x_mm: 2, gap_y_mm: 2, trim_marks: true } }, 7);
    expect(await getObject(db, a)).toMatchObject({ x: -5, rotationDeg: 90, mirrorX: true, lockAspect: true, fit: 'fill', repeat: { cols: 3, rows: 8 } });
    expect((await getProject(db, projectId))?.updatedAt).toBe(7);

    await expect(updateObject(db, a, { crop: { l: 0.6, t: 0, r: 0.5, b: 0 } })).rejects.toBeInstanceOf(InvalidDataError);
    await expect(updateObject(db, a, { repeat: { cols: 0, rows: 1, gap_x_mm: 0, gap_y_mm: 0, trim_marks: false } })).rejects.toBeInstanceOf(InvalidDataError);
    await expect(updateObject(db, a, { w: 0 })).rejects.toBeInstanceOf(InvalidDataError);
    await expect(updateObject(db, a, { x: Number.NaN })).rejects.toBeInstanceOf(InvalidDataError);
    await expect(updateObject(db, a, { props: [] as never })).rejects.toBeInstanceOf(InvalidDataError);
  });

  it('file kinds need an asset of the same project; generated kinds take none', async () => {
    const db = await freshDb();
    const p1 = await createProject(db, { name: 'P1', paperKey: 'a4' });
    const p2 = await createProject(db, { name: 'P2', paperKey: 'a4' });
    const foreign = await addAsset(db, p2.projectId, image('assets/2/x.jpg'));
    await expect(addObject(db, p1.sheetId, { kind: 'image', x: 0, y: 0, w: 1, h: 1 })).rejects.toBeInstanceOf(InvalidDataError);
    await expect(addObject(db, p1.sheetId, { kind: 'image', assetId: foreign, x: 0, y: 0, w: 1, h: 1 })).rejects.toBeInstanceOf(InvalidDataError);
    await expect(addObject(db, p1.sheetId, { kind: 'grid', assetId: foreign, x: 0, y: 0, w: 1, h: 1 })).rejects.toBeInstanceOf(InvalidDataError);
    await expect(addObject(db, 999, { kind: 'grid', x: 0, y: 0, w: 1, h: 1 })).rejects.toBeInstanceOf(InvalidDataError);
  });

  it('reads tolerate corrupt JSON cells', async () => {
    const db = await freshDb();
    const { sheetId } = await createProject(db, { name: 'P', paperKey: 'a4' });
    const id = await addObject(db, sheetId, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
    await db.runAsync("UPDATE objects SET crop = '{bad', repeat = '{\"cols\":-1}', props = 'null' WHERE id = ?", id);
    expect(await getObject(db, id)).toMatchObject({ crop: null, repeat: null, props: {} });
  });

  it('layers, duplicate, delete, and a late autosave after delete is dropped', async () => {
    const db = await freshDb();
    const { sheetId } = await createProject(db, { name: 'P', paperKey: 'a4' });
    const a = await addObject(db, sheetId, { kind: 'rect', x: 0, y: 0, w: 10, h: 10, name: 'A' });
    const b = await addObject(db, sheetId, { kind: 'ellipse', x: 0, y: 0, w: 10, h: 10 });
    await setObjectOrder(db, sheetId, [b, a]);
    expect((await listObjects(db, sheetId)).map((o) => o.id)).toEqual([b, a]);
    await expect(setObjectOrder(db, sheetId, [a])).rejects.toBeInstanceOf(InvalidDataError);
    const c = await duplicateObject(db, a);
    expect(await getObject(db, c)).toMatchObject({ kind: 'rect', x: 5, y: 5, name: 'A', z: 2 });
    await deleteObject(db, a);
    await expect(updateObject(db, a, { x: 1 })).resolves.toBeUndefined();
    expect(await getObject(db, a)).toBeNull();
  });

  it('overlapping autosaves are all kept when another write unit fails (write queue, L27)', async () => {
    const db = await freshDb();
    const { sheetId } = await createProject(db, { name: 'P', paperKey: 'a4' });
    const ids = await Promise.all(Array.from({ length: 5 }, (_, i) => addObject(db, sheetId, { kind: 'rect', x: i, y: 0, w: 1, h: 1 })));
    const failing = createProject(db, { name: 'Bad', paperKey: 'a4', sheet: { widthMm: 5000, heightMm: 1 } });
    const failingTx = addAsset(db, 999, image()); // FK failure inside a transaction
    const saves = ids.map((id, i) => updateObject(db, id, { x: 100 + i }));
    await expect(failing).rejects.toBeInstanceOf(InvalidDataError);
    await expect(failingTx).rejects.toThrow();
    await Promise.all(saves);
    expect((await listObjects(db, sheetId)).map((o) => o.x)).toEqual([100, 101, 102, 103, 104]);
  });
});

describe('assets', () => {
  it('deleteAsset removes the row and its objects (a cancelled import), and ignores a missing id', async () => {
    const db = await freshDb();
    const { projectId, sheetId } = await createProject(db, { name: 'P', paperKey: 'a4' });
    const a = await addAsset(db, projectId, image());
    await addObject(db, sheetId, { kind: 'image', assetId: a, x: 0, y: 0, w: 10, h: 10 });
    await deleteAsset(db, a);
    expect(await getAsset(db, a)).toBeNull();
    expect(await listObjects(db, sheetId)).toEqual([]);
    await expect(deleteAsset(db, 999)).resolves.toBeUndefined();
  });

  it('stores relative paths and metadata; SVG units answer; report JSON guarded', async () => {
    const db = await freshDb();
    const { projectId } = await createProject(db, { name: 'P', paperKey: 'a4' });
    const id = await addAsset(db, projectId, { ...image('assets/1/a.svg'), kind: 'svg', pxW: null, pxH: null, report: { unsupported: ['filter'] } });
    await setSvgPxPerIn(db, id, 96);
    expect(await getAsset(db, id)).toMatchObject({ kind: 'svg', svgPxPerIn: 96, report: { unsupported: ['filter'] } });
    await expect(addAsset(db, projectId, image('/abs/path.jpg'))).rejects.toBeInstanceOf(InvalidDataError);
    await expect(addAsset(db, projectId, image('assets/../x.jpg'))).rejects.toBeInstanceOf(InvalidDataError);
    await expect(addAsset(db, projectId, { ...image(), pxW: 0 })).rejects.toBeInstanceOf(InvalidDataError);
    await expect(setSvgPxPerIn(db, id, 0)).rejects.toBeInstanceOf(InvalidDataError);
  });
});

describe('printer profiles and calibrations', () => {
  const cal = (profileId: number, over: Partial<NewCalibration> = {}): NewCalibration => ({
    profileId,
    paperKey: 'a4',
    jobKind: 'single',
    nominalX: 100,
    measuredX: 96.5,
    nominalY: 100,
    measuredY: 96.5,
    route: 'exact',
    ...over,
  });

  it('saves the correction fx = nominal / measured (W7: 96.5 of 100 → 1.03627)', async () => {
    const db = await freshDb();
    const id = await createProfile(db, { name: 'Home inkjet' });
    const c = await saveCalibration(db, cal(id), 50);
    expect(c.fx).toBeCloseTo(1.03627, 5);
    expect(c.measuredAt).toBe(50);
  });

  it('UNIQUE (profile, paper, job kind): the newest measurement replaces the previous one', async () => {
    const db = await freshDb();
    const id = await createProfile(db, { name: 'Home inkjet' });
    await saveCalibration(db, cal(id), 1);
    await saveCalibration(db, cal(id, { measuredX: 100.4, measuredY: 100.2, route: 'fallback' }), 2);
    await saveCalibration(db, cal(id, { jobKind: 'multi', measuredX: 97 }), 3);
    await saveCalibration(db, cal(id, { paperKey: 'letter', measuredX: 99 }), 4);
    expect(await count(db, 'calibrations')).toBe(3);
    const single = await getCalibration(db, id, 'a4', 'single');
    expect(single).toMatchObject({ measuredX: 100.4, measuredY: 100.2, route: 'fallback', measuredAt: 2 });
    expect(single?.fx).toBeCloseTo(0.99602, 5);
    // never another paper's or job kind's correction (D18)
    expect(await getCalibration(db, id, 'a3', 'single')).toBeNull();
    expect((await listCalibrations(db, id)).map((c) => `${c.paperKey}/${c.jobKind}`)).toEqual(['a4/multi', 'a4/single', 'letter/single']);
  });

  it('refuses impossible measurements and unknown profiles', async () => {
    const db = await freshDb();
    const id = await createProfile(db, { name: 'Laser' });
    await expect(saveCalibration(db, cal(id, { measuredX: 0 }))).rejects.toBeInstanceOf(InvalidDataError);
    await expect(saveCalibration(db, cal(id, { paperKey: 'x' as never }))).rejects.toBeInstanceOf(InvalidDataError);
    await expect(saveCalibration(db, cal(id + 1))).rejects.toBeInstanceOf(InvalidDataError);
  });

  it('learned margins never overwrite typed ones (D17)', async () => {
    const db = await freshDb();
    const id = await createProfile(db, { name: 'Home inkjet' });
    expect(await getProfile(db, id)).toMatchObject({ margins: null, marginsSource: 'default' });
    expect(await setLearnedMargins(db, id, { l: 3.2, t: 3.2, r: 3.2, b: 5 }, 'HP OfficeJet')).toBe(true);
    expect(await getProfile(db, id)).toMatchObject({ margins: { b: 5 }, marginsSource: 'learned', lastPrinterName: 'HP OfficeJet' });
    await updateProfile(db, id, { margins: { l: 4, t: 4, r: 4, b: 4 } });
    expect(await setLearnedMargins(db, id, { l: 1, t: 1, r: 1, b: 1 }, 'Canon')).toBe(false);
    expect(await getProfile(db, id)).toMatchObject({ margins: { l: 4 }, marginsSource: 'typed', lastPrinterName: 'Canon' });
    await expect(updateProfile(db, id, { margins: { l: -1, t: 0, r: 0, b: 0 } })).rejects.toBeInstanceOf(InvalidDataError);
  });

  it('migration 3 (v1.1, D85): printer ids on calibrations and profiles; an old v2 database upgrades', async () => {
    const db = createTestDb();
    await db.execAsync('PRAGMA foreign_keys = ON;');
    await migrate(db, MIGRATIONS_FOR_TEST.slice(0, 2));
    const id = await createProfile(db, { name: 'Old' });
    // a v1.0 row, written with the v2 columns only
    await db.runAsync(
      `INSERT INTO calibrations (profile_id, paper_key, job_kind, nominal_x_mm, measured_x_mm, nominal_y_mm, measured_y_mm, fx, fy, route, measured_at, created_at, updated_at)
       VALUES (?, 'a4', 'single', 150, 149, 200, 199.5, 1.0067, 1.0025, 'exact', 1, 1, 1)`,
      id
    );
    await migrate(db);
    expect((await listCalibrations(db, id))[0]).toMatchObject({ printerId: null, printerName: null });
    expect(await getProfile(db, id)).toMatchObject({ printerId: null, reportedMargins: null, marginsPaperKey: null });
    await saveCalibration(db, { ...cal(id), printerId: 'urn:uuid:1', printerName: 'Brother' });
    expect((await listCalibrations(db, id))[0]).toMatchObject({ printerId: 'urn:uuid:1', printerName: 'Brother' });
  });

  it('recordPrinter: typed margins stay, the reported ones are kept; another printer changes nothing', async () => {
    const db = await freshDb();
    const id = await createProfile(db, { name: 'P' });
    await updateProfile(db, id, { margins: { l: 2, t: 2, r: 2, b: 2 } });
    expect(await recordPrinter(db, id, { margins: { l: 4.2, t: 4.2, r: 4.2, b: 4.2 }, printerName: 'A', printerId: 'a', paperKey: 'letter' })).toEqual({ marginsStored: false, otherPrinter: false, profilePrinterName: 'A' });
    expect(await getProfile(db, id)).toMatchObject({ margins: { l: 2 }, marginsSource: 'typed', reportedMargins: { l: 4.2 }, printerId: 'a', marginsPaperKey: 'letter' });
    expect(await recordPrinter(db, id, { margins: { l: 1, t: 1, r: 1, b: 1 }, printerName: 'B', printerId: 'b' })).toMatchObject({ otherPrinter: true, profilePrinterName: 'A' });
    expect(await getProfile(db, id)).toMatchObject({ reportedMargins: { l: 4.2 }, lastPrinterName: 'A' });
    await forgetProfilePrinter(db, id);
    expect(await recordPrinter(db, id, { margins: { l: 1, t: 1, r: 1, b: 1 }, printerName: 'B', printerId: 'b' })).toMatchObject({ otherPrinter: false });
    expect(await getProfile(db, id)).toMatchObject({ printerId: 'b', reportedMargins: { l: 1 } });
  });

  it('deleting a profile removes its calibrations and unlinks projects', async () => {
    const db = await freshDb();
    const id = await createProfile(db, { name: 'Home inkjet' });
    await saveCalibration(db, cal(id));
    const { projectId } = await createProject(db, { name: 'P', paperKey: 'a4', profileId: id });
    await deleteProfile(db, id);
    expect(await count(db, 'calibrations')).toBe(0);
    expect((await getProject(db, projectId))?.profileId).toBeNull();
  });
});

describe('settings', () => {
  it.each([
    ['US', 'letter', 'in'],
    ['CA', 'letter', 'mm'],
    ['DE', 'a4', 'mm'],
    [null, 'a4', 'mm'],
  ])('defaults by region %s → %s, %s', async (region, paper, unit) => {
    const db = await freshDb();
    expect(await getAppSettings(db, region)).toEqual({
      ...defaultSettings(region),
      defaultPaper: paper,
      units: unit,
      defaultMarginMm: 6.35,
      defaultOverlapMm: 10,
      checkBar: true,
      ppiTarget: 300,
    });
  });

  it('stored values win over region defaults; corrupt values fall back; invalid writes are refused', async () => {
    const db = await freshDb();
    await setAppSetting(db, 'defaultPaper', 'a3');
    await setAppSetting(db, 'units', 'cm');
    await setAppSetting(db, 'checkBar', false);
    await setAppSetting(db, 'lastProfileId', 7);
    await setSetting(db, 'ppi_target', '42');
    const s = await getAppSettings(db, 'US');
    expect(s).toMatchObject({ defaultPaper: 'a3', units: 'cm', checkBar: false, lastProfileId: 7, ppiTarget: 300 });
    await expect(setAppSetting(db, 'ppiTarget', 42 as never)).rejects.toBeInstanceOf(InvalidDataError);
    await expect(setAppSetting(db, 'defaultMarginMm', -1)).rejects.toBeInstanceOf(InvalidDataError);
    await setAppSetting(db, 'lastProfileId', null);
    expect((await getAppSettings(db, 'US')).lastProfileId).toBeNull();
  });

  it('theme preference defaults to system, persists, ignores invalid stored values', async () => {
    const db = await freshDb();
    expect(await getThemePreference(db)).toBe('system');
    await setThemePreference(db, 'dark');
    expect(await getThemePreference(db)).toBe('dark');
    await db.runAsync("UPDATE settings SET value = 'purple' WHERE key = 'theme'");
    expect(await getThemePreference(db)).toBe('system');
  });
});
