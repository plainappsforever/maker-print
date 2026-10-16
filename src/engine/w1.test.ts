import w1 from '../../test/fixtures/engine/w1.json';

import { paperSize, type PaperKey } from './paper';
import { mmToPt, parseLength, type DisplayUnit, type Locale } from './units';

// SPEC W1 (acceptance criterion A1): values as printed in the spec, 4 decimals.
describe('W1 units', () => {
  it.each(w1.paperPt)('$key page size in pt', ({ key, widthPt, heightPt }) => {
    const s = paperSize(key as PaperKey);
    expect(Math.abs(mmToPt(s.w) - widthPt)).toBeLessThanOrEqual(w1.tolerance);
    expect(Math.abs(mmToPt(s.h) - heightPt)).toBeLessThanOrEqual(w1.tolerance);
  });

  it.each(w1.mmToPt)('$mm mm in pt', ({ mm, pt }) => {
    expect(Math.abs(mmToPt(mm) - pt)).toBeLessThanOrEqual(w1.tolerance);
  });

  it.each(w1.parse)('parses "$text" ($locale)', ({ text, locale, unit, mm }) => {
    const r = parseLength(text, { unit: unit as DisplayUnit, locale: locale as Locale });
    expect(r.ok).toBe(true);
    if (r.ok) expect(Math.abs(r.mm - mm)).toBeLessThanOrEqual(w1.tolerance);
  });

  it('A4 is written with full precision, not rounded to 595 × 842', () => {
    const s = paperSize('a4');
    expect(mmToPt(s.w)).toBeCloseTo(595.2755905511812, 10);
    expect(mmToPt(s.h)).toBeCloseTo(841.8897637795277, 10);
  });
});
