// Scan flow (V15 F22, phase A1): photo → start corners → plan → native warp → an importable image that carries its
// real size. Every native step is an injected interface (./api.ts), so the whole chain runs in Jest against Node
// fakes; phase A2 supplies the real camera, detector and warper and the corner screen. No Expo imports.
import { orderCorners, type Pt, type Quad } from '@/engine/homography';
import { defaultQuad, planScan, scanRecord, type KnownSize, type ScanError, type ScanPlan } from '@/engine/scan';
import { inspectAsset, type InspectError, type Inspected } from '@/import/assets';
import { readFocal35mm, readImageMeta, type ImageMetaError } from '@/import/image-meta';

import type { CornerDetector, PerspectiveWarper, ReadBytes } from './api';

/** `focal35mm`: the picker's EXIF value (`PickedFile.focal35mm`; HEIC passthrough, review S7) */
export type ScanSource = { uri: string; name: string; focal35mm?: number | null };
export type ScanStart = {
  sourcePx: { w: number; h: number };
  focal35mm: number | null;
  /** Start corners: the detector's when it found a plausible document, else 10 % in from the sides */
  quad: Quad;
  detected: boolean;
};

/**
 * Reads the photo's header (displayed size, EXIF focal length) and asks the detector, if any, for corners. The focal
 * length: the file's own EXIF (a JPEG straight from the camera or Files), else the picker's (`src.focal35mm`: a HEIC
 * converted to JPEG has lost its EXIF), else null.
 */
export async function startScan(deps: { readBytes: ReadBytes; detector?: CornerDetector | null }, src: ScanSource): Promise<{ ok: true; start: ScanStart } | { ok: false; error: ImageMetaError }> {
  const bytes = await deps.readBytes(src.uri);
  const meta = readImageMeta(bytes);
  if (!meta.ok) return { ok: false, error: meta.error };
  const sourcePx = { w: meta.meta.pxW, h: meta.meta.pxH };
  let quad: Quad | null = null;
  try {
    quad = deps.detector ? await deps.detector.detect(src.uri, sourcePx) : null;
  } catch {
    quad = null; // detection is a convenience: a failure means manual corners, never an error
  }
  // a detection is only used when it would pass the planner's sanity rules
  const usable = quad && planScan({ corners: quad, sourcePx, known: { kind: 'none' }, ppiTarget: 300 }).ok ? orderCorners(quad) : null;
  return { ok: true, start: { sourcePx, focal35mm: readFocal35mm(bytes) ?? src.focal35mm ?? null, quad: usable ?? defaultQuad(sourcePx), detected: !!usable } };
}

export type ScanFlowError = ScanError | InspectError | 'warpFailed';
export type ScannedImage = {
  kind: 'image';
  name: string;
  bytes: Uint8Array;
  /** Report with `sizeMm` = the scan's size and `scan` = the record (src/import/assets.ts) */
  inspected: Inspected;
  plan: ScanPlan;
};

/** Native output may differ from the request by rounding; more than this is a failed warp. */
const WARP_SIZE_TOLERANCE_PX = 2;

/**
 * Plans, warps and inspects. The size in mm comes from the plan (typed or estimated), never from the JPEG's density
 * field (whole dpi only), so the placed object has exactly the size the user gave.
 */
export async function finishScan(
  deps: { readBytes: ReadBytes; warper: PerspectiveWarper },
  input: { source: ScanSource; sourcePx: { w: number; h: number }; corners: readonly Pt[]; known: KnownSize; ppiTarget: number; focal35mm?: number | null; outName: string; quality?: number }
): Promise<{ ok: true; image: ScannedImage } | { ok: false; error: ScanFlowError }> {
  const r = planScan({ corners: input.corners, sourcePx: input.sourcePx, known: input.known, ppiTarget: input.ppiTarget, focal35mm: input.focal35mm });
  if (!r.ok) return r;
  const plan = r.plan;
  let out;
  try {
    out = await deps.warper.warp({ sourceUri: input.source.uri, quad: plan.quad, sourcePx: plan.sourcePx, outW: plan.outPx.w, outH: plan.outPx.h, quality: input.quality ?? 0.92 });
  } catch {
    return { ok: false, error: 'warpFailed' };
  }
  if (Math.abs(out.widthPx - plan.outPx.w) > WARP_SIZE_TOLERANCE_PX || Math.abs(out.heightPx - plan.outPx.h) > WARP_SIZE_TOLERANCE_PX) return { ok: false, error: 'warpFailed' };
  const bytes = await deps.readBytes(out.uri);
  const insp = await inspectAsset('image', bytes);
  if (!insp.ok) return insp;
  const rep = insp.asset.report;
  if (rep.kind !== 'image' || insp.asset.pxW === null || insp.asset.pxH === null) return { ok: false, error: 'warpFailed' };
  // the file must be the picture that was asked for (a rotated or swapped result would print at the wrong shape)
  if (Math.abs(insp.asset.pxW - plan.outPx.w) > WARP_SIZE_TOLERANCE_PX || Math.abs(insp.asset.pxH - plan.outPx.h) > WARP_SIZE_TOLERANCE_PX) return { ok: false, error: 'warpFailed' };
  const inspected: Inspected = { ...insp.asset, report: { ...rep, sizeMm: plan.sizeMm, scan: scanRecord(plan, input.known) } };
  return { ok: true, image: { kind: 'image', name: input.outName, bytes, inspected, plan } };
}
