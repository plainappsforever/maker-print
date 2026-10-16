// The "print exactly" path (V1_PLAN P4, D11, D12, D17, D53): engine plan → PDF bytes (our writer) → cache file →
// native exact route (maker-print-native) → on failure the expo-print fallback. Learned margins go to the profile.
import * as ExpoPrint from 'expo-print';
import { Platform } from 'react-native';

import native, { type NativePrintResult } from '../../modules/maker-print-native';
import { recordPrinter } from '@/db/profiles';
import type { Db } from '@/db/types';
import type { PaperKey } from '@/engine/paper';
import type { PrintPlan } from '@/engine/plan';
import { androidJobFacts, iosRendererPlacement, learnedMarginsMm, pageSizePt, printerDisplayName, snapPaperToPage } from '@/engine/route';
import { ptToMm } from '@/engine/units';
import { createAssetPainter, type AssetLoader } from '@/pdf/assets';
import { writePdf, type WriteNote } from '@/pdf/writer';

import { writeOutputPdf } from './files';

export type PrintRoute = 'exact' | 'fallback';
export type PrintOutcome = {
  route: PrintRoute;
  /** Why the exact route was not used (module missing, or its error) — shown as a banner (D11 fallback, L11) */
  fallbackReason?: string;
  completed: boolean;
  printerName: string | null;
  /** The print system's printer id (iOS printerID, Android PrinterId.localId); null for the fallback */
  printerId: string | null;
  paperMm: { w: number; h: number } | null;
  /** The paper the print system picked equals our portrait page (exact route only) */
  paperMatches: boolean | null;
  learnedMarginsMm: { l: number; t: number; r: number; b: number } | null;
  /** The profile's stored margins were updated (D17; typed margins are never overwritten) */
  marginsStored: boolean;
  /** The job went to another printer than the profile's own: its margins were left alone (D85) */
  otherPrinter: boolean;
  /** Name of the profile's own printer, for that line */
  profilePrinterName: string | null;
  /** The applied correction was measured on another printer (its name, or '' when it has none): it may be wrong (D85) */
  correctionOtherPrinter: string | null;
  /** Android: what the sourced Default Print Service rules predict (D12); iOS: renderer placement (D11) */
  expectExact: boolean | null;
  advice: string | null;
  raw: NativePrintResult | null;
};

export type PdfFile = { uri: string; bytes: number; notes: WriteNote[]; pageWidthPt: number; pageHeightPt: number; pages: number };

/** Writes a plan to cache/print/<fileName> with the app's own PDF writer (P3). */
export async function writePlanPdf(
  plan: PrintPlan,
  opts: { fileName: string; title: string; checkBarCaption: string; loadAsset?: AssetLoader; languages?: readonly string[] }
): Promise<PdfFile> {
  const written = await writePdf(plan, {
    title: opts.title,
    checkBarCaption: opts.checkBarCaption,
    paintAsset: opts.loadAsset ? createAssetPainter(opts.loadAsset, { languages: opts.languages }) : undefined,
  });
  const uri = writeOutputPdf(opts.fileName, written.bytes);
  const size = pageSizePt(plan.pages[0]);
  return { uri, bytes: written.bytes.length, notes: written.notes, pageWidthPt: size.w, pageHeightPt: size.h, pages: plan.pages.length };
}

/**
 * Opens the system print dialog for a written PDF. `forceFallback` (debug only) skips the exact route so both routes can
 * be measured. Never throws for a native failure: it falls back to expo-print and says why.
 */
export async function printPdfFile(
  file: PdfFile,
  opts: {
    jobName: string;
    plan?: PrintPlan;
    outputType?: 'general' | 'photo';
    db?: Db;
    profileId?: number | null;
    forceFallback?: boolean;
    paperKey?: PaperKey;
    /** The printer the applied correction was measured on (D85) */
    correctionFrom?: { printerId: string | null; printerName: string | null } | null;
  }
): Promise<PrintOutcome> {
  let fallbackReason: string | undefined = opts.forceFallback ? 'forced' : native ? undefined : 'module missing';
  if (native && !opts.forceFallback) {
    try {
      const r = await native.printPdf(file.uri, { jobName: opts.jobName, pageWidthPt: file.pageWidthPt, pageHeightPt: file.pageHeightPt, outputType: opts.outputType ?? 'general' });
      return await outcome('exact', r, file, opts);
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === 'E_BUSY') throw e;
      fallbackReason = String((e as Error)?.message ?? e);
    }
  }
  await ExpoPrint.printAsync({ uri: file.uri });
  return {
    route: 'fallback',
    fallbackReason,
    completed: true,
    printerName: null,
    printerId: null,
    paperMm: null,
    paperMatches: null,
    learnedMarginsMm: null,
    marginsStored: false,
    otherPrinter: false,
    profilePrinterName: null,
    correctionOtherPrinter: null,
    expectExact: null,
    advice: null,
    raw: null,
  };
}

type OutcomeOpts = { plan?: PrintPlan; db?: Db; profileId?: number | null; paperKey?: PaperKey; correctionFrom?: { printerId: string | null; printerName: string | null } | null };
async function outcome(route: PrintRoute, r: NativePrintResult, file: PdfFile, opts: OutcomeOpts): Promise<PrintOutcome> {
  const paperMm = r.paperWidthPt && r.paperHeightPt ? { w: ptToMm(r.paperWidthPt), h: ptToMm(r.paperHeightPt) } : null;
  // Android "Save as PDF" (the PrintSpooler's PDF printer) has no paper margins to learn
  const pdfPrinter = r.printerId === 'PDF printer';
  const margins = r.completed && !pdfPrinter ? learnedMarginsMm(r) : null;
  const printerName = printerDisplayName(r.printerName ?? r.printerId);
  const printerId = r.printerId ?? null;
  let marginsStored = false;
  let otherPrinter = false;
  let profilePrinterName: string | null = null;
  // the PDF printer is never a profile's printer; a cancelled job says nothing about the printer
  if (r.completed && !pdfPrinter && opts.db && opts.profileId != null) {
    const rec = await recordPrinter(opts.db, opts.profileId, { margins, printerName, printerId, paperKey: opts.paperKey ?? null });
    marginsStored = rec.marginsStored;
    otherPrinter = rec.otherPrinter;
    profilePrinterName = rec.profilePrinterName;
  }
  const from = opts.correctionFrom;
  const correctionOtherPrinter = r.completed && from?.printerId && printerId && from.printerId !== printerId ? (from.printerName ?? '') : null;
  let expectExact: boolean | null = null;
  let advice: string | null = null;
  if (opts.plan && paperMm) {
    if (Platform.OS === 'android') {
      const page = opts.plan.pages[0];
      const facts = androidJobFacts(opts.plan, snapPaperToPage(paperMm, { w: page.widthMm, h: page.heightMm }), margins);
      // the paper of the job's final print attributes (onLayout / job info) differs from our page, or is landscape: the
      // Default Print Service fits the page to it (D12) — said as a warning (REVIEW_V1 finding 4)
      const paperOk = facts.pageMatchesPaper && r.paperPortrait !== false;
      expectExact = facts.expectExact && paperOk;
      advice = paperOk ? facts.advice : 'paperDiffers';
    } else {
      const page = opts.plan.pages[0];
      const paperOk = iosRendererPlacement({ w: page.widthMm, h: page.heightMm }, paperMm).paperMatches || r.paperMatches === true;
      // ink where this printer cannot print is cut off by it (finding 5): the same test as Android's margin rule
      const inkOk = !margins || androidJobFacts(opts.plan, { w: page.widthMm, h: page.heightMm }, margins).marginsBlank;
      expectExact = paperOk && inkOk;
      advice = !paperOk ? 'paperDiffers' : !inkOk ? 'mayBeCut' : null;
    }
  }
  return {
    route,
    completed: r.completed,
    printerName: pdfPrinter ? null : printerName,
    printerId,
    paperMm,
    paperMatches: r.paperMatches ?? null,
    learnedMarginsMm: margins,
    marginsStored,
    otherPrinter,
    profilePrinterName,
    correctionOtherPrinter,
    expectExact,
    advice,
    raw: r,
  };
}
