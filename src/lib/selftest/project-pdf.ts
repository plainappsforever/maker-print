// Referee fixture project → plan → PDF bytes, exactly as scripts/referee/run.mjs builds them (same defaults, same
// writer options). Pure (no Expo/React): the self-test runs it on Hermes, scripts/fixtures/make-selftest-bundle.mjs runs
// it in Node to record the expected hashes, so a matching hash proves Hermes wrote the very bytes CoreGraphics measured.
import { decodePDFRawStream, PDFDocument, PDFRawStream } from '@cantoo/pdf-lib';

import { planCalibration, planPrint, type PlanObject, type PrintPlan } from '../../engine/plan';
import { uniformMargins } from '../../engine/paper';
import type { GenContext } from '../../engine/generators';
import { printTranslator } from '../../i18n';
import { decodeSvgText, inspectAsset, planAssetOf, type AssetKind } from '../../import/assets';
import { createAssetPainter, type AssetSource } from '../../pdf/assets';
import { writePdf } from '../../pdf/writer';

export type FixtureProject = {
  name: string;
  kind?: string;
  calibration?: { paperKey: string; pages?: number };
  sheets?: unknown[];
  objects?: Record<string, unknown>[];
  assets?: { id: number; kind: AssetKind; file: string; svgPxPerIn?: number }[];
  output?: Record<string, unknown>;
  corrections?: unknown[];
  applyCorrection?: boolean;
  printerMargins?: unknown;
  marginRule?: 'clip' | 'fit';
};

export const REFEREE_CTX: GenContext = { locale: 'en', unit: 'mm', inchStyle: 'fraction16', t: printTranslator('en') };
const OUTPUT_DEFAULTS = {
  paperKey: 'a4',
  orientation: 'auto',
  margins: uniformMargins(6.35),
  overlapMm: 10,
  marks: 'registration',
  pageLabels: true,
  assemblyMap: 'auto',
  skipBlank: true,
  excludedTiles: [],
  checkBar: false,
  ppiTarget: 300,
};
const OBJECT_DEFAULTS = { z: 0, assetId: null, pageIndex: 0, rotationDeg: 0, mirrorX: false, mirrorY: false, crop: null, fit: 'fill', repeat: null, props: {}, hidden: false };

/** files: fixture-relative path ("images/x.png") → bytes */
export async function fixtureProjectPdf(f: FixtureProject, files: (path: string) => Uint8Array): Promise<{ plan: PrintPlan; bytes: Uint8Array; notes: number }> {
  const output = { ...OUTPUT_DEFAULTS, ...(f.output ?? {}) } as Record<string, unknown>;
  if (typeof output.margins === 'number') output.margins = uniformMargins(output.margins);
  const sources = new Map<number, AssetSource>();
  const planAssets = [];
  for (const a of f.assets ?? []) {
    const bytes = files(a.file);
    if (a.kind === 'svg') {
      const d = decodeSvgText(bytes);
      if (!d.ok) throw new Error(`${a.file}: ${d.error}`);
      sources.set(a.id, { kind: 'svg', text: d.text });
    } else sources.set(a.id, { kind: a.kind, bytes });
    const r = await inspectAsset(a.kind, bytes);
    if (!r.ok) throw new Error(`${a.file}: ${r.error}`);
    planAssets.push(planAssetOf({ id: a.id, kind: a.kind, pxW: r.asset.pxW, pxH: r.asset.pxH, svgPxPerIn: a.svgPxPerIn ?? null, report: r.asset.report }));
  }
  // fixture JSON is validated by the referee, not here
  const plan: PrintPlan =
    f.kind === 'calibration'
      ? planCalibration({ paperKey: f.calibration!.paperKey as any, margins: output.margins as any, pages: (f.calibration!.pages ?? 1) as 1 | 2, ctx: REFEREE_CTX, corrections: f.corrections as any, applyCorrection: f.applyCorrection })
      : planPrint({
          sheets: f.sheets as any,
          objects: (f.objects ?? []).map((o) => ({ ...OBJECT_DEFAULTS, ...o }) as unknown as PlanObject),
          assets: planAssets,
          output: output as any,
          corrections: f.corrections as any,
          applyCorrection: f.applyCorrection,
          printerMargins: f.printerMargins as any,
          marginRule: f.marginRule,
          ctx: REFEREE_CTX,
        });
  const painter = createAssetPainter(async (id) => sources.get(id) ?? null);
  const written = await writePdf(plan, { title: f.name, checkBarCaption: 'This bar must measure 100 mm', paintAsset: painter });
  return { plan, bytes: written.bytes, notes: written.notes.length };
}

/** Two independent 32-bit hashes (FNV-1a and djb2-xor) + length: equality of output bytes, not security. */
export function hashBytes(b: Uint8Array): string {
  let f = 0x811c9dc5;
  let d = 5381;
  for (let i = 0; i < b.length; i++) {
    f = Math.imul(f ^ b[i], 0x01000193) >>> 0;
    d = (Math.imul(d, 33) ^ b[i]) >>> 0;
  }
  return `${b.length}:${f.toString(16).padStart(8, '0')}${d.toString(16).padStart(8, '0')}`;
}

/**
 * Geometry fingerprint of a PDF: every indirect object in reference order, streams decoded, every number rounded to
 * 1e-6 (pt) — then hashed. Hermes' libm differs from V8's in the last bit of some sin/cos/pow results (P4: e.g.
 * 12.145649469518654 vs …656 pt, 2e-15 pt), which changes the compressed bytes but not the drawing; this hash ignores
 * such noise and nothing else (any difference ≥ 1e-6 pt, any changed operator, text or image byte changes it).
 */
export async function geometryHash(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const objs = doc.context.enumerateIndirectObjects().sort((a, b) => a[0].objectNumber - b[0].objectNumber);
  const parts: string[] = [];
  for (const [ref, obj] of objs) {
    let text: string;
    if (obj instanceof PDFRawStream) {
      const type = obj.dict.toString();
      // containers whose bytes depend on compressed lengths, not on the drawing
      if (type.includes('/ObjStm') || type.includes('/XRef')) continue;
      let data: Uint8Array;
      try {
        data = decodePDFRawStream(obj).decode();
      } catch {
        data = obj.contents; // DCTDecode (JPEG) and other image filters: compare the encoded bytes
      }
      let s = '';
      for (let i = 0; i < data.length; i++) s += String.fromCharCode(data[i]);
      text = `${obj.dict.toString()} stream ${s}`;
    } else text = obj.toString();
    parts.push(`${ref.objectNumber} ${text.replace(/\/Length \d+/g, '').replace(/-?\d*\.\d+/g, (n) => String(Math.round(Number(n) * 1e6) / 1e6))}`);
  }
  return hashBytes(new TextEncoder().encode(parts.join('\n')));
}

export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
