import { prng } from '../../test/prng';

import { alignTo, type AlignMode } from './align';
import { rotatedBounds } from './geometry';
import { uniformMargins } from './paper';
import { snapCandidates, snapRect, snapThresholdMm, snapValue, GRID_SPACINGS_MM } from './snap';

describe('snap (D21)', () => {
  it('threshold is 8 screen points at the current zoom', () => {
    expect(snapThresholdMm(4)).toBe(2);
  });

  it('snaps the nearest edge and reports a guide', () => {
    const c = snapCandidates({ sheet: { w: 210, h: 297 }, margins: uniformMargins(6.35) });
    const res = snapRect({ x: 7, y: 100, w: 50, h: 20 }, c, 2);
    expect(res.dx).toBeCloseTo(-0.65, 9);
    expect(res.guides).toEqual([{ axis: 'x', at: 6.35, kind: 'safe' }]);
    expect(res.dy).toBe(0);
  });

  it('centre lines and other objects are candidates; ties prefer the sheet', () => {
    const c = snapCandidates({ sheet: { w: 200, h: 200 }, others: [{ x: 100, y: 0, w: 10, h: 10 }] });
    const res = snapRect({ x: 50, y: 150, w: 49, h: 10 }, c, 2);
    expect(res.dx).toBeCloseTo(1, 9); // right edge 99 → 100: sheet centre and object left edge coincide
    expect(res.guides[0].kind).toBe('sheet');
  });

  it('grid snapping (⅛ in)', () => {
    const g = GRID_SPACINGS_MM.in8;
    const out = snapValue(3 * g + 0.4, [], 1, g);
    expect(out.value).toBeCloseTo(3 * g, 12);
    expect(out.guide?.kind).toBe('grid');
  });

  it('property (2 000 drags): never moves more than the threshold, and a snapped edge lands on a line', () => {
    const r = prng(21);
    for (let i = 0; i < 2000; i++) {
      const sheet = { w: r.range(50, 1200), h: r.range(50, 1200) };
      const others = Array.from({ length: r.int(0, 5) }, () => ({ x: r.range(0, sheet.w), y: r.range(0, sheet.h), w: r.range(1, 200), h: r.range(1, 200) }));
      const c = snapCandidates({ sheet, margins: uniformMargins(r.range(0, 10)), others });
      const t = snapThresholdMm(r.range(0.5, 20));
      const rect = { x: r.range(-50, sheet.w), y: r.range(-50, sheet.h), w: r.range(1, 300), h: r.range(1, 300) };
      const grid = r.bool(0.5) ? r.pick([1, 5, GRID_SPACINGS_MM.in8]) : undefined;
      const res = snapRect(rect, c, t, grid);
      expect(Math.abs(res.dx)).toBeLessThanOrEqual(t + 1e-12);
      expect(Math.abs(res.dy)).toBeLessThanOrEqual(t + 1e-12);
      for (const gd of res.guides) {
        const moved = gd.axis === 'x' ? [rect.x, rect.x + rect.w / 2, rect.x + rect.w].map((v) => v + res.dx) : [rect.y, rect.y + rect.h / 2, rect.y + rect.h].map((v) => v + res.dy);
        expect(moved.some((v) => Math.abs(v - gd.at) <= 1e-9)).toBe(true);
      }
      if (res.guides.length === 0) expect([res.dx, res.dy]).toEqual([0, 0]);
    }
  });
});

describe('align', () => {
  it('property: the visible (rotated) bounds touch the target edge / centre', () => {
    const r = prng(5);
    const modes: AlignMode[] = ['left', 'centre', 'right', 'top', 'middle', 'bottom'];
    for (let i = 0; i < 1000; i++) {
      const p = { x: r.range(-100, 300), y: r.range(-100, 300), w: r.range(1, 200), h: r.range(1, 200), rotationDeg: r.range(0, 360) };
      const target = { x: r.range(0, 10), y: r.range(0, 10), w: r.range(100, 300), h: r.range(100, 400) };
      const mode = r.pick(modes);
      const b = rotatedBounds({ ...p, ...alignTo(p, mode, target) });
      const expected: Record<AlignMode, [number, number]> = {
        left: [b.x, target.x],
        centre: [b.x + b.w / 2, target.x + target.w / 2],
        right: [b.x + b.w, target.x + target.w],
        top: [b.y, target.y],
        middle: [b.y + b.h / 2, target.y + target.h / 2],
        bottom: [b.y + b.h, target.y + target.h],
      };
      expect(expected[mode][0]).toBeCloseTo(expected[mode][1], 9);
      // the other axis is unchanged
      const moved = alignTo(p, mode, target);
      if (['left', 'centre', 'right'].includes(mode)) expect(moved.y).toBe(p.y);
      else expect(moved.x).toBe(p.x);
    }
  });
});
