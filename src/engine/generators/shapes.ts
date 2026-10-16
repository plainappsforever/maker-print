// Text, rectangle, ellipse, line and test square content in the object's local box (D45). Pure.
import { path, type Content } from '../path';
import { ASCENT_EM, sanitiseText, textWidthMm } from '../text-metrics';
import { ptToMm } from '../units';
import { colour, num, oneOf, printLength, textAt, type GenContext, type Props } from './context';

/** Text box: lines split at "\n", size in pt (props), line height 1.2 em, first baseline at the ascender. */
export function textContent(w: number, _h: number, props: Props): Content & { unsupported: string[] } {
  const raw = typeof props.text === 'string' ? props.text : '';
  const { text, unsupported } = sanitiseText(raw);
  const size = ptToMm(num(props.fontSizePt, 12, 1, 500));
  const align = oneOf(props.align, ['left', 'centre', 'right'] as const, 'left');
  const ink = colour(props.colour);
  const texts = text.split('\n').map((line, i) => {
    const x = align === 'left' ? 0 : align === 'centre' ? w / 2 : w;
    return textAt(line, x, ASCENT_EM * size + i * 1.2 * size, size, align, undefined, ink);
  });
  return { paths: [], texts: texts.filter((t) => t.text !== ''), unsupported };
}

/** Strokes are centred on the exact outline (half inside, half outside), as in every vector editor (D45). */
function strokeOf(props: Props) {
  const width = num(props.strokeMm, 0.3, 0, 20);
  const stroke = props.stroke === null || width === 0 ? null : colour(props.stroke);
  const fill = props.fill === undefined || props.fill === null ? null : colour(props.fill);
  return { width, stroke, fill };
}

export function rectContent(w: number, h: number, props: Props): Content {
  const s = strokeOf(props);
  return { paths: [{ d: path().rect(0, 0, w, h).toString(), stroke: s.stroke, fill: s.fill, widthMm: s.width }], texts: [] };
}

export function ellipseContent(w: number, h: number, props: Props): Content {
  const s = strokeOf(props);
  return { paths: [{ d: path().ellipse(w / 2, h / 2, w / 2, h / 2).toString(), stroke: s.stroke, fill: s.fill, widthMm: s.width }], texts: [] };
}

/** A line is the box's horizontal centre line from x = 0 to x = w; rotate the object to angle it (D45). */
export function lineContent(w: number, h: number, props: Props): Content {
  const s = strokeOf(props);
  return { paths: [{ d: path().segment(0, h / 2, w, h / 2).toString(), stroke: s.stroke ?? colour(undefined), fill: null, widthMm: s.width || 0.3 }], texts: [] };
}

/** Test square (sewing-pattern style): exact outline of the box, centre cross, its size printed inside. */
export function testSquareContent(w: number, h: number, props: Props, ctx: GenContext): Content {
  const ink = colour(props.colour);
  const label = ctx.t('gen.testSquare', { w: printLength(w, ctx, false), h: printLength(h, ctx, false), unit: ctx.unit });
  const size = Math.min(3, h / 6);
  const texts = textWidthMm(label, size) <= w - 2 ? [textAt(label, w / 2, h / 2 + size + 2, size, 'centre', undefined, ink)] : [];
  const a = Math.min(w, h) / 10;
  return {
    paths: [
      { d: path().rect(0, 0, w, h).toString(), stroke: ink, fill: null, widthMm: 0.2 },
      { d: path().segment(w / 2 - a, h / 2, w / 2 + a, h / 2).segment(w / 2, h / 2 - a, w / 2, h / 2 + a).toString(), stroke: ink, fill: null, widthMm: 0.15 },
    ],
    texts,
  };
}
