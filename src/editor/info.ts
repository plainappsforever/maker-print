// What the inspector shows about an object (SPEC §8.2, §8.4, §9.2): natural size, scale %, PPI line. Pure.
import type { Asset } from '@/db/assets';
import type { SheetObject } from '@/db/objects';
import { contentMap, isAtDesignedSize, NO_CROP, visibleSize } from '@/engine/geometry';
import { effectivePpi, ppiBand, type PpiBand } from '@/engine/ppi';
import { planAssetOf } from '@/import/assets';

export const ASSET_OBJECT_KINDS = ['image', 'pdf_page', 'svg'] as const;
export const isAssetObject = (o: Pick<SheetObject, 'kind'>) => (ASSET_OBJECT_KINDS as readonly string[]).includes(o.kind);
/** Kinds whose size means something physical (vector files): they show Scale % and a badge when not at 100 %. */
export const isVectorAsset = (o: Pick<SheetObject, 'kind'>) => o.kind === 'pdf_page' || o.kind === 'svg';

/** Natural size of an asset object's source: image px, PDF page / SVG mm; null when unknown (units question open). */
export function naturalOf(o: Pick<SheetObject, 'kind' | 'pageIndex'>, asset: Asset | undefined | null): { w: number; h: number } | null {
  if (!asset) return null;
  const pa = planAssetOf(asset);
  if (o.kind === 'image') return pa.pxW && pa.pxH ? { w: pa.pxW, h: pa.pxH } : null;
  if (o.kind === 'pdf_page') return pa.pageSizesMm?.[o.pageIndex] ?? null;
  if (o.kind === 'svg') return pa.naturalMm ?? null;
  return null;
}

/** Scale of a vector file object in % (x, y), and whether it is at its designed size (± 0.0001). */
export function scaleOf(o: Pick<SheetObject, 'w' | 'h' | 'crop' | 'fit'>, natural: { w: number; h: number }): { x: number; y: number; designed: boolean } {
  const map = contentMap({ w: o.w, h: o.h }, visibleSize(natural.w, natural.h, o.crop ?? NO_CROP), o.fit);
  return { x: map.scaleX * 100, y: map.scaleY * 100, designed: isAtDesignedSize(map) };
}

/** Effective PPI of an image object and its band (SPEC §8.4). */
export function ppiOf(o: Pick<SheetObject, 'w' | 'h' | 'crop' | 'fit'>, px: { w: number; h: number }, target: number): { ppi: number; band: PpiBand } {
  const r = effectivePpi(px, { w: o.w, h: o.h }, o.crop, o.fit);
  return { ppi: r.ppi, band: ppiBand(r.ppi, target) };
}
