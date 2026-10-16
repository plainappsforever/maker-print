// AssetPainter for the PDF writer (D38 hook, D49/D50): images, imported PDF pages and normalised SVGs drawn at their
// natural size. Each asset (each PDF page) is embedded ONCE and reused by copies, tiles and the assembly map.
// The writer has already set the CTM to the asset's natural coordinates (origin top-left, y down; image px, PDF/SVG mm).
import {
  appendBezierCurve,
  clip,
  clipEvenOdd,
  closePath,
  concatTransformationMatrix,
  drawObject,
  endPath,
  fill,
  fillEvenOdd,
  fillAndStroke,
  LineCapStyle,
  LineJoinStyle,
  lineTo,
  moveTo,
  type PDFDict,
  PDFName,
  PDFNumber,
  PDFOperator,
  PDFOperatorNames,
  popGraphicsState,
  pushGraphicsState,
  setDashPattern,
  setFillingRgbColor,
  setGraphicsState,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingRgbColor,
  stroke,
  type PDFDocument,
  type PDFOperator as Op,
  type PDFPage,
  type PDFRef,
} from '@cantoo/pdf-lib';

import { compose, type Affine } from '@/engine/geometry';
import type { Seg } from '@/engine/path';
import { readImageMeta } from '@/import/image-meta';
import { geometryOfPage, loadPdf } from '@/import/pdf-boxes';
import { hiddenLayers, suppressHiddenLayers } from '@/import/pdf-layers';
import { mapSeg, readSvg, type SvgDrawing, type SvgItem } from '@/import/svg/normalise';
import { viewportMatrix } from '@/import/svg/units';

import type { AssetPainter } from './writer';

export type AssetSource = { kind: 'image'; bytes: Uint8Array } | { kind: 'pdf'; bytes: Uint8Array } | { kind: 'svg'; text: string };
/** Loads an asset's file (app: from the documents folder; tests/referee: from fixtures). null = missing. */
export type AssetLoader = (assetId: number) => Promise<AssetSource | null>;

const cm = (m: Affine) => concatTransformationMatrix(m[0], m[1], m[2], m[3], m[4], m[5]);

/** EXIF orientation as an affine map raw px → displayed px (same table as `orientPoint`). */
export function orientationMatrix(o: number, w: number, h: number): Affine {
  switch (o) {
    case 2:
      return [-1, 0, 0, 1, w, 0];
    case 3:
      return [-1, 0, 0, -1, w, h];
    case 4:
      return [1, 0, 0, -1, 0, h];
    case 5:
      return [0, 1, 1, 0, 0, 0];
    case 6:
      return [0, 1, -1, 0, h, 0];
    case 7:
      return [0, -1, -1, 0, h, w];
    case 8:
      return [0, -1, 1, 0, 0, w];
    default:
      return [1, 0, 0, 1, 0, 0];
  }
}

/** PDF image space (unit square, y up, row 0 at the top) → natural px (displayed, y down). */
export function imageMatrix(rawW: number, rawH: number, orientation: number, natural: { w: number; h: number }): Affine {
  const swap = orientation >= 5;
  const dw = swap ? rawH : rawW;
  const dh = swap ? rawW : rawH;
  const unitToRaw: Affine = [rawW, 0, 0, -rawH, 0, rawH];
  return compose(compose([natural.w / dw, 0, 0, natural.h / dh, 0, 0], orientationMatrix(orientation, rawW, rawH)), unitToRaw);
}

/** Appends the path operators of `segs` to `out` (never `push(...big)` — P3.5 finding 2). */
function segOps(segs: readonly Seg[], out: Op[]): Op[] {
  for (const s of segs) {
    if (s.c === 'M') out.push(moveTo(s.p.x, s.p.y));
    else if (s.c === 'L') out.push(lineTo(s.p.x, s.p.y));
    else if (s.c === 'C') out.push(appendBezierCurve(s.p1.x, s.p1.y, s.p2.x, s.p2.y, s.p.x, s.p.y));
    else out.push(closePath());
  }
  return out;
}

const CAP = { butt: LineCapStyle.Butt, round: LineCapStyle.Round, square: LineCapStyle.Projecting } as const;
const JOIN = { miter: LineJoinStyle.Miter, round: LineJoinStyle.Round, bevel: LineJoinStyle.Bevel } as const;

/** Operators for one SVG item in root user space; `gs` returns the ExtGState name for a fill/stroke alpha pair. */
export function svgItemOps(it: SvgItem, gs: (fillAlpha: number, strokeAlpha: number) => string | null, ops: Op[] = []): Op[] {
  ops.push(pushGraphicsState());
  for (const c of it.clips) {
    segOps(c.segs.map((s) => mapSeg(s, c.matrix)), ops);
    ops.push(c.evenOdd ? clipEvenOdd() : clip(), endPath());
  }
  ops.push(cm(it.matrix));
  const name = gs(it.fill?.alpha ?? 1, it.stroke?.alpha ?? 1);
  if (name) ops.push(setGraphicsState(name));
  if (it.fill) ops.push(setFillingRgbColor(...it.fill.rgb));
  if (it.stroke) {
    const s = it.stroke;
    ops.push(setStrokingRgbColor(...s.rgb), setLineWidth(s.width), setLineCap(CAP[s.cap]), setLineJoin(JOIN[s.join]), PDFOperator.of(PDFOperatorNames.SetLineMiterLimit, [PDFNumber.of(s.miter)]));
    if (s.dash) ops.push(setDashPattern(s.dash, s.dashOffset));
  }
  segOps(it.segs, ops);
  const eo = it.fill?.evenOdd ?? false;
  if (it.fill && it.stroke) ops.push(eo ? PDFOperator.of(PDFOperatorNames.FillEvenOddAndStroke) : fillAndStroke());
  else if (it.fill) ops.push(eo ? fillEvenOdd() : fill());
  else ops.push(stroke());
  ops.push(popGraphicsState());
  return ops;
}

/** The whole drawing as one Form XObject in natural mm (root viewport = BBox, so it clips like an SVG viewport). */
export function svgForm(doc: PDFDocument, drawing: SvgDrawing, natural: { w: number; h: number }): PDFRef {
  const states = new Map<string, string>();
  const extG: Record<string, PDFDict> = {};
  const gs = (fa: number, sa: number) => {
    if (fa >= 1 && sa >= 1) return null;
    const key = `${fa}/${sa}`;
    let n = states.get(key);
    if (!n) {
      n = `GS${states.size}`;
      states.set(key, n);
      extG[n] = doc.context.obj({ Type: 'ExtGState', ca: fa, CA: sa });
    }
    return n;
  };
  const ops: Op[] = [cm(viewportMatrix(drawing.viewBox, natural.w, natural.h, drawing.par))];
  for (const it of drawing.items) svgItemOps(it, gs, ops);
  const stream = doc.context.formXObject(ops, { BBox: [0, 0, natural.w, natural.h], Resources: Object.keys(extG).length ? doc.context.obj({ ExtGState: doc.context.obj(extG) }) : doc.context.obj({}) });
  return doc.context.register(stream);
}

/**
 * The last big SVG read, kept across writes (REVIEW_V1 finding 10): the print screen rewrites its preview PDF after
 * every change, and reading a 10 MB SVG costs seconds each time on a phone. One entry, only for SVG text of 256 KB or
 * more; the same text and languages give the same drawing (readSvg is pure and the drawing is never changed).
 */
let lastSvg: { text: string; langs: string; result: ReturnType<typeof readSvg> } | null = null;
export const SVG_CACHE_MIN_CHARS = 256 * 1024;
export function readSvgCached(text: string, languages?: readonly string[]): ReturnType<typeof readSvg> {
  const langs = (languages ?? []).join(',');
  if (lastSvg && lastSvg.langs === langs && lastSvg.text === text) return lastSvg.result;
  const result = readSvg(text, { languages });
  lastSvg = text.length >= SVG_CACHE_MIN_CHARS ? { text, langs, result } : lastSvg;
  return result;
}

type Embedded = { ref: PDFRef; matrix: Affine } | { ref: null };

/**
 * Creates the painter for one PDF document. Unreadable sources throw: the writer turns that into an `assetNotDrawn`
 * note (never a silent gap).
 */
/** `languages`: the app language for SVG `systemLanguage` (D59) — the same list the import used. */
export function createAssetPainter(load: AssetLoader, options: { languages?: readonly string[] } = {}): AssetPainter {
  const cache = new Map<string, Promise<Embedded>>();
  const sources = new Map<number, Promise<AssetSource | null>>();
  const pdfDocs = new Map<number, ReturnType<typeof loadPdf>>();
  const layers = new Map<number, { hidden: Set<string> | null; done: Set<string> }>();
  const src = (id: number) => {
    let p = sources.get(id);
    if (!p) {
      p = load(id);
      sources.set(id, p);
    }
    return p;
  };

  async function embed(doc: PDFDocument, kind: string, assetId: number, pageIndex: number, natural: { w: number; h: number }): Promise<Embedded> {
    const s = await src(assetId);
    if (!s) throw new Error('asset file missing');
    if (kind === 'image') {
      if (s.kind !== 'image') throw new Error('asset is not an image');
      const meta = readImageMeta(s.bytes);
      if (!meta.ok) throw new Error(`image unreadable: ${meta.error}`);
      const img = meta.meta.format === 'jpeg' ? await doc.embedJpg(s.bytes) : await doc.embedPng(s.bytes);
      return { ref: img.ref, matrix: imageMatrix(meta.meta.rawW, meta.meta.rawH, meta.meta.orientation, natural) };
    }
    if (kind === 'pdf_page') {
      if (s.kind !== 'pdf') throw new Error('asset is not a PDF');
      let loaded = pdfDocs.get(assetId);
      if (!loaded) {
        loaded = loadPdf(s.bytes);
        pdfDocs.set(assetId, loaded);
      }
      const l = await loaded;
      if (!l.ok) throw new Error(`PDF unreadable: ${l.error}`);
      const page = l.doc.getPages()[pageIndex];
      if (!page) throw new Error('PDF page missing');
      const g = geometryOfPage(page);
      if (!g.hasContent) return { ref: null }; // an empty page prints empty
      // hidden layers do not print (finding 4): rewrite this private copy's content before embedding
      let lay = layers.get(assetId);
      if (!lay) {
        lay = { hidden: hiddenLayers(l.doc), done: new Set() };
        layers.set(assetId, lay);
      }
      if (lay.hidden) suppressHiddenLayers(l.doc, page, lay.hidden, true, lay.done);
      const [x0, y0, x1, y1] = g.box;
      const ep = await doc.embedPage(page, { left: x0, bottom: y0, right: x1, top: y1 }, [1, 0, 0, 1, 0, 0]);
      return { ref: ep.ref, matrix: compose([natural.w / g.wMm, 0, 0, natural.h / g.hMm, 0, 0], g.matrix) };
    }
    if (kind === 'svg') {
      if (s.kind !== 'svg') throw new Error('asset is not an SVG');
      const r = readSvgCached(s.text, options.languages);
      if (!r.ok) throw new Error(`SVG unreadable: ${r.error}`);
      return { ref: svgForm(doc, r.drawing, natural), matrix: [1, 0, 0, 1, 0, 0] };
    }
    throw new Error(`unknown asset kind ${kind}`);
  }

  const names = new WeakMap<PDFPage, Map<PDFRef, PDFName>>();
  return async (op, { doc, page }) => {
    const { assetId, pageIndex, natural } = op.source;
    const key = `${op.kind}:${assetId}:${pageIndex}:${natural.w}x${natural.h}`;
    let e = cache.get(key);
    if (!e) {
      e = embed(doc, op.kind, assetId, pageIndex, natural);
      cache.set(key, e);
    }
    const emb = await e;
    if (!emb.ref) return [];
    let pageNames = names.get(page);
    if (!pageNames) {
      pageNames = new Map();
      names.set(page, pageNames);
    }
    let n = pageNames.get(emb.ref);
    if (!n) {
      n = page.node.newXObject(op.kind === 'image' ? 'Im' : 'Ax', emb.ref);
      pageNames.set(emb.ref, n);
    }
    return [pushGraphicsState(), cm(emb.matrix), drawObject(n), popGraphicsState()];
  };
}
