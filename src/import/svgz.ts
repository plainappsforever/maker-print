// Compressed SVG (.svgz, Inkscape's "compressed SVG"; V15_PLAN X03, phase A1): gunzip with a size cap, before the SVG
// reader sees the text. The plain SVG is what gets stored, so import and print read the same file. Pure (fflate).
import { Gunzip } from 'fflate';

import { LIMITS } from './limits';

export type SvgzError =
  /** the unpacked drawing is larger than a plain SVG may be (50 MB) — also what a "zip bomb" gets */
  | 'compressedTooLarge'
  /** truncated or damaged gzip data */
  | 'compressedCorrupt';

export const isGzip = (b: Uint8Array) => b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b;

/** Input slice per push: deflate expands at most ~1032 : 1, so one slice adds at most ~4 MB before the cap is checked. */
const SLICE = 4096;

/**
 * Unpacks gzip data (one or more members) into at most `maxBytes`. Stops as soon as the output passes the cap, so a
 * small file that would unpack to gigabytes never gets there.
 */
export function gunzipCapped(bytes: Uint8Array, maxBytes: number = LIMITS.fileBytes): { ok: true; bytes: Uint8Array } | { ok: false; error: SvgzError } {
  if (!isGzip(bytes) || bytes.length < 18) return { ok: false, error: 'compressedCorrupt' };
  // the ISIZE footer is not used: it can lie (bombs), and in a truncated file those 4 bytes are deflate data
  const n = bytes.length;
  const chunks: Uint8Array[] = [];
  let total = 0;
  let over = false;
  let ended = false;
  const g = new Gunzip((chunk, final) => {
    total += chunk.length;
    if (total > maxBytes) over = true;
    else chunks.push(chunk);
    if (final) ended = true;
  });
  try {
    for (let o = 0; o < n && !over; o += SLICE) g.push(bytes.subarray(o, Math.min(n, o + SLICE)), o + SLICE >= n);
  } catch {
    return { ok: false, error: over ? 'compressedTooLarge' : 'compressedCorrupt' };
  }
  if (over) return { ok: false, error: 'compressedTooLarge' };
  if (!ended) return { ok: false, error: 'compressedCorrupt' };
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return { ok: true, bytes: out };
}

/** "drawing.svgz" / "drawing.svg.gz" → "drawing.svg"; anything else gets ".svg" added. */
export function plainSvgName(name: string): string {
  const base = name.replace(/\.svgz$/i, '').replace(/\.svg\.gz$/i, '').replace(/\.gz$/i, '');
  return /\.svg$/i.test(base) ? base : `${base || 'drawing'}.svg`;
}

/** A picked SVG file: gzip → the plain SVG and its new name; plain files pass through unchanged. */
export function unwrapSvgz(bytes: Uint8Array, name: string): { ok: true; bytes: Uint8Array; name: string } | { ok: false; error: SvgzError } {
  if (!isGzip(bytes)) return { ok: true, bytes, name };
  const r = gunzipCapped(bytes);
  if (!r.ok) return r;
  return { ok: true, bytes: r.bytes, name: plainSvgName(name) };
}
