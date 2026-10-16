// Dev-only debug helpers (V1_PLAN rule 15): named seeds for Maestro's absolute preconditions
// (`makerprint-dev://debug/seed?set=<name>`). Never reachable in preview/production (`isDevBuild`).
import Constants from 'expo-constants';

import { saveCalibration } from '@/db/calibrations';
import { addObject } from '@/db/objects';
import { createProject, updateProject } from '@/db/projects';
import { withTransaction } from '@/db/tx';
import type { Db } from '@/db/types';

export const isDevBuild = () => Constants.expoConfig?.extra?.appVariant === 'development';
// The preview (tester) build also opens the debug screen by deep link (`makerprint-preview://debug?run=selftest|caps`) so
// the engine self-test and the limits can be timed on the Release Hermes bytecode (P7, D82). Seeds stay dev-only (they wipe
// data), the screen has no link in Settings, and the production variant has neither.
export const isDebugScreenBuild = () => ['development', 'preview'].includes(String(Constants.expoConfig?.extra?.appVariant));

export const SEEDS = ['empty', 'profile', 'de', 'learned', 'w4', 'w4cal', 'a6'] as const;
export type SeedName = (typeof SEEDS)[number];
export const isSeedName = (v: unknown): v is SeedName => typeof v === 'string' && (SEEDS as readonly string[]).includes(v);

/**
 * Wipes all user data and loads a named seed in one transaction. `empty`: nothing. `profile`: one printer profile
 * "Test printer" (default margins) chosen as the last-used profile. `de`: nothing, German UI (after a restart; A11). `learned`: profile "Office laser" with learned margins 3/4/5/12 mm.
 * P6 (print screen and virtual-printer measurements): `w4` = profile "Test printer" + the referee fixture 08-ruler-w4 as a
 * project "W4 ruler" (1000 × 30 mm red ruler, A4, margin 6.35 mm, overlap 10, no check bar — the same geometry the
 * referee measured); `w4cal` = the same plus A4 corrections of "Test printer" (single 149.0 / 199.5 = U3, multi
 * 140.9 / 187.9 ≈ the ×0.9394 Android fit of P4); `a6` = profile + fixture 12-placed-a6 (A6 sheet with a 20 mm red square
 * placed on A4 with crop marks and the 100 mm check bar).
 */
export async function loadSeed(db: Db, name: SeedName): Promise<void> {
  await withTransaction(db, async (tx) => {
    for (const table of ['calibrations', 'objects', 'assets', 'sheets', 'projects', 'profiles', 'settings']) await tx.runAsync(`DELETE FROM ${table}`);
    // flows must not depend on the device region (D22: a US emulator defaults to Letter and inches): every seed starts in
    // mm on A4; flows that need other defaults set them through the UI (settings-de)
    await tx.runAsync("INSERT INTO settings (key, value) VALUES ('units', 'mm'), ('default_paper', 'a4')");
    if (name === 'de') await tx.runAsync('INSERT INTO settings (key, value) VALUES (?, ?)', 'language', 'de');
    if (name === 'learned') {
      // a printer whose margins were learned (3 / 4 / 5 / 12 mm): the editor hatches them on 1:1 sheets
      const now = Date.now();
      const r = await tx.runAsync(
        "INSERT INTO profiles (name, notes, margins, margins_source, last_printer_name, created_at, updated_at) VALUES (?, '', ?, 'learned', ?, ?, ?)",
        'Office laser',
        JSON.stringify({ l: 3, t: 4, r: 5, b: 12 }),
        'Test printer',
        now,
        now
      );
      await tx.runAsync('INSERT INTO settings (key, value) VALUES (?, ?)', 'last_profile_id', String(r.lastInsertRowId));
    }
    if (name === 'w4' || name === 'w4cal' || name === 'a6') {
      const now = Date.now();
      const r = await tx.runAsync('INSERT INTO profiles (name, notes, created_at, updated_at) VALUES (?, ?, ?, ?)', 'Test printer', '', now, now);
      const profileId = r.lastInsertRowId;
      await tx.runAsync('INSERT INTO settings (key, value) VALUES (?, ?)', 'last_profile_id', String(profileId));
      const w4 = name !== 'a6';
      const { projectId, sheetId } = await createProject(tx, {
        name: w4 ? 'W4 ruler' : 'A6 card',
        paperKey: 'a4',
        sheet: w4 ? { widthMm: 1000, heightMm: 30 } : { widthMm: 105, heightMm: 148, paperKey: 'a6' },
        overlapMm: 10,
        profileId,
      });
      await updateProject(tx, projectId, { marginMm: 6.35, checkBar: !w4 });
      if (w4) await addObject(tx, sheetId, { kind: 'ruler', x: 0, y: 0, w: 1000, h: 30, props: { colour: '#ff0000', unit: 'mm' } });
      else await addObject(tx, sheetId, { kind: 'rect', x: 10, y: 10, w: 20, h: 20, props: { fill: '#ff0000', stroke: null } });
      if (name === 'w4cal') {
        await saveCalibration(tx, { profileId, paperKey: 'a4', jobKind: 'single', nominalX: 150, measuredX: 149, nominalY: 200, measuredY: 199.5, route: 'exact' });
        await saveCalibration(tx, { profileId, paperKey: 'a4', jobKind: 'multi', nominalX: 150, measuredX: 140.9, nominalY: 200, measuredY: 187.9, route: 'exact' });
      }
    }
    if (name === 'profile') {
      const now = Date.now();
      const r = await tx.runAsync('INSERT INTO profiles (name, notes, created_at, updated_at) VALUES (?, ?, ?, ?)', 'Test printer', '', now, now);
      await tx.runAsync('INSERT INTO settings (key, value) VALUES (?, ?)', 'last_profile_id', String(r.lastInsertRowId));
    }
  });
}
