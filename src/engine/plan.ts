// Print plan (SPEC §8.5–§8.7, D16, D39–D44): one pure function turns sheets + objects + output options into pages of
// drawing ops in page millimetres (y down). The PDF writer (src/pdf/writer.ts) and previews consume it.
// Invariant (D12): no op of any page reaches into the margin strips — asserted at the end of planPrint.
// D53: every page is the paper in portrait; a landscape layout is drawn in its own frame and turned onto the page.
import { correctionMatrix, isIdentityCorrection, pickCorrection, type JobKind, type StoredCorrection } from './calibration';
import { CHECK_BAR_CLEARANCE_MM, CHECK_BAR_FOOTPRINT, checkBarFootprint, findCheckBarPlace, findStripPlace, rectAwayFrom } from './checkbar';
import { objectContent, isVectorKind, type GenContext } from './generators';
import { calibrationSheet, type CalibrationSheet } from './generators/calibration-sheet';
import { printLength, textAt } from './generators/context';
import {
  apply,
  chain,
  contentMap,
  isAtDesignedSize,
  NO_CROP,
  objectCorners,
  objectMatrix,
  rectContains,
  rectsIntersect,
  scale,
  sourceToLocal,
  translate,
  visibleSize,
  type Affine,
  type Crop,
  type FitMode,
  type Placement,
  type Point,
  type Rect,
} from './geometry';
import {
  edgeMarks,
  labelBox,
  labelBoxSize,
  REGISTRATION_EXTENT_MM,
  registrationMark,
  segmentsPath,
  TILE_TRIM_STROKE_MM,
  type MarkSegment,
} from './marks';
import { paperSize, type Margins, type Orientation, type PaperKey } from './paper';
import { contentBounds, FAINT_GREY, intersectRects, MARK_GREY, mapRect, path, transformPath, unionRects, type Content, type PathItem, type TextItem } from './path';
import { effectivePpi, ppiBand } from './ppi';
import { repeatCopies, repeatGrid, type RepeatSpec } from './repeat';
import { textWidthMm, wrapText } from './text-metrics';
import {
  CONFIRM_PAGES,
  chooseLayout,
  landscapeToPortrait,
  MAX_PAGES,
  MAX_SHEET_MM,
  overlapDepth,
  polygonOverlapDepth,
  registrationPoints,
  tileKey,
  tileLabel,
  tiles as tilesOf,
  validateOutput,
  type OrientationChoice,
  type OutputMode,
  type SheetLayout,
} from './tiles';


// ------------------------------------------------------------------------------------------------ input
export type AssetObjectKind = 'image' | 'pdf_page' | 'svg';
export type PlanObject = {
  id: number;
  sheetId: number;
  z: number;
  kind: string;
  assetId: number | null;
  pageIndex: number;
  x: number;
  y: number;
  w: number;
  h: number;
  rotationDeg: number;
  mirrorX: boolean;
  mirrorY: boolean;
  crop: Crop | null;
  fit: FitMode;
  repeat: RepeatSpec | null;
  props: Record<string, unknown>;
  hidden: boolean;
};
export type PlanSheet = { id: number; widthMm: number; heightMm: number };
/** Natural sizes come from the importers (P3): image px, PDF page mm per page index, SVG mm. */
export type PlanAsset = {
  id: number;
  kind: 'image' | 'pdf' | 'svg';
  pxW: number | null;
  pxH: number | null;
  pageSizesMm?: { w: number; h: number }[];
  naturalMm?: { w: number; h: number } | null;
  /** The file's name, for the printed import note (D84) */
  name?: string;
  /** What the importer could not print exactly (D24, D56; SPEC §9.3): SVG parts not drawn / drawn differently, PDF notes per page */
  gaps?: { notDrawn: number; approximated: number; pageNotes?: number[] };
};
export type OutputOptions = {
  paperKey: PaperKey;
  orientation: OrientationChoice;
  margins: Margins;
  overlapMm: number;
  marks: 'registration' | 'none';
  pageLabels: boolean;
  assemblyMap: 'auto' | 'on' | 'off';
  skipBlank: boolean;
  excludedTiles: string[];
  checkBar: boolean;
  ppiTarget: number;
  /** Android "Print pages one by one (exact)": every page is its own single-page job (D12) */
  oneByOne?: boolean;
};
export type PlanInput = {
  sheets: PlanSheet[];
  objects: PlanObject[];
  assets?: PlanAsset[];
  output: OutputOptions;
  /** Stored corrections of the chosen profile; only the exact paper + job kind is ever used (D18) */
  corrections?: readonly StoredCorrection[];
  /** The print screen's per-print switch (SPEC §8.7) */
  applyCorrection?: boolean;
  /**
   * Which stored job kind's correction applies (default: the plan's job kind). iOS passes 'single' for every job: its
   * renderer prints each page at scale 1 whatever the page count (P4, D63), so only Android has a multi-page route (D74).
   */
  correctionJobKind?: JobKind;
  /**
   * The margins the printer itself needs, before an enlarging correction widened them (D77, D83): the corrected ink must
   * stay inside these. Default: `output.margins`.
   */
  printerMargins?: Margins;
  /**
   * What the print system does with ink in the printer's margin strips (D12): 'clip' — the printer leaves it out (iOS);
   * 'fit' — the Android Default Print Service shrinks the whole page to fit. Default 'clip'.
   */
  marginRule?: 'clip' | 'fit';
  ctx: GenContext;
};

// ------------------------------------------------------------------------------------------------ output
export type MarkRole = 'trim' | 'crop' | 'registration' | 'tileTrim' | 'label' | 'map' | 'calibration' | 'note';
export type ObjectOp = {
  op: 'object';
  objectId: number;
  kind: string;
  copy: { col: number; row: number };
  /** Object-local [0,w]×[0,h] → page mm */
  transform: Affine;
  /** Page-mm clip (sheet ∩ safe area / tile content); always inside the safe area */
  clip: Rect;
  box: { w: number; h: number };
  /** Asset kinds: natural source → object-local map (crop + fill/fit); the writer clips to the box */
  source?: { assetId: number; pageIndex: number; natural: { w: number; h: number }; map: Affine };
};
export type PathOp = { op: 'path'; role: MarkRole; clip?: Rect } & PathItem;
export type TextOp = { op: 'text'; role: MarkRole } & TextItem;
export type CheckBarOp = { op: 'checkBar'; x: number; y: number; vertical: boolean };
export type Op = ObjectOp | PathOp | TextOp | CheckBarOp;
export type PageKind = 'single' | 'placed' | 'tile' | 'map' | 'calibration';
export type Page = {
  /** Always the paper in PORTRAIT (D53) — a job never mixes page orientations */
  widthMm: number;
  heightMm: number;
  /** Orientation of the layout frame: 'landscape' = the content is turned a quarter turn onto the portrait page */
  orientation: Orientation;
  label: string;
  kind: PageKind;
  sheetIndex: number | null;
  tile?: { row: number; col: number; label: string; key: string };
  /** Safe area (paper minus margins) in FRAME coordinates, like the ops — every op stays inside it */
  safe: Rect;
  /** Ops in frame mm (y down); for portrait frames the frame is the page */
  ops: Op[];
  /** Frame → page (D53): null for portrait frames, `landscapeToPortrait` for landscape ones */
  rotation: Affine | null;
  /** Calibration correction about the page centre in PAGE coordinates, applied by the writer outside the rotation */
  correction: Affine | null;
};

/** A frame rectangle (op footprint, safe area) on the physical portrait page (D53). */
export const toPageRect = (page: Pick<Page, 'rotation'>, r: Rect): Rect => (page.rotation ? mapRect(page.rotation, r) : r);

/** Ink bounds of a whole page on the physical page, before the correction. */
export function pageInk(page: Pick<Page, 'ops' | 'rotation'>, content: Record<number, Content>): Rect | null {
  const ink = unionRects(page.ops.map((op) => opFootprint(op, content)).filter((r): r is Rect => r !== null));
  return ink ? toPageRect(page, ink) : null;
}
export type WarningCode =
  | 'contentTooSmall'
  | 'overlapTooLarge'
  | 'sheetTooLarge'
  | 'tooManyPages'
  | 'manyPages'
  | 'nothingToPrint'
  | 'objectOffSheet'
  | 'objectPartlyOffSheet'
  | 'objectInMargin'
  | 'notDesignedSize'
  | 'lowPpi'
  | 'assetSizeUnknown'
  | 'unsupportedGlyphs'
  | 'trimMarksNoRoom'
  | 'cropMarksNoRoom'
  | 'checkBarOmitted'
  | 'checkBarNotOnFirstPage'
  | 'correctionApplied'
  | 'correctionOffPage'
  | 'correctionIntoMargin'
  | 'pagesTurned'
  | 'tooManyCopies'
  | 'textOverflow'
  | 'marksLeftOut'
  | 'checkBarOff'
  | 'checkBarForced'
  | 'checkBarMissing'
  | 'checkBarRoomMade'
  | 'correctionEnlarges'
  | 'assetIncomplete'
  | 'assetNoteNoRoom';
export const WARNING_CODES: readonly WarningCode[] = [
  'contentTooSmall', 'overlapTooLarge', 'sheetTooLarge', 'tooManyPages', 'manyPages', 'nothingToPrint', 'objectOffSheet',
  'objectPartlyOffSheet', 'objectInMargin', 'notDesignedSize', 'lowPpi', 'assetSizeUnknown', 'unsupportedGlyphs',
  'trimMarksNoRoom', 'cropMarksNoRoom', 'checkBarOmitted', 'checkBarNotOnFirstPage', 'correctionApplied',
  'correctionOffPage', 'correctionIntoMargin', 'pagesTurned', 'tooManyCopies', 'textOverflow', 'marksLeftOut',
  'checkBarOff', 'checkBarForced', 'checkBarMissing', 'checkBarRoomMade', 'correctionEnlarges', 'assetIncomplete', 'assetNoteNoRoom',
];
export type Warning = { code: WarningCode; level: 'error' | 'warn' | 'info'; params: Record<string, string | number> };
export type SheetStats = {
  sheetIndex: number;
  mode: OutputMode;
  orientation: Orientation;
  cols: number;
  rows: number;
  printedTiles: string[];
  skippedBlank: string[];
  excluded: string[];
  map: boolean;
};
export type PrintPlan = {
  pages: Page[];
  warnings: Warning[];
  /** Local content of every vector object (drawn once, reused for copies, tiles and the map) */
  content: Record<number, Content>;
  sheets: SheetStats[];
  jobKind: JobKind;
  correction: StoredCorrection | null;
  paperKey: PaperKey;
};

const EPS = 1e-9;
const ASSERT_EPS = 1e-6;
/**
 * Hard caps (P3.5 finding 2): repeat copies of all objects together, and object draws over all pages (copies × tiles
 * + map). Above them the plan is refused with `tooManyCopies` instead of exhausting memory or the call stack later.
 * 15 000 copies on one page are tested to plan and write in Node; Hermes limits are measured in P4 (L11).
 */
export const MAX_COPIES = 50_000;
export const MAX_OBJECT_DRAWS = 200_000;
const pushAll = <T,>(target: T[], items: readonly T[]) => {
  for (let i = 0; i < items.length; i++) target.push(items[i]);
};
const ASSET_KINDS: readonly string[] = ['image', 'pdf_page', 'svg'];

const placementOf = (o: PlanObject, x = o.x, y = o.y): Placement => ({ x, y, w: o.w, h: o.h, rotationDeg: o.rotationDeg, mirrorX: o.mirrorX, mirrorY: o.mirrorY });

/** Natural size of an asset object's source, or null when the importer has not provided it. */
function naturalOf(o: PlanObject, assets: Map<number, PlanAsset>): { w: number; h: number } | null {
  const a = o.assetId === null ? undefined : assets.get(o.assetId);
  if (!a) return null;
  if (o.kind === 'image') return a.pxW && a.pxH ? { w: a.pxW, h: a.pxH } : null;
  if (o.kind === 'pdf_page') return a.pageSizesMm?.[o.pageIndex] ?? null;
  if (o.kind === 'svg') return a.naturalMm ?? null;
  return null;
}

// ------------------------------------------------------------------------------------------------ footprints
/** Ink bounds of an op on its page (before the correction). */
export function opFootprint(op: Op, content: Record<number, Content>): Rect | null {
  switch (op.op) {
    case 'object': {
      const local = content[op.objectId] ? contentBounds(content[op.objectId], (t) => textWidthMm(t.text, t.sizeMm)) : null;
      const box = local ? unionRects([local, { x: 0, y: 0, w: op.box.w, h: op.box.h }]) : { x: 0, y: 0, w: op.box.w, h: op.box.h };
      return intersectRects(mapRect(op.transform, box as Rect), op.clip);
    }
    case 'path': {
      const b = contentBounds({ paths: [op], texts: [] }, () => 0);
      return b && op.clip ? intersectRects(b, op.clip) : b;
    }
    case 'text':
      return contentBounds({ paths: [], texts: [op] }, (t) => textWidthMm(t.text, t.sizeMm));
    case 'checkBar':
      return checkBarFootprint(op.x, op.y, op.vertical);
  }
}

// ------------------------------------------------------------------------------------------------ helpers
/** Local ink rectangle (box ∪ content bounds) when the content reaches more than SPILL_MM past the box, else null. */
function spillRect(o: PlanObject, c: Content | undefined): Rect | null {
  const b = c ? contentBounds(c, (t) => textWidthMm(t.text, t.sizeMm)) : null;
  if (!b || !(b.x < -SPILL_MM || b.y < -SPILL_MM || b.x + b.w > o.w + SPILL_MM || b.y + b.h > o.h + SPILL_MM)) return null;
  return unionRects([b, { x: 0, y: 0, w: o.w, h: o.h }]);
}
const rectCorners = (r: Rect): Point[] => [
  { x: r.x, y: r.y },
  { x: r.x + r.w, y: r.y },
  { x: r.x + r.w, y: r.y + r.h },
  { x: r.x, y: r.y + r.h },
];
function mapSegments(segs: MarkSegment[], m: Affine): MarkSegment[] {
  return segs.map((s) => {
    const [a, b, c, d, e, f] = m;
    return { x0: a * s.x0 + c * s.y0 + e, y0: b * s.x0 + d * s.y0 + f, x1: a * s.x1 + c * s.y1 + e, y1: b * s.x1 + d * s.y1 + f };
  });
}

function textOps(c: Content, role: MarkRole): TextOp[] {
  return c.texts.map((t) => ({ op: 'text', role, ...t }));
}
function pathOps(c: Content, role: MarkRole, clip?: Rect): PathOp[] {
  return c.paths.map((p) => (clip ? { op: 'path', role, clip, ...p } : { op: 'path', role, ...p }));
}

/** `ink` = corners of the rotated ink rectangle on the sheet when the content spills past the box (text), else null. */
type Expanded = { obj: PlanObject; copies: { col: number; row: number; p: Placement; ink: Point[] | null }[] };
/** Content further than this outside its box counts as spilling (a centred 0.2 mm stroke on the box edge does not). */
const SPILL_MM = 0.5;
/** Free space kept between a page label box and registration marks (finding 8). */
const LABEL_CLEARANCE_MM = 0.5;

// ------------------------------------------------------------------------------------------------ planner
export function planPrint(input: PlanInput): PrintPlan {
  const { output: out, ctx } = input;
  const warnings: Warning[] = [];
  const warn = (code: WarningCode, level: Warning['level'], params: Warning['params'] = {}) => warnings.push({ code, level, params });
  const plan: PrintPlan = { pages: [], warnings, content: {}, sheets: [], jobKind: 'single', correction: null, paperKey: out.paperKey };

  const invalid = validateOutput(out.paperKey, out.margins, out.overlapMm);
  if (invalid) {
    warn(invalid, 'error');
    return plan;
  }
  const assets = new Map((input.assets ?? []).map((a) => [a.id, a]));
  const excluded = new Set(out.excludedTiles);
  const multiSheet = input.sheets.length > 1;

  // copy cap before anything is expanded
  const copies = input.objects.reduce((n, o) => n + (o.hidden ? 0 : Math.max(1, o.repeat?.cols ?? 1) * Math.max(1, o.repeat?.rows ?? 1)), 0);
  if (copies > MAX_COPIES) {
    warn('tooManyCopies', 'error', { copies, max: MAX_COPIES });
    return plan;
  }

  // object content and object-level warnings
  for (const o of input.objects) {
    if (o.hidden) continue;
    if (isVectorKind(o.kind)) {
      const c = objectContent(o.kind, o.w, o.h, o.props, ctx);
      plan.content[o.id] = { paths: c.paths, texts: c.texts };
      if (c.unsupported.length) warn('unsupportedGlyphs', 'warn', { objectId: o.id, chars: c.unsupported.join(' ') });
      // P3.5 finding 6: text is not wrapped or clipped to its box — say so instead of losing it on skipped tiles
      const tb = c.texts.length ? contentBounds({ paths: [], texts: c.texts }, (t) => textWidthMm(t.text, t.sizeMm)) : null;
      if (tb && (tb.x < -SPILL_MM || tb.y < -SPILL_MM || tb.x + tb.w > o.w + SPILL_MM || tb.y + tb.h > o.h + SPILL_MM)) warn('textOverflow', 'warn', { objectId: o.id });
    } else if (ASSET_KINDS.includes(o.kind)) {
      const natural = naturalOf(o, assets);
      if (!natural) {
        warn('assetSizeUnknown', 'error', { objectId: o.id });
        continue;
      }
      const map = contentMap(o, visibleSize(natural.w, natural.h, o.crop ?? NO_CROP), o.fit);
      if (o.kind === 'image') {
        const ppi = effectivePpi(natural, o, o.crop, o.fit).ppi;
        const band = ppiBand(ppi, out.ppiTarget);
        if (band === 'soft' || band === 'blocky') warn('lowPpi', 'warn', { objectId: o.id, ppi: Math.round(ppi), band });
        else if (band === 'fine') warn('lowPpi', 'info', { objectId: o.id, ppi: Math.round(ppi), band });
      } else if (!isAtDesignedSize(map)) {
        warn('notDesignedSize', 'warn', { objectId: o.id, scaleX: map.scaleX * 100, scaleY: map.scaleY * 100 });
      }
    }
  }

  input.sheets.forEach((sheet, si) => {
    const S = { w: sheet.widthMm, h: sheet.heightMm };
    if (!(S.w > 0 && S.h > 0) || S.w > MAX_SHEET_MM + EPS || S.h > MAX_SHEET_MM + EPS) {
      warn('sheetTooLarge', 'error', { sheet: si + 1 });
      return;
    }
    const sheetRect: Rect = { x: 0, y: 0, w: S.w, h: S.h };
    const lay = chooseLayout(S, out.paperKey, out.orientation, out.margins, out.overlapMm);
    const safe = lay.content;
    const objs: Expanded[] = input.objects
      .filter((o) => o.sheetId === sheet.id && !o.hidden && (plan.content[o.id] || (ASSET_KINDS.includes(o.kind) && naturalOf(o, assets))))
      .sort((a, b) => a.z - b.z || a.id - b.id)
      .map((obj) => {
        const ink = spillRect(obj, plan.content[obj.id]);
        return {
          obj,
          copies: repeatCopies(obj, obj.repeat).map((c) => {
            const p = placementOf(obj, c.x, c.y);
            const m = objectMatrix(p);
            return { col: c.col, row: c.row, p, ink: ink ? rectCorners(ink).map((q) => apply(m, q)) : null };
          }),
        };
      });
    // footprint tests use the ink when it spills past the box (finding 6), else the box (D40)
    const cornersOf = (c: Expanded['copies'][number]) => c.ink ?? objectCorners(c.p);
    const hits = (c: Expanded['copies'][number], r: Rect) => (c.ink ? polygonOverlapDepth(c.ink, r) : overlapDepth(c.p, r)) > EPS;

    // where content can print, in sheet coordinates
    const offset = lay.mode === 'placed' ? { x: (lay.paper.w - S.w) / 2, y: (lay.paper.h - S.h) / 2 } : { x: 0, y: 0 };
    const printable: Rect =
      lay.mode === 'tiled' ? sheetRect : (intersectRects(sheetRect, { x: safe.x - offset.x, y: safe.y - offset.y, w: safe.w, h: safe.h }) ?? { x: 0, y: 0, w: 0, h: 0 });

    // sheet-level marks (trim marks of repeats), in sheet coordinates
    const sheetMarks: MarkSegment[] = [];
    for (const { obj, copies } of objs) {
      const inside = copies.map((c) => cornersOf(c).every((q) => q.x >= -EPS && q.y >= -EPS && q.x <= S.w + EPS && q.y <= S.h + EPS));
      const touches = copies.map((c) => hits(c, sheetRect));
      if (!touches.some(Boolean)) warn('objectOffSheet', 'warn', { objectId: obj.id });
      else if (inside.some((v) => !v)) warn('objectPartlyOffSheet', 'warn', { objectId: obj.id });
      if (lay.mode !== 'tiled' && touches.some(Boolean)) {
        const inPrintable = copies.every((c) => cornersOf(c).every((q) => q.x >= printable.x - EPS && q.y >= printable.y - EPS && q.x <= printable.x + printable.w + EPS && q.y <= printable.y + printable.h + EPS));
        if (!inPrintable && inside.every(Boolean)) warn('objectInMargin', 'warn', { objectId: obj.id });
      }
      if (obj.repeat?.trim_marks && out.marks !== 'none') {
        const g = repeatGrid(obj, obj.repeat);
        const m = edgeMarks(g.bounds, g.xs, g.ys, printable);
        if (m.omitted.length) warn('trimMarksNoRoom', 'warn', { objectId: obj.id, sides: m.omitted.join(',') });
        if (m.dropped) warn('marksLeftOut', 'info', { objectId: obj.id, count: m.dropped }); // finding 15
        pushAll(sheetMarks, m.segments);
      }
    }

    const objectOps = (T: Affine, clip: Rect, region: Rect): ObjectOp[] => {
      const ops: ObjectOp[] = [];
      for (const { obj, copies } of objs) {
        const natural = ASSET_KINDS.includes(obj.kind) ? naturalOf(obj, assets) : null;
        for (const c of copies) {
          if (!hits(c, region)) continue;
          const op: ObjectOp = { op: 'object', objectId: obj.id, kind: obj.kind, copy: { col: c.col, row: c.row }, transform: chain(T, objectMatrix(c.p)), clip, box: { w: obj.w, h: obj.h } };
          if (natural && obj.assetId !== null) op.source = { assetId: obj.assetId, pageIndex: obj.pageIndex, natural, map: sourceToLocal(natural, obj.crop ?? NO_CROP, obj, obj.fit) };
          ops.push(op);
        }
      }
      return ops;
    };
    const markOp = (segs: MarkSegment[], T: Affine, role: MarkRole, clip?: Rect): PathOp[] => {
      const p = segmentsPath(mapSegments(segs, T));
      return p ? [clip ? { op: 'path', role, clip, ...p } : { op: 'path', role, ...p }] : [];
    };

    const stats: SheetStats = { sheetIndex: si, mode: lay.mode, orientation: lay.orientation, cols: lay.cols, rows: lay.rows, printedTiles: [], skippedBlank: [], excluded: [], map: false };
    plan.sheets.push(stats);
    const portrait = paperSize(out.paperKey, 'portrait');
    const pageBase = {
      widthMm: portrait.w,
      heightMm: portrait.h,
      orientation: lay.orientation,
      sheetIndex: si,
      safe,
      rotation: lay.orientation === 'landscape' ? landscapeToPortrait(portrait) : null,
      correction: null,
    };

    if (lay.mode !== 'tiled') {
      const T = translate(offset.x, offset.y);
      const clip = intersectRects({ x: offset.x, y: offset.y, w: S.w, h: S.h }, safe);
      const ops: Op[] = [];
      if (clip) pushAll(ops, objectOps(T, clip, sheetRect));
      pushAll(ops, markOp(sheetMarks, T, 'trim'));
      if (lay.mode === 'placed' && out.marks !== 'none') {
        const X0 = offset.x;
        const Y0 = offset.y;
        const m = edgeMarks({ x: X0, y: Y0, w: S.w, h: S.h }, [X0, X0 + S.w], [Y0, Y0 + S.h], safe);
        if (m.omitted.length) warn('cropMarksNoRoom', 'info', { sheet: si + 1, sides: m.omitted.join(',') });
        if (m.dropped) warn('marksLeftOut', 'info', { sheet: si + 1, count: m.dropped });
        ops.push(...markOp(m.segments, translate(0, 0), 'crop'));
      }
      plan.pages.push({ ...pageBase, label: String(si + 1), kind: lay.mode, ops });
      return;
    }

    // tiled
    const all = tilesOf(S, lay);
    const regPoints = out.marks === 'registration' ? registrationPoints(S, lay) : [];
    const pages: Page[] = [];
    // decide every tile first, so label arrows only point to neighbours that are printed (finding 19)
    const fate = all.map((t) => (excluded.has(tileKey(si, t.label)) ? 'excluded' : out.skipBlank && !objs.some(({ copies }) => copies.some((c) => hits(c, t.visible))) ? 'blank' : 'printed'));
    const printedAt = (r: number, c: number) => r >= 0 && c >= 0 && r < lay.rows && c < lay.cols && fate[r * lay.cols + c] === 'printed';
    for (const [ti, t] of all.entries()) {
      const key = tileKey(si, t.label);
      if (fate[ti] === 'excluded') {
        stats.excluded.push(t.label);
        continue;
      }
      if (fate[ti] === 'blank') {
        stats.skippedBlank.push(t.label);
        continue;
      }
      stats.printedTiles.push(t.label);
      const T = translate(safe.x - t.region.x, safe.y - t.region.y);
      const clip: Rect = { x: safe.x, y: safe.y, w: t.visible.w, h: t.visible.h };
      const ops: Op[] = objectOps(T, clip, t.visible);
      pushAll(ops, markOp(sheetMarks, T, 'trim', clip));
      const markRects: Rect[] = [];
      if (out.marks === 'registration') {
        for (const q of regPoints) {
          const e = REGISTRATION_EXTENT_MM;
          if (q.x + e <= t.visible.x || q.x - e >= t.visible.x + t.visible.w || q.y + e <= t.visible.y || q.y - e >= t.visible.y + t.visible.h) continue;
          markRects.push({ x: q.x + T[4] - e, y: q.y + T[5] - e, w: 2 * e, h: 2 * e });
          const mk = registrationMark(q.x + T[4], q.y + T[5]);
          ops.push({ op: 'path', role: 'registration', clip, ...mk });
        }
        const trim = path();
        const hw = TILE_TRIM_STROKE_MM / 2;
        if (t.col > 0) trim.segment(safe.x + hw, safe.y, safe.x + hw, safe.y + t.visible.h);
        if (t.row > 0) trim.segment(safe.x, safe.y + hw, safe.x + t.visible.w, safe.y + hw);
        if (!trim.empty) ops.push({ op: 'path', role: 'tileTrim', clip, d: trim.toString(), stroke: MARK_GREY, fill: null, widthMm: TILE_TRIM_STROKE_MM });
      }
      const printedLabel = multiSheet ? key : t.label;
      if (out.pageLabels) {
        // P3.5 finding 8: the first place along the visible content's edges (top-left first) where the label box stays
        // clear of this tile's registration marks; marks are in sheet coordinates and must not move
        const size = labelBoxSize(printedLabel, Math.min(1, (safe.w - 3) / labelBoxSize(printedLabel).w));
        const x0 = safe.x + 1.5;
        const y0 = safe.y + 1.5;
        const x1 = Math.max(x0, safe.x + t.visible.w - 1.5 - size.w);
        const y1 = Math.max(y0, safe.y + t.visible.h - 1.5 - size.h);
        // candidates: the top-left corner, then along the top edge, the bottom edge, the left and the right edge
        const along = (a: number, b: number) => Array.from({ length: Math.floor((b - a) / 0.5) + 1 }, (_, i) => a + i * 0.5).concat(b);
        const candidates: Point[] = [
          ...along(x0, x1).map((x) => ({ x, y: y0 })),
          ...along(x0, x1).map((x) => ({ x, y: y1 })),
          ...along(y0, y1).map((y) => ({ x: x0, y })),
          ...along(y0, y1).map((y) => ({ x: x1, y })),
        ];
        const free = (c: Point) => markRects.every((r) => !rectsIntersect({ x: c.x - LABEL_CLEARANCE_MM, y: c.y - LABEL_CLEARANCE_MM, w: size.w + 2 * LABEL_CLEARANCE_MM, h: size.h + 2 * LABEL_CLEARANCE_MM }, r));
        const at = (markRects.length ? candidates.find(free) : undefined) ?? candidates[0];
        const box = labelBox(at.x, at.y, printedLabel, { left: printedAt(t.row, t.col - 1), right: printedAt(t.row, t.col + 1), up: printedAt(t.row - 1, t.col), down: printedAt(t.row + 1, t.col) }, safe.w - 3);
        ops.push(...pathOps(box, 'label'), ...textOps(box, 'label'));
      }
      pages.push({ ...pageBase, label: printedLabel, kind: 'tile', tile: { row: t.row, col: t.col, label: t.label, key }, ops });
    }
    const wantMap = out.assemblyMap === 'on' || (out.assemblyMap === 'auto' && pages.length >= 4);
    if (wantMap && pages.length > 0) {
      stats.map = true;
      plan.pages.push(mapPage(S, lay, stats, ctx, pageBase, multiSheet ? `${si + 1}:` : '', (M, clip) => objectOps(M, clip, sheetRect)));
    }
    pushAll(plan.pages, pages);
  });

  if (warnings.some((w) => w.level === 'error' && ['sheetTooLarge'].includes(w.code))) {
    plan.pages = [];
    return plan;
  }
  if (plan.pages.length > MAX_PAGES) {
    warn('tooManyPages', 'error', { pages: plan.pages.length, max: MAX_PAGES });
    plan.pages = [];
    return plan;
  }
  const draws = plan.pages.reduce((n, p) => n + p.ops.filter((op) => op.op === 'object').length, 0);
  if (draws > MAX_OBJECT_DRAWS) {
    warn('tooManyCopies', 'error', { copies: draws, max: MAX_OBJECT_DRAWS });
    plan.pages = [];
    return plan;
  }
  if (plan.pages.length > CONFIRM_PAGES) warn('manyPages', 'warn', { pages: plan.pages.length });
  const turned = plan.pages.filter((p) => p.rotation).length;
  if (turned) warn('pagesTurned', 'info', { pages: turned });
  if (plan.pages.length === 0) {
    warn('nothingToPrint', 'error');
    return plan;
  }

  // job kind and correction (D18, D44) — decided before the check bar: an enlarging correction on Android forces it (D83)
  plan.jobKind = plan.pages.length === 1 || out.oneByOne ? 'single' : 'multi';
  const kind = input.correctionJobKind ?? plan.jobKind;
  const picked = input.applyCorrection === false ? null : pickCorrection(input.corrections ?? [], out.paperKey, kind);
  const c = picked && !isIdentityCorrection(picked) ? picked : null;
  const enlarging = c !== null && (c.fx > 1 || c.fy > 1);
  const fitRule = input.marginRule === 'fit';

  // check bar (D43, D83, D84): maps first, then pages in order, one per job; every page when each page is its own job
  // (Android one by one). Page-filling patterns give way to it. Off → said as a warning: nothing proves the size.
  const forceBar = !out.checkBar && fitRule && enlarging;
  if (out.checkBar || forceBar) {
    const everyPage = !!out.oneByOne && plan.pages.length > 1;
    const order = everyPage ? [...plan.pages.keys()] : mapsFirst(plan.pages);
    let placedOn = -1;
    let roomMade = 0;
    const missing: number[] = [];
    for (const i of order) {
      const how = placeCheckBar(plan.pages[i], plan.content);
      if (!how) {
        if (everyPage) missing.push(i + 1);
        continue;
      }
      if (how === 'roomMade') roomMade++;
      if (placedOn < 0) placedOn = i;
      if (!everyPage) break;
    }
    if (placedOn < 0) warn('checkBarOmitted', 'warn');
    else if (missing.length) warn('checkBarMissing', 'warn', { pages: listPages(missing), n: missing.length });
    else if (!everyPage && placedOn !== 0) warn('checkBarNotOnFirstPage', 'info', { page: placedOn + 1 });
    if (roomMade) warn('checkBarRoomMade', 'info', { pages: roomMade });
    if (forceBar && placedOn >= 0) warn('checkBarForced', 'warn');
  } else warn('checkBarOff', 'warn');

  // what the importer could not print exactly (SPEC §9.3, D24, D56, D84): a warning here and a note on the paper
  for (const a of input.assets ?? []) {
    const drawnOn = plan.pages.map((p) => p.ops.filter((op) => op.op === 'object' && op.source?.assetId === a.id) as ObjectOp[]);
    if (!drawnOn.some((ops) => ops.length)) continue;
    const pageNotes = a.gaps?.pageNotes ?? [];
    const pdfNotes = [...new Set(drawnOn.flat().map((op) => op.source?.pageIndex ?? 0))].reduce((n, pi) => n + (pageNotes[pi] ?? 0), 0);
    const parts = (a.gaps?.notDrawn ?? 0) + (a.gaps?.approximated ?? 0) + pdfNotes;
    if (!parts) continue;
    const name = shortName(a.name || ctx.t('note.unnamed'));
    warn('assetIncomplete', 'warn', { name, notDrawn: a.gaps?.notDrawn ?? 0, approximated: a.gaps?.approximated ?? 0, notes: pdfNotes });
    const text = ctx.t('note.assetGaps', { name, n: parts });
    let noted = false;
    for (const i of mapsFirst(plan.pages)) {
      if (!drawnOn[i].length && plan.pages[i].kind !== 'map') continue;
      if (placeNote(plan.pages[i], plan.content, text)) {
        noted = true;
        break;
      }
    }
    if (!noted) warn('assetNoteNoRoom', 'info', { name });
  }

  if (c) {
    plan.correction = c;
    warn('correctionApplied', 'info', { fx: c.fx, fy: c.fy, paper: out.paperKey, jobKind: kind });
    if (enlarging && fitRule && kind === 'single') warn('correctionEnlarges', 'warn', { fx: c.fx, fy: c.fy });
    const pm = input.printerMargins ?? out.margins;
    let off = 0;
    let margin = 0;
    plan.pages.forEach((page, i) => {
      // pages are portrait paper (D53), so the measured x/y bars map straight onto page x/y — no swap any more
      page.correction = correctionMatrix({ w: page.widthMm, h: page.heightMm }, { fx: c.fx, fy: c.fy });
      const ink = pageInk(page, plan.content);
      if (!ink) return;
      const corrected = mapRect(page.correction, ink);
      const printable = { x: pm.l, y: pm.t, w: page.widthMm - pm.l - pm.r, h: page.heightMm - pm.t - pm.b };
      if (!rectContains({ x: 0, y: 0, w: page.widthMm, h: page.heightMm }, corrected, ASSERT_EPS)) off = off || i + 1;
      else if (!rectContains(printable, corrected, ASSERT_EPS)) margin = margin || i + 1;
    });
    if (off) warn('correctionOffPage', 'warn', { page: off });
    // on Android ink in the printer's strip makes the print service shrink the page (D12): a warning, not a note (D83)
    if (margin) warn('correctionIntoMargin', fitRule ? 'warn' : 'info', { page: margin });
  }

  assertNothingInMargins(plan);
  return plan;
}

const mapsFirst = (pages: Page[]) => [...pages.keys()].sort((a, b) => Number(pages[b].kind === 'map') - Number(pages[a].kind === 'map') || a - b);
const listPages = (ps: number[]) => (ps.length > 8 ? `${ps.slice(0, 8).join(', ')}, …` : ps.join(', '));
const shortName = (n: string) => (n.length > 32 ? `${n.slice(0, 31)}…` : n);
/** Page-filling generators: they give way to the check bar when nothing else leaves room (D84). */
const PATTERN_KINDS: readonly string[] = ['grid', 'dots', 'lines'];
const isPatternOp = (op: Op) => op.op === 'object' && PATTERN_KINDS.includes(op.kind) && !op.source;

/**
 * Puts the check bar on a page: in a free strip of the safe area (D43); else, when page-filling patterns are what fills
 * it, the patterns stop short of an 11 mm strip and the bar goes there (D84). Null when there is no room.
 */
function placeCheckBar(page: Page, content: Record<number, Content>): 'free' | 'roomMade' | null {
  const footprints = (ops: Op[]) => ops.map((op) => opFootprint(op, content)).filter((r): r is Rect => r !== null);
  let at = findCheckBarPlace(page.safe, footprints(page.ops));
  if (at) {
    page.ops.push({ op: 'checkBar', ...at });
    return 'free';
  }
  const others = page.ops.filter((op) => !isPatternOp(op));
  if (others.length === page.ops.length) return null;
  at = findCheckBarPlace(page.safe, footprints(others));
  if (!at) return null;
  const bar = inflate(checkBarFootprint(at.x, at.y, at.vertical), CHECK_BAR_CLEARANCE_MM);
  const kept: Op[] = [];
  for (const op of page.ops) {
    if (op.op === 'object' && isPatternOp(op)) {
      const clip = rectAwayFrom(op.clip, bar);
      if (clip) kept.push({ ...op, clip });
    } else kept.push(op);
  }
  page.ops = kept;
  page.ops.push({ op: 'checkBar', ...at });
  return 'roomMade';
}

/** NOTE_MM text in a free horizontal strip of the safe area, never in the margin strips (D12). */
const NOTE_MM = 2.2;
function placeNote(page: Page, content: Record<number, Content>, text: string): boolean {
  let line = text;
  while (line.length > 1 && textWidthMm(line, NOTE_MM) > page.safe.w - 2) line = line.slice(0, -1);
  const w = textWidthMm(line, NOTE_MM);
  const fp: Rect = { x: 0, y: -0.718 * NOTE_MM - 0.3, w: w + 0.3, h: (0.718 + 0.207) * NOTE_MM + 0.6 };
  const obstacles = page.ops.map((op) => opFootprint(op, content)).filter((r): r is Rect => r !== null);
  const at = findStripPlace(page.safe, obstacles, fp, false);
  if (!at) return false;
  page.ops.push({ op: 'text', role: 'note', x: at.x, y: at.y, sizeMm: NOTE_MM, text: line, colour: MARK_GREY });
  return true;
}

/**
 * D12 invariant: every op's ink (before the correction) lies inside its page's safe area. D53 contract: every page is
 * the plan's paper in portrait, turned frames only by the quarter turn. Throws otherwise.
 */
export function assertNothingInMargins(plan: Pick<PrintPlan, 'pages' | 'content'> & { paperKey?: PaperKey }): void {
  plan.pages.forEach((page, i) => {
    if (plan.paperKey) {
      const p = paperSize(plan.paperKey, 'portrait');
      if (page.widthMm !== p.w || page.heightMm !== p.h) throw new Error(`Plan error: page ${i + 1} is ${page.widthMm} × ${page.heightMm} mm, not the portrait paper (D53)`);
      const want = page.orientation === 'landscape' ? landscapeToPortrait(p) : null;
      if (JSON.stringify(page.rotation) !== JSON.stringify(want)) throw new Error(`Plan error: page ${i + 1} frame rotation does not match its orientation (D53)`);
    }
    for (const op of page.ops) {
      const r = opFootprint(op, plan.content);
      if (r && !rectContains(page.safe, r, ASSERT_EPS)) {
        throw new Error(`Plan error: ${op.op}${'role' in op ? `/${op.role}` : ''} on page ${i + 1} reaches into the margin (${JSON.stringify(r)})`);
      }
    }
  });
}

// ------------------------------------------------------------------------------------------------ assembly map
const MAP_CHECKBAR_RESERVE_MM = CHECK_BAR_FOOTPRINT.h + 4;

function mapPage(
  S: { w: number; h: number },
  lay: SheetLayout,
  stats: SheetStats,
  ctx: GenContext,
  base: Omit<Page, 'label' | 'kind' | 'ops'>,
  prefix: string,
  objectOps: (M: Affine, clip: Rect) => ObjectOp[]
): Page {
  const safe = lay.content;
  const ops: Op[] = [];
  const fmt = (v: number) => printLength(v, ctx);
  const sizeLine = ctx.t('print.mapSize', { w: fmt(S.w), h: fmt(S.h), pages: stats.printedTiles.length, overlap: fmt(lay.overlap) });
  const texts: TextItem[] = [];
  let y = safe.y;
  const how = [ctx.t('print.mapHow'), ctx.t('print.mapSkipped'), ...(lay.orientation === 'landscape' ? [ctx.t('print.mapTurned')] : [])].join(' ');
  for (const [text, size0, lead] of [
    [ctx.t('print.mapTitle'), 4, 5],
    [sizeLine, 3, 4],
    [how, 2.6, 3.4],
  ] as const) {
    for (const t of fitLines(text, size0, safe.w)) {
      y += lead * (t.size / size0);
      texts.push(textAt(t.line, safe.x, y, t.size));
    }
    y += 1;
  }
  ops.push(...texts.map((t) => ({ op: 'text' as const, role: 'map' as const, ...t })));
  const top = y + 3;
  const area: Rect = { x: safe.x + 0.5, y: top, w: safe.w - 1, h: safe.y + safe.h - MAP_CHECKBAR_RESERVE_MM - top };
  if (area.h <= 10) return { ...base, label: 'map', kind: 'map', ops };
  const k = Math.min(area.w / S.w, area.h / S.h);
  const ox = area.x + (area.w - S.w * k) / 2;
  const oy = area.y + (area.h - S.h * k) / 2;
  const M = chain(translate(ox, oy), scale(k));
  const sheetOnMap: Rect = { x: ox, y: oy, w: S.w * k, h: S.h * k };
  const { x: sx, y: sy } = lay.step;
  const cell = (r: number, c: number): Rect => {
    const x0 = c * sx;
    const y0 = r * sy;
    const x1 = c === lay.cols - 1 ? S.w : (c + 1) * sx;
    const y1 = r === lay.rows - 1 ? S.h : (r + 1) * sy;
    return { x: ox + x0 * k, y: oy + y0 * k, w: (x1 - x0) * k, h: (y1 - y0) * k };
  };
  const grey = path();
  const outlines = path();
  const labels: TextItem[] = [];
  const skipped = new Set([...stats.skippedBlank, ...stats.excluded]);
  for (let r = 0; r < lay.rows; r++) {
    for (let c = 0; c < lay.cols; c++) {
      const box = cell(r, c);
      const label = `${prefix}${tileLabel(r, c)}`;
      if (skipped.has(tileLabel(r, c))) grey.rect(box.x, box.y, box.w, box.h);
      outlines.rect(box.x, box.y, box.w, box.h);
      const sz = Math.min(4, box.h / 3, box.w / Math.max(2, label.length));
      if (sz >= 1) labels.push(textAt(label, box.x + box.w / 2, box.y + box.h / 2 + sz * 0.36, sz, 'centre', undefined, MARK_GREY));
    }
  }
  if (!grey.empty) ops.push({ op: 'path', role: 'map', d: grey.toString(), stroke: null, fill: FAINT_GREY, widthMm: 0 });
  pushAll(ops, objectOps(M, sheetOnMap));
  ops.push({ op: 'path', role: 'map', d: outlines.toString(), stroke: MARK_GREY, fill: null, widthMm: 0.2, clip: inflate(sheetOnMap, 0.1) });
  ops.push({ op: 'path', role: 'map', d: transformPath(path().rect(0, 0, S.w, S.h).toString(), M), stroke: [0, 0, 0], fill: null, widthMm: 0.3, clip: inflate(sheetOnMap, 0.15) });
  ops.push(...labels.map((t) => ({ op: 'text' as const, role: 'map' as const, ...t })));
  return { ...base, label: 'map', kind: 'map', ops };
}

/** Wrapped lines that fit `maxW`; a word longer than the width shrinks that line's font instead of overflowing. */
function fitLines(text: string, size: number, maxW: number): { line: string; size: number }[] {
  return wrapText(text, size, maxW).map((line) => {
    const w = textWidthMm(line, size);
    return { line, size: w > maxW ? (size * maxW) / w : size };
  });
}

const inflate = (r: Rect, d: number): Rect => ({ x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d });

// ------------------------------------------------------------------------------------------------ calibration job
/**
 * Calibration job (D18, D12): one page (single-page route) or the optional two-page multi-page check (Android).
 * With `corrections` and `applyCorrection`, prints the corrected sheet ("after" check, SPEC §16 / A8).
 */
export function planCalibration(input: {
  paperKey: PaperKey;
  margins: Margins;
  pages: 1 | 2;
  ctx: GenContext;
  corrections?: readonly StoredCorrection[];
  applyCorrection?: boolean;
}): PrintPlan & { sheet: CalibrationSheet } {
  const warnings: Warning[] = [];
  const pages: Page[] = [];
  let sheet: CalibrationSheet | null = null;
  for (let n = 1; n <= input.pages; n++) {
    const s = calibrationSheet(input.paperKey, input.margins, input.ctx, n, input.pages);
    sheet = sheet ?? s;
    pages.push({
      widthMm: s.page.w,
      heightMm: s.page.h,
      orientation: 'portrait',
      label: `${n}`,
      kind: 'calibration',
      sheetIndex: null,
      safe: s.safe,
      ops: [...pathOps(s.content, 'calibration'), ...textOps(s.content, 'calibration')],
      rotation: null,
      correction: null,
    });
  }
  const jobKind: JobKind = input.pages === 1 ? 'single' : 'multi';
  const c = input.applyCorrection ? pickCorrection(input.corrections ?? [], input.paperKey, jobKind) : null;
  if (c && !isIdentityCorrection(c)) {
    for (const p of pages) p.correction = correctionMatrix({ w: p.widthMm, h: p.heightMm }, c);
    warnings.push({ code: 'correctionApplied', level: 'info', params: { fx: c.fx, fy: c.fy, paper: input.paperKey, jobKind } });
  }
  const plan = { pages, warnings, content: {}, sheets: [], jobKind, correction: c && !isIdentityCorrection(c) ? c : null, paperKey: input.paperKey, sheet: sheet as CalibrationSheet };
  assertNothingInMargins(plan);
  return plan;
}
