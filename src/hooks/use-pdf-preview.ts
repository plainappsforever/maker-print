// The print screen's page previews rasterised from the REAL output PDF (SPEC §9.3, D16, D30, D74): what you see is
// what is sent. Rebuilt 400 ms after the last change (writing blocks the JS thread, D64); until it is ready — and when
// the native rasteriser is missing — the screen draws the plan instead.
import { File } from 'expo-file-system';
import { useEffect, useState } from 'react';

import native, { type RenderedPage } from '../../modules/maker-print-native';

import type { PdfFile } from '@/lib/print';

export const MAX_PREVIEW_PAGES = 60;
let shown: string[] = []; // PNGs on screen now; older ones are removed from the app's cache once replaced

function forget(uris: string[]) {
  for (const uri of uris) {
    try {
      const f = new File(uri);
      if (f.exists) f.delete();
    } catch {
      // a cache file the OS already removed
    }
  }
}

export type PdfPreview = {
  /** Rasterised pages of the PDF written for `key`, or null until ready */
  pages: RenderedPage[] | null;
  /** That PDF: Print reuses it when the key is unchanged (REVIEW_V1 finding 10) */
  file: PdfFile | null;
  /** A preview PDF is being written now (the JS thread may be blocked — the screen shows it for big drawings) */
  writing: boolean;
};

export function usePdfPreview(key: string | null, make: () => Promise<PdfFile | null>, maxPx: number, beforeWrite?: () => Promise<void>): PdfPreview {
  const [state, setState] = useState<{ key: string; pages: RenderedPage[]; file: PdfFile } | null>(null);
  const [writing, setWriting] = useState(false);
  useEffect(() => {
    if (!key || !native) return;
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        setWriting(true);
        if (beforeWrite) await beforeWrite();
        const file = await make();
        if (!file || !alive) return;
        const pages: RenderedPage[] = [];
        for (let i = 0; i < Math.min(file.pages, MAX_PREVIEW_PAGES); i++) {
          if (!alive) return forget(pages.map((p) => p.uri));
          pages.push(await native!.renderPdfPage(file.uri, i, maxPx));
        }
        if (!alive) return forget(pages.map((p) => p.uri));
        const old = shown;
        shown = pages.map((p) => p.uri);
        setState({ key, pages, file });
        setTimeout(() => forget(old.filter((u) => !shown.includes(u))), 2000);
      } catch {
        // keep the plan drawing
      } finally {
        if (alive) setWriting(false);
      }
    }, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
      setWriting(false);
    };
    // `make` is rebuilt every render; `key` names everything it depends on
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, maxPx]);
  const ready = state?.key === key ? state : null;
  return { pages: ready?.pages ?? null, file: ready?.file ?? null, writing };
}
