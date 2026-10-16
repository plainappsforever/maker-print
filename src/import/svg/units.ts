// SVG physical size (SPEC §8.9, W8, D47) and CSS lengths inside a drawing. Pure.
import type { Affine } from '@/engine/geometry';
import { MM_PER_IN } from '@/engine/units';

/** CSS reference pixel: 96 per inch. Absolute units inside a drawing are converted to user units with it. */
export const CSS_PX_PER_IN = 96;
/** The three answers of the "made with" question (SPEC §8.9); any positive number is allowed as custom. */
export const SVG_PPI_CHOICES = [96, 72, 90] as const;

const NUM = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?`;
const LENGTH_RE = new RegExp(String.raw`^\s*(${NUM})\s*([A-Za-z%]*)\s*$`);
const NUMBER_RE = new RegExp(`^${NUM}$`);

const UNIT_MM: Record<string, number> = { mm: 1, cm: 10, in: MM_PER_IN, pt: MM_PER_IN / 72, pc: MM_PER_IN / 6, q: 0.25 };

export type RootLength = { kind: 'abs'; mm: number } | { kind: 'px'; px: number } | { kind: 'rel' } | { kind: 'bad' };

/** A root `width`/`height`: absolute (mm), px (needs the ppi answer), relative (%/em/ex/missing) or bad. */
export function parseRootLength(text: string | null | undefined): RootLength {
  if (text === null || text === undefined) return { kind: 'rel' };
  const m = LENGTH_RE.exec(text);
  if (!m) return { kind: 'bad' };
  const v = Number(m[1]);
  const unit = m[2].toLowerCase();
  if (unit === '%' || unit === 'em' || unit === 'ex') return { kind: 'rel' };
  if (!(v > 0) || !Number.isFinite(v)) return { kind: 'bad' };
  if (unit === '' || unit === 'px') return { kind: 'px', px: v };
  const k = UNIT_MM[unit];
  return k === undefined ? { kind: 'bad' } : { kind: 'abs', mm: v * k };
}

export type ViewBox = { x: number; y: number; w: number; h: number };

/** `viewBox`: four numbers separated by whitespace and/or a comma; null when missing, 'bad' when unusable. */
export function parseViewBox(text: string | null | undefined): ViewBox | null | 'bad' {
  if (text === null || text === undefined) return null;
  const parts = text.trim().split(/\s*,\s*|\s+/).filter((p) => p !== '');
  if (parts.length !== 4 || !parts.every((p) => NUMBER_RE.test(p))) return 'bad';
  const [x, y, w, h] = parts.map(Number);
  if (!(w > 0 && h > 0) || ![x, y, w, h].every(Number.isFinite)) return 'bad';
  return { x, y, w, h };
}

export type SvgSizeError = 'badLength' | 'badViewBox' | 'noSize';
export type SvgSize = { ok: true; wMm: number; hMm: number; needsPpi: boolean } | { ok: false; error: SvgSizeError };

/**
 * Natural size of an SVG in mm (SPEC §8.9). `needsPpi` tells the UI to ask the 96/72/90/custom question once per file
 * (the result already uses `ppi`, so the dialog can show the size each answer gives).
 */
export function svgNaturalSize(width: string | null | undefined, height: string | null | undefined, viewBox: string | null | undefined, ppi: number): SvgSize {
  const pxMm = MM_PER_IN / ppi;
  const lw = parseRootLength(width);
  const lh = parseRootLength(height);
  if (lw.kind === 'bad' || lh.kind === 'bad') return { ok: false, error: 'badLength' };
  let vb = parseViewBox(viewBox);
  if (vb === 'bad') {
    if (lw.kind === 'rel' || lh.kind === 'rel') return { ok: false, error: 'badViewBox' };
    vb = null;
  }
  const mm = (l: RootLength) => (l.kind === 'abs' ? l.mm : l.kind === 'px' ? l.px * pxMm : NaN);
  let needsPpi = lw.kind === 'px' || lh.kind === 'px';
  let w: number;
  let h: number;
  if (lw.kind !== 'rel' && lh.kind !== 'rel') {
    w = mm(lw);
    h = mm(lh);
  } else if (!vb) {
    return { ok: false, error: 'noSize' };
  } else if (lw.kind !== 'rel') {
    w = mm(lw);
    h = (w * vb.h) / vb.w;
  } else if (lh.kind !== 'rel') {
    h = mm(lh);
    w = (h * vb.w) / vb.h;
  } else {
    w = vb.w * pxMm;
    h = vb.h * pxMm;
    needsPpi = true;
  }
  return { ok: true, wMm: w, hMm: h, needsPpi };
}

// ------------------------------------------------------------------------------------------------ inside a drawing
const USER_PER_UNIT: Record<string, number> = {
  '': 1,
  px: 1,
  mm: CSS_PX_PER_IN / MM_PER_IN,
  cm: (10 * CSS_PX_PER_IN) / MM_PER_IN,
  in: CSS_PX_PER_IN,
  pt: CSS_PX_PER_IN / 72,
  pc: CSS_PX_PER_IN / 6,
  q: (0.25 * CSS_PX_PER_IN) / MM_PER_IN,
};

export type UserLength = { ok: true; value: number } | { ok: false; reason: 'percent' | 'relativeUnit' | 'invalid'; value: number };

/**
 * A length attribute inside the drawing (x, width, r, stroke-width …) in user units. Percentages resolve against
 * `ref` (the viewport side, or its normalised diagonal); em/ex use 16 px and are reported by the caller.
 */
export function userLength(text: string | null | undefined, ref = 0): UserLength {
  if (text === null || text === undefined || text.trim() === '') return { ok: false, reason: 'invalid', value: NaN };
  const m = LENGTH_RE.exec(text);
  if (!m) return { ok: false, reason: 'invalid', value: NaN };
  const v = Number(m[1]);
  const unit = m[2].toLowerCase();
  if (unit === '%') return { ok: true, value: (v * ref) / 100 };
  if (unit === 'em') return { ok: false, reason: 'relativeUnit', value: v * 16 };
  if (unit === 'ex') return { ok: false, reason: 'relativeUnit', value: v * 8 };
  const k = USER_PER_UNIT[unit];
  return k === undefined ? { ok: false, reason: 'invalid', value: NaN } : { ok: true, value: v * k };
}

// ------------------------------------------------------------------------------------------------ viewport mapping
export type PreserveAspectRatio = { align: string; slice: boolean };

export function parsePreserveAspectRatio(text: string | null | undefined): PreserveAspectRatio {
  const parts = (text ?? '').trim().split(/\s+/).filter(Boolean);
  const aligns = ['none', 'xMinYMin', 'xMidYMin', 'xMaxYMin', 'xMinYMid', 'xMidYMid', 'xMaxYMid', 'xMinYMax', 'xMidYMax', 'xMaxYMax'];
  let i = 0;
  if (parts[0] === 'defer') i = 1;
  const align = aligns.includes(parts[i]) ? parts[i] : 'xMidYMid';
  return { align, slice: parts[i + 1] === 'slice' };
}

/** SVG 2 §8.2 "equivalent transform of an SVG viewport": viewBox user units → [0,W]×[0,H] (y down). */
export function viewportMatrix(vb: ViewBox, W: number, H: number, par: PreserveAspectRatio = { align: 'xMidYMid', slice: false }): Affine {
  let sx = W / vb.w;
  let sy = H / vb.h;
  if (par.align !== 'none') {
    const s = par.slice ? Math.max(sx, sy) : Math.min(sx, sy);
    sx = s;
    sy = s;
  }
  let tx = -vb.x * sx;
  let ty = -vb.y * sy;
  if (par.align !== 'none') {
    if (par.align.includes('xMid')) tx += (W - vb.w * sx) / 2;
    if (par.align.includes('xMax')) tx += W - vb.w * sx;
    if (par.align.includes('YMid')) ty += (H - vb.h * sy) / 2;
    if (par.align.includes('YMax')) ty += H - vb.h * sy;
  }
  return [sx, 0, 0, sy, tx, ty];
}
