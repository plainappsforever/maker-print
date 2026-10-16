// Ruler generator (D45): ticks along the top edge of the box, exact positions k × step. Pure.
import { path, type Content, type TextItem } from '../path';
import { MM_PER_IN } from '../units';
import { colour, oneOf, textAt, type GenContext, type Props } from './context';

export type RulerUnit = 'mm' | 'cm' | 'in';
export type TickLevel = 'major' | 'half' | 'quarter' | 'eighth' | 'minor';
export type Tick = { x: number; level: TickLevel; label?: number };

export const RULER_TICK_MM: Record<TickLevel, number> = { major: 6, half: 4.5, quarter: 3.5, eighth: 2.5, minor: 1.8 };
const METRIC_TICK_MM: Record<TickLevel, number> = { major: 6, half: 4, quarter: 0, eighth: 0, minor: 2.5 };
const EPS = 1e-9;

export const rulerUnit = (props: Props): RulerUnit => oneOf(props.unit, ['mm', 'cm', 'in'] as const, 'mm');

/**
 * Ticks for a ruler of `length` mm: metric every 1 mm (half every 5, major every 10, labelled in mm or cm);
 * inch every 1/16 in (eighth, quarter, half, major every inch, labelled in inches). Position = k × step exactly.
 */
export function rulerTicks(length: number, unit: RulerUnit): Tick[] {
  const step = unit === 'in' ? MM_PER_IN / 16 : 1;
  const n = Math.floor(length / step + EPS);
  const ticks: Tick[] = [];
  for (let k = 0; k <= n; k++) {
    const x = k * step;
    if (unit === 'in') {
      const level: TickLevel = k % 16 === 0 ? 'major' : k % 8 === 0 ? 'half' : k % 4 === 0 ? 'quarter' : k % 2 === 0 ? 'eighth' : 'minor';
      ticks.push(level === 'major' ? { x, level, label: k / 16 } : { x, level });
    } else {
      const level: TickLevel = k % 10 === 0 ? 'major' : k % 5 === 0 ? 'half' : 'minor';
      ticks.push(level === 'major' ? { x, level, label: unit === 'cm' ? k / 10 : k } : { x, level });
    }
  }
  return ticks;
}

export function rulerContent(w: number, h: number, props: Props, ctx: GenContext): Content {
  const unit = rulerUnit(props);
  const ink = colour(props.colour);
  const lens = unit === 'in' ? RULER_TICK_MM : METRIC_TICK_MM;
  const scale = Math.min(1, h / 12); // short rulers get shorter ticks
  const b = path();
  const texts: TextItem[] = [];
  const labelMm = Math.min(2.8, h / 4);
  for (const t of rulerTicks(w, unit)) {
    b.segment(t.x, 0, t.x, lens[t.level] * scale);
    if (t.label !== undefined && h >= 8) texts.push(textAt(String(t.label), t.x, lens.major * scale + labelMm + 0.8, labelMm, 'centre', [0.3, w - 0.3], ink));
  }
  if (h >= 8) texts.push(textAt(unit, 1, h - 1.2, labelMm, 'left', undefined, ink));
  return {
    paths: [
      { d: path().rect(0, 0, w, h).toString(), stroke: ink, fill: null, widthMm: 0.2 },
      { d: b.toString(), stroke: ink, fill: null, widthMm: 0.15 },
    ],
    texts,
  };
}
