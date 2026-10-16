// The native half of V15 phase A (camera, scan, open-in, Android display names) behind typed interfaces. Phase A1
// (device-free) defines them and tests the flows against Node fakes (`test/fakes/capture.ts`); phase A2 implements
// them (expo-image-picker camera, the local module's warp/detector/name lookup, document types and intent filters).
// Types only: no Expo imports here.
import type { Quad } from '@/engine/homography';

/**
 * A file the app was handed (same shape as the pickers' result in src/lib/import.ts).
 * `focal35mm` — the adapter contract for the scan's lens (review S7): every photo source that can carry EXIF fills it
 * from the picker, because the file the app ends up reading may have lost it.
 * - Library (`pickPhoto`, A2's scan picker): `launchImageLibraryAsync({ exif: true, … })` → `focalFromPickerExif(asset.exif)`.
 *   iOS hands over the original representation (expo-image-picker's default `preferredAssetRepresentationMode` is
 *   `current` in 57.0.20), so an iPhone photo arrives as HEIC: `prepareImport` converts it to a JPEG WITHOUT EXIF
 *   (ImageManipulator), so the focal length must pass through here (HEIC passthrough), not from the bytes.
 * - Camera (A2): `launchCameraAsync({ exif: true, … })` → the same; on iOS from the capture's media metadata.
 * - Open-in / share-in / document picker: no picker EXIF → null; a JPEG's own bytes still give it (`readFocal35mm`).
 * `startScan` uses the bytes' EXIF first, then this. Verified on a phone in A2 (one camera and one library photo).
 */
export type PickedFile = { uri: string; name: string; mimeType?: string | null; size?: number | null; focal35mm?: number | null };

export type CameraResult =
  | { ok: true; file: PickedFile }
  /** cancelled: the user closed the camera; denied: no camera permission (iOS: Settings → Maker Print → Camera);
   *  unavailable: no camera (simulator, some tablets); failed: anything else */
  | { ok: false; reason: 'cancelled' | 'denied' | 'unavailable' | 'failed' };

/** A2: expo-image-picker `launchCameraAsync` with `exif: true` → `file.focal35mm` (see `PickedFile`; the permission is
 *  asked at the first tap, never at launch). */
export interface CameraCapture {
  takePhoto(): Promise<CameraResult>;
}

export type WarpRequest = {
  sourceUri: string;
  /** Corners in DISPLAYED source pixels (EXIF orientation applied first), y down, TL, TR, BR, BL */
  quad: Quad;
  /** Displayed source size, so the native side can check it decoded the same picture */
  sourcePx: { w: number; h: number };
  /** Exact output size: the quad maps onto [0, outW] × [0, outH] */
  outW: number;
  outH: number;
  /** JPEG quality 0–1 */
  quality: number;
};
export type WarpResult = { uri: string; widthPx: number; heightPx: number };

/**
 * A2 (custom native): iOS CoreImage (`CIPerspectiveCorrection` with `toCoreImagePoints`, then scaled to outW × outH,
 * or `CIPerspectiveTransform` with the plan's matrix); Android `Matrix.setPolyToPoly` with `polyToPolyArrays` and a
 * Bitmap of outW × outH. Writes a JPEG (orientation 1) to the cache.
 */
export interface PerspectiveWarper {
  warp(req: WarpRequest): Promise<WarpResult>;
}

/** A2: iOS Vision document/rectangle detection (on-device; convert with `fromVisionNormalised`); Android: none (null). */
export interface CornerDetector {
  detect(uri: string, sourcePx: { w: number; h: number }): Promise<Quad | null>;
}

/** A2 (X08): Android `ContentResolver` `OpenableColumns.DISPLAY_NAME`; iOS returns null (the file name is real). */
export interface DisplayNameResolver {
  displayName(uri: string): Promise<string | null>;
}

/** A2: files shared INTO the app (Android `ACTION_SEND`/`SEND_MULTIPLE` streams; the optional iOS share extension). */
export interface IncomingShares {
  take(): Promise<PickedFile[]>;
}

/** Bytes of a file the flows read (src/lib/files.ts `readFileBytes` on a device, a Map in tests). */
export type ReadBytes = (uri: string) => Promise<Uint8Array>;
