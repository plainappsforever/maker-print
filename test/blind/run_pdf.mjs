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
const exp = JSON.parse(fs.readFileSync(path.join(HERE, 'pdf/expected.json'), 'utf8'));
const ctx = { locale: 'en', unit: 'mm', inchStyle: 'fraction16', t: printTranslator('en') };
const jobs = [], summary = {};
for (const [name, e] of Object.entries(exp)) {
  const bytes = new Uint8Array(fs.readFileSync(path.join(HERE, 'pdf', name)));
  const r = await inspectAsset('pdf', bytes);
  const sum = { ok: r.ok, error: r.ok ? undefined : r.error };
  summary[name] = sum;
  if (!r.ok) continue;
  sum.report = r.asset.report;
  const pa = planAssetOf({ id: 1, kind: 'pdf', pxW: null, pxH: null, svgPxPerIn: null, report: r.asset.report });
  const n = pa.pageSizesMm[0];
  const plan = planPrint({
    sheets: [{ id: 1, widthMm: 420, heightMm: 594 }],
    objects: [{ id: 1, sheetId: 1, z: 0, kind: 'pdf_page', assetId: 1, pageIndex: 0, x: 20, y: 20, w: n.w, h: n.h, rotationDeg: 0, mirrorX: false, mirrorY: false, crop: null, fit: 'fill', repeat: null, props: {}, hidden: false }],
    assets: [pa],
    output: { paperKey: 'a2', orientation: 'portrait', margins: uniformMargins(6.35), overlapMm: 10, marks: 'none', pageLabels: false, assemblyMap: 'off', skipBlank: false, excludedTiles: [], checkBar: false, ppiTarget: 300 },
    ctx,
  });
  const w = await writePdf(plan, { title: name, checkBarCaption: 'x', paintAsset: createAssetPainter(async () => ({ kind: 'pdf', bytes })) });
  sum.warnings = plan.warnings.map((x) => x.code); sum.notes = w.notes;
  const pdf = path.join(OUT, 'pdf-' + name);
  fs.writeFileSync(pdf, w.bytes);
  const R = e.red;
  const wins = [{ colour: 'red', rect: [R[0] + 18.5, R[1] + 18.5, R[2] + 21.5, R[3] + 21.5] }];
  jobs.push({ pdf, page: 0, dpi: 1200, windows: wins, strays: ['red', 'green', 'blue'] });
}
fs.writeFileSync(path.join(OUT, 'pdf-jobs.json'), JSON.stringify(jobs));
fs.writeFileSync(path.join(OUT, 'pdf-summary.json'), JSON.stringify(summary, null, 1));
