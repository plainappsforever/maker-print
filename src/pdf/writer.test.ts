import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PDFDict, PDFDocument, PDFName, StandardFonts } from '@cantoo/pdf-lib';

import { probePdf, ptToMm, segPt, type ProbePage } from '../../test/pdf-probe';
import { CHECK_BAR_LENGTH_MM } from '@/engine/checkbar';
import { apply, invert } from '@/engine/geometry';
import type { GenContext } from '@/engine/generators';
import { uniformMargins } from '@/engine/paper';
import { MAX_COPIES, MAX_OBJECT_DRAWS, planCalibration, planPrint, type OutputOptions, type PlanObject } from '@/engine/plan';
import { textWidthMm } from '@/engine/text-metrics';
import { mmToPt } from '@/engine/units';
import { printTranslator, translate } from '@/i18n';

import { toPdf, writePdf } from './writer';

const ctx: GenContext = { locale: 'en', unit: 'mm', inchStyle: 'fraction16', t: printTranslator('en') };
const caption = translate('en', 'check.measure');
const out = (o: Partial<OutputOptions> = {}): OutputOptions => ({
  paperKey: 'a4', orientation: 'auto', margins: uniformMargins(6.35), overlapMm: 10, marks: 'registration', pageLabels: true,
  assemblyMap: 'auto', skipBlank: true, excludedTiles: [], checkBar: true, ppiTarget: 300, ...o,
});
const obj = (o: Partial<PlanObject> & Pick<PlanObject, 'id' | 'kind' | 'x' | 'y' | 'w' | 'h'>): PlanObject => ({
  sheetId: 1, z: 0, assetId: null, pageIndex: 0, rotationDeg: 0, mirrorX: false, mirrorY: false, crop: null, fit: 'fill', repeat: null, props: {}, hidden: false, ...o,
});
/** Optional: `PDF_PROBE_OUT=<dir> npx jest src/pdf` writes the probe PDFs for the CoreGraphics raster probe. */
const dump = (name: string, bytes: Uint8Array) => {
  const dir = process.env.PDF_PROBE_OUT;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), bytes);
};

/** Segments in page mm, y down (inverse of the writer's toPdf, done here independently). */
function segsMm(p: ProbePage) {
  const H = p.mediaBox[3];
  return p.segments.map((s) => {
    const { a, b } = segPt(s);
    return { x0: ptToMm(a.x), y0: ptToMm(H - a.y), x1: ptToMm(b.x), y1: ptToMm(H - b.y) };
  });
}
const errors: Record<string, number> = {};
const record = (name: string, err: number) => (errors[name] = Math.max(errors[name] ?? 0, Math.abs(err)));

afterAll(() => {
  const dir = process.env.PDF_PROBE_OUT;
  if (dir) writeFileSync(join(dir, 'numeric-probe.json'), JSON.stringify(errors, null, 2));
});

describe('writePdf: document facts', () => {
  it('exact MediaBox, /PrintScaling /None, Title + Producer only', async () => {
    const plan = planPrint({ sheets: [{ id: 1, widthMm: 210, heightMm: 297 }], objects: [obj({ id: 1, kind: 'rect', x: 20, y: 20, w: 50, h: 30 })], output: out(), ctx });
    const { bytes, notes } = await writePdf(plan, { title: 'Decal test', checkBarCaption: caption, useObjectStreams: false });
    expect(notes).toEqual([]);
    const [page] = await probePdf(bytes);
    expect(page.mediaBox).toEqual([0, 0, 595.2755905511812, 841.8897637795276]);
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    const vp = doc.catalog.lookup(PDFName.of('ViewerPreferences'), PDFDict);
    expect(vp.get(PDFName.of('PrintScaling'))).toEqual(PDFName.of('None'));
    expect(doc.getTitle()).toBe('Decal test');
    expect(doc.getProducer()).toBe('Maker Print');
    expect([doc.getCreator(), doc.getAuthor(), doc.getCreationDate()]).toEqual([undefined, undefined, undefined]);
    expect(toPdf({ heightMm: 297 })).toEqual([72 / 25.4, 0, 0, -72 / 25.4, 0, 841.8897637795276]);
  });

  it('asset objects without a painter are reported, never silently dropped', async () => {
    const plan = planPrint({
      sheets: [{ id: 1, widthMm: 210, heightMm: 297 }],
      objects: [obj({ id: 9, kind: 'image', assetId: 1, x: 20, y: 20, w: 40, h: 30 })],
      assets: [{ id: 1, kind: 'image', pxW: 4032, pxH: 3024 }],
      output: out(),
      ctx,
    });
    expect((await writePdf(plan, { title: 't', checkBarCaption: caption })).notes).toEqual([{ code: 'assetNotDrawn', objectId: 9, reason: 'no painter' }]);
  });

  it('Helvetica widths in the engine equal pdf-lib’s for every printable character', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const chars = [...Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)), ...Array.from({ length: 96 }, (_, i) => String.fromCharCode(160 + i)), '€', '–', '—', '“', '”', '‘', '’', '…', '•'];
    for (const ch of chars) expect([ch, Math.round(textWidthMm(ch, 1000) * 1e6) / 1e6]).toEqual([ch, Math.round(font.widthOfTextAtSize(ch, 1000) * 1e6) / 1e6]);
  });
});

describe('precision probe: positions re-derived from the written bytes', () => {
  it('check bar: end lines exactly 100 mm apart (uncorrected) and 100·c with a correction', async () => {
    for (const fx of [1, 1.03627, 0.99602]) {
      const plan = planPrint({
        sheets: [{ id: 1, widthMm: 210, heightMm: 297 }],
        objects: [obj({ id: 1, kind: 'rect', x: 20, y: 20, w: 50, h: 30 })],
        output: out(),
        corrections: [{ paperKey: 'a4', jobKind: 'single', fx, fy: fx }],
        ctx,
      });
      const bar = plan.pages[0].ops.find((o) => o.op === 'checkBar')!;
      expect(bar).toBeTruthy();
      const { bytes } = await writePdf(plan, { title: 'cb', checkBarCaption: caption, useObjectStreams: false });
      if (fx === 1) dump('checkbar-a4.pdf', bytes);
      const [page] = await probePdf(bytes);
      // full-height ticks (6 mm long) are the 0, 10 … 100 lines; the outermost two are the bar's ends
      const full = segsMm(page).filter((s) => Math.abs(Math.hypot(s.x1 - s.x0, s.y1 - s.y0) - 6 * fx) < 1e-6);
      const xs = full.map((s) => s.x0).sort((a, b) => a - b);
      const length = xs[xs.length - 1] - xs[0];
      record(`checkBar×${fx}`, length - CHECK_BAR_LENGTH_MM * fx);
      expect(Math.abs(length - CHECK_BAR_LENGTH_MM * fx)).toBeLessThan(1e-9);
      if (bar.op === 'checkBar' && fx === 1) {
        record('checkBarPosition', xs[0] - bar.x);
        expect(Math.abs(xs[0] - bar.x)).toBeLessThan(1e-9);
      }
    }
  });

  it('calibration sheets A4 and Letter: bars A and B and their positions', async () => {
    for (const paperKey of ['a4', 'letter'] as const) {
      const cal = planCalibration({ paperKey, margins: uniformMargins(6.35), pages: 1, ctx });
      const { bytes } = await writePdf(cal, { title: `cal-${paperKey}`, checkBarCaption: caption, useObjectStreams: false });
      dump(`calibration-${paperKey}.pdf`, bytes);
      const [page] = await probePdf(bytes);
      expect(page.mediaBox.slice(2)).toEqual(paperKey === 'a4' ? [595.2755905511812, 841.8897637795276] : [612, 792]);
      const segs = segsMm(page);
      const A = cal.sheet.barA!;
      const B = cal.sheet.barB!;
      const endA = segs.filter((s) => s.x0 === s.x1 && Math.abs(Math.abs(s.y1 - s.y0) - 8) < 1e-6 && Math.abs((s.y0 + s.y1) / 2 - A.y) < 1e-6).map((s) => s.x0).sort((a, b) => a - b);
      const endB = segs.filter((s) => s.y0 === s.y1 && Math.abs(Math.abs(s.x1 - s.x0) - 8) < 1e-6 && Math.abs((s.x0 + s.x1) / 2 - B.x) < 1e-6).map((s) => s.y0).sort((a, b) => a - b);
      expect(endA.length).toBe(2);
      expect(endB.length).toBe(2);
      record('calBarA', endA[1] - endA[0] - A.length);
      record('calBarB', endB[1] - endB[0] - B.length);
      record('calBarPosition', endA[0] - A.x0);
      expect(Math.abs(endA[1] - endA[0] - A.length)).toBeLessThan(1e-9);
      expect(Math.abs(endB[1] - endB[0] - B.length)).toBeLessThan(1e-9);
      expect(Math.abs(endA[0] - A.x0)).toBeLessThan(1e-9);
    }
  });

  it('W4 tiled 1 m ruler: every tick on every tile maps back to its exact sheet position', async () => {
    const plan = planPrint({ sheets: [{ id: 1, widthMm: 1000, heightMm: 30 }], objects: [obj({ id: 1, kind: 'ruler', x: 0, y: 0, w: 1000, h: 30, props: { unit: 'mm' } })], output: out(), ctx });
    const { bytes } = await writePdf(plan, { title: 'ruler', checkBarCaption: caption, useObjectStreams: false });
    dump('ruler-1m-a4.pdf', bytes);
    const pages = await probePdf(bytes);
    let checked = 0;
    plan.pages.forEach((p, i) => {
      if (p.kind !== 'tile') return;
      const regionX = p.tile!.col * (p.safe.w - 10);
      // D53: the landscape frame is turned onto the portrait page — map the written segments back into the frame
      expect([pages[i].mediaBox[2], pages[i].mediaBox[3]]).toEqual([mmToPt(210), mmToPt(297)]);
      const back = invert(p.rotation!);
      for (const q of segsMm(pages[i])) {
        const a = apply(back, { x: q.x0, y: q.y0 });
        const b = apply(back, { x: q.x1, y: q.y1 });
        const s = { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
        // ruler ticks: vertical in the frame, starting at the ruler's top edge (sheet y 0 → frame y = safe.y)
        if (Math.abs(s.x0 - s.x1) > 1e-9 || Math.abs(Math.min(s.y0, s.y1) - p.safe.y) > 1e-9 || Math.abs(s.y1 - s.y0) > 7) continue;
        const sheetX = s.x0 - p.safe.x + regionX;
        record('rulerTick', sheetX - Math.round(sheetX));
        expect(Math.abs(sheetX - Math.round(sheetX))).toBeLessThan(1e-9);
        checked++;
      }
    });
    expect(checked).toBeGreaterThan(1000); // 1 001 ticks plus the overlap copies
  });

  it('unsupported glyphs print as "?" (and the planner warned)', async () => {
    const plan = planPrint({ sheets: [{ id: 1, widthMm: 210, heightMm: 297 }], objects: [obj({ id: 1, kind: 'text', x: 20, y: 20, w: 100, h: 20, props: { text: 'a→b' } })], output: out(), ctx });
    expect(plan.warnings.map((w) => w.code)).toContain('unsupportedGlyphs');
    const [page] = await probePdf((await writePdf(plan, { title: 't', checkBarCaption: caption, useObjectStreams: false })).bytes);
    expect(page.texts.some((t) => t.hex === '<613F62>')).toBe(true);
  });
});

// P3.5 review finding 2: the writer must never crash on large operator counts (V8 threw at ~120 000 spread arguments)
describe('stress: large repeat counts write without throwing; caps refuse with a warning', () => {
  const grid = (cols: number, rows: number, size: number) =>
    planPrint({
      sheets: [{ id: 1, widthMm: 210, heightMm: 297 }],
      objects: [obj({ id: 1, kind: 'rect', x: 10, y: 10, w: size, h: size, repeat: { cols, rows, gap_x_mm: 0.2, gap_y_mm: 0.2, trim_marks: true }, props: { fill: '#ff0000', stroke: null } })],
      output: out({ orientation: 'portrait' }),
      ctx,
    });

  it.each([
    [100, 150, 1.5],
    [200, 250, 0.7],
  ])('%i × %i copies on one A4 page', async (cols, rows, size) => {
    const plan = grid(cols, rows, size);
    expect(plan.warnings.filter((w) => w.level === 'error')).toEqual([]);
    expect(plan.pages[0].ops.filter((o) => o.op === 'object')).toHaveLength(cols * rows);
    const { bytes, notes } = await writePdf(plan, { title: 'many', checkBarCaption: caption });
    expect(notes).toEqual([]);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it('more than MAX_COPIES copies → tooManyCopies error, no pages (never a stack error)', () => {
    const plan = grid(201, 250, 0.7);
    expect(plan.pages).toEqual([]);
    expect(plan.warnings).toContainEqual({ code: 'tooManyCopies', level: 'error', params: { copies: 50_250, max: MAX_COPIES } });
    expect(translate('de', 'warn.tooManyCopies', { copies: 50_250, max: MAX_COPIES })).toContain('50250');
  });

  it('object draws over all pages are capped too (copies × tiles + map)', () => {
    // 1 200 rects covering a 3 m sheet: each is drawn on all 176 tiles and the map (≈ 212 000 draws)
    const plan = planPrint({
      sheets: [{ id: 1, widthMm: 3000, heightMm: 3000 }],
      objects: Array.from({ length: 1200 }, (_, i) => obj({ id: i + 1, kind: 'rect', x: 5, y: 5, w: 2990, h: 2990 })),
      output: out({ skipBlank: false }),
      ctx,
    });
    const draws = plan.warnings.find((w) => w.code === 'tooManyCopies');
    expect(draws?.params.max).toBe(MAX_OBJECT_DRAWS);
    expect(plan.pages).toEqual([]);
  });

  it('an op that cannot be drawn is reported per page, the rest of the PDF is still written', async () => {
    const plan = grid(2, 2, 10);
    const broken = { ...plan, pages: [{ ...plan.pages[0], ops: [...plan.pages[0].ops, { op: 'path' as const, role: 'trim' as const, d: 'M 0 0 Q 1 1', stroke: null, fill: null, widthMm: 0 }] }] };
    const { bytes, notes } = await writePdf(broken, { title: 'x', checkBarCaption: caption });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ code: 'opNotDrawn', page: 1, op: 'path/trim' });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
});
