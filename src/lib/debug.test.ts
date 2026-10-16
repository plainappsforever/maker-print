/**
 * @jest-environment node
 */
// The P6 measurement seeds must print exactly what the referee measured (fixtures 08-ruler-w4 and 12-placed-a6), so a
// job printed from the app's Print screen can be measured against the fixture's expectations.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createTestDb } from '../../test/node-sqlite-db';
import { listCalibrations } from '@/db/calibrations';
import { openDatabase } from '@/db/migrations';
import { listObjects } from '@/db/objects';
import { getProfile } from '@/db/profiles';
import { listProjects, getProject } from '@/db/projects';
import { defaultSettings } from '@/db/settings';
import { listSheets } from '@/db/sheets';
import { marginsForCorrection, planProject } from '@/editor/output';
import { correctionsOf } from '@/editor/print-job';

import { loadSeed } from './debug';
import { fixtureProjectPdf, REFEREE_CTX, type FixtureProject } from './selftest/project-pdf';

jest.mock('expo-constants', () => ({ expoConfig: { extra: { appVariant: 'development' } } }));

async function seeded(name: 'w4' | 'w4cal' | 'a6') {
  const db = createTestDb();
  await openDatabase(db);
  await loadSeed(db, name);
  const [summary] = await listProjects(db);
  const project = (await getProject(db, summary.id))!;
  const sheets = await listSheets(db, project.id);
  const objects = (await Promise.all(sheets.map((s) => listObjects(db, s.id)))).flat();
  const profile = await getProfile(db, project.profileId!);
  return { db, doc: { project, sheets, objects, assets: [] }, profile };
}
const fixture = (name: string) => JSON.parse(readFileSync(join(__dirname, '../../test/fixtures/projects', `${name}.json`), 'utf8')) as FixtureProject;
const strip = (plan: { pages: unknown[] }) => JSON.stringify(plan.pages);

describe('P6 measurement seeds = referee fixtures', () => {
  it.each([
    ['w4', '08-ruler-w4'],
    ['a6', '12-placed-a6'],
  ] as const)('%s plans the same pages as %s', async (seed, name) => {
    const { doc, profile } = await seeded(seed);
    const app = planProject(doc, defaultSettings('DE'), profile, REFEREE_CTX);
    const ref = await fixtureProjectPdf(fixture(name), () => new Uint8Array());
    expect(app.pages.length).toBe(ref.plan.pages.length);
    expect(strip(app)).toBe(strip(ref.plan));
  });

  it('w4cal: U3 single correction and the Android multi-page correction on A4', async () => {
    const { db, doc, profile } = await seeded('w4cal');
    const cal = await listCalibrations(db, profile!.id);
    expect(cal.map((c) => [c.jobKind, c.fx.toFixed(4), c.fy.toFixed(4)])).toEqual([
      ['multi', '1.0646', '1.0644'],
      ['single', '1.0067', '1.0025'],
    ]);
    const multi = planProject(doc, defaultSettings('DE'), profile, REFEREE_CTX, { corrections: correctionsOf(cal) });
    expect(multi.correction).toMatchObject({ jobKind: 'multi' });
    // D77: ×1.0646 / ×1.0644 pushes the outer 2.3 mm of each tile off the paper unless the margins widen to C(1 − 1/c)
    expect(multi.warnings.map((w) => w.code)).toContain('correctionOffPage');
    const min = marginsForCorrection('a4', { fx: cal[0].fx, fy: cal[0].fy })!;
    expect(min.l).toBeCloseTo(105 * (1 - 1 / cal[0].fx), 1);
    expect(min.t).toBeCloseTo(148.5 * (1 - 1 / cal[0].fy), 1);
    const widened = planProject(doc, defaultSettings('DE'), profile, REFEREE_CTX, { corrections: correctionsOf(cal), minMargins: min });
    expect(widened.warnings.map((w) => w.code)).not.toContain('correctionOffPage');
    expect(widened.pages[1].safe.y).toBeCloseTo(Math.max(6.35, min.l), 6); // landscape frame: its top is the paper's left
    expect(marginsForCorrection('a4', { fx: 0.99, fy: 1 })).toBeNull();
    expect(marginsForCorrection('a4', null)).toBeNull();
    const oneByOne = planProject(doc, defaultSettings('DE'), profile, REFEREE_CTX, { corrections: correctionsOf(cal), oneByOne: true });
    expect(oneByOne.correction).toMatchObject({ jobKind: 'single' });
  });
});
