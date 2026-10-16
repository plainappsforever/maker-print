/**
 * @jest-environment node
 */
import { learnedMarginsMm, printerDisplayName, snapPaperToPage } from './route';

describe('learnedMarginsMm (D17)', () => {
  it('iOS: printable rect of the paper → margins in mm', () => {
    // A4 with 18 pt (6.35 mm) on every side
    const m = learnedMarginsMm({ paperWidthPt: 595.2755905511812, paperHeightPt: 841.8897637795277, printableRectPt: { x: 18, y: 18, w: 595.2755905511812 - 36, h: 841.8897637795277 - 36 } });
    expect(m).toEqual({ l: 6.35, t: 6.35, r: 6.35, b: 6.35 });
  });

  it('Android: min margins in mils → mm', () => {
    expect(learnedMarginsMm({ minMarginsMils: { l: 250, t: 0, r: 125, b: 500 } })).toEqual({ l: 6.35, t: 0, r: 3.18, b: 12.7 });
  });

  it('nothing usable → null', () => {
    expect(learnedMarginsMm({})).toBeNull();
    expect(learnedMarginsMm({ paperWidthPt: 100, paperHeightPt: 100, printableRectPt: { x: 0, y: 0, w: 0, h: 50 } })).toBeNull();
    expect(learnedMarginsMm({ paperWidthPt: 100, paperHeightPt: 100, printableRectPt: { x: 10, y: 10, w: 100, h: 50 } })).toBeNull();
    expect(learnedMarginsMm({ minMarginsMils: { l: -5, t: 0, r: 0, b: 0 } })).toBeNull();
  });
});

describe('printerDisplayName', () => {
  it('decodes DNS-SD instance names (iOS printerID) and leaves other ids alone', () => {
    expect(printerDisplayName('MakerPrint\\032Test._ipps._tcp.local.')).toBe('MakerPrint Test');
    expect(printerDisplayName('Brother\\032HL-L2400DWE\\.\\032x._ipp._tcp.local.')).toBe('Brother HL-L2400DWE. x');
    expect(printerDisplayName('ipp://10.0.2.2:8631/ipp/print')).toBe('ipp://10.0.2.2:8631/ipp/print');
    expect(printerDisplayName('urn:uuid:a0a0a0a0-0000-4000-8000-000000008633')).toBeNull();
    expect(printerDisplayName('')).toBeNull();
    expect(printerDisplayName(undefined)).toBeNull();
  });
});

describe('snapPaperToPage', () => {
  it('Android ISO A4 in whole mils is our A4; Letter is not', () => {
    expect(snapPaperToPage({ w: 210.058, h: 296.926 }, { w: 210, h: 297 })).toEqual({ w: 210, h: 297 });
    expect(snapPaperToPage({ w: 215.9, h: 279.4 }, { w: 210, h: 297 })).toEqual({ w: 215.9, h: 279.4 });
  });
});
