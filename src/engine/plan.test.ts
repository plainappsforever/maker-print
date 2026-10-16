import w from '../../test/fixtures/engine/w2-w10.json';
import { prng } from '../../test/prng';
import { printTranslator } from '@/i18n';

import { axisResult, calibrationResult, correctionMatrix, type StoredCorrection } from './calibration';
import { CHECK_BAR_FOOTPRINT, checkBarFootprint, findCheckBarPlace } from './checkbar';
import type { GenContext } from './generators';
import { CARD_MM } from './generators/calibration-sheet';
import { apply, invert, rectContains, rectsIntersect, type Rect } from './geometry';
import { scaleFromKnownLength } from './known-length';
import { unionRects } from './path';
import { PAPERS, paperSize, safeArea, uniformMargins, type PaperKey } from './paper';
import { opFootprint, pageInk, planCalibration, planPrint, toPageRect, WARNING_CODES, type OutputOptions, type PlanInput, type PlanObject } from './plan';
import { effectivePpi, ppiBand } from './ppi';
import { fillSheet } from './repeat';
import { androidJobFacts, iosRendererPlacement, pageSizePt } from './route';
import { chooseLayout, registrationPoints, sheetLayout, tileCount, tiles } from './tiles';
import { en } from '@/i18n/en';

const ctx: GenContext = { locale: 'en', unit: 'mm', inchStyle: 'fraction16', t: printTranslator('en') };
const out = (o: Partial<OutputOptions> = {}): OutputOptions => ({
  paperKey: 'a4',
  orientation: 'auto',
  margins: uniformMargins(6.35),
  overlapMm: 10,
  marks: 'registration',
  pageLabels: true,
  assemblyMap: 'auto',
  skipBlank: true,
  excludedTiles: [],
  checkBar: true,
  ppiTarget: 300,
  ...o,
});
let nextId = 1;
const obj = (o: Partial<PlanObject> & Pick<PlanObject, 'kind' | 'x' | 'y' | 'w' | 'h'>): PlanObject => ({
  id: nextId++,
  sheetId: 1,
  z: 0,
  assetId: null,
  pageIndex: 0,
  rotationDeg: 0,
  mirrorX: false,
  mirrorY: false,
  crop: null,
  fit: 'fill',
  repeat: null,
  props: {},
  hidden: false,
  ...o,
});
const plan = (sheet: [number, number], objects: PlanObject[], o: Partial<OutputOptions> = {}, extra: Partial<PlanInput> = {}) =>
  planPrint({ sheets: [{ id: 1, widthMm: sheet[0], heightMm: sheet[1] }], objects, output: out(o), ctx, ...extra });
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
/** Equal to a value printed in the SPEC with d decimals: rounds to those decimals first. */
const printed = (v: number, p: number) => {
  const d = (String(p).split('.')[1] ?? '').length;
  return Math.abs(Math.round(v * 10 ** d) / 10 ** d - p) < 1e-9;
};

describe('SPEC worked examples (values as printed)', () => {
  it('W2 PPI', () => {
    for (const v of w.W2) {
      const r = effectivePpi({ w: v.px[0], h: v.px[1] }, { w: v.widthMm, h: v.heightMm });
      expect(near(r.ppi, v.ppi, w.tolerance.ppi)).toBe(true);
      if (v.band) expect(ppiBand(r.ppi)).toBe(v.band);
    }
  });

  it('W3 tiling: 15 landscape pages + map on A4, 16/15 on Letter', () => {
    const [a4, letter] = w.W3;
    const lay = sheetLayout({ w: 600, h: 900 }, 'a4', 'portrait', uniformMargins(6.35), 10);
    expect([lay.content.w, lay.content.h, lay.step.x, lay.step.y].map((v) => Math.round(v * 10) / 10)).toEqual([...a4.content!, ...a4.step!]);
    for (const v of [a4, letter]) {
      const p = sheetLayout({ w: 600, h: 900 }, v.paper as PaperKey, 'portrait', uniformMargins(6.35), 10);
      const l = sheetLayout({ w: 600, h: 900 }, v.paper as PaperKey, 'landscape', uniformMargins(6.35), 10);
      expect([p.pages, l.pages, chooseLayout({ w: 600, h: 900 }, v.paper as PaperKey, 'auto', uniformMargins(6.35), 10).orientation]).toEqual([v.portrait, v.landscape, v.auto]);
    }
    const r = plan([600, 900], [obj({ kind: 'rect', x: 0, y: 0, w: 600, h: 900 })]);
    expect(r.pages.length).toBe(a4.pagesWithMap);
    expect(r.pages[0].kind).toBe('map');
    expect(r.pages.slice(1).map((p) => p.label)).toEqual(['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3', 'D1', 'D2', 'D3', 'E1', 'E2', 'E3']);
    // D53: landscape layout frames, but every page is the PORTRAIT paper with the frame turned onto it
    expect(r.pages.every((p) => p.orientation === 'landscape' && p.widthMm === 210 && p.heightMm === 297 && JSON.stringify(p.rotation) === JSON.stringify([0, -1, 1, 0, 0, 297]))).toBe(true);
    expect(r.warnings).toContainEqual({ code: 'pagesTurned', level: 'info', params: { pages: 16 } });
    expect(r.pages[0].ops.some((o) => o.op === 'checkBar')).toBe(true);
    expect(r.jobKind).toBe('multi');
  });

  it('W4 1 m ruler: landscape 4 × 1 + map', () => {
    const r = plan([1000, 30], [obj({ kind: 'ruler', x: 0, y: 0, w: 1000, h: 30, props: { unit: 'cm' } })]);
    expect(r.sheets[0]).toMatchObject({ orientation: 'landscape', cols: w.W4.landscape[0], rows: w.W4.landscape[1], map: true });
    expect(sheetLayout({ w: 1000, h: 30 }, 'a4', 'portrait', uniformMargins(6.35), 10)).toMatchObject({ cols: 6, rows: 1 });
    expect(r.pages.map((p) => p.label)).toEqual(['map', 'A1', 'A2', 'A3', 'A4']);
  });

  it('W5 A2 and A0 patterns on A4', () => {
    const [a2, a0] = w.W5;
    const m = uniformMargins(6.35);
    expect([sheetLayout({ w: 420, h: 594 }, 'a4', 'portrait', m, 10), sheetLayout({ w: 420, h: 594 }, 'a4', 'landscape', m, 10)].map((l) => [l.cols, l.rows])).toEqual([a2.portrait, a2.landscape]);
    expect(chooseLayout({ w: 420, h: 594 }, 'a4', 'auto', m, 10).orientation).toBe(a2.auto);
    expect([sheetLayout({ w: 841, h: 1189 }, 'a4', 'portrait', m, 10).pages, sheetLayout({ w: 841, h: 1189 }, 'a4', 'landscape', m, 10).pages]).toEqual([a0.portraitPages, a0.landscapePages]);
    expect(chooseLayout({ w: 841, h: 1189 }, 'a4', 'auto', m, 10).orientation).toBe(a0.auto);
  });

  it('W6 labels: fill sheet 3 × 8 = 24 on A4 and Letter, as a plan with trim marks', () => {
    for (const v of w.W6) {
      const safe = safeArea(paperSize(v.paper as PaperKey), uniformMargins(6.35))!;
      expect([safe.w, safe.h].map((x) => Math.round(x * 10) / 10)).toEqual(v.safe);
      const f = fillSheet({ w: 50, h: 30, rotationDeg: 0 }, { x: 2, y: 2 }, safe)!;
      expect([f.cols, f.rows]).toEqual([v.cols, v.rows]);
      const p = paperSize(v.paper as PaperKey);
      const r = plan([p.w, p.h], [obj({ kind: 'rect', x: f.x, y: f.y, w: 50, h: 30, repeat: { cols: f.cols, rows: f.rows, gap_x_mm: 2, gap_y_mm: 2, trim_marks: true } })], { paperKey: v.paper as PaperKey });
      expect(r.pages.length).toBe(1);
      expect(r.pages[0].ops.filter((o) => o.op === 'object').length).toBe(24);
      // the centred grid leaves room on every side: 6 column edges × 2 sides + 16 row edges × 2 sides = 44 marks
      expect(r.warnings.some((x) => x.code === 'trimMarksNoRoom')).toBe(false);
      const trim = r.pages[0].ops.find((o) => o.op === 'path' && o.role === 'trim');
      expect(trim && trim.op === 'path' && trim.d.split('M').length - 1).toBe(44);
    }
  });

  it('W7 calibration and U3', () => {
    const [a, b, c] = w.W7;
    const ra = axisResult(a.nominal, a.measured);
    expect(printed(ra.correction, a.correction!)).toBe(true);
    expect([ra.verdict, ra.causes]).toEqual([a.verdict, [a.cause]]);
    expect(printed(apply(correctionMatrix({ w: 210, h: 297 }, { fx: ra.correction, fy: ra.correction }), { x: 20, y: 0 }).x, a.x20OnA4!)).toBe(true);
    expect(printed(axisResult(b.nominal, b.measured).correction, b.correction!)).toBe(true);
    expect(axisResult(b.nominal, b.measured).verdict).toBe(b.verdict);
    expect(axisResult(c.nominal, c.measured).causes).toContain(c.cause);
    const u3 = calibrationResult({ nominal: w.U3.barA[0], measured: w.U3.barA[1] }, { nominal: w.U3.barB[0], measured: w.U3.barB[1] });
    expect([u3.x.correction.toFixed(4), u3.y.correction.toFixed(4), u3.verdict, u3.canSave]).toEqual([String(w.U3.fx), String(w.U3.fy), 'slight', true]);
    expect(calibrationResult({ nominal: 150, measured: 120 }, { nominal: 200, measured: 200 }).canSave).toBe(false);
    expect(axisResult(150, 0).verdict).toBe('refused');
  });

  it('W10 known length', () => {
    const r = scaleFromKnownLength({ box: { x: 10, y: 10, w: 200, h: 150 }, natural: { w: 4000, h: 3000 }, p1: { x: 0, y: 0 }, p2: { x: w.W10.pointsApartPx, y: 0 }, lengthMm: 50 })!;
    expect(printed(r.factor, w.W10.factor)).toBe(true);
    expect(printed(r.w, w.W10.newWidthMm)).toBe(true);
    expect(near(r.x + r.w / 2, 110, 1e-9) && near(r.y + r.h / 2, 85, 1e-9)).toBe(true);
    expect(scaleFromKnownLength({ box: { x: 0, y: 0, w: 1, h: 1 }, natural: { w: 1, h: 1 }, p1: { x: 0, y: 0 }, p2: { x: 0, y: 0 }, lengthMm: 5 })).toBeNull();
  });
});

describe('planPrint', () => {
  it('placed sheet: centred, crop marks inside the safe area, content clipped to sheet ∩ safe area', () => {
    const r = plan([105, 148], [obj({ kind: 'rect', x: -5, y: 10, w: 50, h: 50 })]);
    const page = r.pages[0];
    expect([page.kind, page.widthMm, page.heightMm]).toEqual(['placed', 210, 297]);
    const o = page.ops.find((x) => x.op === 'object')!;
    expect(o.op === 'object' && o.clip).toEqual({ x: 52.5, y: 74.5, w: 105, h: 148 });
    const crop = page.ops.filter((x) => x.op === 'path' && x.role === 'crop');
    expect(crop.length).toBe(1);
    expect(r.warnings.map((x) => x.code)).toContain('objectPartlyOffSheet');
  });

  it('single page: objects in the printer margin are clipped and reported', () => {
    const r = plan([210, 297], [obj({ kind: 'rect', x: 2, y: 20, w: 50, h: 50 })]);
    expect(r.pages[0].kind).toBe('single');
    expect(r.warnings.map((x) => x.code)).toContain('objectInMargin');
    const o = r.pages[0].ops.find((x) => x.op === 'object')!;
    expect(o.op === 'object' && o.clip).toEqual(safeArea({ w: 210, h: 297 }, uniformMargins(6.35)));
  });

  it('skip blank, exclusions (sheet-prefixed keys), map greys and nothingToPrint', () => {
    const o1 = obj({ kind: 'rect', x: 10, y: 10, w: 20, h: 20 });
    const r = plan([600, 900], [o1], { excludedTiles: [] });
    expect(r.sheets[0].printedTiles).toEqual(['A1']);
    expect(r.sheets[0].skippedBlank.length).toBe(14);
    expect(r.pages.map((p) => p.label)).toEqual(['A1']);
    const ex = plan([600, 900], [o1], { excludedTiles: ['A1'] });
    expect(ex.pages).toEqual([]);
    expect(ex.warnings.map((x) => x.code)).toContain('nothingToPrint');
    const two = planPrint({
      sheets: [{ id: 1, widthMm: 600, heightMm: 900 }, { id: 2, widthMm: 600, heightMm: 900 }],
      objects: [o1, obj({ kind: 'rect', sheetId: 2, x: 0, y: 0, w: 600, h: 900 })],
      output: out({ excludedTiles: ['2:A1', '2:B2'] }),
      ctx,
    });
    expect(two.sheets[1].excluded).toEqual(['A1', 'B2']);
    expect(two.pages.filter((p) => p.sheetIndex === 1 && p.kind === 'tile').map((p) => p.label)).toContain('2:A2');
    expect(two.pages.find((p) => p.sheetIndex === 1 && p.kind === 'map')).toBeTruthy();
  });

  it('registration marks print identically on both neighbours (same sheet point)', () => {
    const r = plan([600, 900], [obj({ kind: 'rect', x: 0, y: 0, w: 600, h: 900 })], { orientation: 'portrait', assemblyMap: 'off' });
    const lay = sheetLayout({ w: 600, h: 900 }, 'a4', 'portrait', uniformMargins(6.35), 10);
    const pts = registrationPoints({ w: 600, h: 900 }, lay);
    const a1 = r.pages.find((p) => p.label === 'A1')!;
    const a2 = r.pages.find((p) => p.label === 'A2')!;
    const q = pts.find((p) => p.x < 200 && p.y < 284)!; // between A1 and A2
    // A1 shows sheet x at page x + 0, A2 at page x − 187.3; the mark centre is the same sheet point on both
    const centreOn = (page: typeof a1, dx: number) => page.ops.some((o) => o.op === 'path' && o.role === 'registration' && o.d.startsWith(`M${q.x + 3 + 6.35 - dx} ${q.y + 6.35}`));
    expect(centreOn(a1, 0)).toBe(true);
    expect(centreOn(a2, lay.step.x)).toBe(true);
  });

  it('page caps: > 60 pages warns, > 400 refuses, sheets over 3 m refuse', () => {
    const full = (W: number, H: number) => [obj({ kind: 'rect', x: 0, y: 0, w: W, h: H })];
    expect(plan([2000, 2000], full(2000, 2000)).warnings.map((x) => x.code)).toContain('manyPages');
    const big = plan([3000, 3000], full(3000, 3000), { paperKey: 'a6' });
    expect(big.pages).toEqual([]);
    expect(big.warnings.map((x) => x.code)).toContain('tooManyPages');
    expect(plan([3001, 100], full(3001, 100)).warnings.map((x) => x.code)).toContain('sheetTooLarge');
    expect(plan([210, 297], [], { margins: uniformMargins(96) }).warnings.map((x) => x.code)).toEqual(['contentTooSmall']);
    expect(plan([210, 297], [], { overlapMm: 70 }).warnings.map((x) => x.code)).toEqual(['overlapTooLarge']);
  });

  it('check bar: avoids content, moves to a later page, or is reported as omitted', () => {
    const safe = safeArea({ w: 210, h: 297 }, uniformMargins(6.35))!;
    const covered = plan([210, 297], [obj({ kind: 'rect', x: safe.x, y: safe.y, w: safe.w, h: safe.h })]);
    expect(covered.warnings.map((x) => x.code)).toContain('checkBarOmitted');
    const r = plan([210, 297], [obj({ kind: 'rect', x: 20, y: 20, w: 100, h: 100 })]);
    const bar = r.pages[0].ops.find((o) => o.op === 'checkBar')!;
    expect(bar).toBeTruthy();
    const fp = opFootprint(bar, r.content)!;
    expect(rectContains(safe, fp)).toBe(true);
    expect(rectsIntersect(fp, { x: 20, y: 20, w: 100, h: 100 })).toBe(false);
    // two sheets: the first fully covered, the second free → bar on page 2, reported
    const two = planPrint({
      sheets: [{ id: 1, widthMm: 210, heightMm: 297 }, { id: 2, widthMm: 210, heightMm: 297 }],
      objects: [obj({ kind: 'rect', x: safe.x, y: safe.y, w: safe.w, h: safe.h }), obj({ kind: 'rect', sheetId: 2, x: 50, y: 50, w: 10, h: 10 })],
      output: out(),
      ctx,
    });
    expect(two.pages[1].ops.some((o) => o.op === 'checkBar')).toBe(true);
    expect(two.warnings.find((x) => x.code === 'checkBarNotOnFirstPage')?.params).toEqual({ page: 2 });
    expect(findCheckBarPlace({ x: 0, y: 0, w: 50, h: 50 }, [])).toBeNull();
    expect(checkBarFootprint(0, 0, false)).toEqual(CHECK_BAR_FOOTPRINT);
  });

  it('warnings: vector not at 100 %, low PPI, unknown asset size, unsupported glyphs, off sheet', () => {
    const assets = [
      { id: 1, kind: 'svg' as const, pxW: null, pxH: null, naturalMm: { w: 100, h: 50 } },
      { id: 2, kind: 'image' as const, pxW: 400, pxH: 300, naturalMm: null },
      { id: 3, kind: 'pdf' as const, pxW: null, pxH: null, pageSizesMm: [] },
    ];
    const r = plan(
      [210, 297],
      [
        obj({ kind: 'svg', assetId: 1, x: 20, y: 20, w: 110, h: 55 }),
        obj({ kind: 'svg', assetId: 1, x: 20, y: 100, w: 100, h: 50 }),
        obj({ kind: 'image', assetId: 2, x: 20, y: 160, w: 200, h: 150 }),
        obj({ kind: 'pdf_page', assetId: 3, x: 20, y: 20, w: 10, h: 10 }),
        obj({ kind: 'text', x: 20, y: 250, w: 100, h: 20, props: { text: 'Größe → 5 mm ≈ ok' } }),
        obj({ kind: 'rect', x: 400, y: 400, w: 10, h: 10 }),
      ],
      {},
      { assets }
    );
    const codes = r.warnings.map((x) => `${x.code}:${x.level}`);
    expect(codes.filter((c) => c.startsWith('notDesignedSize'))).toEqual(['notDesignedSize:warn']);
    expect(codes).toEqual(expect.arrayContaining(['lowPpi:warn', 'assetSizeUnknown:error', 'unsupportedGlyphs:warn', 'objectOffSheet:warn', 'objectPartlyOffSheet:warn']));
    expect(r.warnings.find((x) => x.code === 'unsupportedGlyphs')?.params.chars).toBe('→ ≈');
    const img = r.pages[0].ops.find((o) => o.op === 'object' && o.kind === 'image');
    expect(img && img.op === 'object' && img.source?.natural).toEqual({ w: 400, h: 300 });
  });

  it('every warning code has an English and German message', () => {
    for (const code of WARNING_CODES) expect(Object.keys(en)).toContain(`warn.${code}`);
  });

  it('correction: exact paper + job kind only, about the page centre of the portrait page (D53: no swap), switchable', () => {
    const corr: StoredCorrection[] = [
      { paperKey: 'a4', jobKind: 'multi', fx: 1.02, fy: 1.01 },
      { paperKey: 'a4', jobKind: 'single', fx: 0.99, fy: 0.995 },
      { paperKey: 'letter', jobKind: 'multi', fx: 1.1, fy: 1.1 },
    ];
    const tiled = plan([600, 900], [obj({ kind: 'rect', x: 0, y: 0, w: 600, h: 900 })], {}, { corrections: corr });
    expect(tiled.correction).toMatchObject({ jobKind: 'multi', fx: 1.02 });
    expect(tiled.pages[1].orientation).toBe('landscape');
    expect(tiled.pages[1].correction).toEqual(correctionMatrix({ w: 210, h: 297 }, { fx: 1.02, fy: 1.01 }));
    const single = plan([210, 297], [obj({ kind: 'rect', x: 20, y: 20, w: 10, h: 10 })], {}, { corrections: corr });
    expect(single.correction).toMatchObject({ jobKind: 'single', fx: 0.99 });
    expect(plan([600, 900], [obj({ kind: 'rect', x: 0, y: 0, w: 600, h: 900 })], { oneByOne: true }, { corrections: corr }).correction?.jobKind).toBe('single');
    // iOS (D74): a multi-page job takes the single-page correction; the plan stays a multi-page job
    const ios = plan([600, 900], [obj({ kind: 'rect', x: 0, y: 0, w: 600, h: 900 })], {}, { corrections: corr, correctionJobKind: 'single' });
    expect(ios.jobKind).toBe('multi');
    expect(ios.correction).toMatchObject({ jobKind: 'single', fx: 0.99 });
    expect(ios.warnings.find((x) => x.code === 'correctionApplied')?.params.jobKind).toBe('single');
    expect(plan([210, 297], [obj({ kind: 'rect', x: 20, y: 20, w: 10, h: 10 })], { paperKey: 'a4' }, { corrections: corr, applyCorrection: false }).correction).toBeNull();
    expect(plan([215.9, 279.4], [obj({ kind: 'rect', x: 20, y: 20, w: 10, h: 10 })], { paperKey: 'letter' }, { corrections: corr }).correction).toBeNull();
    const pushed = plan([210, 297], [obj({ kind: 'rect', x: 7, y: 7, w: 196, h: 10 })], {}, { corrections: [{ paperKey: 'a4', jobKind: 'single', fx: 1.1, fy: 1.1 }] });
    expect(pushed.warnings.map((x) => x.code)).toContain('correctionOffPage');
  });

  it('calibration job: every catalogue paper, everything in the safe area, nothing overlapping; A4/Letter complete', () => {
    for (const p of PAPERS) {
      const margins = uniformMargins(p.kind === 'photo' ? 3 : 6.35);
      const c = planCalibration({ paperKey: p.key, margins, pages: 1, ctx });
      expect(c.pages.length).toBe(1);
      const items = c.sheet.items.filter((i) => i.rect.w > 0);
      for (let i = 0; i < items.length; i++)
        for (let j = i + 1; j < items.length; j++) if (items[i].item !== items[j].item) expect([p.key, items[i].item, items[j].item, rectsIntersect(items[i].rect, items[j].rect)]).toEqual([p.key, items[i].item, items[j].item, false]);
      // P3.5 review finding 9: every paper measures both axes (A6 used to lose bar B: 100 mm did not fit below bar A)
      expect([p.key, c.sheet.barA !== null, c.sheet.barB !== null]).toEqual([p.key, true, true]);
      expect(c.sheet.barB!.y0).toBeGreaterThanOrEqual(c.sheet.barA!.y + 4 + 6 - 1e-9);
      expect(c.sheet.barB!.y1).toBeLessThanOrEqual(c.sheet.safe.y + c.sheet.safe.h - 12 + 1e-9);
      if (p.key === 'a6') expect([c.sheet.barA?.length, c.sheet.barB?.length]).toEqual([50, 50]);
      if (p.key === 'a4' || p.key === 'letter') {
        expect(c.sheet.omitted).toEqual([]);
        expect([c.sheet.barA?.length, c.sheet.barB?.length]).toEqual([150, 200]);
        expect(c.sheet.barA!.x1 - c.sheet.barA!.x0).toBe(150);
      }
    }
    const a4 = planCalibration({ paperKey: 'a4', margins: uniformMargins(6.35), pages: 2, ctx, corrections: [{ paperKey: 'a4', jobKind: 'multi', fx: 1.01, fy: 1.01 }], applyCorrection: true });
    expect([a4.pages.length, a4.jobKind, a4.correction?.fx]).toEqual([2, 'multi', 1.01]);
    expect(CARD_MM).toEqual({ w: 85.6, h: 53.98, r: 3.18 });
  });
});

describe('platform page geometry (D11, D12)', () => {
  it('pages in points with full precision; Android 1:1 facts; iOS renderer offsets', () => {
    const single = plan([210, 297], [obj({ kind: 'rect', x: 20, y: 20, w: 10, h: 10 })]);
    // correctly rounded doubles of 210 × 72/25.4 and 297 × 72/25.4 (Python fractions); RESEARCH E1 printed …277 (1 ulp off)
    expect(pageSizePt(single.pages[0])).toEqual({ w: 595.2755905511812, h: 841.8897637795276 });
    expect(androidJobFacts(single, { w: 210, h: 297 })).toMatchObject({ expectExact: true, advice: null });
    expect(androidJobFacts(single, { w: 210, h: 297 }, { l: 25, t: 5, r: 5, b: 5 })).toMatchObject({ marginsBlank: false, expectExact: false, advice: 'marginsNotBlank' });
    const multi = plan([600, 900], [obj({ kind: 'rect', x: 0, y: 0, w: 600, h: 900 })]);
    expect(androidJobFacts(multi, { w: 210, h: 297 })).toMatchObject({ singlePage: false, expectExact: false, advice: 'oneByOneOrMultiCorrection', pageMatchesPaper: true });
    expect(iosRendererPlacement({ w: 210, h: 297 }, { w: 210, h: 297 })).toMatchObject({ offsetMm: { x: 0, y: 0 }, paperMatches: true, scale: 1 });
    expect(iosRendererPlacement({ w: 210, h: 297 }, { w: 215.9, h: 279.4 }).offsetMm.x).toBeCloseTo(2.95, 10);
  });

  // P3.5 review finding 1 (D53): pages are always the portrait paper; landscape frames are turned onto it
  it('D53 contract: mixed jobs, single landscape sheets and swapped pages', () => {
    const mixed = planPrint({
      sheets: [{ id: 1, widthMm: 210, heightMm: 297 }, { id: 2, widthMm: 1000, heightMm: 30 }],
      objects: [obj({ id: 1, sheetId: 1, kind: 'rect', x: 20, y: 20, w: 50, h: 50 }), obj({ id: 2, sheetId: 2, kind: 'ruler', x: 0, y: 0, w: 1000, h: 30 })],
      output: out({ checkBar: true }),
      ctx,
    });
    expect(mixed.pages.map((p) => `${p.label}:${p.orientation[0]}`)).toEqual(['1:p', 'map:l', '2:A1:l', '2:A2:l', '2:A3:l', '2:A4:l']);
    expect(mixed.pages.every((p) => p.widthMm === 210 && p.heightMm === 297)).toBe(true);
    expect(androidJobFacts(mixed, { w: 210, h: 297 })).toMatchObject({ pageMatchesPaper: true, marginsBlank: true });
    // a 297 × 210 sheet = A4 landscape: one page, the portrait paper, exact expected on Android, offset 0 on iOS
    const land = plan([297, 210], [obj({ kind: 'rect', x: 20, y: 20, w: 50, h: 50, props: { fill: '#ff0000', stroke: null } })], { checkBar: true });
    expect(land.pages.map((p) => [p.kind, p.widthMm, p.heightMm, p.orientation])).toEqual([['single', 210, 297, 'landscape']]);
    expect(androidJobFacts(land, { w: 210, h: 297 })).toMatchObject({ expectExact: true });
    expect(iosRendererPlacement({ w: land.pages[0].widthMm, h: land.pages[0].heightMm }, { w: 210, h: 297 }).paperMatches).toBe(true);
    // the rect at frame (20..70, 20..70) lands at page X = y, Y = 297 − x
    const fp = opFootprint(land.pages[0].ops[0], land.content)!;
    expect(toPageRect(land.pages[0], fp)).toEqual({ x: 20, y: 297 - 70, w: 50, h: 50 });
    // a swapped (landscape) page is never "exact" any more — AOSP fits it (×0.707)
    const swapped = { ...land, pages: [{ ...land.pages[0], widthMm: 297, heightMm: 210, rotation: null }] };
    expect(androidJobFacts(swapped, { w: 210, h: 297 })).toMatchObject({ pageMatchesPaper: false, expectExact: false });
    expect(iosRendererPlacement({ w: 297, h: 210 }, { w: 210, h: 297 }).paperMatches).toBe(false);
  });

  // P3.5 review finding 6: text spilling past its box is never lost to skip-blank or the off-sheet test
  it('text ink past its box: tiles it reaches print, off-sheet ink is reported, textOverflow warns', () => {
    const spill = obj({ kind: 'text', x: 300, y: 50, w: 20, h: 15, props: { text: 'SPILLING TEXT LABEL HERE', fontSizePt: 36 } });
    const r = plan([500, 200], [spill], { orientation: 'portrait', assemblyMap: 'off' });
    expect(r.sheets[0]).toMatchObject({ cols: 3, printedTiles: ['A2', 'A3'], skippedBlank: ['A1'] });
    const a3 = r.pages.find((p) => p.label === 'A3')!;
    expect(a3.ops.filter((o) => o.op === 'object')).toHaveLength(1); // the text is drawn there, clipped to the tile
    expect(r.warnings.map((w) => w.code)).toEqual(['textOverflow']);
    const edge = plan([210, 297], [obj({ kind: 'text', x: 150, y: 50, w: 20, h: 15, props: { text: 'SPILLING TEXT', fontSizePt: 36 } })]);
    expect(edge.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['textOverflow', 'objectPartlyOffSheet']));
    // a stroke centred on the box edge is not a spill (no new warnings for ordinary shapes at the sheet edge)
    const framed = plan([210, 297], [obj({ kind: 'rect', x: 0, y: 0, w: 210, h: 297, props: { stroke: '#000000', strokeMm: 0.5, fill: null } })]);
    expect(framed.warnings.map((w) => w.code)).not.toContain('objectPartlyOffSheet');
  });

  // P3.5 review finding 8: the page label box never sits on a registration mark
  it('label boxes stay clear of registration marks for visible tile extents 20–300 mm', () => {
    const bad: string[] = [];
    let tilesChecked = 0;
    for (const paperKey of ['a4', 'letter'] as const) {
      for (const orientation of ['portrait', 'landscape'] as const) {
        const lay = sheetLayout({ w: 5000, h: 5000 }, paperKey, orientation, uniformMargins(6.35), 10);
        for (let vis = 20; vis <= 300; vis += 4) {
          // last column (and last row) shows `vis` mm, or the full content when vis is larger
          // three columns and rows, so middle tiles have marks on all four sides
          const W = 2 * lay.step.x + 10 + Math.min(vis, lay.content.w - 10.5);
          const H = 2 * lay.step.y + 10 + Math.min(vis, lay.content.h - 10.5);
          const r = plan([W, H], [obj({ kind: 'rect', x: 0, y: 0, w: W, h: H })], { paperKey, orientation, skipBlank: false, assemblyMap: 'off' });
          for (const page of r.pages) {
            const label = unionRects(page.ops.filter((o) => 'role' in o && o.role === 'label').map((o) => opFootprint(o, r.content)!))!;
            const marks = page.ops.filter((o) => 'role' in o && o.role === 'registration').map((o) => opFootprint(o, r.content)!);
            tilesChecked++;
            if (marks.some((m) => rectsIntersect(label, m))) bad.push(`${paperKey} ${orientation} vis ${vis} ${page.label}`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
    expect(tilesChecked).toBeGreaterThan(2500);
  });

  // P3.5 review finding 15: single trim marks left out by the D41 rule are reported, not silent
  it('a grid boundary on the safe-area edge: its marks are left out and counted (marksLeftOut)', () => {
    const r = plan([210, 297], [obj({ kind: 'rect', x: 6.35, y: 50, w: 20, h: 10, repeat: { cols: 3, rows: 1, gap_x_mm: 5, gap_y_mm: 0, trim_marks: true } })]);
    expect(r.warnings.find((w) => w.code === 'marksLeftOut')).toMatchObject({ level: 'info', params: { count: 2 } });
  });

  // P3.5 review finding 19: label arrows point only to neighbours that are printed
  it('label arrows skip excluded and blank neighbours', () => {
    const arrows = (r: ReturnType<typeof plan>, label: string) => {
      const p = r.pages.find((x) => x.label === label)!;
      const tri = p.ops.find((o) => o.op === 'path' && o.role === 'label' && o.fill !== null);
      return tri && tri.op === 'path' ? tri.d.split('Z').length - 1 : 0;
    };
    // W4 ruler: A1 A2 A3 A4 in one row
    const all = plan([1000, 30], [obj({ kind: 'ruler', x: 0, y: 0, w: 1000, h: 30 })]);
    expect(['A1', 'A2', 'A4'].map((l) => arrows(all, l))).toEqual([1, 2, 1]);
    const cut = plan([1000, 30], [obj({ kind: 'ruler', x: 0, y: 0, w: 1000, h: 30 })], { excludedTiles: ['A2'] });
    expect(['A1', 'A3', 'A4'].map((l) => arrows(cut, l))).toEqual([0, 1, 1]);
  });

  // P3.5 review finding 7: margins are the portrait paper's and turn with the frame
  it('asymmetric (learned) margins stay on their physical paper edge on landscape frames', () => {
    const m = { l: 3, t: 4, r: 5, b: 15 };
    for (const paperKey of ['a4', 'letter'] as const) {
      const P = paperSize(paperKey);
      const r = plan([1000, 30], [obj({ kind: 'ruler', x: 0, y: 0, w: 1000, h: 30 })], { paperKey, margins: m });
      expect(r.pages[0].orientation).toBe('landscape');
      for (const page of r.pages) {
        expect(toPageRect(page, page.safe)).toEqual({ x: 3, y: 4, w: P.w - 8, h: P.h - 19 });
        expect(rectContains(toPageRect(page, page.safe), pageInk(page, r.content)!, 1e-9)).toBe(true);
      }
      expect(androidJobFacts(r, P, m).marginsBlank).toBe(true);
      expect(androidJobFacts(r, P, { ...m, b: 16 }).marginsBlank).toBe(false);
    }
  });
});

describe('property: 1 000 seeded random sheets', () => {
  const rnd = prng(20261001);
  const keys: PaperKey[] = ['a4', 'letter', 'a3', 'a5', 'legal', 'photo-4x6', 'tabloid'];
  const cases = Array.from({ length: 1000 }, (_, i) => {
    const paperKey = rnd.pick(keys);
    const pw = paperSize(paperKey);
    const m = rnd.bool(0.5) ? uniformMargins(rnd.range(0, 12)) : { l: rnd.range(0, 15), t: rnd.range(0, 15), r: rnd.range(0, 15), b: rnd.range(0, 15) };
    const minC = Math.min(pw.w - m.l - m.r, pw.w - m.t - m.b, pw.h - m.l - m.r, pw.h - m.t - m.b);
    const o = rnd.bool(0.2) ? 0 : rnd.range(0, minC / 3);
    const W = rnd.bool(0.15) ? pw.w : rnd.range(20, 1400);
    const H = rnd.bool(0.15) ? pw.h : rnd.range(20, 1400);
    const n = rnd.int(0, 5);
    const objects = Array.from({ length: n }, () =>
      obj({
        kind: rnd.pick(['rect', 'ellipse', 'ruler', 'grid', 'text', 'circles', 'line', 'dots', 'test_square'] as const),
        x: rnd.range(-50, W),
        y: rnd.range(-50, H),
        w: rnd.range(5, 300),
        h: rnd.range(5, 200),
        rotationDeg: rnd.pick([0, 90, 180, 270, rnd.range(0, 360)]),
        mirrorX: rnd.bool(0.2),
        repeat: rnd.bool(0.3) ? { cols: rnd.int(1, 3), rows: rnd.int(1, 3), gap_x_mm: rnd.range(0, 10), gap_y_mm: rnd.range(0, 10), trim_marks: rnd.bool() } : null,
        props: { text: 'Label 12', diametersMm: [5, 10, 20] },
      })
    );
    return { i, paperKey, m, o, W, H, objects, orientation: rnd.pick(['auto', 'portrait', 'landscape'] as const), labels: rnd.bool(0.8), marks: rnd.pick(['registration', 'none'] as const) };
  });

  it('plans never touch the margins; tiles cover the sheet with overlap exactly o; counts follow the formula', () => {
    let pagesTotal = 0;
    for (const c of cases) {
      const r = planPrint({
        sheets: [{ id: 1, widthMm: c.W, heightMm: c.H }],
        objects: c.objects,
        output: out({ paperKey: c.paperKey, margins: c.m, overlapMm: c.o, orientation: c.orientation, pageLabels: c.labels, marks: c.marks, assemblyMap: 'on', skipBlank: false }),
        ctx,
      }); // planPrint asserts the margin invariant itself; re-check independently here
      const P = paperSize(c.paperKey);
      for (const page of r.pages) {
        // D53: every page is the portrait paper; the frame's safe area is the paper minus the paper's own margins
        expect([page.widthMm, page.heightMm]).toEqual([P.w, P.h]);
        const ps = toPageRect(page, page.safe);
        expect([ps.x, ps.y, ps.x + ps.w, ps.y + ps.h].map((v, k) => Math.abs(v - [c.m.l, c.m.t, P.w - c.m.r, P.h - c.m.b][k]) < 1e-9)).toEqual([true, true, true, true]);
        for (const op of page.ops) {
          const fp = opFootprint(op, r.content);
          if (fp) expect(rectContains(page.safe, fp, 1e-6)).toBe(true);
        }
      }
      pagesTotal += r.pages.length;
      const lay = chooseLayout({ w: c.W, h: c.H }, c.paperKey, c.orientation, c.m, c.o);
      if (r.pages.length === 0) {
        expect(lay.pages).toBeGreaterThan(400);
        continue;
      }
      if (lay.mode !== 'tiled') continue;
      expect(lay.cols).toBe(tileCount(c.W, lay.content.w, c.o));
      expect(lay.rows).toBe(tileCount(c.H, lay.content.h, c.o));
      if (lay.cols > 1) expect(lay.cols).toBe(Math.ceil((c.W - c.o) / (lay.content.w - c.o) - 1e-9));
      const ts = tiles({ w: c.W, h: c.H }, lay);
      expect(r.pages.filter((p) => p.kind === 'tile').length).toBe(ts.length);
      // union covers the sheet: the last tile reaches the far edges, neighbours overlap by exactly o
      const last = ts[ts.length - 1];
      expect(last.region.x + last.region.w).toBeGreaterThanOrEqual(c.W - 1e-9);
      expect(last.region.y + last.region.h).toBeGreaterThanOrEqual(c.H - 1e-9);
      for (const t of ts) {
        expect(rectContains({ x: 0, y: 0, w: c.W, h: c.H }, t.visible, 1e-9)).toBe(true);
        const right = ts.find((u) => u.row === t.row && u.col === t.col + 1);
        if (right) expect(Math.abs(t.region.x + t.region.w - right.region.x - c.o)).toBeLessThan(1e-9);
        const below = ts.find((u) => u.row === t.row + 1 && u.col === t.col);
        if (below) expect(Math.abs(t.region.y + t.region.h - below.region.y - c.o)).toBeLessThan(1e-9);
      }
      // registration marks sit in the middle of an overlap strip, inside the sheet
      for (const q of registrationPoints({ w: c.W, h: c.H }, lay)) {
        expect(q.x >= 0 && q.y >= 0 && q.x <= c.W && q.y <= c.H).toBe(true);
        const inV = ts.some((t) => ts.some((u) => u.row === t.row && u.col === t.col + 1 && Math.abs(q.x - (u.region.x + c.o / 2)) < 1e-9));
        const inH = ts.some((t) => ts.some((u) => u.col === t.col && u.row === t.row + 1 && Math.abs(q.y - (u.region.y + c.o / 2)) < 1e-9));
        expect(inV || inH).toBe(true);
      }
    }
    expect(pagesTotal).toBeGreaterThan(3000);
  });

  it('a correction inverts a simulated centred fit-to-page within 1e-9 mm', () => {
    const r = prng(7);
    for (let i = 0; i < 1000; i++) {
      const page = paperSize(r.pick(PAPERS).key, r.pick(['portrait', 'landscape'] as const));
      const s = { x: r.range(0.85, 1.15), y: r.range(0.85, 1.15) };
      const corr = correctionMatrix(page, { fx: 1 / s.x, fy: 1 / s.y });
      const fit: [number, number, number, number, number, number] = [s.x, 0, 0, s.y, (page.w / 2) * (1 - s.x), (page.h / 2) * (1 - s.y)];
      const p = { x: r.range(0, page.w), y: r.range(0, page.h) };
      const back = apply(fit, apply(corr, p));
      expect(Math.abs(back.x - p.x) <= 1e-9 && Math.abs(back.y - p.y) <= 1e-9).toBe(true);
      const inv = apply(invert(corr), apply(corr, p));
      expect(Math.abs(inv.x - p.x) <= 1e-9).toBe(true);
    }
  });
});

export type { Rect };
