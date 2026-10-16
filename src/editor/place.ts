// Where imported files and new objects go (SPEC §9.1 "Open file … placed at its true size; sheet = paper if it fits,
// else a big sheet"; D67). Pure.
import { matchPaper, paperSize, safeArea, type Margins, type PaperKey } from '@/engine/paper';
import { MAX_SHEET_MM } from '@/engine/tiles';

export type Size = { w: number; h: number };
export type SheetChoice = { widthMm: number; heightMm: number; paperKey: PaperKey | null };
export type Placed = { sheet: SheetChoice; box: { x: number; y: number; w: number; h: number } };
const EPS = 1e-9;

const fits = (s: Size, area: Size | null) => !!area && s.w <= area.w + EPS && s.h <= area.h + EPS;

/**
 * Sheet for a file opened as a new project, with the object at 100 %:
 * a page that IS a paper size → that paper (1:1); fits the output paper's safe area (portrait, else landscape) →
 * the paper, object centred; else a big sheet exactly the object's size (tiled at print; capped at 3 m).
 */
export function sheetForImport(size: Size, outputPaper: PaperKey, margins: Margins): Placed {
  const match = matchPaper(size.w, size.h);
  if (match) {
    const p = paperSize(match.key, match.orientation);
    return { sheet: { widthMm: p.w, heightMm: p.h, paperKey: match.key }, box: { x: 0, y: 0, w: size.w, h: size.h } };
  }
  for (const o of ['portrait', 'landscape'] as const) {
    const p = paperSize(outputPaper, o);
    if (fits(size, safeArea(p, margins))) {
      return { sheet: { widthMm: p.w, heightMm: p.h, paperKey: outputPaper }, box: { x: (p.w - size.w) / 2, y: (p.h - size.h) / 2, w: size.w, h: size.h } };
    }
  }
  const w = Math.min(size.w, MAX_SHEET_MM);
  const h = Math.min(size.h, MAX_SHEET_MM);
  return { sheet: { widthMm: w, heightMm: h, paperKey: null }, box: { x: 0, y: 0, w: size.w, h: size.h } };
}

/** An object added to an existing sheet: centred on the sheet at the given size (may be larger than the sheet). */
export function centreOn(sheet: { widthMm: number; heightMm: number }, size: Size): { x: number; y: number; w: number; h: number } {
  return { x: (sheet.widthMm - size.w) / 2, y: (sheet.heightMm - size.h) / 2, w: size.w, h: size.h };
}

/**
 * Start size of a photo (photos have no true size): the declared print size when the file states a real density (D48),
 * else the size at the PPI target (sharp), scaled down to fit the safe area — the user then types the size they want.
 */
export function photoStartSize(px: Size, declaredMm: Size | null, ppiTarget: number, fitIn: Size | null): Size {
  let s = declaredMm ?? { w: (px.w / ppiTarget) * 25.4, h: (px.h / ppiTarget) * 25.4 };
  if (!declaredMm && fitIn && !fits(s, fitIn)) {
    const k = Math.min(fitIn.w / s.w, fitIn.h / s.h);
    s = { w: s.w * k, h: s.h * k };
  }
  return s;
}

// ------------------------------------------------------------------------------------------------ batch (V15 X06)
export type Box = { x: number; y: number; w: number; h: number };
export type BatchItem = { px: Size; declaredMm: Size | null };
export type BatchSheet = {
  /** 'target' = the sheet the user is on ('add') or the new project's first sheet ('new'); null = a new sheet */
  use: 'target' | null;
  /** The sheet's size (for 'target' in 'add' mode: unchanged) */
  sheet: SheetChoice;
  /** `index` = position in the picked list */
  boxes: (Box & { index: number })[];
};
export type BatchTarget = { mode: 'new' } | { mode: 'add'; sheet: { widthMm: number; heightMm: number } };

/** Gap between photos placed together, mm. */
export const BATCH_GAP_MM = 5;

/**
 * Places several photos at once (V15_PLAN X06): each at the size a single import gives it (declared print size, else
 * the PPI target scaled down to the paper's safe area), in pick order, in rows inside the safe area, a new paper-sized
 * sheet when one is full. A photo whose declared size does not fit the safe area gets its own sheet as in a single
 * import. Each sheet's block is centred on the sheet and kept inside the safe area, so one photo lands exactly where a
 * single import puts it. Never overlaps, never loses or reorders a photo.
 */
export function planBatch(items: readonly BatchItem[], o: { paperKey: PaperKey; margins: Margins; ppiTarget: number; target: BatchTarget; gapMm?: number }): BatchSheet[] {
  const gap = o.gapMm ?? BATCH_GAP_MM;
  const paper = paperSize(o.paperKey);
  const fitIn = safeArea(paper, o.margins);
  const paperSheet: SheetChoice = { widthMm: paper.w, heightMm: paper.h, paperKey: o.paperKey };
  const sheets: BatchSheet[] = [];
  type Open = { s: BatchSheet; area: Box; x: number; y: number; rowH: number };
  let open: Open | null = null;

  const areaOf = (sheet: { widthMm: number; heightMm: number }): Box => safeArea({ w: sheet.widthMm, h: sheet.heightMm }, o.margins) ?? { x: 0, y: 0, w: sheet.widthMm, h: sheet.heightMm };
  const startSheet = (): Open => {
    const first = sheets.length === 0;
    const sheet = first && o.target.mode === 'add' ? { widthMm: o.target.sheet.widthMm, heightMm: o.target.sheet.heightMm, paperKey: null } : paperSheet;
    const s: BatchSheet = { use: first ? 'target' : null, sheet, boxes: [] };
    sheets.push(s);
    const area = areaOf(sheet);
    return { s, area, x: area.x, y: area.y, rowH: 0 };
  };
  const finish = (op: Open | null) => {
    if (!op || op.s.boxes.length === 0) return;
    // centre the block on the sheet, then keep it inside the safe area
    const minX = Math.min(...op.s.boxes.map((b) => b.x));
    const minY = Math.min(...op.s.boxes.map((b) => b.y));
    const maxX = Math.max(...op.s.boxes.map((b) => b.x + b.w));
    const maxY = Math.max(...op.s.boxes.map((b) => b.y + b.h));
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    const dx = clamp((op.s.sheet.widthMm - (maxX - minX)) / 2, op.area.x, op.area.x + op.area.w - (maxX - minX)) - minX;
    const dy = clamp((op.s.sheet.heightMm - (maxY - minY)) / 2, op.area.y, op.area.y + op.area.h - (maxY - minY)) - minY;
    for (const b of op.s.boxes) {
      b.x += dx;
      b.y += dy;
    }
  };

  const fitsArea = (op: Open, size: Size) => size.w <= op.area.w + EPS && size.h <= op.area.h + EPS;
  /** Next free spot in the open sheet's rows, or null when the sheet is full. */
  const spot = (op: Open, size: Size): { x: number; y: number; newRow: boolean } | null => {
    if (op.x + size.w <= op.area.x + op.area.w + EPS && op.y + size.h <= op.area.y + op.area.h + EPS) return { x: op.x, y: op.y, newRow: false };
    const y = op.y + op.rowH + gap;
    if (op.rowH > 0 && y + size.h <= op.area.y + op.area.h + EPS) return { x: op.area.x, y, newRow: true };
    return null;
  };
  const put = (op: Open, size: Size, index: number, at: { x: number; y: number; newRow: boolean }) => {
    if (at.newRow) op.rowH = 0;
    op.s.boxes.push({ x: at.x, y: at.y, w: size.w, h: size.h, index });
    op.x = at.x + size.w + gap;
    op.y = at.y;
    op.rowH = Math.max(op.rowH, size.h);
  };

  items.forEach((it, index) => {
    const size = photoStartSize(it.px, it.declaredMm, o.ppiTarget, fitIn);
    if (sheets.length === 0) open = startSheet();
    const op = open as Open | null;
    if (op && fitsArea(op, size)) {
      const at = spot(op, size);
      if (at) return put(op, size, index, at);
    } else if (op && op.s.use === 'target' && op.s.boxes.length === 0) {
      // the first photo does not fit the sheet's safe area: exactly what a single import does with it
      if (o.target.mode === 'new') {
        const placed = sheetForImport(size, o.paperKey, o.margins);
        op.s.sheet = placed.sheet;
        op.s.boxes.push({ ...placed.box, index });
      } else op.s.boxes.push({ ...centreOn(op.s.sheet, size), index });
      open = null;
      return;
    }
    finish(op);
    open = null;
    if (fits(size, fitIn)) {
      const fresh = startSheet();
      open = fresh;
      return put(fresh, size, index, { x: fresh.area.x, y: fresh.area.y, newRow: false });
    }
    // declared size larger than the paper's safe area: its own sheet (paper 1:1, or a big sheet), as a single import
    const placed = sheetForImport(size, o.paperKey, o.margins);
    sheets.push({ use: null, sheet: placed.sheet, boxes: [{ ...placed.box, index }] });
  });
  finish(open);
  return sheets;
}
