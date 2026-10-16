// Editor previews (V1_PLAN P5 fallback made the default, D30, D68): the canvas never decodes a 12 MP original. Images
// get a ≤ 2048 px upright copy, SVGs and PDF pages a ≤ 2048 px PNG rasterised from OUR output path (the SVG goes
// through the same normaliser + PDF writer as the print, so the preview shows what prints — unsupported parts
// included as missing). Output (PDF export / print) always uses the original file.
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import native from '../../modules/maker-print-native';
import type { Page, PrintPlan } from '@/engine/plan';
import { createAssetPainter } from '@/pdf/assets';
import { writePdf } from '@/pdf/writer';

import { copyToDocument, documentFileExists, documentUri, previewRel, writeOutputPdf } from './files';

export const PREVIEW_MAX_PX = 2048;

/** Images larger than the preview size or not upright (EXIF) get an upright ≤ 2048 px copy; returns its relative path. */
export async function makeImagePreview(rel: string, meta: { pxW: number; pxH: number; orientation: number; format: 'jpeg' | 'png' }): Promise<string | null> {
  if (Math.max(meta.pxW, meta.pxH) <= PREVIEW_MAX_PX && meta.orientation === 1) return null;
  const k = Math.min(1, PREVIEW_MAX_PX / Math.max(meta.pxW, meta.pxH));
  const ctx = ImageManipulator.manipulate(documentUri(rel));
  if (k < 1) ctx.resize(meta.pxW >= meta.pxH ? { width: Math.round(meta.pxW * k) } : { height: Math.round(meta.pxH * k) });
  const ref = await ctx.renderAsync();
  const png = meta.format === 'png';
  const out = await ref.saveAsync({ format: png ? SaveFormat.PNG : SaveFormat.JPEG, compress: 0.9 });
  const to = previewRel(rel, png ? 'png' : 'jpg');
  await copyToDocument(out.uri, to);
  return to;
}

/** Relative path of the preview of PDF page `pageIndex` (or of an SVG: page 0). */
export const pagePreviewRel = (rel: string, pageIndex: number) => `${rel}.p${pageIndex}.png`;

/** PDF page → PNG through the native rasteriser (D30), stored next to the asset; null without the module. */
export async function makePdfPagePreview(rel: string, pageIndex: number): Promise<string | null> {
  const to = pagePreviewRel(rel, pageIndex);
  if (documentFileExists(to)) return to;
  if (!native) return null;
  const r = await native.renderPdfPage(documentUri(rel), pageIndex, PREVIEW_MAX_PX);
  await copyToDocument(r.uri, to);
  return to;
}

/** SVG → one-page PDF of its natural size (our writer) → PNG. */
export async function makeSvgPreview(rel: string, text: string, natural: { w: number; h: number }, languages: readonly string[]): Promise<string | null> {
  if (!native) return null;
  const page: Page = {
    widthMm: natural.w,
    heightMm: natural.h,
    orientation: 'portrait',
    label: '',
    kind: 'single',
    sheetIndex: 0,
    safe: { x: 0, y: 0, w: natural.w, h: natural.h },
    rotation: null,
    correction: null,
    ops: [
      {
        op: 'object',
        objectId: 1,
        kind: 'svg',
        copy: { col: 0, row: 0 },
        transform: [1, 0, 0, 1, 0, 0],
        clip: { x: 0, y: 0, w: natural.w, h: natural.h },
        box: natural,
        source: { assetId: 1, pageIndex: 0, natural, map: [1, 0, 0, 1, 0, 0] },
      },
    ],
  };
  const plan: Pick<PrintPlan, 'pages' | 'content'> = { pages: [page], content: {} };
  const painter = createAssetPainter(async () => ({ kind: 'svg', text }), { languages });
  const written = await writePdf(plan, { title: 'preview', checkBarCaption: '', paintAsset: painter });
  const pdf = writeOutputPdf('svg-preview.pdf', written.bytes);
  const r = await native.renderPdfPage(pdf, 0, PREVIEW_MAX_PX);
  const to = pagePreviewRel(rel, 0);
  await copyToDocument(r.uri, to);
  return to;
}
