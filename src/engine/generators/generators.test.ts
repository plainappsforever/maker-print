import { printTranslator } from '@/i18n';

import { CHECK_BAR_FOOTPRINT, checkBarContent } from '../checkbar';
import { contentBounds, parsePath, path, pathBounds, transformPath } from '../path';
import { sanitiseText, textWidthMm, wrapText } from '../text-metrics';
import { ptToMm } from '../units';
import { circleLayout, circleParams } from './circles';
import { colour, labelNumber, printLength, type GenContext } from './context';
import { gridParams } from './grid';
import { isVectorKind, objectContent, VECTOR_KINDS } from './index';
import { rulerTicks } from './ruler';

const ctx: GenContext = { locale: 'en', unit: 'mm', inchStyle: 'fraction16', t: printTranslator('en') };
const de: GenContext = { locale: 'de', unit: 'in', inchStyle: 'fraction16', t: printTranslator('de') };
const verticals = (d: string) => {
  const s = parsePath(d);
  const out: number[] = [];
  for (let i = 0; i + 1 < s.length; i++) {
    const a = s[i];
    const b = s[i + 1];
    if (a.c === 'M' && b.c === 'L' && a.p.x === b.p.x) out.push(a.p.x);
  }
  return out;
};

describe('paths', () => {
  it('ellipse: 8 Béziers, extreme points exact, radial error ≤ 4.3e-6 × r', () => {
    const d = path().ellipse(50, 40, 30, 30).toString();
    const segs = parsePath(d);
    expect(segs.filter((s) => s.c === 'C').length).toBe(8);
    expect(pathBounds(d)).toMatchObject({ y: 10, h: 60 });
    let worst = 0;
    for (const s of segs) {
      if (s.c !== 'C') continue;
      const prev = segs[segs.indexOf(s) - 1];
      const p0 = prev.c === 'Z' ? { x: 0, y: 0 } : prev.p;
      for (let k = 0; k <= 20; k++) {
        const t = k / 20;
        const u = 1 - t;
        const x = u * u * u * p0.x + 3 * u * u * t * s.p1.x + 3 * u * t * t * s.p2.x + t * t * t * s.p.x;
        const y = u * u * u * p0.y + 3 * u * u * t * s.p1.y + 3 * u * t * t * s.p2.y + t * t * t * s.p.y;
        worst = Math.max(worst, Math.abs(Math.hypot(x - 50, y - 40) - 30));
      }
    }
    expect(worst).toBeLessThanOrEqual(4.3e-6 * 30);
  });

  it('full-precision numbers round-trip through d strings and affine maps', () => {
    const d = path().segment(1 / 3, 2 / 7, Math.PI, -0).toString();
    expect(d).toBe(`M${1 / 3} ${2 / 7} L${Math.PI} 0`);
    expect(parsePath(transformPath(d, [1, 0, 0, 1, 10, 0]))[0]).toEqual({ c: 'M', p: { x: 1 / 3 + 10, y: 2 / 7 } });
  });
});

describe('text', () => {
  it('guard: non-WinAnsi characters become "?" and are listed; German and smart quotes are fine', () => {
    expect(sanitiseText('Größe “5” – ok')).toEqual({ text: 'Größe “5” – ok', unsupported: [] });
    expect(sanitiseText('a≈b→c≈')).toEqual({ text: 'a?b?c?', unsupported: ['≈', '→'] });
  });

  it('width, wrapping and alignment', () => {
    expect(textWidthMm('100', 10)).toBeCloseTo(16.68, 10);
    const lines = wrapText('one two three four five six', 3, 15);
    expect(lines.every((l) => textWidthMm(l, 3) <= 15 || !l.includes(' '))).toBe(true);
    expect(lines.join(' ')).toBe('one two three four five six');
    const c = objectContent('text', 100, 30, { text: 'Hi\nthere', fontSizePt: 12, align: 'right' }, ctx);
    expect(c.texts.map((t) => t.text)).toEqual(['Hi', 'there']);
    expect(c.texts[1].x + textWidthMm('there', ptToMm(12))).toBeCloseTo(100, 10);
    expect(c.texts[1].y - c.texts[0].y).toBeCloseTo(1.2 * ptToMm(12), 10);
  });

  it('labels: German decimal comma, rounded inch values marked with "~" (no ≈ in WinAnsi)', () => {
    expect(labelNumber(2.5, 'de')).toBe('2,5');
    expect(printLength(100, de)).toBe('~3 15/16 in');
    expect(printLength(25.4, de)).toBe('1 in');
  });
});

describe('check bar', () => {
  it('ends are full-height lines exactly 100 mm apart; ink stays inside the footprint', () => {
    const c = checkBarContent('This bar must measure 100 mm');
    const full = parsePath(c.paths[1].d).filter((s, i, a) => s.c === 'L' && a[i - 1].c === 'M' && (s as { p: { y: number } }).p.y === 6);
    expect(full.map((s) => (s as { p: { x: number } }).p.x)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    const b = contentBounds(c, (t) => textWidthMm(t.text, t.sizeMm))!;
    expect(b.x >= CHECK_BAR_FOOTPRINT.x && b.y >= CHECK_BAR_FOOTPRINT.y && b.x + b.w <= CHECK_BAR_FOOTPRINT.x + CHECK_BAR_FOOTPRINT.w && b.y + b.h <= CHECK_BAR_FOOTPRINT.y + CHECK_BAR_FOOTPRINT.h).toBe(true);
    const long = checkBarContent('x'.repeat(300));
    expect(textWidthMm(long.texts[long.texts.length - 1].text, 2.6)).toBeLessThanOrEqual(100);
  });
});

describe('generators', () => {
  it('ruler content draws every tick at k × step', () => {
    const c = objectContent('ruler', 152.4, 15, { unit: 'in' }, ctx);
    expect(verticals(c.paths[1].d)).toEqual(rulerTicks(152.4, 'in').map((t) => t.x));
    expect(c.texts.filter((t) => /^\d+$/.test(t.text)).map((t) => t.text)).toEqual(['0', '1', '2', '3', '4', '5', '6']);
    const cm = objectContent('ruler', 300, 30, { unit: 'cm' }, ctx);
    expect(cm.texts.filter((t) => /^\d+$/.test(t.text)).length).toBe(31);
  });

  it('grid: bold every N, numbered axes; dots as round-capped zero-length lines; props fall back to defaults', () => {
    const g = objectContent('grid', 100, 50, { spacingMm: 5, boldEvery: 2, numbered: true }, ctx);
    expect(g.paths.map((p) => p.widthMm)).toEqual([0.1, 0.3]);
    expect(g.texts.length).toBeGreaterThan(0);
    expect(gridParams({ spacingMm: -3, boldEvery: 'x' })).toMatchObject({ spacingMm: 5, boldEvery: 2 });
    const d = objectContent('dots', 20, 10, { spacingMm: 5 }, ctx);
    expect(d.paths[0].cap).toBe('round');
    expect(parsePath(d.paths[0].d).filter((s) => s.c === 'M').length).toBe(5 * 3);
  });

  it('circle template: defaults, wrapping, labels in the display unit', () => {
    expect(circleParams({}).diametersMm).toEqual([5, 10, 20, 30, 40, 50]);
    const l = circleLayout(60, { diametersMm: [20, 20, 20], gapMm: 5, labels: true, cross: true });
    expect(l.centres.map((c) => [c.x, c.y])).toEqual([[10, 10], [35, 10], [10, 40]]);
    const c = objectContent('circles', 60, l.height, { diametersMm: [20, 20, 20] }, ctx);
    expect(c.texts.map((t) => t.text)).toEqual(['Ø 20 mm', 'Ø 20 mm', 'Ø 20 mm']);
  });

  it('every vector kind produces content inside (or on the stroke of) its box', () => {
    for (const k of VECTOR_KINDS) {
      expect(isVectorKind(k)).toBe(true);
      const c = objectContent(k, 80, 40, { text: 'Text', diametersMm: [10, 20] }, ctx);
      const b = contentBounds(c, (t) => textWidthMm(t.text, t.sizeMm));
      if (b) expect([k, b.x >= -0.5, b.y >= -0.5, b.x + b.w <= 80.5]).toEqual([k, true, true, true]);
    }
    expect(isVectorKind('image')).toBe(false);
    expect(colour('#ff0000')).toEqual([1, 0, 0]);
    expect(colour('red')).toEqual([0, 0, 0]);
  });

  it('test square prints its size; the German sheet is German', () => {
    const c = objectContent('test_square', 100, 100, {}, ctx);
    expect(c.texts[0].text).toBe('Test square 100 × 100 mm');
    expect(objectContent('test_square', 101.6, 101.6, {}, de).texts[0].text).toBe('Testquadrat 4 × 4 in');
  });
});
