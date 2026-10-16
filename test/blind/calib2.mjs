import fs from 'node:fs';
const S = new URL('../../src/', import.meta.url).pathname;
const { planCalibration } = await import(S + 'engine/plan.ts');
const { uniformMargins } = await import(S + 'engine/paper.ts');
const { printTranslator } = await import(S + 'i18n/index.ts');
const ctx = { locale: 'en', unit: 'mm', inchStyle: 'fraction16', t: printTranslator('en') };
const jobs = [];
for (const key of ['a4', 'letter']) {
  const p = planCalibration({ paperKey: key, margins: uniformMargins(6.35), pages: 1, ctx });
  const A = p.sheet.barA, B = p.sheet.barB;
  console.log(key, JSON.stringify(A), JSON.stringify(B));
  jobs.push({ pdf: `../out/cal-${key}.pdf`, page: 0, dpi: 2400, strays: [], windows: [
    { colour: 'black', rect: [A.x0 - 0.4, A.y - 1.8, A.x0 + 0.4, A.y - 0.4] }, { colour: 'black', rect: [A.x1 - 0.4, A.y - 1.8, A.x1 + 0.4, A.y - 0.4] },
    { colour: 'black', rect: [B.x - 1.8, B.y0 - 0.4, B.x - 0.4, B.y0 + 0.4] }, { colour: 'black', rect: [B.x - 1.8, B.y1 - 0.4, B.x - 0.4, B.y1 + 0.4] }] });
}
fs.writeFileSync('../out/cal-jobs.json', JSON.stringify(jobs));
