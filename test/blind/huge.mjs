import fs from 'node:fs';
const S = new URL('../../src/', import.meta.url).pathname;
const { inspectAsset } = await import(S + 'import/assets.ts');
const { readSvg } = await import(S + 'import/svg/normalise.ts');
const f = process.argv[2];
const bytes = new Uint8Array(fs.readFileSync(f));
const t0 = performance.now();
let r;
try { r = await inspectAsset('svg', bytes); } catch (e) { console.log('THREW', String(e).slice(0, 200)); }
const t1 = performance.now();
console.log(f, 'inspect ms', Math.round(t1 - t0), r && (r.ok ? { ok: true, drawn: r.asset.report.drawn, issues: r.asset.report.issues.map((i) => i.code + ':' + (i.count ?? '')) } : r));
if (process.argv[3] === 'paint' && r?.ok) {
  const { createAssetPainter } = await import(S + 'pdf/assets.ts');
  const { writePdf } = await import(S + 'pdf/writer.ts');
  const text = new TextDecoder().decode(bytes);
  const plan = { content: {}, pages: [{ widthMm: 594, heightMm: 841, orientation: 'portrait', label: '1', kind: 'single', sheetIndex: 0, safe: { x: 0, y: 0, w: 594, h: 841 }, correction: null,
    ops: [{ op: 'object', objectId: 1, kind: 'svg', copy: { col: 0, row: 0 }, transform: [1, 0, 0, 1, 20, 20], clip: { x: 0, y: 0, w: 594, h: 841 }, box: { w: 500, h: 500 }, source: { assetId: 1, pageIndex: 0, natural: { w: 500, h: 500 }, map: [1, 0, 0, 1, 0, 0] } }] }] };
  const t2 = performance.now();
  const w = await writePdf(plan, { title: 'x', checkBarCaption: 'x', paintAsset: createAssetPainter(async () => ({ kind: 'svg', text })) });
  console.log('write ms', Math.round(performance.now() - t2), 'pdf bytes', w.bytes.length, 'notes', w.notes);
}
