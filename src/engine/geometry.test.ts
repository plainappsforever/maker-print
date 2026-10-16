import { prng } from '../../test/prng';

import {
  apply,
  compose,
  cosSinDeg,
  invert,
  isAtDesignedSize,
  isValidCrop,
  lockedResize,
  objectCorners,
  objectMatrix,
  rotatedBounds,
  rotatedSize,
  sizeAtScale,
  sourceToSheet,
  type Placement,
} from './geometry';

const r = prng(33);
function randomPlacement(): Placement {
  return {
    x: r.range(-200, 800),
    y: r.range(-200, 800),
    w: r.range(0.1, 600),
    h: r.range(0.1, 600),
    rotationDeg: r.bool(0.4) ? r.pick([0, 90, 180, 270, -90]) : r.range(-720, 720),
    mirrorX: r.bool(0.3),
    mirrorY: r.bool(0.3),
  };
}

describe('rotation', () => {
  it('90° steps are exact', () => {
    expect(cosSinDeg(90)).toEqual([0, 1]);
    expect(cosSinDeg(-90)).toEqual([0, -1]);
    expect(cosSinDeg(450)).toEqual([0, 1]);
    expect(rotatedSize(50, 30, 90)).toEqual({ w: 30, h: 50 });
    expect(rotatedSize(50, 30, 180)).toEqual({ w: 50, h: 30 });
  });

  it('positive angles turn clockwise on the y-down page', () => {
    const [tl] = objectCorners({ x: 0, y: 0, w: 20, h: 10, rotationDeg: 90, mirrorX: false, mirrorY: false });
    // top-left corner of a 20×10 box turned 90° clockwise about (10,5) lands top-right of the turned box
    expect(tl).toEqual({ x: 15, y: -5 });
  });

  it('property (2 000 placements): bounds contain all corners and touch them; centre is kept', () => {
    for (let i = 0; i < 2000; i++) {
      const p = randomPlacement();
      const b = rotatedBounds(p);
      const cs = objectCorners(p);
      const xs = cs.map((c) => c.x);
      const ys = cs.map((c) => c.y);
      expect(Math.min(...xs)).toBeCloseTo(b.x, 6);
      expect(Math.max(...xs)).toBeCloseTo(b.x + b.w, 6);
      expect(Math.min(...ys)).toBeCloseTo(b.y, 6);
      expect(Math.max(...ys)).toBeCloseTo(b.y + b.h, 6);
      expect(b.x + b.w / 2).toBeCloseTo(p.x + p.w / 2, 9);
    }
  });

  it('property: rotating by θ then by −θ and by +360° is the identity; mirror twice is the identity', () => {
    for (let i = 0; i < 500; i++) {
      const p = randomPlacement();
      const q = { x: r.range(0, p.w), y: r.range(0, p.h) };
      const a = apply(objectMatrix(p), q);
      const b = apply(objectMatrix({ ...p, rotationDeg: p.rotationDeg + 360 }), q);
      expect(a.x).toBeCloseTo(b.x, 6);
      expect(a.y).toBeCloseTo(b.y, 6);
      const back = apply(invert(objectMatrix(p)), a);
      expect(back.x).toBeCloseTo(q.x, 6);
      expect(back.y).toBeCloseTo(q.y, 6);
    }
    const m = compose([-1, 0, 0, 1, 0, 0], [-1, 0, 0, 1, 0, 0]);
    expect(m).toEqual([1, 0, 0, 1, 0, 0]);
  });
});

describe('source mapping', () => {
  it('crop + fill maps the visible source corners onto the box corners', () => {
    const p: Placement = { x: 10, y: 20, w: 100, h: 50, rotationDeg: 0, mirrorX: false, mirrorY: false };
    const natural = { w: 400, h: 300 };
    const crop = { l: 0.25, t: 0.1, r: 0.25, b: 0.4 }; // visible 200 × 150
    const m = sourceToSheet(p, natural, crop, 'fill');
    expect(apply(m, { x: 100, y: 30 })).toEqual({ x: 10, y: 20 });
    expect(apply(m, { x: 300, y: 180 })).toEqual({ x: 110, y: 70 });
  });

  it('fit centres the source with one scale', () => {
    const p: Placement = { x: 0, y: 0, w: 100, h: 100, rotationDeg: 0, mirrorX: false, mirrorY: false };
    const m = sourceToSheet(p, { w: 200, h: 100 }, undefined, 'fit');
    expect(apply(m, { x: 0, y: 0 })).toEqual({ x: 0, y: 25 });
    expect(apply(m, { x: 200, y: 100 })).toEqual({ x: 100, y: 75 });
  });

  it('designed size badge: within ±0.0001 is 100 %', () => {
    expect(isAtDesignedSize({ scaleX: 1.00009, scaleY: 0.99991 })).toBe(true);
    expect(isAtDesignedSize({ scaleX: 1.00011, scaleY: 1 })).toBe(false);
  });

  it('crop validity, Scale % and locked resize', () => {
    expect(isValidCrop({ l: 0.5, t: 0, r: 0.49, b: 0 })).toBe(true);
    expect(isValidCrop({ l: 0.5, t: 0, r: 0.5, b: 0 })).toBe(false);
    expect(isValidCrop({ l: -0.1, t: 0, r: 0, b: 0 })).toBe(false);
    expect(sizeAtScale({ w: 200, h: 100 }, { l: 0.5, t: 0, r: 0, b: 0 }, 50)).toEqual({ w: 50, h: 50 });
    expect(lockedResize({ w: 40, h: 30 }, 'w', 300)).toEqual({ w: 300, h: 225 });
  });
});
