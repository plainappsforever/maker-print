// npm run referee (D25, SPEC §14 A2–A6): for every test/fixtures/projects/*.json — plan → PDF (the app's own engine
// and writer, run by plain Node with type stripping) → CoreGraphics measurement (measure.swift) → comparison with
// the fixture's expectations, which were written from the SPEC by hand, never copied from engine output.
// Output: artifacts/referee/<project>.pdf, artifacts/referee/report.json, one line per check; exit 1 on a failure.
// Also cross-checks the image header reader against Apple ImageIO for test/fixtures/images, and runs the P3.5
// reviewer's independent oracle + blind fixtures + measurer (blind.mjs; `npm run referee blind` runs only that part).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { planCalibration, planPrint } from '../../src/engine/plan.ts';
import { uniformMargins } from '../../src/engine/paper.ts';
import { printTranslator } from '../../src/i18n/index.ts';
import { decodeSvgText, inspectAsset, planAssetOf } from '../../src/import/assets.ts';
import { readImageMeta } from '../../src/import/image-meta.ts';
import { createAssetPainter } from '../../src/pdf/assets.ts';
import { writePdf } from '../../src/pdf/writer.ts';
import { runBlind } from './blind.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'artifacts/referee');
const FIX = path.join(ROOT, 'test/fixtures');
const BIN = path.join(OUT, 'measure');
const SRC = path.join(ROOT, 'scripts/referee/measure.swift');
const K = 72 / 25.4;
const only = process.argv[2];

mkdirSync(OUT, { recursive: true });
if (!existsSync(BIN) || statSync(BIN).mtimeMs < statSync(SRC).mtimeMs) {
  execFileSync('swiftc', ['-O', SRC, '-o', BIN], { stdio: 'inherit' });
}

const ctx = { locale: 'en', unit: 'mm', inchStyle: 'fraction16', t: printTranslator('en') };
const OUTPUT_DEFAULTS = {
  paperKey: 'a4',
  orientation: 'auto',
  margins: uniformMargins(6.35),
  overlapMm: 10,
  marks: 'registration',
  pageLabels: true,
  assemblyMap: 'auto',
  skipBlank: true,
  excludedTiles: [],
  checkBar: false,
  ppiTarget: 300,
};
const OBJECT_DEFAULTS = { z: 0, assetId: null, pageIndex: 0, rotationDeg: 0, mirrorX: false, mirrorY: false, crop: null, fit: 'fill', repeat: null, props: {}, hidden: false };

const results = [];
let failures = 0;
const check = (project, name, ok, detail) => {
  results.push({ project, check: name, ok, ...detail });
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${project} · ${name}${detail?.measured !== undefined ? ` · measured ${fmt(detail.measured)} expected ${fmt(detail.expected)}` : ''}${detail?.note ? ` · ${detail.note}` : ''}`);
};
const fmt = (v) => (typeof v === 'number' ? v.toFixed(4) : JSON.stringify(v));

async function loadAssets(spec) {
  const files = new Map();
  const plan = [];
  for (const a of spec ?? []) {
    const bytes = new Uint8Array(readFileSync(path.join(FIX, a.file)));
    files.set(a.id, a.kind === 'svg' ? { kind: 'svg', text: decodeSvgText(bytes).text } : { kind: a.kind, bytes });
    const r = await inspectAsset(a.kind, bytes);
    if (!r.ok) throw new Error(`${a.file}: ${r.error}`);
    plan.push(planAssetOf({ id: a.id, kind: a.kind, pxW: r.asset.pxW, pxH: r.asset.pxH, svgPxPerIn: a.svgPxPerIn ?? null, report: r.asset.report }));
  }
  return { files, plan };
}

async function runProject(file) {
  const name = path.basename(file, '.json');
  const f = JSON.parse(readFileSync(file, 'utf8'));
  const output = { ...OUTPUT_DEFAULTS, ...(f.output ?? {}) };
  if (typeof output.margins === 'number') output.margins = uniformMargins(output.margins);
  const { files, plan: planAssets } = await loadAssets(f.assets);
  const plan =
    f.kind === 'calibration'
      ? planCalibration({ paperKey: f.calibration.paperKey, margins: output.margins, pages: f.calibration.pages ?? 1, ctx, corrections: f.corrections, applyCorrection: f.applyCorrection })
      : planPrint({ sheets: f.sheets, objects: f.objects.map((o) => ({ ...OBJECT_DEFAULTS, ...o })), assets: planAssets, output, corrections: f.corrections, applyCorrection: f.applyCorrection, printerMargins: f.printerMargins, marginRule: f.marginRule, ctx });
  const errors = plan.warnings.filter((w) => w.level === 'error');
  check(name, 'plan has no errors', errors.length === 0, errors.length ? { note: errors.map((e) => e.code).join(',') } : undefined);
  // every fixture places its objects at 100 % inside the safe area: a size or clip warning means a wrong natural size
  const forbidden = f.expect.forbiddenWarnings ?? ['notDesignedSize', 'assetSizeUnknown', 'objectInMargin', 'objectPartlyOffSheet', 'objectOffSheet'];
  const bad = plan.warnings.filter((w) => forbidden.includes(w.code));
  check(name, 'objects at designed size, inside the safe area', bad.length === 0, bad.length ? { note: bad.map((w) => `${w.code} ${JSON.stringify(w.params ?? {})}`).join('; ') } : undefined);
  // v1.1: warnings the screen must show for this job (e.g. the Android enlarging correction, D83)
  for (const code of f.expect.requiredWarnings ?? []) check(name, `warning ${code} shown`, plan.warnings.some((w) => w.code === code), { note: plan.warnings.map((w) => w.code).join(',') });
  const painter = createAssetPainter(async (id) => files.get(id) ?? null);
  const written = await writePdf(plan, { title: name, checkBarCaption: 'This bar must measure 100 mm', paintAsset: painter });
  check(name, 'every asset drawn', written.notes.length === 0, written.notes.length ? { note: JSON.stringify(written.notes) } : undefined);
  const pdfPath = path.join(OUT, `${name}.pdf`);
  writeFileSync(pdfPath, written.bytes);

  const e = f.expect;
  const pages = plan.pages.map((p, index) => ({
    index,
    // `marginStripsMm`: the printer's strips when the plan's margins were widened for a correction (D83)
    margins: e.marginCheck === false ? null : (e.marginStripsMm ?? [output.margins.l, output.margins.t, output.margins.r, output.margins.b]),
    windows: (e.features ?? []).filter((ft) => ft.page === index).map((ft) => ({ id: ft.id, rect: ft.rect, colour: ft.colour, mode: ft.mode, axis: ft.axis, minTickMm: ft.minTickMm })),
    allowed: allowedOn(e, index),
  }));
  const reqPath = path.join(OUT, `${name}.request.json`);
  writeFileSync(reqPath, JSON.stringify({ pdf: pdfPath, dpi: e.dpi ?? 1200, coarseDpi: 150, pages }));
  const m = JSON.parse(execFileSync(BIN, ['pdf', reqPath], { maxBuffer: 64 << 20 }).toString());

  check(name, 'page count', m.pageCount === e.pageCount, { measured: m.pageCount, expected: e.pageCount });
  check(name, '/PrintScaling /None', m.printScaling === 'None', { note: String(m.printScaling) });
  m.pages.forEach((p, i) => {
    // a null entry = the paper in either orientation (the SPEC does not fix the assembly map's orientation)
    const listed = Array.isArray(e.pageSizeMm[0]) || e.pageSizeMm[0] === null ? e.pageSizeMm[i] : e.pageSizeMm;
    const options = listed ? [listed] : [e.paperMm, [e.paperMm[1], e.paperMm[0]]];
    const fit = options.map((size) => ({ size, dw: Math.abs(p.mediaBoxPt[2] - p.mediaBoxPt[0] - size[0] * K), dh: Math.abs(p.mediaBoxPt[3] - p.mediaBoxPt[1] - size[1] * K) })).sort((a, b) => a.dw + a.dh - b.dw - b.dh)[0];
    check(name, `page ${i + 1} MediaBox = ${fit.size[0]} × ${fit.size[1]} mm (±0.001 pt)`, fit.dw <= 0.001 && fit.dh <= 0.001 && p.mediaBoxPt[0] === 0 && p.mediaBoxPt[1] === 0, { note: `Δ ${fit.dw.toExponential(1)} / ${fit.dh.toExponential(1)} pt` });
    if (p.marginInk) check(name, `page ${i + 1} margin strips blank`, p.marginPixels === 0, { note: p.marginPixels ? `${p.marginPixels} inked px, max ${p.marginInk.map((v) => v.toFixed(2))}` : undefined });
    if (e.exclusive !== false) {
      const strays = Object.entries(p.strays ?? {});
      check(name, `page ${i + 1} coloured ink only where expected`, strays.length === 0, { note: strays.length ? strays.map(([c, n]) => `${n} stray ${c} px (150 dpi)`).join(', ') : undefined });
    }
  });
  const byId = new Map();
  for (const ft of e.features ?? []) {
    const w = m.pages[ft.page]?.windows.find((x) => x.id === ft.id);
    byId.set(ft.id, w);
    if (!w) {
      check(name, ft.id, false, { note: 'window not measured' });
      continue;
    }
    const tol = ft.tol ?? 0.05;
    for (const [k, want] of Object.entries(ft.expect)) {
      let got;
      if (k === 'positions') {
        const ok = w.ticks?.length === want.length && want.every((v, j) => Math.abs(w.ticks[j] - v) <= tol);
        const worst = w.ticks?.length === want.length ? Math.max(...want.map((v, j) => Math.abs(w.ticks[j] - v))) : undefined;
        check(name, `${ft.id} · positions ${want.join(', ')}`, ok, { measured: worst ?? w.ticks, expected: 0 });
        continue;
      }
      if (k === 'ticks') got = w.ticks?.length;
      else if (k === 'span') got = w.ticks && w.ticks.length > 1 ? w.ticks[w.ticks.length - 1] - w.ticks[0] : undefined;
      else if (k === 'first') got = w.ticks?.[0];
      else if (k === 'last') got = w.ticks?.[w.ticks.length - 1];
      else if (k === 'maxStepError') {
        const steps = (w.ticks ?? []).slice(1).map((t, j) => t - w.ticks[j]);
        got = steps.length ? Math.max(...steps.map((s) => Math.abs(s - ft.step))) : undefined;
        check(name, `${ft.id} · every step ${ft.step} mm (±${want})`, got !== undefined && got <= want, { measured: got, expected: 0 });
        continue;
      } else got = w[k];
      const t = k === 'area' ? (ft.areaTol ?? 0.01) * want : k === 'ticks' ? 0 : tol;
      check(name, `${ft.id} · ${k}`, typeof got === 'number' && Math.abs(got - want) <= t, { measured: got, expected: want });
    }
  }
  for (const s of e.same ?? []) {
    const a = byId.get(s.a);
    const b = byId.get(s.b);
    const dx = b && a ? b.cx - a.cx : NaN;
    const dy = b && a ? b.cy - a.cy : NaN;
    // dy/dx null = that axis is cut by the window (a tick seen through a band), so it is not compared
    const okX = s.dx === null || Math.abs(dx - s.dx) <= 0.05;
    const okY = s.dy === null || Math.abs(dy - s.dy) <= 0.05;
    check(name, `${s.b} − ${s.a} = (${s.dx ?? '·'}, ${s.dy ?? '·'}) mm`, okX && okY, { measured: [s.dx === null ? 0 : dx - s.dx, s.dy === null ? 0 : dy - s.dy], expected: [0, 0] });
  }
}

/** Coloured ink is allowed in the colour's feature windows and in `allow` regions; anywhere else it is a stray. */
function allowedOn(e, page) {
  const out = {};
  for (const ft of e.features ?? []) if (ft.page === page && ft.colour !== 'ink') (out[ft.colour] ??= []).push(ft.rect);
  for (const a of e.allow ?? []) if (a.page === page || a.page === '*') (out[a.colour] ??= []).push(a.rect ?? [0, 0, 10000, 10000]);
  return out;
}

function imageInfo() {
  const dir = path.join(FIX, 'images');
  const files = readdirSync(dir).filter((f) => /\.(png|jpe?g)$/i.test(f)).map((f) => path.join(dir, f));
  const io = JSON.parse(execFileSync(BIN, ['imageinfo', ...files]).toString());
  for (const row of io) {
    const n = `image ${path.basename(row.file)}`;
    const r = readImageMeta(new Uint8Array(readFileSync(row.file)));
    if (row.error || !row.PixelWidth) {
      check(n, 'refused like ImageIO', !r.ok, { note: r.ok ? 'we read it, ImageIO did not' : r.error });
      continue;
    }
    if (!r.ok) {
      check(n, 'readable like ImageIO', false, { note: r.error });
      continue;
    }
    check(n, 'raw pixel size = ImageIO', r.meta.rawW === Number(row.PixelWidth) && r.meta.rawH === Number(row.PixelHeight), { note: `${r.meta.rawW}×${r.meta.rawH}` });
    check(n, 'orientation = ImageIO', r.meta.orientation === Number(row.Orientation ?? 1), { note: String(r.meta.orientation) });
    // ImageIO reports DPIWidth 72 for files without a density; we report none (and suggest no size) — same meaning
    const ours = r.meta.density ? (r.meta.orientation >= 5 ? r.meta.density.dpiY : r.meta.density.dpiX) : 72;
    const theirs = row.DPIWidth === undefined ? 72 : Number(row.DPIWidth);
    check(n, 'declared dpi = ImageIO', Math.abs(ours - theirs) < 0.05, { measured: ours, expected: theirs });
  }
}

const dir = path.join(FIX, 'projects');
const projects = only === 'blind' ? [] : readdirSync(dir).filter((f) => f.endsWith('.json') && (!only || f.includes(only))).sort();
for (const p of projects) {
  try {
    await runProject(path.join(dir, p));
  } catch (err) {
    check(path.basename(p, '.json'), 'runs', false, { note: String(err?.stack ?? err).split('\n').slice(0, 3).join(' | ') });
  }
}
if (!only) imageInfo();
// part 2: the P3.5 reviewer's oracle, blind fixtures and CoreGraphics measurer (scripts/referee/blind.mjs)
if (!only || only === 'blind') {
  try {
    await runBlind(check, OUT);
  } catch (err) {
    check('blind', 'runs', false, { note: String(err?.stack ?? err).split('\n').slice(0, 3).join(' | ') });
  }
}
writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ when: new Date().toISOString(), failures, checks: results }, null, 1));
console.log(`\nreferee: ${results.length - failures}/${results.length} checks passed across ${projects.length} projects${failures ? ` — ${failures} FAILED` : ''}`);
process.exit(failures ? 1 : 0);
