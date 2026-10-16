// Content of every vector object kind in its local box [0,w]×[0,h] (D45). Generators are always drawn at their own
// size: resizing a ruler or grid regenerates it (more ticks/lines), it never stretches — so they are always 100 %.
import type { Content } from '../path';
import { circlesContent } from './circles';
import type { GenContext, Props } from './context';
import { dotsContent, gridContent, linesContent } from './grid';
import { rulerContent } from './ruler';
import { ellipseContent, lineContent, rectContent, testSquareContent, textContent } from './shapes';

export const VECTOR_KINDS = ['text', 'rect', 'ellipse', 'line', 'ruler', 'grid', 'dots', 'lines', 'circles', 'test_square'] as const;
export type VectorKind = (typeof VECTOR_KINDS)[number];
export const isVectorKind = (k: string): k is VectorKind => (VECTOR_KINDS as readonly string[]).includes(k);

export function objectContent(kind: VectorKind, w: number, h: number, props: Props, ctx: GenContext): Content & { unsupported: string[] } {
  switch (kind) {
    case 'text':
      return textContent(w, h, props);
    case 'rect':
      return { ...rectContent(w, h, props), unsupported: [] };
    case 'ellipse':
      return { ...ellipseContent(w, h, props), unsupported: [] };
    case 'line':
      return { ...lineContent(w, h, props), unsupported: [] };
    case 'ruler':
      return { ...rulerContent(w, h, props, ctx), unsupported: [] };
    case 'grid':
      return { ...gridContent(w, h, props, ctx), unsupported: [] };
    case 'dots':
      return { ...dotsContent(w, h, props), unsupported: [] };
    case 'lines':
      return { ...linesContent(w, h, props), unsupported: [] };
    case 'circles':
      return { ...circlesContent(w, h, props, ctx), unsupported: [] };
    case 'test_square':
      return { ...testSquareContent(w, h, props, ctx), unsupported: [] };
  }
}

export type { GenContext, Translate } from './context';
