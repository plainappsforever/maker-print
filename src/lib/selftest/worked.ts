// SPEC worked examples W1–W10 as plain checks (the same assertions as src/engine/w1.test.ts and the "SPEC worked
// examples" block of plan.test.ts), so the on-device self-test runs them on Hermes (V1_PLAN P4 step 3, A1).
import w1 from '../../../test/fixtures/engine/w1.json';
import w from '../../../test/fixtures/engine/w2-w10.json';
import { axisResult, calibrationResult, correctionMatrix } from '../../engine/calibration';
import { apply } from '../../engine/geometry';
import { scaleFromKnownLength } from '../../engine/known-length';
import { paperSize, safeArea, uniformMargins, type PaperKey } from '../../engine/paper';
import { planPrint, type OutputOptions, type PlanObject } from '../../engine/plan';
import { effectivePpi, ppiBand } from '../../engine/ppi';
import { fillSheet } from '../../engine/repeat';
import { chooseLayout, sheetLayout } from '../../engine/tiles';
import { mmToPt, parseLength, type DisplayUnit, type Locale } from '../../engine/units';

import { REFEREE_CTX } from './project-pdf';

export type Check = { name: string; ok: boolean; detail?: string };

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const printed = (v: number, p: number) => {
  const d = (String(p).split('.')[1] ?? '').length;
  return Math.abs(Math.round(v * 10 ** d) / 10 ** d - p) < 1e-9;
};
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
const obj = (o: Partial<PlanObject> & Pick<PlanObject, 'kind' | 'x' | 'y' | 'w' | 'h'>): PlanObject => ({
  id: 1,
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
const plan = (sheet: [number, number], objects: PlanObject[], o: Partial<OutputOptions> = {}) =>
  planPrint({ sheets: [{ id: 1, widthMm: sheet[0], heightMm: sheet[1] }], objects, output: out(o), ctx: REFEREE_CTX });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function workedExampleChecks(): Check[] {
  const checks: Check[] = [];
  const check = (name: string, fn: () => boolean) => {
    try {
      checks.push({ name, ok: fn() });
    } catch (e) {
      checks.push({ name, ok: false, detail: String((e as Error)?.message ?? e) });
    }
  };

  check('W1 paper sizes in pt', () =>
    w1.paperPt.every(({ key, widthPt, heightPt }) => {
      const s = paperSize(key as PaperKey);
      return near(mmToPt(s.w), widthPt, w1.tolerance) && near(mmToPt(s.h), heightPt, w1.tolerance);
    })
  );
  check('W1 mm → pt', () => w1.mmToPt.every(({ mm, pt }) => near(mmToPt(mm), pt, w1.tolerance)));
  check('W1 parsing', () =>
    w1.parse.every(({ text, locale, unit, mm }) => {
      const r = parseLength(text, { unit: unit as DisplayUnit, locale: locale as Locale });
      return r.ok && near(r.mm, mm, w1.tolerance);
    })
  );
  check('W1 A4 full precision', () => near(mmToPt(210), 595.2755905511812, 1e-10) && near(mmToPt(297), 841.8897637795277, 1e-10));
  check('W2 PPI', () =>
    w.W2.every((v) => {
      const r = effectivePpi({ w: v.px[0], h: v.px[1] }, { w: v.widthMm, h: v.heightMm });
      return near(r.ppi, v.ppi, w.tolerance.ppi) && (!v.band || ppiBand(r.ppi) === v.band);
    })
  );
  check('W3 tiling', () => {
    const [a4] = w.W3;
    const lay = sheetLayout({ w: 600, h: 900 }, 'a4', 'portrait', uniformMargins(6.35), 10);
    const okLay = same([lay.content.w, lay.content.h, lay.step.x, lay.step.y].map((v) => Math.round(v * 10) / 10), [...a4.content!, ...a4.step!]);
    const okCounts = w.W3.every((v) => {
      const p = sheetLayout({ w: 600, h: 900 }, v.paper as PaperKey, 'portrait', uniformMargins(6.35), 10);
      const l = sheetLayout({ w: 600, h: 900 }, v.paper as PaperKey, 'landscape', uniformMargins(6.35), 10);
      return same([p.pages, l.pages, chooseLayout({ w: 600, h: 900 }, v.paper as PaperKey, 'auto', uniformMargins(6.35), 10).orientation], [v.portrait, v.landscape, v.auto]);
    });
    const r = plan([600, 900], [obj({ kind: 'rect', x: 0, y: 0, w: 600, h: 900 })]);
    const turned = r.pages.every((p) => p.orientation === 'landscape' && p.widthMm === 210 && p.heightMm === 297 && same(p.rotation, [0, -1, 1, 0, 0, 297]));
    return okLay && okCounts && r.pages.length === a4.pagesWithMap && r.pages[0].kind === 'map' && turned && r.jobKind === 'multi';
  });
  check('W4 1 m ruler', () => {
    const r = plan([1000, 30], [obj({ kind: 'ruler', x: 0, y: 0, w: 1000, h: 30, props: { unit: 'cm' } })]);
    return r.sheets[0].orientation === 'landscape' && r.sheets[0].cols === w.W4.landscape[0] && r.sheets[0].rows === w.W4.landscape[1] && same(r.pages.map((p) => p.label), ['map', 'A1', 'A2', 'A3', 'A4']);
  });
  check('W5 A2 and A0 patterns', () => {
    const [a2, a0] = w.W5;
    const m = uniformMargins(6.35);
    return (
      same([sheetLayout({ w: 420, h: 594 }, 'a4', 'portrait', m, 10), sheetLayout({ w: 420, h: 594 }, 'a4', 'landscape', m, 10)].map((l) => [l.cols, l.rows]), [a2.portrait, a2.landscape]) &&
      chooseLayout({ w: 420, h: 594 }, 'a4', 'auto', m, 10).orientation === a2.auto &&
      same([sheetLayout({ w: 841, h: 1189 }, 'a4', 'portrait', m, 10).pages, sheetLayout({ w: 841, h: 1189 }, 'a4', 'landscape', m, 10).pages], [a0.portraitPages, a0.landscapePages]) &&
      chooseLayout({ w: 841, h: 1189 }, 'a4', 'auto', m, 10).orientation === a0.auto
    );
  });
  check('W6 labels 3 × 8', () =>
    w.W6.every((v) => {
      const safe = safeArea(paperSize(v.paper as PaperKey), uniformMargins(6.35))!;
      const f = fillSheet({ w: 50, h: 30, rotationDeg: 0 }, { x: 2, y: 2 }, safe)!;
      const p = paperSize(v.paper as PaperKey);
      const r = plan([p.w, p.h], [obj({ kind: 'rect', x: f.x, y: f.y, w: 50, h: 30, repeat: { cols: f.cols, rows: f.rows, gap_x_mm: 2, gap_y_mm: 2, trim_marks: true } })], { paperKey: v.paper as PaperKey });
      const trim = r.pages[0].ops.find((o) => o.op === 'path' && o.role === 'trim');
      return (
        same([safe.w, safe.h].map((x) => Math.round(x * 10) / 10), v.safe) &&
        f.cols === v.cols &&
        f.rows === v.rows &&
        r.pages.length === 1 &&
        r.pages[0].ops.filter((o) => o.op === 'object').length === 24 &&
        !!trim &&
        trim.op === 'path' &&
        trim.d.split('M').length - 1 === 44
      );
    })
  );
  check('W7 calibration and U3', () => {
    const [a, b, c] = w.W7;
    const ra = axisResult(a.nominal, a.measured);
    const u3 = calibrationResult({ nominal: w.U3.barA[0], measured: w.U3.barA[1] }, { nominal: w.U3.barB[0], measured: w.U3.barB[1] });
    return (
      printed(ra.correction, a.correction!) &&
      same([ra.verdict, ra.causes], [a.verdict, [a.cause]]) &&
      printed(apply(correctionMatrix({ w: 210, h: 297 }, { fx: ra.correction, fy: ra.correction }), { x: 20, y: 0 }).x, a.x20OnA4!) &&
      printed(axisResult(b.nominal, b.measured).correction, b.correction!) &&
      axisResult(b.nominal, b.measured).verdict === b.verdict &&
      axisResult(c.nominal, c.measured).causes.includes(c.cause as never) &&
      same([u3.x.correction.toFixed(4), u3.y.correction.toFixed(4), u3.verdict, u3.canSave], [String(w.U3.fx), String(w.U3.fy), 'slight', true]) &&
      calibrationResult({ nominal: 150, measured: 120 }, { nominal: 200, measured: 200 }).canSave === false &&
      axisResult(150, 0).verdict === 'refused'
    );
  });
  check('W10 known length', () => {
    const r = scaleFromKnownLength({ box: { x: 10, y: 10, w: 200, h: 150 }, natural: { w: 4000, h: 3000 }, p1: { x: 0, y: 0 }, p2: { x: w.W10.pointsApartPx, y: 0 }, lengthMm: 50 })!;
    return printed(r.factor, w.W10.factor) && printed(r.w, w.W10.newWidthMm) && near(r.x + r.w / 2, 110, 1e-9) && near(r.y + r.h / 2, 85, 1e-9);
  });
  return checks;
}
