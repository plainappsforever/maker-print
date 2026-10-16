/**
 * Engine vs the independent Python `fractions` oracle (scripts/oracle/p1_oracle.py, L20/L27).
 * Regenerate the vectors with `python3 scripts/oracle/p1_oracle.py`; never edit the JSON by hand.
 */
import oracle from '../../test/fixtures/engine/oracle-p1.json';

import { objectCorners, rotatedBounds, contentMap, isAtDesignedSize, sourceToLocal, sourceToSheet, apply, visibleSize, type FitMode } from './geometry';
import { PAPERS, paperSize, type PaperKey } from './paper';
import { formatLength, mmToIn, mmToPt, parseLength, pxToMm, type DisplayUnit, type InchStyle, type Locale } from './units';

const TOL = 1e-9; // mm; the oracle is exact, the engine is double
const close = (a: number, b: number, tol = TOL) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

describe('oracle: units', () => {
  it.each(oracle.units.map((v, i) => [i, v] as const))('vector %i', (_i, v) => {
    expect(close(mmToPt(v.mm), v.pt)).toBe(true);
    expect(close(mmToIn(v.mm), v.in)).toBe(true);
    expect(close(pxToMm(v.px, v.ppi), v.pxMm)).toBe(true);
  });

  it('paper catalogue matches the oracle exactly (mm and pt)', () => {
    expect(PAPERS.length).toBe(oracle.papers.length);
    for (const p of oracle.papers) {
      const s = paperSize(p.key as PaperKey);
      expect([s.w, s.h]).toEqual([p.widthMm, p.heightMm]);
      expect(close(mmToPt(s.w), p.widthPt)).toBe(true);
      expect(close(mmToPt(s.h), p.heightPt)).toBe(true);
    }
  });
});

describe('oracle: parse', () => {
  it('accepts every valid vector with the exact value', () => {
    const bad = oracle.parseOk.filter((v) => {
      const r = parseLength(v.text, { unit: v.display as DisplayUnit, locale: v.locale as Locale });
      return !r.ok || !close(r.mm, v.mm);
    });
    expect(bad).toEqual([]);
    expect(oracle.parseOk.length).toBeGreaterThan(600);
  });

  it('refuses every invalid vector with the right message code', () => {
    const got = oracle.parseErr.map((v) => {
      const r = parseLength(v.text, { unit: v.display as DisplayUnit, locale: v.locale as Locale });
      return { text: v.text, code: r.ok ? 'ok' : r.error };
    });
    expect(got).toEqual(oracle.parseErr.map((v) => ({ text: v.text, code: v.code })));
  });
});

describe('oracle: format', () => {
  it('formats every vector exactly as the oracle and parses back to the shown value', () => {
    const bad = oracle.format.filter((v) => {
      const opts = { unit: v.unit as DisplayUnit, inchStyle: v.style as InchStyle, locale: v.locale as Locale };
      const text = formatLength(v.mm, opts);
      const back = parseLength(text, { unit: opts.unit, locale: opts.locale, allowNegative: true });
      return text !== v.text || !back.ok || !close(back.mm, v.shownMm, 1e-9);
    });
    expect(bad).toEqual([]);
  });
});

describe('oracle: rotation and mirror', () => {
  it('object corners and rotated bounds', () => {
    const bad = oracle.rotation.filter((v) => {
      const [x, y, w, h] = v.box;
      const p = { x, y, w, h, rotationDeg: v.deg, mirrorX: v.mirrorX, mirrorY: v.mirrorY };
      const corners = objectCorners(p);
      const b = rotatedBounds(p);
      const tol = v.exact ? 1e-12 : 1e-9; // exact trig for 90° steps: only addition-order ulps remain
      const cornersOk = corners.every((c, i) => close(c.x, v.corners[i][0], tol) && close(c.y, v.corners[i][1], tol));
      const boundsOk = [b.x, b.y, b.w, b.h].every((n, i) => close(n, v.bounds[i], tol));
      return !cornersOk || !boundsOk;
    });
    expect(bad).toEqual([]);
  });

  it('multiples of 90° are exact (no float residue)', () => {
    const exact = oracle.rotation.filter((v) => v.exact);
    expect(exact.length).toBeGreaterThan(100);
    for (const v of exact) {
      const [x, y, w, h] = v.box;
      const b = rotatedBounds({ x, y, w, h, rotationDeg: v.deg });
      expect([b.w, b.h]).toEqual([v.bounds[2], v.bounds[3]]);
    }
  });
});

describe('oracle: source mapping with crop and fit', () => {
  it('visible size, scales, offsets, designed-size badge and mapped points', () => {
    const bad = oracle.mapping.filter((v) => {
      const natural = { w: v.natural[0], h: v.natural[1] };
      const crop = { l: v.crop[0], t: v.crop[1], r: v.crop[2], b: v.crop[3] };
      const [x, y, w, h] = v.box;
      const placement = { x, y, w, h, rotationDeg: v.deg, mirrorX: v.mirrorX, mirrorY: false };
      const vis = visibleSize(natural.w, natural.h, crop);
      const map = contentMap({ w, h }, vis, v.mode as FitMode);
      const local = sourceToLocal(natural, crop, { w, h }, v.mode as FitMode);
      const sheet = sourceToSheet(placement, natural, crop, v.mode as FitMode);
      const ok =
        close(vis.w, v.visible[0]) &&
        close(vis.h, v.visible[1]) &&
        close(map.scaleX, v.scale[0]) &&
        close(map.scaleY, v.scale[1]) &&
        close(map.offsetX, v.offset[0]) &&
        close(map.offsetY, v.offset[1]) &&
        isAtDesignedSize(map) === v.atDesignedSize &&
        v.points.every((pt) => {
          const q = { x: pt.natural[0], y: pt.natural[1] };
          const l = apply(local, q);
          const s = apply(sheet, q);
          return close(l.x, pt.local[0]) && close(l.y, pt.local[1]) && close(s.x, pt.sheet[0]) && close(s.y, pt.sheet[1]);
        });
      return !ok;
    });
    expect(bad).toEqual([]);
  });
});
