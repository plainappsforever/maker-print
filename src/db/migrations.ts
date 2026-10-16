import { withTransaction } from './tx';
import type { Db } from './types';

// Append-only. Never edit a migration that has shipped; add a new one instead.
export const MIGRATIONS: string[] = [
  // 1 — template: demo items + key/value settings
  `CREATE TABLE items (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     title TEXT NOT NULL,
     note TEXT NOT NULL DEFAULT '',
     created_at INTEGER NOT NULL
   );
   CREATE TABLE settings (
     key TEXT PRIMARY KEY NOT NULL,
     value TEXT NOT NULL
   );`,
  // 2 — Maker Print v1 (SPEC §7). Lengths REAL mm, angles REAL degrees, timestamps INTEGER ms, booleans 0/1.
  `DROP TABLE items;
   CREATE TABLE profiles (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL,
     notes TEXT NOT NULL DEFAULT '',
     margins TEXT,
     margins_source TEXT NOT NULL DEFAULT 'default' CHECK (margins_source IN ('default','learned','typed')),
     last_printer_name TEXT,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE TABLE projects (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL,
     paper_key TEXT NOT NULL,
     orientation TEXT NOT NULL DEFAULT 'auto' CHECK (orientation IN ('auto','portrait','landscape')),
     margin_mm REAL CHECK (margin_mm IS NULL OR margin_mm >= 0),
     overlap_mm REAL NOT NULL DEFAULT 10 CHECK (overlap_mm >= 0),
     marks TEXT NOT NULL DEFAULT 'registration' CHECK (marks IN ('registration','none')),
     page_labels INTEGER NOT NULL DEFAULT 1 CHECK (page_labels IN (0,1)),
     assembly_map TEXT NOT NULL DEFAULT 'auto' CHECK (assembly_map IN ('auto','on','off')),
     skip_blank INTEGER NOT NULL DEFAULT 1 CHECK (skip_blank IN (0,1)),
     excluded_tiles TEXT NOT NULL DEFAULT '[]',
     check_bar INTEGER CHECK (check_bar IS NULL OR check_bar IN (0,1)),
     profile_id INTEGER REFERENCES profiles(id) ON DELETE SET NULL,
     thumbnail_path TEXT,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE INDEX projects_updated ON projects(updated_at DESC);
   CREATE TABLE sheets (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     position INTEGER NOT NULL,
     width_mm REAL NOT NULL CHECK (width_mm > 0),
     height_mm REAL NOT NULL CHECK (height_mm > 0),
     paper_key TEXT,
     name TEXT NOT NULL DEFAULT '',
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE INDEX sheets_project ON sheets(project_id, position);
   CREATE TABLE assets (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     kind TEXT NOT NULL CHECK (kind IN ('image','pdf','svg')),
     file TEXT NOT NULL,
     original_name TEXT NOT NULL DEFAULT '',
     bytes INTEGER NOT NULL DEFAULT 0,
     px_w INTEGER,
     px_h INTEGER,
     page_count INTEGER,
     svg_px_per_in REAL,
     report TEXT,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE INDEX assets_project ON assets(project_id);
   CREATE TABLE objects (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     sheet_id INTEGER NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
     z INTEGER NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('image','pdf_page','svg','text','rect','ellipse','line','ruler','grid','dots',
       'lines','circles','test_square')),
     asset_id INTEGER REFERENCES assets(id) ON DELETE CASCADE,
     page_index INTEGER NOT NULL DEFAULT 0,
     x_mm REAL NOT NULL,
     y_mm REAL NOT NULL,
     w_mm REAL NOT NULL CHECK (w_mm > 0),
     h_mm REAL NOT NULL CHECK (h_mm > 0),
     rotation_deg REAL NOT NULL DEFAULT 0,
     mirror_x INTEGER NOT NULL DEFAULT 0 CHECK (mirror_x IN (0,1)),
     mirror_y INTEGER NOT NULL DEFAULT 0 CHECK (mirror_y IN (0,1)),
     lock_aspect INTEGER NOT NULL DEFAULT 1 CHECK (lock_aspect IN (0,1)),
     crop TEXT,
     fit TEXT NOT NULL DEFAULT 'fill' CHECK (fit IN ('fill','fit')),
     repeat TEXT,
     props TEXT NOT NULL DEFAULT '{}',
     name TEXT NOT NULL DEFAULT '',
     locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0,1)),
     hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0,1)),
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE INDEX objects_sheet_z ON objects(sheet_id, z);
   CREATE INDEX objects_asset ON objects(asset_id);
   CREATE TABLE calibrations (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
     paper_key TEXT NOT NULL,
     job_kind TEXT NOT NULL CHECK (job_kind IN ('single','multi')),
     nominal_x_mm REAL NOT NULL CHECK (nominal_x_mm > 0),
     measured_x_mm REAL NOT NULL CHECK (measured_x_mm > 0),
     nominal_y_mm REAL NOT NULL CHECK (nominal_y_mm > 0),
     measured_y_mm REAL NOT NULL CHECK (measured_y_mm > 0),
     fx REAL NOT NULL,
     fy REAL NOT NULL,
     route TEXT NOT NULL CHECK (route IN ('exact','fallback','export')),
     measured_at INTEGER NOT NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     UNIQUE (profile_id, paper_key, job_kind)
   );`,
  // 3 — v1.1 (REVIEW_V1 finding 3, D85): the print system's printer id and name a calibration was measured on; the
  // profile's printer id, the margins that printer last reported (also when the user typed their own) and the paper
  // they were reported for
  `ALTER TABLE calibrations ADD COLUMN printer_id TEXT;
   ALTER TABLE calibrations ADD COLUMN printer_name TEXT;
   ALTER TABLE profiles ADD COLUMN printer_id TEXT;
   ALTER TABLE profiles ADD COLUMN reported_margins TEXT;
   ALTER TABLE profiles ADD COLUMN margins_paper_key TEXT;`,
];

export const LATEST_VERSION = MIGRATIONS.length;

export async function migrate(db: Db, migrations: string[] = MIGRATIONS): Promise<void> {
  // The version is read INSIDE each unit: another JS handle on the same connection (e.g. a background task at a cold
  // start) may have migrated meanwhile, and a migration must never run twice. One transaction per migration: a
  // failure rolls back both the schema change and user_version.
  for (;;) {
    const applied = await withTransaction(db, async (tx) => {
      const row = await tx.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
      const version = row?.user_version ?? 0;
      if (version >= migrations.length) return false;
      await tx.execAsync(`${migrations[version]} PRAGMA user_version = ${version + 1};`);
      return true;
    });
    if (!applied) return;
  }
}

/**
 * Opens the app database: foreign keys ON (a connection setting, not a write — it must run outside a transaction,
 * where SQLite ignores it), then migrations. Use this instead of `migrate` everywhere (app and tests).
 */
export async function openDatabase(db: Db): Promise<void> {
  await db.execAsync('PRAGMA foreign_keys = ON;');
  await migrate(db);
}
