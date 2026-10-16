import { defaultMarginMm, getPaper, isPaperKey, matchPaper, PAPERS, paperSize, regionDefaults, safeArea, uniformMargins } from './paper';

describe('paper catalogue', () => {
  it('has unique keys and portrait dimensions', () => {
    expect(new Set(PAPERS.map((p) => p.key)).size).toBe(PAPERS.length);
    for (const p of PAPERS) expect(p.widthMm).toBeLessThanOrEqual(p.heightMm);
  });

  it('ISO A series halves exactly (A(n+1) width = floor of A(n) height / 2 … ISO 216 table)', () => {
    expect(paperSize('a0')).toEqual({ w: 841, h: 1189 });
    expect(paperSize('a4', 'landscape')).toEqual({ w: 297, h: 210 });
    expect(paperSize('letter')).toEqual({ w: 215.9, h: 279.4 });
  });

  it('matches a sheet to a paper within ±0.01 mm in either orientation', () => {
    expect(matchPaper(210.005, 297)).toEqual({ key: 'a4', orientation: 'portrait' });
    expect(matchPaper(279.4, 215.9)).toEqual({ key: 'letter', orientation: 'landscape' });
    expect(matchPaper(210.02, 297)).toBeNull();
  });

  it('default margins: ¼ in office, 3 mm photo', () => {
    expect(defaultMarginMm('a4')).toBe(6.35);
    expect(defaultMarginMm('photo-4x6')).toBe(3);
    expect(getPaper('photo-10x15').kind).toBe('photo');
  });

  it('safe area: A4 with 6.35 mm is 197.3 × 284.3 (SPEC W3/W6)', () => {
    const sa = safeArea(paperSize('a4'), uniformMargins(6.35));
    expect(sa?.w).toBeCloseTo(197.3, 9);
    expect(sa?.h).toBeCloseTo(284.3, 9);
    expect(safeArea({ w: 10, h: 10 }, uniformMargins(5))).toBeNull();
  });

  it('isPaperKey guards unknown strings', () => {
    expect(isPaperKey('a4')).toBe(true);
    expect(isPaperKey('a7')).toBe(false);
    expect(isPaperKey(null)).toBe(false);
  });
});

describe('region defaults (D22)', () => {
  it.each([
    ['US', 'letter', 'in'],
    ['us', 'letter', 'in'],
    ['CA', 'letter', 'mm'],
    ['MX', 'letter', 'mm'],
    ['PR', 'letter', 'mm'],
    ['LR', 'a4', 'in'],
    ['MM', 'a4', 'in'],
    ['DE', 'a4', 'mm'],
    ['GB', 'a4', 'mm'],
    [null, 'a4', 'mm'],
    ['', 'a4', 'mm'],
  ])('%s → %s, %s', (region, paper, unit) => {
    expect(regionDefaults(region)).toMatchObject({ paper, unit });
  });
});
