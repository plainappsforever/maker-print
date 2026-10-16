/**
 * @jest-environment node
 */
// Android outcome (v1.1, REVIEW_V1 finding 4): the paper of the job's print attributes differs from the page (Letter
// picked for an A4 page) or is landscape → the Default Print Service fits the page: never silent.
import { createTestDb } from '../../test/node-sqlite-db';
import { openDatabase } from '@/db/migrations';
import { createProfile } from '@/db/profiles';
import { uniformMargins } from '@/engine/paper';
import { planCalibration } from '@/engine/plan';
import { printTranslator } from '@/i18n';

const mockNative: { printPdf: jest.Mock } = { printPdf: jest.fn() };
jest.mock('../../modules/maker-print-native', () => ({
  __esModule: true,
  get default() {
    return mockNative;
  },
}));
jest.mock('expo-print', () => ({ printAsync: jest.fn() }));
jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
jest.mock('./files', () => ({ writeOutputPdf: (name: string) => `file:///cache/print/${name}` }));

// eslint-disable-next-line import/first
import { printPdfFile, writePlanPdf } from './print';
// eslint-disable-next-line import/first
import { describeOutcome } from './print-outcome';

const ctx = { locale: 'en' as const, unit: 'mm' as const, inchStyle: 'fraction16' as const, t: printTranslator('en') };
const mils = (w: number, h: number) => ({ paperWidthPt: (w * 72) / 1000, paperHeightPt: (h * 72) / 1000 });

async function job(result: Record<string, unknown>) {
  const db = createTestDb();
  await openDatabase(db);
  const profileId = await createProfile(db, { name: 'Office' });
  const plan = planCalibration({ paperKey: 'a4', margins: uniformMargins(6.35), pages: 1, ctx });
  const file = await writePlanPdf(plan, { fileName: 'c.pdf', title: 't', checkBarCaption: 'c' });
  mockNative.printPdf.mockResolvedValueOnce({ completed: true, printerId: 'urn:uuid:x', minMarginsMils: { l: 250, t: 250, r: 250, b: 250 }, ...result });
  return printPdfFile(file, { jobName: 'j', plan, db, profileId });
}

describe('Android print outcome', () => {
  it('A4 page on A4 media (whole mils): exact predicted, no paper line', async () => {
    const r = await job({ ...mils(8270, 11690), paperPortrait: true });
    expect(r).toMatchObject({ route: 'exact', expectExact: true, advice: null });
  });
  it('Letter picked for an A4 page → paperDiffers, not exact, orange Android line', async () => {
    const r = await job({ ...mils(8500, 11000), paperPortrait: true });
    expect(r).toMatchObject({ expectExact: false, advice: 'paperDiffers' });
    const lines = describeOutcome(r, { paperKey: 'a4', os: 'android', pages: 1, measure: 'm' });
    expect(lines.some((l) => l.level === 'warn' && /NOT at exact size/.test(l.text) && /215\.9 × 279\.4/.test(l.text))).toBe(true);
  });
  it('A4 landscape media → paperDiffers', async () => {
    const r = await job({ ...mils(11690, 8270), paperPortrait: false });
    expect(r).toMatchObject({ expectExact: false, advice: 'paperDiffers' });
  });
});
