// The 100 mm check bar (SPEC §6, D18, D43): content in its own frame and the free-strip search. Pure.
import { chain, rotate, translate, type Affine, type Rect } from './geometry';
import { LIGHT_GREY, mapRect, path, type Content } from './path';
import { textWidthMm } from './text-metrics';

export const CHECK_BAR_LENGTH_MM = 100;
export const CHECK_BAR_HEIGHT_MM = 6;
const CAPTION_MM = 2.6;
const NUMBER_MM = 2;
/** Ink footprint in the bar's frame (bar [0,100]×[0,6], caption above), rounded out. */
export const CHECK_BAR_FOOTPRINT: Rect = { x: -0.5, y: -3.5, w: 101, h: 10 };
/** Free space kept between the bar and anything else. */
export const CHECK_BAR_CLEARANCE_MM = 1;

/**
 * Bar [0,100]×[0,6] mm: outline, 1 mm ticks from the top edge (1.5 mm; 2.5 mm every 5; full height every 10, so
 * the 0 and 100 ends are full-height lines exactly 100 mm apart, centre to centre), cm numbers 0–9 inside the bar,
 * caption above ("This bar must measure 100 mm", translated). 40 % grey (D18).
 */
export function checkBarContent(caption: string): Content {
  const outline = path().rect(0, 0, CHECK_BAR_LENGTH_MM, CHECK_BAR_HEIGHT_MM);
  const ticks = path();
  for (let k = 0; k <= CHECK_BAR_LENGTH_MM; k++) {
    const len = k % 10 === 0 ? CHECK_BAR_HEIGHT_MM : k % 5 === 0 ? 2.5 : 1.5;
    ticks.segment(k, 0, k, len);
  }
  const texts = [];
  for (let c = 0; c < 10; c++) texts.push({ x: c * 10 + 0.6, y: 5.4, sizeMm: NUMBER_MM, text: String(c), colour: LIGHT_GREY });
  texts.push({ x: 0, y: -1, sizeMm: CAPTION_MM, text: fitCaption(caption), colour: LIGHT_GREY });
  return {
    paths: [
      { d: outline.toString(), stroke: LIGHT_GREY, fill: null, widthMm: 0.2 },
      { d: ticks.toString(), stroke: LIGHT_GREY, fill: null, widthMm: 0.2 },
    ],
    texts,
  };
}

/** Captions longer than the bar are cut (never wider than the footprint). */
function fitCaption(caption: string): string {
  let c = caption;
  while (c.length > 1 && textWidthMm(c, CAPTION_MM) > CHECK_BAR_LENGTH_MM) c = c.slice(0, -1);
  return c;
}

/** Bar frame → page: horizontal at (x, y) = top-left of the bar; vertical turns it 90° clockwise about (x, y). */
export function checkBarMatrix(x: number, y: number, vertical: boolean): Affine {
  return vertical ? chain(translate(x, y), rotate(90)) : translate(x, y);
}

export function checkBarFootprint(x: number, y: number, vertical: boolean): Rect {
  return mapRect(checkBarMatrix(x, y, vertical), CHECK_BAR_FOOTPRINT);
}

export type CheckBarPlacement = { x: number; y: number; vertical: boolean };

/** First free stretch of `need` along [lo, hi] given blocked intervals. */
function firstGap(lo: number, hi: number, blocked: [number, number][], need: number): number | null {
  let cursor = lo;
  for (const [a, b] of [...blocked].sort((p, q) => p[0] - q[0])) {
    if (a - cursor >= need) return cursor;
    cursor = Math.max(cursor, b);
  }
  return hi - cursor >= need ? cursor : null;
}

/**
 * Free-strip search (D18, D43): bands along the safe area's bottom, top, left and right edges, in that order; in
 * each band the first stretch long enough that no obstacle (inflated by the clearance) touches. Returns where the
 * bar goes, or null (the caller warns: omitted).
 */
export function findCheckBarPlace(safe: Rect, obstacles: Rect[]): CheckBarPlacement | null {
  return findStripPlace(safe, obstacles, CHECK_BAR_FOOTPRINT, true);
}

/**
 * The same free-strip search for any footprint (`fp` relative to the item's origin): bottom, top, then (when
 * `vertical`) left and right bands of the safe area. Used for the check bar and the printed import note (D84).
 */
export function findStripPlace(safe: Rect, obstacles: Rect[], fp: Rect, vertical: boolean): CheckBarPlacement | null {
  const c = CHECK_BAR_CLEARANCE_MM;
  const inflated = obstacles.map((o) => ({ x: o.x - c, y: o.y - c, w: o.w + 2 * c, h: o.h + 2 * c }));
  const x0 = safe.x;
  const y0 = safe.y;
  const x1 = safe.x + safe.w;
  const y1 = safe.y + safe.h;
  const along = (bandLo: number, bandHi: number, horizontal: boolean): number | null => {
    const blocked: [number, number][] = [];
    for (const o of inflated) {
      const [oa, ob] = horizontal ? [o.y, o.y + o.h] : [o.x, o.x + o.w];
      if (ob <= bandLo || oa >= bandHi) continue;
      blocked.push(horizontal ? [o.x, o.x + o.w] : [o.y, o.y + o.h]);
    }
    return horizontal ? firstGap(x0, x1, blocked, fp.w) : firstGap(y0, y1, blocked, fp.w);
  };
  if (safe.h >= fp.h && safe.w >= fp.w) {
    let at = along(y1 - fp.h, y1, true);
    if (at !== null) return { x: at - fp.x, y: y1 - fp.h - fp.y, vertical: false };
    at = along(y0, y0 + fp.h, true);
    if (at !== null) return { x: at - fp.x, y: y0 - fp.y, vertical: false };
  }
  if (vertical && safe.w >= fp.h && safe.h >= fp.w) {
    // vertical bar: rotated footprint is {x: -(fp.y+fp.h), y: fp.x, w: fp.h, h: fp.w} relative to the origin
    const rx = -(fp.y + fp.h);
    const ry = fp.x;
    let at = along(x0, x0 + fp.h, false);
    if (at !== null) return { x: x0 - rx, y: at - ry, vertical: true };
    at = along(x1 - fp.h, x1, false);
    if (at !== null) return { x: x1 - fp.h - rx, y: at - ry, vertical: true };
  }
  return null;
}

/** Height of the band a check bar takes along an edge of the safe area, clearance included (11 mm). */
export const CHECK_BAR_BAND_MM = CHECK_BAR_FOOTPRINT.h + CHECK_BAR_CLEARANCE_MM;

/**
 * The largest part of `r` that stays clear of `b` (above, below, left or right of it), or `r` itself when they do not
 * meet; null when nothing is left. A page-filling pattern gives way to the check bar this way (D84).
 */
export function rectAwayFrom(r: Rect, b: Rect): Rect | null {
  if (b.x >= r.x + r.w || b.x + b.w <= r.x || b.y >= r.y + r.h || b.y + b.h <= r.y) return r;
  const parts: Rect[] = [
    { x: r.x, y: r.y, w: r.w, h: b.y - r.y },
    { x: r.x, y: b.y + b.h, w: r.w, h: r.y + r.h - (b.y + b.h) },
    { x: r.x, y: r.y, w: b.x - r.x, h: r.h },
    { x: b.x + b.w, y: r.y, w: r.x + r.w - (b.x + b.w), h: r.h },
  ].filter((q) => q.w > 0 && q.h > 0);
  if (!parts.length) return null;
  return parts.reduce((best, q) => (q.w * q.h > best.w * best.h ? q : best));
}
