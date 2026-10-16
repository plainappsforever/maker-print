import fs from 'node:fs';
const S = new URL('../../src/', import.meta.url).pathname;
const { inspectAsset, planAssetOf } = await import(S + 'import/assets.ts');
const { planPrint } = await import(S + 'engine/plan.ts');
const { uniformMargins } = await import(S + 'engine/paper.ts');
const { printTranslator } = await import(S + 'i18n/index.ts');
const { createAssetPainter } = await import(S + 'pdf/assets.ts');
const { writePdf } = await import(S + 'pdf/writer.ts');
const ctx = { locale: 'en', unit: 'mm', inchStyle: 'fraction16', t: printTranslator('en') };
const img = new Uint8Array(fs.readFileSync('img/i01-exif-orient6-II.jpg'));
const pdfb = new Uint8Array(fs.readFileSync('pdf/p02-rot90-origin.pdf'));
const svg = fs.readFileSync('svg/b05-nested-transforms.svg', 'utf8');
const A = [];
for (const [id, kind, b] of [[1, 'image', img], [2, 'pdf', pdfb], [3, 'svg', new TextEncoder().encode(svg)]]) { const r = await inspectAsset(kind, b); A.push(planAssetOf({ id, kind, pxW: r.asset.pxW, pxH: r.asset.pxH, svgPxPerIn: null, report: r.asset.report })); }
const OBJ = { z: 0, pageIndex: 0, rotationDeg: 0, mirrorX: false, mirrorY: false, crop: null, fit: 'fill', hidden: false, props: {} };
const objs = [
  { ...OBJ, id: 1, sheetId: 1, kind: 'image', assetId: 1, x: 150, y: 250, w: 100, h: 150, repeat: { cols: 3, rows: 2, gap_x_mm: 5, gap_y_mm: 5, trim_marks: false } },
  { ...OBJ, id: 2, sheetId: 1, kind: 'pdf_page', assetId: 2, x: 20, y: 500, w: A[1].pageSizesMm[0].w, h: A[1].pageSizesMm[0].h, repeat: { cols: 2, rows: 1, gap_x_mm: 50, gap_y_mm: 0, trim_marks: false } },
  { ...OBJ, id: 3, sheetId: 1, kind: 'svg', assetId: 3, x: 300, y: 600, w: 100, h: 100, repeat: null },
];
const plan = planPrint({ sheets: [{ id: 1, widthMm: 600, heightMm: 900 }], objects: objs, assets: A, output: { paperKey: 'a4', orientation: 'auto', margins: uniformMargins(6.35), overlapMm: 10, marks: 'registration', pageLabels: true, assemblyMap: 'auto', skipBlank: true, excludedTiles: [], checkBar: true, ppiTarget: 300 }, ctx });
const src = { 1: { kind: 'image', bytes: img }, 2: { kind: 'pdf', bytes: pdfb }, 3: { kind: 'svg', text: svg } };
const w = await writePdf(plan, { title: 'Proj "x" (test)', checkBarCaption: 'This bar must measure 100 mm', paintAsset: createAssetPainter(async (id) => src[id]), useObjectStreams: false });
fs.writeFileSync('../out/once.pdf', w.bytes);
const t = new TextDecoder('latin1').decode(w.bytes);
console.log('pages', plan.pages.length, 'image XObjects', (t.match(/\/Subtype\s*\/Image/g) || []).length, 'form XObjects', (t.match(/\/Subtype\s*\/Form/g) || []).length, 'bytes', w.bytes.length, 'notes', w.notes);
console.log('PrintScaling', /\/PrintScaling\s*\/None/.test(t), 'CreationDate', /CreationDate/.test(t), 'ModDate', /ModDate/.test(t), 'Creator', /\/Creator/.test(t), 'Producer', (t.match(/\/Producer\s*\([^)]*\)/) || [])[0], 'Title', (t.match(/\/Title\s*\((?:[^)\\]|\\.)*\)/) || [])[0]);
