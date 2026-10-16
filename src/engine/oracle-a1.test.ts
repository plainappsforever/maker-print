// The builder's own A1 oracle (scripts/oracle/a1_oracle.py): Heckbert closed-form homographies, the documented corner
// rules re-implemented, pinhole photos of known rectangles. Same author as the engine (L27 rule 4): the independent,
// blind oracle from a separate agent is still owed (docs/V15_LOG.md).
import oracle from '../../test/fixtures/engine/oracle-a1.json';
import { applyH, estimateAspect, homography, quadIssue, type Pt, type Quad } from './homography';

const pt = ([x, y]: number[]): Pt => ({ x, y });
const img = { w: oracle.img[0], h: oracle.img[1] };

describe('oracle A1 (builder-written, not blind)', () => {
  it(`homography: ${oracle.homographies.length} quad pairs, every sample within 0.01 px`, () => {
    let worst = 0;
    for (const c of oracle.homographies) {
      const H = homography(c.src.map(pt), c.dst.map(pt));
      expect(H).not.toBeNull();
      for (const s of c.samples) {
        const m = applyH(H!, pt(s.src))!;
        worst = Math.max(worst, Math.hypot(m.x - s.dst[0], m.y - s.dst[1]));
      }
    }
    expect(worst).toBeLessThan(0.01);
  });

  it(`corner classes: ${oracle.quads.length} quads (valid, concave, bow-tie, mirrored, small, collinear, outside, coincident)`, () => {
    const wrong = oracle.quads.filter((c) => quadIssue(c.q.map(pt), img) !== c.issue);
    expect(wrong).toEqual([]);
  });

  it(`true aspect: ${oracle.aspects.length} pinhole photos — exact from the quad when it defines the focal length, exact with the EXIF lens always`, () => {
    let fromQuad = 0;
    for (const c of oracle.aspects) {
      const q = c.q.map(pt) as Quad;
      const e = estimateAspect(q, img)!;
      if (e.source === 'perspective') {
        fromQuad++;
        expect(Math.abs(e.ratio / c.ratio - 1)).toBeLessThan(1e-5);
      } else expect(e.source).toBe('assumedLens');
      const lens = estimateAspect(q, img, c.focal35mm)!;
      expect(lens.source).toBe('lens');
      expect(Math.abs(lens.ratio / c.ratio - 1)).toBeLessThan(1e-5);
    }
    expect(fromQuad).toBeGreaterThan(oracle.aspects.length * 0.6);
  });
});
