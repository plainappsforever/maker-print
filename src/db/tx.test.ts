/**
 * @jest-environment node
 */
import { createTestDb } from '../../test/node-sqlite-db';

import { LATEST_VERSION, migrate, openDatabase } from './migrations';
import { setSetting, getSetting } from './settings';
import { withRead, withTransaction, withWrite } from './tx';

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

async function freshDb() {
  const db = createTestDb();
  await openDatabase(db);
  return db;
}

// The template's tests used its demo `items` table (dropped in migration 2); these use `settings` rows instead.
type TestDb = Awaited<ReturnType<typeof freshDb>>;
const addItem = (db: TestDb, input: { title: string; note: string }, _now: number) => setSetting(db, `t:${input.title}`, input.note);
async function titles(db: TestDb) {
  const rows = await db.getAllAsync<{ key: string }>("SELECT key FROM settings WHERE key LIKE 't:%'");
  return rows.map((r) => r.key.slice(2)).sort();
}

describe('write queue', () => {
  it('(a) keeps a write issued during a failing transaction', async () => {
    const db = await freshDb();
    const failing = withTransaction(db, async (tx) => {
      await tx.runAsync("INSERT INTO settings (key, value) VALUES ('t:inside', '')");
      await tick();
      throw new Error('boom');
    });
    const outside = tick().then(() => addItem(db, { title: 'outside', note: '' }, 2));
    const setting = setSetting(db, 'k', 'v'); // issued while the transaction is open
    await expect(failing).rejects.toThrow('boom');
    await outside;
    await setting;

    expect(await titles(db)).toEqual(['outside']);
    expect(await getSetting(db, 'k')).toBe('v');
  });

  it('(b) a second transaction started during one waits instead of throwing', async () => {
    const db = await freshDb();
    const order: string[] = [];
    const first = withTransaction(db, async (tx) => {
      await tx.runAsync("INSERT INTO settings (key, value) VALUES ('t:one', '')");
      await tick();
      order.push('first done');
    });
    const second = withTransaction(db, async (tx) => {
      order.push('second start');
      await tx.runAsync("INSERT INTO settings (key, value) VALUES ('t:two', '')");
    });
    await Promise.all([first, second]);

    expect(order).toEqual(['first done', 'second start']);
    expect(await titles(db)).toEqual(['one', 'two']);
  });

  it('(c) a failing migration leaves no open transaction and user_version unchanged', async () => {
    const db = createTestDb();
    await migrate(db, ['CREATE TABLE a (id INTEGER);']);
    await expect(
      migrate(db, ['CREATE TABLE a (id INTEGER);', 'CREATE TABLE b (id INTEGER); INSERT INTO nope VALUES (1);'])
    ).rejects.toThrow();

    const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    expect(row?.user_version).toBe(1);
    expect(await db.getFirstAsync("SELECT name FROM sqlite_master WHERE name = 'b'")).toBeNull();
    await db.execAsync('BEGIN; COMMIT;'); // throws if a transaction were still open
  });

  it('nested transactions join the outer one; an inner failure undoes only the inner part', async () => {
    const db = await freshDb();
    await withTransaction(db, async (tx) => {
      await addItem(tx, { title: 'outer', note: '' }, 1); // withWrite on the handle joins
      await expect(
        withTransaction(tx, async (inner) => {
          await addItem(inner, { title: 'inner', note: '' }, 2);
          throw new Error('inner');
        })
      ).rejects.toThrow('inner');
      await withTransaction(tx, (inner) => addItem(inner, { title: 'kept', note: '' }, 3));
    });
    expect(await titles(db)).toEqual(['kept', 'outer']);

    await expect(
      withTransaction(db, async (tx) => {
        await addItem(tx, { title: 'lost', note: '' }, 4);
        await withWrite(tx, () => Promise.resolve());
        throw new Error('outer');
      })
    ).rejects.toThrow('outer');
    expect(await titles(db)).toEqual(['kept', 'outer']);
  });

  it('rejects a handle used after its unit ended', async () => {
    const db = await freshDb();
    let leaked!: Parameters<Parameters<typeof withWrite>[1]>[0];
    await withWrite(db, async (tx) => {
      leaked = tx;
    });
    expect(() => leaked.runAsync('SELECT 1')).toThrow('after its write unit ended');
  });
  it('reads never observe the uncommitted rows of a unit that rolls back (template 40eb231)', async () => {
    const db = await freshDb();
    const seen: (string | null)[] = [];
    const failing = withTransaction(db, async (tx) => {
      await tx.runAsync("INSERT INTO settings (key, value) VALUES ('t:ghost', 'x')");
      await tick();
      expect(await titles(tx)).toEqual(['ghost']); // inside the unit its own rows are visible
      throw new Error('boom');
    });
    // Reads issued while the unit is open (data helpers and withRead) wait for it to end.
    const reads = [
      tick().then(() => getSetting(db, 't:ghost').then((v) => seen.push(v))),
      withRead(db, async (r) => seen.push((await r.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = 't:ghost'"))?.value ?? null)),
    ];
    await expect(failing).rejects.toThrow('boom');
    await Promise.all(reads);
    expect(seen).toEqual([null, null]);
    expect(await titles(db)).toEqual([]);
  });
  // expo-sqlite hands every openDatabaseAsync('app.db') the SAME native connection but a new JS object; a queue per JS
  // object let a background handle BEGIN inside the UI handle's transaction ("cannot start a transaction within a
  // transaction"). Template bdfad53.
  function twoHandles() {
    const ui = Object.assign(createTestDb(), { databasePath: '/data/files/SQLite/app.db' });
    const background = { ...ui }; // another JS object on the same connection, as openDatabaseAsync returns
    return { ui, background };
  }

  it('two JS handles on one database file share one write queue', async () => {
    const { ui, background } = twoHandles();
    await openDatabase(ui);
    const failing = withTransaction(ui, async (tx) => {
      await tx.runAsync("INSERT INTO settings (key, value) VALUES ('t:phantom', 'x')");
      await tick();
      throw new Error('boom');
    });
    const other = tick().then(() => addItem(background, { title: 'real', note: '' }, 2)); // during the unit
    await expect(failing).rejects.toThrow('boom');
    await other;
    expect(await titles(ui)).toEqual(['real']);
    expect(await withRead(background, (r) => titles(r))).toEqual(['real']);
  });

  it('two JS handles migrate at the same cold start without a nested BEGIN, each migration once', async () => {
    const { ui, background } = twoHandles();
    await Promise.all([migrate(background), migrate(ui)]);
    const row = await ui.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    expect(row?.user_version).toBe(LATEST_VERSION);
    await ui.execAsync('BEGIN; COMMIT;'); // no transaction left open
  });
});
