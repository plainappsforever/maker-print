import { isPaperKey, type Margins, type PaperKey } from '@/engine/paper';

import { InvalidDataError } from './errors';
import { isMargins, readJson, requireOneOf, writeJson } from './guards';
import { updateRow, type Value } from './rows';
import { withRead, withTransaction } from './tx';
import type { Db } from './types';

export type MarginsSource = 'default' | 'learned' | 'typed';
export type Profile = {
  id: number;
  name: string;
  notes: string;
  /** null until learned or typed (D17) */
  margins: Margins | null;
  marginsSource: MarginsSource;
  lastPrinterName: string | null;
  /** The print system's id of the printer this profile was set up on (first print that reported margins, D85) */
  printerId: string | null;
  /** Margins that printer last reported, also when the user typed their own (finding 8) */
  reportedMargins: Margins | null;
  /** Paper the learned/reported margins were reported for */
  marginsPaperKey: PaperKey | null;
  updatedAt: number;
};

type ProfileRow = {
  id: number;
  name: string;
  notes: string;
  margins: string | null;
  margins_source: MarginsSource;
  last_printer_name: string | null;
  printer_id: string | null;
  reported_margins: string | null;
  margins_paper_key: string | null;
  updated_at: number;
};

const SOURCES: readonly MarginsSource[] = ['default', 'learned', 'typed'];
const isMarginsOrNull = (v: unknown): v is Margins | null => v === null || isMargins(v);

const toProfile = (r: ProfileRow): Profile => {
  const margins = readJson(r.margins, isMarginsOrNull, null);
  return {
    id: r.id,
    name: r.name,
    notes: r.notes,
    margins,
    marginsSource: margins === null ? 'default' : r.margins_source,
    lastPrinterName: r.last_printer_name,
    printerId: r.printer_id ?? null,
    reportedMargins: readJson(r.reported_margins ?? null, isMarginsOrNull, null),
    marginsPaperKey: isPaperKey(r.margins_paper_key) ? r.margins_paper_key : null,
    updatedAt: r.updated_at,
  };
};

function cleanName(name: string) {
  const n = name.trim();
  if (!n) throw new InvalidDataError('Profile name is empty');
  return n.slice(0, 100);
}

export async function createProfile(db: Db, input: { name: string; notes?: string }, now = Date.now()): Promise<number> {
  const name = cleanName(input.name);
  return withTransaction(db, async (tx) => {
    const r = await tx.runAsync(
      'INSERT INTO profiles (name, notes, created_at, updated_at) VALUES (?, ?, ?, ?)',
      name,
      input.notes ?? '',
      now,
      now
    );
    return r.lastInsertRowId;
  });
}

export async function listProfiles(db: Db): Promise<Profile[]> {
  const rows = await withRead(db, (r) => r.getAllAsync<ProfileRow>('SELECT * FROM profiles ORDER BY name COLLATE NOCASE, id'));
  return rows.map(toProfile);
}

export async function getProfile(db: Db, id: number): Promise<Profile | null> {
  const row = await withRead(db, (r) => r.getFirstAsync<ProfileRow>('SELECT * FROM profiles WHERE id = ?', id));
  return row ? toProfile(row) : null;
}

export type ProfilePatch = { name?: string; notes?: string; margins?: Margins | null; marginsSource?: MarginsSource; lastPrinterName?: string | null };

export async function updateProfile(db: Db, id: number, patch: ProfilePatch, now = Date.now()): Promise<void> {
  const sets: Record<string, Value> = {};
  if (patch.name !== undefined) sets.name = cleanName(patch.name);
  if (patch.notes !== undefined) sets.notes = patch.notes.slice(0, 2000);
  if (patch.margins !== undefined) {
    sets.margins = writeJson(patch.margins, isMargins, 'margins');
    sets.margins_source = patch.margins === null ? 'default' : requireOneOf(patch.marginsSource ?? 'typed', SOURCES, 'margins_source');
  } else if (patch.marginsSource !== undefined) {
    sets.margins_source = requireOneOf(patch.marginsSource, SOURCES, 'margins_source');
  }
  if (patch.lastPrinterName !== undefined) sets.last_printer_name = patch.lastPrinterName;
  await withTransaction(db, (tx) => updateRow(tx, 'profiles', id, sets, now));
}

/**
 * Margins reported by the print system after an exact print (D17). A margin the user typed is kept: learned values
 * never overwrite typed ones; they only replace default/learned.
 */
export async function setLearnedMargins(db: Db, id: number, margins: Margins, printerName: string | null, now = Date.now()): Promise<boolean> {
  return (await recordPrinter(db, id, { margins, printerName }, now)).marginsStored;
}

export type PrinterRecord = {
  /** true: the profile's margins were set from this print */
  marginsStored: boolean;
  /** The print went to another printer than the one this profile was set up on: nothing of the profile changed (D85) */
  otherPrinter: boolean;
  /** Name of the profile's own printer (for the warning) */
  profilePrinterName: string | null;
};

/**
 * After an exact print (D17, D85): the profile adopts the printer's id the first time; prints on that printer update
 * the reported margins (always) and the learned margins (unless typed); a print on ANOTHER printer changes nothing and
 * is reported, so printer B never overwrites what was learned for printer A (REVIEW_V1 finding 3c).
 */
export async function recordPrinter(
  db: Db,
  id: number,
  r: { margins: Margins | null; printerName: string | null; printerId?: string | null; paperKey?: PaperKey | null },
  now = Date.now()
): Promise<PrinterRecord> {
  const json = r.margins ? writeJson(r.margins, isMargins, 'margins') : null;
  return withTransaction(db, async (tx) => {
    const row = await tx.getFirstAsync<ProfileRow>('SELECT * FROM profiles WHERE id = ?', id);
    if (!row) return { marginsStored: false, otherPrinter: false, profilePrinterName: null };
    const pid = r.printerId ?? null;
    if (pid && row.printer_id && row.printer_id !== pid) return { marginsStored: false, otherPrinter: true, profilePrinterName: row.last_printer_name };
    let stored = false;
    if (json) {
      const u = await tx.runAsync(
        `UPDATE profiles SET margins = ?, margins_source = 'learned', updated_at = ? WHERE id = ? AND margins_source <> 'typed'`,
        json,
        now,
        id
      );
      stored = u.changes > 0;
      await tx.runAsync('UPDATE profiles SET reported_margins = ?, margins_paper_key = COALESCE(?, margins_paper_key) WHERE id = ?', json, r.paperKey ?? null, id);
    }
    await tx.runAsync(
      'UPDATE profiles SET last_printer_name = COALESCE(?, last_printer_name), printer_id = COALESCE(printer_id, ?), updated_at = ? WHERE id = ?',
      r.printerName,
      pid,
      now,
      id
    );
    return { marginsStored: stored, otherPrinter: false, profilePrinterName: r.printerName ?? row.last_printer_name };
  });
}

/** Forget which printer the profile belongs to (the next print sets it again), e.g. after replacing the printer. */
export async function forgetProfilePrinter(db: Db, id: number, now = Date.now()): Promise<void> {
  await withTransaction(db, (tx) => tx.runAsync('UPDATE profiles SET printer_id = NULL, updated_at = ? WHERE id = ?', now, id));
}

/** Deletes the profile and its calibrations (cascade); projects using it fall back to "no profile". */
export async function deleteProfile(db: Db, id: number): Promise<void> {
  await withTransaction(db, (tx) => tx.runAsync('DELETE FROM profiles WHERE id = ?', id));
}
