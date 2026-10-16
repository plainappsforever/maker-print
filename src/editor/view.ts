// Canvas view transform (SPEC §9.2): screen point = mm × scale + (tx, ty). Pure.
import type { Point } from '@/engine/geometry';

export type View = { scale: number; tx: number; ty: number };
export const MIN_POINTS_PER_MM = 0.02;
export const MAX_POINTS_PER_MM = 40;

/** The whole sheet centred in the viewport with `pad` points around it. */
export function fitView(sheet: { w: number; h: number }, viewport: { w: number; h: number }, pad = 16): View {
  const scale = clampScale(Math.min((viewport.w - 2 * pad) / sheet.w, (viewport.h - 2 * pad) / sheet.h));
  return { scale, tx: (viewport.w - sheet.w * scale) / 2, ty: (viewport.h - sheet.h * scale) / 2 };
}

export const clampScale = (s: number) => Math.min(MAX_POINTS_PER_MM, Math.max(MIN_POINTS_PER_MM, Number.isFinite(s) && s > 0 ? s : 1));

export const toMm = (v: View, p: Point): Point => ({ x: (p.x - v.tx) / v.scale, y: (p.y - v.ty) / v.scale });
export const toScreen = (v: View, p: Point): Point => ({ x: p.x * v.scale + v.tx, y: p.y * v.scale + v.ty });

/** Zoom by `factor` keeping the sheet point under `focal` (screen) where it is. */
export function zoomAbout(v: View, factor: number, focal: Point): View {
  const scale = clampScale(v.scale * factor);
  const k = scale / v.scale;
  return { scale, tx: focal.x - (focal.x - v.tx) * k, ty: focal.y - (focal.y - v.ty) * k };
}

export const panBy = (v: View, dx: number, dy: number): View => ({ ...v, tx: v.tx + dx, ty: v.ty + dy });
