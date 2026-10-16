/**
 * Importers and asset placement maths vs the spec-first Python oracle (scripts/oracle/p3_oracle.py, written in P3 BEFORE
 * this code; regenerate with `python3 scripts/oracle/p3_oracle.py`, never edit the JSON by hand).
 * Same agent wrote oracle and code (oracle first) — P3.5 re-does this with its own oracle (L27 rule 4).
 */
import oracle from '../../test/fixtures/engine/oracle-p3.json';

import { apply } from '@/engine/geometry';
import { imageMatrix, orientationMatrix } from '@/pdf/assets';

import { densityFromExif, densityFromJfif, densityFromPhys, isPlaceholderDpi, orientPoint, physicalSizeMm } from './image-meta';
import { pageGeometry, type PdfRect } from './pdf-boxes';
import { parsePathData } from './svg/path-data';
import { parseTransform } from './svg/style';
import { parsePreserveAspectRatio, svgNaturalSize, userLength, viewportMatrix } from './svg/units';

const close = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

describe('oracle-p3 (spec-first Python oracle)', () => {
  it('SVG physical size (SPEC §8.9, W8): all vectors', () => {
    const bad = oracle.svgSizes.filter((v) => {
      const r = svgNaturalSize(v.width, v.height, v.viewBox, v.ppi);
      if (!v.ok) return r.ok || r.error !== v.error;
      return !(r.ok && close(r.wMm, v.w!) && close(r.hMm, v.h!) && r.needsPpi === v.needsPpi);
    });
    expect(bad.slice(0, 5)).toEqual([]);
    expect(oracle.svgSizes.length).toBeGreaterThan(1200);
  });

  it('SVG viewport mapping (SVG 2 §8.2): matrices and mapped points', () => {
    const bad = oracle.viewports.filter((v) => {
      const [x, y, w, h] = v.viewBox;
      const m = viewportMatrix({ x, y, w, h }, v.size[0], v.size[1], parsePreserveAspectRatio(v.par));
      return !(m.every((e, i) => close(e, v.matrix[i])) && v.points.every((p) => {
        const q = apply(m, { x: p[0], y: p[1] });
        return close(q.x, p[2]) && close(q.y, p[3]);
      }));
    });
    expect(bad.slice(0, 3)).toEqual([]);
  });

  it('CSS absolute units inside a drawing (96 user units per inch)', () => {
    const bad = oracle.cssUnits.filter((v) => {
      const r = userLength(v.text);
      return !(r.ok && close(r.value, v.user));
    });
    expect(bad).toEqual([]);
  });

  it('transform lists (SVG 1.1 §7.6)', () => {
    const bad = oracle.transforms.filter((v) => {
      const m = parseTransform(v.text);
      return !(m && m.every((e, i) => close(e, v.matrix[i], 1e-9)));
    });
    expect(bad.slice(0, 3)).toEqual([]);
  });

  it('path arcs (F.6.5/F.6.6): end points exact, cubic pieces on the oracle ellipse, sweep = Δθ', () => {
    const bad: unknown[] = [];
    for (const v of oracle.arcs) {
      const { segs, error } = parsePathData(v.d);
      const first = segs[0];
      const ok0 = !error && first.c === 'M' && first.p.x === v.start[0] && first.p.y === v.start[1];
      const rest = segs.slice(1);
      const a = v.arc as null | { line?: boolean; cx: number; cy: number; rx: number; ry: number; phi: number; t1: number; dt: number };
      if (!ok0) bad.push({ d: v.d, why: 'start' });
      else if (a === null) {
        if (rest.length) bad.push({ d: v.d, why: 'should be omitted' });
      } else if (a.line) {
        if (!(rest.length === 1 && rest[0].c === 'L' && rest[0].p.x === v.end[0] && rest[0].p.y === v.end[1])) bad.push({ d: v.d, why: 'line' });
      } else {
        const last = rest[rest.length - 1];
        if (!last || last.c !== 'C' || last.p.x !== v.end[0] || last.p.y !== v.end[1]) {
          bad.push({ d: v.d, why: 'end' });
          continue;
        }
        const phi = (a.phi * Math.PI) / 180;
        const param = (x: number, y: number) => {
          const dx = x - a.cx;
          const dy = y - a.cy;
          const xp = (Math.cos(phi) * dx + Math.sin(phi) * dy) / a.rx;
          const yp = (-Math.sin(phi) * dx + Math.cos(phi) * dy) / a.ry;
          return { r: Math.hypot(xp, yp), t: Math.atan2(yp, xp) };
        };
        let prev = { x: v.start[0], y: v.start[1] };
        let swept = 0;
        for (const s of rest) {
          if (s.c !== 'C') {
            bad.push({ d: v.d, why: 'not cubic' });
            break;
          }
          const mid = { x: 0.125 * prev.x + 0.375 * s.p1.x + 0.375 * s.p2.x + 0.125 * s.p.x, y: 0.125 * prev.y + 0.375 * s.p1.y + 0.375 * s.p2.y + 0.125 * s.p.y };
          if (Math.abs(param(mid.x, mid.y).r - 1) > 3e-4 || Math.abs(param(s.p.x, s.p.y).r - 1) > 1e-7) bad.push({ d: v.d, why: 'off ellipse', r: param(mid.x, mid.y).r });
          let d = param(s.p.x, s.p.y).t - param(prev.x, prev.y).t;
          if (a.dt > 0 && d < -1e-9) d += 2 * Math.PI;
          if (a.dt < 0 && d > 1e-9) d -= 2 * Math.PI;
          swept += d;
          prev = s.p;
        }
        if (Math.abs(swept - a.dt) > 1e-6) bad.push({ d: v.d, why: 'sweep', swept, dt: a.dt });
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it('PDF page boxes (SPEC §8.10, W9): box, rotation, size and user space → natural mm', () => {
    const bad = oracle.pdfPages.filter((v) => {
      const g = pageGeometry(v.media as unknown as PdfRect, (v.crop as unknown as PdfRect | null) ?? null, v.userUnitIn ?? null, v.rotateIn);
      const notes = g.notes.filter((n) => n === 'rotateInvalid');
      return !(
        g.box.every((e, i) => close(e, v.box[i])) &&
        g.rotate === v.rotate &&
        close(g.wMm, v.w) &&
        close(g.hMm, v.h) &&
        (v.note ? notes.includes(v.note as 'rotateInvalid') : notes.length === 0) &&
        v.points.every((p) => {
          const q = apply(g.matrix, { x: p[0], y: p[1] });
          return close(q.x, p[2]) && close(q.y, p[3]);
        })
      );
    });
    expect(bad.slice(0, 3)).toEqual([]);
    expect(oracle.pdfPages.length).toBe(503);
  });

  it('image densities (pHYs, JFIF, EXIF) → dpi, physical size, placeholder rule (D48)', () => {
    const bad = oracle.densities.filter((v) => {
      const d =
        v.kind === 'phys'
          ? densityFromPhys(v.x as number, v.y as number, v.unit)
          : v.kind === 'jfif'
            ? densityFromJfif(v.x as number, v.y as number, v.unit)
            : densityFromExif(v.x as [number, number], v.y as [number, number], v.unit);
      const r = v.result;
      if (!r) return d !== null;
      if (!d) return true;
      const size = physicalSizeMm(v.px[0], v.px[1], d);
      return !(close(d.dpiX, r.dpiX) && close(d.dpiY, r.dpiY) && isPlaceholderDpi(d) === r.placeholder && (r.placeholder ? size === null : !!size && close(size.w, r.mmW) && close(size.h, r.mmH)));
    });
    expect(bad.slice(0, 3)).toEqual([]);
  });

  it('EXIF orientation 1–8: points, displayed size, and the painter matrix agree', () => {
    for (const v of oracle.orientations) {
      const [w, h] = v.raw;
      const m = orientationMatrix(v.orientation, w, h);
      for (const [x, y, X, Y] of v.points) {
        expect(orientPoint(v.orientation, x, y, w, h)).toEqual({ x: X, y: Y });
        const q = apply(m, { x, y });
        expect([q.x + 0, q.y + 0]).toEqual([X, Y]);
      }
      // unit square → natural: the displayed corners land on the natural box corners
      const im = imageMatrix(w, h, v.orientation, { w: v.display[0], h: v.display[1] });
      const corners = [apply(im, { x: 0, y: 0 }), apply(im, { x: 1, y: 1 })];
      const xs = corners.map((c) => c.x).sort((a, b) => a - b);
      const ys = corners.map((c) => c.y).sort((a, b) => a - b);
      expect([xs[0] + 0, ys[0] + 0, xs[1], ys[1]]).toEqual([0, 0, v.display[0], v.display[1]]);
    }
  });
});
