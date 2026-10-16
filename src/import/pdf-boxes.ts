// PDF import: physical page sizes (SPEC §8.10, W9, D15, D50) and the file checks of SPEC §11/§12. The box maths is
// pure; `readPdf` uses @cantoo/pdf-lib only to read the page dictionaries (no rendering).
import { decodePDFRawStream, PDFArray, PDFContentStream, PDFDocument, PDFName, PDFNumber, PDFRawStream, type PDFPage } from '@cantoo/pdf-lib';

import type { Affine } from '@/engine/geometry';
import { MM_PER_IN, PT_PER_IN } from '@/engine/units';

import { checkFileBytes, LIMITS, type LimitError } from './limits';
import { hiddenLayers, printedAnnotations, suppressHiddenLayers } from './pdf-layers';

export type PdfRect = readonly [x0: number, y0: number, x1: number, y1: number];
export type PdfPageGeometry = {
  /** Effective box in user space (normalised: x0 < x1, y0 < y1) */
  box: PdfRect;
  /** 0 / 90 / 180 / 270 */
  rotate: number;
  userUnit: number;
  /** Physical size as displayed (rotation applied), mm */
  wMm: number;
  hMm: number;
  /** User space → natural coordinates (displayed page, origin top-left, y down, mm) */
  matrix: Affine;
  notes: PdfPageNote[];
};
/** `hiddenLayers`: content in layers that are hidden for printing is left out, as Acrobat does (finding 4).
 *  `annotationsNotPrinted`: the page has printable annotations / filled form fields that Maker Print does not draw (finding 5). */
export type PdfPageNote = 'rotateInvalid' | 'userUnitInvalid' | 'cropBoxIgnored' | 'hiddenLayers' | 'annotationsNotPrinted';

export const normRect = (r: PdfRect): PdfRect => [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])];

/** SPEC §8.10: box = CropBox ∩ MediaBox (else MediaBox) × UserUnit; w/h swapped for /Rotate 90/270. */
export function pageGeometry(media: PdfRect, crop: PdfRect | null, userUnit: number | null, rotate: number | null): PdfPageGeometry {
  const notes: PdfPageNote[] = [];
  const m = normRect(media);
  let box = m;
  if (crop) {
    const c = normRect(crop);
    const i: PdfRect = [Math.max(m[0], c[0]), Math.max(m[1], c[1]), Math.min(m[2], c[2]), Math.min(m[3], c[3])];
    if (i[2] > i[0] && i[3] > i[1]) box = i;
    else notes.push('cropBoxIgnored');
  }
  let r = (((rotate ?? 0) % 360) + 360) % 360;
  if (r % 90 !== 0) {
    r = 0;
    notes.push('rotateInvalid');
  }
  let u = userUnit ?? 1;
  if (!(u > 0) || !Number.isFinite(u)) {
    u = 1;
    notes.push('userUnitInvalid');
  }
  const k = (u * MM_PER_IN) / PT_PER_IN;
  const bw = box[2] - box[0];
  const bh = box[3] - box[1];
  const [x0, y0, x1, y1] = box;
  // displayed = rotated clockwise by r; natural y runs down from the displayed top edge
  const matrix: Affine =
    r === 0 ? [k, 0, 0, -k, -x0 * k, y1 * k] : r === 90 ? [0, k, k, 0, -y0 * k, -x0 * k] : r === 180 ? [-k, 0, 0, k, x1 * k, -y0 * k] : [0, -k, -k, 0, y1 * k, x1 * k];
  const swap = r === 90 || r === 270;
  return { box, rotate: r, userUnit: u, wMm: (swap ? bh : bw) * k, hMm: (swap ? bw : bh) * k, matrix, notes };
}

// ------------------------------------------------------------------------------------------------ reading a file
export type PdfReadError = LimitError | 'encrypted' | 'corrupt' | 'noPages' | 'tooManyPages';
export type PdfPageInfo = PdfPageGeometry & { index: number; hasContent: boolean };
export type PdfInfo = { ok: true; pageCount: number; pages: PdfPageInfo[]; /** opened with the empty user password (owner restrictions only) */ restricted: boolean } | { ok: false; error: PdfReadError };

function rectOf(a: PDFArray | undefined): PdfRect | null {
  if (!a || a.size() < 4) return null;
  const v = [0, 1, 2, 3].map((i) => a.lookupMaybe(i, PDFNumber)?.asNumber());
  return v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? (v as unknown as PdfRect) : null;
}

/** Page dictionary → geometry (inherited MediaBox/CropBox/Rotate resolved by pdf-lib). */
export function geometryOfPage(page: PDFPage): PdfPageGeometry & { hasContent: boolean } {
  const node = page.node;
  const media = rectOf(node.MediaBox()) ?? [0, 0, 612, 792]; // PDF 32000 requires MediaBox; Letter if absent
  const crop = rectOf(node.CropBox());
  const uu = node.context.lookupMaybe(node.get(PDFName.of('UserUnit')), PDFNumber)?.asNumber() ?? null;
  const rot = node.Rotate()?.asNumber() ?? 0;
  return { ...pageGeometry(media, crop, uu, rot), hasContent: !!node.Contents() };
}

/**
 * Opens a PDF for import. Encrypted files are tried once with the empty user password (files that only restrict
 * printing/editing open in every viewer that way); a real password → 'encrypted' (SPEC §12 message).
 */
export async function loadPdf(bytes: Uint8Array): Promise<{ ok: true; doc: PDFDocument; restricted: boolean } | { ok: false; error: PdfReadError }> {
  const size = checkFileBytes(bytes.length);
  if (size) return { ok: false, error: size };
  let doc: PDFDocument;
  let restricted = false;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
  } catch {
    return { ok: false, error: 'corrupt' };
  }
  if (doc.isEncrypted) {
    try {
      doc = await PDFDocument.load(bytes, { updateMetadata: false, password: '' });
      restricted = true;
      // a wrong password does not throw: the streams decode to garbage. Check the first page's content decodes.
      const first = doc.getPages()[0];
      if (first && !contentLooksDecrypted(first)) return { ok: false, error: 'encrypted' };
    } catch {
      return { ok: false, error: 'encrypted' };
    }
  }
  return { ok: true, doc, restricted };
}

function contentLooksDecrypted(page: PDFPage): boolean {
  const contents = page.node.Contents();
  if (!contents) return true;
  const first = contents instanceof PDFArray ? contents.lookup(0) : contents;
  if (first instanceof PDFContentStream) return true;
  if (!(first instanceof PDFRawStream)) return true;
  try {
    return looksLikeContent(decodePDFRawStream(first).decode());
  } catch {
    return false;
  }
}

/**
 * Content streams are text operators: mostly printable ASCII. An inline image's binary data (BI … ID <data> EI) may
 * come first (P3.5 finding 18, suspected): then only the text before its ID is judged. Random bytes (a wrong
 * password) are ~37 % printable and do not contain "BI … ID".
 */
export function looksLikeContent(data: Uint8Array): boolean {
  let n = Math.min(data.length, 512);
  const isWs = (c: number) => c === 32 || c === 10 || c === 13 || c === 9;
  for (let i = 1; i + 2 < n; i++) {
    if (data[i] === 73 && data[i + 1] === 68 && isWs(data[i - 1]) && isWs(data[i + 2])) {
      let bi = false;
      for (let j = 0; j + 1 < i && !bi; j++) bi = data[j] === 66 && data[j + 1] === 73 && (j === 0 || isWs(data[j - 1]));
      if (bi) n = i;
      break;
    }
  }
  let printable = 0;
  for (let i = 0; i < n; i++) if ((data[i] >= 32 && data[i] < 127) || isWs(data[i])) printable++;
  return n === 0 || printable / n > 0.85;
}

export async function readPdf(bytes: Uint8Array): Promise<PdfInfo> {
  const loaded = await loadPdf(bytes);
  if (!loaded.ok) return loaded;
  let pages: PDFPage[];
  try {
    pages = loaded.doc.getPages();
  } catch {
    return { ok: false, error: 'corrupt' };
  }
  if (!pages.length) return { ok: false, error: 'noPages' };
  if (pages.length > LIMITS.pdfPages) return { ok: false, error: 'tooManyPages' };
  try {
    const hidden = hiddenLayers(loaded.doc);
    const info = pages.map((p, index) => {
      const g = geometryOfPage(p);
      const notes = [...g.notes];
      if (hidden && suppressHiddenLayers(loaded.doc, p, hidden, false) > 0) notes.push('hiddenLayers');
      if (printedAnnotations(loaded.doc, p, hidden) > 0) notes.push('annotationsNotPrinted');
      return { index, ...g, notes };
    });
    return { ok: true, pageCount: pages.length, pages: info, restricted: loaded.restricted };
  } catch {
    return { ok: false, error: 'corrupt' };
  }
}
