const S = new URL('../../src/', import.meta.url).pathname;
const { planPrint, opFootprint } = await import(S + 'engine/plan.ts');
const { uniformMargins } = await import(S + 'engine/paper.ts');
const { printTranslator } = await import(S + 'i18n/index.ts');
const ctx = { locale: 'en', unit: 'mm', inchStyle: 'fraction16', t: printTranslator('en') };
const OBJ = { z: 0, assetId: null, pageIndex: 0, rotationDeg: 0, mirrorX: false, mirrorY: false, crop: null, fit: 'fill', repeat: null, hidden: false };
// text box 20 mm wide at x = 170 on a 500 x 200 sheet; its text is ~150 mm long at 36 pt -> spills into tile A2/A3
const objs = [{ ...OBJ, id: 1, sheetId: 1, kind: 'text', x: 300, y: 50, w: 20, h: 15, props: { text: 'SPILLING TEXT LABEL HERE', fontSizePt: 36 } }];
const plan = planPrint({ sheets: [{ id: 1, widthMm: 500, heightMm: 200 }], objects: objs, output: { paperKey: 'a4', orientation: 'portrait', margins: uniformMargins(6.35), overlapMm: 10, marks: 'registration', pageLabels: true, assemblyMap: 'off', skipBlank: true, excludedTiles: [], checkBar: false, ppiTarget: 300 }, ctx });
console.log('sheets', JSON.stringify(plan.sheets), 'warnings', plan.warnings.map((w) => w.code));
const ink = opFootprint({ op: 'object', objectId: 1, transform: [1, 0, 0, 1, 300, 50], clip: { x: -1e9, y: -1e9, w: 2e9, h: 2e9 }, box: { w: 20, h: 15 } }, plan.content);
console.log('text ink on sheet x from', ink.x.toFixed(1), 'to', (ink.x + ink.w).toFixed(1), 'mm (box ends at 190)');
