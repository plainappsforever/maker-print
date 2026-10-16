// From stored rows to the print plan (SPEC §8.6, D16, D17): the margins in force, the PlanInput of a project and a
// one-line summary of its pages. Shared by the editor's page preview (P5) and the print screen (P6). Pure.
import type { Asset } from '@/db/assets';
import type { SheetObject } from '@/db/objects';
import type { Profile } from '@/db/profiles';
import type { Project } from '@/db/projects';
import type { AppSettings } from '@/db/settings';
import type { Sheet } from '@/db/sheets';
import { pickCorrection, type Correction, type JobKind, type StoredCorrection } from '@/engine/calibration';
import type { GenContext } from '@/engine/generators';
import { defaultMarginMm, getPaper, MIN_LEARNED_MARGIN_MM, paperSize, uniformMargins, type Margins, type PaperKey } from '@/engine/paper';
import { planPrint, type PlanInput, type PrintPlan } from '@/engine/plan';
import { chooseLayout, tiles, type SheetLayout, type Tile } from '@/engine/tiles';
import { planAssetOf } from '@/import/assets';

export type ProjectDoc = { project: Project; sheets: Sheet[]; objects: SheetObject[]; assets: Asset[] };

/** Learned margins below 3 mm are used as 3 mm (D76); typed margins as typed. */
export function usableProfileMargins(profile: Pick<Profile, 'margins'> & { marginsSource?: Profile['marginsSource'] }): Margins | null {
  const m = profile.margins;
  if (!m || profile.marginsSource === 'typed') return m;
  const f = (v: number) => Math.max(v, MIN_LEARNED_MARGIN_MM);
  return { l: f(m.l), t: f(m.t), r: f(m.r), b: f(m.b) };
}

/**
 * Margins in force: the project's own value; else the profile's learned (at least 3 mm, D76) or typed margins (D17);
 * else the settings default (photo papers 3 mm).
 */
export function effectiveMargins(
  project: Pick<Project, 'marginMm' | 'paperKey'>,
  profile: (Pick<Profile, 'margins'> & { marginsSource?: Profile['marginsSource'] }) | null,
  settings: Pick<AppSettings, 'defaultMarginMm'>
): Margins {
  if (project.marginMm !== null) return uniformMargins(project.marginMm);
  const learned = profile ? usableProfileMargins(profile) : null;
  if (learned) return learned;
  return uniformMargins(getPaper(project.paperKey).kind === 'photo' ? defaultMarginMm(project.paperKey) : settings.defaultMarginMm);
}

/**
 * Margins a correction needs so that the safe area, scaled by c about the page centre, stays inside `base` (D77, D83):
 * per side m' = C − (C − m)/c with C half the paper's width or height and m the margin the printer needs (learned,
 * typed or default — whatever is in force). With `base` 0 this keeps the ink on the paper (D77, measured in P6: 2.3 mm
 * of each W4 tile lost at ×1.0644); with the printer's margins it keeps the corrected ink out of the printer's strips,
 * which on Android decides between 1:1 and "fit to page" (D12; REVIEW_V1 finding 1). Null when c does not enlarge.
 */
export function marginsForCorrection(paperKey: PaperKey, c: Correction | null, base: Margins = uniformMargins(0)): Margins | null {
  if (!c || (c.fx <= 1 && c.fy <= 1)) return null;
  const p = paperSize(paperKey, 'portrait');
  const need = (half: number, m: number, f: number) => (f > 1 ? Math.max(m, Math.ceil((half - (half - m) / f) * 100 - 1e-9) / 100) : m);
  return { l: need(p.w / 2, base.l, c.fx), r: need(p.w / 2, base.r, c.fx), t: need(p.h / 2, base.t, c.fy), b: need(p.h / 2, base.b, c.fy) };
}

/**
 * The margins the profile's printer reported (finding 8): the last reported ones, else learned ones. Null when unknown.
 */
export function printerReportedMargins(profile: Pick<Profile, 'margins' | 'marginsSource'> & { reportedMargins?: Margins | null }): Margins | null {
  return profile.reportedMargins ?? (profile.marginsSource === 'learned' ? profile.margins : null);
}

/** Sides where the margins in force are smaller than what the printer can print (REVIEW_V1 finding 8), else null. */
export function marginsBelowPrinter(own: Margins, reported: Margins | null): Margins | null {
  if (!reported) return null;
  const below = (['l', 't', 'r', 'b'] as const).some((k) => own[k] < reported[k] - 0.005);
  return below ? reported : null;
}

const maxMargins = (a: Margins, b: Margins | null): Margins =>
  b ? { l: Math.max(a.l, b.l), t: Math.max(a.t, b.t), r: Math.max(a.r, b.r), b: Math.max(a.b, b.b) } : a;

export function planInputFor(
  doc: ProjectDoc,
  settings: Pick<AppSettings, 'defaultMarginMm' | 'checkBar' | 'ppiTarget'>,
  profile: (Pick<Profile, 'margins'> & { marginsSource?: Profile['marginsSource'] }) | null,
  ctx: GenContext,
  extra: { corrections?: readonly StoredCorrection[]; applyCorrection?: boolean; oneByOne?: boolean; correctionJobKind?: JobKind; minMargins?: Margins | null; printerMargins?: Margins; marginRule?: 'clip' | 'fit' } = {}
): PlanInput {
  const p = doc.project;
  return {
    sheets: doc.sheets.map((s) => ({ id: s.id, widthMm: s.widthMm, heightMm: s.heightMm })),
    objects: doc.objects.map((o) => ({ ...o, repeat: o.repeat, props: o.props })),
    assets: doc.assets.map((a) => planAssetOf(a)),
    output: {
      paperKey: p.paperKey,
      orientation: p.orientation,
      margins: maxMargins(effectiveMargins(p, profile, settings), extra.minMargins ?? null),
      overlapMm: p.overlapMm,
      marks: p.marks,
      pageLabels: p.pageLabels,
      assemblyMap: p.assemblyMap,
      skipBlank: p.skipBlank,
      excludedTiles: p.excludedTiles,
      checkBar: p.checkBar ?? settings.checkBar,
      ppiTarget: settings.ppiTarget,
      oneByOne: extra.oneByOne,
    },
    corrections: extra.corrections,
    applyCorrection: extra.applyCorrection,
    correctionJobKind: extra.correctionJobKind,
    printerMargins: extra.printerMargins,
    marginRule: extra.marginRule,
    ctx,
  };
}

export function planProject(...args: Parameters<typeof planInputFor>): PrintPlan {
  return planPrint(planInputFor(...args));
}

/**
 * The plan the print screen sends (D74, D77, D83): the profile's correction for this paper and job kind, margins widened
 * so the corrected ink stays inside the margins in force, the platform's margin rule ('fit' on Android). `own` = the
 * margins before widening, `margins` = the ones the plan uses.
 */
export function printPlanFor(
  doc: ProjectDoc,
  settings: Pick<AppSettings, 'defaultMarginMm' | 'checkBar' | 'ppiTarget'>,
  profile: (Pick<Profile, 'margins'> & { marginsSource?: Profile['marginsSource'] }) | null,
  ctx: GenContext,
  o: { os: 'ios' | 'android' | 'other'; corrections: readonly StoredCorrection[]; applyCorrection: boolean; oneByOne: boolean; correctionJobKind: JobKind }
): { plan: PrintPlan; own: Margins; margins: Margins; correction: StoredCorrection | null } {
  const own = effectiveMargins(doc.project, profile, settings);
  const kind: JobKind = o.oneByOne ? 'single' : o.correctionJobKind;
  const correction = o.applyCorrection ? pickCorrection(o.corrections, doc.project.paperKey, kind) : null;
  // Android multi-page job: the print service fits the whole PAPER into the printable area and the correction undoes
  // that fit (D74), so the corrected page only has to stay on the paper (D77); every other job prints 1:1 and its
  // corrected ink must stay inside the margins in force (D83)
  const fitJob = o.os === 'android' && !o.oneByOne && kind === 'multi';
  const widened = marginsForCorrection(doc.project.paperKey, correction, fitJob ? uniformMargins(0) : own);
  const kept = widened && fitJob ? { l: Math.max(own.l, widened.l), t: Math.max(own.t, widened.t), r: Math.max(own.r, widened.r), b: Math.max(own.b, widened.b) } : widened;
  const plan = planProject(doc, settings, profile, ctx, {
    corrections: o.corrections,
    applyCorrection: o.applyCorrection,
    minMargins: kept,
    printerMargins: fitJob ? uniformMargins(0) : own,
    marginRule: o.os === 'android' ? 'fit' : 'clip',
    ...(o.oneByOne ? { oneByOne: true } : { correctionJobKind: o.correctionJobKind }),
  });
  return { plan, own, margins: kept ?? own, correction };
}

/** Tile grid of one sheet for the editor overlay (same layout rule as the plan: `auto` = fewer pages). */
export function sheetTiles(sheet: Pick<Sheet, 'widthMm' | 'heightMm'>, project: Pick<Project, 'paperKey' | 'orientation' | 'overlapMm'>, margins: Margins): { layout: SheetLayout; tiles: Tile[] } {
  const size = { w: sheet.widthMm, h: sheet.heightMm };
  const layout = chooseLayout(size, project.paperKey, project.orientation, margins, project.overlapMm);
  return { layout, tiles: layout.mode === 'tiled' ? tiles(size, layout) : [] };
}

export type PlanSummary = { pages: number; tiles: number; maps: number; turned: number; mode: 'single' | 'placed' | 'tiled' | 'mixed'; orientation: 'portrait' | 'landscape' | 'mixed' };

/** "8 pages · landscape · 1 assembly map" — what the plan will print. */
export function planSummary(plan: PrintPlan): PlanSummary {
  const tilesN = plan.pages.filter((p) => p.kind === 'tile').length;
  const maps = plan.pages.filter((p) => p.kind === 'map').length;
  const modes = new Set(plan.sheets.map((s) => s.mode));
  const orients = new Set(plan.sheets.map((s) => s.orientation));
  return {
    pages: plan.pages.length,
    tiles: tilesN,
    maps,
    turned: plan.pages.filter((p) => p.rotation).length,
    mode: modes.size === 1 ? [...modes][0] : 'mixed',
    orientation: orients.size === 1 ? [...orients][0] : 'mixed',
  };
}
