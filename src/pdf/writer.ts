// PrintPlan → PDF bytes with @cantoo/pdf-lib 2.11.1 (D15, V1_PLAN "PDF writer"). Pure TypeScript, runs in Node
// (Jest) and on Hermes. Exact geometry: page size = paper size in points with full double precision; every engine
// length stays in mm inside the content stream — ONE matrix (`toPdf`) per page maps y-down mm to y-up points, so
// pdf-lib writes our coordinates bit for bit (its numberToString is String(n)). /PrintScaling /None on every file.
import {
  appendBezierCurve,
  beginText,
  clip,
  closePath,
  concatTransformationMatrix,
  drawObject,
  endPath,
  endText,
  fill,
  fillAndStroke,
  LineCapStyle,
  lineTo,
  moveTo,
  PDFDocument,
  PDFName,
  type PDFFont,
  type PDFOperator,
  type PDFPage,
  type PDFRef,
  popGraphicsState,
  PrintScaling,
  pushGraphicsState,
  rectangle,
  setFillingRgbColor,
  setFontAndSize,
  setLineCap,
  setLineWidth,
  setStrokingRgbColor,
  showText,
  StandardFonts,
  stroke,
} from '@cantoo/pdf-lib';

import { checkBarContent, checkBarMatrix } from '@/engine/checkbar';
import type { Affine, Rect } from '@/engine/geometry';
import { contentBounds, parsePath, type Content, type PathItem, type TextItem } from '@/engine/path';
import type { ObjectOp, Page, PrintPlan } from '@/engine/plan';
import { sanitiseText, textWidthMm } from '@/engine/text-metrics';
import { MM_PER_IN, mmToPt, PT_PER_IN } from '@/engine/units';

/** pt per mm, exact ratio of the two definitions */
const K = PT_PER_IN / MM_PER_IN;
const FONT = 'F1';

/** The only y-flip: page mm (origin top-left, y down) → PDF points (origin bottom-left, y up). */
export function toPdf(page: { heightMm: number }): Affine {
  return [K, 0, 0, -K, 0, mmToPt(page.heightMm)];
}

/**
 * Draws an asset object's source (image, PDF page, SVG) in its natural coordinates (y down, [0,nw]×[0,nh]).
 * Provided by `createAssetPainter` (src/pdf/assets.ts); the writer has already applied page clip, object transform, box
 * clip and source map. A painter that throws produces an `assetNotDrawn` note.
 */
export type AssetPainter = (op: ObjectOp & { source: NonNullable<ObjectOp['source']> }, ctx: { doc: PDFDocument; page: PDFPage }) => Promise<PDFOperator[]>;

export type WriteOptions = {
  /** PDF Title (project name). Producer is "Maker Print"; no creator, dates, device or user info (SPEC §13). */
  title: string;
  /** Translated check-bar caption ("This bar must measure 100 mm") */
  checkBarCaption: string;
  paintAsset?: AssetPainter;
  /** false only in tests, to inspect the file more easily (V1_PLAN) */
  useObjectStreams?: boolean;
};
/**
 * `assetNotDrawn`: the object's file was missing or unreadable — reported once per op, never a silent gap.
 * `opNotDrawn`: any other op that failed to produce operators (a bug or a resource limit) — the page is still written
 * without it and the note says which page; the writer itself never throws for one bad op (P3.5 finding 2).
 */
export type WriteNote = { code: 'assetNotDrawn'; objectId: number; reason: string } | { code: 'opNotDrawn'; page: number; op: string; reason: string };
export type WriteResult = { bytes: Uint8Array; notes: WriteNote[] };

const cm = (m: Affine) => concatTransformationMatrix(m[0], m[1], m[2], m[3], m[4], m[5]);

/**
 * P3.5 finding 2: never pass a big array as call arguments (`push(...ops)`, `pushOperators(...ops)`): V8 throws
 * "Maximum call stack size exceeded" above ~120 000 arguments and Hermes' limit is unknown (likely lower — P4 measures).
 * Operators are appended one by one and handed to pdf-lib in chunks of OPERATOR_CHUNK.
 */
export const OPERATOR_CHUNK = 1000;
export function appendAll<T>(target: T[], items: readonly T[]): T[] {
  for (let i = 0; i < items.length; i++) target.push(items[i]);
  return target;
}
const clipTo = (r: Rect): PDFOperator[] => [rectangle(r.x, r.y, r.w, r.h), clip(), endPath()];

function pathOperators(p: PathItem, ops: PDFOperator[] = []): PDFOperator[] {
  ops.push(pushGraphicsState());
  if (p.stroke) ops.push(setStrokingRgbColor(...p.stroke), setLineWidth(p.widthMm), setLineCap(p.cap === 'round' ? LineCapStyle.Round : LineCapStyle.Butt));
  if (p.fill) ops.push(setFillingRgbColor(...p.fill));
  for (const s of parsePath(p.d)) {
    if (s.c === 'M') ops.push(moveTo(s.p.x, s.p.y));
    else if (s.c === 'L') ops.push(lineTo(s.p.x, s.p.y));
    else if (s.c === 'C') ops.push(appendBezierCurve(s.p1.x, s.p1.y, s.p2.x, s.p2.y, s.p.x, s.p.y));
    else ops.push(closePath());
  }
  ops.push(p.stroke && p.fill ? fillAndStroke() : p.fill ? fill() : p.stroke ? stroke() : endPath(), popGraphicsState());
  return ops;
}

function textOperators(t: TextItem, font: PDFFont): PDFOperator[] {
  const text = sanitiseText(t.text.replace(/\n/g, ' ')).text;
  if (!text) return [];
  // local flip so glyphs stand upright on the y-down page; the font size is in mm because the CTM is in mm
  return [
    pushGraphicsState(),
    cm([1, 0, 0, -1, t.x, t.y]),
    setFillingRgbColor(...t.colour),
    beginText(),
    setFontAndSize(FONT, t.sizeMm),
    showText(font.encodeText(text)),
    endText(),
    popGraphicsState(),
  ];
}

function contentOperators(c: Content, font: PDFFont): PDFOperator[] {
  const ops: PDFOperator[] = [];
  for (const p of c.paths) pathOperators(p, ops);
  for (const t of c.texts) appendAll(ops, textOperators(t, font));
  return ops;
}

export async function writePdf(plan: Pick<PrintPlan, 'pages' | 'content'>, options: WriteOptions): Promise<WriteResult> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setTitle(options.title);
  doc.setProducer('Maker Print');
  doc.catalog.getOrCreateViewerPreferences().setPrintScaling(PrintScaling.None);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontResources = () => doc.context.obj({ Font: { [FONT]: font.ref } });
  const notes: WriteResult['notes'] = [];

  // one Form XObject per vector object and one for the check bar, reused by copies, tiles and the map
  const forms = new Map<string, PDFRef>();
  const form = (key: string, c: Content, box?: { w: number; h: number }): PDFRef => {
    const hit = forms.get(key);
    if (hit) return hit;
    const b = contentBounds(c, (t) => textWidthMm(t.text, t.sizeMm)) ?? { x: 0, y: 0, w: 0, h: 0 };
    const x0 = Math.min(b.x, 0) - 1;
    const y0 = Math.min(b.y, 0) - 1;
    const x1 = Math.max(b.x + b.w, box?.w ?? 0) + 1;
    const y1 = Math.max(b.y + b.h, box?.h ?? 0) + 1;
    const stream = doc.context.formXObject(contentOperators(c, font), { BBox: [x0, y0, x1, y1], Resources: fontResources() });
    const ref = doc.context.register(stream);
    forms.set(key, ref);
    return ref;
  };

  let names = new Map<PDFRef, PDFName>();
  const xobject = (pdfPage: PDFPage, ref: PDFRef, tag: string) => {
    let n = names.get(ref);
    if (!n) {
      n = pdfPage.node.newXObject(tag, ref);
      names.set(ref, n);
    }
    return n;
  };

  for (const [pageIndex, page] of plan.pages.entries()) {
    names = new Map();
    const pdfPage = doc.addPage([mmToPt(page.widthMm), mmToPt(page.heightMm)]);
    pdfPage.node.setFontDictionary(PDFName.of(FONT), font.ref);
    const ops: PDFOperator[] = [pushGraphicsState(), cm(toPdf(page))];
    if (page.correction) ops.push(cm(page.correction));
    // D53: a landscape frame is turned a quarter turn onto the portrait page (inside the correction, which is in page terms)
    if (page.rotation) ops.push(cm(page.rotation));
    for (const op of page.ops) {
      try {
        appendAll(ops, await opOperators(op, pdfPage));
      } catch (e) {
        notes.push({ code: 'opNotDrawn', page: pageIndex + 1, op: 'role' in op ? `${op.op}/${op.role}` : op.op, reason: e instanceof Error ? e.message : String(e) });
      }
    }
    ops.push(popGraphicsState());
    for (let i = 0; i < ops.length; i += OPERATOR_CHUNK) pdfPage.pushOperators(...ops.slice(i, i + OPERATOR_CHUNK));
  }

  async function opOperators(op: Page['ops'][number], pdfPage: PDFPage): Promise<PDFOperator[]> {
    switch (op.op) {
      case 'path':
        return op.clip ? [...pathOperators(op, [pushGraphicsState(), ...clipTo(op.clip)]), popGraphicsState()] : pathOperators(op);
      case 'text':
        return textOperators(op, font);
      case 'checkBar': {
        const name = xobject(pdfPage, form('checkBar', checkBarContent(options.checkBarCaption)), 'CB');
        return [pushGraphicsState(), cm(checkBarMatrix(op.x, op.y, op.vertical)), drawObject(name), popGraphicsState()];
      }
      case 'object': {
        const content = plan.content[op.objectId];
        if (content) {
          const name = xobject(pdfPage, form(`o${op.objectId}`, content, op.box), 'Fm');
          return [pushGraphicsState(), ...clipTo(op.clip), cm(op.transform), drawObject(name), popGraphicsState()];
        }
        if (op.source && options.paintAsset) {
          try {
            const painted = await options.paintAsset(op as ObjectOp & { source: NonNullable<ObjectOp['source']> }, { doc, page: pdfPage });
            const out = [pushGraphicsState(), ...clipTo(op.clip), cm(op.transform), ...clipTo({ x: 0, y: 0, w: op.box.w, h: op.box.h }), cm(op.source.map)];
            return appendAll(out, painted).concat(popGraphicsState());
          } catch (e) {
            notes.push({ code: 'assetNotDrawn', objectId: op.objectId, reason: e instanceof Error ? e.message : String(e) });
            return [];
          }
        }
        notes.push({ code: 'assetNotDrawn', objectId: op.objectId, reason: 'no painter' });
        return [];
      }
    }
  }

  const bytes = await doc.save({ useObjectStreams: options.useObjectStreams ?? true });
  return { bytes, notes };
}
