// Templates (SPEC §9.1 New → Template; U4, U5): a new project with one generator object. Pure.
import { circleLayout, circleParams } from '@/engine/generators/circles';
import { paperSize, safeArea, type Margins, type PaperKey } from '@/engine/paper';
import type { ObjectKind } from '@/db/objects';

import { sheetForImport, type SheetChoice } from './place';

export const TEMPLATE_KINDS = ['ruler', 'grid', 'dots', 'lines', 'circles', 'test_square'] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];
export const isTemplateKind = (v: unknown): v is TemplateKind => typeof v === 'string' && (TEMPLATE_KINDS as readonly string[]).includes(v);

/** Parameters the template modal edits (lengths in mm). */
export type TemplateParams = {
  paperKey: PaperKey;
  /** ruler length / test square side */
  lengthMm: number;
  /** ruler height / test square height */
  heightMm: number;
  rulerUnit: 'mm' | 'cm' | 'in';
  spacingMm: number;
  boldEvery: number;
  numbered: boolean;
  marginLine: boolean;
  diametersMm: number[];
};

export function defaultTemplateParams(kind: TemplateKind, paperKey: PaperKey, unit: 'mm' | 'cm' | 'in'): TemplateParams {
  const inch = unit === 'in';
  return {
    paperKey,
    lengthMm: kind === 'test_square' ? (inch ? 101.6 : 100) : inch ? 304.8 : 300,
    heightMm: kind === 'test_square' ? (inch ? 101.6 : 100) : 30,
    rulerUnit: inch ? 'in' : 'mm',
    spacingMm: kind === 'lines' ? (inch ? 25.4 * (11 / 32) : 8) : inch ? 25.4 / 4 : 5,
    boldEvery: inch ? 4 : 2,
    numbered: false,
    marginLine: kind === 'lines',
    diametersMm: inch ? [3.175, 6.35, 12.7, 19.05, 25.4, 38.1, 50.8] : [5, 10, 20, 30, 40, 50],
  };
}

export type TemplateProject = {
  sheet: SheetChoice;
  object: { kind: ObjectKind; x: number; y: number; w: number; h: number; props: Record<string, unknown>; lockAspect: boolean };
};

/**
 * Sheet + object for a template. Page-filling generators (graph, dots, lines, circles) cover the paper's safe area;
 * a ruler or test square gets the paper when it fits, else a big sheet of exactly its size (U5: 1 m ruler → 4 tiles).
 */
export function templateProject(kind: TemplateKind, p: TemplateParams, margins: Margins): TemplateProject {
  const paper = paperSize(p.paperKey);
  const safe = safeArea(paper, margins) ?? { x: 0, y: 0, w: paper.w, h: paper.h };
  const onPaper: SheetChoice = { widthMm: paper.w, heightMm: paper.h, paperKey: p.paperKey };
  switch (kind) {
    case 'ruler':
    case 'test_square': {
      const size = { w: p.lengthMm, h: p.heightMm };
      const placed = sheetForImport(size, p.paperKey, margins);
      const props = kind === 'ruler' ? { unit: p.rulerUnit } : {};
      return { sheet: placed.sheet, object: { kind, ...placed.box, props, lockAspect: false } };
    }
    case 'grid':
      return { sheet: onPaper, object: { kind, ...safe, props: { spacingMm: p.spacingMm, boldEvery: p.boldEvery, numbered: p.numbered }, lockAspect: false } };
    case 'dots':
      return { sheet: onPaper, object: { kind, ...safe, props: { spacingMm: p.spacingMm }, lockAspect: false } };
    case 'lines':
      return { sheet: onPaper, object: { kind, ...safe, props: { spacingMm: p.spacingMm, marginMm: p.marginLine ? Math.min(25, safe.w / 4) : 0 }, lockAspect: false } };
    case 'circles': {
      const props = { diametersMm: p.diametersMm, gapMm: 5, labels: true, cross: true };
      const h = Math.min(safe.h, Math.max(1, circleLayout(safe.w, circleParams(props)).height));
      return { sheet: onPaper, object: { kind, x: safe.x, y: safe.y, w: safe.w, h, props, lockAspect: false } };
    }
  }
}

/** Default box + props for an object added from the editor's Add menu (centred on the sheet). */
export function newObjectDefaults(kind: ObjectKind, sheet: { widthMm: number; heightMm: number }, safe: { x: number; y: number; w: number; h: number }, text: string): { w: number; h: number; props: Record<string, unknown>; fill?: boolean } {
  switch (kind) {
    case 'text':
      return { w: Math.min(80, safe.w), h: 12, props: { text, fontSizePt: 24, align: 'left' } };
    case 'rect':
    case 'ellipse':
      return { w: 50, h: 30, props: { strokeMm: 0.3 } };
    case 'line':
      return { w: 100, h: 4, props: { strokeMm: 0.3 } };
    case 'ruler':
      return { w: Math.min(150, safe.w), h: 30, props: { unit: 'mm' } };
    case 'grid':
    case 'dots':
    case 'lines':
      return { w: safe.w, h: safe.h, props: { spacingMm: kind === 'lines' ? 8 : 5 }, fill: true };
    case 'circles':
      return { w: safe.w, h: Math.min(safe.h, 70), props: {}, fill: true };
    case 'test_square':
      return { w: 100, h: 100, props: {} };
    default:
      return { w: Math.min(50, sheet.widthMm), h: Math.min(50, sheet.heightMm), props: {} };
  }
}
