// Snapping (D21). Pure — no React/Expo imports.
// Threshold = 8 screen points converted to mm at the current zoom; candidates are sheet edges/centre lines,
// safe-area edges, other objects' edges/centres and grid lines; the nearest wins (ties: the earlier kind in
// KIND_ORDER); numeric fields never snap (callers simply do not call this for typed values).
import type { Margins } from './paper';
import type { Rect } from './geometry';

export type SnapKind = 'sheet' | 'safe' | 'object' | 'grid';
export type SnapLine = { at: number; kind: SnapKind };
export type SnapCandidates = { x: SnapLine[]; y: SnapLine[] };
export type SnapGuide = { axis: 'x' | 'y'; at: number; kind: SnapKind };
export type SnapResult = { dx: number; dy: number; guides: SnapGuide[] };

export const SNAP_THRESHOLD_PT = 8;
const KIND_ORDER: Record<SnapKind, number> = { sheet: 0, safe: 1, object: 2, grid: 3 };

/** 8 screen points in mm at a zoom of `pointsPerMm` screen points per millimetre. */
export function snapThresholdMm(pointsPerMm: number): number {
  return SNAP_THRESHOLD_PT / pointsPerMm;
}

/** Grid spacing presets: 1 mm, 5 mm, ⅛ in. */
export const GRID_SPACINGS_MM = { mm1: 1, mm5: 5, in8: 25.4 / 8 } as const;

export function snapCandidates(input: {
  sheet: { w: number; h: number };
  margins?: Margins;
  others?: Rect[];
}): SnapCandidates {
  const { sheet, margins, others = [] } = input;
  const x: SnapLine[] = [0, sheet.w / 2, sheet.w].map((at) => ({ at, kind: 'sheet' as const }));
  const y: SnapLine[] = [0, sheet.h / 2, sheet.h].map((at) => ({ at, kind: 'sheet' as const }));
  if (margins) {
    x.push({ at: margins.l, kind: 'safe' }, { at: sheet.w - margins.r, kind: 'safe' });
    y.push({ at: margins.t, kind: 'safe' }, { at: sheet.h - margins.b, kind: 'safe' });
  }
  for (const r of others) {
    for (const at of [r.x, r.x + r.w / 2, r.x + r.w]) x.push({ at, kind: 'object' });
    for (const at of [r.y, r.y + r.h / 2, r.y + r.h]) y.push({ at, kind: 'object' });
  }
  return { x, y };
}

type Best = { delta: number; line: SnapLine } | null;

function better(a: Best, delta: number, line: SnapLine): boolean {
  if (!a) return true;
  const d = Math.abs(delta) - Math.abs(a.delta);
  if (Math.abs(d) > 1e-9) return d < 0;
  return KIND_ORDER[line.kind] < KIND_ORDER[a.line.kind];
}

/** Nearest snap of any of `values` (e.g. left/centre/right of a box) to the lines or the grid, within threshold. */
export function snapAxis(values: number[], lines: SnapLine[], thresholdMm: number, gridMm?: number): Best {
  let best: Best = null;
  for (const v of values) {
    for (const line of lines) {
      const delta = line.at - v;
      if (Math.abs(delta) <= thresholdMm && better(best, delta, line)) best = { delta, line };
    }
    if (gridMm && gridMm > 0) {
      const at = Math.round(v / gridMm) * gridMm;
      const delta = at - v;
      const line: SnapLine = { at, kind: 'grid' };
      if (Math.abs(delta) <= thresholdMm && better(best, delta, line)) best = { delta, line };
    }
  }
  return best;
}

/**
 * Snaps a moving rectangle (the dragged object's rotated bounds): its left/centre/right to x lines and
 * top/middle/bottom to y lines. Returns the correction to add to the drag position and the guides to draw.
 */
export function snapRect(rect: Rect, candidates: SnapCandidates, thresholdMm: number, gridMm?: number): SnapResult {
  const bx = snapAxis([rect.x, rect.x + rect.w / 2, rect.x + rect.w], candidates.x, thresholdMm, gridMm);
  const by = snapAxis([rect.y, rect.y + rect.h / 2, rect.y + rect.h], candidates.y, thresholdMm, gridMm);
  const guides: SnapGuide[] = [];
  if (bx) guides.push({ axis: 'x', at: bx.line.at, kind: bx.line.kind });
  if (by) guides.push({ axis: 'y', at: by.line.at, kind: by.line.kind });
  return { dx: bx?.delta ?? 0, dy: by?.delta ?? 0, guides };
}

/** Snaps one edge value (resize handles). */
export function snapValue(value: number, lines: SnapLine[], thresholdMm: number, gridMm?: number): { value: number; guide: SnapLine | null } {
  const b = snapAxis([value], lines, thresholdMm, gridMm);
  return b ? { value: value + b.delta, guide: b.line } : { value, guide: null };
}
