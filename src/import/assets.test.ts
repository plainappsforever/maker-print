/**
 * @jest-environment node
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { planPrint, type PlanObject } from '@/engine/plan';
import { uniformMargins } from '@/engine/paper';
import { en } from '@/i18n/en';
import { printTranslator } from '@/i18n';

import { decodeSvgText, decodeUtf8, inspectAsset, planAssetOf, svgSizeAt, type InspectError } from './assets';

const fx = (p: string) => new Uint8Array(readFileSync(path.join(__dirname, '../../test/fixtures', p)));

describe('inspectAsset → assets row fields + report; planAssetOf → natural sizes', () => {
  it('SVG needing the units question: no size until answered, then the answer decides (W8)', async () => {
    const r = await inspectAsset('svg', new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300"/></svg>'));
    if (!r.ok) throw new Error(r.error);
    expect(r.asset.needsPpi).toBe(true);
    const row = { id: 7, kind: 'svg' as const, pxW: null, pxH: null, report: r.asset.report };
    expect(planAssetOf({ ...row, svgPxPerIn: null }).naturalMm).toBeNull();
    expect(planAssetOf({ ...row, svgPxPerIn: 96 }).naturalMm).toEqual({ w: (400 * 25.4) / 96, h: 79.375 });
    const at72 = svgSizeAt(r.asset.report, 72)!;
    expect(at72.w).toBeCloseTo(141.1111111, 6);
    expect(at72.h).toBeCloseTo(105.8333333, 6);
    // the planner refuses to guess: unanswered → assetSizeUnknown, object left out
    const obj: PlanObject = { id: 1, sheetId: 1, z: 0, kind: 'svg', assetId: 7, pageIndex: 0, x: 10, y: 10, w: 50, h: 40, rotationDeg: 0, mirrorX: false, mirrorY: false, crop: null, fit: 'fill', repeat: null, props: {}, hidden: false };
    const plan = planPrint({
      sheets: [{ id: 1, widthMm: 210, heightMm: 297 }],
      objects: [obj],
      assets: [planAssetOf({ ...row, svgPxPerIn: null })],
      output: { paperKey: 'a4', orientation: 'auto', margins: uniformMargins(6.35), overlapMm: 10, marks: 'registration', pageLabels: true, assemblyMap: 'auto', skipBlank: true, excludedTiles: [], checkBar: false, ppiTarget: 300 },
      ctx: { locale: 'en', unit: 'mm', inchStyle: 'fraction16', t: printTranslator('en') },
    });
    expect(plan.warnings.map((w) => w.code)).toContain('assetSizeUnknown');
  });

  it('SVG with physical units needs no question; PDF pages and images carry their sizes', async () => {
    const s = await inspectAsset('svg', fx('svg/inkscape-mm.svg'));
    expect(s.ok && s.asset.needsPpi).toBe(false);
    if (s.ok) expect(planAssetOf({ id: 1, kind: 'svg', pxW: null, pxH: null, svgPxPerIn: null, report: s.asset.report }).naturalMm).toEqual({ w: 100, h: 50 });
    const p = await inspectAsset('pdf', fx('pdf/rotate90.pdf'));
    if (!p.ok) throw new Error(p.error);
    expect(p.asset.pageCount).toBe(1);
    const pa = planAssetOf({ id: 2, kind: 'pdf', pxW: null, pxH: null, svgPxPerIn: null, report: p.asset.report });
    expect(pa.pageSizesMm?.map((x) => [Math.round(x.w * 1e6) / 1e6, Math.round(x.h * 1e6) / 1e6])).toEqual([[100, 60]]);
    const i = await inspectAsset('image', fx('images/orient6.jpg'));
    expect(i.ok && [i.asset.pxW, i.asset.pxH]).toEqual([200, 300]);
    // the report is a JSON object (assets.report guard) and survives a JSON round trip
    for (const r of [s, p, i]) if (r.ok) expect(JSON.parse(JSON.stringify(r.asset.report))).toEqual(r.asset.report);
  });

  it('a corrupt report gives no size (reported by the planner), never a guess', () => {
    expect(planAssetOf({ id: 3, kind: 'pdf', pxW: null, pxH: null, svgPxPerIn: null, report: { nonsense: true } }).pageSizesMm).toBeUndefined();
    expect(planAssetOf({ id: 4, kind: 'svg', pxW: null, pxH: null, svgPxPerIn: 96, report: null }).naturalMm).toBeUndefined();
  });

  it('refusals carry an error code with a message in both languages', async () => {
    const errors: InspectError[] = [];
    for (const [kind, bytes] of [
      ['svg', new Uint8Array([0x3c, 0x73, 0xff])], // invalid UTF-8 (FF FE would now be a UTF-16 BOM)
      ['svg', new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm"><text>x</text></svg>')],
      ['svg', new Uint8Array(0)],
      ['pdf', fx('pdf/encrypted-password.pdf')],
      ['image', fx('images/photo.heic')],
    ] as const) {
      const r = await inspectAsset(kind, bytes);
      if (!r.ok) errors.push(r.error);
    }
    expect(errors).toEqual(['notText', 'empty', 'emptyFile', 'encrypted', 'needsConversion']);
    const keys = Object.keys(en);
    for (const e of ['emptyFile', 'fileTooLarge', 'tooManyPixels', 'corrupt', 'unsupportedFormat', 'needsConversion', 'encrypted', 'noPages', 'tooManyPages', 'invalidXml', 'notSvg', 'noSize', 'badLength', 'badViewBox', 'empty', 'notText', 'tooComplex', 'compressedSvg'])
      expect(keys).toContain(`import.error.${e}`);
  });
});

describe('decodeUtf8 fallback (Hermes without TextDecoder)', () => {
  it('matches TextDecoder on valid text and refuses invalid bytes', () => {
    const real = globalThis.TextDecoder;
    const samples = ['<svg>ÄÖÜ ß € 𝄞</svg>', '\uFEFFbom', ''];
    const invalid = [new Uint8Array([0xff]), new Uint8Array([0xc3]), new Uint8Array([0xe2, 0x28, 0xa1]), new Uint8Array([0xed, 0xa0, 0x80])];
    const expected = samples.map((t) => new TextDecoder().decode(new TextEncoder().encode(t)));
    try {
      (globalThis as { TextDecoder?: unknown }).TextDecoder = undefined;
      expect(samples.map((t) => decodeUtf8(new TextEncoder().encode(t)))).toEqual(expected);
      expect(invalid.map(decodeUtf8)).toEqual([null, null, null, null]);
    } finally {
      globalThis.TextDecoder = real;
    }
    expect(invalid.map(decodeUtf8)).toEqual([null, null, null, null]);
  });
});

// P3.5 review finding 14: older exporters write Latin-1 / UTF-16 SVGs; .svgz gets its own message
describe('decodeSvgText', () => {
  const blind = (n: string) => new Uint8Array(readFileSync(path.join(__dirname, '../../test/blind/svg', n)));
  it('Latin-1 by declaration, UTF-16 by BOM, UTF-8 with BOM; gzip refused as compressedSvg', async () => {
    const l1 = decodeSvgText(blind('e01-latin1.svg'));
    expect(l1.ok && l1.text.includes('für')).toBe(true);
    for (const f of ['e01-latin1.svg', 'e02-utf16.svg', 'e03-utf8-bom.svg']) expect([f, (await inspectAsset('svg', blind(f))).ok]).toEqual([f, true]);
    expect(await inspectAsset('svg', blind('e04-svgz.svgz'))).toEqual({ ok: false, error: 'compressedSvg' });
    expect(decodeSvgText(new Uint8Array([0x3c, 0x73, 0xff]))).toEqual({ ok: false, error: 'notText' });
    const cp = decodeSvgText(new Uint8Array([...Buffer.from('<?xml version="1.0" encoding="windows-1252"?><t>'), 0x80, 0xe9]));
    expect(cp.ok && cp.text.endsWith('€é')).toBe(true);
  });
});
