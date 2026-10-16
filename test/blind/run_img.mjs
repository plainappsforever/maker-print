import fs from 'node:fs';
import path from 'node:path';
const S = new URL('../../src/', import.meta.url).pathname;
const { inspectAsset, planAssetOf } = await import(S + 'import/assets.ts');
const { planPrint } = await import(S + 'engine/plan.ts');
const { uniformMargins } = await import(S + 'engine/paper.ts');
const { printTranslator } = await import(S + 'i18n/index.ts');
const { createAssetPainter } = await import(S + 'pdf/assets.ts');
const { writePdf } = await import(S + 'pdf/writer.ts');
const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(HERE, '../out');
const exp = JSON.parse(fs.readFileSync(path.join(HERE, 'img/expected.json'), 'utf8'));
const ctx = { locale: 'en', unit: 'mm', inchStyle: 'fraction16', t: printTranslator('en') };
const MAP = { 1: (x, y, W, H) => [x, y], 2: (x, y, W) => [W - x, y], 3: (x, y, W, H) => [W - x, H - y], 4: (x, y, W, H) => [x, H - y], 5: (x, y) => [y, x], 6: (x, y, W, H) => [H - y, x], 7: (x, y, W, H) => [H - y, W - x], 8: (x, y, W) => [y, W - x] };
const disp = (o, r, W, H) => { const a = MAP[o](r[0], r[1], W, H), b = MAP[o](r[2], r[3], W, H); return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]; };
const jobs = [], summary = {};
const k = 0.3;
for (const [name, e] of Object.entries(exp)) {
  const bytes = new Uint8Array(fs.readFileSync(path.join(HERE, 'img', name)));
  const r = await inspectAsset('image', bytes);
  const sum = { ok: r.ok, error: r.ok ? undefined : r.error };
  summary[name] = sum;
  if (!r.ok) continue;
  sum.px = [r.asset.pxW, r.asset.pxH]; sum.report = r.asset.report;
  const [W, H] = e.raw;
  const sw = e.orientation >= 5;
  const dw = sw ? H : W, dh = sw ? W : H;
  sum.expectPx = [dw, dh];
  const pa = planAssetOf({ id: 1, kind: 'image', pxW: r.asset.pxW, pxH: r.asset.pxH, svgPxPerIn: null, report: r.asset.report });
  const plan = planPrint({
    sheets: [{ id: 1, widthMm: 210, heightMm: 297 }],
    objects: [{ id: 1, sheetId: 1, z: 0, kind: 'image', assetId: 1, pageIndex: 0, x: 20, y: 20, w: dw * k, h: dh * k, rotationDeg: 0, mirrorX: false, mirrorY: false, crop: null, fit: 'fill', repeat: null, props: {}, hidden: false }],
    assets: [pa],
    output: { paperKey: 'a4', orientation: 'portrait', margins: uniformMargins(6.35), overlapMm: 10, marks: 'none', pageLabels: false, assemblyMap: 'off', skipBlank: false, excludedTiles: [], checkBar: false, ppiTarget: 300 }, ctx });
  const w = await writePdf(plan, { title: name, checkBarCaption: 'x', paintAsset: createAssetPainter(async () => ({ kind: 'image', bytes })) });
  sum.notes = w.notes;
  const pdf = path.join(OUT, 'img-' + name + '.pdf');
  fs.writeFileSync(pdf, w.bytes);
  const red = disp(e.orientation, [0, 0, 150, 100], W, H).map((v) => 20 + v * k);
  const blue = disp(e.orientation, [225, 150, 300, 200], W, H).map((v) => 20 + v * k);
  sum.expRed = red; sum.expBlue = blue;
  jobs.push({ pdf, page: 0, dpi: 600, windows: [{ colour: 'red', rect: [red[0] - 2, red[1] - 2, red[2] + 2, red[3] + 2] }, { colour: 'blue', rect: [blue[0] - 2, blue[1] - 2, blue[2] + 2, blue[3] + 2] }], strays: ['red', 'blue'] });
}
fs.writeFileSync(path.join(OUT, 'img-jobs.json'), JSON.stringify(jobs));
fs.writeFileSync(path.join(OUT, 'img-summary.json'), JSON.stringify(summary, null, 1));
