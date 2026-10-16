// Output pages per sheet (SPEC §8.6, W3–W5; D27, D39, D40, D53). Pure.
import { objectCorners, type Affine, type Placement, type Point, type Rect } from './geometry';
import { PAPER_MATCH_MM, paperSize, type Margins, type Orientation, type PaperKey } from './paper';

export type OutputMode = 'single' | 'placed' | 'tiled';
export type OrientationChoice = Orientation | 'auto';
export type Tile = { row: number; col: number; label: string; region: Rect; visible: Rect };
export type SheetLayout = {
  mode: OutputMode;
  orientation: Orientation;
  paper: { w: number; h: number };
  /** Content area = paper minus margins, in page coordinates */
  content: Rect;
  pages: number;
  cols: number;
  rows: number;
  step: { x: number; y: number };
  overlap: number;
};

const EPS = 1e-9;
export const MAX_SHEET_MM = 3000; // D27
export const CONFIRM_PAGES = 60; // SPEC §12
export const MAX_PAGES = 400;
export const MIN_CONTENT_MM = 20;

/** Smallest n ≥ 1 tiles of `content` with step `content − o` that cover `length` (SPEC §8.6, closed form). */
export function tileCount(length: number, content: number, overlap: number): number {
  if (length <= content + EPS) return 1;
  return Math.max(1, Math.ceil((length - overlap) / (content - overlap) - EPS));
}

/** sheet = paper (± 0.01 mm) → single; fits on the paper → placed (centred); else tiled. */
export function outputMode(sheet: { w: number; h: number }, paper: { w: number; h: number }): OutputMode {
  if (Math.abs(sheet.w - paper.w) <= PAPER_MATCH_MM + EPS && Math.abs(sheet.h - paper.h) <= PAPER_MATCH_MM + EPS) return 'single';
  if (sheet.w <= paper.w + EPS && sheet.h <= paper.h + EPS) return 'placed';
  return 'tiled';
}

/**
 * D53: every output page is the paper in PORTRAIT; a landscape layout is turned a quarter turn counter-clockwise
 * onto it (its top edge lies along the paper's left edge — CUPS/IPP "landscape", orientation-requested 4). Maps
 * landscape-frame mm (W = paper height wide) to portrait page mm: X = y, Y = W − x.
 */
export function landscapeToPortrait(paperPortrait: { w: number; h: number }): Affine {
  return [0, -1, 1, 0, 0, paperPortrait.h];
}

/**
 * Margins are always the PORTRAIT paper's (learned margins included, D17). In the landscape frame of D53 the frame's
 * top is the paper's left, its right the paper's top, its bottom the paper's right, its left the paper's bottom.
 */
export function marginsInFrame(m: Margins, orientation: Orientation): Margins {
  return orientation === 'landscape' ? { l: m.b, t: m.l, r: m.t, b: m.r } : m;
}

/** `m` = the portrait paper's margins (D53); the layout frame is the paper in `orientation`. */
export function sheetLayout(sheet: { w: number; h: number }, paperKey: PaperKey, orientation: Orientation, margins: Margins, overlap: number): SheetLayout {
  const paper = paperSize(paperKey, orientation);
  const m = marginsInFrame(margins, orientation);
  const content = { x: m.l, y: m.t, w: paper.w - m.l - m.r, h: paper.h - m.t - m.b };
  const mode = outputMode(sheet, paper);
  const step = { x: content.w - overlap, y: content.h - overlap };
  if (mode !== 'tiled') return { mode, orientation, paper, content, pages: 1, cols: 1, rows: 1, step, overlap };
  const cols = tileCount(sheet.w, content.w, overlap);
  const rows = tileCount(sheet.h, content.h, overlap);
  return { mode, orientation, paper, content, pages: cols * rows, cols, rows, step, overlap };
}

/** Orientation `auto` picks the one with fewer pages; a tie keeps portrait (SPEC §8.6). */
export function chooseLayout(sheet: { w: number; h: number }, paperKey: PaperKey, choice: OrientationChoice, m: Margins, overlap: number): SheetLayout {
  if (choice !== 'auto') return sheetLayout(sheet, paperKey, choice, m, overlap);
  const p = sheetLayout(sheet, paperKey, 'portrait', m, overlap);
  const l = sheetLayout(sheet, paperKey, 'landscape', m, overlap);
  return l.pages < p.pages ? l : p;
}

/** Row letters A … Z, AA, AB … (bijective base 26). */
export function rowLetters(row: number): string {
  let s = '';
  let n = row + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export const tileLabel = (row: number, col: number) => `${rowLetters(row)}${col + 1}`;
/** Key in `projects.excluded_tiles`: the label on sheet 1, "n:label" on sheet n ≥ 2 (D40). */
export const tileKey = (sheetIndex: number, label: string) => (sheetIndex === 0 ? label : `${sheetIndex + 1}:${label}`);

/** Tile (r, c) shows sheet region [c·sx, c·sx+tw] × [r·sy, r·sy+th]; `visible` is that region ∩ the sheet. */
export function tiles(sheet: { w: number; h: number }, lay: SheetLayout): Tile[] {
  const out: Tile[] = [];
  for (let r = 0; r < lay.rows; r++) {
    for (let c = 0; c < lay.cols; c++) {
      const x = c * lay.step.x;
      const y = r * lay.step.y;
      const region = { x, y, w: lay.content.w, h: lay.content.h };
      const visible = { x, y, w: Math.min(lay.content.w, sheet.w - x), h: Math.min(lay.content.h, sheet.h - y) };
      out.push({ row: r, col: c, label: tileLabel(r, c), region, visible });
    }
  }
  return out;
}

/**
 * Registration mark centres in sheet coordinates (SPEC §8.6, D40): at ¼ and ¾ of every interior overlap strip,
 * centred across the strip, so both neighbours print the same mark.
 */
export function registrationPoints(sheet: { w: number; h: number }, lay: SheetLayout): Point[] {
  if (lay.mode !== 'tiled') return [];
  const { x: sx, y: sy } = lay.step;
  const o = lay.overlap;
  const pts: Point[] = [];
  for (let r = 0; r < lay.rows; r++) {
    for (let c = 0; c < lay.cols - 1; c++) {
      const x = (c + 1) * sx + o / 2;
      const y0 = r * sy;
      const y1 = Math.min(r * sy + lay.content.h, sheet.h);
      pts.push({ x, y: y0 + (y1 - y0) / 4 }, { x, y: y0 + (3 * (y1 - y0)) / 4 });
    }
  }
  for (let r = 0; r < lay.rows - 1; r++) {
    for (let c = 0; c < lay.cols; c++) {
      const y = (r + 1) * sy + o / 2;
      const x0 = c * sx;
      const x1 = Math.min(c * sx + lay.content.w, sheet.w);
      pts.push({ x: x0 + (x1 - x0) / 4, y }, { x: x0 + (3 * (x1 - x0)) / 4, y });
    }
  }
  return pts;
}

/**
 * Overlap depth of a placed object's rotated rectangle with an axis-aligned rectangle (separating-axis test):
 * > 0 when they share area, ≤ 0 when separate or only touching (D40: skip blank uses the rectangle, not its bounds).
 */
export function overlapDepth(p: Placement, rect: Rect): number {
  return polygonOverlapDepth(objectCorners(p), rect);
}

/** Same separating-axis test for any convex quadrilateral (corners in order), e.g. an object's rotated ink rectangle. */
export function polygonOverlapDepth(poly: Point[], rect: Rect): number {
  const rp = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x + rect.w, y: rect.y + rect.h },
    { x: rect.x, y: rect.y + rect.h },
  ];
  const axes: Point[] = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: poly[1].y - poly[0].y, y: -(poly[1].x - poly[0].x) },
    { x: poly[2].y - poly[1].y, y: -(poly[2].x - poly[1].x) },
  ];
  let best = Infinity;
  for (const a of axes) {
    const n = Math.hypot(a.x, a.y);
    if (n === 0) continue;
    const p1 = poly.map((q) => a.x * q.x + a.y * q.y);
    const p2 = rp.map((q) => a.x * q.x + a.y * q.y);
    best = Math.min(best, (Math.min(Math.max(...p1), Math.max(...p2)) - Math.max(Math.min(...p1), Math.min(...p2))) / n);
  }
  return best;
}

/** Margin/overlap validation (SPEC §12): content ≥ 20 mm each way; 0 ≤ overlap ≤ min(tw, th)/3 (SPEC §8.6, D40). */
export function validateOutput(paperKey: PaperKey, m: Margins, overlap: number): 'contentTooSmall' | 'overlapTooLarge' | null {
  const p = paperSize(paperKey, 'portrait');
  const minContent = Math.min(p.w - m.l - m.r, p.h - m.t - m.b, p.h - m.l - m.r, p.w - m.t - m.b);
  if ([m.l, m.t, m.r, m.b].some((v) => !(v >= 0)) || minContent < MIN_CONTENT_MM) return 'contentTooSmall';
  if (!(overlap >= 0) || overlap > minContent / 3 + EPS) return 'overlapTooLarge';
  return null;
}
