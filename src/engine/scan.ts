// Scan planner (V15_PLAN F22, phase A1): four corners on a photo + what the user knows about the real size → the
// straightened picture's pixel size, its size in millimetres and the warp the native side performs. Pure.
// Honesty (L26): a size typed for both sides is used as given; a size estimated from the perspective is said
// (`aspectEstimated`), never presented as measured — paper proves it.
import {
  applyH,
  estimateAspect,
  homography,
  invert3,
  orderCorners,
  quadIssue,
  type AspectEstimate,
  type Mat3,
  type Pt,
  type Quad,
  type QuadIssue,
} from './homography';
import { MM_PER_IN } from './units';

export type KnownSize =
  /** Both sides of the real rectangle (typed, or a paper size; `autoOrient` turns it to match the photo) */
  | { kind: 'rect'; wMm: number; hMm: number; autoOrient?: boolean }
  /** Only the length of the top/bottom edge is known; the height comes from the perspective */
  | { kind: 'width'; mm: number }
  /** Only the length of the left/right edge is known */
  | { kind: 'height'; mm: number }
  /** Straighten only: no true size (the result is a photo; the known-length tool can scale it later) */
  | { kind: 'none' };

export type ScanWarning =
  /** one side (or both) comes from the perspective estimate, not from a typed length */
  | 'aspectEstimated'
  /** the estimate had to assume a typical phone lens (no usable EXIF, no usable perspective) AND the lens matters for
   *  this photo: the other side lies somewhere in `estimatedRangeMm` (this photo's own range over 13–130 mm lenses) */
  | 'aspectWeak'
  /** the typed sides disagree with the photo's shape by more than the estimate's tolerance */
  | 'aspectMismatch'
  /** the far edge holds fewer than 150 photo pixels per inch: the print will look soft */
  | 'lowDetail';

export type ScanPlan = {
  /** The corners used, ordered TL, TR, BR, BL (displayed source pixels) */
  quad: Quad;
  sourcePx: { w: number; h: number };
  /** The straightened picture */
  outPx: { w: number; h: number };
  /** Its real size; null for `none` (no true size: placed like a photo) */
  sizeMm: { w: number; h: number } | null;
  /** Source pixel → output pixel, and its inverse (output pixel → source pixel, what a sampling warp uses) */
  toOutput: Mat3;
  toSource: Mat3;
  aspect: AspectEstimate;
  /** Least photo detail along an edge, pixels per inch of the real object; null without a true size */
  detailPpi: number | null;
  /** The output was made smaller than the photo's detail to stay under the pixel cap */
  capped: boolean;
  /**
   * With the assumed lens and one side typed: the estimated side for every plausible lens (13–130 mm equivalent),
   * exact corners assumed; what `aspectWeak` says instead of a fixed "up to N %" (review M2). Null otherwise.
   */
  estimatedRangeMm: { min: number; max: number } | null;
  /**
   * The photographed edges each typed length was applied to (displayed source pixels, from `quad`): a width → the top
   * and bottom edge, a height → the left and right edge; null for a side not typed. "Top" follows the corner order
   * (the corner with the smallest x + y is top-left), so near a 45° roll it flips with a small corner move: the corner
   * screen draws these edges next to the typed field so the user sees which edge the number belongs to (review S3).
   */
  typedEdges: { width: [Edge, Edge] | null; height: [Edge, Edge] | null };
  /** Angle of the top edge (TL → TR) from the photo's horizontal in degrees, clockwise on screen; |rollDeg| → 45 = flip */
  rollDeg: number;
  warnings: ScanWarning[];
};

export type Edge = readonly [Pt, Pt];

export type ScanError = QuadIssue | 'badLength' | 'noShape';

export type ScanInput = {
  /** Corners in displayed source pixels (any order: they are sorted) */
  corners: readonly Pt[];
  /** Displayed source size (EXIF orientation applied) */
  sourcePx: { w: number; h: number };
  known: KnownSize;
  /** For `none`: the photo rule's pixels per inch (D48); also the detail below which nothing is added */
  ppiTarget: number;
  /** EXIF FocalLengthIn35mmFilm, when the photo has it */
  focal35mm?: number | null;
  /** Pixel cap of the straightened picture (default SCAN_MAX_PX) */
  maxPx?: number;
};

/** 16 MP: about 400 ppi on A4 and 64 MB as RGBA while the native side warps (phones of 2020 and later). */
export const SCAN_MAX_PX = 16_000_000;
export const SCAN_MAX_MM = 10_000;
export const LOW_DETAIL_PPI = 150;
/** Typed sides vs the photo's shape: 5 % when the focal length was measured (EXIF lens, the quad's own, or no
 *  foreshortening), 15 % only when a lens was assumed (D91; review M1). */
export const ASPECT_TOLERANCE = { measured: 0.05, assumed: 0.15 } as const;
/** `aspectWeak` only when some plausible lens moves the estimate by more than this (review S2: else it is noise). */
export const LENS_MATTERS = 0.005;

/** True when the assumed lens could change this photo's estimate by more than `LENS_MATTERS` (or nobody can tell). */
export function lensMatters(a: AspectEstimate): boolean {
  if (a.source !== 'assumedLens') return false;
  if (!a.lensRange) return true;
  return Math.max(a.lensRange.hi / a.ratio - 1, 1 - a.lensRange.lo / a.ratio) > LENS_MATTERS;
}

/** The quad's edges a typed width / height belongs to (see `ScanPlan.typedEdges`). */
export function typedEdgesFor(q: Quad, known: KnownSize): ScanPlan['typedEdges'] {
  const w = known.kind === 'rect' || known.kind === 'width';
  const h = known.kind === 'rect' || known.kind === 'height';
  return { width: w ? [[q[0], q[1]], [q[3], q[2]]] : null, height: h ? [[q[0], q[3]], [q[1], q[2]]] : null };
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Edge lengths in source pixels: top, right, bottom, left. */
export function edgeLengths(q: Quad): [number, number, number, number] {
  return [dist(q[0], q[1]), dist(q[1], q[2]), dist(q[2], q[3]), dist(q[3], q[0])];
}

const validMm = (v: number) => Number.isFinite(v) && v > 0 && v <= SCAN_MAX_MM;

/** The real rectangle's size in mm from what is known and the estimated ratio (width ÷ height). */
function realSize(known: KnownSize, ratio: number): { w: number; h: number } | 'badLength' | null {
  switch (known.kind) {
    case 'rect': {
      if (!validMm(known.wMm) || !validMm(known.hMm)) return 'badLength';
      if (known.autoOrient) {
        const asGiven = Math.abs(Math.log(known.wMm / known.hMm / ratio));
        const turned = Math.abs(Math.log(known.hMm / known.wMm / ratio));
        if (turned < asGiven) return { w: known.hMm, h: known.wMm };
      }
      return { w: known.wMm, h: known.hMm };
    }
    case 'width':
      if (!validMm(known.mm)) return 'badLength';
      return validMm(known.mm / ratio) ? { w: known.mm, h: known.mm / ratio } : 'badLength';
    case 'height':
      if (!validMm(known.mm)) return 'badLength';
      return validMm(known.mm * ratio) ? { w: known.mm * ratio, h: known.mm } : 'badLength';
    case 'none':
      return null;
  }
}

/**
 * Plans a scan. Output pixels: the density of the photo's most detailed edge (nothing the photo holds is lost there;
 * the far edge is upsampled), capped at `maxPx`; with no true size the output keeps the photo's own scale.
 */
export function planScan(input: ScanInput): { ok: true; plan: ScanPlan } | { ok: false; error: ScanError } {
  const quad = orderCorners(input.corners);
  if (!quad) return { ok: false, error: 'notFinite' };
  const issue = quadIssue(quad, input.sourcePx);
  if (issue) return { ok: false, error: issue };
  const aspect = estimateAspect(quad, input.sourcePx, input.focal35mm);
  if (!aspect) return { ok: false, error: 'noShape' };
  const size = realSize(input.known, aspect.ratio);
  if (size === 'badLength') return { ok: false, error: 'badLength' };
  const [top, right, bottom, left] = edgeLengths(quad);
  const warnings: ScanWarning[] = [];
  let w: number;
  let h: number;
  let detailPpi: number | null = null;
  if (size) {
    const inW = size.w / MM_PER_IN;
    const inH = size.h / MM_PER_IN;
    const densities = [top / inW, right / inH, bottom / inW, left / inH];
    const ppi = Math.max(...densities);
    detailPpi = Math.min(...densities);
    w = inW * ppi;
    h = inH * ppi;
    if (input.known.kind !== 'rect') {
      warnings.push('aspectEstimated');
      if (lensMatters(aspect)) warnings.push('aspectWeak');
    } else {
      const tol = aspect.source === 'assumedLens' ? ASPECT_TOLERANCE.assumed : ASPECT_TOLERANCE.measured;
      if (Math.abs(Math.log(size.w / size.h / aspect.ratio)) > Math.log(1 + tol)) warnings.push('aspectMismatch');
    }
    if (detailPpi < LOW_DETAIL_PPI) warnings.push('lowDetail');
  } else {
    // the photo's own scale: the longer of each pair of opposite edges, shaped to the estimated ratio
    const wPx = Math.max(top, bottom);
    const hPx = Math.max(left, right);
    if (wPx / hPx >= aspect.ratio) {
      w = wPx;
      h = wPx / aspect.ratio;
    } else {
      h = hPx;
      w = hPx * aspect.ratio;
    }
    warnings.push('aspectEstimated');
    if (lensMatters(aspect)) warnings.push('aspectWeak');
  }
  let estimatedRangeMm: ScanPlan['estimatedRangeMm'] = null;
  if (aspect.lensRange && (input.known.kind === 'width' || input.known.kind === 'height')) {
    const { lo, hi } = aspect.lensRange;
    const mm = input.known.mm;
    estimatedRangeMm = input.known.kind === 'width' ? { min: mm / hi, max: mm / lo } : { min: mm * lo, max: mm * hi };
  }
  const cap = input.maxPx ?? SCAN_MAX_PX;
  let capped = false;
  if (w * h > cap) {
    const k = Math.sqrt(cap / (w * h));
    w *= k;
    h *= k;
    capped = true;
  }
  const outPx = { w: Math.max(1, Math.floor(w)), h: Math.max(1, Math.floor(h)) };
  const rect: Pt[] = [
    { x: 0, y: 0 },
    { x: outPx.w, y: 0 },
    { x: outPx.w, y: outPx.h },
    { x: 0, y: outPx.h },
  ];
  const toOutput = homography(quad, rect);
  const toSource = toOutput && invert3(toOutput);
  // review N1: corners that pass the sanity rules but give no usable map (an extreme implied shape) are not "on top of each other"
  if (!toOutput || !toSource) return { ok: false, error: 'noShape' };
  const rollDeg = (Math.atan2(quad[1].y - quad[0].y, quad[1].x - quad[0].x) * 180) / Math.PI;
  return {
    ok: true,
    plan: { quad, sourcePx: { ...input.sourcePx }, outPx, sizeMm: size, toOutput, toSource, aspect, detailPpi, capped, estimatedRangeMm, typedEdges: typedEdgesFor(quad, input.known), rollDeg, warnings },
  };
}

/** Saved with the straightened image (asset report, `scan`): what was done, so the editor and the reviewer can say it. */
export type ScanRecord = {
  v: 1;
  quad: Quad;
  sourcePx: { w: number; h: number };
  known: KnownSize;
  sizeMm: { w: number; h: number } | null;
  aspect: AspectEstimate;
  warnings: ScanWarning[];
};

export function scanRecord(p: ScanPlan, known: KnownSize): ScanRecord {
  return { v: 1, quad: p.quad, sourcePx: p.sourcePx, known, sizeMm: p.sizeMm, aspect: p.aspect, warnings: p.warnings };
}

// ------------------------------------------------------------------------------------------------ native boundary
/** Start corners when nothing was detected: 10 % in from each side (64 % of the photo, inside the sanity rules). */
export function defaultQuad(img: { w: number; h: number }): Quad {
  const dx = img.w * 0.1;
  const dy = img.h * 0.1;
  return [
    { x: dx, y: dy },
    { x: img.w - dx, y: dy },
    { x: img.w - dx, y: img.h - dy },
    { x: dx, y: img.h - dy },
  ];
}

/**
 * Apple Vision returns normalised points with the origin bottom-left (VNRectangleObservation topLeft …) → displayed
 * pixels, y down. Null when a point is missing or outside 0…1 by more than 1 %.
 */
export function fromVisionNormalised(pts: readonly Pt[], img: { w: number; h: number }): Quad | null {
  if (pts.length !== 4 || pts.some((p) => !(p.x >= -0.01 && p.x <= 1.01 && p.y >= -0.01 && p.y <= 1.01))) return null;
  // review N9: points up to 1 % outside are clamped onto the photo (else the ±0.5 px rule would throw them away)
  const c01 = (v: number) => Math.min(1, Math.max(0, v));
  return orderCorners(pts.map((p) => ({ x: c01(p.x) * img.w, y: (1 - c01(p.y)) * img.h })));
}

/** CoreImage (`CIPerspectiveCorrection` inputTopLeft …) works in pixels with the origin bottom-left. */
export function toCoreImagePoints(q: Quad, imgH: number): { topLeft: Pt; topRight: Pt; bottomRight: Pt; bottomLeft: Pt } {
  const f = (p: Pt) => ({ x: p.x, y: imgH - p.y });
  return { topLeft: f(q[0]), topRight: f(q[1]), bottomRight: f(q[2]), bottomLeft: f(q[3]) };
}

/** Android `Matrix.setPolyToPoly(src, 0, dst, 0, 4)`: source quad → output rectangle, as the two float arrays. */
export function polyToPolyArrays(q: Quad, out: { w: number; h: number }): { src: number[]; dst: number[] } {
  return { src: q.flatMap((p) => [p.x, p.y]), dst: [0, 0, out.w, 0, out.w, out.h, 0, out.h] };
}

/** Where an output pixel centre samples the source (for reference warps and tests). */
export function sourceOf(p: ScanPlan, outX: number, outY: number): Pt | null {
  return applyH(p.toSource, { x: outX, y: outY });
}
