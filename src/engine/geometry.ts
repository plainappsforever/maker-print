// Geometry (SPEC §8.2, §8.3, D33, D34). Pure — no React/Expo imports.
// Coordinates: mm, origin at the sheet's top-left, y DOWN. Positive rotation = clockwise as seen on the page.
// An object is drawn in its own local frame [0,w]×[0,h]; mirror flips within the box, then the box rotates about its
// centre. Sources (image/PDF page/SVG) have a natural size; a crop selects the visible part; `fill` stretches the
// visible part to the box (UIKit scaleToFill), `fit` scales it uniformly and centres it (scaleAspectFit).

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };
/** Affine map (x, y) → (a·x + c·y + e, b·x + d·y + f) — the PDF/SVG matrix convention. */
export type Affine = readonly [a: number, b: number, c: number, d: number, e: number, f: number];
export type Crop = { l: number; t: number; r: number; b: number };
export type FitMode = 'fill' | 'fit';
export type Placement = {
  x: number;
  y: number;
  w: number;
  h: number;
  rotationDeg: number;
  mirrorX: boolean;
  mirrorY: boolean;
};

export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];
export const NO_CROP: Crop = { l: 0, t: 0, r: 0, b: 0 };
/** Scale tolerance for "Scale 100 %" (SPEC §8.2). */
export const DESIGNED_SIZE_TOLERANCE = 0.0001;

/** m1 ∘ m2: apply m2 first, then m1. */
export function compose(m1: Affine, m2: Affine): Affine {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

/** Composes left to right as written: chain(A, B, C) applies C first (same as A ∘ B ∘ C). */
export function chain(...ms: Affine[]): Affine {
  return ms.reduce((acc, m) => compose(acc, m), IDENTITY);
}

export function apply(m: Affine, p: Point): Point {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

export function invert(m: Affine): Affine {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-15) throw new Error('Affine map is not invertible');
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

export const translate = (tx: number, ty: number): Affine => [1, 0, 0, 1, tx, ty];
export const scale = (sx: number, sy: number = sx): Affine => [sx, 0, 0, sy, 0, 0];

/** Angle in [0, 360). */
export function normaliseDeg(deg: number): number {
  const d = deg % 360;
  return d < 0 ? d + 360 : d === 0 ? 0 : d; // also turns -0 into 0
}

/** cos/sin of an angle in degrees — exact (0, ±1) for multiples of 90°, so the 90° buttons give exact boxes. */
export function cosSinDeg(deg: number): [number, number] {
  const d = normaliseDeg(deg);
  if (d === 0) return [1, 0];
  if (d === 90) return [0, 1];
  if (d === 180) return [-1, 0];
  if (d === 270) return [0, -1];
  const r = (d * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r)];
}

/** Rotation about the origin, clockwise on the y-down page. */
export function rotate(deg: number): Affine {
  const [c, s] = cosSinDeg(deg);
  return [c, s, -s, c, 0, 0];
}

/** Rotated bounding size (SPEC §8.3): w' = |w cos θ| + |h sin θ|, h' = |w sin θ| + |h cos θ|. */
export function rotatedSize(w: number, h: number, deg: number): { w: number; h: number } {
  const [c, s] = cosSinDeg(deg);
  return { w: Math.abs(w * c) + Math.abs(h * s), h: Math.abs(w * s) + Math.abs(h * c) };
}

/** Axis-aligned bounds of a placed object (rotation and mirror are about the box centre, so the centre stays). */
export function rotatedBounds(p: Pick<Placement, 'x' | 'y' | 'w' | 'h' | 'rotationDeg'>): Rect {
  const size = rotatedSize(p.w, p.h, p.rotationDeg);
  const cx = p.x + p.w / 2;
  const cy = p.y + p.h / 2;
  return { x: cx - size.w / 2, y: cy - size.h / 2, w: size.w, h: size.h };
}

/** Object-local [0,w]×[0,h] → sheet: mirror within the box, then rotate about the box centre. */
export function objectMatrix(p: Placement): Affine {
  const hw = p.w / 2;
  const hh = p.h / 2;
  return chain(
    translate(p.x + hw, p.y + hh),
    rotate(p.rotationDeg),
    scale(p.mirrorX ? -1 : 1, p.mirrorY ? -1 : 1),
    translate(-hw, -hh)
  );
}

/** The four corners on the sheet, in local order top-left, top-right, bottom-right, bottom-left. */
export function objectCorners(p: Placement): Point[] {
  const m = objectMatrix(p);
  return [
    { x: 0, y: 0 },
    { x: p.w, y: 0 },
    { x: p.w, y: p.h },
    { x: 0, y: p.h },
  ].map((q) => apply(m, q));
}

export function isValidCrop(c: Crop): boolean {
  const parts = [c.l, c.t, c.r, c.b];
  return parts.every((v) => Number.isFinite(v) && v >= 0 && v < 1) && c.l + c.r < 1 && c.t + c.b < 1;
}

/** Visible natural size after crop (SPEC §8.2): vw = nw(1−l−r), vh = nh(1−t−b). */
export function visibleSize(nw: number, nh: number, crop: Crop = NO_CROP): { w: number; h: number } {
  return { w: nw * (1 - crop.l - crop.r), h: nh * (1 - crop.t - crop.b) };
}

export type ContentMap = { scaleX: number; scaleY: number; offsetX: number; offsetY: number };

/**
 * How the visible source region sits in a w×h box. `fill`: sx = w/vw, sy = h/vh (SPEC §8.2; equal when the aspect
 * is locked). `fit`: one scale min(w/vw, h/vh), centred in the box.
 */
export function contentMap(box: { w: number; h: number }, visible: { w: number; h: number }, mode: FitMode = 'fill'): ContentMap {
  const sx = box.w / visible.w;
  const sy = box.h / visible.h;
  if (mode === 'fill') return { scaleX: sx, scaleY: sy, offsetX: 0, offsetY: 0 };
  const s = Math.min(sx, sy);
  return { scaleX: s, scaleY: s, offsetX: (box.w - visible.w * s) / 2, offsetY: (box.h - visible.h * s) / 2 };
}

/** Natural source coordinates → object-local coordinates (crop removed, content map applied). */
export function sourceToLocal(natural: { w: number; h: number }, crop: Crop, box: { w: number; h: number }, mode: FitMode = 'fill'): Affine {
  const map = contentMap(box, visibleSize(natural.w, natural.h, crop), mode);
  return chain(
    translate(map.offsetX, map.offsetY),
    scale(map.scaleX, map.scaleY),
    translate(-crop.l * natural.w, -crop.t * natural.h)
  );
}

/** Natural source coordinates → sheet coordinates. Its inverse maps a tap on the sheet back into the source. */
export function sourceToSheet(placement: Placement, natural: { w: number; h: number }, crop: Crop = NO_CROP, mode: FitMode = 'fill'): Affine {
  return compose(objectMatrix(placement), sourceToLocal(natural, crop, placement, mode));
}

/** "Scale 100 %" test for vector objects (SPEC §8.2): both scales within ±0.0001 of 1. */
export function isAtDesignedSize(map: Pick<ContentMap, 'scaleX' | 'scaleY'>): boolean {
  return Math.abs(map.scaleX - 1) <= DESIGNED_SIZE_TOLERANCE && Math.abs(map.scaleY - 1) <= DESIGNED_SIZE_TOLERANCE;
}

/** Box size that shows the visible source at `scalePercent` (aspect locked): the inspector's Scale % field. */
export function sizeAtScale(natural: { w: number; h: number }, crop: Crop, scalePercent: number): { w: number; h: number } {
  const v = visibleSize(natural.w, natural.h, crop);
  return { w: (v.w * scalePercent) / 100, h: (v.h * scalePercent) / 100 };
}

/** Resize keeping the aspect ratio of the current box (lock aspect): returns the other side. */
export function lockedResize(box: { w: number; h: number }, side: 'w' | 'h', value: number): { w: number; h: number } {
  return side === 'w' ? { w: value, h: (box.h * value) / box.w } : { w: (box.w * value) / box.h, h: value };
}

export function rectsIntersect(a: Rect, b: Rect, eps = 0): boolean {
  return a.x < b.x + b.w - eps && b.x < a.x + a.w - eps && a.y < b.y + b.h - eps && b.y < a.y + a.h - eps;
}

export function rectContains(outer: Rect, inner: Rect, eps = 1e-6): boolean {
  return (
    inner.x >= outer.x - eps &&
    inner.y >= outer.y - eps &&
    inner.x + inner.w <= outer.x + outer.w + eps &&
    inner.y + inner.h <= outer.y + outer.h + eps
  );
}
