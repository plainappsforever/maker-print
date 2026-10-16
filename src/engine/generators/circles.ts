// Circle template (D45): hole/drill templates — a row layout of circles with centre crosses and labels. Pure.
import { path, type Content, type TextItem } from '../path';
import { bool, colour, num, printLength, textAt, type GenContext, type Props } from './context';

export const CIRCLE_LABEL_MM = 5;
const EPS = 1e-9;

export type CircleParams = { diametersMm: number[]; gapMm: number; labels: boolean; cross: boolean };
export function circleParams(p: Props): CircleParams {
  const ds = Array.isArray(p.diametersMm) ? p.diametersMm.filter((d): d is number => typeof d === 'number' && Number.isFinite(d) && d > 0 && d <= 3000) : [];
  return {
    diametersMm: ds.length ? ds.slice(0, 200) : [5, 10, 20, 30, 40, 50],
    gapMm: num(p.gapMm, 5, 0, 100),
    labels: bool(p.labels, true),
    cross: bool(p.cross, true),
  };
}

/** Left to right with gap g; a circle that would cross the right edge starts a new row (unless it is first). */
export function circleLayout(width: number, c: CircleParams): { centres: { x: number; y: number; d: number }[]; height: number } {
  const lab = c.labels ? CIRCLE_LABEL_MM : 0;
  let x = 0;
  let y = 0;
  let rowH = 0;
  const centres = [];
  for (const d of c.diametersMm) {
    if (x > 0 && x + d > width + EPS) {
      y += rowH + c.gapMm;
      x = 0;
      rowH = 0;
    }
    centres.push({ x: x + d / 2, y: y + d / 2, d });
    x += d + c.gapMm;
    rowH = Math.max(rowH, d + lab);
  }
  return { centres, height: y + rowH };
}

export function circlesContent(w: number, _h: number, props: Props, ctx: GenContext): Content {
  const c = circleParams(props);
  const ink = colour(props.colour);
  const circles = path();
  const crosses = path();
  const texts: TextItem[] = [];
  for (const { x, y, d } of circleLayout(w, c).centres) {
    circles.ellipse(x, y, d / 2, d / 2);
    if (c.cross) {
      const a = Math.min(d / 2, 4);
      crosses.segment(x - a, y, x + a, y).segment(x, y - a, x, y + a);
    }
    if (c.labels) {
      const label = `Ø ${printLength(d, ctx)}`;
      texts.push(textAt(label, x, y + d / 2 + 3.6, 2.6, 'centre', undefined, ink));
    }
  }
  const paths = [{ d: circles.toString(), stroke: ink, fill: null, widthMm: 0.2 }];
  if (!crosses.empty) paths.push({ d: crosses.toString(), stroke: ink, fill: null, widthMm: 0.15 });
  return { paths, texts };
}
