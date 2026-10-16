// Copies, fill sheet and trim marks (SPEC §8.5, W6; D41). Pure.
import { rotatedSize, type Placement, type Rect } from './geometry';
import { edgeMarks, type EdgeMarks } from './marks';

/** Same shape as the `objects.repeat` JSON column (src/db/guards.ts). */
export type RepeatSpec = { cols: number; rows: number; gap_x_mm: number; gap_y_mm: number; trim_marks: boolean };
export type Copy = { col: number; row: number; x: number; y: number };
const EPS = 1e-9;

/** Copy (i, j) is offset (i(w'+gx), j(h'+gy)) with w', h' the rotated size (SPEC §8.5); copy (0, 0) is the object. */
export function repeatCopies(p: Pick<Placement, 'x' | 'y' | 'w' | 'h' | 'rotationDeg'>, r: RepeatSpec | null): Copy[] {
  const cols = r?.cols ?? 1;
  const rows = r?.rows ?? 1;
  const gx = r?.gap_x_mm ?? 0;
  const gy = r?.gap_y_mm ?? 0;
  const b = rotatedSize(p.w, p.h, p.rotationDeg);
  const out: Copy[] = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) out.push({ col: i, row: j, x: p.x + i * (b.w + gx), y: p.y + j * (b.h + gy) });
  return out;
}

/** Union of the copies' rotated bounds and every copy's bound edges (the trim-mark boundaries). */
export function repeatGrid(p: Pick<Placement, 'x' | 'y' | 'w' | 'h' | 'rotationDeg'>, r: RepeatSpec | null): { bounds: Rect; xs: number[]; ys: number[] } {
  const b = rotatedSize(p.w, p.h, p.rotationDeg);
  const cols = r?.cols ?? 1;
  const rows = r?.rows ?? 1;
  const gx = r?.gap_x_mm ?? 0;
  const gy = r?.gap_y_mm ?? 0;
  const ox = p.x + (p.w - b.w) / 2;
  const oy = p.y + (p.h - b.h) / 2;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < cols; i++) xs.push(ox + i * (b.w + gx), ox + i * (b.w + gx) + b.w);
  for (let j = 0; j < rows; j++) ys.push(oy + j * (b.h + gy), oy + j * (b.h + gy) + b.h);
  return { bounds: { x: ox, y: oy, w: cols * b.w + (cols - 1) * gx, h: rows * b.h + (rows - 1) * gy }, xs, ys };
}

/**
 * Fill sheet (SPEC §8.5): cols = ⌊(SAw + gx)/(w' + gx)⌋, rows likewise; the grid is centred in the safe area — or, with
 * `top` (the check bar is on, v1.1 D84), centred across and put at the top, so the room left over collects in one strip
 * at the bottom where the check bar can go. Never fewer copies.
 * Returns the object's new box position (x, y of the unrotated box) or null when not even one copy fits.
 */
export function fillSheet(
  item: { w: number; h: number; rotationDeg: number },
  gap: { x: number; y: number },
  safe: Rect,
  align: 'centre' | 'top' = 'centre'
): { cols: number; rows: number; x: number; y: number } | null {
  const b = rotatedSize(item.w, item.h, item.rotationDeg);
  const cols = Math.floor((safe.w + gap.x) / (b.w + gap.x) + EPS);
  const rows = Math.floor((safe.h + gap.y) / (b.h + gap.y) + EPS);
  if (cols < 1 || rows < 1) return null;
  const gw = cols * b.w + (cols - 1) * gap.x;
  const gh = rows * b.h + (rows - 1) * gap.y;
  const ox = safe.x + (safe.w - gw) / 2;
  const oy = align === 'top' ? safe.y : safe.y + (safe.h - gh) / 2;
  return { cols, rows, x: ox + (b.w - item.w) / 2, y: oy + (b.h - item.h) / 2 };
}

/** Trim marks of a repeat grid against a safe rectangle (SPEC §8.5; omitted sides are reported). */
export function trimMarks(p: Pick<Placement, 'x' | 'y' | 'w' | 'h' | 'rotationDeg'>, r: RepeatSpec | null, safe: Rect): EdgeMarks {
  const g = repeatGrid(p, r);
  return edgeMarks(g.bounds, g.xs, g.ys, safe);
}
