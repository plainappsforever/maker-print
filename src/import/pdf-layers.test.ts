/**
 * @jest-environment node
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';

import { PDFDocument, PDFName, PDFRawStream } from '@cantoo/pdf-lib';

import { uniformMargins } from '@/engine/paper';
import { planPrint } from '@/engine/plan';
import { printTranslator } from '@/i18n';
import { de } from '@/i18n/de';
import { en } from '@/i18n/en';
import { createAssetPainter } from '@/pdf/assets';
import { writePdf } from '@/pdf/writer';

import { inspectAsset, planAssetOf } from './assets';
import { filterContent, hiddenLayers } from './pdf-layers';

/** Minimal PDF with correct xref offsets; objects are given without "n 0 obj". */
function pdf(objects: string[]): Uint8Array {
  let out = '%PDF-1.6\n';
  const offs: number[] = [];
  objects.forEach((o, i) => {
    offs.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const x = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}
const stream = (body: string, dict = '') => `<< /Length ${body.length} ${dict}>>\nstream\n${body}\nendstream`;
const blind = (n: string) => new Uint8Array(readFileSync(path.join(__dirname, '../../test/blind/pdf', n)));

describe('filterContent: painting inside hidden optional content is suppressed, state changes are kept', () => {
  const none = () => ({ hidden: false, form: null });
  it('paths end with n, text turns invisible (render mode 3) and back, XObjects and inline images go', () => {
    const src = [
      '1 0 0 rg 0 0 10 10 re f',
      '/OC /L1 BDC 0 1 0 rg 5 5 10 10 re W f BT /F1 12 Tf 2 Tr (hidden \\) EMC) Tj ET /Im1 Do BI /W 1 /H 1 /CS /G /BPC 8 ID \x00\xffEI\n EI q 0 0 1 rg 1 1 1 1 re S Q EMC',
      '/OC /L2 BDC 0 0 1 rg 7 7 1 1 re f EMC',
      '/Span << /ActualText (x) >> BDC 0 0 0 rg 9 9 1 1 re f EMC',
    ].join('\n');
    const r = filterContent(src, (n) => n === 'L1', none);
    expect(r.hiddenPaint).toBe(5);
    expect(r.text).toContain('1 0 0 rg 0 0 10 10 re f'); // before: untouched
    expect(r.text).toContain('0 1 0 rg 5 5 10 10 re W n'); // colour and clip kept, painting gone
    expect(r.text).toContain('3 Tr (hidden \\) EMC) Tj 2 Tr'); // invisible, then the file's own mode again
    expect(r.text).not.toContain('/Im1 Do');
    expect(r.text).not.toContain('BI');
    expect(r.text).toContain('q 0 0 1 rg 1 1 1 1 re n Q');
    expect(r.text).toContain('/OC /L2 BDC 0 0 1 rg 7 7 1 1 re f EMC'); // visible layer untouched
    expect(r.text).toContain('0 0 0 rg 9 9 1 1 re f EMC'); // other marked content untouched
  });
  it('an XObject with its own hidden /OC is dropped outside marked content too; forms are listed for the next pass', () => {
    const r = filterContent('q /A Do Q q /B Do Q', () => false, (n) => (n === 'A' ? { hidden: true, form: null } : { hidden: false, form: null }));
    expect([r.text.replace(/\s+/g, ' '), r.hiddenPaint]).toEqual(['q Q q /B Do Q', 1]);
  });
});

describe('hiddenLayers: default configuration and print usage', () => {
  const doc = (oc: string) =>
    PDFDocument.load(
      pdf([
        `<< /Type /Catalog /Pages 2 0 R /OCProperties ${oc} >>`,
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>',
        '<< /Type /OCG /Name (A) >>',
        '<< /Type /OCG /Name (B) /Usage << /Print << /PrintState /ON >> >> >>',
        '<< /Type /OCG /Name (C) /Usage << /Print << /PrintState /OFF >> >> >>',
      ])
    );
  it('BaseState ON with OFF list; BaseState OFF with ON list; /AS print event uses PrintState', async () => {
    expect([...hiddenLayers(await doc('<< /OCGs [4 0 R 5 0 R 6 0 R] /D << /OFF [4 0 R 5 0 R] >> >>'))!]).toEqual(['4 0 R', '5 0 R']);
    expect([...hiddenLayers(await doc('<< /OCGs [4 0 R 5 0 R 6 0 R] /D << /BaseState /OFF /ON [6 0 R] >> >>'))!]).toEqual(['4 0 R', '5 0 R']);
    const as = '/AS [<< /Event /Print /OCGs [5 0 R 6 0 R] /Category [/Print] >>]';
    expect([...hiddenLayers(await doc(`<< /OCGs [4 0 R 5 0 R 6 0 R] /D << /OFF [4 0 R 5 0 R] ${as} >> >>`))!]).toEqual(['4 0 R', '6 0 R']);
  });
});

describe('import notes and painting (P3.5 findings 4 and 5)', () => {
  it('blind p08: hidden layer noted at import and not painted; blind p07: annotations noted', async () => {
    const r8 = await inspectAsset('pdf', blind('p08-hidden-layer.pdf'));
    const r7 = await inspectAsset('pdf', blind('p07-annotation.pdf'));
    expect(r8.ok && r8.asset.report.kind === 'pdf' && r8.asset.report.pages[0].notes).toEqual(['hiddenLayers']);
    expect(r7.ok && r7.asset.report.kind === 'pdf' && r7.asset.report.pages[0].notes).toEqual(['annotationsNotPrinted']);
    for (const k of ['hiddenLayers', 'annotationsNotPrinted']) expect([en[`pdf.note.${k}` as keyof typeof en], de[`pdf.note.${k}` as keyof typeof de]].every(Boolean)).toBe(true);

    const bytes = blind('p08-hidden-layer.pdf');
    if (!r8.ok) return;
    const pa = planAssetOf({ id: 1, kind: 'pdf', pxW: null, pxH: null, svgPxPerIn: null, report: r8.asset.report });
    const ctx = { locale: 'en' as const, unit: 'mm' as const, inchStyle: 'fraction16' as const, t: printTranslator('en') };
    const n = pa.pageSizesMm![0];
    const plan = planPrint({
      sheets: [{ id: 1, widthMm: 420, heightMm: 594 }],
      objects: [{ id: 1, sheetId: 1, z: 0, kind: 'pdf_page', assetId: 1, pageIndex: 0, x: 20, y: 20, w: n.w, h: n.h, rotationDeg: 0, mirrorX: false, mirrorY: false, crop: null, fit: 'fill', repeat: null, props: {}, hidden: false }],
      assets: [pa],
      output: { paperKey: 'a2', orientation: 'portrait', margins: uniformMargins(6.35), overlapMm: 10, marks: 'none', pageLabels: false, assemblyMap: 'off', skipBlank: false, excludedTiles: [], checkBar: false, ppiTarget: 300 },
      ctx,
    });
    const out = await writePdf(plan, { title: 't', checkBarCaption: 'c', paintAsset: createAssetPainter(async () => ({ kind: 'pdf', bytes })), useObjectStreams: false });
    expect(out.notes).toEqual([]);
    const doc = await PDFDocument.load(out.bytes);
    const forms: string[] = [];
    for (const [, o] of doc.context.enumerateIndirectObjects()) {
      if (o instanceof PDFRawStream && o.dict.get(PDFName.of('Subtype'))?.toString() === '/Form') forms.push(inflateSync(Buffer.from(o.getContents())).toString('latin1'));
    }
    const page = forms.find((f) => f.includes('100 600 100 100 re'))!;
    expect(page).toContain('1 0 0 rg 100 600 100 100 re f'); // visible content kept
    expect(page).toContain('0 1 0 rg 300 300 100 100 re n'); // hidden green rect: path ended, not painted
  });

  it('visible layers and files without layers are untouched (no note)', async () => {
    const body = '/OC /L1 BDC 0 1 0 rg 300 300 100 100 re f EMC';
    const bytes = pdf([
      '<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [5 0 R] /D << /ON [5 0 R] >> >> >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Properties << /L1 5 0 R >> >> >>',
      stream(body),
      '<< /Type /OCG /Name (on) >>',
    ]);
    const r = await inspectAsset('pdf', bytes);
    expect(r.ok && r.asset.report.kind === 'pdf' && r.asset.report.pages[0].notes).toEqual([]);
  });

  it('hidden content inside a form XObject drawn by the page is suppressed too (counted at import)', async () => {
    const bytes = pdf([
      '<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [6 0 R] /D << /OFF [6 0 R] >> >> >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /XObject << /Fx 5 0 R >> >> >>',
      stream('1 0 0 rg 0 0 10 10 re f /Fx Do'),
      stream('/OC /H BDC 0 1 0 rg 20 20 10 10 re f EMC', '/Type /XObject /Subtype /Form /BBox [0 0 100 100] /Resources << /Properties << /H 6 0 R >> >> '),
      '<< /Type /OCG /Name (hidden) >>',
    ]);
    const r = await inspectAsset('pdf', bytes);
    expect(r.ok && r.asset.report.kind === 'pdf' && r.asset.report.pages[0].notes).toEqual(['hiddenLayers']);
  });
});
