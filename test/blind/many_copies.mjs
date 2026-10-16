const S = new URL('../../src/', import.meta.url).pathname;
const { planPrint } = await import(S + 'engine/plan.ts');
const { uniformMargins } = await import(S + 'engine/paper.ts');
const { printTranslator } = await import(S + 'i18n/index.ts');
const { writePdf } = await import(S + 'pdf/writer.ts');
const ctx = { locale: 'en', unit: 'mm', inchStyle: 'fraction16', t: printTranslator('en') };
for (const [cols, rows, sz] of [[50, 50, 3], [100, 150, 1.5], [150, 250, 0.9]]) {
  const t0 = performance.now();
  const plan = planPrint({ sheets: [{ id: 1, widthMm: 210, heightMm: 297 }],
    objects: [{ id: 1, sheetId: 1, z: 0, kind: 'rect', assetId: null, pageIndex: 0, x: 10, y: 10, w: sz, h: sz, rotationDeg: 0, mirrorX: false, mirrorY: false, crop: null, fit: 'fill', repeat: { cols, rows, gap_x_mm: 0.2, gap_y_mm: 0.2, trim_marks: true }, props: { fill: '#ff0000' }, hidden: false }],
    output: { paperKey: 'a4', orientation: 'portrait', margins: uniformMargins(6.35), overlapMm: 10, marks: 'registration', pageLabels: true, assemblyMap: 'auto', skipBlank: true, excludedTiles: [], checkBar: true, ppiTarget: 300 }, ctx });
  const t1 = performance.now();
  try {
    const w = await writePdf(plan, { title: 'x', checkBarCaption: 'This bar must measure 100 mm' });
    console.log(cols * rows, 'copies: plan ms', Math.round(t1 - t0), 'write ms', Math.round(performance.now() - t1), 'bytes', w.bytes.length, 'warnings', plan.warnings.map((x) => x.code).join(','));
  } catch (e) { console.log(cols * rows, 'copies: plan ms', Math.round(t1 - t0), 'WRITE THREW', String(e).slice(0, 120)); }
}
