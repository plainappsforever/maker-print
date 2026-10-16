import fs from 'node:fs';
const S = new URL('../../src/', import.meta.url).pathname;
const { planCalibration } = await import(S + 'engine/plan.ts');
const { uniformMargins } = await import(S + 'engine/paper.ts');
const { printTranslator } = await import(S + 'i18n/index.ts');
const { writePdf } = await import(S + 'pdf/writer.ts');
const ctx = { locale: 'en', unit: 'mm', inchStyle: 'fraction16', t: printTranslator('en') };
for (const key of ['a4', 'letter', 'a6', 'photo-4x6']) {
  const p = planCalibration({ paperKey: key, margins: uniformMargins(key.startsWith('photo') ? 3 : 6.35), pages: 1, ctx });
  const w = await writePdf(p, { title: 'cal', checkBarCaption: 'x' });
  fs.writeFileSync(`../out/cal-${key}.pdf`, w.bytes);
  console.log(key, Object.keys(p.sheet), JSON.stringify(p.sheet.bars ?? p.sheet.items ?? '').slice(0, 300), 'omitted', JSON.stringify(p.sheet.omitted ?? p.sheet.missing ?? ''));
}
