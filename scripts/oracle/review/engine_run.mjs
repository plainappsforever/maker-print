// Runs the app engine on the review oracle's inputs (cases.json) and writes engine.json. Run with
// node --import ./scripts/referee/register.mjs scripts/oracle/review/engine_run.mjs   (from the repo root)
import fs from 'node:fs';
const S = new URL('../../../src/', import.meta.url).pathname + '';
const U = await import(S + 'engine/units.ts');
const P = await import(S + 'engine/paper.ts');
const T = await import(S + 'engine/tiles.ts');
const C = await import(S + 'engine/calibration.ts');
const G = await import(S + 'engine/geometry.ts');
const Rp = await import(S + 'engine/repeat.ts');
const Pp = await import(S + 'engine/ppi.ts');
const K = await import(S + 'engine/known-length.ts');
const SU = await import(S + 'import/svg/units.ts');
const PB = await import(S + 'import/pdf-boxes.ts');
const cases = JSON.parse(fs.readFileSync('cases.json', 'utf8'));
const o = {};
const ex = (f) => { try { return f(); } catch (e) { return { threw: String(e.message || e) }; } };
o.mmToPt = cases.mmToPt.map((c) => U.mmToPt(c.mm));
o.w1 = { a4: P.paperSize('a4'), parse: cases.w1.parse.map(([t, l, u]) => U.parseLength(t, { unit: u, locale: l })),
  parseErr: cases.w1.parseErr.map(([t, l, u]) => U.parseLength(t, { unit: u, locale: l })), pt100: U.mmToPt(100), a4pt: [U.mmToPt(210), U.mmToPt(297)], letterpt: [U.mmToPt(215.9), U.mmToPt(279.4)] };
o.papers = Object.fromEntries(P.PAPERS.map((p) => [p.key, { w: p.widthMm, h: p.heightMm, margin: P.defaultMarginMm(p.key), safe: P.safeArea({ w: p.widthMm, h: p.heightMm }, P.uniformMargins(P.defaultMarginMm(p.key))) }]));
const M = (m) => ({ l: m[0], t: m[1], r: m[2], b: m[3] });
o.tiling = cases.tiling.map((c) => ex(() => {
  const sheet = { w: c.W, h: c.H };
  const lay = T.chooseLayout(sheet, c.key, c.choice, M(c.m), c.o);
  const r = { orientation: lay.orientation, mode: lay.mode, cols: lay.cols, rows: lay.rows, pages: lay.pages };
  if (c.tiles) { r.tiles = T.tiles(sheet, lay); r.reg = T.registrationPoints(sheet, lay); r.lay = lay; }
  return r;
}));
o.named = cases.named.map((c) => ['portrait', 'landscape'].map((or) => { const l = T.sheetLayout({ w: c.W, h: c.H }, c.key, or, P.uniformMargins(6.35), 10); return [l.cols, l.rows]; }));
o.letters = cases.letters.map((_, i) => T.rowLetters(i));
o.calibration = cases.calibration.map((c) => C.axisResult(c.N, c.M));
o.correction = cases.correction.map((c) => { const p = P.paperSize(c.key); const m = C.correctionMatrix({ w: p.w, h: p.h }, { fx: c.fx, fy: c.fy }); return G.apply(m, { x: c.p[0], y: c.p[1] }); });
o.w7 = (() => { const a = C.axisResult(100, 96.5); const m = C.correctionMatrix({ w: 210, h: 297 }, { fx: a.correction, fy: a.correction }); return { a, x20: G.apply(m, { x: 20, y: 0 }).x }; })();
o.fill = cases.fill.map((c) => Rp.fillSheet({ w: c.w, h: c.h, rotationDeg: c.deg }, { x: c.gx, y: c.gy }, { x: c.safe[0], y: c.safe[1], w: c.safe[2], h: c.safe[3] }));
o.trim = cases.trim.map((c) => ex(() => Rp.trimMarks({ x: c.x, y: c.y, w: c.w, h: c.h, rotationDeg: 0 }, { cols: c.cols, rows: c.rows, gap_x_mm: c.gx, gap_y_mm: c.gy, trim_marks: true }, { x: c.safe[0], y: c.safe[1], w: c.safe[2], h: c.safe[3] })));
o.ppi = cases.ppi.map((c) => { const r = Pp.effectivePpi({ w: c.px[0], h: c.px[1] }, { w: c.box[0], h: c.box[1] }, { l: c.crop[0], t: c.crop[1], r: c.crop[2], b: c.crop[3] }); return { ...r, band: Pp.ppiBand(r.ppi, 300) }; });
o.w2 = [Pp.effectivePpi({ w: 4032, h: 3024 }, { w: 40, h: 30 }).ppi, Pp.effectivePpi({ w: 4032, h: 3024 }, { w: 300, h: 225 }).ppi, Pp.effectivePpi({ w: 800, h: 600 }, { w: 100, h: 75 }).ppi];
o.w10 = K.scaleFromKnownLength({ box: { x: 0, y: 0, w: 200, h: 150 }, natural: { w: 4000, h: 3000 }, p1: { x: 100, y: 100 }, p2: { x: 912, y: 100 }, lengthMm: 50 });
o.svg = cases.svg.map((c) => SU.svgNaturalSize(c.w, c.h, c.vb, c.ppi));
o.pdf = cases.pdf.map((c) => ex(() => { const g = PB.pageGeometry(c.media, c.crop, c.uu, c.rot); return { wMm: g.wMm, hMm: g.hMm, rotate: g.rotate, notes: g.notes }; }));
fs.writeFileSync('engine.json', JSON.stringify(o));
console.log('ok');
