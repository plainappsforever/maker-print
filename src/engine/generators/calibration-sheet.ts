// Calibration sheet (D18, D45): bar A (horizontal) and bar B (vertical) of the largest of 200/150/100/50 mm that
// fits the safe area with 12 mm extra inset, a 100 mm square, a 1 in square, a bank-card outline, a 6 in ruler with
// 1/16 in ticks and the instructions. Everything inside the safe area; items that do not fit a small paper are
// left out and listed. Page coordinates (portrait paper), mm, y down. Pure.
import { CALIBRATION_BARS, calibrationBar, CALIBRATION_INSET_MM } from '../calibration';
import { translate, type Rect } from '../geometry';
import { getPaper, paperSize, safeArea, type Margins, type PaperKey } from '../paper';
import { BLACK, path, transformPath, type Content, type PathItem, type TextItem } from '../path';
import { wrapText } from '../text-metrics';
import { MM_PER_IN } from '../units';
import { printLength, textAt, type GenContext } from './context';
import { rulerContent } from './ruler';

export const CARD_MM = { w: 85.6, h: 53.98, r: 3.18 }; // ISO/IEC 7810 ID-1
const GAP = 6;
const TEXT_MM = 3;
const BAR_TICK_MM = 4;

export type CalibrationItem = 'title' | 'barA' | 'barB' | 'square100' | 'squareIn' | 'card' | 'ruler6' | 'instructions';
export type CalibrationSheet = {
  page: { w: number; h: number };
  safe: Rect;
  content: Content;
  /** Bar A: horizontal centre line from x0 to x1 at y (end lines are exactly `length` apart) */
  barA: { length: number; x0: number; x1: number; y: number } | null;
  barB: { length: number; x: number; y0: number; y1: number } | null;
  items: { item: CalibrationItem; rect: Rect }[];
  omitted: CalibrationItem[];
};

function shift(c: Content, dx: number, dy: number): Content {
  const m = translate(dx, dy);
  return { paths: c.paths.map((p) => ({ ...p, d: transformPath(p.d, m) })), texts: c.texts.map((t) => ({ ...t, x: t.x + dx, y: t.y + dy })) };
}

function roundedRect(x: number, y: number, w: number, h: number, r: number): string {
  const k = 0.5522847498307936 * r;
  return path()
    .move(x + r, y)
    .line(x + w - r, y)
    .curve(x + w - r + k, y, x + w, y + r - k, x + w, y + r)
    .line(x + w, y + h - r)
    .curve(x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h)
    .line(x + r, y + h)
    .curve(x + r - k, y + h, x, y + h - r + k, x, y + h - r)
    .line(x, y + r)
    .curve(x, y + r - k, x + r - k, y, x + r, y)
    .close()
    .toString();
}

export function calibrationSheet(paperKey: PaperKey, margins: Margins, ctx: GenContext, pageNo = 1, pageCount = 1): CalibrationSheet {
  const page = paperSize(paperKey, 'portrait');
  const S = safeArea(page, margins);
  if (!S) throw new Error('Margins leave no safe area');
  const paths: PathItem[] = [];
  const texts: TextItem[] = [];
  const items: { item: CalibrationItem; rect: Rect }[] = [];
  const omitted: CalibrationItem[] = [];
  const line = (d: string, w = 0.2) => paths.push({ d, stroke: BLACK, fill: null, widthMm: w });

  // title
  const title = ctx.t('cal.title', { paper: getPaper(paperKey).label }) + (pageCount > 1 ? ` · ${ctx.t('cal.page', { n: pageNo, total: pageCount })}` : '');
  const titleSize = Math.min(3.5, S.w / 40);
  texts.push(textAt(title, S.x, S.y + titleSize, titleSize, 'left', [S.x, S.x + S.w]));
  items.push({ item: 'title', rect: { x: S.x, y: S.y, w: S.w, h: titleSize * 1.3 } });

  // bar A (horizontal)
  const yA = S.y + 14;
  const Lx = calibrationBar(S.w);
  let barA: CalibrationSheet['barA'] = null;
  if (Lx !== null) {
    const x0 = S.x + (S.w - Lx) / 2;
    const b = path().segment(x0, yA, x0 + Lx, yA).segment(x0, yA - BAR_TICK_MM, x0, yA + BAR_TICK_MM).segment(x0 + Lx, yA - BAR_TICK_MM, x0 + Lx, yA + BAR_TICK_MM);
    for (let k = 10; k < Lx; k += 10) b.segment(x0 + k, yA, x0 + k, yA + 2);
    line(b.toString(), 0.25);
    texts.push(textAt(ctx.t('cal.barA', { length: printLength(Lx, { ...ctx, unit: 'mm' }) }), x0, yA - BAR_TICK_MM - 1, TEXT_MM));
    barA = { length: Lx, x0, x1: x0 + Lx, y: yA };
    items.push({ item: 'barA', rect: { x: x0 - 0.2, y: yA - BAR_TICK_MM - 1 - TEXT_MM, w: Lx + 0.4, h: 2 * BAR_TICK_MM + 1 + TEXT_MM + 0.2 } });
  } else omitted.push('barA');

  // bar B (vertical), left column, centred vertically below bar A
  const xB = S.x + CALIBRATION_INSET_MM;
  const top = yA + BAR_TICK_MM + 6;
  // P3.5 finding 9: the largest bar that fits the safe height AND the space left below bar A (A6: 100 → 50 mm),
  // so every paper gets a y measurement
  const roomB = S.y + S.h - CALIBRATION_INSET_MM - top;
  const maxB = calibrationBar(S.h);
  const Ly = maxB === null ? null : (CALIBRATION_BARS.find((L) => L <= maxB && L <= roomB + 1e-9) ?? null);
  let barB: CalibrationSheet['barB'] = null;
  if (Ly !== null) {
    const y0 = Math.max(S.y + (S.h - Ly) / 2, top);
    const b = path().segment(xB, y0, xB, y0 + Ly).segment(xB - BAR_TICK_MM, y0, xB + BAR_TICK_MM, y0).segment(xB - BAR_TICK_MM, y0 + Ly, xB + BAR_TICK_MM, y0 + Ly);
    for (let k = 10; k < Ly; k += 10) b.segment(xB, y0 + k, xB + 2, y0 + k);
    line(b.toString(), 0.25);
    const label = textAt(ctx.t('cal.barB', { length: printLength(Ly, { ...ctx, unit: 'mm' }) }), xB + BAR_TICK_MM + 1, y0 + TEXT_MM + 1, TEXT_MM);
    texts.push(label);
    barB = { length: Ly, x: xB, y0, y1: y0 + Ly };
    items.push({ item: 'barB', rect: { x: xB - BAR_TICK_MM - 0.2, y: y0 - 0.2, w: 2 * BAR_TICK_MM + 0.4, h: Ly + 0.4 } });
    items.push({ item: 'barB', rect: { x: label.x, y: y0, w: 0, h: TEXT_MM + 1.5 } });
  } else omitted.push('barB');

  // other items: shelf packing in the region right of bar B and below bar A
  const left = S.x + 34;
  const R = { x: left, y: top, w: S.x + S.w - 4 - left, h: S.y + S.h - 4 - top };
  const instructions = [ctx.t('cal.step1'), ctx.t('cal.step2'), ctx.t('cal.step3')].flatMap((s) => wrapText(s, TEXT_MM, Math.max(R.w, 10)));
  const rulerIn = rulerContent(6 * MM_PER_IN, 15, { unit: 'in' }, ctx);
  const candidates: { item: CalibrationItem; w: number; h: number; draw: (x: number, y: number) => void }[] = [
    {
      item: 'square100', w: 100, h: 100, draw: (x, y) => {
        line(path().rect(x, y, 100, 100).toString());
        texts.push(textAt(ctx.t('cal.square', { size: printLength(100, { ...ctx, unit: 'mm' }) }), x + 50, y + 50, TEXT_MM, 'centre'));
      },
    },
    {
      item: 'squareIn', w: MM_PER_IN, h: MM_PER_IN, draw: (x, y) => {
        line(path().rect(x, y, MM_PER_IN, MM_PER_IN).toString());
        texts.push(textAt(ctx.t('cal.square', { size: '1 in' }), x + MM_PER_IN / 2, y + MM_PER_IN / 2 + 1, 2.6, 'centre'));
      },
    },
    {
      item: 'card', w: CARD_MM.w, h: CARD_MM.h, draw: (x, y) => {
        line(roundedRect(x, y, CARD_MM.w, CARD_MM.h, CARD_MM.r));
        for (const [i, s] of wrapText(ctx.t('cal.card'), TEXT_MM, CARD_MM.w - 8).entries()) texts.push(textAt(s, x + CARD_MM.w / 2, y + CARD_MM.h / 2 + i * 3.8, TEXT_MM, 'centre'));
      },
    },
    {
      item: 'ruler6', w: 6 * MM_PER_IN, h: 15, draw: (x, y) => {
        const c = shift(rulerIn, x, y);
        paths.push(...c.paths);
        texts.push(...c.texts);
      },
    },
    {
      item: 'instructions', w: R.w, h: instructions.length * TEXT_MM * 1.3, draw: (x, y) => {
        instructions.forEach((s, i) => texts.push(textAt(s, x, y + TEXT_MM + i * TEXT_MM * 1.3, TEXT_MM)));
      },
    },
  ];
  let cx = R.x;
  let cy = R.y;
  let rowH = 0;
  for (const c of candidates) {
    if (c.w > R.w + 1e-9) {
      omitted.push(c.item);
      continue;
    }
    if (cx > R.x && cx + c.w > R.x + R.w + 1e-9) {
      cy += rowH + GAP;
      cx = R.x;
      rowH = 0;
    }
    if (cy + c.h > R.y + R.h + 1e-9) {
      omitted.push(c.item);
      continue;
    }
    c.draw(cx, cy);
    items.push({ item: c.item, rect: { x: cx - 0.2, y: cy - 0.2, w: c.w + 0.4, h: c.h + 0.4 } });
    cx += c.w + GAP;
    rowH = Math.max(rowH, c.h);
  }
  return { page, safe: S, content: { paths, texts }, barA, barB, items, omitted };
}
