// Align (SPEC §9.2: left/centre/right/top/middle/bottom to the sheet or the safe area). Pure.
// Alignment uses each object's rotated bounds (what you see), so a rotated object lines up by its visible edge.
import { rotatedBounds, type Placement, type Rect } from './geometry';

export type AlignMode = 'left' | 'centre' | 'right' | 'top' | 'middle' | 'bottom';

/** New box position (x, y of the unrotated box) that aligns the object's visible bounds to `target`. */
export function alignTo(p: Pick<Placement, 'x' | 'y' | 'w' | 'h' | 'rotationDeg'>, mode: AlignMode, target: Rect): { x: number; y: number } {
  const b = rotatedBounds(p);
  let dx = 0;
  let dy = 0;
  if (mode === 'left') dx = target.x - b.x;
  else if (mode === 'centre') dx = target.x + target.w / 2 - (b.x + b.w / 2);
  else if (mode === 'right') dx = target.x + target.w - (b.x + b.w);
  else if (mode === 'top') dy = target.y - b.y;
  else if (mode === 'middle') dy = target.y + target.h / 2 - (b.y + b.h / 2);
  else dy = target.y + target.h - (b.y + b.h);
  return { x: p.x + dx, y: p.y + dy };
}
