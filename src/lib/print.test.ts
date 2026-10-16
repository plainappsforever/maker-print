/**
 * @jest-environment node
 */
// The print route choice (D11 fallback, L4): exact when the native module works, expo-print otherwise, and learned
// margins stored on the profile (D17) — typed margins never overwritten.
import { createTestDb } from '../../test/node-sqlite-db';
import { openDatabase } from '@/db/migrations';
import { createProfile, getProfile, updateProfile } from '@/db/profiles';
import { uniformMargins } from '@/engine/paper';
import { planCalibration } from '@/engine/plan';
import { pageSizePt } from '@/engine/route';
import { printTranslator } from '@/i18n';

const mockNative: { printPdf: jest.Mock } = { printPdf: jest.fn() };
let mockHasNative = true;
jest.mock('../../modules/maker-print-native', () => ({
  __esModule: true,
  get default() {
    return mockHasNative ? mockNative : null;
  },
}));
const mockPrintAsync = jest.fn(async () => undefined);
jest.mock('expo-print', () => ({ printAsync: (...a: unknown[]) => mockPrintAsync(...(a as [])) }));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('./files', () => ({ writeOutputPdf: (name: string) => `file:///cache/print/${name}` }));

// eslint-disable-next-line import/first
import { printPdfFile, writePlanPdf } from './print';

const ctx = { locale: 'en' as const, unit: 'mm' as const, inchStyle: 'fraction16' as const, t: printTranslator('en') };
const { w: A4w, h: A4h } = pageSizePt({ widthMm: 210, heightMm: 297 });
const A4 = { w: A4w, h: A4h };

async function setup() {
  const db = createTestDb();
  await openDatabase(db);
  const profileId = await createProfile(db, { name: 'Office' });
  const plan = planCalibration({ paperKey: 'a4', margins: uniformMargins(6.35), pages: 1, ctx });
  const file = await writePlanPdf(plan, { fileName: 'calibration-a4.pdf', title: 't', checkBarCaption: 'c' });
  return { db, profileId, plan, file };
}

beforeEach(() => {
  mockHasNative = true;
  mockNative.printPdf.mockReset();
  mockPrintAsync.mockClear();
});

describe('printPdfFile', () => {
  it('writes the plan with the portrait page size and prints it through the exact route; margins are learned', async () => {
    const { db, profileId, plan, file } = await setup();
    expect(file).toMatchObject({ uri: 'file:///cache/print/calibration-a4.pdf', pageWidthPt: A4.w, pageHeightPt: A4.h, pages: 1 });
    mockNative.printPdf.mockResolvedValue({ completed: true, printerName: 'MakerPrint Test', paperWidthPt: A4.w, paperHeightPt: A4.h, paperMatches: true, printableRectPt: { x: 18, y: 18, w: A4.w - 36, h: A4.h - 36 } });
    const r = await printPdfFile(file, { jobName: 'job', plan, db, profileId });
    expect(mockNative.printPdf).toHaveBeenCalledWith(file.uri, { jobName: 'job', pageWidthPt: A4.w, pageHeightPt: A4.h, outputType: 'general' });
    expect(r).toMatchObject({ route: 'exact', completed: true, expectExact: true, marginsStored: true, learnedMarginsMm: { l: 6.35, t: 6.35, r: 6.35, b: 6.35 } });
    expect(await getProfile(db, profileId)).toMatchObject({ marginsSource: 'learned', lastPrinterName: 'MakerPrint Test', margins: { l: 6.35, t: 6.35, r: 6.35, b: 6.35 } });
    expect(mockPrintAsync).not.toHaveBeenCalled();
  });

  it('typed margins stay; a cancelled dialog learns nothing', async () => {
    const { db, profileId, plan, file } = await setup();
    await updateProfile(db, profileId, { margins: uniformMargins(5), marginsSource: 'typed' });
    mockNative.printPdf.mockResolvedValue({ completed: true, paperWidthPt: A4.w, paperHeightPt: A4.h, printableRectPt: { x: 18, y: 18, w: A4.w - 36, h: A4.h - 36 } });
    expect((await printPdfFile(file, { jobName: 'j', plan, db, profileId })).marginsStored).toBe(false);
    mockNative.printPdf.mockResolvedValue({ completed: false });
    expect(await printPdfFile(file, { jobName: 'j', plan, db, profileId })).toMatchObject({ completed: false, learnedMarginsMm: null });
    expect((await getProfile(db, profileId))!.margins).toEqual(uniformMargins(5));
  });

  it('Android: ISO A4 in whole mils counts as the A4 page; the PDF printer teaches no margins', async () => {
    const { db, profileId, plan, file } = await setup();
    const rn = jest.requireMock('react-native') as { Platform: { OS: string } };
    rn.Platform.OS = 'android';
    try {
      mockNative.printPdf.mockResolvedValue({ completed: true, printerId: 'urn:uuid:x', paperWidthPt: 595.44, paperHeightPt: 841.68, paperPortrait: true, minMarginsMils: { l: 250, t: 250, r: 250, b: 250 } });
      expect(await printPdfFile(file, { jobName: 'j', plan, db, profileId })).toMatchObject({ expectExact: true, printerName: null, marginsStored: true });
      mockNative.printPdf.mockResolvedValue({ completed: true, printerId: 'PDF printer', paperWidthPt: 595.44, paperHeightPt: 841.68, paperPortrait: true, minMarginsMils: { l: 0, t: 0, r: 0, b: 0 } });
      expect(await printPdfFile(file, { jobName: 'j', plan, db, profileId })).toMatchObject({ learnedMarginsMm: null, marginsStored: false, printerName: null });
      expect((await getProfile(db, profileId))!.margins).toEqual(uniformMargins(6.35));
    } finally {
      rn.Platform.OS = 'ios';
    }
  });

  it('a different paper is reported (page centred, not exact)', async () => {
    const { plan, file } = await setup();
    mockNative.printPdf.mockResolvedValue({ completed: true, paperWidthPt: 612, paperHeightPt: 792, paperMatches: false });
    expect(await printPdfFile(file, { jobName: 'j', plan })).toMatchObject({ route: 'exact', expectExact: false, advice: 'paperDiffers' });
  });

  it('falls back to expo-print when the module is missing or fails, and says why', async () => {
    const { file } = await setup();
    mockHasNative = false;
    expect(await printPdfFile(file, { jobName: 'j' })).toMatchObject({ route: 'fallback', fallbackReason: 'module missing' });
    mockHasNative = true;
    mockNative.printPdf.mockRejectedValue(new Error('renderer exploded'));
    expect(await printPdfFile(file, { jobName: 'j' })).toMatchObject({ route: 'fallback', fallbackReason: 'renderer exploded' });
    expect(await printPdfFile(file, { jobName: 'j', forceFallback: true })).toMatchObject({ route: 'fallback', fallbackReason: 'forced' });
    expect(mockPrintAsync).toHaveBeenCalledTimes(3);
    expect(mockPrintAsync).toHaveBeenCalledWith({ uri: file.uri });
  });

  it('a second dialog while one is open is an error, not a fallback', async () => {
    const { file } = await setup();
    mockNative.printPdf.mockRejectedValue(Object.assign(new Error('busy'), { code: 'E_BUSY' }));
    await expect(printPdfFile(file, { jobName: 'j' })).rejects.toThrow('busy');
    expect(mockPrintAsync).not.toHaveBeenCalled();
  });
});

describe('printer ids (v1.1, REVIEW_V1 finding 3, D85)', () => {
  const ok = (printerId: string, name = 'Printer') => ({ completed: true, printerId, printerName: name, paperWidthPt: A4.w, paperHeightPt: A4.h, paperMatches: true, printableRectPt: { x: 18, y: 18, w: A4.w - 36, h: A4.h - 36 } });

  it('the first print sets the profile\'s printer; another printer leaves its margins alone and is said', async () => {
    const { db, profileId, plan, file } = await setup();
    mockNative.printPdf.mockResolvedValueOnce(ok('ipp://A._ipp._tcp.local.', 'Printer A'));
    const a = await printPdfFile(file, { jobName: 'job', plan, db, profileId, paperKey: 'a4' });
    expect(a).toMatchObject({ printerId: 'ipp://A._ipp._tcp.local.', marginsStored: true, otherPrinter: false });
    expect(await getProfile(db, profileId)).toMatchObject({ printerId: 'ipp://A._ipp._tcp.local.', marginsPaperKey: 'a4', reportedMargins: { l: 6.35 } });
    mockNative.printPdf.mockResolvedValueOnce({ ...ok('ipp://B._ipp._tcp.local.', 'Printer B'), printableRectPt: { x: 10, y: 10, w: A4.w - 20, h: A4.h - 20 } });
    const b = await printPdfFile(file, { jobName: 'job', plan, db, profileId, paperKey: 'a4' });
    expect(b).toMatchObject({ otherPrinter: true, marginsStored: false, profilePrinterName: 'Printer A' });
    expect(await getProfile(db, profileId)).toMatchObject({ printerId: 'ipp://A._ipp._tcp.local.', lastPrinterName: 'Printer A', margins: { l: 6.35 } });
  });

  it('a correction measured on another printer is reported; the same printer or an unknown one is not', async () => {
    const { db, profileId, plan, file } = await setup();
    mockNative.printPdf.mockResolvedValue(ok('urn:uuid:b', 'B'));
    const other = await printPdfFile(file, { jobName: 'job', plan, db, profileId, correctionFrom: { printerId: 'urn:uuid:a', printerName: 'Brother' } });
    expect(other.correctionOtherPrinter).toBe('Brother');
    const same = await printPdfFile(file, { jobName: 'job', plan, db, profileId, correctionFrom: { printerId: 'urn:uuid:b', printerName: 'B' } });
    expect(same.correctionOtherPrinter).toBeNull();
    const unknown = await printPdfFile(file, { jobName: 'job', plan, db, profileId, correctionFrom: { printerId: null, printerName: null } });
    expect(unknown.correctionOtherPrinter).toBeNull();
  });

  it('the PDF printer never becomes the profile\'s printer', async () => {
    const { db, profileId, plan, file } = await setup();
    mockNative.printPdf.mockResolvedValue({ ...ok('PDF printer'), printableRectPt: undefined, minMarginsMils: { l: 0, t: 0, r: 0, b: 0 } });
    await printPdfFile(file, { jobName: 'job', plan, db, profileId });
    expect(await getProfile(db, profileId)).toMatchObject({ printerId: null, margins: null });
  });
});

describe('iOS: paper of the real job and ink outside the printable area (v1.1, REVIEW_V1 finding 5)', () => {
  it('a printer that cannot print the outer 10 mm → mayBeCut with its margins', async () => {
    const { db, profileId, file } = await setup();
    // a page whose ink reaches 6.35 mm from the edge (the calibration sheet's own margins are wider)
    const plan = { ...planCalibration({ paperKey: 'a4', margins: uniformMargins(6.35), pages: 1, ctx }) };
    plan.pages = plan.pages.map((p) => ({ ...p, ops: [...p.ops, { op: 'path' as const, role: 'calibration' as const, d: 'M 6.5 6.5 L 203.5 6.5', stroke: [0, 0, 0] as [number, number, number], fill: null, widthMm: 0.2 }] }));
    const pt = (mm: number) => (mm * 72) / 25.4;
    mockNative.printPdf.mockResolvedValue({ completed: true, printerId: 'ipp://x', paperWidthPt: A4.w, paperHeightPt: A4.h, paperMatches: true, paperSource: 'job', printableRectPt: { x: pt(10), y: pt(10), w: A4.w - pt(20), h: A4.h - pt(20) } });
    const r = await printPdfFile(file, { jobName: 'job', plan, db, profileId });
    expect(r).toMatchObject({ expectExact: false, advice: 'mayBeCut', learnedMarginsMm: { l: 10, t: 10 } });
  });
});
