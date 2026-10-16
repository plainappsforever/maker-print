// Layout probes: W3 tiling (registration marks across tiles, blank margins), W7 corrected check bar + content,
// landscape correction swap, placed A6 crop marks, W6 fill-sheet labels + trim marks. Expectations are computed
// here from SPEC formulas (not from plan output) except the check-bar *position*, which is taken from the op and
// then checked for size/correction/safe-area.
import fs from 'node:fs';
import path from 'node:path';
const S = new URL('../../src/', import.meta.url).pathname;
const { planPrint } = await import(S + 'engine/plan.ts');
const { uniformMargins } = await import(S + 'engine/paper.ts');
const { printTranslator } = await import(S + 'i18n/index.ts');
const { writePdf } = await import(S + 'pdf/writer.ts');
const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(HERE, '../out');
const ctx = { locale: 'en', unit: 'mm', inchStyle: 'fraction16', t: printTranslator('en') };
const OBJ = { z: 0, assetId: null, pageIndex: 0, rotationDeg: 0, mirrorX: false, mirrorY: false, crop: null, fit: 'fill', repeat: null, hidden: false };
const OUTP = { paperKey: 'a4', orientation: 'auto', margins: uniformMargins(6.35), overlapMm: 10, marks: 'registration', pageLabels: true, assemblyMap: 'auto', skipBlank: false, excludedTiles: [], checkBar: true, ppiTarget: 300 };
const jobs = [], meta = {};
async function emit(name, plan) {
  const w = await writePdf(plan, { title: name, checkBarCaption: 'This bar must measure 100 mm' });
  const pdf = path.join(OUT, `L-${name}.pdf`);
  fs.writeFileSync(pdf, w.bytes);
  return pdf;
}
// ---- W3: 600 x 900 sheet, red rects crossing tile seams
{
  const objs = [{ ...OBJ, id: 1, sheetId: 1, kind: 'rect', x: 150, y: 250, w: 100, h: 60, props: { fill: '#ff0000', stroke: null } }];
  const plan = planPrint({ sheets: [{ id: 1, widthMm: 600, heightMm: 900 }], objects: objs, output: OUTP, ctx });
  const pdf = await emit('w3', plan);
  meta.w3 = { pages: plan.pages.map((p) => ({ label: p.label, kind: p.kind, o: p.orientation, w: p.widthMm, h: p.heightMm, tile: p.tile, cb: p.ops.filter((o) => o.op === 'checkBar') })), warnings: plan.warnings.map((x) => x.code) };
  // landscape A4: 297 x 210, content 284.3 x 197.3, step 274.3 x 187.3 ; cols 3, rows 5
  const sx = 274.3, sy = 187.3, o = 10, l = 6.35, t = 6.35;
  plan.pages.forEach((p, i) => {
    const wins = [];
    if (p.kind === 'tile') {
      const { row: r, col: c } = p.tile;
      const toPage = (X, Y) => [X - c * sx + l, Y - r * sy + t];
      // registration marks expected (oracle, per tile pair), only those on this tile and fully inside its content
      const pts = [];
      for (let rr = 0; rr < 5; rr++) for (let cc = 0; cc < 2; cc++) { const x = (cc + 1) * sx + o / 2; const y0 = rr * sy, y1 = Math.min(rr * sy + 197.3, 900); pts.push([x, y0 + (y1 - y0) / 4], [x, y0 + 3 * (y1 - y0) / 4]); }
      for (let rr = 0; rr < 4; rr++) for (let cc = 0; cc < 3; cc++) { const y = (rr + 1) * sy + o / 2; const x0 = cc * sx, x1 = Math.min(cc * sx + 284.3, 600); pts.push([x0 + (x1 - x0) / 4, y], [x0 + 3 * (x1 - x0) / 4, y]); }
      for (const [X, Y] of pts) {
        const [px, py] = toPage(X, Y);
        if (px - 4.1 >= l && px + 4.1 <= l + 284.3 && py - 4.1 >= t && py + 4.1 <= t + 197.3 && X - c * sx >= 0 && X - c * sx <= 284.3)
          wins.push({ colour: 'black', rect: [px - 4.5, py - 4.5, px + 4.5, py + 4.5], sheet: [X, Y] });
      }
      // red rect (sheet 150..250 x 250..310) visible part on this tile
      const vx0 = Math.max(150, c * sx), vx1 = Math.min(250, c * sx + 284.3), vy0 = Math.max(250, r * sy), vy1 = Math.min(310, r * sy + 197.3);
      if (vx1 > vx0 && vy1 > vy0) { const a = toPage(vx0, vy0), b = toPage(vx1, vy1); wins.push({ colour: 'red', rect: [a[0] - 1, a[1] - 1, b[0] + 1, b[1] + 1], exp: [a[0], a[1], b[0], b[1]] }); }
    }
    jobs.push({ pdf, page: i, dpi: 1200, windows: wins.map((w) => ({ colour: w.colour, rect: w.rect })), strays: [], _meta: { name: 'w3', label: p.label, wins } });
    // margin check job: "any" ink outside the safe area
    jobs.push({ pdf, page: i, dpi: 150, windows: [{ colour: 'any', rect: [6.35 - 0.05, 6.35 - 0.05, p.widthMm - 6.35 + 0.05, p.heightMm - 6.35 + 0.05] }], strays: ['any'], _meta: { name: 'w3-margins', label: p.label } });
  });
}
// ---- W7: A4 single, red rect + check bar, correction 100/96.5 (single job)
for (const [name, fx, fy, orient] of [['w7', 100 / 96.5, 100 / 96.5, 'portrait'], ['aniso-landscape', 100 / 97, 100 / 99, 'landscape']]) {
  const W = orient === 'portrait' ? 210 : 297, H = orient === 'portrait' ? 297 : 210;
  const objs = [{ ...OBJ, id: 1, sheetId: 1, kind: 'rect', x: 80, y: 120, w: 50, h: 40, props: { fill: '#ff0000', stroke: null } }];
  const plan = planPrint({ sheets: [{ id: 1, widthMm: W, heightMm: H }], objects: objs, output: { ...OUTP, orientation: orient }, corrections: [{ paperKey: 'a4', jobKind: 'single', fx, fy }], ctx });
  const pdf = await emit(name, plan);
  const p = plan.pages[0];
  // landscape page: page x runs along the paper's y bar (D44) -> page x uses fy
  const cx = orient === 'landscape' ? fy : fx, cy = orient === 'landscape' ? fx : fy;
  const C = (x, y) => [W / 2 + cx * (x - W / 2), H / 2 + cy * (y - H / 2)];
  const a = C(80, 120), b = C(130, 160);
  const cb = p.ops.find((o) => o.op === 'checkBar');
  const wins = [{ colour: 'red', rect: [a[0] - 1, a[1] - 1, b[0] + 1, b[1] + 1], exp: [...a, ...b] }];
  if (cb && !cb.vertical) { const e0 = C(cb.x - 0.1, cb.y - 0.1), e1 = C(cb.x + 100.1, cb.y + 6.1); wins.push({ colour: 'black', rect: [e0[0] - 1, e0[1] + 0.3 * cy, e1[0] + 1, e1[1] + 1], exp: [...e0, ...e1], bar: true }); }
  meta[name] = { o: p.orientation, cb, warnings: plan.warnings.map((x) => [x.code, x.params]), safe: p.safe, corr: p.correction };
  jobs.push({ pdf, page: 0, dpi: 1200, windows: wins.map((w) => ({ colour: w.colour, rect: w.rect })), strays: [], _meta: { name, wins } });
}
// ---- placed A6 on A4, crop marks
{
  const objs = [{ ...OBJ, id: 1, sheetId: 1, kind: 'rect', x: 10, y: 10, w: 85, h: 128, props: { fill: '#ff0000', stroke: null } }];
  const plan = planPrint({ sheets: [{ id: 1, widthMm: 105, heightMm: 148 }], objects: objs, output: { ...OUTP, orientation: 'portrait', checkBar: false }, ctx });
  const pdf = await emit('placed-a6', plan);
  const ox = 52.5, oy = 74.5;
  const wins = [{ colour: 'red', rect: [ox + 9, oy + 9, ox + 96, oy + 139], exp: [ox + 10, oy + 10, ox + 95, oy + 138] }];
  // top-side vertical crop marks at x = ox and ox + 105, y in [oy - 6, oy - 1]
  for (const x of [ox, ox + 105]) wins.push({ colour: 'black', rect: [x - 1, oy - 6.5, x + 1, oy - 0.5], exp: [x - 0.1, oy - 6, x + 0.1, oy - 1] });
  for (const y of [oy, oy + 148]) wins.push({ colour: 'black', rect: [ox - 6.5, y - 1, ox - 0.5, y + 1], exp: [ox - 6, y - 0.1, ox - 1, y + 0.1] });
  meta.placed = { warnings: plan.warnings.map((x) => x.code), kind: plan.pages[0].kind };
  jobs.push({ pdf, page: 0, dpi: 1200, windows: wins.map((w) => ({ colour: w.colour, rect: w.rect })), strays: [], _meta: { name: 'placed-a6', wins } });
}
// ---- W6 labels: Fill sheet result per SPEC (oracle numbers), trim marks
{
  const objs = [{ ...OBJ, id: 1, sheetId: 1, kind: 'rect', x: 28, y: 21.5, w: 50, h: 30, repeat: { cols: 3, rows: 8, gap_x_mm: 2, gap_y_mm: 2, trim_marks: true }, props: { fill: '#ff0000', stroke: null } }];
  const plan = planPrint({ sheets: [{ id: 1, widthMm: 210, heightMm: 297 }], objects: objs, output: { ...OUTP, orientation: 'portrait', checkBar: true }, ctx });
  const pdf = await emit('w6', plan);
  const wins = [{ colour: 'red', rect: [27, 20.5, 79, 52.5], exp: [28, 21.5, 78, 51.5] }, { colour: 'red', rect: [131, 244.5, 183, 276.5], exp: [132, 245.5, 182, 275.5] }];
  for (const x of [28, 78, 80, 130, 132, 182]) wins.push({ colour: 'black', rect: [x - 0.6, 15, x + 0.6, 21], exp: [x - 0.1, 15.5, x + 0.1, 20.5] });
  meta.w6 = { warnings: plan.warnings.map((x) => x.code), cb: plan.pages.map((p) => p.ops.filter((o) => o.op === 'checkBar')) };
  jobs.push({ pdf, page: 0, dpi: 1200, windows: wins.map((w) => ({ colour: w.colour, rect: w.rect })), strays: [], _meta: { name: 'w6', wins } });
}
fs.writeFileSync(path.join(OUT, 'layout-jobs.json'), JSON.stringify(jobs.map(({ _meta, ...j }) => j)));
fs.writeFileSync(path.join(OUT, 'layout-meta.json'), JSON.stringify({ meta, jobs: jobs.map((j) => j._meta) }, null, 1));
console.log(JSON.stringify(meta, null, 0).slice(0, 3000));
