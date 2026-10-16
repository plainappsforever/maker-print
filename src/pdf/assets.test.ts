/**
 * @jest-environment node
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';

import { PDFDocument, PDFName, PDFRawStream } from '@cantoo/pdf-lib';

import { uniformMargins } from '@/engine/paper';
import { planPrint, type PlanObject } from '@/engine/plan';
import { printTranslator } from '@/i18n';
import { inspectAsset, planAssetOf } from '@/import/assets';

import { probePdf, ptToMm, segPt } from '../../test/pdf-probe';
import { createAssetPainter, readSvgCached, SVG_CACHE_MIN_CHARS, type AssetSource } from './assets';
import { writePdf } from './writer';

const fx = (p: string) => new Uint8Array(readFileSync(path.join(__dirname, '../../test/fixtures', p)));
const ctx = { locale: 'en' as const, unit: 'mm' as const, inchStyle: 'fraction16' as const, t: printTranslator('en') };
const output = { paperKey: 'a4' as const, orientation: 'auto' as const, margins: uniformMargins(6.35), overlapMm: 10, marks: 'registration' as const, pageLabels: true, assemblyMap: 'auto' as const, skipBlank: true, excludedTiles: [], checkBar: false, ppiTarget: 300 };
const object = (o: Partial<PlanObject> & Pick<PlanObject, 'id' | 'kind' | 'x' | 'y' | 'w' | 'h'>): PlanObject => ({ sheetId: 1, z: 0, assetId: null, pageIndex: 0, rotationDeg: 0, mirrorX: false, mirrorY: false, crop: null, fit: 'fill', repeat: null, props: {}, hidden: false, ...o });

async function write(assets: { id: number; kind: 'image' | 'pdf' | 'svg'; file: string; svgPxPerIn?: number }[], objects: PlanObject[], missing: number[] = []) {
  const files = new Map<number, AssetSource>();
  const planAssets = [];
  for (const a of assets) {
    const bytes = fx(a.file);
    files.set(a.id, a.kind === 'svg' ? { kind: 'svg', text: new TextDecoder().decode(bytes) } : { kind: a.kind, bytes });
    const r = await inspectAsset(a.kind, bytes);
    if (!r.ok) throw new Error(r.error);
    planAssets.push(planAssetOf({ id: a.id, kind: a.kind, pxW: r.asset.pxW, pxH: r.asset.pxH, svgPxPerIn: a.svgPxPerIn ?? null, report: r.asset.report }));
  }
  const plan = planPrint({ sheets: [{ id: 1, widthMm: 210, heightMm: 297 }], objects, assets: planAssets, output, ctx });
  const painter = createAssetPainter(async (id) => (missing.includes(id) ? null : (files.get(id) ?? null)));
  return writePdf(plan, { title: 't', checkBarCaption: 'c', paintAsset: painter, useObjectStreams: false });
}

/** Decoded content of every Form XObject in the file */
async function forms(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  const out: string[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream && obj.dict.get(PDFName.of('Subtype'))?.toString() === '/Form') {
      const raw = obj.getContents();
      out.push(Buffer.from(obj.dict.get(PDFName.of('Filter')) ? inflateSync(Buffer.from(raw)) : Buffer.from(raw)).toString('latin1'));
    }
  }
  return out;
}
const count = (bytes: Uint8Array, s: string) => Buffer.from(bytes).toString('latin1').split(s).length - 1;

describe('createAssetPainter (D49/D50): assets drawn at natural size, embedded once', () => {
  it('SVG: path coordinates in the file land at the expected page millimetres (independent content-stream probe)', async () => {
    const { bytes, notes } = await write([{ id: 1, kind: 'svg', file: 'svg/inkscape-mm.svg' }], [object({ id: 1, kind: 'svg', assetId: 1, x: 15, y: 15, w: 100, h: 50 })]);
    expect(notes).toEqual([]);
    const [page] = await probePdf(bytes);
    const H = ptToMm(page.mediaBox[3]);
    const pts = page.segments.map(segPt).flatMap((s) => [s.a, s.b]).map((p) => [ptToMm(p.x), H - ptToMm(p.y)]);
    const red = pts.filter(([x, y]) => x < 60 && y < 50);
    const xs = red.map((p) => p[0]);
    const ys = red.map((p) => p[1]);
    for (const [got, want] of [[Math.min(...xs), 25], [Math.max(...xs), 55], [Math.min(...ys), 25], [Math.max(...ys), 45]]) expect(Math.abs(got - want)).toBeLessThan(1e-9);
  });

  it('copies, repeats and two objects of one asset share ONE embedded form / image', async () => {
    const svg = await write([{ id: 1, kind: 'svg', file: 'svg/transforms-arcs.svg' }], [
      object({ id: 1, kind: 'svg', assetId: 1, x: 10, y: 10, w: 60, h: 60, repeat: { cols: 2, rows: 2, gap_x_mm: 5, gap_y_mm: 5, trim_marks: false } }),
      object({ id: 2, kind: 'svg', assetId: 1, x: 10, y: 150, w: 60, h: 60 }),
    ]);
    expect(svg.notes).toEqual([]);
    expect((await forms(svg.bytes)).length).toBe(1);
    const img = await write([{ id: 1, kind: 'image', file: 'images/red-square-300dpi.png' }], [object({ id: 1, kind: 'image', assetId: 1, x: 10, y: 10, w: 40, h: 40 }), object({ id: 2, kind: 'image', assetId: 1, x: 60, y: 10, w: 40, h: 40 })]);
    expect(count(img.bytes, '/Subtype /Image')).toBe(1);
    expect((await probePdf(img.bytes))[0].images).toHaveLength(2);
  });

  it('JPEG with EXIF orientation 6: the raw top-left pixel lands at the box top-right', async () => {
    const { bytes } = await write([{ id: 1, kind: 'image', file: 'images/orient6.jpg' }], [object({ id: 1, kind: 'image', assetId: 1, x: 100, y: 90, w: 40, h: 60 })]);
    const [page] = await probePdf(bytes);
    const [im] = page.images;
    expect([im.width, im.height]).toEqual([300, 200]); // stored raw
    const H = ptToMm(page.mediaBox[3]);
    const at = (u: number, v: number) => {
      const m = im.ctm;
      return [ptToMm(m[0] * u + m[2] * v + m[4]), H - ptToMm(m[1] * u + m[3] * v + m[5])].map((x) => Math.round(x * 1e9) / 1e9);
    };
    expect(at(0, 1)).toEqual([140, 90]); // raw top-left (image space y up) → displayed top-right
    expect(at(1, 0)).toEqual([100, 150]); // raw bottom-right → displayed bottom-left
  });

  it('SVG dashes, joins, miter limit, even-odd and alpha reach the PDF (drawSvg dropped them)', async () => {
    const { bytes } = await write([{ id: 1, kind: 'svg', file: 'svg/unsupported.svg' }, { id: 2, kind: 'svg', file: 'svg/affinity-percent.svg', svgPxPerIn: 96 }], [
      object({ id: 1, kind: 'svg', assetId: 1, x: 10, y: 10, w: 50, h: 50 }),
      object({ id: 2, kind: 'svg', assetId: 2, x: 10, y: 100, w: (400 * 25.4) / 96, h: (200 * 25.4) / 96 }),
    ]);
    const all = (await forms(bytes)).join('\n');
    expect(all).toMatch(/\[1 2\] 0 d/);
    expect(all).toMatch(/^4 M$/m); // SVG default miter limit 4 (PDF default would be 10)
    expect(all).toMatch(/^0 j$/m);
    expect(all).toMatch(/\bf\*/);
  });

  it('PDF pages: an owner-restricted (encrypted) PDF embeds; the output itself is not encrypted', async () => {
    const r = await write([{ id: 1, kind: 'pdf', file: 'pdf/encrypted-restricted.pdf' }], [object({ id: 1, kind: 'pdf_page', assetId: 1, x: 20, y: 20, w: 100, h: 60 })]);
    expect(r.notes).toEqual([]);
    const out = await PDFDocument.load(r.bytes);
    expect(out.isEncrypted).toBe(false);
    expect(count(r.bytes, '/Subtype /Form')).toBe(1);
  });

  it('a missing or unreadable file → assetNotDrawn with the reason, never a silent gap; other objects still print', async () => {
    const r = await write(
      [{ id: 1, kind: 'image', file: 'images/red-square-300dpi.png' }, { id: 2, kind: 'svg', file: 'svg/inkscape-mm.svg' }],
      [object({ id: 1, kind: 'image', assetId: 1, x: 10, y: 10, w: 40, h: 40 }), object({ id: 2, kind: 'svg', assetId: 2, x: 10, y: 60, w: 100, h: 50 })],
      [1]
    );
    expect(r.notes).toEqual([{ code: 'assetNotDrawn', objectId: 1, reason: 'asset file missing' }]);
    expect((await forms(r.bytes)).length).toBe(1);
  });
});

// P3.5 review finding 2: one SVG path with 200 000 segments threw "Maximum call stack size exceeded" (push(...segOps))
it('a 200 000-segment SVG path imports and paints without a note', async () => {
  const d = ['M0 0'];
  for (let i = 1; i <= 200_000; i++) d.push(`L${(i % 1000) / 10} ${Math.floor(i / 1000) / 2}`);
  const text = `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"><path d="${d.join(' ')}" stroke="red" fill="none"/></svg>`;
  const bytes = new TextEncoder().encode(text);
  const r = await inspectAsset('svg', bytes);
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  const pa = planAssetOf({ id: 1, kind: 'svg', pxW: null, pxH: null, svgPxPerIn: null, report: r.asset.report });
  const plan = planPrint({ sheets: [{ id: 1, widthMm: 210, heightMm: 297 }], objects: [object({ id: 1, kind: 'svg', assetId: 1, x: 20, y: 20, w: 100, h: 100 })], assets: [pa], output, ctx });
  const { bytes: pdf, notes } = await writePdf(plan, { title: 't', checkBarCaption: 'c', paintAsset: createAssetPainter(async () => ({ kind: 'svg', text })), useObjectStreams: false });
  expect(notes).toEqual([]);
  const [form] = await forms(pdf);
  expect(form.split(' l\n').length - 1).toBe(200_000);
}, 30_000);

describe('readSvgCached (v1.1, REVIEW_V1 finding 10)', () => {
  it('a big SVG is read once across writes; small ones are not kept', () => {
    const rects = Array.from({ length: 9000 }, (_, i) => `<rect x="${i % 100}" y="${Math.floor(i / 100)}" width="0.5" height="0.5"/>`).join('');
    const big = `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100">${rects}</svg>`;
    expect(big.length).toBeGreaterThanOrEqual(SVG_CACHE_MIN_CHARS);
    const a = readSvgCached(big, ['en']);
    expect(readSvgCached(`${big}`.slice(0), ['en'])).toBe(a);
    expect(readSvgCached(big, ['de'])).not.toBe(a);
    const small = '<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm"><rect width="5" height="5"/></svg>';
    expect(readSvgCached(small)).not.toBe(readSvgCached(small));
  });
});
