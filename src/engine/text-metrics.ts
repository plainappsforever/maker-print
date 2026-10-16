// Helvetica metrics for the text the engine lays out (labels, ruler numbers, captions). Pure.
// Widths are the standard Helvetica AFM widths (1/1000 em) as shipped in @cantoo/pdf-lib's standard-fonts, for the
// characters WinAnsiEncoding can show; text.test.ts checks them against pdf-lib. Any other character would be
// printed as "?" by pdf-lib without notice, so `sanitiseText` replaces it explicitly and reports it (L26).
import { ptToMm } from './units';

const ASCII = // U+0020 … U+007E
  '278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584';
const LATIN1 = // U+00A0 … U+00FF
  '278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333,400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500';
/** WinAnsi 0x80–0x9F as Unicode code points (smart quotes, dashes, €, …). */
const EXTRA: [number, number][] = [
  [0x20ac, 556], [0x201a, 222], [0x192, 556], [0x201e, 333], [0x2026, 1000], [0x2020, 556], [0x2021, 556], [0x2c6, 333],
  [0x2030, 1000], [0x160, 667], [0x2039, 333], [0x152, 1000], [0x17d, 611], [0x2018, 222], [0x2019, 222], [0x201c, 333],
  [0x201d, 333], [0x2022, 350], [0x2013, 556], [0x2014, 1000], [0x2dc, 333], [0x2122, 1000], [0x161, 500], [0x203a, 333],
  [0x153, 944], [0x17e, 500], [0x178, 500],
];

const WIDTHS = new Map<number, number>();
ASCII.split(',').forEach((w, i) => WIDTHS.set(0x20 + i, Number(w)));
LATIN1.split(',').forEach((w, i) => WIDTHS.set(0xa0 + i, Number(w)));
for (const [cp, w] of EXTRA) WIDTHS.set(cp, w);

/** Helvetica ascender / descender (AFM), in em. */
export const ASCENT_EM = 0.718;
export const DESCENT_EM = 0.207;

export function isPrintableChar(ch: string): boolean {
  return WIDTHS.has(ch.codePointAt(0) ?? -1);
}

/** Replaces characters Helvetica/WinAnsi cannot print with "?" and lists them (once each). Newlines are kept. */
export function sanitiseText(text: string): { text: string; unsupported: string[] } {
  const bad = new Set<string>();
  let out = '';
  for (const ch of text) {
    if (ch === '\n' || isPrintableChar(ch)) out += ch;
    else if (ch === '\t') out += ' ';
    else {
      bad.add(ch);
      out += '?';
    }
  }
  return { text: out, unsupported: [...bad] };
}

/** Advance width of a single line in mm at a font size in mm. Unknown characters count as "?". */
export function textWidthMm(text: string, sizeMm: number): number {
  let em = 0;
  for (const ch of text) em += WIDTHS.get(ch.codePointAt(0) ?? -1) ?? 556;
  return (em / 1000) * sizeMm;
}

export const fontSizeMm = (pt: number) => ptToMm(pt);

/** Greedy word wrap of one paragraph to a width in mm (a word longer than the width gets its own line). */
export function wrapText(text: string, sizeMm: number, maxWidthMm: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && textWidthMm(next, sizeMm) > maxWidthMm) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}
