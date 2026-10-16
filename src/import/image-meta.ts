// Image headers (JPEG/PNG; HEIC/WebP detected for conversion): pixel size, EXIF orientation and the declared density
// (EXIF X/YResolution, JFIF density, PNG pHYs) → an optional physical size suggestion (D48). Pure: reads bytes only.
import { MM_PER_IN } from '@/engine/units';

import { checkFileBytes, tooManyPixels, type LimitError } from './limits';

export type ImageFormat = 'jpeg' | 'png' | 'heic' | 'webp' | 'gif' | 'tiff' | 'bmp';
export type Density = { dpiX: number; dpiY: number; source: 'exif' | 'jfif' | 'png' };
export type ImageMeta = {
  format: 'jpeg' | 'png';
  /** Stored pixel size (as encoded) */
  rawW: number;
  rawH: number;
  /** EXIF orientation 1–8 (1 when absent) */
  orientation: number;
  /** Pixel size as displayed (orientation applied) — the natural size the editor and the PDF use */
  pxW: number;
  pxH: number;
  density: Density | null;
  /** Physical size from the declared density, unless it is a 72/96 dpi placeholder (D48) */
  sizeMm: { w: number; h: number } | null;
};
export type ImageMetaError = LimitError | 'tooManyPixels' | 'corrupt' | 'unsupportedFormat' | 'needsConversion';
export type ImageMetaResult = { ok: true; meta: ImageMeta } | { ok: false; error: ImageMetaError; format?: ImageFormat };

export function detectFormat(b: Uint8Array): ImageFormat | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'png';
  const ascii = (o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));
  if (b.length >= 12 && ascii(4, 4) === 'ftyp' && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1|avif)$/.test(ascii(8, 4))) return 'heic';
  if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'webp';
  if (b.length >= 6 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')) return 'gif';
  if (b.length >= 4 && ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 42 && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 42))) return 'tiff';
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) return 'bmp';
  return null;
}

/** dpi within 0.5 of 72 or 96 on either axis = a placeholder written by cameras, phones and editors (D48). */
export const isPlaceholderDpi = (d: Density) => [d.dpiX, d.dpiY].some((v) => Math.abs(v - 72) < 0.5 || Math.abs(v - 96) < 0.5);

// ------------------------------------------------------------------------------------------------ density maths
/** PNG pHYs: unit 1 = pixels per metre; 0 = aspect ratio only. */
export function densityFromPhys(ppuX: number, ppuY: number, unit: number): Density | null {
  if (unit !== 1 || !(ppuX > 0 && ppuY > 0)) return null;
  return { dpiX: ppuX * 0.0254, dpiY: ppuY * 0.0254, source: 'png' };
}
/** JFIF APP0: units 1 = dots per inch, 2 = dots per cm, 0 = aspect ratio only. */
export function densityFromJfif(x: number, y: number, units: number): Density | null {
  if ((units !== 1 && units !== 2) || !(x > 0 && y > 0)) return null;
  return units === 1 ? { dpiX: x, dpiY: y, source: 'jfif' } : { dpiX: x * 2.54, dpiY: y * 2.54, source: 'jfif' };
}
/** EXIF IFD0 XResolution/YResolution (rationals) with ResolutionUnit 2 = inch (default), 3 = cm, 1 = none. */
export function densityFromExif(x: [number, number], y: [number, number], unit: number): Density | null {
  if (unit === 1 || !(x[0] > 0 && x[1] > 0 && y[0] > 0 && y[1] > 0)) return null;
  const dx = x[0] / x[1];
  const dy = y[0] / y[1];
  return unit === 3 ? { dpiX: dx * 2.54, dpiY: dy * 2.54, source: 'exif' } : { dpiX: dx, dpiY: dy, source: 'exif' };
}
export function physicalSizeMm(pxW: number, pxH: number, d: Density | null): { w: number; h: number } | null {
  if (!d || isPlaceholderDpi(d)) return null;
  return { w: (pxW * MM_PER_IN) / d.dpiX, h: (pxH * MM_PER_IN) / d.dpiY };
}

/** EXIF orientation: raw pixel (x, y) in a w × h image → displayed pixel (TIFF 6.0 tag 274). */
export function orientPoint(o: number, x: number, y: number, w: number, h: number): { x: number; y: number } {
  switch (o) {
    case 2:
      return { x: w - x, y };
    case 3:
      return { x: w - x, y: h - y };
    case 4:
      return { x, y: h - y };
    case 5:
      return { x: y, y: x };
    case 6:
      return { x: h - y, y: x };
    case 7:
      return { x: h - y, y: w - x };
    case 8:
      return { x: y, y: w - x };
    default:
      return { x, y };
  }
}

// ------------------------------------------------------------------------------------------------ parsers
const u16be = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const u32be = (b: Uint8Array, o: number) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];

type Exif = { orientation: number; density: Density | null };

function readExif(b: Uint8Array, start: number, end: number): Exif | null {
  // "Exif\0\0" then a TIFF header
  if (end - start < 14 || String.fromCharCode(...b.subarray(start, start + 4)) !== 'Exif') return null;
  const t = start + 6;
  const le = b[t] === 0x49 && b[t + 1] === 0x49;
  if (!le && !(b[t] === 0x4d && b[t + 1] === 0x4d)) return null;
  const u16 = (o: number) => (le ? b[o] | (b[o + 1] << 8) : u16be(b, o));
  const u32 = (o: number) => (le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000 : u32be(b, o));
  if (u16(t + 2) !== 42) return null;
  const ifd = t + u32(t + 4);
  if (ifd + 2 > end) return null;
  const n = u16(ifd);
  let orientation = 1;
  let xr: [number, number] | null = null;
  let yr: [number, number] | null = null;
  let unit = 2;
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > end) break;
    const tag = u16(e);
    const type = u16(e + 2);
    if (tag === 0x0112 && type === 3) orientation = u16(e + 8);
    else if (tag === 0x0128 && type === 3) unit = u16(e + 8);
    else if ((tag === 0x011a || tag === 0x011b) && type === 5) {
      const o = t + u32(e + 8);
      if (o + 8 <= end) {
        const r: [number, number] = [u32(o), u32(o + 4)];
        if (tag === 0x011a) xr = r;
        else yr = r;
      }
    }
  }
  return { orientation: orientation >= 1 && orientation <= 8 ? orientation : 1, density: xr && yr ? densityFromExif(xr, yr, unit) : null };
}

function readJpeg(b: Uint8Array): Omit<ImageMeta, 'pxW' | 'pxH' | 'sizeMm' | 'format'> | null {
  let o = 2;
  let jfif: Density | null = null;
  let exif: Exif | null = null;
  while (o + 4 <= b.length) {
    if (b[o] !== 0xff) return null;
    const marker = b[o + 1];
    if (marker === 0xff) {
      o++;
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      o += 2;
      continue;
    }
    const len = u16be(b, o + 2);
    if (len < 2 || o + 2 + len > b.length) return null;
    const s = o + 4;
    const e = o + 2 + len;
    if (marker === 0xe0 && len >= 16 && String.fromCharCode(...b.subarray(s, s + 5)) === 'JFIF\0') jfif = densityFromJfif(u16be(b, s + 8), u16be(b, s + 10), b[s + 7]);
    else if (marker === 0xe1 && !exif) exif = readExif(b, s, e);
    else if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const h = u16be(b, s + 1);
      const w = u16be(b, s + 3);
      if (!(w > 0 && h > 0)) return null;
      return { rawW: w, rawH: h, orientation: exif?.orientation ?? 1, density: exif?.density ?? jfif };
    } else if (marker === 0xd9 || marker === 0xda) return null;
    o = e;
  }
  return null;
}

function readPng(b: Uint8Array): Omit<ImageMeta, 'pxW' | 'pxH' | 'sizeMm' | 'format'> | null {
  if (b.length < 33 || String.fromCharCode(...b.subarray(12, 16)) !== 'IHDR') return null;
  const w = u32be(b, 16);
  const h = u32be(b, 20);
  if (!(w > 0 && h > 0)) return null;
  let density: Density | null = null;
  let orientation = 1;
  let o = 8;
  while (o + 12 <= b.length) {
    const len = u32be(b, o);
    const type = String.fromCharCode(...b.subarray(o + 4, o + 8));
    const s = o + 8;
    if (s + len > b.length) break;
    if (type === 'pHYs' && len === 9) density = densityFromPhys(u32be(b, s), u32be(b, s + 4), b[s + 8]);
    else if (type === 'eXIf') {
      // eXIf holds a bare TIFF block: reuse the EXIF reader with a synthetic "Exif\0\0" prefix
      const buf = new Uint8Array(len + 6);
      buf.set([0x45, 0x78, 0x69, 0x66, 0, 0]);
      buf.set(b.subarray(s, s + len), 6);
      orientation = readExif(buf, 0, buf.length)?.orientation ?? 1;
    } else if (type === 'IDAT' || type === 'IEND') break;
    o = s + len + 4;
  }
  return { rawW: w, rawH: h, orientation, density };
}

/** Reads an image's header (no decoding). HEIC/WebP → 'needsConversion' (P5 converts them to JPEG first). */
export function readImageMeta(bytes: Uint8Array): ImageMetaResult {
  const size = checkFileBytes(bytes.length);
  if (size) return { ok: false, error: size };
  const format = detectFormat(bytes);
  if (format === 'heic' || format === 'webp') return { ok: false, error: 'needsConversion', format };
  if (format !== 'jpeg' && format !== 'png') return { ok: false, error: format ? 'unsupportedFormat' : 'corrupt', format: format ?? undefined };
  let head: ReturnType<typeof readJpeg>;
  try {
    head = format === 'jpeg' ? readJpeg(bytes) : readPng(bytes);
  } catch {
    head = null;
  }
  if (!head) return { ok: false, error: 'corrupt', format };
  if (tooManyPixels(head.rawW, head.rawH)) return { ok: false, error: 'tooManyPixels', format };
  const swap = head.orientation >= 5;
  const pxW = swap ? head.rawH : head.rawW;
  const pxH = swap ? head.rawW : head.rawH;
  // density is per stored axis; displayed axes swap with the orientation
  const d = head.density && swap ? { ...head.density, dpiX: head.density.dpiY, dpiY: head.density.dpiX } : head.density;
  return { ok: true, meta: { format, ...head, pxW, pxH, density: d, sizeMm: physicalSizeMm(pxW, pxH, d) } };
}

/**
 * EXIF FocalLengthIn35mmFilm (Exif sub-IFD tag 0xA405) of a JPEG — phones write it; the scan planner uses it to
 * estimate a rectangle's true shape when the corners alone cannot (V15 F22). Null when absent, 0 or unreadable.
 */
export function readFocal35mm(b: Uint8Array): number | null {
  if (detectFormat(b) !== 'jpeg') return null;
  let o = 2;
  while (o + 4 <= b.length && b[o] === 0xff) {
    const marker = b[o + 1];
    if (marker === 0xff || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      o += marker === 0xff ? 1 : 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) return null;
    const len = u16be(b, o + 2);
    if (len < 2 || o + 2 + len > b.length) return null;
    const s = o + 4;
    const end = o + 2 + len;
    if (marker === 0xe1 && end - s >= 14 && String.fromCharCode(...b.subarray(s, s + 4)) === 'Exif') return focalFromExif(b, s + 6, end);
    o = end;
  }
  return null;
}

function focalFromExif(b: Uint8Array, t: number, end: number): number | null {
  const le = b[t] === 0x49 && b[t + 1] === 0x49;
  if (!le && !(b[t] === 0x4d && b[t + 1] === 0x4d)) return null;
  const u16 = (o: number) => (le ? b[o] | (b[o + 1] << 8) : u16be(b, o));
  const u32 = (o: number) => (le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000 : u32be(b, o));
  const find = (ifd: number, tag: number): number | null => {
    if (ifd + 2 > end) return null;
    const n = u16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (e + 12 > end) return null;
      if (u16(e) !== tag) continue;
      const type = u16(e + 2);
      if (type === 3) return u16(e + 8);
      if (type === 4) return u32(e + 8);
      return null;
    }
    return null;
  };
  if (u16(t + 2) !== 42) return null;
  const sub = find(t + u32(t + 4), 0x8769);
  if (sub === null) return null;
  const f = find(t + sub, 0xa405);
  return f && f > 0 ? f : null;
}

/**
 * The 35 mm focal length from expo-image-picker's `asset.exif` (option `exif: true`; review S7). Where it comes from
 * (expo-image-picker 57.0.20 native code, read 2026-10-16; on a phone: IMPLEMENTED BUT UNVERIFIED until A2):
 * - iOS: ImageIO's Exif dictionary of the ORIGINAL file (library: the HEIC/JPEG PHPicker hands over; camera: the
 *   capture's media metadata), merged with TIFF and "GPS…" keys → key `FocalLenIn35mmFilm` (a number).
 * - Android: `ExifInterface` of the picked/captured file → key `FocalLengthIn35mmFilm` (an int; present only when the
 *   tag exists).
 * Also accepts a nested `{Exif}` dictionary. 0, negative, non-numbers and missing → null (the planner then decides
 * plausibility, `PLAUSIBLE_FOCAL_35MM`). Only this one number is kept: GPS and the rest of the EXIF are not stored.
 */
export function focalFromPickerExif(exif: unknown): number | null {
  if (!exif || typeof exif !== 'object') return null;
  const e = exif as Record<string, unknown>;
  const nested = e['{Exif}'] && typeof e['{Exif}'] === 'object' ? (e['{Exif}'] as Record<string, unknown>) : {};
  for (const v of [e.FocalLenIn35mmFilm, e.FocalLengthIn35mmFilm, nested.FocalLenIn35mmFilm]) {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}
