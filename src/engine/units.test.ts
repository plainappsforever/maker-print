import { prng } from '../../test/prng';

import { displayPrecisionMm, formatLength, MM_PER_IN, mmToPt, parseLength, type DisplayUnit, type InchStyle, type Locale } from './units';

describe('parseLength', () => {
  it('reads every form of SPEC §8.1', () => {
    const en = { unit: 'mm' as const, locale: 'en' as const };
    const cases: [string, number][] = [
      ['78', 78],
      ['78 mm', 78],
      ['7,8 cm', 78],
      ['3.0625 in', 77.7875],
      ['3 1/16"', 77.7875],
      ['3-1/16 in', 77.7875],
      ['1/2"', 12.7],
      ['12 pt', (12 * 25.4) / 72],
      ['3 1/16”', 77.7875], // iOS smart quote
    ];
    for (const [text, mm] of cases) {
      const r = parseLength(text, en);
      expect(r).toEqual({ ok: true, mm: expect.closeTo(mm, 9) });
    }
  });

  it('uses the display unit for bare numbers', () => {
    expect(parseLength('2', { unit: 'in', locale: 'en' })).toEqual({ ok: true, mm: 50.8 });
    expect(parseLength('2', { unit: 'cm', locale: 'de' })).toEqual({ ok: true, mm: 20 });
  });

  it('allows negatives only when asked (positions)', () => {
    expect(parseLength('-5', { unit: 'mm', locale: 'en' })).toEqual({ ok: false, error: 'negative' });
    expect(parseLength('-5', { unit: 'mm', locale: 'en', allowNegative: true })).toEqual({ ok: true, mm: -5 });
    expect(parseLength('-0', { unit: 'mm', locale: 'en' })).toEqual({ ok: true, mm: 0 });
  });
});

describe('formatLength', () => {
  it('uses the locale decimal separator and drops trailing zeros', () => {
    expect(formatLength(77.7875, { unit: 'mm', locale: 'en' })).toBe('77.79 mm');
    expect(formatLength(75, { unit: 'cm', locale: 'de' })).toBe('7,5 cm');
    expect(formatLength(77.7875, { unit: 'in', locale: 'en' })).toBe('3.0625 in');
    expect(formatLength(100, { unit: 'mm', locale: 'de', withUnit: false })).toBe('100');
  });

  it('shows inch fractions reduced, and marks rounded ones with ≈', () => {
    expect(formatLength(77.7875, { unit: 'in', inchStyle: 'fraction16', locale: 'en' })).toBe('3 1/16 in');
    expect(formatLength(12.7, { unit: 'in', inchStyle: 'fraction32', locale: 'en' })).toBe('1/2 in');
    expect(formatLength(100, { unit: 'in', inchStyle: 'fraction16', locale: 'en' })).toBe('≈ 3 15/16 in');
    expect(formatLength(0, { unit: 'in', inchStyle: 'fraction16', locale: 'en' })).toBe('0 in');
  });

  it('round trip: parse(format(x)) is within the display precision (5 000 seeded values)', () => {
    const r = prng(31);
    const units: [DisplayUnit, InchStyle][] = [
      ['mm', 'decimal'],
      ['cm', 'decimal'],
      ['in', 'decimal'],
      ['in', 'fraction16'],
      ['in', 'fraction32'],
    ];
    for (let i = 0; i < 5000; i++) {
      const [unit, inchStyle] = r.pick(units);
      const locale = r.pick<Locale>(['en', 'de']);
      const mm = r.bool(0.3) ? r.int(0, 393 * 64) * (MM_PER_IN / 64) : r.range(0, 10_000);
      const text = formatLength(mm, { unit, inchStyle, locale });
      const back = parseLength(text, { unit, locale });
      expect(back.ok).toBe(true);
      if (back.ok) expect(Math.abs(back.mm - mm)).toBeLessThanOrEqual(displayPrecisionMm(unit, inchStyle) + 1e-9);
    }
  });
});

describe('mmToPt is correctly rounded for decimal millimetres (D38)', () => {
  it('US papers are whole points; ISO papers are the nearest double to the exact value', () => {
    expect([215.9, 279.4, 355.6, 431.8, 101.6, 152.4].map(mmToPt)).toEqual([612, 792, 1008, 1224, 288, 432]);
    expect([mmToPt(210), mmToPt(297)]).toEqual([595.2755905511812, 841.8897637795276]);
  });

});

// P3.5 review finding 17
describe('parseLength: zero sizes and vulgar fractions', () => {
  it('positive refuses 0 / "0 mm" / "-0" with its own error; positions still accept 0', () => {
    for (const t of ['0', '0 mm', '-0', '0,0']) expect(parseLength(t, { unit: 'mm', locale: 'de', positive: true })).toEqual({ ok: false, error: 'zero' });
    expect(parseLength('0', { unit: 'mm', locale: 'en', allowNegative: true })).toEqual({ ok: true, mm: 0 });
  });
  it('½ ¼ ¾ ⅛ glyphs and the fraction slash parse like typed fractions', () => {
    const p = (t: string) => parseLength(t, { unit: 'mm', locale: 'en' });
    expect(p('½"')).toEqual(p('1/2"'));
    expect(p('3 ½ in')).toEqual(p('3 1/2 in'));
    expect(p('3½ in')).toEqual(p('3 1/2 in'));
    expect(p('3¹⁄₁₆ in').ok).toBe(false); // super/subscript digits stay invalid (never guessed)
    expect(p('2 ⅛ in')).toEqual({ ok: true, mm: 2.125 * 25.4 });
    expect(p('5 3⁄8 in')).toEqual(p('5 3/8 in'));
  });
});
