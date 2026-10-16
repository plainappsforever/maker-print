/**
 * Minimal PDF content-stream interpreter for tests (precision probe, P2). It reads the bytes the writer produced,
 * inflates each content stream and follows q/Q/cm/Do, collecting every path segment and text show in PDF points
 * (y up), including Form XObjects. It never looks at the PrintPlan — positions are re-derived from the file.
 * Structure lookup (pages, resources, streams) uses pdf-lib's parser; the geometry is ours.
 */
import { inflateSync } from 'node:zlib';

import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream } from '@cantoo/pdf-lib';

type M = [number, number, number, number, number, number];
export type Seg = { x0: number; y0: number; x1: number; y1: number; widthPt: number; ctm: M };
export type Shown = { x: number; y: number; ctm: M; hex: string };
/** An image XObject drawn with this CTM (it maps the unit square, PDF image space). */
export type ShownImage = { ctm: M; width: number; height: number };
export type ProbePage = { mediaBox: number[]; segments: Seg[]; texts: Shown[]; images: ShownImage[]; rawMediaBox: string };

const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
];
const ap = (m: M, x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

function streamText(s: PDFStream): string {
  const raw = s as PDFRawStream;
  const filter = raw.dict.get(PDFName.of('Filter'));
  const bytes = raw.getContents();
  return Buffer.from(filter ? inflateSync(Buffer.from(bytes)) : Buffer.from(bytes)).toString('latin1');
}

function tokens(src: string): string[] {
  return src.match(/<[0-9A-Fa-f\s]*>|\/[^\s/<>[\]()]+|\[|\]|[^\s/<>[\]()]+/g) ?? [];
}

export async function probePdf(bytes: Uint8Array): Promise<ProbePage[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const ctx = doc.context;
  const pages: ProbePage[] = [];
  for (const page of doc.getPages()) {
    const segs: Seg[] = [];
    const texts: Shown[] = [];
    const images: ShownImage[] = [];
    const run = (src: string, ctm0: M, resources: PDFDict | undefined) => {
      const stack: M[] = [];
      let ctm = ctm0;
      let lw = 1;
      let cur = { x: 0, y: 0 };
      let start = { x: 0, y: 0 };
      const args: string[] = [];
      for (const t of tokens(src)) {
        if (/^[-+]?[\d.]+$/.test(t) || t.startsWith('/') || t.startsWith('<') || t === '[' || t === ']') {
          args.push(t);
          continue;
        }
        const n = args.map(Number);
        switch (t) {
          case 'q': stack.push(ctm); break;
          case 'Q': ctm = stack.pop()!; break;
          case 'cm': ctm = mul(n.slice(-6) as M, ctm); break;
          case 'w': lw = n[n.length - 1]; break;
          case 'm': cur = start = { x: n[0], y: n[1] }; break;
          case 'l': {
            segs.push({ x0: cur.x, y0: cur.y, x1: n[0], y1: n[1], widthPt: lw, ctm });
            cur = { x: n[0], y: n[1] };
            break;
          }
          case 'c': cur = { x: n[4], y: n[5] }; break;
          case 'h': cur = start; break;
          case 're': break;
          case 'Tj': texts.push({ x: 0, y: 0, ctm, hex: args[args.length - 1] }); break;
          case 'Do': {
            const name = args[args.length - 1].slice(1);
            const xobjs = resources?.lookup(PDFName.of('XObject'), PDFDict);
            const ref = xobjs?.get(PDFName.of(name));
            const xo = (ref instanceof PDFRef ? ctx.lookup(ref) : ref) as PDFStream;
            if (xo.dict.get(PDFName.of('Subtype'))?.toString() === '/Image') {
              const num = (k: string) => (xo.dict.lookup(PDFName.of(k), PDFNumber) as PDFNumber).asNumber();
              images.push({ ctm, width: num('Width'), height: num('Height') });
              break;
            }
            const mat = xo.dict.lookup(PDFName.of('Matrix'), PDFArray);
            const fm = mat ? (mat.asArray().map((v) => (v as PDFNumber).asNumber()) as M) : ([1, 0, 0, 1, 0, 0] as M);
            run(streamText(xo), mul(fm, ctm), (xo.dict.lookup(PDFName.of('Resources'), PDFDict) as PDFDict | undefined) ?? resources);
            break;
          }
        }
        args.length = 0;
      }
    };
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray().map((r) => ctx.lookup(r) as PDFStream) : [contents as PDFStream];
    run(streams.map(streamText).join('\n'), [1, 0, 0, 1, 0, 0], page.node.Resources());
    const mb = page.node.MediaBox();
    pages.push({ mediaBox: mb.asArray().map((v) => (v as PDFNumber).asNumber()), segments: segs, texts, images, rawMediaBox: mb.toString() });
  }
  return pages;
}

/** A segment's end points in PDF points (device space of the page). */
export function segPt(s: Seg) {
  return { a: ap(s.ctm, s.x0, s.y0), b: ap(s.ctm, s.x1, s.y1) };
}
export const ptToMm = (pt: number) => (pt * 25.4) / 72;
