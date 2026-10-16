/**
 * JS side of the local module (V1_PLAN "Native module", D11, D12, D17, D30). `null` in Jest and in a build without the
 * module (src/lib/print.ts then takes the expo-print fallback). Paths may be `file://` URIs or plain paths.
 */
import { requireOptionalNativeModule } from 'expo';

export type NativePrintOptions = {
  jobName: string;
  /** The PDF's (portrait, D53) page size in points: iOS asks the printer for this paper, Android preselects it */
  pageWidthPt: number;
  pageHeightPt: number;
  outputType: 'general' | 'photo';
};
export type PrintableRectPt = { x: number; y: number; w: number; h: number };
export type NativePrintResult = {
  /** iOS: the user tapped Print. Android: the job left the dialog (queued, started, blocked or completed) */
  completed: boolean;
  printerName?: string;
  printerId?: string;
  paperWidthPt?: number;
  paperHeightPt?: number;
  /** The paper the print system chose equals the page (±1 pt, portrait) */
  paperMatches?: boolean;
  /** iOS: where the paper came from — 'job' (drawn after Print was tapped), 'chosen' (our choosePaper), 'preview' */
  paperSource?: 'job' | 'chosen' | 'preview';
  /** iOS: printable area of the chosen paper, paper coordinates, y down (D17) */
  printableRectPt?: PrintableRectPt;
  /** Android: the printer's minimum margins in mils seen in onLayout / the job's final attributes (D17) */
  minMarginsMils?: { l: number; t: number; r: number; b: number };
  /** Android: final job state (queued, started, blocked, completed, cancelled, failed, timeout) */
  jobState?: string;
  mediaId?: string;
  paperPortrait?: boolean;
  /** iOS: pages our renderer drew (preview + job); Android: adapter onLayout/onWrite calls */
  pagesDrawn?: number;
  layouts?: number;
  writes?: number;
  error?: string;
};
export type RenderedPage = { uri: string; widthPx: number; heightPx: number };

export interface MakerPrintNativeModuleType {
  printPdf(path: string, opts: NativePrintOptions): Promise<NativePrintResult>;
  /** iOS only: draws the PDF through the print renderer onto the given paper → PDF file URI */
  printDryRun?(path: string, paperWidthPt: number, paperHeightPt: number, printableRectPt: PrintableRectPt): Promise<string>;
  renderPdfPage(path: string, pageIndex: number, maxPx: number): Promise<RenderedPage>;
}

export default requireOptionalNativeModule<MakerPrintNativeModuleType>('MakerPrintNative');
