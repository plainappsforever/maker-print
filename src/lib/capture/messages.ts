// What the scan, camera and open-in codes say (EN/DE keys; the screens of phase A2 call these). Pure: the Record
// types make a new code without a message a type error.
import type { ScanPlan, ScanWarning } from '@/engine/scan';
import type { TranslationKey } from '@/i18n/en';
import type { InspectError } from '@/import/assets';
import type { IncomingRefusal } from '@/import/incoming';
import type { SvgzError } from '@/import/svgz';

import type { CameraResult } from './api';
import type { ScanFlowError } from './scan-flow';

/** The scan's own codes ('badLength' is the scan's typed size here, not an SVG's). */
const SCAN_KEYS: Record<Exclude<ScanFlowError, InspectError> | 'badLength', TranslationKey> = {
  notFinite: 'scan.error.notFinite',
  outside: 'scan.error.outside',
  degenerate: 'scan.error.degenerate',
  selfIntersecting: 'scan.error.selfIntersecting',
  mirrored: 'scan.error.mirrored',
  concave: 'scan.error.concave',
  tooSmall: 'scan.error.tooSmall',
  badLength: 'scan.error.badLength',
  noShape: 'scan.error.noShape',
  warpFailed: 'scan.error.warpFailed',
};
/** Inspect errors of the straightened picture are the import's own messages. */
const IMPORT_PASSTHROUGH: Record<Exclude<InspectError, 'badLength'>, TranslationKey> = {
  emptyFile: 'import.error.emptyFile',
  fileTooLarge: 'import.error.fileTooLarge',
  tooManyPixels: 'import.error.tooManyPixels',
  corrupt: 'import.error.corrupt',
  unsupportedFormat: 'import.error.unsupportedFormat',
  needsConversion: 'import.error.needsConversion',
  encrypted: 'import.error.encrypted',
  noPages: 'import.error.noPages',
  tooManyPages: 'import.error.tooManyPages',
  invalidXml: 'import.error.invalidXml',
  notSvg: 'import.error.notSvg',
  noSize: 'import.error.noSize',
  badViewBox: 'import.error.badViewBox',
  empty: 'import.error.empty',
  tooComplex: 'import.error.tooComplex',
  notText: 'import.error.notText',
  compressedSvg: 'import.error.compressedSvg',
};

export function scanErrorKey(e: ScanFlowError): TranslationKey {
  return e in SCAN_KEYS ? SCAN_KEYS[e as keyof typeof SCAN_KEYS] : IMPORT_PASSTHROUGH[e as keyof typeof IMPORT_PASSTHROUGH];
}

const WARNING_KEYS: Record<ScanWarning, TranslationKey> = {
  aspectEstimated: 'scan.warn.aspectEstimated',
  aspectWeak: 'scan.warn.aspectWeak',
  aspectMismatch: 'scan.warn.aspectMismatch',
  lowDetail: 'scan.warn.lowDetail',
};

/**
 * Each warning of a plan as a key with its numbers (pct: how far the typed shape is off; ppi: the far edge's detail;
 * min/max: the estimated side over every plausible lens, formatted by `fmt` — the screen passes `formatLength` with the
 * user's unit; whole millimetres by default). `aspectWeak` without a typed side (straighten only) says the shape's
 * own range in per cent instead (review M2: this photo's range, never a fixed "up to N %").
 */
export function scanWarningMessages(
  p: Pick<ScanPlan, 'warnings' | 'sizeMm' | 'aspect' | 'detailPpi'> & Partial<Pick<ScanPlan, 'estimatedRangeMm'>>,
  fmt: (mm: number) => string = (mm) => `${Math.round(mm)} mm`
): { key: TranslationKey; params: Record<string, number | string> }[] {
  return p.warnings.map((w): { key: TranslationKey; params: Record<string, number | string> } => {
    if (w === 'aspectMismatch' && p.sizeMm) return { key: WARNING_KEYS[w], params: { pct: Math.round(Math.abs(p.sizeMm.w / p.sizeMm.h / p.aspect.ratio - 1) * 100) } };
    if (w === 'lowDetail') return { key: WARNING_KEYS[w], params: { ppi: Math.round(p.detailPpi ?? 0) } };
    if (w === 'aspectWeak') {
      const r = p.estimatedRangeMm;
      if (r) return { key: 'scan.warn.aspectWeak', params: { min: fmt(r.min), max: fmt(r.max) } };
      const lr = p.aspect.lensRange;
      const pct = lr ? Math.max(lr.hi / p.aspect.ratio - 1, 1 - lr.lo / p.aspect.ratio) * 100 : null;
      return pct === null ? { key: 'scan.warn.aspectWeakUnknown', params: {} } : { key: 'scan.warn.aspectWeakShape', params: { pct: Math.max(1, Math.ceil(pct)) } };
    }
    return { key: WARNING_KEYS[w], params: {} };
  });
}

const FILE_KEYS: Record<IncomingRefusal | SvgzError, TranslationKey> = {
  dxfNotYet: 'import.error.dxfNotYet',
  archiveNotYet: 'import.error.archiveNotYet',
  unsupportedType: 'import.error.unsupportedType',
  compressedTooLarge: 'import.error.compressedTooLarge',
  compressedCorrupt: 'import.error.compressedCorrupt',
};
export const incomingErrorKey = (e: IncomingRefusal | SvgzError): TranslationKey => FILE_KEYS[e];

/** Camera outcomes that need a sentence (a cancel says nothing). */
export function cameraErrorKey(reason: Extract<CameraResult, { ok: false }>['reason'], platform: 'ios' | 'android'): TranslationKey | null {
  if (reason === 'cancelled') return null;
  if (reason === 'denied') return platform === 'ios' ? 'capture.denied.ios' : 'capture.denied.android';
  return reason === 'unavailable' ? 'capture.unavailable' : 'capture.failed';
}
