// Part 2 of `npm run referee`: the P3.5 reviewer's INDEPENDENT checks, kept green from now on (REVIEW_ENGINE.md,
// "Tests to add" 7 and 8). Not blind any more once fixes were tuned against them (V1_LOG P3.5) — but the expectations
// are still the reviewer's (test/blind/*/expected.json, scripts/oracle/review/review_oracle.py), not ours, and the
// measurer is the reviewer's own CoreGraphics tool (scripts/cg/rmeasure.swift), not scripts/referee/measure.swift.
//   1. review oracle (Python fractions, ~220 000 checks) + rotation/mirror geometry (geo.json)
//   2. blind SVG / PDF / image sets → import → plan → PDF → rmeasure → expected.json
//   3. layout probes (W3 tiling marks + margins, W7 corrected bar, anisotropic correction on a turned page, placed A6,
//      W6 labels) re-derived for D53 (portrait pages, landscape frames turned: X = y, Y = H − x)
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { uniformMargins } from '../../src/engine/paper.ts';
import { planPrint } from '../../src/engine/plan.ts';
import { textWidthMm } from '../../src/engine/text-metrics.ts';
import { printTranslator } from '../../src/i18n/index.ts';
import { decodeSvgText, inspectAsset, planAssetOf } from '../../src/import/assets.ts';
import { createAssetPainter } from '../../src/pdf/assets.ts';
import { writePdf } from '../../src/pdf/writer.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BLIND = path.join(ROOT, 'test/blind');
const ORACLE = path.join(ROOT, 'scripts/oracle/review');
const CG = path.join(ROOT, 'scripts/cg');
const REGISTER = path.join(ROOT, 'scripts/referee/register.mjs');
const ctx = { locale: 'en', unit: 'mm', inchStyle: 'fraction16', t: printTranslator('en') };
const OBJ = { z: 0, assetId: null, pageIndex: 0, rotationDeg: 0, mirrorX: false, mirrorY: false, crop: null, fit: 'fill', repeat: null, props: {}, hidden: false };
const single = (paperKey, extra = {}) => ({ paperKey, orientation: 'portrait', margins: uniformMargins(6.35), overlapMm: 10, marks: 'none', pageLabels: false, assemblyMap: 'off', skipBlank: false, excludedTiles: [], checkBar: false, ppiTarget: 300, ...extra });
const TOL = 0.05;
const dev = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

export async function runBlind(check, outRoot) {
  const OUT = path.join(outRoot, 'blind');
  mkdirSync(OUT, { recursive: true });
  execFileSync(path.join(CG, 'build.sh'), ['rmeasure', 'imgio'], { stdio: 'inherit' });
  const measure = (name, jobs) => {
    const req = path.join(OUT, `${name}-jobs.json`);
    const res = path.join(OUT, `${name}-measured.json`);
    writeFileSync(req, JSON.stringify(jobs));
    execFileSync(path.join(CG, 'rmeasure'), [req, res]);
    return JSON.parse(readFileSync(res, 'utf8'));
  };

  // ------------------------------------------------------------------------------------------- 1. review oracle
  execFileSync('python3', [path.join(ORACLE, 'review_oracle.py')], { cwd: ORACLE, stdio: 'ignore' });
  const node = (script) => execFileSync(process.execPath, ['--no-warnings', '--import', REGISTER, script], { cwd: ORACLE }).toString();
  node('engine_run.mjs');
  const cmp = execFileSync('python3', ['compare.py'], { cwd: ORACLE }).toString();
  const [, total, mism] = /checks (\d+) mismatches (\d+)/.exec(cmp) ?? [];
  const classes = [...cmp.matchAll(/^\s+(\S+)\s+(\d+)\s+mismatches (\d+)$/gm)].map((m) => ({ cls: m[1], n: +m[2], bad: +m[3] }));
  // the D41 single-mark rule is the only accepted difference (finding 15: now reported as marksLeftOut)
  const allowed = { 'trim.segments': 2 };
  const unexpected = classes.filter((c) => c.bad > (allowed[c.cls] ?? 0));
  check('review oracle', `${total} checks over ${classes.length} classes, mismatches only the documented D41 rule`, Number(total) > 200_000 && unexpected.length === 0, {
    note: unexpected.length ? unexpected.map((c) => `${c.cls} ${c.bad}/${c.n}`).join(', ') : `${mism} = trim.segments (D41)`,
  });
  const geo = node('geo.mjs');
  const g = /geometry cases (\d+) point mismatches (\d+) bounds mismatches (\d+)/.exec(geo);
  check('review oracle', `rotation/mirror point map + rotated bounds (${g?.[1]} cases)`, g && g[2] === '0' && g[3] === '0', { note: geo.trim() });

  // ------------------------------------------------------------------------------------------- 2a. blind SVG
  {
    const exp = JSON.parse(readFileSync(path.join(BLIND, 'svg/expected.json'), 'utf8'));
    const jobs = [];
    const meta = [];
    for (const [name, e] of Object.entries(exp)) {
      const bytes = new Uint8Array(readFileSync(path.join(BLIND, 'svg', name)));
      const r = await inspectAsset('svg', bytes);
      const pa = r.ok ? planAssetOf({ id: 1, kind: 'svg', pxW: null, pxH: null, svgPxPerIn: r.asset.needsPpi ? e.ppi : null, report: r.asset.report }) : null;
      if (e.size) {
        const n = pa?.naturalMm;
        check(`blind svg ${name}`, `size ${e.size[0].toFixed(4)} × ${e.size[1].toFixed(4)} mm, needsPpi ${e.size[2]}`, !!n && Math.abs(n.w - e.size[0]) <= 1e-6 && Math.abs(n.h - e.size[1]) <= 1e-6 && r.asset.needsPpi === e.size[2], { note: r.ok ? `${n?.w} × ${n?.h} needsPpi ${r.asset.needsPpi}` : r.error });
      }
      if (!pa?.naturalMm) continue;
      const nm = pa.naturalMm;
      const big = !(nm.w + 40 <= 210 && nm.h + 40 <= 297);
      const P = big ? { w: 420, h: 594 } : { w: 210, h: 297 };
      const plan = planPrint({ sheets: [{ id: 1, widthMm: P.w, heightMm: P.h }], objects: [{ ...OBJ, id: 1, sheetId: 1, kind: 'svg', assetId: 1, x: 20, y: 20, w: nm.w, h: nm.h }], assets: [pa], output: single(big ? 'a2' : 'a4'), ctx });
      const text = decodeSvgText(bytes).text;
      const w = await writePdf(plan, { title: name, checkBarCaption: 'x', paintAsset: createAssetPainter(async () => ({ kind: 'svg', text })) });
      check(`blind svg ${name}`, 'drawn without notes', w.notes.length === 0, { note: w.notes.length ? JSON.stringify(w.notes) : undefined });
      const pdf = path.join(OUT, name.replace(/\.svgz?$/, '.pdf'));
      writeFileSync(pdf, w.bytes);
      // v1.1 (REVIEW_V1 finding 6, D84): an SVG with parts not printed carries a grey note on the paper — expected ink
      const notes = plan.pages[0].ops.filter((op) => op.op === 'text' && op.role === 'note');
      if (pa.gaps) check(`blind svg ${name}`, 'not-printed note on the paper', notes.length === 1, { note: notes.map((n) => n.text).join(' | ') });
      const noteWindows = notes.map((n) => ({ colour: 'black', rect: [n.x - 0.5, n.y - 0.718 * n.sizeMm - 0.5, n.x + textWidthMm(n.text, n.sizeMm) + 0.5, n.y + 0.207 * n.sizeMm + 0.5] }));
      jobs.push({ pdf, page: 0, dpi: 1200, windows: [...e.features.map((f) => ({ colour: f.colour, rect: [f.rect[0] + 18.5, f.rect[1] + 18.5, f.rect[2] + 21.5, f.rect[3] + 21.5] })), ...noteWindows], strays: ['red', 'green', 'blue', 'black'] });
      meta.push({ name, e });
    }
    measure('svg', jobs).forEach((m, i) => {
      const { name, e } = meta[i];
      e.features.forEach((f, k) => {
        const got = m.windows[k];
        const want = f.rect.map((v) => v + 20);
        const d = got?.found ? dev(got.bbox, want) : Infinity;
        check(`blind svg ${name}`, `${f.colour} ${f.rect.map((v) => +v.toFixed(3)).join(',')}`, d <= TOL, { measured: d, expected: 0 });
      });
      const strays = Object.entries(m.stray).filter(([, n]) => n > 0);
      check(`blind svg ${name}`, 'no ink outside the expected features', strays.length === 0, { note: strays.length ? JSON.stringify(Object.fromEntries(strays)) : undefined });
    });
  }

  // ------------------------------------------------------------------------------------------- 2b. blind PDF
  {
    const exp = JSON.parse(readFileSync(path.join(BLIND, 'pdf/expected.json'), 'utf8'));
    const refused = { 'p06-user-password.pdf': 'encrypted', 'p14-cg-enc128-userpw.pdf': 'encrypted' };
    const notes = { 'p07-annotation.pdf': ['annotationsNotPrinted'], 'p08-hidden-layer.pdf': ['hiddenLayers'] };
    const jobs = [];
    const meta = [];
    for (const [name, e] of Object.entries(exp)) {
      const bytes = new Uint8Array(readFileSync(path.join(BLIND, 'pdf', name)));
      const r = await inspectAsset('pdf', bytes);
      if (refused[name]) {
        check(`blind pdf ${name}`, `refused: ${refused[name]}`, !r.ok && r.error === refused[name], { note: r.ok ? 'imported' : r.error });
        continue;
      }
      if (!r.ok) {
        check(`blind pdf ${name}`, 'imports', false, { note: r.error });
        continue;
      }
      const pa = planAssetOf({ id: 1, kind: 'pdf', pxW: null, pxH: null, svgPxPerIn: null, report: r.asset.report });
      const n = pa.pageSizesMm[0];
      check(`blind pdf ${name}`, `size ${e.size[0].toFixed(4)} × ${e.size[1].toFixed(4)} mm`, Math.abs(n.w - e.size[0]) <= 1e-3 && Math.abs(n.h - e.size[1]) <= 1e-3, { note: `${n.w} × ${n.h}` });
      check(`blind pdf ${name}`, `import notes ${JSON.stringify(notes[name] ?? [])}`, JSON.stringify(r.asset.report.pages[0].notes) === JSON.stringify(notes[name] ?? []), { note: JSON.stringify(r.asset.report.pages[0].notes) });
      const plan = planPrint({ sheets: [{ id: 1, widthMm: 420, heightMm: 594 }], objects: [{ ...OBJ, id: 1, sheetId: 1, kind: 'pdf_page', assetId: 1, x: 20, y: 20, w: n.w, h: n.h }], assets: [pa], output: single('a2'), ctx });
      const w = await writePdf(plan, { title: name, checkBarCaption: 'x', paintAsset: createAssetPainter(async () => ({ kind: 'pdf', bytes })) });
      const pdf = path.join(OUT, `pdf-${name}`);
      writeFileSync(pdf, w.bytes);
      const R = e.red;
      const windows = [{ colour: 'red', rect: [R[0] + 18.5, R[1] + 18.5, R[2] + 21.5, R[3] + 21.5] }];
      for (const [colour, A] of Object.entries(e.also ?? {})) windows.push({ colour, rect: [A[0] + 18.5, A[1] + 18.5, A[2] + 21.5, A[3] + 21.5] });
      for (const [colour, A] of Object.entries(e.absent ?? {})) windows.push({ colour, rect: [A[0] + 18.5, A[1] + 18.5, A[2] + 21.5, A[3] + 21.5] });
      jobs.push({ pdf, page: 0, dpi: 1200, windows, strays: ['red', 'green', 'blue'] });
      meta.push({ name, e });
    }
    measure('pdf', jobs).forEach((m, i) => {
      const { name, e } = meta[i];
      const want = e.red.map((v) => v + 20);
      const d = m.windows[0]?.found ? dev(m.windows[0].bbox, want) : Infinity;
      // p12/p13: the reviewer's truth is rounded to 0.018 mm (REVIEW_ENGINE); every other page measures 0.0000
      check(`blind pdf ${name}`, 'red feature position', d <= TOL, { measured: d, expected: 0 });
      const also = Object.entries(e.also ?? {});
      also.forEach(([colour, A], k) => {
        const win = m.windows[1 + k];
        const dd = win?.found ? dev(win.bbox, A.map((v) => v + 20)) : Infinity;
        check(`blind pdf ${name}`, `${colour} feature position`, dd <= TOL, { measured: dd, expected: 0 });
      });
      m.windows.slice(1 + also.length).forEach((win) => check(`blind pdf ${name}`, `${win.colour} (hidden layer) not printed`, !win.found || win.area < 0.01, { measured: win.area, expected: 0 }));
      const strays = Object.entries(m.stray).filter(([, k]) => k > 0);
      check(`blind pdf ${name}`, 'no ink outside the expected feature', strays.length === 0, { note: strays.length ? JSON.stringify(Object.fromEntries(strays)) : undefined });
    });
  }

  // ------------------------------------------------------------------------------------------- 2c. blind images
  {
    const exp = JSON.parse(readFileSync(path.join(BLIND, 'img/expected.json'), 'utf8'));
    const names = Object.keys(exp);
    const io = JSON.parse(execFileSync(path.join(CG, 'imgio'), names.map((n) => path.join(BLIND, 'img', n))).toString());
    const MAP = { 1: (x, y) => [x, y], 2: (x, y, W) => [W - x, y], 3: (x, y, W, H) => [W - x, H - y], 4: (x, y, W, H) => [x, H - y], 5: (x, y) => [y, x], 6: (x, y, W, H) => [H - y, x], 7: (x, y, W, H) => [H - y, W - x], 8: (x, y, W) => [y, W - x] };
    const disp = (o, r, W, H) => {
      const a = MAP[o](r[0], r[1], W, H);
      const b = MAP[o](r[2], r[3], W, H);
      return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
    };
    const jobs = [];
    const meta = [];
    const k = 0.3;
    for (const name of names) {
      const e = exp[name];
      const bytes = new Uint8Array(readFileSync(path.join(BLIND, 'img', name)));
      const r = await inspectAsset('image', bytes);
      if (!r.ok) {
        check(`blind image ${name}`, 'imports', false, { note: r.error });
        continue;
      }
      const [W, H] = e.raw;
      const sw = e.orientation >= 5;
      const rep = r.asset.report;
      check(`blind image ${name}`, `displayed ${sw ? H : W} × ${sw ? W : H} px, orientation ${e.orientation}`, r.asset.pxW === (sw ? H : W) && r.asset.pxH === (sw ? W : H) && rep.orientation === e.orientation, { note: `${r.asset.pxW}×${r.asset.pxH} o${rep.orientation}` });
      // density: the reviewer's ImageIO cross-check (APP13-only is ignored by both, D48)
      const d = io[name];
      const ours = rep.density ? (rep.orientation >= 5 ? rep.density.dpiY : rep.density.dpiX) : 72;
      check(`blind image ${name}`, 'declared dpi = ImageIO', Math.abs(ours - Number(d.DPIWidth ?? 72)) < 0.05, { measured: ours, expected: Number(d.DPIWidth ?? 72) });
      const pa = planAssetOf({ id: 1, kind: 'image', pxW: r.asset.pxW, pxH: r.asset.pxH, svgPxPerIn: null, report: rep });
      const dw = sw ? H : W;
      const dh = sw ? W : H;
      const plan = planPrint({ sheets: [{ id: 1, widthMm: 210, heightMm: 297 }], objects: [{ ...OBJ, id: 1, sheetId: 1, kind: 'image', assetId: 1, x: 20, y: 20, w: dw * k, h: dh * k }], assets: [pa], output: single('a4'), ctx });
      const w = await writePdf(plan, { title: name, checkBarCaption: 'x', paintAsset: createAssetPainter(async () => ({ kind: 'image', bytes })) });
      const pdf = path.join(OUT, `img-${name}.pdf`);
      writeFileSync(pdf, w.bytes);
      const red = disp(e.orientation, [0, 0, 150, 100], W, H).map((v) => 20 + v * k);
      const blue = disp(e.orientation, [225, 150, 300, 200], W, H).map((v) => 20 + v * k);
      jobs.push({ pdf, page: 0, dpi: 600, windows: [{ colour: 'red', rect: [red[0] - 2, red[1] - 2, red[2] + 2, red[3] + 2] }, { colour: 'blue', rect: [blue[0] - 2, blue[1] - 2, blue[2] + 2, blue[3] + 2] }], strays: ['red', 'blue'] });
      meta.push({ name, red, blue });
    }
    measure('img', jobs).forEach((m, i) => {
      const { name, red, blue } = meta[i];
      // CMYK JPEG: one pixel (0.3 mm) of chroma blur at the edges (REVIEW_ENGINE); colours must not invert
      const tol = name.includes('cmyk') ? 0.35 : TOL;
      for (const [win, want, c] of [[m.windows[0], red, 'red'], [m.windows[1], blue, 'blue']]) {
        const d = win?.found ? dev(win.bbox, want) : Infinity;
        check(`blind image ${name}`, `${c} block where EXIF orientation puts it`, d <= tol, { measured: d, expected: 0 });
      }
    });
  }

  // ------------------------------------------------------------------------------------------- 3. layout probes
  {
    const OUTP = { paperKey: 'a4', orientation: 'auto', margins: uniformMargins(6.35), overlapMm: 10, marks: 'registration', pageLabels: true, assemblyMap: 'auto', skipBlank: false, excludedTiles: [], checkBar: true, ppiTarget: 300 };
    const emit = async (name, plan) => {
      const pdf = path.join(OUT, `L-${name}.pdf`);
      writeFileSync(pdf, (await writePdf(plan, { title: name, checkBarCaption: 'This bar must measure 100 mm' })).bytes);
      return pdf;
    };
    // D53, written here independently of the engine: a landscape frame (297 wide on A4) turned onto the portrait page
    const turn = (x, y) => [y, 297 - x];
    const turnRect = ([x0, y0, x1, y1]) => {
      const a = turn(x0, y0);
      const b = turn(x1, y1);
      return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
    };
    const jobs = [];
    const meta = [];

    // W3: 600 × 900 on A4, auto → landscape frames 3 × 5 + map; red rect across seams; marks from the oracle formula
    {
      const plan = planPrint({ sheets: [{ id: 1, widthMm: 600, heightMm: 900 }], objects: [{ ...OBJ, id: 1, sheetId: 1, kind: 'rect', x: 150, y: 250, w: 100, h: 60, props: { fill: '#ff0000', stroke: null } }], output: OUTP, ctx });
      const pdf = await emit('w3', plan);
      check('blind layout W3', '16 pages, every page portrait A4', plan.pages.length === 16 && plan.pages.every((p) => p.widthMm === 210 && p.heightMm === 297), { note: `${plan.pages.length}` });
      const sx = 274.3, sy = 187.3, o = 10, l = 6.35, t = 6.35;
      const pts = [];
      for (let rr = 0; rr < 5; rr++) for (let cc = 0; cc < 2; cc++) { const x = (cc + 1) * sx + o / 2; const y0 = rr * sy, y1 = Math.min(rr * sy + 197.3, 900); pts.push([x, y0 + (y1 - y0) / 4], [x, y0 + (3 * (y1 - y0)) / 4]); }
      for (let rr = 0; rr < 4; rr++) for (let cc = 0; cc < 3; cc++) { const y = (rr + 1) * sy + o / 2; const x0 = cc * sx, x1 = Math.min(cc * sx + 284.3, 600); pts.push([x0 + (x1 - x0) / 4, y], [x0 + (3 * (x1 - x0)) / 4, y]); }
      plan.pages.forEach((p, i) => {
        const wins = [];
        if (p.kind === 'tile') {
          const { row: r, col: c } = p.tile;
          const toFrame = (X, Y) => [X - c * sx + l, Y - r * sy + t];
          for (const [X, Y] of pts) {
            const [fx, fy] = toFrame(X, Y);
            if (fx - 4.1 >= l && fx + 4.1 <= l + 284.3 && fy - 4.1 >= t && fy + 4.1 <= t + 197.3) wins.push({ colour: 'black', rect: turnRect([fx - 4.5, fy - 4.5, fx + 4.5, fy + 4.5]), sheet: [X, Y], kind: 'mark' });
          }
          const vx0 = Math.max(150, c * sx), vx1 = Math.min(250, c * sx + 284.3), vy0 = Math.max(250, r * sy), vy1 = Math.min(310, r * sy + 197.3);
          if (vx1 > vx0 && vy1 > vy0) {
            const exp = turnRect([...toFrame(vx0, vy0), ...toFrame(vx1, vy1)]);
            wins.push({ colour: 'red', rect: [exp[0] - 1, exp[1] - 1, exp[2] + 1, exp[3] + 1], exp, kind: 'red' });
          }
        }
        jobs.push({ pdf, page: i, dpi: 1200, windows: wins.map((w) => ({ colour: w.colour, rect: w.rect })), strays: [] });
        meta.push({ name: `W3 ${p.label}`, wins, c: p.tile?.col, r: p.tile?.row });
        jobs.push({ pdf, page: i, dpi: 150, windows: [{ colour: 'any', rect: [6.35 - 0.05, 6.35 - 0.05, 210 - 6.35 + 0.05, 297 - 6.35 + 0.05] }], strays: ['any'] });
        meta.push({ name: `W3 ${p.label}`, margins: true });
      });
    }
    // W7 corrected single portrait page, and an anisotropic correction on a turned landscape page (paper terms, D53)
    for (const [name, fx, fy, W, H] of [['w7', 100 / 96.5, 100 / 96.5, 210, 297], ['aniso-landscape', 100 / 97, 100 / 99, 297, 210]]) {
      const plan = planPrint({ sheets: [{ id: 1, widthMm: W, heightMm: H }], objects: [{ ...OBJ, id: 1, sheetId: 1, kind: 'rect', x: 80, y: 120, w: 50, h: 40, props: { fill: '#ff0000', stroke: null } }], output: { ...OUTP, orientation: W > H ? 'landscape' : 'portrait' }, corrections: [{ paperKey: 'a4', jobKind: 'single', fx, fy }], ctx });
      const pdf = await emit(name, plan);
      const page = (x, y) => (W > H ? turn(x, y) : [x, y]);
      const C = ([X, Y]) => [105 + fx * (X - 105), 148.5 + fy * (Y - 148.5)];
      const r0 = C(page(80, 120));
      const r1 = C(page(130, 160));
      const exp = [Math.min(r0[0], r1[0]), Math.min(r0[1], r1[1]), Math.max(r0[0], r1[0]), Math.max(r0[1], r1[1])];
      jobs.push({ pdf, page: 0, dpi: 1200, windows: [{ colour: 'red', rect: [exp[0] - 1, exp[1] - 1, exp[2] + 1, exp[3] + 1] }], strays: [] });
      meta.push({ name: `correction ${name}`, wins: [{ colour: 'red', exp, kind: 'red' }] });
    }
    // placed A6 on A4: content + crop marks
    {
      const plan = planPrint({ sheets: [{ id: 1, widthMm: 105, heightMm: 148 }], objects: [{ ...OBJ, id: 1, sheetId: 1, kind: 'rect', x: 10, y: 10, w: 85, h: 128, props: { fill: '#ff0000', stroke: null } }], output: { ...OUTP, orientation: 'portrait', checkBar: false }, ctx });
      const pdf = await emit('placed-a6', plan);
      const ox = 52.5, oy = 74.5;
      const wins = [{ colour: 'red', rect: [ox + 9, oy + 9, ox + 96, oy + 139], exp: [ox + 10, oy + 10, ox + 95, oy + 138], kind: 'red' }];
      for (const x of [ox, ox + 105]) wins.push({ colour: 'black', rect: [x - 1, oy - 6.5, x + 1, oy - 0.5], exp: [x - 0.1, oy - 6, x + 0.1, oy - 1], kind: 'red' });
      for (const y of [oy, oy + 148]) wins.push({ colour: 'black', rect: [ox - 6.5, y - 1, ox - 0.5, y + 1], exp: [ox - 6, y - 0.1, ox - 1, y + 0.1], kind: 'red' });
      jobs.push({ pdf, page: 0, dpi: 1200, windows: wins.map((w) => ({ colour: w.colour, rect: w.rect })), strays: [] });
      meta.push({ name: 'placed A6', wins });
    }
    // W6 labels 3 × 8 (oracle position 28 / 21.5) + top trim marks
    {
      const plan = planPrint({ sheets: [{ id: 1, widthMm: 210, heightMm: 297 }], objects: [{ ...OBJ, id: 1, sheetId: 1, kind: 'rect', x: 28, y: 21.5, w: 50, h: 30, repeat: { cols: 3, rows: 8, gap_x_mm: 2, gap_y_mm: 2, trim_marks: true }, props: { fill: '#ff0000', stroke: null } }], output: { ...OUTP, orientation: 'portrait' }, ctx });
      const pdf = await emit('w6', plan);
      const wins = [{ colour: 'red', rect: [27, 20.5, 79, 52.5], exp: [28, 21.5, 78, 51.5], kind: 'red' }, { colour: 'red', rect: [131, 244.5, 183, 276.5], exp: [132, 245.5, 182, 275.5], kind: 'red' }];
      for (const x of [28, 78, 80, 130, 132, 182]) wins.push({ colour: 'black', rect: [x - 0.6, 15, x + 0.6, 21], exp: [x - 0.1, 15.5, x + 0.1, 20.5], kind: 'red' });
      jobs.push({ pdf, page: 0, dpi: 1200, windows: wins.map((w) => ({ colour: w.colour, rect: w.rect })), strays: [] });
      meta.push({ name: 'W6 labels', wins });
    }

    const res = measure('layout', jobs);
    const markWorst = { d: 0, n: 0 };
    res.forEach((m, i) => {
      const mt = meta[i];
      if (mt.margins) {
        check('blind layout', `${mt.name} margin strips blank`, (m.stray.any ?? 0) === 0, { measured: m.stray.any ?? 0, expected: 0 });
        return;
      }
      mt.wins.forEach((w, k) => {
        const got = m.windows[k];
        if (w.kind === 'mark') {
          // measured centre (page) → frame (inverse turn: x = 297 − Y, y = X) → sheet; must equal the oracle point
          const cx = got.found ? (got.bbox[0] + got.bbox[2]) / 2 : NaN;
          const cy = got.found ? (got.bbox[1] + got.bbox[3]) / 2 : NaN;
          const sheet = [297 - cy - 6.35 + mt.c * 274.3, cx - 6.35 + mt.r * 187.3];
          const d = dev(sheet, w.sheet);
          markWorst.d = Math.max(markWorst.d, d);
          markWorst.n++;
          check('blind layout', `${mt.name} registration mark at sheet (${w.sheet.map((v) => +v.toFixed(3)).join(', ')})`, d <= TOL, { measured: d, expected: 0 });
          return;
        }
        const d = got?.found ? dev(got.bbox, w.exp) : Infinity;
        check('blind layout', `${mt.name} ${w.colour} ${w.exp.map((v) => +v.toFixed(3)).join(',')}`, d <= TOL, { measured: d, expected: 0 });
      });
    });
    check('blind layout', `W3 registration marks measured (${markWorst.n})`, markWorst.n >= 80, { measured: markWorst.d, expected: 0 });
  }
}

// direct run: node --import ./scripts/referee/register.mjs scripts/referee/blind.mjs
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let fails = 0;
  let n = 0;
  await runBlind((p, c, ok, d) => {
    n++;
    if (!ok) fails++;
    if (!ok) console.log('FAIL', p, '·', c, d ? JSON.stringify(d) : '');
  }, path.join(ROOT, 'artifacts/referee'));
  console.log(`blind: ${n - fails}/${n}`);
  process.exit(fails ? 1 : 0);
}
