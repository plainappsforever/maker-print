// How far an estimated side is off when the user's corners are a few pixels off (simulated pinhole photos of known
// rectangles; same author as the engine, so this is a tuning check, not independent evidence — L27 rule 4).
import { pinholeScene } from '../../test/fakes/capture';
import { prng } from '../../test/prng';
import { FULL_FRAME_DIAGONAL_MM } from './homography';
import { lensMatters, planScan } from './scan';

const IMG = { w: 4032, h: 3024 };
const diag = Math.hypot(IMG.w, IMG.h);

/** Relative error of the estimated height (width typed) by aspect source, over `n` photos with ±noise px corners. */
function errors(noise: number, withExif: boolean, n = 1000) {
  const r = prng(9);
  const out: Record<string, number[]> = {};
  let done = 0;
  while (done < n) {
    const W = r.range(80, 300);
    const H = r.range(80, 300);
    const f = r.range(0.6, 1.0) * diag;
    const s = pinholeScene({ imgW: IMG.w, imgH: IMG.h, f, W, H, ax: r.range(-0.6, 0.6), ay: r.range(-0.6, 0.6), az: r.range(-0.2, 0.2), dist: (f * Math.max(W, H)) / (0.7 * IMG.h) });
    const c = s.corners.map((p) => ({ x: p.x + r.range(-noise, noise), y: p.y + r.range(-noise, noise) }));
    const res = planScan({ corners: c, sourcePx: IMG, known: { kind: 'width', mm: W }, ppiTarget: 300, focal35mm: withExif ? (f / diag) * FULL_FRAME_DIAGONAL_MM : null });
    if (!res.ok) continue;
    done++;
    expect(res.plan.warnings).toContain('aspectEstimated');
    expect(res.plan.warnings.includes('aspectWeak')).toBe(lensMatters(res.plan.aspect));
    const err = Math.abs(res.plan.sizeMm!.h / H - 1);
    (out[res.plan.aspect.source] ??= []).push(err);
    if (res.plan.aspect.source === 'assumedLens') {
      // the photo's own range (13–130 mm lenses): how far outside it the truth lies (0 = inside), and the quiet cases
      const rg = res.plan.estimatedRangeMm!;
      (out.outsideRange ??= []).push(Math.max(0, rg.min / H - 1, 1 - rg.max / H));
      if (!res.plan.warnings.includes('aspectWeak')) (out.assumedQuiet ??= []).push(err);
    }
  }
  const q = (v: number[], p: number) => [...v].sort((a, b) => a - b)[Math.min(v.length - 1, Math.floor(v.length * p))];
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { n: v.length, p90: q(v, 0.9), max: q(v, 1) }]));
}

describe('estimated side under corner error', () => {
  it('EXIF focal length present (camera photos): ±3 px corners → 90 % within 0.6 %, all within 1.5 %', () => {
    const e = errors(3, true);
    expect(Object.keys(e)).toEqual(['lens']);
    expect(e.lens.p90).toBeLessThan(0.006);
    expect(e.lens.max).toBeLessThan(0.015);
  });

  it('no EXIF: the quad’s own focal length when well defined (±3 px → 90 % within 0.7 %); else an assumed lens, labelled', () => {
    const e = errors(3, false);
    expect(e.perspective.n).toBeGreaterThan(700);
    expect(e.perspective.p90).toBeLessThan(0.007);
    expect(e.perspective.max).toBeLessThan(0.025);
    // the assumed 26 mm lens is the weak case (these photos were taken with 26–43 mm lenses): up to ~11 %
    expect(e.assumedLens.n).toBeGreaterThan(0);
    expect(e.assumedLens.max).toBeLessThan(0.13);
    // review M2/S2: the truth lies inside the photo's own 13–130 mm range up to the corner error (measured: ≤ 0.21 %
    // outside at ± 3 px), and a photo without `aspectWeak` (the lens does not matter) is as good as the quad's estimate
    expect(e.outsideRange.n).toBe(e.assumedLens.n);
    expect(e.outsideRange.max).toBeLessThan(0.005);
    expect(e.assumedQuiet.max).toBeLessThan(0.01);
  });

  it('± 6 px corners: the assumed-lens range still holds the truth within 1 % (review M2)', () => {
    const e = errors(6, false, 500);
    expect(e.outsideRange.max).toBeLessThan(0.01);
  });

  it('exact corners give the exact shape for both well-defined sources', () => {
    const a = errors(0, true, 300);
    const b = errors(0, false, 300);
    expect(a.lens.max).toBeLessThan(1e-6);
    expect(b.perspective.max).toBeLessThan(1e-6);
  });
});
