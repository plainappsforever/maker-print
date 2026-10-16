const S = new URL('../../src/', import.meta.url).pathname;
const { planPrint } = await import(S + 'engine/plan.ts');
const { androidJobFacts, iosRendererPlacement } = await import(S + 'engine/route.ts');
const { uniformMargins } = await import(S + 'engine/paper.ts');
const { printTranslator } = await import(S + 'i18n/index.ts');
const ctx = { locale: 'en', unit: 'mm', inchStyle: 'fraction16', t: printTranslator('en') };
const OBJ = { z: 0, assetId: null, pageIndex: 0, rotationDeg: 0, mirrorX: false, mirrorY: false, crop: null, fit: 'fill', repeat: null, hidden: false };
const out = { paperKey: 'a4', orientation: 'auto', margins: uniformMargins(6.35), overlapMm: 10, marks: 'registration', pageLabels: true, assemblyMap: 'auto', skipBlank: true, excludedTiles: [], checkBar: true, ppiTarget: 300 };
const p = planPrint({ sheets: [{ id: 1, widthMm: 210, heightMm: 297 }, { id: 2, widthMm: 1000, heightMm: 30 }],
  objects: [{ ...OBJ, id: 1, sheetId: 1, kind: 'rect', x: 20, y: 20, w: 50, h: 50, props: {} }, { ...OBJ, id: 2, sheetId: 2, kind: 'ruler', x: 0, y: 0, w: 1000, h: 30, props: {} }], output: out, ctx });
console.log('mixed job orientations:', p.pages.map((x) => `${x.label}:${x.orientation[0]}`).join(' '), '| warnings:', p.warnings.map((w) => w.code).join(',') || 'none');
// single landscape page job: W 297 x 210 sheet (A4 landscape) -> one page
const q = planPrint({ sheets: [{ id: 1, widthMm: 297, heightMm: 210 }], objects: [{ ...OBJ, id: 1, sheetId: 1, kind: 'rect', x: 20, y: 20, w: 50, h: 50, props: {} }], output: out, ctx });
console.log('A4-landscape sheet:', q.pages.map((x) => `${x.kind} ${x.widthMm}x${x.heightMm}`), 'android facts on portrait A4 media:', JSON.stringify(androidJobFacts(q, { w: 210, h: 297 })));
console.log('iOS renderer placement of that page on portrait A4 paper:', JSON.stringify(iosRendererPlacement({ w: 297, h: 210 }, { w: 210, h: 297 })));
// learned non-uniform margins on a landscape page
const r = planPrint({ sheets: [{ id: 1, widthMm: 1000, heightMm: 30 }], objects: [{ ...OBJ, id: 1, sheetId: 1, kind: 'ruler', x: 0, y: 0, w: 1000, h: 30, props: {} }], output: { ...out, margins: { l: 3, t: 3, r: 3, b: 15 } }, ctx });
console.log('ruler with margins l3 t3 r3 b15:', r.pages[0].orientation, 'safe', JSON.stringify(r.pages[0].safe));
