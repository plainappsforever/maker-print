// Paper catalogue and region defaults (RESEARCH §4.5, D17, D22). Pure — no React/Expo imports.
import { EPS_MM, type DisplayUnit, type InchStyle } from './units';

export type PaperKey =
  | 'a0' | 'a1' | 'a2' | 'a3' | 'a4' | 'a5' | 'a6' | 'b4' | 'b5'
  | 'letter' | 'legal' | 'tabloid'
  | 'photo-4x6' | 'photo-5x7' | 'photo-8x10' | 'photo-10x15' | 'photo-13x18';
export type PaperKind = 'office' | 'photo';
export type Orientation = 'portrait' | 'landscape';
/** Portrait dimensions in mm (width ≤ height). */
export type Paper = { key: PaperKey; widthMm: number; heightMm: number; kind: PaperKind; label: string };
export type Margins = { l: number; t: number; r: number; b: number };
export type Size = { w: number; h: number };

const paper = (key: PaperKey, widthMm: number, heightMm: number, label: string, kind: PaperKind = 'office'): Paper => ({
  key,
  widthMm,
  heightMm,
  kind,
  label,
});

/**
 * ISO 216 A/B series; US and photo sizes are their inch definitions written as exact decimal mm literals —
 * `8.5 * 25.4` would be 215.89999999999998, one ulp off the nearest double to 215.9 (found by the oracle).
 */
export const PAPERS: readonly Paper[] = [
  paper('a4', 210, 297, 'A4'),
  paper('letter', 215.9, 279.4, 'Letter'),
  paper('a3', 297, 420, 'A3'),
  paper('a5', 148, 210, 'A5'),
  paper('a6', 105, 148, 'A6'),
  paper('legal', 215.9, 355.6, 'Legal'),
  paper('tabloid', 279.4, 431.8, 'Tabloid'),
  paper('a2', 420, 594, 'A2'),
  paper('a1', 594, 841, 'A1'),
  paper('a0', 841, 1189, 'A0'),
  paper('b4', 250, 353, 'B4'),
  paper('b5', 176, 250, 'B5'),
  paper('photo-4x6', 101.6, 152.4, '4 × 6 in', 'photo'),
  paper('photo-5x7', 127, 177.8, '5 × 7 in', 'photo'),
  paper('photo-8x10', 203.2, 254, '8 × 10 in', 'photo'),
  paper('photo-10x15', 100, 150, '10 × 15 cm', 'photo'),
  paper('photo-13x18', 130, 180, '13 × 18 cm', 'photo'),
];

const BY_KEY = new Map(PAPERS.map((p) => [p.key, p]));

export function isPaperKey(value: unknown): value is PaperKey {
  return typeof value === 'string' && BY_KEY.has(value as PaperKey);
}

export function getPaper(key: PaperKey): Paper {
  const p = BY_KEY.get(key);
  if (!p) throw new Error(`Unknown paper ${key}`);
  return p;
}

/** Paper size in the given orientation (landscape swaps width and height). */
export function paperSize(key: PaperKey, orientation: Orientation = 'portrait'): Size {
  const { widthMm, heightMm } = getPaper(key);
  return orientation === 'portrait' ? { w: widthMm, h: heightMm } : { w: heightMm, h: widthMm };
}

/** Sheet = paper test of SPEC §8.6 (± 0.01 mm), in either orientation. */
export const PAPER_MATCH_MM = 0.01;
export function matchPaper(w: number, h: number): { key: PaperKey; orientation: Orientation } | null {
  for (const p of PAPERS) {
    if (Math.abs(w - p.widthMm) <= PAPER_MATCH_MM && Math.abs(h - p.heightMm) <= PAPER_MATCH_MM) {
      return { key: p.key, orientation: 'portrait' };
    }
    if (Math.abs(w - p.heightMm) <= PAPER_MATCH_MM && Math.abs(h - p.widthMm) <= PAPER_MATCH_MM) {
      return { key: p.key, orientation: 'landscape' };
    }
  }
  return null;
}

/** Default safe margin (D17): ¼ in on office papers, 3 mm on photo papers. */
export const OFFICE_MARGIN_MM = 6.35;
export const PHOTO_MARGIN_MM = 3;
/**
 * Floor for margins LEARNED from a print system (D76): a printer that reports 0 mm (or 1 mm) is not trusted to print
 * edge to edge on office paper, so at least 3 mm stay blank. Typed margins are the user's call and are used as typed.
 */
export const MIN_LEARNED_MARGIN_MM = 3;
export function defaultMarginMm(key: PaperKey): number {
  return getPaper(key).kind === 'photo' ? PHOTO_MARGIN_MM : OFFICE_MARGIN_MM;
}
export const uniformMargins = (m: number): Margins => ({ l: m, t: m, r: m, b: m });

/** Safe area (the page minus margins) as a rectangle in page coordinates, or null when margins leave no room. */
export function safeArea(size: Size, m: Margins): { x: number; y: number; w: number; h: number } | null {
  const w = size.w - m.l - m.r;
  const h = size.h - m.t - m.b;
  if (w <= EPS_MM || h <= EPS_MM || m.l < 0 || m.t < 0 || m.r < 0 || m.b < 0) return null;
  return { x: m.l, y: m.t, w, h };
}

// Letter regions (RESEARCH §4.5, D22); inch regions (D22).
const LETTER_REGIONS = new Set(['US', 'CA', 'MX', 'PH', 'CL', 'CO', 'VE', 'PR']);
const INCH_REGIONS = new Set(['US', 'LR', 'MM']);

export type RegionDefaults = { paper: PaperKey; unit: DisplayUnit; inchStyle: InchStyle };

/** Default paper and unit for a device region (ISO 3166 alpha-2, any case); unknown → A4 + mm. */
export function regionDefaults(region: string | null | undefined): RegionDefaults {
  const r = (region ?? '').toUpperCase();
  return {
    paper: LETTER_REGIONS.has(r) ? 'letter' : 'a4',
    unit: INCH_REGIONS.has(r) ? 'in' : 'mm',
    inchStyle: 'fraction16',
  };
}
