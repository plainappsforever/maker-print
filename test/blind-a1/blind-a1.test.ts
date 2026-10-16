// Blind A1 oracle — thin adapter (V15 A1, WORKFLOW L27 rules 5-7). The cases and the checker
// (`blind_a1_oracle.py`, `blind_a1_check.py`) were written by a separate agent from docs/SPEC.md §11,
// docs/V15_PLAN.md A1 and docs/DECISIONS.md D90-D94 WITHOUT reading src/engine or scripts/oracle, and measured ONCE
// against snapshot 382ceb3 (docs/V15_LOG.md "Blind oracle, measured once on 382ceb3"). Since then the set is
// no longer blind for any engine change: a fresh set from another agent is the next evidence.
// This file only feeds the cases to the engine and writes the raw outputs; every expectation lives in Python.
//   BLIND_A1_OUT=/path/results.json npx jest test/blind-a1   then   python3 -I test/blind-a1/blind_a1_check.py \
//     test/blind-a1/cases.json /path/results.json
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { applyH, homography, orderCorners, quadIssue, type Pt } from '../../src/engine/homography';
import { planScan, type KnownSize } from '../../src/engine/scan';
import { readFocal35mm } from '../../src/import/image-meta';

type Num = number;
const raw = readFileSync(join(__dirname, 'cases.json'), 'utf8').replace(/(?<=[[,:\s])(-?Infinity|NaN)(?=[\],\s])/g, '"$1"');
const C = JSON.parse(raw, (_k, v) => (v === 'NaN' ? NaN : v === 'Infinity' ? Infinity : v === '-Infinity' ? -Infinity : v));
const pt = ([x, y]: Num[]): Pt => ({ x, y });
const hex = (s: string) => Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)));

function run(c: any, m: any, mode: string) {
  let known: KnownSize;
  if (mode === 'a' || mode === 'aw') known = { kind: 'rect', wMm: m.typed.wMm, hMm: m.typed.hMm };
  else if (mode === 'b' || mode === 'c') known = 'wMm' in m.typed ? { kind: 'width', mm: m.typed.wMm } : { kind: 'height', mm: m.typed.hMm };
  else if (mode === 'd') known = { kind: 'rect', wMm: m.paperPortraitMm[0], hMm: m.paperPortraitMm[1], autoOrient: true };
  else known = { kind: 'none' };
  const focal35mm = readFocal35mm(hex(m.useExif ? c.exif.jpegHex : c.exif.jpegNo35Hex));
  const r = planScan({ corners: c.corners.map(pt), sourcePx: { w: c.W, h: c.H }, known, ppiTarget: 300, focal35mm });
  if (!r.ok) return { error: r.error };
  const p = r.plan;
  return {
    sizeKnown: p.sizeMm !== null,
    wMm: p.sizeMm?.w ?? null,
    hMm: p.sizeMm?.h ?? null,
    warnings: p.warnings,
    outW: p.outPx.w,
    outH: p.outPx.h,
    source: p.aspect.source,
    focal35mm,
    // added after the blind run (review fix round): raw outputs only, for the tuning figures in V15_LOG
    rangeMm: p.estimatedRangeMm,
    lensIgnored: p.aspect.lensIgnored ?? null,
    spread: p.aspect.spread,
  };
}

describe('blind A1 oracle (separate agent; measured once on 382ceb3)', () => {
  it(`feeds ${C.photos.length} photos, ${C.verdicts.length} quads, ${C.homographies.length} homographies, ${C.exif.length} EXIF files, ${C.caps.length} cap cases to the engine`, () => {
    const out: any = { photos: {}, verdicts: {}, homographies: {}, exif: {}, caps: {} };
    for (const c of C.photos) {
      out.photos[c.id] = {};
      for (const mode of Object.keys(c.modes)) out.photos[c.id][mode] = run(c, c.modes[mode], mode);
    }
    for (const v of C.verdicts) {
      const q = v.corners.map(pt);
      const img = { w: v.W, h: v.H };
      const o = orderCorners(q);
      out.verdicts[v.id] = { direct: quadIssue(q, img) ?? 'ok', sorted: o ? (quadIssue(o, img) ?? 'ok') : 'notFinite' };
    }
    for (const h of C.homographies) {
      const rect = [pt([0, 0]), pt([h.outW, 0]), pt([h.outW, h.outH]), pt([0, h.outH])];
      const H = homography(h.corners.map(pt), rect);
      if (!H) { out.homographies[h.id] = { error: 'null' }; continue; }
      const map = (p: Num[]) => { const m = applyH(H, pt(p)); return m ? [m.x, m.y] : [NaN, NaN]; };
      out.homographies[h.id] = { points: h.points.map((s: any) => map(s.photo)), corners: h.corners.map(map) };
    }
    for (const x of C.exif) out.exif[x.id] = readFocal35mm(hex(x.jpegHex));
    for (const m of C.caps) {
      const r = planScan({ corners: m.corners.map(pt), sourcePx: { w: m.W, h: m.H }, known: { kind: 'rect', wMm: m.typed.wMm, hMm: m.typed.hMm }, ppiTarget: 300 });
      out.caps[m.id] = r.ok ? { outW: r.plan.outPx.w, outH: r.plan.outPx.h, capped: r.plan.capped } : { error: r.error };
    }
    if (process.env.BLIND_A1_OUT) writeFileSync(process.env.BLIND_A1_OUT, JSON.stringify(out));
    // the adapter asserts only that every case reached the engine; agreement figures are the checker's (V15_LOG)
    expect(Object.keys(out.photos)).toHaveLength(C.photos.length);
    expect(Object.keys(out.verdicts)).toHaveLength(C.verdicts.length);
  });
});
