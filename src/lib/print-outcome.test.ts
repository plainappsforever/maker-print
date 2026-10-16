/**
 * @jest-environment node
 */
// Words after a print (v1.1): what the print system did and what Maker Print could not control (L26).
import { describeOutcome } from './print-outcome';
import type { PrintOutcome } from './print';

jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));

const base: PrintOutcome = {
  route: 'exact',
  completed: true,
  printerName: 'Brother',
  printerId: 'urn:uuid:b',
  paperMm: { w: 210, h: 297 },
  paperMatches: true,
  learnedMarginsMm: null,
  marginsStored: false,
  otherPrinter: false,
  profilePrinterName: null,
  correctionOtherPrinter: null,
  expectExact: true,
  advice: null,
  raw: null,
};
const texts = (r: Partial<PrintOutcome>, o: Partial<Parameters<typeof describeOutcome>[1]> = {}) =>
  describeOutcome({ ...base, ...r }, { paperKey: 'a4', os: 'android', pages: 1, measure: 'MEASURE', ...o }).map((l) => `${l.level}:${l.text}`);

describe('describeOutcome', () => {
  it('another printer than the profile\'s, and a correction from another printer: orange lines (finding 3)', () => {
    const t = texts({ otherPrinter: true, profilePrinterName: 'Canon', correctionOtherPrinter: 'Canon' }, { profileName: 'Home' });
    expect(t.some((l) => l.startsWith('warn:') && l.includes('“Home”') && l.includes('Canon'))).toBe(true);
    expect(t.some((l) => l.startsWith('warn:The correction was measured on Canon'))).toBe(true);
    expect(texts({ correctionOtherPrinter: '' }).some((l) => l.includes('measured on another printer'))).toBe(true);
  });
});
