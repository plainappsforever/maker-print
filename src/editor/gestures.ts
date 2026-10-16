// Editor gesture math (SPEC §9.2, D21, D33): hit tests, move with snapping, corner resize with the aspect lock,
// rotation handle. Everything in sheet mm (y down, positive rotation clockwise); the screen only enters through the
// snap threshold and the handle size. Pure.
import { apply, cosSinDeg, invert, normaliseDeg, objectMatrix, rotatedBounds, type Placement, type Point } from '@/engine/geometry';
import type { Margins } from '@/engine/paper';
import { snapCandidates, snapRect, snapThresholdMm, snapValue, type SnapCandidates, type SnapGuide } from '@/engine/snap';

export type Box = Pick<Placement, 'x' | 'y' | 'w' | 'h' | 'rotationDeg'>;
export type Corner = 'tl' | 'tr' | 'br' | 'bl';
export type SnapContext = { candidates: SnapCandidates; thresholdMm: number; gridMm?: number };

/** Smallest size a drag can make (a typed size may be smaller). */
export const MIN_SIZE_MM = 1;
/** Rotation handle: this far above the top edge, in screen points. */
export const ROTATE_HANDLE_PT = 28;
/** Handles are hit within this many screen points. */
export const HANDLE_HIT_PT = 22;
export const ROTATE_SNAP_DEG = 15;
export const ROTATE_SNAP_TOLERANCE_DEG = 4;

const SIGN: Record<Corner, [number, number]> = { tl: [-1, -1], tr: [1, -1], br: [1, 1], bl: [-1, 1] };
const placement = (b: Box): Placement => ({ ...b, mirrorX: false, mirrorY: false });

/** Point (sheet mm) inside the object's rotated box, with `padMm` tolerance. */
export function containsPoint(b: Box, p: Point, padMm = 0): boolean {
  const local = apply(invert(objectMatrix(placement(b))), p);
  return local.x >= -padMm && local.y >= -padMm && local.x <= b.w + padMm && local.y <= b.h + padMm;
}

/** Topmost object under the point; `items` bottom to top (Layers order). Hidden and locked objects are skipped. */
export function hitObject<T extends Box & { id: number; hidden?: boolean; locked?: boolean }>(items: readonly T[], p: Point, padMm = 0): T | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const o = items[i];
    if (o.hidden || o.locked) continue;
    if (containsPoint(o, p, padMm)) return o;
  }
  return null;
}

/** Corner handle positions on the sheet (rotated with the object). */
export function cornerPoints(b: Box): Record<Corner, Point> {
  const m = objectMatrix(placement(b));
  return {
    tl: apply(m, { x: 0, y: 0 }),
    tr: apply(m, { x: b.w, y: 0 }),
    br: apply(m, { x: b.w, y: b.h }),
    bl: apply(m, { x: 0, y: b.h }),
  };
}

/** Rotation handle: above the middle of the top edge, `offsetMm` away (screen-constant distance converted by the caller). */
export function rotateHandlePoint(b: Box, offsetMm: number): Point {
  return apply(objectMatrix(placement(b)), { x: b.w / 2, y: -offsetMm });
}

export type HandleHit = { kind: 'corner'; corner: Corner } | { kind: 'rotate' } | null;

/** Which handle of the selected object is under the point (sheet mm); `hitMm` = HANDLE_HIT_PT at the current zoom. */
export function hitHandle(b: Box, p: Point, hitMm: number, rotateOffsetMm: number): HandleHit {
  const near = (q: Point) => Math.hypot(q.x - p.x, q.y - p.y) <= hitMm;
  if (near(rotateHandlePoint(b, rotateOffsetMm))) return { kind: 'rotate' };
  const cs = cornerPoints(b);
  let best: Corner | null = null;
  let bestD = Infinity;
  for (const c of ['br', 'tr', 'bl', 'tl'] as const) {
    const d = Math.hypot(cs[c].x - p.x, cs[c].y - p.y);
    if (d <= hitMm && d < bestD) [best, bestD] = [c, d];
  }
  return best ? { kind: 'corner', corner: best } : null;
}

/** Drag: the start box moved by (dx, dy) mm, its visible bounds snapped (D21). */
export function moveBox(start: Box, dx: number, dy: number, snap?: SnapContext | null): { x: number; y: number; guides: SnapGuide[] } {
  const x = start.x + dx;
  const y = start.y + dy;
  if (!snap) return { x, y, guides: [] };
  const r = snapRect(rotatedBounds({ ...start, x, y }), snap.candidates, snap.thresholdMm, snap.gridMm);
  return { x: x + r.dx, y: y + r.dy, guides: r.guides };
}

/**
 * Corner resize: the opposite corner stays where it is on the sheet; the pointer (sheet mm) gives the new size in
 * the object's own (rotated) axes. With the aspect locked the size follows the projection onto the box diagonal.
 * Snapping applies to unrotated boxes only (edges of a rotated box are not lines on the sheet).
 */
export function resizeBox(start: Box, corner: Corner, pointer: Point, lockAspect: boolean, snap?: SnapContext | null): { x: number; y: number; w: number; h: number; guides: SnapGuide[] } {
  const [sx, sy] = SIGN[corner];
  const [c, s] = cosSinDeg(start.rotationDeg);
  const rot = (v: Point): Point => ({ x: c * v.x - s * v.y, y: s * v.x + c * v.y });
  const unrot = (v: Point): Point => ({ x: c * v.x + s * v.y, y: -s * v.x + c * v.y });
  const centre = { x: start.x + start.w / 2, y: start.y + start.h / 2 };
  const a = rot({ x: (-sx * start.w) / 2, y: (-sy * start.h) / 2 });
  const anchor = { x: centre.x + a.x, y: centre.y + a.y };
  const guides: SnapGuide[] = [];
  let p = pointer;
  const upright = normaliseDeg(start.rotationDeg) === 0;
  if (snap && upright) {
    const gx = snapValue(p.x, snap.candidates.x, snap.thresholdMm, snap.gridMm);
    const gy = snapValue(p.y, snap.candidates.y, snap.thresholdMm, snap.gridMm);
    p = { x: gx.value, y: gy.value };
    if (gx.guide) guides.push({ axis: 'x', at: gx.guide.at, kind: gx.guide.kind });
    if (gy.guide && !lockAspect) guides.push({ axis: 'y', at: gy.guide.at, kind: gy.guide.kind });
  }
  const v = unrot({ x: p.x - anchor.x, y: p.y - anchor.y });
  let w = Math.max(MIN_SIZE_MM, sx * v.x);
  let h = Math.max(MIN_SIZE_MM, sy * v.y);
  if (lockAspect) {
    // with a snapped x edge the width decides; otherwise the projection onto the diagonal
    const k = guides.some((g) => g.axis === 'x')
      ? Math.max(MIN_SIZE_MM / Math.min(start.w, start.h), (sx * v.x) / start.w)
      : Math.max(MIN_SIZE_MM / Math.min(start.w, start.h), (sx * v.x * start.w + sy * v.y * start.h) / (start.w * start.w + start.h * start.h));
    w = start.w * k;
    h = start.h * k;
  }
  const d = rot({ x: (sx * w) / 2, y: (sy * h) / 2 });
  const nc = { x: anchor.x + d.x, y: anchor.y + d.y };
  return { x: nc.x - w / 2, y: nc.y - h / 2, w, h, guides };
}

/** Rotation handle drag: start rotation + the pointer's turn about the box centre, snapped to 15° steps nearby. */
export function rotateBox(start: Box, from: Point, to: Point): number {
  const cx = start.x + start.w / 2;
  const cy = start.y + start.h / 2;
  const a0 = Math.atan2(from.y - cy, from.x - cx);
  const a1 = Math.atan2(to.y - cy, to.x - cx);
  const deg = normaliseDeg(start.rotationDeg + ((a1 - a0) * 180) / Math.PI);
  const snapped = Math.round(deg / ROTATE_SNAP_DEG) * ROTATE_SNAP_DEG;
  return Math.abs(snapped - deg) <= ROTATE_SNAP_TOLERANCE_DEG ? normaliseDeg(snapped) : Math.round(deg * 10) / 10;
}

/** Snap candidates for a moving object (engine D21): sheet, safe area and every other visible object's bounds. */
export function snapContextFor(
  sheet: { w: number; h: number },
  margins: Margins | undefined,
  others: readonly Box[],
  pointsPerMm: number,
  gridMm: number | undefined
): SnapContext {
  return { candidates: snapCandidates({ sheet, margins, others: others.map((o) => rotatedBounds(o)) }), thresholdMm: snapThresholdMm(pointsPerMm), gridMm };
}
