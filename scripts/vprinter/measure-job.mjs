// Measures a print job the virtual printer received (or any PDF a print dialog saved) against a referee fixture's
// expectations (V1_PLAN P4 step 4, SPEC A7). Two independent CoreGraphics measurers: the referee's `measure`
// (tick centres, feature extents) and the P3.5 reviewer's `scripts/cg/rmeasure` (end-line / mark bounding boxes).
//
// The job page may differ from our page: the iOS renderer centres the page on a different paper (scale 1), a print
// service may fit it (scale s < 1) or put it at the top-left corner. Each hypothesis "page × s, centred / top-left on the
// job page" is tried (s = 1, fit to paper, fit to the printable area of 6.35/3.4 mm margins); the one whose features
// are all found wins, and the measured spans give the true scale anyway (span / nominal).
// Usage: [GRAY=1] [ONLY_PAGE=n] [SCALE=s] node scripts/vprinter/measure-job.mjs <job.pdf> <fixture-name> [label]   (raster jobs: raster-to-pdf.mjs first)
// Output: one line per feature + JSON summary appended to artifacts/vprinter/measurements.jsonl
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'artifacts/vprinter');
const MEASURE = path.join(ROOT, 'artifacts/referee/measure');
const RMEASURE = path.join(ROOT, 'scripts/cg/rmeasure');
const K = 72 / 25.4;
const [job, fixture, label = ''] = process.argv.slice(2);
if (!job || !fixture) {
  console.error('Usage: measure-job.mjs <job.pdf> <fixture-name> [label]');
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });
if (!existsSync(MEASURE) || statSync(MEASURE).mtimeMs < statSync(path.join(ROOT, 'scripts/referee/measure.swift')).mtimeMs) {
  execFileSync('swiftc', ['-O', path.join(ROOT, 'scripts/referee/measure.swift'), '-o', MEASURE], { stdio: 'inherit' });
}
execFileSync(path.join(ROOT, 'scripts/cg/build.sh'), ['rmeasure']);

const f = JSON.parse(readFileSync(path.join(ROOT, 'test/fixtures/projects', `${fixture}.json`), 'utf8'));
const e = f.expect;
const pageMm = Array.isArray(e.pageSizeMm[0]) ? e.pageSizeMm[0] : e.pageSizeMm;
// GRAY=1: a grayscale raster job has no colours, so every feature is measured as "ink" (anything not white)
// and tick thresholds are halved (pure red becomes ~50 % grey in Apple's URF: 1 mm ticks weigh 0.49 "ink mm" < 0.6)
let features = (e.features ?? []).map((ft) => (process.env.GRAY === '1' ? { ...ft, colour: 'ink', minTickMm: ft.minTickMm === undefined ? undefined : ft.minTickMm / 2 } : ft));
// ONLY_PAGE=n (P6, Android "one by one"): the job is page n of the fixture alone — its features are measured on job page 0
// and cross-page checks are skipped
if (process.env.ONLY_PAGE !== undefined) {
  features = features.filter((ft) => ft.page === Number(process.env.ONLY_PAGE)).map((ft) => ({ ...ft, page: 0 }));
  e.same = [];
}
const pages = [...new Set(features.map((ft) => ft.page))];

function run(bin, args, input) {
  const req = path.join(OUT, `req-${process.pid}.json`);
  writeFileSync(req, JSON.stringify(input));
  if (bin === RMEASURE) {
    // the reviewer's tool writes its result to a file: rmeasure jobs.json out.json
    const res = path.join(OUT, `res-${process.pid}.json`);
    execFileSync(bin, [req, res], { maxBuffer: 64 << 20 });
    return JSON.parse(readFileSync(res, 'utf8'));
  }
  return JSON.parse(execFileSync(bin, [...args, req], { maxBuffer: 64 << 20 }).toString());
}

// job page size (mm) of each page we need
const probe = run(MEASURE, ['pdf'], { pdf: path.resolve(job), dpi: 72, coarseDpi: 10, pages: pages.map((index) => ({ index, margins: null, windows: [], allowed: {} })) });
const jobPage = (i) => {
  const mb = probe.pages.find((p) => p.index === i).mediaBoxPt;
  return { w: (mb[2] - mb[0]) / K, h: (mb[3] - mb[1]) / K };
};

let anchor = 'centre';
function transform(page, s) {
  const jp = jobPage(page);
  if (anchor === 'top-left') return { s, dx: 0, dy: 0 };
  return { s, dx: (jp.w - pageMm[0] * s) / 2, dy: (jp.h - pageMm[1] * s) / 2 };
}
const tx = (t, x) => x * t.s + t.dx;
const ty = (t, y) => y * t.s + t.dy;
const rectT = (t, r, pad = 0) => [tx(t, r[0]) - pad, ty(t, r[1]) - pad, r[2] * t.s + 2 * pad, r[3] * t.s + 2 * pad];

function measureAll(sOf) {
  const req = {
    pdf: path.resolve(job),
    dpi: 1200,
    coarseDpi: 75,
    pages: pages.map((index) => {
      const t = transform(index, sOf(index));
      // windows grow by 0.6 mm only on scaled jobs (features move a little); at scale 1 the fixture's own windows (some
      // cut a mark on purpose) are used unchanged
      return { index, margins: null, allowed: {}, windows: features.filter((ft) => ft.page === index).map((ft) => ({ id: ft.id, rect: rectT(t, ft.rect, ft.mode === 'ticks' || t.s === 1 ? 0 : 0.6), colour: ft.colour, mode: ft.mode, axis: ft.axis, minTickMm: ft.minTickMm })) };
    }),
  };
  return run(MEASURE, ['pdf'], req);
}

function evaluate(m, sOf) {
  const rows = [];
  let allFound = true;
  for (const ft of features) {
    const t = transform(ft.page, sOf(ft.page));
    const w = m.pages.find((p) => p.index === ft.page)?.windows.find((x) => x.id === ft.id);
    if (!w || (w.area ?? 0) <= 0) {
      allFound = false;
      rows.push({ id: ft.id, found: false });
      continue;
    }
    const row = { id: ft.id, page: ft.page, found: true };
    for (const [k, want] of Object.entries(ft.expect)) {
      if (k === 'positions') {
        const exp = want.map((v) => (ft.axis === 'y' ? ty(t, v) : tx(t, v)));
        row.positions = { expected: exp, measured: w.ticks, delta: w.ticks?.length === exp.length ? w.ticks.map((v, j) => v - exp[j]) : null };
        if (w.ticks?.length !== exp.length) allFound = false;
      } else if (k === 'span') {
        const got = w.ticks && w.ticks.length > 1 ? w.ticks[w.ticks.length - 1] - w.ticks[0] : null;
        row.span = { nominal: want, measured: got, delta: got === null ? null : got - want, scale: got === null ? null : got / want };
        if (got === null) allFound = false;
      } else if (k === 'ticks') {
        row.ticks = { expected: want, measured: w.ticks?.length };
        if (w.ticks?.length !== want) allFound = false;
      } else if (k === 'first' || k === 'last') {
        const got = k === 'first' ? w.ticks?.[0] : w.ticks?.[w.ticks.length - 1];
        const exp = ft.axis === 'y' ? ty(t, want) : tx(t, want);
        row[k] = { expected: exp, measured: got, delta: got === undefined ? null : got - exp };
      } else if (k === 'maxStepError') {
        const steps = (w.ticks ?? []).slice(1).map((v, j) => v - w.ticks[j]);
        row.maxStepError = steps.length ? Math.max(...steps.map((v) => Math.abs(v - ft.step * t.s))) : null;
      } else if (['cx', 'l', 'r'].includes(k)) row[k] = { expected: tx(t, want), measured: w[k], delta: w[k] - tx(t, want) };
      else if (['cy', 't', 'b'].includes(k)) row[k] = { expected: ty(t, want), measured: w[k], delta: w[k] - ty(t, want) };
      else if (k === 'area') row.area = { expected: want * t.s * t.s, measured: w.area };
    }
    rows.push(row);
  }
  // registration marks / shared ticks on neighbouring pages: offset between pages in PAGE millimetres
  for (const s of e.same ?? []) {
    const a = rows.find((r) => r.id === s.a);
    const b = rows.find((r) => r.id === s.b);
    if (!a?.found || !b?.found) continue;
    const ga = (r, k) => r[k]?.measured;
    const sa = sOf(a.page);
    const dx = s.dx === null ? null : (ga(b, 'cx') - ga(a, 'cx')) / sa;
    const dy = s.dy === null ? null : (ga(b, 'cy') - ga(a, 'cy')) / sa;
    rows.push({ id: `${s.b} − ${s.a}`, same: true, expected: [s.dx, s.dy], measured: [dx, dy], delta: [dx === null ? 0 : dx - s.dx, dy === null ? 0 : dy - s.dy] });
  }
  return { rows, allFound };
}

// rmeasure cross-check: bounding box of ink ("any") in a 3 mm window around every tick/end position the referee found
function crossCheck(rows, sOf) {
  const jobs = [];
  for (const r of rows) {
    if (!r.found || !r.positions?.measured) continue;
    const ft = features.find((x) => x.id === r.id);
    const t = transform(ft.page, sOf(ft.page));
    const R = rectT(t, ft.rect);
    for (const p of r.positions.measured) {
      const rect = ft.axis === 'y' ? [R[0], p - 1, R[0] + R[2], p + 1] : [p - 1, R[1], p + 1, R[1] + R[3]];
      jobs.push({ id: r.id, pdf: path.resolve(job), page: ft.page, dpi: 1200, windows: [{ colour: 'any', rect }] });
    }
  }
  if (!jobs.length) return [];
  const out = run(RMEASURE, [], jobs.map(({ id, ...j }) => j));
  const byId = {};
  out.forEach((o, i) => {
    const w = o.windows[0];
    const ft = features.find((x) => x.id === jobs[i].id);
    const c = w.found ? (ft.axis === 'y' ? (w.bbox[1] + w.bbox[3]) / 2 : (w.bbox[0] + w.bbox[2]) / 2) : null;
    (byId[jobs[i].id] ??= []).push(c);
  });
  return Object.entries(byId).map(([id, cs]) => ({ id, rmeasureCentres: cs, rmeasureSpan: cs.length > 1 && cs.every((c) => c !== null) ? cs[cs.length - 1] - cs[0] : null }));
}

const hypotheses = [
  ['scale 1', () => 1],
  ['fit to paper', (i) => Math.min(jobPage(i).w / pageMm[0], jobPage(i).h / pageMm[1])],
  ['fit to 6.35 mm margins', (i) => Math.min((jobPage(i).w - 12.7) / pageMm[0], (jobPage(i).h - 12.7) / pageMm[1])],
  ['fit to 3.4 mm margins', (i) => Math.min((jobPage(i).w - 6.8) / pageMm[0], (jobPage(i).h - 6.8) / pageMm[1])],
];
// SCALE=s (P6): a corrected job (calibration correction about the page centre) — try that scale first
if (process.env.SCALE) hypotheses.unshift([`given scale ${process.env.SCALE}`, () => Number(process.env.SCALE)]);
let best = null;
let spanScale = null;
search: for (const a of ['centre', 'top-left']) {
  anchor = a;
  for (const [name, sOf] of hypotheses) {
    const m = measureAll(sOf);
    const r = evaluate(m, sOf);
    if (r.allFound) {
      best = { hypothesis: `${name}, ${a}`, scale: sOf(pages[0]), ...r, cross: crossCheck(r.rows, sOf) };
      break search;
    }
    spanScale ??= r.rows.find((x) => x.span?.scale)?.span.scale ?? null;
    best ??= { hypothesis: `${name}, ${a} (features missing)`, scale: sOf(pages[0]), ...r, cross: [] };
  }
}
// none fits: use the scale one measured span showed, centred and then anchored top-left
if (!best?.rows.every((r) => r.found) && spanScale) {
  for (const a of ['centre', 'top-left']) {
    anchor = a;
    const sOf = () => spanScale;
    const r = evaluate(measureAll(sOf), sOf);
    if (r.allFound) {
      best = { hypothesis: `measured scale, ${a}`, scale: spanScale, ...r, cross: crossCheck(r.rows, sOf) };
      break;
    }
  }
}

const n = (v, d = 3) => (typeof v === 'number' ? v.toFixed(d) : String(v));
console.log(`${label} ${path.basename(job)} vs ${fixture}: job page ${n(jobPage(pages[0]).w, 2)} × ${n(jobPage(pages[0]).h, 2)} mm (ours ${pageMm.join(' × ')}), hypothesis ${best.hypothesis}, s = ${n(best.scale, 5)}`);
for (const r of best.rows) {
  if (!r.found && !r.same) console.log(`  ${r.id}: NOT FOUND`);
  else if (r.same) console.log(`  ${r.id}: measured (${r.measured.map((v) => n(v)).join(', ')}) expected (${r.expected.join(', ')}) Δ (${r.delta.map((v) => n(v)).join(', ')}) mm`);
  else {
    const parts = [];
    if (r.span) parts.push(`span ${n(r.span.measured)} mm (nominal ${r.span.nominal}, Δ ${n(r.span.delta)}, ×${n(r.span.scale, 5)})`);
    if (r.positions) parts.push(`ends Δ ${r.positions.delta?.map((v) => n(v)).join(' / ')}`);
    if (r.ticks) parts.push(`ticks ${r.ticks.measured}/${r.ticks.expected}`);
    for (const k of ['first', 'last', 'cx', 'cy', 'l', 't', 'r', 'b']) if (r[k]) parts.push(`${k} Δ ${n(r[k].delta)}`);
    if (r.maxStepError !== undefined) parts.push(`max step error ${n(r.maxStepError)}`);
    console.log(`  ${r.id}: ${parts.join(', ')}`);
  }
}
for (const c of best.cross) console.log(`  rmeasure ${c.id}: span ${n(c.rmeasureSpan)} mm`);
appendFileSync(path.join(OUT, 'measurements.jsonl'), JSON.stringify({ at: new Date().toISOString(), label, job: path.relative(ROOT, path.resolve(job)), fixture, jobPageMm: jobPage(pages[0]), hypothesis: best.hypothesis, scale: best.scale, rows: best.rows, cross: best.cross }) + '\n');
