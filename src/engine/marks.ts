// Marks (SPEC §8.5, §8.6; D40–D42): trim/crop marks outside a grid, registration marks, tile trim lines, page-label
// boxes and arrows. All in mm, y down. Pure. Nothing here may reach into the printer margins (D12): every mark is
// computed against a safe rectangle, with its stroke counted.
import type { Rect } from './geometry';
import { MARK_GREY, path, type Content, type PathItem } from './path';
import { textWidthMm } from './text-metrics';

export const MARK_STROKE_MM = 0.2;
export const MARK_GAP_MM = 1;
export const MARK_MAX_MM = 5;
export const MARK_MIN_MM = 2;
const EPS = 1e-9;

export type Side = 'top' | 'bottom' | 'left' | 'right';
export type MarkSegment = { x0: number; y0: number; x1: number; y1: number };
/** `dropped`: single marks left out on sides that do print (their boundary lies outside the safe area, D41) — reported. */
export type EdgeMarks = { bySide: Record<Side, MarkSegment[]>; omitted: Side[]; segments: MarkSegment[]; dropped: number };

/** Sorted, de-duplicated boundaries (within 1e-9 mm). */
export function uniqueSorted(values: number[]): number[] {
  const out: number[] = [];
  for (const v of [...values].sort((a, b) => a - b)) if (out.length === 0 || v - out[out.length - 1] > EPS) out.push(v);
  return out;
}

/**
 * Marks outside a grid G (SPEC §8.5 trim marks; D42 crop marks): at each x boundary a vertical mark above and below
 * G, at each y boundary a horizontal mark left and right of G; 1 mm gap; length min(5 mm, room) where room is the
 * distance to the safe-area edge minus the gap and half the stroke; a side whose length would be < 2 mm is omitted
 * (reported), as is a side whose marks would not lie inside the safe area; a single mark whose boundary line is not
 * inside the safe area is left out.
 */
export function edgeMarks(G: Rect, xBoundaries: number[], yBoundaries: number[], safe: Rect, stroke = MARK_STROKE_MM): EdgeMarks {
  const hs = stroke / 2;
  const s0 = { x: safe.x, y: safe.y };
  const s1 = { x: safe.x + safe.w, y: safe.y + safe.h };
  const g1 = { x: G.x + G.w, y: G.y + G.h };
  const sides: { side: Side; room: number; bounds: number[]; lo: number; hi: number; edge: number; dir: 1 | -1; vertical: boolean }[] = [
    { side: 'top', room: G.y - s0.y, bounds: xBoundaries, lo: s0.x, hi: s1.x, edge: G.y, dir: 1, vertical: true },
    { side: 'bottom', room: s1.y - g1.y, bounds: xBoundaries, lo: s0.x, hi: s1.x, edge: g1.y, dir: -1, vertical: true },
    { side: 'left', room: G.x - s0.x, bounds: yBoundaries, lo: s0.y, hi: s1.y, edge: G.x, dir: 1, vertical: false },
    { side: 'right', room: s1.x - g1.x, bounds: yBoundaries, lo: s0.y, hi: s1.y, edge: g1.x, dir: -1, vertical: false },
  ];
  const bySide = { top: [], bottom: [], left: [], right: [] } as Record<Side, MarkSegment[]>;
  const omitted: Side[] = [];
  let dropped = 0;
  for (const s of sides) {
    const length = Math.min(MARK_MAX_MM, s.room - MARK_GAP_MM - hs);
    if (length < MARK_MIN_MM - EPS) {
      omitted.push(s.side);
      continue;
    }
    const a0 = s.edge - s.dir * MARK_GAP_MM;
    const a1 = a0 - s.dir * length;
    const lo = Math.min(a0, a1);
    const hi = Math.max(a0, a1);
    // the marks' own span must lie inside the safe area too (a grid beyond the far edge has "room" but no space)
    const [spanLo, spanHi] = s.vertical ? [s0.y, s1.y] : [s0.x, s1.x];
    if (lo < spanLo + hs - EPS || hi > spanHi - hs + EPS) {
      omitted.push(s.side);
      continue;
    }
    for (const b of uniqueSorted(s.bounds)) {
      if (b < s.lo + hs - EPS || b > s.hi - hs + EPS) {
        dropped++;
        continue;
      }
      bySide[s.side].push(s.vertical ? { x0: b, y0: lo, x1: b, y1: hi } : { x0: lo, y0: b, x1: hi, y1: b });
    }
  }
  return { bySide, omitted, segments: [...bySide.top, ...bySide.bottom, ...bySide.left, ...bySide.right], dropped };
}

export function segmentsPath(segs: MarkSegment[], stroke = MARK_STROKE_MM): PathItem | null {
  if (segs.length === 0) return null;
  const b = path();
  for (const s of segs) b.segment(s.x0, s.y0, s.x1, s.y1);
  return { d: b.toString(), stroke: [0, 0, 0], fill: null, widthMm: stroke };
}

/** Registration mark (SPEC §8.6): circle Ø 6 mm + cross 8 mm, centred on (x, y). */
export const REGISTRATION_DIAMETER_MM = 6;
export const REGISTRATION_CROSS_MM = 8;
export function registrationMark(x: number, y: number): PathItem {
  const r = REGISTRATION_DIAMETER_MM / 2;
  const c = REGISTRATION_CROSS_MM / 2;
  const d = path().ellipse(x, y, r, r).segment(x - c, y, x + c, y).segment(x, y - c, x, y + c).toString();
  return { d, stroke: [0, 0, 0], fill: null, widthMm: MARK_STROKE_MM };
}
/** Half-extent of a registration mark's ink (cross arm + half stroke). */
export const REGISTRATION_EXTENT_MM = REGISTRATION_CROSS_MM / 2 + MARK_STROKE_MM / 2;

/** Thin trim line along a tile's left or top content edge, drawn just inside the content area (D40). */
export const TILE_TRIM_STROKE_MM = 0.15;

/** Page label box (SPEC §8.6, D40): "B3" plus neighbour arrows, outline + grey text, no fill (content shows through). */
export const LABEL_TEXT_MM = 3.2;
export const LABEL_PAD_MM = 1.2;
export const LABEL_ARROW_MM = 2;
export type Neighbours = { left: boolean; right: boolean; up: boolean; down: boolean };

export function labelBoxSize(label: string, k = 1): { w: number; h: number } {
  const tw = textWidthMm(label, LABEL_TEXT_MM * k);
  return { w: tw + k * (2 * LABEL_PAD_MM + 2 * (LABEL_ARROW_MM + 0.8)), h: k * (LABEL_TEXT_MM + 2 * LABEL_PAD_MM + 2 * (LABEL_ARROW_MM * 0.5 + 0.6)) };
}

/** Content of a label box with its top-left at (x, y); the whole box scales down to fit `maxW` (narrow tiles). */
export function labelBox(x: number, y: number, label: string, n: Neighbours, maxW = Infinity): Content {
  const k = Math.min(1, maxW / labelBoxSize(label).w);
  const size = labelBoxSize(label, k);
  const textMm = LABEL_TEXT_MM * k;
  const tw = textWidthMm(label, textMm);
  const cx = x + size.w / 2;
  const cy = y + size.h / 2;
  const a = LABEL_ARROW_MM * k;
  const tri = path();
  const e = 0.6 * k;
  if (n.left) tri.move(x + e, cy).line(x + e + a, cy - a / 2).line(x + e + a, cy + a / 2).close();
  if (n.right) tri.move(x + size.w - e, cy).line(x + size.w - e - a, cy - a / 2).line(x + size.w - e - a, cy + a / 2).close();
  if (n.up) tri.move(cx, y + e).line(cx - a / 2, y + e + a / 2).line(cx + a / 2, y + e + a / 2).close();
  if (n.down) tri.move(cx, y + size.h - e).line(cx - a / 2, y + size.h - e - a / 2).line(cx + a / 2, y + size.h - e - a / 2).close();
  const paths: PathItem[] = [{ d: path().rect(x + 0.1, y + 0.1, size.w - 0.2, size.h - 0.2).toString(), stroke: MARK_GREY, fill: null, widthMm: 0.2 }];
  if (!tri.empty) paths.push({ d: tri.toString(), stroke: null, fill: MARK_GREY, widthMm: 0 });
  return { paths, texts: [{ x: cx - tw / 2, y: cy + textMm * 0.359, sizeMm: textMm, text: label, colour: MARK_GREY }] };
}
