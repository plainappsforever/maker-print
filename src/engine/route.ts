// Platform print geometry as data (D11, D12, D17). The native module (P4) and the print screen (P6) use these
// pure facts; nothing here talks to a printer. Pure.
import type { Rect } from './geometry';
import { pageInk, toPageRect, type PrintPlan } from './plan';
import { mapRect } from './path';
import { mmToPt } from './units';

const EPS = 1e-6;

/** Page size in PDF points with full precision (A4 = 595.2755905511812 × 841.8897637795277). */
export const pageSizePt = (p: { widthMm: number; heightMm: number }) => ({ w: mmToPt(p.widthMm), h: mmToPt(p.heightMm) });

/**
 * Android Default Print Service (D12): 1:1 only for a single-page document whose page equals the paper and whose
 * printer-margin strips are blank; everything else is fit to the page. `learnedMinMarginsMm` (D17, portrait paper
 * terms) replaces the page's own margins when known. Returns the facts and the advice the print screen shows.
 *
 * Page = paper means the PORTRAIT paper only (D53). AOSP BIPS `StartJobTask` takes `portrait_mode =
 * mediaSize.isPortrait()` and the page width as the source width, and prints 1:1 only when that width equals the
 * paper width: a 297 mm-wide landscape page on 210 mm A4 media is FIT TO PAGE (×0.707) unless the adapter asks for
 * landscape media, whose own branch swaps again (effective rule unclear from source — P3.5 review, finding 1). So the
 * plan never emits landscape pages; a landscape layout is turned onto the portrait page by our own matrix, and a
 * swapped page here is reported as not matching.
 */
export function androidJobFacts(plan: PrintPlan, paperMm: { w: number; h: number }, learnedMinMarginsMm?: { l: number; t: number; r: number; b: number } | null) {
  const pageMatchesPaper = plan.pages.every((p) => Math.abs(p.widthMm - paperMm.w) <= EPS && Math.abs(p.heightMm - paperMm.h) <= EPS);
  const marginsBlank = plan.pages.every((p) => {
    const ink = pageInk(p, plan.content);
    if (!ink) return true;
    const printed = p.correction ? mapRect(p.correction, ink) : ink;
    const m = learnedMinMarginsMm;
    const blank: Rect = m ? { x: m.l, y: m.t, w: p.widthMm - m.l - m.r, h: p.heightMm - m.t - m.b } : toPageRect(p, p.safe);
    return printed.x >= blank.x - EPS && printed.y >= blank.y - EPS && printed.x + printed.w <= blank.x + blank.w + EPS && printed.y + printed.h <= blank.y + blank.h + EPS;
  });
  const single = plan.pages.length === 1;
  return {
    pageMatchesPaper,
    marginsBlank,
    singlePage: single,
    /** What the sourced rules predict; the check bar on paper is still the proof (L26) */
    expectExact: single && pageMatchesPaper && marginsBlank,
    advice: !single ? ('oneByOneOrMultiCorrection' as const) : !marginsBlank ? ('marginsNotBlank' as const) : null,
  };
}

/**
 * iOS own renderer (D11): each PDF page is drawn at scale 1.0. When the paper the printer picked equals the page,
 * the page's top-left is the paper's top-left (offset 0); otherwise the page is centred and the caller warns.
 * Plans only emit portrait pages (D53), so P4 keeps `UIPrintInfo.orientation = .portrait` and a swapped paper is a
 * mismatch (a 297 × 210 page on A4 would lose 43.5 mm on both sides), never "exact".
 */
export function iosRendererPlacement(pageMm: { w: number; h: number }, paperMm: { w: number; h: number }) {
  const same = Math.abs(pageMm.w - paperMm.w) <= EPS && Math.abs(pageMm.h - paperMm.h) <= EPS;
  const dx = same ? 0 : (paperMm.w - pageMm.w) / 2;
  const dy = same ? 0 : (paperMm.h - pageMm.h) / 2;
  return { scale: 1 as const, offsetMm: { x: dx, y: dy }, offsetPt: { x: mmToPt(dx), y: mmToPt(dy) }, paperMatches: same };
}

const MM_PER_PT = 25.4 / 72;
const MM_PER_MIL = 0.0254;

/**
 * Margins the print system reported after an exact print (D17), in mm of the PORTRAIT paper (D53), or null when it
 * reported nothing usable. iOS: the chosen paper's `printableRect` (pt, paper coordinates, y down). Android: the minimum
 * margins (mils) seen in the adapter's onLayout or the job's final attributes. Values are rounded to 0.01 mm and never
 * negative; a reported printable area outside the paper is ignored.
 */
export function learnedMarginsMm(r: {
  paperWidthPt?: number;
  paperHeightPt?: number;
  printableRectPt?: { x: number; y: number; w: number; h: number };
  minMarginsMils?: { l: number; t: number; r: number; b: number };
}): { l: number; t: number; r: number; b: number } | null {
  const round = (v: number) => Math.max(0, Math.round(v * 100) / 100);
  const ok = (v: number) => Number.isFinite(v) && v >= -1e-6;
  if (r.printableRectPt && r.paperWidthPt && r.paperHeightPt) {
    const p = r.printableRectPt;
    const m = { l: p.x, t: p.y, r: r.paperWidthPt - p.x - p.w, b: r.paperHeightPt - p.y - p.h };
    if (p.w <= 0 || p.h <= 0 || !Object.values(m).every(ok)) return null;
    return { l: round(m.l * MM_PER_PT), t: round(m.t * MM_PER_PT), r: round(m.r * MM_PER_PT), b: round(m.b * MM_PER_PT) };
  }
  if (r.minMarginsMils) {
    const m = r.minMarginsMils;
    if (!Object.values(m).every(ok)) return null;
    return { l: round(m.l * MM_PER_MIL), t: round(m.t * MM_PER_MIL), r: round(m.r * MM_PER_MIL), b: round(m.b * MM_PER_MIL) };
  }
  return null;
}

/**
 * Printer name for the UI from what the print system reported: iOS gives a DNS-SD service instance
 * ("MakerPrint\032Test._ipps._tcp.local.", RFC 6763 escapes \DDD and \c); anything else is returned trimmed.
 */
export function printerDisplayName(raw: string | null | undefined): string | null {
  if (!raw || /^urn:uuid:/i.test(raw)) return null; // Android Default Print Service ids carry no name
  const instance = raw.split(/\._[a-z0-9-]+\._(tcp|udp)\b/i)[0];
  const name = instance.replace(/\\(\d{3})/g, (_, d: string) => String.fromCharCode(Number(d))).replace(/\\(.)/g, '$1').trim();
  return name || null;
}

/** Android media sizes are whole mils (ISO A4 = 8270 × 11690 mils = 210.058 × 296.926 mm): the same paper within this. */
export const MEDIA_MATCH_MM = 0.5;

/** The paper the print system picked, snapped to our page when it is the same paper within MEDIA_MATCH_MM. */
export function snapPaperToPage(paperMm: { w: number; h: number }, pageMm: { w: number; h: number }) {
  const same = Math.abs(paperMm.w - pageMm.w) <= MEDIA_MATCH_MM && Math.abs(paperMm.h - pageMm.h) <= MEDIA_MATCH_MM;
  return same ? { w: pageMm.w, h: pageMm.h } : paperMm;
}
