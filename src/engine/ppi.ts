// Effective image resolution (SPEC §8.4, W2). Pure.
import { contentMap, NO_CROP, visibleSize, type Crop, type FitMode } from './geometry';
import { MM_PER_IN } from './units';

export type PpiBand = 'sharp' | 'fine' | 'soft' | 'blocky';
export const PPI_TARGETS = [150, 300, 600] as const;

/**
 * ppi_x = px_w(1−l−r) / (content width in inches), likewise y; effective = min. The content size is the box for
 * `fill` (SPEC §8.4 exactly) and the uniformly scaled visible source for `fit` (D34).
 */
export function effectivePpi(
  px: { w: number; h: number },
  box: { w: number; h: number },
  crop: Crop | null = NO_CROP,
  fit: FitMode = 'fill'
): { x: number; y: number; ppi: number } {
  const map = contentMap(box, visibleSize(px.w, px.h, crop ?? NO_CROP), fit); // mm per source px
  const x = MM_PER_IN / map.scaleX;
  const y = MM_PER_IN / map.scaleY;
  return { x, y, ppi: Math.min(x, y) };
}

/** Bands (SPEC §8.4): ≥ target "Sharp"; ≥ 150 "Fine for templates, soft for photos"; ≥ 72 "Will look soft"; else "blocky". */
export function ppiBand(ppi: number, target: number = 300): PpiBand {
  if (ppi >= target) return 'sharp';
  if (ppi >= 150) return 'fine';
  if (ppi >= 72) return 'soft';
  return 'blocky';
}
