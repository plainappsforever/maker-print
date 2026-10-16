// Perspective maths for scanning (V15_PLAN F22, phase A1): the 4-point homography, corner order and sanity, and the
// true aspect ratio of a photographed rectangle. Pure. Coordinates are image pixels as DISPLAYED (EXIF orientation
// applied), origin top-left, y down; a quad is ordered top-left, top-right, bottom-right, bottom-left.

export type Pt = { x: number; y: number };
/** Corners in displayed image pixels, y down: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Pt, Pt, Pt, Pt];
/** 3 × 3 matrix, row-major: (x, y, 1) → (X, Y, W), point = (X / W, Y / W). */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export const IDENTITY3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function mul3(a: Mat3, b: Mat3): Mat3 {
  const r = new Array<number>(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return r as Mat3;
}

/** Inverse by the adjugate; null when singular (relative to the matrix's size). */
export function invert3(m: Mat3): Mat3 | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const scale = Math.max(...m.map(Math.abs));
  if (!Number.isFinite(det) || !(scale > 0) || Math.abs(det) <= 1e-14 * scale ** 3) return null;
  const inv: Mat3 = [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d];
  return inv.map((v) => v / det) as Mat3;
}

/** Maps a point; null on (or numerically at) the horizon line, where W = 0. */
export function applyH(h: Mat3, p: Pt): Pt | null {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  if (!(Math.abs(w) > 1e-300) || !Number.isFinite(w)) return null;
  const x = (h[0] * p.x + h[1] * p.y + h[2]) / w;
  const y = (h[3] * p.x + h[4] * p.y + h[5]) / w;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

/** Hartley normalisation: centroid to the origin, mean distance √2. Null when all points coincide. */
function normaliser(pts: readonly Pt[]): Mat3 | null {
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const mean = pts.reduce((s, p) => s + Math.hypot(p.x - cx, p.y - cy), 0) / pts.length;
  if (!(mean > 0) || !Number.isFinite(mean)) return null;
  const s = Math.SQRT2 / mean;
  return [s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1];
}

/** Solves the n × n system in place (augmented rows), partial pivoting; null when a pivot vanishes. */
function solve(rows: number[][]): number[] | null {
  const n = rows.length;
  for (let col = 0; col < n; col++) {
    let best = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(rows[r][col]) > Math.abs(rows[best][col])) best = r;
    if (!(Math.abs(rows[best][col]) > 1e-10)) return null;
    [rows[col], rows[best]] = [rows[best], rows[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const k = rows[r][col] / rows[col][col];
      if (k === 0) continue;
      for (let c = col; c <= n; c++) rows[r][c] -= k * rows[col][c];
    }
  }
  return rows.map((row, i) => row[n] / row[i]);
}

/**
 * The homography H with H · src[i] ≅ dst[i] for the four point pairs (direct linear transform on normalised points,
 * h33 = 1). Null when no unique, finite, invertible H exists (three collinear points, coincident points).
 */
export function homography(src: readonly Pt[], dst: readonly Pt[]): Mat3 | null {
  if (src.length !== 4 || dst.length !== 4) return null;
  if (![...src, ...dst].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) return null;
  const ts = normaliser(src);
  const td = normaliser(dst);
  if (!ts || !td) return null;
  const ns = src.map((p) => applyH(ts, p) as Pt);
  const nd = dst.map((p) => applyH(td, p) as Pt);
  const rows: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = ns[i];
    const { x: u, y: v } = nd[i];
    rows.push([x, y, 1, 0, 0, 0, -x * u, -y * u, u]);
    rows.push([0, 0, 0, x, y, 1, -x * v, -y * v, v]);
  }
  const h = solve(rows);
  if (!h) return null;
  const tdInv = invert3(td);
  if (!tdInv) return null;
  let H = mul3(mul3(tdInv, [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1]), ts);
  const k = Math.abs(H[8]) > 1e-12 ? H[8] : Math.hypot(...H);
  H = H.map((v) => v / k) as Mat3;
  if (!H.every(Number.isFinite) || !invert3(H)) return null;
  // a near-singular configuration can "solve" with a large residual: accept only an H that maps the pairs
  const extent = Math.max(...dst.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))), 1);
  for (let i = 0; i < 4; i++) {
    const m = applyH(H, src[i]);
    if (!m || Math.hypot(m.x - dst[i].x, m.y - dst[i].y) > 1e-6 * extent) return null;
  }
  return H;
}

// ------------------------------------------------------------------------------------------------ corners
const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Shoelace area; positive for the clockwise-on-screen order TL → TR → BR → BL (y down). */
export function signedArea(q: readonly Pt[]): number {
  let s = 0;
  for (let i = 0; i < q.length; i++) {
    const a = q[i];
    const b = q[(i + 1) % q.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

/**
 * Any four points (handles dragged across each other, a detector's arbitrary order) → TL, TR, BR, BL: sorted by angle
 * about the centroid (clockwise on screen), starting at the point with the smallest x + y (ties: smaller y).
 */
export function orderCorners(pts: readonly Pt[]): Quad | null {
  if (pts.length !== 4 || !pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) return null;
  const cx = pts.reduce((s, p) => s + p.x, 0) / 4;
  const cy = pts.reduce((s, p) => s + p.y, 0) / 4;
  const sorted = pts.map((p) => ({ x: p.x, y: p.y })).sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  let start = 0;
  for (let i = 1; i < 4; i++) {
    const s = sorted[i].x + sorted[i].y;
    const best = sorted[start].x + sorted[start].y;
    if (s < best - 1e-9 || (Math.abs(s - best) <= 1e-9 && sorted[i].y < sorted[start].y)) start = i;
  }
  return [0, 1, 2, 3].map((i) => sorted[(start + i) % 4]) as Quad;
}

export type QuadIssue = 'notFinite' | 'outside' | 'degenerate' | 'selfIntersecting' | 'mirrored' | 'concave' | 'tooSmall';

function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Interior angle at q[i] in degrees (0–180, unsigned). */
function cornerAngle(q: readonly Pt[], i: number): number {
  const p = q[(i + 3) % 4];
  const c = q[i];
  const n = q[(i + 1) % 4];
  const a = Math.atan2(p.y - c.y, p.x - c.x) - Math.atan2(n.y - c.y, n.x - c.x);
  const deg = Math.abs((a * 180) / Math.PI) % 360;
  return deg > 180 ? 360 - deg : deg;
}

export const MIN_QUAD_AREA_FRACTION = 0.1;
/** Corners flatter than this (or sharper than 180° minus it) make the straightened picture meaningless. */
export const MIN_CORNER_DEG = 5;

/**
 * Why four corners cannot be straightened, or null when they can: inside the image (± `tolerancePx`), no two corners
 * closer than 1 px, no corner flatter than 5° from straight or sharper than 5°, edges not crossing, clockwise
 * (TL → TR → BR → BL), convex, and enclosing at least 10 % of the image.
 */
export function quadIssue(q: readonly Pt[], img: { w: number; h: number }, opts: { minAreaFraction?: number; tolerancePx?: number } = {}): QuadIssue | null {
  if (q.length !== 4 || !q.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) return 'notFinite';
  const tol = opts.tolerancePx ?? 0.5;
  if (q.some((p) => p.x < -tol || p.y < -tol || p.x > img.w + tol || p.y > img.h + tol)) return 'outside';
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) if (Math.hypot(q[i].x - q[j].x, q[i].y - q[j].y) < 1) return 'degenerate';
  if (segmentsCross(q[0], q[1], q[2], q[3]) || segmentsCross(q[1], q[2], q[3], q[0])) return 'selfIntersecting';
  const turns = [0, 1, 2, 3].map((i) => cross(q[i], q[(i + 1) % 4], q[(i + 2) % 4]));
  const angles = [0, 1, 2, 3].map((i) => cornerAngle(q, i));
  if (angles.some((a) => a < MIN_CORNER_DEG || a > 180 - MIN_CORNER_DEG)) {
    // a reflex corner can be 175°+ too: concavity is the clearer message then; a straight corner is degenerate
    const scale = Math.max(...q.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))), 1);
    const straight = turns.some((t) => Math.abs(t) <= 1e-9 * scale * scale);
    if (!straight && !(turns.every((t) => t > 0) || turns.every((t) => t < 0))) return 'concave';
    return 'degenerate';
  }
  if (turns.every((t) => t < 0)) return 'mirrored';
  if (!turns.every((t) => t > 0)) return 'concave';
  if (signedArea(q) < (opts.minAreaFraction ?? MIN_QUAD_AREA_FRACTION) * img.w * img.h) return 'tooSmall';
  return null;
}

// ------------------------------------------------------------------------------------------------ true aspect
export type AspectSource =
  /** focal length found from the quad itself (two vanishing points, Zhang & He 2007) */
  | 'perspective'
  /** both pairs of opposite edges parallel in the photo: no foreshortening to undo */
  | 'parallel'
  /** focal length from the photo's EXIF 35 mm-equivalent focal length */
  | 'lens'
  /** focal length assumed: a phone's main camera (26 mm equivalent) */
  | 'assumedLens';
export type AspectEstimate = {
  ratio: number;
  source: AspectSource;
  focalPx: number | null;
  /** Largest relative change of `ratio` when one corner moves by 2 px: how much the corners' placement matters */
  spread: number;
  /**
   * `assumedLens` only: the ratio for the plausible lenses' extremes (13 and 130 mm equivalent, `PLAUSIBLE_FOCAL_35MM`).
   * The ratio is monotonic in the focal length, so every lens in between gives a ratio inside [lo, hi]: this photo's own
   * honest range (review M2/S2), not a bound taken from other photos. Exact corners assumed; corner error comes on top.
   */
  lensRange?: { lo: number; hi: number } | null;
  /** An EXIF 35 mm focal length that was NOT used because it lies outside `PLAUSIBLE_FOCAL_35MM` (review S1) */
  lensIgnored?: number | null;
};

/** Diagonal of a 36 × 24 mm frame; f(px) = f35 / 43.27 × image diagonal (px). */
export const FULL_FRAME_DIAGONAL_MM = Math.hypot(36, 24);
export const ASSUMED_FOCAL_35MM = 26;
/** Plausible lenses: about 13 mm (ultra-wide) to 130 mm (telephoto) 35 mm-equivalent. */
const FOCAL_RANGE_DIAG = [0.3, 3] as const;
/**
 * EXIF FocalLengthIn35mmFilm values believed (whole millimetres, inclusive): phone ultra-wide (13 mm) to 5× telephoto
 * (120–130 mm). Outside it the tag is treated as missing — writers that put the REAL focal length (4–7 mm) into the
 * 35 mm tag, 65535, 1 (review S1). The same span is the range an assumed-lens estimate is honest about (`lensRange`).
 */
export const PLAUSIBLE_FOCAL_35MM = { min: 13, max: 130 } as const;
const f2Of35 = (mm: number) => (mm / FULL_FRAME_DIAGONAL_MM) ** 2;

type V3 = [number, number, number];
const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Width ÷ height of the real rectangle whose photo is the quad (Zhang & He, "Whiteboard scanning and image
 * enhancement", Digital Signal Processing 17 (2007), §3): pinhole camera, square pixels, principal point at the image
 * centre (an uncropped photo). The focal length comes from the photo's EXIF 35 mm-equivalent focal length (when it is
 * inside `PLAUSIBLE_FOCAL_35MM`), else from
 * the quad when it is plausible and well defined, else a 26 mm phone lens is assumed. Null for an unusable quad.
 */
export function estimateAspect(q: Quad, img: { w: number; h: number }, focal35mm?: number | null): AspectEstimate | null {
  const c = aspectParts(q, img);
  if (!c) return null;
  const finish = (ratio: number, source: AspectSource, f2: number | null): AspectEstimate | null =>
    Number.isFinite(ratio) && ratio > 0 ? { ratio, source, focalPx: f2 === null ? null : Math.sqrt(f2) * c.diag, spread: sensitivity(q, img, source === 'perspective' ? null : f2) } : null;
  if (c.parallel) return finish(c.ratioAt(0), 'parallel', null);
  const given = focal35mm != null && focal35mm > 0 && Number.isFinite(focal35mm) ? focal35mm : null;
  const lens = given !== null && given >= PLAUSIBLE_FOCAL_35MM.min && given <= PLAUSIBLE_FOCAL_35MM.max ? given : null;
  const lensIgnored = given !== null && lens === null ? given : null;
  const withIgnored = (e: AspectEstimate | null) => (e && lensIgnored !== null ? { ...e, lensIgnored } : e);
  // the photo's own lens first: measured on 2 000 simulated photos it beats the quad's focal length under corner error
  if (lens) return finish(c.ratioAt(f2Of35(lens)), 'lens', f2Of35(lens));
  if (c.f2 !== null) {
    // the quad's own focal length, unless 2 px of corner error would move the ratio by more than 0.5 % (one pair of
    // edges nearly parallel: the focal length is then poorly defined and the lens is the better guess)
    const e = finish(c.ratioAt(c.f2), 'perspective', c.f2);
    if (e && e.spread <= PERSPECTIVE_MAX_SPREAD) return withIgnored(e);
  }
  const f2 = f2Of35(ASSUMED_FOCAL_35MM);
  const e = finish(c.ratioAt(f2), 'assumedLens', f2);
  if (!e) return null;
  const a = c.ratioAt(f2Of35(PLAUSIBLE_FOCAL_35MM.min));
  const b = c.ratioAt(f2Of35(PLAUSIBLE_FOCAL_35MM.max));
  return withIgnored({ ...e, lensRange: Number.isFinite(a) && Number.isFinite(b) ? { lo: Math.min(a, b, e.ratio), hi: Math.max(a, b, e.ratio) } : null });
}

/** A ratio from the quad's own focal length that moves more than this for 2 px of corner error is not used. */
export const PERSPECTIVE_MAX_SPREAD = 0.005;
const SPREAD_PX = 2;

/** Largest relative ratio change when one corner coordinate moves by 2 px (`f2` fixed, or null = the quad's own f). */
function sensitivity(q: Quad, img: { w: number; h: number }, f2: number | null): number {
  const base = ratioOf(q, img, f2);
  if (base === null) return Infinity;
  let worst = 0;
  for (let i = 0; i < 4; i++) {
    for (const [dx, dy] of [
      [SPREAD_PX, 0],
      [-SPREAD_PX, 0],
      [0, SPREAD_PX],
      [0, -SPREAD_PX],
    ]) {
      const moved = q.map((p, j) => (j === i ? { x: p.x + dx, y: p.y + dy } : p)) as Quad;
      const r = ratioOf(moved, img, f2);
      worst = Math.max(worst, r === null ? Infinity : Math.abs(r / base - 1));
    }
  }
  return worst;
}

function ratioOf(q: Quad, img: { w: number; h: number }, f2: number | null): number | null {
  const c = aspectParts(q, img);
  if (!c) return null;
  if (c.parallel) return c.ratioAt(0);
  const f = f2 ?? c.f2;
  return f === null ? null : c.ratioAt(f);
}

function aspectParts(q: Quad, img: { w: number; h: number }) {
  const diag = Math.hypot(img.w, img.h);
  if (!(diag > 0)) return null;
  // principal point at the origin, lengths in image diagonals (keeps the numbers near 1)
  const m = (p: Pt): V3 => [(p.x - img.w / 2) / diag, (p.y - img.h / 2) / diag, 1];
  const m1 = m(q[0]); // (0, 0)
  const m2 = m(q[1]); // (w, 0)
  const m4 = m(q[2]); // (w, h)
  const m3 = m(q[3]); // (0, h)
  const c14 = cross3(m1, m4);
  const den2 = dot3(cross3(m2, m4), m3);
  const den3 = dot3(cross3(m3, m4), m2);
  if (!(Math.abs(den2) > 1e-15) || !(Math.abs(den3) > 1e-15)) return null;
  const k2 = dot3(c14, m3) / den2;
  const k3 = dot3(c14, m2) / den3;
  const n2: V3 = [k2 * m2[0] - m1[0], k2 * m2[1] - m1[1], k2 * m2[2] - m1[2]];
  const n3: V3 = [k3 * m3[0] - m1[0], k3 * m3[1] - m1[1], k3 * m3[2] - m1[2]];
  const ratioAt = (f2: number) => Math.sqrt((n2[0] ** 2 + n2[1] ** 2 + f2 * n2[2] ** 2) / (n3[0] ** 2 + n3[1] ** 2 + f2 * n3[2] ** 2));
  const flat = (v: number) => Math.abs(v) < 1e-9;
  const parallel = flat(n2[2]) && flat(n3[2]);
  let f2: number | null = null;
  if (!flat(n2[2]) && !flat(n3[2])) {
    const v = -(n2[0] * n3[0] + n2[1] * n3[1]) / (n2[2] * n3[2]);
    if (v >= FOCAL_RANGE_DIAG[0] ** 2 && v <= FOCAL_RANGE_DIAG[1] ** 2) f2 = v;
  }
  return { diag, ratioAt, parallel, f2 };
}
