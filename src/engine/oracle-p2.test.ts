/**
 * Print-plan engine vs the exact Python oracles (L20/L27):
 *   oracle-p2-pending.json — written in P1 (scripts/oracle/p1_oracle.py) before any tiling/calibration code existed
 *   oracle-p2.json         — written in P2 (scripts/oracle/p2_oracle.py) before the plan engine existed
 * Regenerate with `python3 scripts/oracle/p1_oracle.py && python3 scripts/oracle/p2_oracle.py`; never edit by hand.
 * Same agent wrote oracle and engine (oracle first) — P3.5 re-does this with its own oracle.
 */
import pending from '../../test/fixtures/engine/oracle-p2-pending.json';
import oracle from '../../test/fixtures/engine/oracle-p2.json';

import { axisResult, calibrationBar, correctionMatrix } from './calibration';
import { circleLayout } from './generators/circles';
import { gridPositions, linedPositions } from './generators/grid';
import { rulerTicks, type RulerUnit } from './generators/ruler';
import { apply, type Placement } from './geometry';
import { scaleFromKnownLength } from './known-length';
import { edgeMarks, type EdgeMarks, type Side } from './marks';
import { getPaper, PAPERS, safeArea, uniformMargins, type PaperKey } from './paper';
import { effectivePpi, ppiBand } from './ppi';
import { fillSheet, repeatCopies, trimMarks } from './repeat';
import { chooseLayout, overlapDepth, registrationPoints, sheetLayout, tiles, type OrientationChoice } from './tiles';

const TOL = 1e-9;
const close = (a: number, b: number, tol = TOL) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const closeAll = (a: number[], b: number[], tol = TOL) => a.length === b.length && a.every((v, i) => close(v, b[i], tol));
const margins = (m: number[]) => ({ l: m[0], t: m[1], r: m[2], b: m[3] });

describe('P1 pending vectors (written in P1, before this engine)', () => {
  it('tiling counts and auto orientation: all 1 200 vectors', () => {
    const bad = pending.tiles.filter((v) => {
      const S = { w: v.sheet[0], h: v.sheet[1] };
      const m = margins(v.margins);
      const p = sheetLayout(S, v.paper as PaperKey, 'portrait', m, v.overlap);
      const l = sheetLayout(S, v.paper as PaperKey, 'landscape', m, v.overlap);
      const auto = chooseLayout(S, v.paper as PaperKey, 'auto', m, v.overlap);
      return !(p.cols === v.portrait[0] && p.rows === v.portrait[1] && l.cols === v.landscape[0] && l.rows === v.landscape[1] && auto.orientation === v.auto);
    });
    expect(bad).toEqual([]);
    expect(pending.tiles.length).toBe(1200);
  });

  it('named tiling examples W3–W5', () => {
    for (const [name, v] of Object.entries(pending.namedTiles)) {
      const [W, H] = { 'W3-a4': [600, 900], 'W3-letter': [600, 900], 'W4-a4': [1000, 30], 'W5-a2-on-a4': [420, 594], 'W5-a0-on-a4': [841, 1189] }[name]!;
      const paper = name.endsWith('letter') ? 'letter' : 'a4';
      const p = sheetLayout({ w: W, h: H }, paper, 'portrait', uniformMargins(6.35), 10);
      const l = sheetLayout({ w: W, h: H }, paper, 'landscape', uniformMargins(6.35), 10);
      expect([[p.cols, p.rows], [l.cols, l.rows], chooseLayout({ w: W, h: H }, paper, 'auto', uniformMargins(6.35), 10).orientation]).toEqual([v.portrait, v.landscape, v.auto]);
    }
  });

  it('fill-sheet counts: all 300 vectors', () => {
    const bad = pending.fill.filter((v) => {
      const r = fillSheet({ w: v.item[0], h: v.item[1], rotationDeg: 0 }, { x: v.gap[0], y: v.gap[1] }, { x: 0, y: 0, w: v.safe[0], h: v.safe[1] });
      const [c, rows] = r ? [r.cols, r.rows] : [0, 0];
      return !(c === v.cols && rows === v.rows) && !(r === null && (v.cols === 0 || v.rows === 0));
    });
    expect(bad).toEqual([]);
  });

  it('calibration verdicts, causes, corrections and the centred-fit inversion', () => {
    const bad = pending.calibration.filter((v) => {
      const r = axisResult(v.nominal, v.measured);
      if (r.verdict !== v.verdict || JSON.stringify(r.causes) !== JSON.stringify(v.causes) || !close(r.scale, v.scale)) return true;
      if (v.verdict === 'refused') return false;
      const page = getPaper(v.paper as PaperKey);
      const m = correctionMatrix({ w: page.widthMm, h: page.heightMm }, { fx: r.correction, fy: r.correction });
      const q = apply(m, { x: v.point![0], y: v.point![1] });
      return !close(r.correction, v.correction!) || !close(q.x, v.corrected![0]) || !close(q.y, v.corrected![1]);
    });
    expect(bad).toEqual([]);
    expect(pending.calibration.length).toBeGreaterThan(300);
  });

  it('W7', () => {
    const a = axisResult(100, 96.5);
    expect(close(a.correction, pending.w7.a.correction)).toBe(true);
    const x = apply(correctionMatrix({ w: 210, h: 297 }, { fx: a.correction, fy: a.correction }), { x: 20, y: 0 }).x;
    expect(close(x, pending.w7.a.x20OnA4)).toBe(true);
    expect(close(axisResult(100, 100.4).correction, pending.w7.b.correction)).toBe(true);
    const c = axisResult(100, 97.27);
    expect([c.verdict, c.causes]).toEqual([pending.w7.c.verdict, pending.w7.c.causes]);
  });
});

describe('P2 oracle: tiling plans', () => {
  it('mode, orientation, counts, regions, labels, registration marks', () => {
    const bad: unknown[] = [];
    for (const v of oracle.plans) {
      const S = { w: v.sheet[0], h: v.sheet[1] };
      const lay = chooseLayout(S, v.paper as PaperKey, v.orientationIn as OrientationChoice, margins(v.margins), v.overlap);
      let ok = lay.mode === v.mode && lay.orientation === v.orientation && lay.pages === v.pages;
      if (ok && v.mode === 'placed') ok = close((lay.paper.w - S.w) / 2, v.offset![0]) && close((lay.paper.h - S.h) / 2, v.offset![1]);
      if (ok && v.mode === 'tiled') {
        const ts = tiles(S, lay);
        ok =
          lay.cols === v.cols &&
          lay.rows === v.rows &&
          ts.length === v.tiles!.length &&
          ts.every((t, i) => {
            const o = v.tiles![i];
            const reg = [t.region.x, t.region.y, t.region.x + t.region.w, t.region.y + t.region.h];
            const vis = [t.visible.x, t.visible.y, t.visible.x + t.visible.w, t.visible.y + t.visible.h];
            return t.label === o.label && t.row === o.row && t.col === o.col && closeAll(reg, o.region) && closeAll(vis, o.visible);
          });
        const marks = registrationPoints(S, lay).map((p) => [p.x, p.y]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        ok = ok && marks.length === v.registration!.length && marks.every((p, i) => closeAll(p, v.registration![i]));
      }
      if (!ok) bad.push(v);
    }
    expect(bad).toEqual([]);
    expect(oracle.plans.length).toBeGreaterThan(300);
  });

  it('skip blank: tiles touched by the rotated rectangles of objects and their repeat copies', () => {
    const bad: unknown[] = [];
    for (const v of oracle.blank) {
      const S = { w: v.sheet[0], h: v.sheet[1] };
      const lay = sheetLayout(S, v.paper as PaperKey, v.orientation as 'portrait', uniformMargins(6.35), 10);
      const copies: Placement[] = v.objects.flatMap((o) =>
        repeatCopies({ x: o.x, y: o.y, w: o.w, h: o.h, rotationDeg: o.deg }, o.repeat ? { cols: o.repeat.cols, rows: o.repeat.rows, gap_x_mm: o.repeat.gx, gap_y_mm: o.repeat.gy, trim_marks: false } : null).map((c) => ({
          x: c.x, y: c.y, w: o.w, h: o.h, rotationDeg: o.deg, mirrorX: false, mirrorY: false,
        }))
      );
      const nonBlank = tiles(S, lay).filter((t) => copies.some((p) => overlapDepth(p, t.visible) > 1e-9)).map((t) => t.label);
      if (JSON.stringify(nonBlank) !== JSON.stringify(v.nonBlank)) bad.push({ v, nonBlank });
    }
    expect(bad).toEqual([]);
  });
});

const marksMatch = (m: EdgeMarks, want: Record<string, number[][]>, omitted: string[]) => {
  if (JSON.stringify([...m.omitted].sort()) !== JSON.stringify([...omitted].sort())) return false;
  return (['top', 'bottom', 'left', 'right'] as Side[]).every((side) => {
    const got = m.bySide[side].map((s) => (side === 'top' || side === 'bottom' ? [s.x0, s.y0, s.y1] : [s.y0, s.x0, s.x1]));
    return got.length === want[side].length && got.every((g, i) => closeAll(g, want[side][i]));
  });
};

describe('P2 oracle: repeat, fill sheet, trim and crop marks', () => {
  it('fill sheet: counts, centred grid, trim marks', () => {
    const bad = oracle.fill.filter((v) => {
      const safe = { x: v.safe[0], y: v.safe[1], w: v.safe[2], h: v.safe[3] };
      const r = fillSheet({ w: v.item[0], h: v.item[1], rotationDeg: v.deg }, { x: v.gap[0], y: v.gap[1] }, safe);
      if (!r) return !(v.cols === 0 || v.rows === 0);
      if (r.cols !== v.cols || r.rows !== v.rows || !closeAll([r.x, r.y], v.box!)) return true;
      const m = trimMarks({ x: r.x, y: r.y, w: v.item[0], h: v.item[1], rotationDeg: v.deg }, { cols: r.cols, rows: r.rows, gap_x_mm: v.gap[0], gap_y_mm: v.gap[1], trim_marks: true }, safe);
      return !marksMatch(m, v.marks!, v.omitted!);
    });
    expect(bad).toEqual([]);
  });

  it('hand-placed repeats: copy positions and trim marks against the A4 safe area', () => {
    const safe = safeArea({ w: 210, h: 297 }, uniformMargins(6.35))!;
    const bad = oracle.repeat.filter((v) => {
      const p = { x: v.box[0], y: v.box[1], w: v.box[2], h: v.box[3], rotationDeg: v.deg };
      const rep = { cols: v.cols, rows: v.rows, gap_x_mm: v.gap[0], gap_y_mm: v.gap[1], trim_marks: true };
      const copies = repeatCopies(p, rep).map((c) => [c.x, c.y]);
      return !(copies.length === v.copies.length && copies.every((c, i) => closeAll(c, v.copies[i])) && marksMatch(trimMarks(p, rep, safe), v.marks, v.omitted));
    });
    expect(bad).toEqual([]);
  });

  it('crop marks of placed sheets', () => {
    const bad = oracle.crop.filter((v) => {
      const [pw, ph] = v.paper;
      const [W, H] = v.sheet;
      const X0 = (pw - W) / 2;
      const Y0 = (ph - H) / 2;
      if (!closeAll([X0, Y0], v.offset)) return true;
      const safe = { x: v.margin, y: v.margin, w: pw - 2 * v.margin, h: ph - 2 * v.margin };
      return !marksMatch(edgeMarks({ x: X0, y: Y0, w: W, h: H }, [X0, X0 + W], [Y0, Y0 + H], safe), v.marks, v.omitted);
    });
    expect(bad).toEqual([]);
  });
});

describe('P2 oracle: PPI, known length, calibration', () => {
  it('W2 and 300 PPI vectors (crop, fill/fit, targets)', () => {
    for (const v of oracle.w2) {
      const r = effectivePpi({ w: v.px[0], h: v.px[1] }, { w: v.box[0], h: v.box[1] });
      expect(close(r.ppi, v.ppi)).toBe(true);
      expect(ppiBand(r.ppi, 300)).toBe(v.band);
    }
    const bad = oracle.ppi.filter((v) => {
      const r = effectivePpi({ w: v.px[0], h: v.px[1] }, { w: v.box[0], h: v.box[1] }, { l: v.crop[0], t: v.crop[1], r: v.crop[2], b: v.crop[3] }, v.fit as 'fill' | 'fit');
      return !(close(r.x, v.ppiX) && close(r.y, v.ppiY) && close(r.ppi, v.ppi) && ppiBand(r.ppi, v.target) === v.band);
    });
    expect(bad).toEqual([]);
  });

  it('W10 and 200 known-length vectors', () => {
    const w10 = scaleFromKnownLength({ box: { x: 0, y: 0, w: 200, h: 150 }, natural: { w: 4000, h: 3000 }, p1: { x: 100, y: 500 }, p2: { x: 912, y: 500 }, lengthMm: 50 })!;
    expect(close(w10.factor, oracle.w10.factor)).toBe(true);
    expect(close(w10.w, oracle.w10.width)).toBe(true);
    const bad = oracle.known.filter((v) => {
      const r = scaleFromKnownLength({
        box: { x: v.box[0], y: v.box[1], w: v.box[2], h: v.box[3] },
        natural: { w: v.natural[0], h: v.natural[1] },
        p1: { x: v.p1[0], y: v.p1[1] },
        p2: { x: v.p2[0], y: v.p2[1] },
        lengthMm: v.length,
      });
      return !r || !close(r.factor, v.factor) || !closeAll([r.x, r.y, r.w, r.h], v.newBox);
    });
    expect(bad).toEqual([]);
  });

  it('two-axis correction about the page centre', () => {
    const bad = oracle.correction.filter((v) => {
      const q = apply(correctionMatrix({ w: v.page[0], h: v.page[1] }, { fx: v.f[0], fy: v.f[1] }), { x: v.point[0], y: v.point[1] });
      return !closeAll([q.x, q.y], v.corrected);
    });
    expect(bad).toEqual([]);
  });

  it('calibration-sheet bar lengths for every catalogue paper', () => {
    for (const p of PAPERS) {
      const s = safeArea({ w: p.widthMm, h: p.heightMm }, uniformMargins(p.kind === 'photo' ? 3 : 6.35))!;
      expect({ x: calibrationBar(s.w), y: calibrationBar(s.h) }).toEqual(oracle.calibrationSheets[p.key as keyof typeof oracle.calibrationSheets]);
    }
  });
});

describe('P2 oracle: generators', () => {
  it('ruler ticks (mm, cm, in): count, last, sum, levels, labels', () => {
    const bad = oracle.rulers.filter((v) => {
      const t = rulerTicks(v.length, v.unit as RulerUnit);
      const levels: Record<string, number> = {};
      for (const k of t) levels[k.level] = (levels[k.level] ?? 0) + 1;
      const labels = t.filter((k) => k.label !== undefined).map((k) => k.label).slice(0, 40);
      return !(
        t.length === v.count &&
        close(t[t.length - 1].x, v.last) &&
        close(t.reduce((s, k) => s + k.x, 0), v.sum, 1e-9) &&
        JSON.stringify(Object.fromEntries(Object.entries(levels).sort())) === JSON.stringify(v.levelCounts) &&
        JSON.stringify(labels) === JSON.stringify(v.labels)
      );
    });
    expect(bad).toEqual([]);
  });

  it('graph paper, dot grid and lined paper positions', () => {
    const bad = oracle.grids.filter((v) => {
      const xs = gridPositions(v.size[0], v.spacing);
      const ys = gridPositions(v.size[1], v.spacing);
      const bold = (n: number) => Array.from({ length: n }, (_, k) => k).filter((k) => v.boldEvery > 1 && k % v.boldEvery === 0).length;
      const lined = linedPositions(v.size[1], v.spacing);
      return !(
        xs.length === v.vertical &&
        ys.length === v.horizontal &&
        bold(xs.length) === v.boldVertical &&
        bold(ys.length) === v.boldHorizontal &&
        close(xs[xs.length - 1], v.lastX) &&
        close(ys[ys.length - 1], v.lastY) &&
        xs.length * ys.length === v.dots &&
        lined.length === v.lined &&
        (v.linedLast === null ? lined.length === 0 : close(lined[lined.length - 1], v.linedLast))
      );
    });
    expect(bad).toEqual([]);
  });

  it('circle template layout', () => {
    const bad = oracle.circles.filter((v) => {
      const r = circleLayout(v.width, { diametersMm: v.diameters, gapMm: v.gap, labels: v.labelHeight > 0, cross: true });
      return !(close(r.height, v.height) && r.centres.length === v.centres.length && r.centres.every((c, i) => closeAll([c.x, c.y], v.centres[i])));
    });
    expect(bad).toEqual([]);
  });
});
