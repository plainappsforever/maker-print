// Blind SVG set → app importer + planner + writer → PDFs + measurement jobs (P3.5 review harness).
import fs from 'node:fs';
import path from 'node:path';
const S = new URL('../../src/', import.meta.url).pathname;
const { inspectAsset, planAssetOf } = await import(S + 'import/assets.ts');
const { readSvg, drawingToSvg } = await import(S + 'import/svg/normalise.ts');
const { planPrint } = await import(S + 'engine/plan.ts');
const { uniformMargins } = await import(S + 'engine/paper.ts');
const { printTranslator } = await import(S + 'i18n/index.ts');
const { createAssetPainter } = await import(S + 'pdf/assets.ts');
const { writePdf } = await import(S + 'pdf/writer.ts');
const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(HERE, '../out');
const exp = JSON.parse(fs.readFileSync(path.join(HERE, 'svg/expected.json'), 'utf8'));
const ctx = { locale: 'en', unit: 'mm', inchStyle: 'fraction16', t: printTranslator('en') };
const jobs = [];
const summary = {};
for (const [name, e] of Object.entries(exp)) {
  const text = fs.readFileSync(path.join(HERE, 'svg', name), 'utf8');
  const bytes = new TextEncoder().encode(text);
  const t0 = performance.now();
  const r = await inspectAsset('svg', bytes);
  const ms = performance.now() - t0;
  const rs = readSvg(text);
  const sum = { ms: +ms.toFixed(1), ok: r.ok, error: r.ok ? undefined : r.error };
  if (r.ok) {
    sum.needsPpi = r.asset.needsPpi;
    sum.issues = r.asset.report.issues;
    sum.drawn = r.asset.report.drawn;
    const pa = planAssetOf({ id: 1, kind: 'svg', pxW: null, pxH: null, svgPxPerIn: r.asset.needsPpi ? e.ppi : null, report: r.asset.report });
    sum.naturalMm = pa.naturalMm;
    if (rs.ok) sum.previewSvg = drawingToSvg(rs.drawing).slice(0, 400);
    if (pa.naturalMm) {
      const n = pa.naturalMm;
      const paper = n.w + 40 <= 210 && n.h + 40 <= 297 ? 'a4' : 'a2';
      const P = paper === 'a4' ? { w: 210, h: 297 } : { w: 420, h: 594 };
      const plan = planPrint({
        sheets: [{ id: 1, widthMm: P.w, heightMm: P.h }],
        objects: [{ id: 1, sheetId: 1, z: 0, kind: 'svg', assetId: 1, pageIndex: 0, x: 20, y: 20, w: n.w, h: n.h, rotationDeg: 0, mirrorX: false, mirrorY: false, crop: null, fit: 'fill', repeat: null, props: {}, hidden: false }],
        assets: [pa],
        output: { paperKey: paper, orientation: 'portrait', margins: uniformMargins(6.35), overlapMm: 10, marks: 'none', pageLabels: false, assemblyMap: 'off', skipBlank: false, excludedTiles: [], checkBar: false, ppiTarget: 300 },
        ctx,
      });
      sum.warnings = plan.warnings.map((w) => w.code);
      const painter = createAssetPainter(async () => ({ kind: 'svg', text }));
      const w = await writePdf(plan, { title: name, checkBarCaption: 'x', paintAsset: painter });
      sum.notes = w.notes;
      const pdf = path.join(OUT, name.replace('.svg', '.pdf'));
      fs.writeFileSync(pdf, w.bytes);
      const wins = e.features.map((f) => ({ colour: f.colour, rect: [f.rect[0] + 20 - 1.5, f.rect[1] + 20 - 1.5, f.rect[2] + 20 + 1.5, f.rect[3] + 20 + 1.5] }));
      jobs.push({ pdf, page: 0, dpi: 1200, windows: wins, strays: ['red', 'green', 'blue', 'black'] });
    }
  } else if (rs.report) sum.issues = rs.report.issues;
  summary[name] = sum;
}
fs.writeFileSync(path.join(OUT, 'svg-jobs.json'), JSON.stringify(jobs));
fs.writeFileSync(path.join(OUT, 'svg-summary.json'), JSON.stringify(summary, null, 1));
console.log('done', Object.keys(summary).length);
