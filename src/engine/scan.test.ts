import { pinholeScene } from '../../test/fakes/capture';
import { prng } from '../../test/prng';
import { applyH, FULL_FRAME_DIAGONAL_MM, orderCorners, quadIssue, type Quad } from './homography';
import { defaultQuad, edgeLengths, fromVisionNormalised, planScan, polyToPolyArrays, scanRecord, SCAN_MAX_PX, sourceOf, toCoreImagePoints, type KnownSize } from './scan';

const orderCornersForTest = (q: readonly { x: number; y: number }[]) => orderCorners(q)!;
const IMG = { w: 4032, h: 3024 };
const diag = Math.hypot(IMG.w, IMG.h);
const phoneF = (26 / FULL_FRAME_DIAGONAL_MM) * diag;
/** An A4 sheet photographed from above at an angle (both axes tilted: the quad tells its own focal length). */
const a4 = pinholeScene({ imgW: IMG.w, imgH: IMG.h, f: phoneF, W: 210, H: 297, ax: 0.35, ay: -0.25, az: 0.08, dist: 420 });

const plan = (known: KnownSize, corners: readonly { x: number; y: number }[] = a4.corners, extra: object = {}) => {
  const r = planScan({ corners, sourcePx: IMG, known, ppiTarget: 300, ...extra });
  if (!r.ok) throw new Error(r.error);
  return r.plan;
};

describe('planScan', () => {
  it('the fixture photo is a valid quad', () => {
    expect(quadIssue(a4.corners, IMG)).toBeNull();
  });

  it('both sides typed: used as given; output corners map exactly onto the rectangle; no estimate warning', () => {
    const p = plan({ kind: 'rect', wMm: 210, hMm: 297 });
    expect(p.sizeMm).toEqual({ w: 210, h: 297 });
    expect(p.warnings).toEqual([]);
    expect(p.aspect.source).toBe('perspective');
    expect(p.aspect.ratio).toBeCloseTo(210 / 297, 6);
    const out = [
      [0, 0],
      [p.outPx.w, 0],
      [p.outPx.w, p.outPx.h],
      [0, p.outPx.h],
    ];
    p.quad.forEach((c, i) => {
      const m = applyH(p.toOutput, c)!;
      expect(m.x).toBeCloseTo(out[i][0], 6);
      expect(m.y).toBeCloseTo(out[i][1], 6);
    });
    // output pixels are square (same density both ways) within the floor() rounding
    expect(Math.abs(p.outPx.w / p.outPx.h - 210 / 297)).toBeLessThan(2 / p.outPx.h);
    // the density is the photo's most detailed edge; the far edge is the least
    const [top, right, bottom, left] = edgeLengths(p.quad);
    const best = Math.max(top / (210 / 25.4), bottom / (210 / 25.4), left / (297 / 25.4), right / (297 / 25.4));
    expect(p.outPx.w).toBe(Math.floor((210 / 25.4) * best));
    expect(p.detailPpi).toBeCloseTo(Math.min(top / (210 / 25.4), bottom / (210 / 25.4), left / (297 / 25.4), right / (297 / 25.4)), 9);
  });

  it('paper size with autoOrient turns to the photo; without it the typed order stands and the mismatch is said', () => {
    expect(plan({ kind: 'rect', wMm: 297, hMm: 210, autoOrient: true }).sizeMm).toEqual({ w: 210, h: 297 });
    const typed = plan({ kind: 'rect', wMm: 297, hMm: 210 });
    expect(typed.sizeMm).toEqual({ w: 297, h: 210 });
    expect(typed.warnings).toContain('aspectMismatch');
    // Letter typed for an A4 photo: 5.9 % apart → said; 3 % apart → not said (quad-measured tolerance 5 %)
    expect(plan({ kind: 'rect', wMm: 215.9, hMm: 279.4 }).warnings).toContain('aspectMismatch');
    expect(plan({ kind: 'rect', wMm: 210 * 1.03, hMm: 297 }).warnings).not.toContain('aspectMismatch');
  });

  it('one side typed: the other from the perspective, always marked as estimated', () => {
    const w = plan({ kind: 'width', mm: 210 });
    expect(w.sizeMm!.w).toBe(210);
    expect(w.sizeMm!.h).toBeCloseTo(297, 4);
    expect(w.warnings).toContain('aspectEstimated');
    const h = plan({ kind: 'height', mm: 297 });
    expect(h.sizeMm!.w).toBeCloseTo(210, 4);
    expect(h.warnings).toContain('aspectEstimated');
  });

  it('straighten only: no true size, photo scale, marked as estimated', () => {
    const p = plan({ kind: 'none' });
    expect(p.sizeMm).toBeNull();
    expect(p.detailPpi).toBeNull();
    expect(p.warnings).toEqual(['aspectEstimated']);
    expect(p.outPx.w / p.outPx.h).toBeCloseTo(210 / 297, 2);
    const [top, right, bottom, left] = edgeLengths(p.quad);
    expect(Math.max(p.outPx.w - Math.max(top, bottom), p.outPx.h - Math.max(left, right))).toBeGreaterThanOrEqual(-1);
  });

  it('low detail: a far, small sheet is said; the pixel cap holds', () => {
    // a 1 m wide poster across a 1600 px wide photo: ~40 ppi
    const small = { w: 1600, h: 1200 };
    const q: Quad = [
      { x: 100, y: 100 },
      { x: 1500, y: 120 },
      { x: 1480, y: 1100 },
      { x: 120, y: 1080 },
    ];
    const r = planScan({ corners: q, sourcePx: small, known: { kind: 'rect', wMm: 1000, hMm: 700 }, ppiTarget: 300 });
    expect(r.ok && r.plan.warnings).toContain('lowDetail');
    // the output never passes the pixel cap (default 16 MP; here 1 MP)
    const capped = plan({ kind: 'rect', wMm: 210, hMm: 297 }, a4.corners, { maxPx: 1_000_000 });
    expect(capped.capped).toBe(true);
    expect(capped.outPx.w * capped.outPx.h).toBeLessThanOrEqual(1_000_000);
    expect(capped.sizeMm).toEqual({ w: 210, h: 297 });
    const free = plan({ kind: 'rect', wMm: 210, hMm: 297 });
    expect(free.capped).toBe(false);
    expect(free.outPx.w * free.outPx.h).toBeLessThanOrEqual(SCAN_MAX_PX);
  });

  it('refusals: bad lengths, bad corners (sorted first, so swapped handles still work)', () => {
    const bad = (known: KnownSize, corners: readonly { x: number; y: number }[] = a4.corners) => {
      const r = planScan({ corners, sourcePx: IMG, known, ppiTarget: 300 });
      return r.ok ? 'ok' : r.error;
    };
    expect(bad({ kind: 'rect', wMm: 0, hMm: 297 })).toBe('badLength');
    expect(bad({ kind: 'rect', wMm: 210, hMm: -1 })).toBe('badLength');
    expect(bad({ kind: 'width', mm: NaN })).toBe('badLength');
    expect(bad({ kind: 'width', mm: 20_000 })).toBe('badLength');
    expect(bad({ kind: 'width', mm: 9_999 })).toBe('badLength'); // height would pass 10 m
    expect(bad({ kind: 'rect', wMm: 210, hMm: 297 }, [a4.corners[2], a4.corners[0], a4.corners[3], a4.corners[1]])).toBe('ok');
    expect(bad({ kind: 'none' }, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }])).toBe('tooSmall');
    expect(bad({ kind: 'none' }, [{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }])).toBe('outside');
    expect(bad({ kind: 'none' }, [a4.corners[0], a4.corners[1]])).toBe('notFinite');
  });

  it('200 random photographed sheets with both sides typed: size as typed, the real centre lands in the output centre, no false mismatch', () => {
    const r = prng(42);
    let n = 0;
    while (n < 200) {
      const W = r.range(60, 600);
      const H = r.range(60, 600);
      const f = r.range(0.5, 1.5) * diag;
      const s = pinholeScene({ imgW: IMG.w, imgH: IMG.h, f, W, H, ax: r.range(-0.5, 0.5), ay: r.range(-0.5, 0.5), az: r.range(-0.2, 0.2), dist: (f * Math.max(W, H)) / (0.65 * IMG.h) });
      const res = planScan({ corners: s.corners, sourcePx: IMG, known: { kind: 'rect', wMm: W, hMm: H }, ppiTarget: 300 });
      if (!res.ok) continue;
      n++;
      const p = res.plan;
      expect(p.sizeMm).toEqual({ w: W, h: H });
      // the centre of the real rectangle lands in the centre of the output (projective centre, not the quad's average)
      const c = applyH(p.toOutput, s.project(W / 2, H / 2))!;
      expect(Math.abs(c.x / p.outPx.w - 0.5)).toBeLessThan(0.005);
      expect(Math.abs(c.y / p.outPx.h - 0.5)).toBeLessThan(0.005);
      if (p.aspect.source === 'perspective' || p.aspect.source === 'parallel') expect(p.warnings).not.toContain('aspectMismatch');
    }
  });
});

describe('review NICE one-liners (scan)', () => {
  it('N1: legal corners whose implied shape cannot be mapped say noShape, not "two corners on top of each other"', () => {
    const img = { w: 6708, h: 4472 };
    const q = [
      { x: 2443, y: 1990 },
      { x: 6527, y: 1171 },
      { x: 3972, y: 3869 },
      { x: 2338, y: 2149 },
    ];
    expect(quadIssue(orderCornersForTest(q), img)).toBeNull();
    const none = planScan({ corners: q, sourcePx: img, known: { kind: 'none' }, ppiTarget: 300 });
    expect(none.ok ? 'ok' : none.error).toBe('noShape');
    const rect = planScan({ corners: q, sourcePx: img, known: { kind: 'rect', wMm: 100, hMm: 100 }, ppiTarget: 300 });
    expect(rect.ok).toBe(true);
  });

  it('N9: Vision points up to 1 % outside are clamped onto the photo, so they pass the sanity rules', () => {
    const img = { w: 4000, h: 3000 };
    const q = fromVisionNormalised(
      [
        { x: -0.008, y: 1.005 },
        { x: 0.9, y: 0.95 },
        { x: 0.95, y: 0.1 },
        { x: 0.05, y: 0.05 },
      ],
      img
    )!;
    expect(q[0]).toEqual({ x: 0, y: 0 });
    expect(quadIssue(q, img)).toBeNull();
  });
});

describe('native boundary helpers', () => {
  it('default corners pass the sanity rules on any photo shape', () => {
    for (const img of [IMG, { w: 3024, h: 4032 }, { w: 400, h: 4000 }, { w: 64, h: 64 }]) expect(quadIssue(defaultQuad(img), img)).toBeNull();
  });

  it('Vision normalised (origin bottom-left) → pixels y down, any order; out-of-range refused', () => {
    const q = fromVisionNormalised(
      [
        { x: 0.9, y: 0.1 }, // bottom-right
        { x: 0.1, y: 0.9 }, // top-left
        { x: 0.9, y: 0.9 }, // top-right
        { x: 0.1, y: 0.1 }, // bottom-left
      ],
      { w: 1000, h: 500 }
    )!;
    expect(q.map((p) => [Math.round(p.x), Math.round(p.y)])).toEqual([
      [100, 50],
      [900, 50],
      [900, 450],
      [100, 450],
    ]);
    expect(fromVisionNormalised([{ x: 1.2, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }], { w: 10, h: 10 })).toBeNull();
  });

  it('CoreImage points flip y; polyToPoly arrays are quad → rectangle', () => {
    const p = plan({ kind: 'rect', wMm: 210, hMm: 297 });
    const ci = toCoreImagePoints(p.quad, IMG.h);
    expect(ci.topLeft).toEqual({ x: p.quad[0].x, y: IMG.h - p.quad[0].y });
    expect(ci.bottomLeft.y).toBeLessThan(ci.topLeft.y);
    const pp = polyToPolyArrays(p.quad, p.outPx);
    expect(pp.src).toEqual(p.quad.flatMap((c) => [c.x, c.y]));
    expect(pp.dst).toEqual([0, 0, p.outPx.w, 0, p.outPx.w, p.outPx.h, 0, p.outPx.h]);
    const s = sourceOf(p, 0, 0)!;
    expect(s.x).toBeCloseTo(p.quad[0].x, 6);
    expect(s.y).toBeCloseTo(p.quad[0].y, 6);
  });

  it('the scan record carries what the editor and the reviewer need, JSON-safe', () => {
    const known: KnownSize = { kind: 'width', mm: 210 };
    const rec = scanRecord(plan(known), known);
    expect(JSON.parse(JSON.stringify(rec))).toEqual(rec);
    expect(rec).toMatchObject({ v: 1, known, warnings: ['aspectEstimated'] });
    expect(rec.sizeMm!.w).toBe(210);
  });
});

// ------------------------------------------------------------------------------------------------ review V15 A1
describe('review V15 A1 fixes (docs/REVIEW_V15_A1.md)', () => {
  const deg = Math.PI / 180;
  const lensPx = (mm: number) => (mm / FULL_FRAME_DIAGONAL_MM) * diag;
  /** The reviewer's M1 photo: 4032 × 3024, 26 mm lens, A4 at pitch 25° and yaw 15°. */
  const m1 = pinholeScene({ imgW: IMG.w, imgH: IMG.h, f: lensPx(26), W: 210, H: 297, ax: 25 * deg, ay: 15 * deg, az: 0, dist: 420 });
  const run = (s: { corners: readonly { x: number; y: number }[] }, known: KnownSize, focal35mm: number | null = null) => {
    const r = planScan({ corners: s.corners, sourcePx: IMG, known, ppiTarget: 300, focal35mm });
    if (!r.ok) throw new Error(r.error);
    return r.plan;
  };

  it('M1: with the EXIF lens the typed sides are checked at 5 % (was 15 %): 210 × 260 on an A4 photo is said', () => {
    const p = run(m1, { kind: 'rect', wMm: 210, hMm: 260 }, 26);
    expect(p.aspect.source).toBe('lens');
    expect(p.warnings).toContain('aspectMismatch');
    for (const off of [0.06, 0.08, 0.1, 0.12, 0.14]) {
      expect(run(m1, { kind: 'rect', wMm: 210, hMm: 297 / (1 + off) }, 26).warnings).toContain('aspectMismatch');
      expect(run(m1, { kind: 'rect', wMm: 210, hMm: 297 * (1 + off) }, 26).warnings).toContain('aspectMismatch');
    }
    expect(run(m1, { kind: 'rect', wMm: 210, hMm: 297 * 1.03 }, 26).warnings).not.toContain('aspectMismatch');
    expect(run(m1, { kind: 'rect', wMm: 210, hMm: 297 }, 26).warnings).toEqual([]);
    // the assumed lens keeps the loose 15 % (D91): a one-axis tilt needs the lens
    const tilt = pinholeScene({ imgW: IMG.w, imgH: IMG.h, f: lensPx(26), W: 210, H: 297, ax: 0.7, ay: 0, az: 0, dist: 500 });
    expect(run(tilt, { kind: 'rect', wMm: 210, hMm: 297 * 1.1 }).aspect.source).toBe('assumedLens');
    expect(run(tilt, { kind: 'rect', wMm: 210, hMm: 297 * 1.1 }).warnings).not.toContain('aspectMismatch');
    expect(run(tilt, { kind: 'rect', wMm: 210, hMm: 297 * 1.2 }).warnings).toContain('aspectMismatch');
  });

  it('S1: an EXIF focal length outside 13–130 mm is not believed (the quad decides; recorded as ignored)', () => {
    for (const v of [1, 4, 6, 12, 131, 65535]) {
      const p = run(m1, { kind: 'width', mm: 210 }, v);
      expect(p.aspect.source).toBe('perspective');
      expect(p.aspect.lensIgnored).toBe(v);
      expect(p.sizeMm!.h).toBeCloseTo(297, 6);
    }
    for (const v of [13, 26, 130]) {
      const p = run(m1, { kind: 'width', mm: 210 }, v);
      expect(p.aspect.source).toBe('lens');
      expect(p.aspect.lensIgnored ?? null).toBeNull();
    }
    expect(run(m1, { kind: 'width', mm: 210 }, 26).sizeMm!.h).toBeCloseTo(297, 6);
    // no usable perspective either: the assumed lens, with the weak-lens warning and this photo's range
    const tilt = pinholeScene({ imgW: IMG.w, imgH: IMG.h, f: lensPx(26), W: 210, H: 297, ax: 30 * deg, ay: 0, az: 5 * deg, dist: 500 });
    const weak = run(tilt, { kind: 'width', mm: 210 }, 4);
    expect(weak.aspect.source).toBe('assumedLens');
    expect(weak.aspect.lensIgnored).toBe(4);
    expect(weak.warnings).toEqual(expect.arrayContaining(['aspectEstimated', 'aspectWeak']));
  });

  it('M2: without lens data the other side is this photo’s own 13–130 mm range, and it holds the truth (2×/3× tele too)', () => {
    for (const lens of [13, 26, 35, 52, 77, 120]) {
      const s = pinholeScene({ imgW: IMG.w, imgH: IMG.h, f: lensPx(lens), W: 210, H: 297, ax: 30 * deg, ay: 0, az: 5 * deg, dist: (lensPx(lens) * 297) / (0.55 * IMG.h), tx: 10, ty: -10 });
      const p = run(s, { kind: 'width', mm: 210 });
      expect(p.aspect.source).toBe('assumedLens');
      expect(p.warnings).toContain('aspectWeak');
      const r = p.estimatedRangeMm!;
      expect(r.min).toBeLessThanOrEqual(297 * (1 + 1e-9));
      expect(r.max).toBeGreaterThanOrEqual(297 * (1 - 1e-9));
      expect(r.min).toBeLessThanOrEqual(p.sizeMm!.h);
      expect(r.max).toBeGreaterThanOrEqual(p.sizeMm!.h);
      // height typed: the range is for the width
      const h = run(s, { kind: 'height', mm: 297 }).estimatedRangeMm!;
      expect(h.min).toBeLessThanOrEqual(210 * (1 + 1e-9));
      expect(h.max).toBeGreaterThanOrEqual(210 * (1 - 1e-9));
    }
    // a 77 mm (3×) photo: the old sentence promised "up to 10 %", the estimate is 11.8 % off; the range says so
    const tele = pinholeScene({ imgW: IMG.w, imgH: IMG.h, f: lensPx(77), W: 210, H: 297, ax: 30 * deg, ay: 0, az: 5 * deg, dist: (lensPx(77) * 297) / (0.7 * IMG.h), tx: 40, ty: -30 });
    const p = run(tele, { kind: 'width', mm: 210 });
    expect(Math.abs(p.sizeMm!.h / 297 - 1)).toBeGreaterThan(0.1);
    // EXIF present or both sides typed: no range
    expect(run(tele, { kind: 'width', mm: 210 }, 77).estimatedRangeMm).toBeNull();
    expect(run(tele, { kind: 'rect', wMm: 210, hMm: 297 }).estimatedRangeMm).toBeNull();
  });

  it('S2: no `aspectWeak` when no plausible lens moves the estimate by more than 0.5 %', () => {
    // straight-on but for a hair of perspective (one corner 0.6 px off): no quad focal, no foreshortening worth a lens
    const q = [
      { x: 1000, y: 500 },
      { x: 3100, y: 500 },
      { x: 3100.6, y: 2600 },
      { x: 1000, y: 2600 },
    ];
    const p = run({ corners: q }, { kind: 'width', mm: 200 });
    expect(p.aspect.source).toBe('assumedLens');
    expect(p.aspect.lensRange!.hi / p.aspect.lensRange!.lo - 1).toBeLessThan(0.01);
    expect(p.warnings).toEqual(['aspectEstimated']);
    expect(p.sizeMm!.h).toBeCloseTo(200, 0);
    // a real tilt needs the lens: said
    const tilt = pinholeScene({ imgW: IMG.w, imgH: IMG.h, f: lensPx(26), W: 210, H: 297, ax: 30 * deg, ay: 0, az: 5 * deg, dist: 500 });
    expect(run(tilt, { kind: 'width', mm: 210 }).warnings).toContain('aspectWeak');
    expect(run(tilt, { kind: 'none' }).warnings).toContain('aspectWeak');
  });

  it('S3: near a 45° roll the typed width binds to whichever edge is "top"; the plan says which (44° vs 46°)', () => {
    const card = (rollDeg: number) => pinholeScene({ imgW: IMG.w, imgH: IMG.h, f: lensPx(26), W: 180, H: 100, ax: 0, ay: 0, az: rollDeg * deg, dist: 300 });
    const len = (e: readonly [{ x: number; y: number }, { x: number; y: number }]) => Math.hypot(e[1].x - e[0].x, e[1].y - e[0].y);
    const at44 = run(card(44), { kind: 'width', mm: 180 });
    const at46 = run(card(46), { kind: 'width', mm: 180 });
    // 44°: the long edge is "top" → 180 × 100; 46°: the short edge is "top" → the typed 180 lands on it → 180 × 324
    expect(at44.sizeMm!.w).toBe(180);
    expect(at44.sizeMm!.h).toBeCloseTo(100, 6);
    expect(at46.sizeMm!.h).toBeCloseTo(324, 6);
    expect(at44.rollDeg).toBeCloseTo(44, 6);
    expect(at46.rollDeg).toBeCloseTo(-44, 6);
    // the edges the typed width belongs to: the long ones at 44°, the short ones at 46° — what the corner screen draws
    const w44 = at44.typedEdges.width!;
    const w46 = at46.typedEdges.width!;
    expect(at44.typedEdges.height).toBeNull();
    expect(len(w44[0]) / len(at44.typedEdges.width![1])).toBeCloseTo(1, 6);
    expect(len(w44[0]) / len(w46[0])).toBeCloseTo(1.8, 6);
    expect(w44[0]).toEqual([at44.quad[0], at44.quad[1]]);
    expect(w44[1]).toEqual([at44.quad[3], at44.quad[2]]);
    // typing the height instead (the swap the screen can offer) gives the intended card at 46°
    const swapped = run(card(46), { kind: 'height', mm: 180 });
    expect(swapped.sizeMm!.w).toBeCloseTo(100, 6);
    expect(swapped.typedEdges.height).toEqual([
      [swapped.quad[0], swapped.quad[3]],
      [swapped.quad[1], swapped.quad[2]],
    ]);
    const both = run(card(44), { kind: 'rect', wMm: 180, hMm: 100 });
    expect(both.typedEdges.width && both.typedEdges.height).toBeTruthy();
    expect(run(card(44), { kind: 'none' }).typedEdges).toEqual({ width: null, height: null });
  });
});
