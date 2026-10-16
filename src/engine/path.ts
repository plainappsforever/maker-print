// Vector content shared by the planner, the PDF writer and previews. Pure.
// Paths are SVG-style `d` strings in mm with absolute M/L/C/Z only, written with full double precision (String(n)
// round-trips exactly), so the writer reproduces every coordinate bit for bit.
import { apply, type Affine, type Point, type Rect } from './geometry';

export type Rgb = readonly [r: number, g: number, b: number];
export const BLACK: Rgb = [0, 0, 0];
export const MARK_GREY: Rgb = [0.35, 0.35, 0.35];
/** Check bar and labels: 40 % grey ink (D18) — light enough not to dominate. */
export const LIGHT_GREY: Rgb = [0.6, 0.6, 0.6];
export const FAINT_GREY: Rgb = [0.85, 0.85, 0.85];

export type PathItem = { d: string; stroke: Rgb | null; fill: Rgb | null; widthMm: number; cap?: 'butt' | 'round' };
/** One line of text; x/y = left end of the baseline (y down), already aligned by the engine. */
export type TextItem = { x: number; y: number; sizeMm: number; text: string; colour: Rgb };
/** Content in some local frame (mm, y down). */
export type Content = { paths: PathItem[]; texts: TextItem[] };
export const emptyContent = (): Content => ({ paths: [], texts: [] });

export type Seg = { c: 'M' | 'L'; p: Point } | { c: 'C'; p1: Point; p2: Point; p: Point } | { c: 'Z' };

const n = (v: number) => String(v === 0 ? 0 : v); // no "-0"

export class PathBuilder {
  private parts: string[] = [];
  move(x: number, y: number) {
    this.parts.push(`M${n(x)} ${n(y)}`);
    return this;
  }
  line(x: number, y: number) {
    this.parts.push(`L${n(x)} ${n(y)}`);
    return this;
  }
  curve(x1: number, y1: number, x2: number, y2: number, x: number, y: number) {
    this.parts.push(`C${n(x1)} ${n(y1)} ${n(x2)} ${n(y2)} ${n(x)} ${n(y)}`);
    return this;
  }
  close() {
    this.parts.push('Z');
    return this;
  }
  segment(x0: number, y0: number, x1: number, y1: number) {
    return this.move(x0, y0).line(x1, y1);
  }
  rect(x: number, y: number, w: number, h: number) {
    return this.move(x, y).line(x + w, y).line(x + w, y + h).line(x, y + h).close();
  }
  /** Ellipse as 8 cubic Béziers of 45° each — radial error ≤ 4.3e-6 × radius (0.0004 mm at r = 100 mm). */
  ellipse(cx: number, cy: number, rx: number, ry: number) {
    const k = (4 / 3) * Math.tan(Math.PI / 16);
    const pts = Array.from({ length: 9 }, (_, i) => {
      const a = (i * Math.PI) / 4;
      // exact values at multiples of 90° keep the extreme points exact
      const c = i % 2 === 0 ? [1, 0, -1, 0, 1][i / 2] : Math.cos(a);
      const s = i % 2 === 0 ? [0, 1, 0, -1, 0][i / 2] : Math.sin(a);
      return { c, s };
    });
    this.move(cx + rx * pts[0].c, cy + ry * pts[0].s);
    for (let i = 0; i < 8; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      this.curve(
        cx + rx * (a.c - k * a.s),
        cy + ry * (a.s + k * a.c),
        cx + rx * (b.c + k * b.s),
        cy + ry * (b.s - k * b.c),
        cx + rx * b.c,
        cy + ry * b.s
      );
    }
    return this.close();
  }
  get empty() {
    return this.parts.length === 0;
  }
  toString() {
    return this.parts.join(' ');
  }
}

export const path = () => new PathBuilder();

/** Parses the subset written by PathBuilder. */
export function parsePath(d: string): Seg[] {
  const segs: Seg[] = [];
  const re = /([MLCZ])([^MLCZ]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) {
    const nums = m[2].trim() ? m[2].trim().split(/\s+/).map(Number) : [];
    if (nums.some((v) => !Number.isFinite(v))) throw new Error(`Bad path data: ${m[0]}`);
    const c = m[1];
    if (c === 'Z') segs.push({ c: 'Z' });
    else if (c === 'C') segs.push({ c: 'C', p1: { x: nums[0], y: nums[1] }, p2: { x: nums[2], y: nums[3] }, p: { x: nums[4], y: nums[5] } });
    else segs.push({ c: c as 'M' | 'L', p: { x: nums[0], y: nums[1] } });
  }
  return segs;
}

/** Path data mapped through an affine map (exact for lines; Béziers stay Béziers under affine maps). */
export function transformPath(d: string, m: Affine): string {
  const b = path();
  for (const s of parsePath(d)) {
    if (s.c === 'Z') b.close();
    else if (s.c === 'C') {
      const p1 = apply(m, s.p1);
      const p2 = apply(m, s.p2);
      const p = apply(m, s.p);
      b.curve(p1.x, p1.y, p2.x, p2.y, p.x, p.y);
    } else {
      const p = apply(m, s.p);
      if (s.c === 'M') b.move(p.x, p.y);
      else b.line(p.x, p.y);
    }
  }
  return b.toString();
}

/** Bounds of the control polygon (contains the curve), without stroke. */
export function pathBounds(d: string): Rect | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const s of parsePath(d)) {
    const pts = s.c === 'Z' ? [] : s.c === 'C' ? [s.p1, s.p2, s.p] : [s.p];
    for (const p of pts) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Ink bounds of content: paths inflated by half their stroke; text from ascender to descender. */
export function contentBounds(c: Content, textWidth: (t: TextItem) => number): Rect | null {
  const rects: Rect[] = [];
  for (const p of c.paths) {
    const b = pathBounds(p.d);
    if (!b) continue;
    const hw = p.stroke ? p.widthMm / 2 : 0;
    rects.push({ x: b.x - hw, y: b.y - hw, w: b.w + 2 * hw, h: b.h + 2 * hw });
  }
  for (const t of c.texts) rects.push({ x: t.x, y: t.y - 0.718 * t.sizeMm, w: textWidth(t), h: (0.718 + 0.207) * t.sizeMm });
  return unionRects(rects);
}

export function unionRects(rs: Rect[]): Rect | null {
  if (rs.length === 0) return null;
  // a loop, not Math.min(...big): pages with tens of thousands of ops (P3.5 finding 2)
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rs) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function intersectRects(a: Rect, b: Rect): Rect | null {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** Bounds of a rectangle after an affine map. */
export function mapRect(m: Affine, r: Rect): Rect {
  const pts = [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ].map((p) => apply(m, p));
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}
