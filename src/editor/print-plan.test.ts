/**
 * @jest-environment node
 */
// v1.1 fix round, REVIEW_V1 finding 1 (blocker) and finding 7: the reviewer's Node probe (`probe2.mjs`) as a regression
// test. A4 graph paper filling the safe area, a profile with learned margins 6.35 mm and a stored SINGLE-page correction
// that enlarges (×1.01 / ×1.02 / ×1.04). Before v1.1 the corrected ink reached into the printer's strips, so the sourced
// Android rule (D12) predicted "fit to page", the screen showed a grey info line and the page carried no check bar.
import type { Project } from '@/db/projects';
import type { SheetObject } from '@/db/objects';
import { defaultSettings } from '@/db/settings';
import type { StoredCorrection } from '@/engine/calibration';
import { pageInk, planPrint, type PrintPlan } from '@/engine/plan';
import { inspectAsset, planAssetOf } from '@/import/assets';
import { mapRect } from '@/engine/path';
import { androidJobFacts } from '@/engine/route';
import { uniformMargins } from '@/engine/paper';
import { REFEREE_CTX } from '@/lib/selftest/project-pdf';

import { effectiveMargins, marginsBelowPrinter, marginsForCorrection, planInputFor, planProject, printerReportedMargins, printPlanFor, type ProjectDoc } from './output';
import { fillSheet } from '@/engine/repeat';

import { templateProject, defaultTemplateParams } from './templates';

const A4 = { w: 210, h: 297 };
const LEARNED = uniformMargins(6.35);
const profile = { margins: LEARNED, marginsSource: 'learned' as const };
const settings = { ...defaultSettings('DE'), checkBar: true };

function project(p: Partial<Project> = {}): Project {
  return {
    id: 1, name: 'probe', paperKey: 'a4', orientation: 'auto', marginMm: null, overlapMm: 10, marks: 'registration', pageLabels: true,
    assemblyMap: 'auto', skipBlank: true, excludedTiles: [], checkBar: null, profileId: 1, thumbnailPath: null, createdAt: 0, updatedAt: 0, ...p,
  };
}
function object(o: Partial<SheetObject> & Pick<SheetObject, 'kind' | 'x' | 'y' | 'w' | 'h'>, id = 1): SheetObject {
  return { id, sheetId: 1, z: id, assetId: null, pageIndex: 0, rotationDeg: 0, mirrorX: false, mirrorY: false, lockAspect: false, crop: null, fit: 'fill', repeat: null, props: {}, name: '', locked: false, hidden: false, ...o };
}
function graphDoc(p: Partial<Project> = {}): ProjectDoc {
  const t = templateProject('grid', defaultTemplateParams('grid', 'a4', 'mm'), LEARNED);
  return { project: project(p), sheets: [{ id: 1, projectId: 1, position: 0, widthMm: t.sheet.widthMm, heightMm: t.sheet.heightMm, paperKey: 'a4', name: '' }], objects: [object({ ...t.object, props: t.object.props as SheetObject['props'] })], assets: [] };
}
const single = (f: number): StoredCorrection[] => [{ paperKey: 'a4', jobKind: 'single', fx: f, fy: f }];
const codes = (plan: PrintPlan) => plan.warnings.map((w) => `${w.code}:${w.level}`);
const bars = (plan: PrintPlan) => plan.pages.map((p) => p.ops.filter((op) => op.op === 'checkBar').length);

/** Corrected ink of every page lies inside the paper minus `m`. */
function correctedInkInside(plan: PrintPlan, m: { l: number; t: number; r: number; b: number }) {
  return plan.pages.every((p) => {
    const ink = pageInk(p, plan.content)!;
    const c = p.correction ? mapRect(p.correction, ink) : ink;
    return c.x >= m.l - 1e-6 && c.y >= m.t - 1e-6 && c.x + c.w <= A4.w - m.r + 1e-6 && c.y + c.h <= A4.h - m.b + 1e-6;
  });
}

describe('finding 1: an enlarging correction keeps the corrected ink inside the printer margins (D83)', () => {
  it.each([1.01, 1.02, 1.04])('Android, A4 graph paper, single-page ×%s → 1:1 predicted, warning, check bar', (f) => {
    const doc = graphDoc({ checkBar: false });
    const r = printPlanFor(doc, settings, profile, REFEREE_CTX, { os: 'android', corrections: single(f), applyCorrection: true, oneByOne: false, correctionJobKind: 'single' });
    // per side m' = C − (C − m)/c, rounded up to 0.01 mm
    expect(r.margins.l).toBeCloseTo(Math.ceil((105 - 98.65 / f) * 100) / 100, 9);
    expect(r.margins.t).toBeCloseTo(Math.ceil((148.5 - 142.15 / f) * 100) / 100, 9);
    expect(correctedInkInside(r.plan, LEARNED)).toBe(true);
    const facts = androidJobFacts(r.plan, A4, LEARNED);
    expect(facts).toMatchObject({ expectExact: true, marginsBlank: true, advice: null });
    const w = codes(r.plan);
    expect(w).toContain('correctionEnlarges:warn');
    expect(w).toContain('checkBarForced:warn'); // switched off, forced on
    expect(w).toContain('checkBarRoomMade:info'); // the graph paper gave way
    expect(w).not.toContain('checkBarOmitted:warn');
    expect(w.some((c) => c.startsWith('correctionIntoMargin'))).toBe(false);
    expect(bars(r.plan)).toEqual([1]);
  });

  it('the v1 behaviour (margins only kept on the paper) is what the probe found: fit to page, now a warning', () => {
    const doc = graphDoc();
    const c = single(1.02);
    const plan = planProject(doc, settings, profile, REFEREE_CTX, { corrections: c, applyCorrection: true, minMargins: marginsForCorrection('a4', c[0]), printerMargins: LEARNED, marginRule: 'fit' });
    expect(androidJobFacts(plan, A4, LEARNED)).toMatchObject({ expectExact: false, advice: 'marginsNotBlank' });
    expect(codes(plan)).toContain('correctionIntoMargin:warn');
  });

  it('iOS: the same widening (the printer would cut the ink), no Android warning, the bar stays the user\'s choice', () => {
    const doc = graphDoc({ checkBar: false });
    const r = printPlanFor(doc, settings, profile, REFEREE_CTX, { os: 'ios', corrections: single(1.02), applyCorrection: true, oneByOne: false, correctionJobKind: 'single' });
    expect(correctedInkInside(r.plan, LEARNED)).toBe(true);
    expect(codes(r.plan)).not.toContain('correctionEnlarges:warn');
    expect(codes(r.plan)).toContain('checkBarOff:warn');
    expect(bars(r.plan)).toEqual([0]);
  });

  it('a shrinking correction changes no margin', () => {
    const r = printPlanFor(graphDoc(), settings, profile, REFEREE_CTX, { os: 'android', corrections: single(0.98), applyCorrection: true, oneByOne: false, correctionJobKind: 'single' });
    expect(r.margins).toEqual(LEARNED);
    expect(codes(r.plan)).not.toContain('correctionEnlarges:warn');
  });

  it('Fill-sheet labels: copies that reach into the widened strip are cut and said; corrected ink stays inside', () => {
    const doc: ProjectDoc = { ...graphDoc(), objects: [object({ kind: 'rect', x: 6.35, y: 6.35, w: 197.3 / 3, h: 284.3 / 8, repeat: { cols: 3, rows: 8, gap_x_mm: 0, gap_y_mm: 0, trim_marks: false }, props: { strokeMm: 0.3 } })] };
    const r = printPlanFor(doc, settings, profile, REFEREE_CTX, { os: 'android', corrections: single(1.02), applyCorrection: true, oneByOne: false, correctionJobKind: 'single' });
    expect(correctedInkInside(r.plan, LEARNED)).toBe(true);
    expect(androidJobFacts(r.plan, A4, LEARNED).expectExact).toBe(true);
    expect(codes(r.plan)).toContain('objectInMargin:warn');
    expect(codes(r.plan)).toContain('checkBarOmitted:warn'); // labels are not a pattern: no room is made for the bar
  });
});

describe('finding 7: the check bar', () => {
  it('off → a warning, not silence', () => {
    const plan = planProject(graphDoc({ checkBar: false }), settings, profile, REFEREE_CTX);
    expect(codes(plan)).toContain('checkBarOff:warn');
  });

  it('page-filling patterns make room for it (graph, dots, lines)', () => {
    for (const kind of ['grid', 'dots', 'lines'] as const) {
      const t = templateProject(kind, defaultTemplateParams(kind, 'a4', 'mm'), LEARNED);
      const doc = { ...graphDoc(), objects: [object({ ...t.object, props: t.object.props as SheetObject['props'] })] };
      const plan = planProject(doc, settings, profile, REFEREE_CTX);
      expect(bars(plan)).toEqual([1]);
      expect(codes(plan)).toContain('checkBarRoomMade:info');
      // the pattern's clip ends 11 mm above the bottom of the safe area
      const op = plan.pages[0].ops.find((o) => o.op === 'object')!;
      expect(op.op === 'object' && op.clip.y + op.clip.h).toBeCloseTo(297 - 6.35 - 11, 6);
    }
  });

  it('one by one: every page is its own job and carries a bar', () => {
    const doc: ProjectDoc = {
      ...graphDoc(),
      sheets: [{ id: 1, projectId: 1, position: 0, widthMm: 1000, heightMm: 30, paperKey: null, name: '' }],
      objects: [object({ kind: 'ruler', x: 0, y: 0, w: 1000, h: 30, props: { unit: 'mm' } })],
    };
    const one = planProject(doc, settings, profile, REFEREE_CTX, { oneByOne: true });
    expect(one.pages.length).toBeGreaterThan(1);
    expect(bars(one).every((n) => n === 1)).toBe(true);
    const job = planProject(doc, settings, profile, REFEREE_CTX);
    expect(bars(job).reduce((a, b) => a + b, 0)).toBe(1);
  });
});

describe('Android multi-page job with the multi-page correction (D74, D77)', () => {
  it('only keeps the corrected page on the paper: the print service fits the paper into the printable area', () => {
    const doc: ProjectDoc = {
      ...graphDoc(),
      sheets: [{ id: 1, projectId: 1, position: 0, widthMm: 1000, heightMm: 30, paperKey: null, name: '' }],
      objects: [object({ kind: 'ruler', x: 0, y: 0, w: 1000, h: 30, props: { unit: 'mm' } })],
    };
    const multi: StoredCorrection[] = [{ paperKey: 'a4', jobKind: 'multi', fx: 1.0646, fy: 1.0644 }];
    const r = printPlanFor(doc, settings, profile, REFEREE_CTX, { os: 'android', corrections: multi, applyCorrection: true, oneByOne: false, correctionJobKind: 'multi' });
    expect(r.margins.l).toBeCloseTo(Math.max(6.35, Math.ceil(105 * (1 - 1 / 1.0646) * 100) / 100), 9);
    expect(r.margins.t).toBeCloseTo(Math.ceil(148.5 * (1 - 1 / 1.0644) * 100) / 100, 9);
    expect(correctedInkInside(r.plan, uniformMargins(0))).toBe(true);
    expect(codes(r.plan).some((c) => c.startsWith('correctionOffPage') || c.startsWith('correctionIntoMargin'))).toBe(false);
  });
});

describe('finding 6: what an import does not print is said on the print screen and on the paper', () => {
  it('an Inkscape-style SVG with a text, two arrowheads and an image → assetIncomplete + a grey note inside the safe area', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="120mm" height="60mm" viewBox="0 0 120 60">
      <defs><marker id="a"><path d="M0 0 L4 2 L0 4 z"/></marker></defs>
      <path d="M10 30 H110" stroke="#000" marker-start="url(#a)" marker-end="url(#a)"/>
      <text x="60" y="20">120 mm</text><image x="0" y="0" width="10" height="10" xlink:href="data:image/png;base64,AAAA"/></svg>`;
    const r = await inspectAsset('svg', new TextEncoder().encode(svg));
    if (!r.ok) throw new Error(r.error);
    const pa = planAssetOf({ id: 7, kind: 'svg', pxW: null, pxH: null, svgPxPerIn: null, report: r.asset.report, originalName: 'stencil.svg' });
    expect(pa.gaps).toEqual({ notDrawn: 4, approximated: 0 });
    const doc: ProjectDoc = { ...graphDoc(), objects: [object({ kind: 'svg', assetId: 7, x: 40, y: 40, w: 120, h: 60 })], assets: [] };
    const input = { ...doc, assets: [] };
    const plan = planProject(input, settings, profile, REFEREE_CTX);
    // assets come from rows in the app; here the PlanAsset is given directly
    const p2 = planPrint({ ...planInputFor(doc, settings, profile, REFEREE_CTX), assets: [pa] });
    expect(plan.warnings.some((w) => w.code === 'assetIncomplete')).toBe(false); // no asset row → nothing drawn, nothing said
    expect(p2.warnings.find((w) => w.code === 'assetIncomplete')).toMatchObject({ level: 'warn', params: { name: 'stencil.svg', notDrawn: 4 } });
    const notes = p2.pages[0].ops.filter((op) => op.op === 'text' && op.role === 'note');
    expect(notes).toHaveLength(1);
    const n = notes[0] as { x: number; y: number; text: string };
    expect(n.text).toContain('stencil.svg');
    const safe = p2.pages[0].safe;
    expect(n.x).toBeGreaterThanOrEqual(safe.x);
    expect(n.y).toBeLessThanOrEqual(safe.y + safe.h);
  });

  it('PDF pages: only notes that change what prints count, per placed page', async () => {
    const report = { v: 1, kind: 'pdf', restricted: false, pages: [{ w: 100, h: 60, rotate: 0, notes: ['cropBoxIgnored'] }, { w: 100, h: 60, rotate: 0, notes: ['annotationsNotPrinted', 'hiddenLayers'] }] };
    expect(planAssetOf({ id: 1, kind: 'pdf', pxW: null, pxH: null, svgPxPerIn: null, report }).gaps).toEqual({ notDrawn: 0, approximated: 0, pageNotes: [0, 2] });
  });
});

describe('finding 7b: Fill sheet with the check bar on', () => {
  it('puts the grid at the top, so the spare room makes one strip for the bar (same number of copies)', () => {
    const safe = { x: 6.35, y: 6.35, w: 197.3, h: 284.3 };
    const item = { w: 63.5, h: 38.1, rotationDeg: 0 };
    const centred = fillSheet(item, { x: 0, y: 0 }, safe)!;
    const top = fillSheet(item, { x: 0, y: 0 }, safe, 'top')!;
    expect([top.cols, top.rows]).toEqual([centred.cols, centred.rows]);
    const plan = (f: typeof top) =>
      planProject({ ...graphDoc(), objects: [object({ kind: 'rect', x: f.x, y: f.y, w: 63.5, h: 38.1, repeat: { cols: f.cols, rows: f.rows, gap_x_mm: 0, gap_y_mm: 0, trim_marks: false }, props: { strokeMm: 0.3 } })] }, settings, profile, REFEREE_CTX);
    expect(bars(plan(centred))).toEqual([0]);
    expect(bars(plan(top))).toEqual([1]);
  });
});

describe('finding 8: margins smaller than the printer can print', () => {
  it('a project margin of 2 mm under a printer that reported 4.2 mm is flagged; learned margins in force are not', () => {
    const reported = uniformMargins(4.2);
    const p = { margins: reported, marginsSource: 'learned' as const, reportedMargins: reported };
    expect(marginsBelowPrinter(effectiveMargins(project({ marginMm: 2 }), p, settings), printerReportedMargins(p))).toEqual(reported);
    expect(marginsBelowPrinter(effectiveMargins(project(), p, settings), printerReportedMargins(p))).toBeNull();
    // typed 0 mm (borderless) on a printer that reported 3 mm
    const typed = { margins: uniformMargins(0), marginsSource: 'typed' as const, reportedMargins: uniformMargins(3) };
    expect(marginsBelowPrinter(effectiveMargins(project(), typed, settings), printerReportedMargins(typed))).toEqual(uniformMargins(3));
    // nothing reported → nothing said
    expect(marginsBelowPrinter(uniformMargins(1), printerReportedMargins({ margins: null, marginsSource: 'default' }))).toBeNull();
  });
});
