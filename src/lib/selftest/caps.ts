// Hermes limits and performance (V1_PLAN P4 note, D54, SPEC A13): the biggest repeat count that plans and writes, the
// longest SVG path that paints, the 10/45 MB SVG stress files and the 44/50 MB PDFs (built here in memory with the same
// structure as test/blind/make_stress.py), the <use> bomb, the 16-tile export of a 600 × 900 mm SVG, and how long the
// JS thread is blocked. Pure engine code + timers; results are plain rows (the debug screen writes them to a file).
import { uniformMargins } from '../../engine/paper';
import { MAX_COPIES, planPrint, type OutputOptions, type PlanObject } from '../../engine/plan';
import { decodeSvgText, inspectAsset, planAssetOf } from '../../import/assets';
import { createAssetPainter } from '../../pdf/assets';
import { writePdf } from '../../pdf/writer';

import { REFEREE_CTX } from './project-pdf';

export type CapRow = { probe: string; n?: number; ok: boolean; ms: number; detail?: string; maxBlockMs?: number };

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const tick = () => new Promise<void>((r) => setTimeout(r, 0));
const OUT: OutputOptions = {
  paperKey: 'a4',
  orientation: 'portrait',
  margins: uniformMargins(6.35),
  overlapMm: 10,
  marks: 'registration',
  pageLabels: true,
  assemblyMap: 'auto',
  skipBlank: true,
  excludedTiles: [],
  checkBar: true,
  ppiTarget: 300,
};
const base = { z: 0, assetId: null, pageIndex: 0, rotationDeg: 0, mirrorX: false, mirrorY: false, crop: null, fit: 'fill', repeat: null, props: {}, hidden: false } as const;

/** Longest gap between 10 ms timer ticks while `fn` runs = the longest the JS thread was blocked. */
async function blocking<T>(fn: () => Promise<T>): Promise<{ value: T; maxBlockMs: number }> {
  let last = now();
  let max = 0;
  const id = setInterval(() => {
    const t = now();
    max = Math.max(max, t - last);
    last = t;
  }, 10);
  try {
    const value = await fn();
    max = Math.max(max, now() - last);
    return { value, maxBlockMs: Math.round(max) };
  } finally {
    clearInterval(id);
  }
}

const enc = (s: string) => new TextEncoder().encode(s);
const err = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 160);

async function copies(cols: number, rows: number, size: number): Promise<CapRow> {
  const t0 = now();
  try {
    const { value, maxBlockMs } = await blocking(async () => {
      const plan = planPrint({
        sheets: [{ id: 1, widthMm: 210, heightMm: 297 }],
        objects: [{ ...base, id: 1, sheetId: 1, kind: 'rect', x: 10, y: 10, w: size, h: size, repeat: { cols, rows, gap_x_mm: 0.2, gap_y_mm: 0.2, trim_marks: true }, props: { fill: '#ff0000' } } as PlanObject],
        output: OUT,
        ctx: REFEREE_CTX,
      });
      const refused = plan.warnings.some((w) => w.code === 'tooManyCopies');
      if (refused) return { refused, bytes: 0, notes: 0 };
      const w = await writePdf(plan, { title: 'caps', checkBarCaption: 'This bar must measure 100 mm' });
      return { refused, bytes: w.bytes.length, notes: w.notes.length };
    });
    const n = cols * rows;
    const expectRefused = n > MAX_COPIES;
    return { probe: 'repeat copies', n, ok: value.refused === expectRefused && value.notes === 0, ms: Math.round(now() - t0), maxBlockMs, detail: value.refused ? 'refused tooManyCopies' : `${value.bytes} bytes` };
  } catch (e) {
    return { probe: 'repeat copies', n: cols * rows, ok: false, ms: Math.round(now() - t0), detail: `THREW ${err(e)}` };
  }
}

function pathSvg(segments: number) {
  const parts: string[] = ['<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"><path fill="none" stroke="#f00" stroke-width="0.1" d="M0 0'];
  // "M0 0" is segment 1, so `segments` − 1 line segments follow
  for (let i = 1; i < segments; i++) parts.push(i % 2 ? 'L1 1' : 'L2 0');
  parts.push('"/></svg>');
  return parts.join('');
}

/** Imports an SVG and paints it on one page; ok = imported AND drawn (or refused as tooComplex when `expectRefused`). */
async function svgProbe(probe: string, n: number | undefined, text: string, expectRefused: boolean | null): Promise<CapRow> {
  const t0 = now();
  try {
    const { value, maxBlockMs } = await blocking(async () => {
      const bytes = enc(text);
      const r = await inspectAsset('svg', bytes);
      if (!r.ok) return { refused: true, detail: r.error, notes: 0 };
      const natural = planAssetOf({ id: 1, kind: 'svg', pxW: r.asset.pxW, pxH: r.asset.pxH, svgPxPerIn: null, report: r.asset.report }).naturalMm ?? { w: 100, h: 100 };
      const decoded = decodeSvgText(bytes);
      const t = decoded.ok ? decoded.text : text;
      const plan = {
        content: {},
        pages: [
          {
            widthMm: 594,
            heightMm: 841,
            orientation: 'portrait' as const,
            label: '1',
            kind: 'single' as const,
            sheetIndex: 0,
            safe: { x: 0, y: 0, w: 594, h: 841 },
            correction: null,
            rotation: null,
            ops: [
              {
                op: 'object' as const,
                objectId: 1,
                kind: 'svg',
                copy: { col: 0, row: 0 },
                transform: [1, 0, 0, 1, 20, 20] as [number, number, number, number, number, number],
                clip: { x: 0, y: 0, w: 594, h: 841 },
                box: { w: natural.w, h: natural.h },
                source: { assetId: 1, pageIndex: 0, natural, map: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number] },
              },
            ],
          },
        ],
      };
      const w = await writePdf(plan, { title: 'caps', checkBarCaption: 'x', paintAsset: createAssetPainter(async () => ({ kind: 'svg', text: t })) });
      return { refused: false, detail: `drawn, ${w.bytes.length} bytes`, notes: w.notes.length };
    });
    const ok = expectRefused === null ? value.notes === 0 : value.refused === expectRefused && value.notes === 0;
    return { probe, n, ok, ms: Math.round(now() - t0), maxBlockMs, detail: value.refused ? `refused ${value.detail}` : value.detail + (value.notes ? `, ${value.notes} notes` : '') };
  } catch (e) {
    return { probe, n, ok: false, ms: Math.round(now() - t0), detail: `THREW ${err(e)}` };
  }
}

/** make_stress.py h01: ~45 MB of 0.5 mm rects (target bytes). */
function rectsSvg(target: number) {
  const head = '<svg xmlns="http://www.w3.org/2000/svg" width="500mm" height="500mm" viewBox="0 0 500 500">';
  const parts = [head];
  let size = head.length;
  for (let i = 0; size < target - 10; i++) {
    const r = `<rect x="${((i % 700) * 0.7).toFixed(2)}" y="${((Math.floor(i / 700) * 0.7) % 500).toFixed(2)}" width="0.5" height="0.5" fill="#ff0000"/>\n`;
    parts.push(r);
    size += r.length;
  }
  parts.push('</svg>');
  return parts.join('');
}

/** make_stress.py h02: one path of ~target bytes. */
function onePathSvg(target: number) {
  const parts = ['<svg xmlns="http://www.w3.org/2000/svg" width="500mm" height="500mm" viewBox="0 0 500 500"><path fill="none" stroke="#f00" stroke-width="0.1" d="M0 0'];
  let size = 0;
  for (let i = 0; size < target - 100; i++) {
    const s = `L${(i * 7) % 500} ${(i * 13) % 500}`;
    parts.push(s);
    size += s.length;
  }
  parts.push('"/></svg>');
  return parts.join('');
}

/** make_stress.py h10: `pages` A3 pages, each with an incompressible image of `imageBytes` (pseudo-random). */
function bigPdf(pages: number, imageBytes: number): Uint8Array {
  const chunks: Uint8Array[] = [];
  let length = 0;
  const offsets: number[] = [];
  const push = (b: Uint8Array) => {
    chunks.push(b);
    length += b.length;
  };
  const text = (s: string) => push(enc(s));
  let seed = 10;
  const rnd = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return seed & 0xff;
  };
  const pagesId = pages * 3 + 1;
  text('%PDF-1.7\n');
  let id = 0;
  const obj = (body: () => void) => {
    id++;
    offsets.push(length);
    text(`${id} 0 obj\n`);
    body();
    text('\nendobj\n');
    return id;
  };
  const kids: number[] = [];
  const side = Math.floor(Math.sqrt(imageBytes / 3));
  for (let n = 0; n < pages; n++) {
    const data = new Uint8Array(side * side * 3);
    for (let i = 0; i < data.length; i++) data[i] = rnd();
    const img = obj(() => {
      text(`<< /Type /XObject /Subtype /Image /Width ${side} /Height ${side} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${data.length} >>\nstream\n`);
      push(data);
      text('\nendstream');
    });
    const content = 'q 420 0 0 420 0 0 cm /Im0 Do Q 1 0 0 rg 10 10 30 20 re f';
    const c = obj(() => text(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
    kids.push(obj(() => text(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 841.89 1190.55] /Resources << /XObject << /Im0 ${img} 0 R >> >> /Contents ${c} 0 R >>`)));
  }
  obj(() => text(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${pages} >>`));
  const cat = obj(() => text(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`));
  const x = length;
  text(`xref\n0 ${id + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`);
  text(`trailer\n<< /Size ${id + 1} /Root ${cat} 0 R >>\nstartxref\n${x}\n%%EOF\n`);
  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

async function pdfProbe(probe: string, bytes: Uint8Array): Promise<CapRow> {
  const t0 = now();
  try {
    const { value, maxBlockMs } = await blocking(() => inspectAsset('pdf', bytes));
    return { probe, n: bytes.length, ok: value.ok, ms: Math.round(now() - t0), maxBlockMs, detail: value.ok ? `${value.asset.pageCount} pages` : `refused ${value.error}` };
  } catch (e) {
    return { probe, n: bytes.length, ok: false, ms: Math.round(now() - t0), detail: `THREW ${err(e)}` };
  }
}

/** A13: a 600 × 900 mm SVG (grid of outlined cells + circles) tiled on A4 = 15 tiles + map. */
function patternSvg() {
  const parts = ['<svg xmlns="http://www.w3.org/2000/svg" width="600mm" height="900mm" viewBox="0 0 600 900"><g fill="none" stroke="#000" stroke-width="0.3">'];
  for (let y = 0; y < 900; y += 20) for (let x = 0; x < 600; x += 20) parts.push(`<rect x="${x + 2}" y="${y + 2}" width="16" height="16"/><circle cx="${x + 10}" cy="${y + 10}" r="5"/>`);
  parts.push('</g></svg>');
  return parts.join('');
}

export async function a13TiledExport(): Promise<CapRow> {
  const t0 = now();
  try {
    const { value, maxBlockMs } = await blocking(async () => {
      const text = patternSvg();
      const bytes = enc(text);
      const r = await inspectAsset('svg', bytes);
      if (!r.ok) throw new Error(r.error);
      const asset = planAssetOf({ id: 1, kind: 'svg', pxW: r.asset.pxW, pxH: r.asset.pxH, svgPxPerIn: null, report: r.asset.report });
      const plan = planPrint({
        sheets: [{ id: 1, widthMm: 600, heightMm: 900 }],
        objects: [{ ...base, id: 1, sheetId: 1, kind: 'svg', assetId: 1, x: 0, y: 0, w: 600, h: 900 } as PlanObject],
        assets: [asset],
        output: { ...OUT, orientation: 'auto' },
        ctx: REFEREE_CTX,
      });
      const w = await writePdf(plan, { title: 'a13', checkBarCaption: 'This bar must measure 100 mm', paintAsset: createAssetPainter(async () => ({ kind: 'svg', text })) });
      return { pages: plan.pages.length, bytes: w.bytes.length, notes: w.notes.length };
    });
    const ms = Math.round(now() - t0);
    return { probe: 'A13 16-tile export 600×900 mm SVG', n: value.pages, ok: value.pages === 16 && value.notes === 0 && ms < 10_000, ms, maxBlockMs, detail: `${value.bytes} bytes` };
  } catch (e) {
    return { probe: 'A13 16-tile export 600×900 mm SVG', ok: false, ms: Math.round(now() - t0), detail: `THREW ${err(e)}` };
  }
}

export function featureProbes(): CapRow[] {
  const rows: CapRow[] = [];
  rows.push({ probe: 'TextDecoder present', ok: typeof TextDecoder !== 'undefined', ms: 0 });
  try {
    const re = /ab/y;
    re.lastIndex = 2;
    rows.push({ probe: 'sticky regex', ok: re.test('xxab') && re.lastIndex === 4, ms: 0 });
  } catch (e) {
    rows.push({ probe: 'sticky regex', ok: false, ms: 0, detail: err(e) });
  }
  return rows;
}

/**
 * All probes, smallest first; `onRow` gets each row as soon as it exists (the screen persists it, so a crash on a big
 * probe still leaves the rows before it). `useBomb` = test/blind h04 text.
 */
export async function runCaps(useBomb: string, onRow: (r: CapRow) => void): Promise<CapRow[]> {
  const rows: CapRow[] = [];
  const add = async (r: CapRow | Promise<CapRow>) => {
    const v = await r;
    rows.push(v);
    onRow(v);
    await tick();
  };
  for (const r of featureProbes()) await add(r);
  await add(svgProbe('<use> bomb (h04)', undefined, useBomb, true));
  for (const [c, r, s] of [
    [50, 50, 3],
    [100, 150, 1.5],
    [150, 250, 0.9],
    [200, 250, 0.7],
    [201, 250, 0.7],
  ] as const)
    await add(copies(c, r, s));
  for (const n of [50_000, 200_000, 500_000, 1_000_000, 2_000_000]) await add(svgProbe('SVG path segments', n, pathSvg(n), false));
  await add(svgProbe('SVG path segments over budget', 2_000_002, pathSvg(2_000_002), true));
  await add(a13TiledExport());
  await add(svgProbe('10 MB SVG of rects', 10_000_000, rectsSvg(10_000_000), null));
  await add(svgProbe('10 MB SVG one path', 10_000_000, onePathSvg(10_000_000), null));
  await add(pdfProbe('44 MB PDF, 190 pages', bigPdf(190, 230_400)));
  await add(pdfProbe('50 MB PDF (A13 message < 3 s)', bigPdf(190, 262_000)));
  await add(svgProbe('45 MB SVG of rects', 45_000_000, rectsSvg(45_000_000), null));
  await add(svgProbe('45 MB SVG one path', 45_000_000, onePathSvg(45_000_000), null));
  return rows;
}
