// Graph paper, dot grid and lined paper (D45). Lines at k × spacing from the box's top-left. Pure.
import { path, type Content, type PathItem, type Rgb, type TextItem } from '../path';
import { bool, colour, labelNumber, num, textAt, type GenContext, type Props } from './context';

const EPS = 1e-9;
const GRID_INK: Rgb = [0.55, 0.7, 0.85];

/** Positions k × s for 0 ≤ k × s ≤ side (within 1e-9 mm). */
export function gridPositions(side: number, s: number): number[] {
  const n = Math.floor(side / s + EPS);
  return Array.from({ length: n + 1 }, (_, k) => k * s);
}

export type GridParams = { spacingMm: number; boldEvery: number; lineMm: number; boldLineMm: number; numbered: boolean };
export function gridParams(p: Props): GridParams {
  return {
    spacingMm: num(p.spacingMm, 5, 0.5, 200),
    boldEvery: Math.round(num(p.boldEvery, 2, 0, 100)),
    lineMm: num(p.lineMm, 0.1, 0.02, 2),
    boldLineMm: num(p.boldLineMm, 0.3, 0.02, 3),
    numbered: bool(p.numbered, false),
  };
}

export function gridContent(w: number, h: number, props: Props, ctx: GenContext): Content {
  const g = gridParams(props);
  const ink = colour(props.colour, GRID_INK);
  const thin = path();
  const bold = path();
  const isBold = (k: number) => g.boldEvery > 1 && k % g.boldEvery === 0;
  const texts: TextItem[] = [];
  gridPositions(w, g.spacingMm).forEach((x, k) => (isBold(k) ? bold : thin).segment(x, 0, x, h));
  gridPositions(h, g.spacingMm).forEach((y, k) => (isBold(k) ? bold : thin).segment(0, y, w, y));
  if (g.numbered) {
    const size = Math.min(2.2, g.spacingMm * g.boldEvery * 0.4);
    gridPositions(w, g.spacingMm).forEach((x, k) => {
      if (isBold(k) && k > 0) texts.push(textAt(labelNumber(x, ctx.locale), x + 0.4, size + 0.4, size, 'left', [0, w], ink));
    });
    gridPositions(h, g.spacingMm).forEach((y, k) => {
      if (isBold(k) && k > 0) texts.push(textAt(labelNumber(y, ctx.locale), 0.4, y - 0.4, size, 'left', [0, w], ink));
    });
  }
  const paths: PathItem[] = [];
  if (!thin.empty) paths.push({ d: thin.toString(), stroke: ink, fill: null, widthMm: g.lineMm });
  if (!bold.empty) paths.push({ d: bold.toString(), stroke: ink, fill: null, widthMm: g.boldLineMm });
  return { paths, texts };
}

/** Dots at (i·s, j·s), drawn as zero-length round-capped lines (one tiny operator each). */
export function dotsContent(w: number, h: number, props: Props): Content {
  const s = num(props.spacingMm, 5, 1, 200);
  const dot = num(props.dotMm, 0.5, 0.1, 5);
  const ink = colour(props.colour, [0.45, 0.45, 0.45]);
  const b = path();
  for (const y of gridPositions(h, s)) for (const x of gridPositions(w, s)) b.segment(x, y, x, y);
  return { paths: b.empty ? [] : [{ d: b.toString(), stroke: ink, fill: null, widthMm: dot, cap: 'round' }], texts: [] };
}

/** Lined paper: horizontal lines at y = k·s for k ≥ 1; optional vertical margin line. */
export function linedPositions(h: number, s: number): number[] {
  return gridPositions(h, s).slice(1);
}

export function linesContent(w: number, h: number, props: Props): Content {
  const s = num(props.spacingMm, 8, 2, 100);
  const margin = num(props.marginMm, 0, 0, w);
  const ink = colour(props.colour, GRID_INK);
  const b = path();
  for (const y of linedPositions(h, s)) b.segment(0, y, w, y);
  const paths: PathItem[] = b.empty ? [] : [{ d: b.toString(), stroke: ink, fill: null, widthMm: num(props.lineMm, 0.15, 0.02, 2) }];
  if (margin > 0 && margin < w) paths.push({ d: path().segment(margin, 0, margin, h).toString(), stroke: [0.85, 0.4, 0.4], fill: null, widthMm: 0.2 });
  return { paths, texts: [] };
}

