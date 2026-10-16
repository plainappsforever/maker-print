import fs from 'node:fs';
const S = new URL('../../src/', import.meta.url).pathname;
const { inspectAsset } = await import(S + 'import/assets.ts');
const bytes = new Uint8Array(fs.readFileSync(process.argv[2]));
const t0 = performance.now();
const r = await inspectAsset('pdf', bytes);
console.log('inspect ms', Math.round(performance.now() - t0), r.ok ? r.asset.pageCount : r.error);
const { createAssetPainter } = await import(S + 'pdf/assets.ts');
const { writePdf } = await import(S + 'pdf/writer.ts');
const plan = { content: {}, pages: [{ widthMm: 420, heightMm: 594, orientation: 'portrait', label: '1', kind: 'single', sheetIndex: 0, safe: { x: 0, y: 0, w: 420, h: 594 }, correction: null,
  ops: [{ op: 'object', objectId: 1, kind: 'pdf_page', copy: { col: 0, row: 0 }, transform: [1, 0, 0, 1, 0, 0], clip: { x: 0, y: 0, w: 420, h: 594 }, box: { w: 420, h: 594 }, source: { assetId: 1, pageIndex: 5, natural: { w: 420, h: 594 }, map: [1, 0, 0, 1, 0, 0] } }] }] };
const t1 = performance.now();
const w = await writePdf(plan, { title: 'x', checkBarCaption: 'x', paintAsset: createAssetPainter(async () => ({ kind: 'pdf', bytes })) });
console.log('write one page ms', Math.round(performance.now() - t1), 'bytes', w.bytes.length, w.notes);
