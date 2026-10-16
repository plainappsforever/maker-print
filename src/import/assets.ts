// Import glue (D50): inspects a picked file, produces the `assets` row fields and the report JSON, and turns a stored
// row back into the plan's natural sizes (PlanAsset). Pure apart from pdf-lib parsing; file copying lives in
// src/lib/files.ts (P5).
import type { PlanAsset } from '@/engine/plan';
import type { ScanRecord } from '@/engine/scan';

import { checkFileBytes } from './limits';
import { readImageMeta, type Density, type ImageMetaError } from './image-meta';
import { readPdf, type PdfPageNote, type PdfReadError } from './pdf-boxes';
import { readSvg, type SvgReadError } from './svg/normalise';
import type { SvgIssue } from './svg/report';
import { svgNaturalSize } from './svg/units';

export type AssetKind = 'image' | 'pdf' | 'svg';

/** Stored in `assets.report` (JSON object). Version 1. `scan` (V15 F22, optional): the image is a straightened scan and
 *  `sizeMm` is the size the scan was given (typed or estimated, see `scan.warnings`), not a declared density. */
export type AssetReport =
  | { v: 1; kind: 'image'; format: 'jpeg' | 'png'; orientation: number; density: Density | null; sizeMm: { w: number; h: number } | null; scan?: ScanRecord }
  | { v: 1; kind: 'pdf'; restricted: boolean; pages: { w: number; h: number; rotate: number; notes: PdfPageNote[] }[] }
  | { v: 1; kind: 'svg'; needsPpi: boolean; issues: SvgIssue[]; drawn: number; root: { width: string | null; height: string | null; viewBox: string | null } };

export type InspectError = ImageMetaError | PdfReadError | SvgReadError | 'notText' | 'compressedSvg';
export type Inspected = {
  kind: AssetKind;
  pxW: number | null;
  pxH: number | null;
  pageCount: number | null;
  /** null unless the SVG needs the units question (the UI asks once and calls `setSvgPxPerIn`) */
  needsPpi: boolean;
  report: AssetReport;
};

type InspectResult = { ok: true; asset: Inspected } | { ok: false; error: InspectError };

/**
 * Reads a picked file's header/structure; refuses with a SPEC §12 reason, never half-imports, never throws (P3.5
 * finding 3): an unforeseen runtime limit is `tooComplex`, any other unexpected failure `corrupt`.
 */
export async function inspectAsset(kind: AssetKind, bytes: Uint8Array, options: { languages?: readonly string[] } = {}): Promise<InspectResult> {
  try {
    return await inspect(kind, bytes, options.languages);
  } catch (e) {
    return { ok: false, error: e instanceof RangeError ? 'tooComplex' : 'corrupt' };
  }
}

async function inspect(kind: AssetKind, bytes: Uint8Array, languages?: readonly string[]): Promise<InspectResult> {
  if (kind === 'image') {
    const r = readImageMeta(bytes);
    if (!r.ok) return { ok: false, error: r.error };
    const m = r.meta;
    return {
      ok: true,
      asset: { kind, pxW: m.pxW, pxH: m.pxH, pageCount: null, needsPpi: false, report: { v: 1, kind: 'image', format: m.format, orientation: m.orientation, density: m.density, sizeMm: m.sizeMm } },
    };
  }
  if (kind === 'pdf') {
    const r = await readPdf(bytes);
    if (!r.ok) return { ok: false, error: r.error };
    return {
      ok: true,
      asset: { kind, pxW: null, pxH: null, pageCount: r.pageCount, needsPpi: false, report: { v: 1, kind: 'pdf', restricted: r.restricted, pages: r.pages.map((p) => ({ w: p.wMm, h: p.hMm, rotate: p.rotate, notes: p.notes })) } },
    };
  }
  const lim = checkFileBytes(bytes.length);
  if (lim) return { ok: false, error: lim };
  const dec = decodeSvgText(bytes);
  if (!dec.ok) return dec;
  const r = readSvg(dec.text, { languages });
  if (!r.ok) return { ok: false, error: r.error };
  const root = r.drawing.root;
  const size = svgNaturalSize(root.width, root.height, root.viewBox, 96);
  if (!size.ok) return { ok: false, error: size.error };
  return { ok: true, asset: { kind, pxW: null, pxH: null, pageCount: null, needsPpi: size.needsPpi, report: { v: 1, kind: 'svg', needsPpi: size.needsPpi, issues: r.report.issues, drawn: r.report.drawn, root } } };
}

// cp1252 0x80–0x9F (browsers decode "ISO-8859-1" this way too, WHATWG Encoding); undefined slots stay as latin-1
const CP1252 = [0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178];

/**
 * SVG file bytes → text (P3.5 finding 14): UTF-16 by BOM (or "<\0"), the XML declaration's Latin-1 / Windows-1252
 * family, else strict UTF-8. gzip (.svgz) is recognised and refused with its own message (no pinned gunzip). The
 * app's file loader for the painter must use this too, so import and print read the same text.
 */
export function decodeSvgText(bytes: Uint8Array): { ok: true; text: string } | { ok: false; error: 'notText' | 'compressedSvg' } {
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) return { ok: false, error: 'compressedSvg' };
  const le = (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0x3c && bytes[1] === 0);
  const be = (bytes[0] === 0xfe && bytes[1] === 0xff) || (bytes[0] === 0 && bytes[1] === 0x3c);
  if (le || be) {
    const start = bytes[0] === 0xff || bytes[0] === 0xfe ? 2 : 0;
    const parts: string[] = [];
    let chunk: number[] = [];
    for (let i = start; i + 1 < bytes.length; i += 2) {
      chunk.push(le ? bytes[i] | (bytes[i + 1] << 8) : (bytes[i] << 8) | bytes[i + 1]);
      if (chunk.length === 8192) {
        parts.push(String.fromCharCode.apply(null, chunk));
        chunk = [];
      }
    }
    parts.push(String.fromCharCode.apply(null, chunk));
    return { ok: true, text: parts.join('') };
  }
  let head = '';
  for (let i = 0; i < Math.min(bytes.length, 200); i++) head += String.fromCharCode(bytes[i]);
  const enc = /^\s*<\?xml[^>]*?encoding\s*=\s*["']([\w.:-]+)["']/i.exec(head)?.[1].toLowerCase();
  if (enc && /^(iso[-_]?8859-1|latin-?1|l1|windows-1252|cp1252|us-ascii|ascii)$/.test(enc)) {
    const parts: string[] = [];
    for (let i = 0; i < bytes.length; i += 8192) {
      const chunk = Array.from(bytes.subarray(i, i + 8192), (c) => (c >= 0x80 && c < 0xa0 ? CP1252[c - 0x80] : c));
      parts.push(String.fromCharCode.apply(null, chunk));
    }
    return { ok: true, text: parts.join('') };
  }
  const text = decodeUtf8(bytes);
  return text === null ? { ok: false, error: 'notText' } : { ok: true, text };
}

/** Strict UTF-8 → string (BOM dropped); null for invalid bytes. TextDecoder when the runtime has it (Node), else a
 *  small decoder (Hermes builds may lack TextDecoder). */
export function decodeUtf8(bytes: Uint8Array): string | null {
  if (typeof TextDecoder !== 'undefined') {
    try {
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
    } catch {
      return null;
    }
  }
  let out = '';
  let i = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  while (i < bytes.length) {
    const b = bytes[i];
    let cp: number;
    let n: number;
    if (b < 0x80) [cp, n] = [b, 0];
    else if (b >= 0xc2 && b < 0xe0) [cp, n] = [b & 0x1f, 1];
    else if (b >= 0xe0 && b < 0xf0) [cp, n] = [b & 0x0f, 2];
    else if (b >= 0xf0 && b < 0xf5) [cp, n] = [b & 0x07, 3];
    else return null;
    if (i + n >= bytes.length + (n ? 0 : 1)) return null;
    for (let k = 1; k <= n; k++) {
      const c = bytes[i + k];
      if ((c & 0xc0) !== 0x80) return null;
      cp = (cp << 6) | (c & 0x3f);
    }
    if ((n === 2 && (cp < 0x800 || (cp >= 0xd800 && cp < 0xe000))) || (n === 3 && (cp < 0x10000 || cp > 0x10ffff))) return null;
    out += String.fromCodePoint(cp);
    i += n + 1;
  }
  return out;
}

/** The size an SVG gets at a given ppi answer — for the units dialog ("96 → 105.8 × 79.4 mm"). */
export function svgSizeAt(report: AssetReport, ppi: number): { w: number; h: number } | null {
  if (report.kind !== 'svg') return null;
  const s = svgNaturalSize(report.root.width, report.root.height, report.root.viewBox, ppi);
  return s.ok ? { w: s.wMm, h: s.hMm } : null;
}

const isReport = (r: unknown): r is AssetReport => typeof r === 'object' && r !== null && (r as { v?: unknown }).v === 1 && typeof (r as { kind?: unknown }).kind === 'string';

/**
 * A stored asset row → the plan's natural sizes. SVG: the stored ppi answer, or none needed; an unanswered units
 * question or a missing/corrupt report gives no size, which the planner reports (`assetSizeUnknown`) instead of guessing.
 */
export function planAssetOf(row: { id: number; kind: AssetKind; pxW: number | null; pxH: number | null; svgPxPerIn: number | null; report: unknown; originalName?: string }): PlanAsset {
  const base: PlanAsset = { id: row.id, kind: row.kind, pxW: row.pxW, pxH: row.pxH, ...(row.originalName ? { name: row.originalName } : {}) };
  const rep = isReport(row.report) ? row.report : null;
  if (row.kind === 'pdf' && rep?.kind === 'pdf') {
    // PDF notes per page that change what prints (hidden layers, annotations not printed — D56); size notes are not gaps
    const pageNotes = rep.pages.map((p) => p.notes.filter((n) => n === 'hiddenLayers' || n === 'annotationsNotPrinted').length);
    return { ...base, pageSizesMm: rep.pages.map((p) => ({ w: p.w, h: p.h })), ...(pageNotes.some((n) => n > 0) ? { gaps: { notDrawn: 0, approximated: 0, pageNotes } } : {}) };
  }
  if (row.kind === 'svg' && rep?.kind === 'svg') {
    const count = (sev: string) => rep.issues.filter((i) => i.severity === sev).reduce((n, i) => n + i.count, 0);
    const gaps = { notDrawn: count('notDrawn'), approximated: count('approximated') };
    const withGaps = gaps.notDrawn + gaps.approximated > 0 ? { ...base, gaps } : base;
    if (rep.needsPpi && !(row.svgPxPerIn && row.svgPxPerIn > 0)) return { ...withGaps, naturalMm: null };
    const s = svgNaturalSize(rep.root.width, rep.root.height, rep.root.viewBox, row.svgPxPerIn ?? 96);
    return { ...withGaps, naturalMm: s.ok ? { w: s.wMm, h: s.hMm } : null };
  }
  return base;
}
