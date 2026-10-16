import { pinholeScene, squareToQuad } from '../../test/fakes/capture';
import { prng } from '../../test/prng';
import { applyH, estimateAspect, FULL_FRAME_DIAGONAL_MM, homography, invert3, mul3, orderCorners, quadIssue, signedArea, type Pt, type Quad } from './homography';

const IMG = { w: 4032, h: 3024 };
const rect = (w: number, h: number): Quad => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: h },
  { x: 0, y: h },
];

/** A random convex quad well inside the image (corners jittered around an inset rectangle). */
function randomQuad(r: ReturnType<typeof prng>, img = IMG): Quad {
  for (;;) {
    const j = () => r.range(-0.12, 0.12);
    const q: Quad = [
      { x: (0.2 + j()) * img.w, y: (0.2 + j()) * img.h },
      { x: (0.8 + j()) * img.w, y: (0.2 + j()) * img.h },
      { x: (0.8 + j()) * img.w, y: (0.8 + j()) * img.h },
      { x: (0.2 + j()) * img.w, y: (0.8 + j()) * img.h },
    ];
    if (quadIssue(q, img) === null) return q;
  }
}

describe('homography', () => {
  it('maps the four pairs exactly and other points like an independent closed form (1 000 random quads)', () => {
    const r = prng(1501);
    let worst = 0;
    for (let n = 0; n < 1000; n++) {
      const q = randomQuad(r);
      const outW = r.int(200, 4000);
      const outH = r.int(200, 4000);
      const H = homography(q, rect(outW, outH));
      expect(H).not.toBeNull();
      const toQuad = squareToQuad(q); // unit square → quad (Heckbert), so output (u·W, v·H) ↔ quad point
      for (let k = 0; k < 20; k++) {
        const u = r.next();
        const v = r.next();
        const w = toQuad[6] * u + toQuad[7] * v + toQuad[8];
        const src = { x: (toQuad[0] * u + toQuad[1] * v + toQuad[2]) / w, y: (toQuad[3] * u + toQuad[4] * v + toQuad[5]) / w };
        const m = applyH(H!, src)!;
        worst = Math.max(worst, Math.hypot(m.x - u * outW, m.y - v * outH));
      }
      // round trip through the inverse
      const inv = invert3(H!)!;
      for (const p of q) {
        const back = applyH(inv, applyH(H!, p)!)!;
        worst = Math.max(worst, Math.hypot(back.x - p.x, back.y - p.y));
      }
    }
    expect(worst).toBeLessThan(0.01);
  });

  it('identity for equal quads, and H · H⁻¹ = I', () => {
    const q = rect(100, 50);
    const H = homography(q, q)!;
    expect(H.map((v) => Math.round(v * 1e9) / 1e9)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const H2 = homography(randomQuad(prng(3)), rect(300, 200))!;
    const I = mul3(H2, invert3(H2)!);
    I.forEach((v, i) => expect(v).toBeCloseTo([1, 0, 0, 0, 1, 0, 0, 0, 1][i], 9));
  });

  it('refuses degenerate input: collinear, coincident, non-finite, wrong count', () => {
    const line: Pt[] = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 0, y: 5 },
    ];
    expect(homography(line, rect(10, 10))).toBeNull();
    expect(homography(rect(10, 10), line)).toBeNull();
    expect(homography([...rect(10, 10).slice(0, 3), { x: 0, y: 0 }], rect(10, 10))).toBeNull();
    expect(homography([{ x: NaN, y: 0 }, ...rect(10, 10).slice(1)], rect(10, 10))).toBeNull();
    expect(homography(rect(10, 10).slice(0, 3), rect(10, 10).slice(0, 3))).toBeNull();
    expect(invert3([1, 2, 3, 2, 4, 6, 0, 0, 1])).toBeNull();
  });
});

describe('orderCorners', () => {
  it('any of the 24 orders of a convex quad → TL, TR, BR, BL', () => {
    const q: Quad = [
      { x: 110, y: 90 },
      { x: 905, y: 140 },
      { x: 980, y: 700 },
      { x: 60, y: 760 },
    ];
    const perms = (a: number[]): number[][] => (a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p])));
    for (const p of perms([0, 1, 2, 3])) expect(orderCorners(p.map((i) => q[i]))).toEqual(q);
  });

  it('a bow-tie (two handles swapped) becomes the simple quad; ordered quads are clockwise on screen', () => {
    const r = prng(77);
    for (let n = 0; n < 500; n++) {
      const q = randomQuad(r);
      const swapped = [q[0], q[2], q[1], q[3]];
      expect(quadIssue(swapped, IMG)).toBe('selfIntersecting');
      const o = orderCorners(swapped)!;
      expect(o).toEqual(q);
      expect(signedArea(o)).toBeGreaterThan(0);
    }
    expect(orderCorners([{ x: 0, y: 0 }])).toBeNull();
  });
});

describe('quadIssue', () => {
  const img = { w: 1000, h: 800 };
  const ok: Quad = [
    { x: 100, y: 100 },
    { x: 900, y: 120 },
    { x: 880, y: 700 },
    { x: 120, y: 690 },
  ];
  it.each([
    ['ok', ok, null],
    ['corner at the very edge (inside tolerance)', [{ x: -0.4, y: 0 }, ok[1], ok[2], ok[3]], null],
    ['outside', [{ x: -5, y: 100 }, ok[1], ok[2], ok[3]], 'outside'],
    ['NaN', [{ x: NaN, y: 1 }, ok[1], ok[2], ok[3]], 'notFinite'],
    ['three points', ok.slice(0, 3), 'notFinite'],
    ['coincident corners', [ok[0], { x: 100.5, y: 100.2 }, ok[2], ok[3]], 'degenerate'],
    ['collinear corner (180°)', [ok[0], { x: 500, y: 100 }, { x: 900, y: 100 }, ok[3]], 'degenerate'],
    ['bow-tie', [ok[0], ok[2], ok[1], ok[3]], 'selfIntersecting'],
    ['mirrored (counter-clockwise)', [ok[1], ok[0], ok[3], ok[2]], 'mirrored'],
    ['concave (dart)', [ok[0], ok[1], { x: 500, y: 300 }, ok[3]], 'concave'],
    ['too small (9 % of the photo)', [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 240 }, { x: 0, y: 240 }], 'tooSmall'],
    ['exactly 10 %', [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 200 }, { x: 0, y: 200 }], null],
  ] as [string, Pt[], string | null][])('%s', (_name, q, expected) => {
    expect(quadIssue(q, img)).toBe(expected);
  });
});

describe('estimateAspect (pinhole camera, true shape known by construction)', () => {
  const diag = Math.hypot(IMG.w, IMG.h);

  it('tilted about both axes: the focal length and the true ratio come from the quad', () => {
    const r = prng(2026);
    let n = 0;
    let worst = 0;
    while (n < 300) {
      const W = r.range(50, 400);
      const H = r.range(50, 400);
      const f = r.range(0.45, 1.6) * diag;
      const s = pinholeScene({ imgW: IMG.w, imgH: IMG.h, f, W, H, ax: r.range(-0.6, 0.6), ay: r.range(-0.6, 0.6), az: r.range(-0.3, 0.3), dist: f * Math.max(W, H) / (0.6 * IMG.h), tx: r.range(-20, 20), ty: r.range(-20, 20) });
      if (quadIssue(s.corners, IMG) !== null) continue;
      const e = estimateAspect(s.corners, IMG)!;
      if (e.source !== 'perspective') continue; // nearly-parallel draws fall back to the lens (tested below)
      n++;
      worst = Math.max(worst, Math.abs(e.ratio / (W / H) - 1));
      expect(Math.abs(e.focalPx! / f - 1)).toBeLessThan(1e-6);
    }
    expect(worst).toBeLessThan(1e-7);
  });

  it('tilted about one axis only: needs the lens; EXIF focal gives the exact ratio, an assumed 26 mm lens is labelled', () => {
    const f = (26 / FULL_FRAME_DIAGONAL_MM) * diag; // the phone lens the estimate assumes
    const s = pinholeScene({ imgW: IMG.w, imgH: IMG.h, f, W: 210, H: 297, ax: 0.7, ay: 0, az: 0, dist: 500 });
    expect(quadIssue(s.corners, IMG)).toBeNull();
    const assumed = estimateAspect(s.corners, IMG)!;
    expect(assumed.source).toBe('assumedLens');
    expect(assumed.ratio).toBeCloseTo(210 / 297, 9);
    const f2 = 1.4 * diag;
    const s2 = pinholeScene({ imgW: IMG.w, imgH: IMG.h, f: f2, W: 210, H: 297, ax: 0, ay: 0.5, az: 0, dist: 1300 });
    const lens = estimateAspect(s2.corners, IMG, (f2 / diag) * FULL_FRAME_DIAGONAL_MM)!;
    expect(lens.source).toBe('lens');
    expect(lens.ratio).toBeCloseTo(210 / 297, 9);
    // the assumed lens on a photo taken with another lens is off — which is why the planner says "estimated"
    expect(Math.abs(estimateAspect(s2.corners, IMG)!.ratio / (210 / 297) - 1)).toBeGreaterThan(0.01);
  });

  it('straight-on photo (parallel edges): ratio of the edges', () => {
    const e = estimateAspect(
      [
        { x: 1000, y: 500 },
        { x: 3100, y: 500 },
        { x: 3100, y: 2000 },
        { x: 1000, y: 2000 },
      ],
      IMG
    )!;
    expect(e.source).toBe('parallel');
    expect(e.ratio).toBeCloseTo(2100 / 1500, 12);
  });
});
