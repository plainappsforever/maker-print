import { prng } from '../../test/prng';
import { paperSize, safeArea, type Margins } from '@/engine/paper';

import { BATCH_GAP_MM, photoStartSize, planBatch, sheetForImport, type BatchItem, type BatchTarget } from './place';

const M: Margins = { l: 6.35, t: 6.35, r: 6.35, b: 6.35 };
const A4 = paperSize('a4');
const SAFE = safeArea(A4, M)!;
const opts = (target: BatchTarget = { mode: 'new' }, margins = M) => ({ paperKey: 'a4' as const, margins, ppiTarget: 300, target });
const px = (w: number, h: number): BatchItem => ({ px: { w, h }, declaredMm: null });
const EPS = 1e-9;

function check(items: BatchItem[], o: ReturnType<typeof opts>) {
  const sheets = planBatch(items, o);
  const all = sheets.flatMap((s) => s.boxes.map((b) => ({ ...b, s })));
  // every photo exactly once, in pick order across sheets and within a sheet (rows top to bottom, left to right)
  expect(all.map((b) => b.index)).toEqual(items.map((_, i) => i));
  for (const s of sheets) {
    const paperSheet = s.sheet.paperKey === 'a4' && s.boxes.length > 0;
    for (const [i, b] of s.boxes.entries()) {
      // the size a single import gives (declared size, else the PPI target fitted into the safe area)
      const want = photoStartSize(items[b.index].px, items[b.index].declaredMm, 300, SAFE);
      expect(b.w).toBeCloseTo(want.w, 9);
      expect(b.h).toBeCloseTo(want.h, 9);
      const fits = want.w <= SAFE.w + EPS && want.h <= SAFE.h + EPS;
      if (paperSheet && fits && s.use !== 'target') {
        const area = safeArea({ w: s.sheet.widthMm, h: s.sheet.heightMm }, o.margins)!;
        expect(b.x).toBeGreaterThanOrEqual(area.x - EPS);
        expect(b.y).toBeGreaterThanOrEqual(area.y - EPS);
        expect(b.x + b.w).toBeLessThanOrEqual(area.x + area.w + 1e-6);
        expect(b.y + b.h).toBeLessThanOrEqual(area.y + area.h + 1e-6);
      }
      for (const c of s.boxes.slice(i + 1)) {
        const apart = b.x + b.w <= c.x + 1e-6 || c.x + c.w <= b.x + 1e-6 || b.y + b.h <= c.y + 1e-6 || c.y + c.h <= b.y + 1e-6;
        expect(apart).toBe(true);
        // reading order: a later photo is right of an earlier one in the same row, or in a lower row
        expect(c.y > b.y + 1e-6 || (Math.abs(c.y - b.y) < 1e-6 && c.x > b.x)).toBe(true);
      }
    }
  }
  return sheets;
}

describe('planBatch (V15 X06)', () => {
  it('one photo lands exactly where a single import puts it', () => {
    for (const p of [px(4032, 3024), px(1200, 900), px(300, 3000)]) {
      const s = planBatch([p], opts());
      const single = sheetForImport(photoStartSize(p.px, null, 300, SAFE), 'a4', M);
      expect(s).toHaveLength(1);
      expect(s[0].use).toBe('target');
      expect(s[0].sheet).toEqual(single.sheet);
      expect(s[0].boxes[0].x).toBeCloseTo(single.box.x, 9);
      expect(s[0].boxes[0].y).toBeCloseTo(single.box.y, 9);
    }
  });

  it('phone photos (12 MP) are one per sheet at the PPI target, as single imports; small ones share a sheet in rows', () => {
    const phones = check([px(4032, 3024), px(3024, 4032), px(4032, 3024)], opts());
    expect(phones).toHaveLength(3);
    expect(phones.map((s) => s.use)).toEqual(['target', null, null]);
    // 600 × 450 px at 300 ppi = 50.8 × 38.1 mm: 3 per row on A4 (197.3 mm safe width), 6 rows (284 mm)
    const small = check(Array.from({ length: 20 }, () => px(600, 450)), opts());
    expect(small).toHaveLength(2);
    expect(small[0].boxes).toHaveLength(18);
    const rows = new Set(small[0].boxes.map((b) => b.y.toFixed(6)));
    expect(rows.size).toBe(6);
    expect(small[0].boxes[1].x - (small[0].boxes[0].x + small[0].boxes[0].w)).toBeCloseTo(BATCH_GAP_MM, 9);
  });

  it('declared sizes are kept; one larger than the safe area gets its own sheet (paper 1:1 or a big sheet)', () => {
    const items: BatchItem[] = [px(600, 450), { px: { w: 2480, h: 3508 }, declaredMm: { w: 210, h: 297 } }, px(600, 450), { px: { w: 5000, h: 5000 }, declaredMm: { w: 500, h: 500 } }];
    const s = check(items, opts());
    expect(s.map((x) => x.boxes.map((b) => b.index))).toEqual([[0], [1], [2], [3]]);
    expect(s[1].sheet).toEqual({ widthMm: 210, heightMm: 297, paperKey: 'a4' });
    expect(s[1].boxes[0]).toMatchObject({ x: 0, y: 0, w: 210, h: 297 });
    expect(s[3].sheet).toEqual({ widthMm: 500, heightMm: 500, paperKey: null });
    // first photo too big for the new project's sheet: that sheet takes its size
    const first = planBatch([{ px: { w: 5000, h: 5000 }, declaredMm: { w: 500, h: 500 } }, px(600, 450)], opts());
    expect(first[0]).toMatchObject({ use: 'target', sheet: { widthMm: 500, heightMm: 500, paperKey: null } });
    expect(first[1]).toMatchObject({ use: null, sheet: { paperKey: 'a4' } });
  });

  it('add mode: the first photos go onto the current sheet (centred, unchanged size), the rest onto new paper sheets', () => {
    const label = { widthMm: 100, heightMm: 60 };
    const s = check([px(300, 300), px(300, 300), px(4032, 3024)], opts({ mode: 'add', sheet: label }));
    expect(s[0].use).toBe('target');
    expect(s[0].sheet).toEqual({ ...label, paperKey: null });
    expect(s[0].boxes.map((b) => b.index)).toEqual([0, 1]);
    const midX = (s[0].boxes[0].x + s[0].boxes[1].x + s[0].boxes[1].w) / 2;
    expect(midX).toBeCloseTo(50, 9);
    expect(s[1]).toMatchObject({ use: null, sheet: { paperKey: 'a4' } });
    // a photo bigger than the current sheet is centred on it, like a single "add"
    const big = planBatch([px(4032, 3024)], opts({ mode: 'add', sheet: label }));
    expect(big[0].boxes[0].x + big[0].boxes[0].w / 2).toBeCloseTo(50, 9);
  });

  it('property: 300 random batches never overlap, never leave the safe area, never lose or reorder a photo', () => {
    const r = prng(606);
    for (let n = 0; n < 300; n++) {
      const count = r.int(1, 20);
      const items = Array.from({ length: count }, (): BatchItem => {
        const w = r.int(50, 6000);
        const h = r.int(50, 6000);
        return r.bool(0.15) ? { px: { w, h }, declaredMm: { w: r.range(5, 400), h: r.range(5, 400) } } : px(w, h);
      });
      const m: Margins = { l: r.range(0, 15), t: r.range(0, 15), r: r.range(0, 15), b: r.range(0, 15) };
      const target: BatchTarget = r.bool() ? { mode: 'new' } : { mode: 'add', sheet: { widthMm: r.range(50, 600), heightMm: r.range(50, 600) } };
      const o = { ...opts(target, m) };
      const sheets = planBatch(items, o);
      expect(sheets.flatMap((s) => s.boxes.map((b) => b.index))).toEqual(items.map((_, i) => i));
      const safe = safeArea(A4, m)!;
      for (const s of sheets) {
        for (const [i, b] of s.boxes.entries()) {
          if (s.use === null && s.sheet.paperKey === 'a4' && b.w <= safe.w + EPS && b.h <= safe.h + EPS && !(b.x === 0 && b.y === 0 && b.w === 210)) {
            expect(b.x).toBeGreaterThanOrEqual(safe.x - 1e-6);
            expect(b.y).toBeGreaterThanOrEqual(safe.y - 1e-6);
            expect(b.x + b.w).toBeLessThanOrEqual(safe.x + safe.w + 1e-6);
            expect(b.y + b.h).toBeLessThanOrEqual(safe.y + safe.h + 1e-6);
          }
          for (const c of s.boxes.slice(i + 1)) expect(b.x + b.w <= c.x + 1e-6 || c.x + c.w <= b.x + 1e-6 || b.y + b.h <= c.y + 1e-6 || c.y + c.h <= b.y + 1e-6).toBe(true);
        }
      }
      expect(sheets.filter((s) => s.use === 'target')).toHaveLength(1);
      expect(sheets.every((s) => s.boxes.length > 0)).toBe(true);
    }
  });
});
