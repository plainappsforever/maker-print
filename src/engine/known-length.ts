// Known-length scaling (SPEC §8.8, W10). Pure.
import { contentMap, NO_CROP, visibleSize, type Crop, type FitMode, type Point } from './geometry';

export type KnownLengthInput = {
  box: { x: number; y: number; w: number; h: number };
  /** Natural source size in its own units (image px, PDF/SVG mm) */
  natural: { w: number; h: number };
  crop?: Crop | null;
  fit?: FitMode;
  /** Two points in natural source coordinates */
  p1: Point;
  p2: Point;
  /** The real length between them, mm */
  lengthMm: number;
};

/** Current distance between the two points on paper, mm (uses the object's actual content scales). */
export function measuredMm(i: Pick<KnownLengthInput, 'box' | 'natural' | 'crop' | 'fit' | 'p1' | 'p2'>): number {
  const map = contentMap(i.box, visibleSize(i.natural.w, i.natural.h, i.crop ?? NO_CROP), i.fit ?? 'fill');
  const dx = (i.p2.x - i.p1.x) * map.scaleX;
  const dy = (i.p2.y - i.p1.y) * map.scaleY;
  if (dy === 0) return Math.abs(dx);
  if (dx === 0) return Math.abs(dy);
  return Math.hypot(dx, dy);
}

/**
 * New scale factor k = L / |P1−P2|mm, applied with the aspect locked about the box centre (rotation and mirror
 * unchanged). Returns null when the points coincide or the length is not positive.
 */
export function scaleFromKnownLength(i: KnownLengthInput): { factor: number; x: number; y: number; w: number; h: number } | null {
  const d = measuredMm(i);
  if (!(d > 0) || !(i.lengthMm > 0) || !Number.isFinite(i.lengthMm)) return null;
  const factor = i.lengthMm / d;
  const w = i.box.w * factor;
  const h = i.box.h * factor;
  const cx = i.box.x + i.box.w / 2;
  const cy = i.box.y + i.box.h / 2;
  return { factor, x: cx - w / 2, y: cy - h / 2, w, h };
}
