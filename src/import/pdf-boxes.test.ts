/**
 * @jest-environment node
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { PDFDocument } from '@cantoo/pdf-lib';

import { checkFileBytes, LIMITS } from './limits';
import { prng } from '../../test/prng';
import { looksLikeContent, pageGeometry, readPdf } from './pdf-boxes';

const pdf = (name: string) => new Uint8Array(readFileSync(path.join(__dirname, '../../test/fixtures/pdf', name)));
const r1 = (v: number) => Math.round(v * 10) / 10;

describe('readPdf (SPEC §8.10, §11, §12; W9)', () => {
  it('W9: A2 MediaBox → 420.0 × 594.0 mm; page list with sizes; a page without content is flagged', async () => {
    const r = await readPdf(pdf('three-pages.pdf'));
    if (!r.ok) throw new Error(r.error);
    expect(r.pageCount).toBe(3);
    expect(r.restricted).toBe(false);
    expect(r.pages.map((p) => [r1(p.wMm), r1(p.hMm), p.rotate, p.hasContent])).toEqual([
      [420, 594, 0, true],
      [215.9, 279.4, 0, true],
      [148, 210, 0, false],
    ]);
  });

  it('UserUnit 2, Rotate 90 and CropBox fixtures', async () => {
    const sizes = async (f: string) => {
      const r = await readPdf(pdf(f));
      if (!r.ok) throw new Error(r.error);
      return [r1(r.pages[0].wMm), r1(r.pages[0].hMm), r.pages[0].rotate, r.pages[0].userUnit];
    };
    expect(await sizes('userunit2.pdf')).toEqual([100, 60, 0, 2]);
    expect(await sizes('rotate90.pdf')).toEqual([100, 60, 90, 1]);
    expect(await sizes('cropbox.pdf')).toEqual([50, 50, 0, 1]);
  });

  it('encrypted: owner restrictions only → opens (restricted); a real password → refused', async () => {
    expect(await readPdf(pdf('encrypted-restricted.pdf'))).toMatchObject({ ok: true, restricted: true, pageCount: 1 });
    expect(await readPdf(pdf('encrypted-password.pdf'))).toEqual({ ok: false, error: 'encrypted' });
  });

  it('corrupt, empty, too many pages, too large', async () => {
    expect(await readPdf(pdf('corrupt.pdf'))).toMatchObject({ ok: false });
    expect(await readPdf(new Uint8Array(0))).toEqual({ ok: false, error: 'emptyFile' });
    const doc = await PDFDocument.create();
    for (let i = 0; i <= LIMITS.pdfPages; i++) doc.addPage([100, 100]);
    expect(await readPdf(await doc.save())).toEqual({ ok: false, error: 'tooManyPages' });
    expect(checkFileBytes(LIMITS.fileBytes + 1)).toBe('fileTooLarge');
    expect(checkFileBytes(LIMITS.fileBytes)).toBeNull();
  });
});

describe('pageGeometry notes', () => {
  it('invalid Rotate / UserUnit and a CropBox outside the MediaBox are noted, never guessed', () => {
    expect(pageGeometry([0, 0, 72, 72], null, null, 45).notes).toEqual(['rotateInvalid']);
    expect(pageGeometry([0, 0, 72, 72], null, -2, 0)).toMatchObject({ userUnit: 1, notes: ['userUnitInvalid'] });
    expect(pageGeometry([0, 0, 72, 72], [100, 100, 200, 200], null, 0)).toMatchObject({ box: [0, 0, 72, 72], notes: ['cropBoxIgnored'] });
  });
});

// P3.5 review finding 18 (suspected): an inline image first in the content must not look like a wrong password
describe('looksLikeContent', () => {
  it('text content and inline-image-first content pass; random bytes (wrong password) do not', () => {
    const enc = (s: string) => new Uint8Array(Buffer.from(s, 'latin1'));
    expect(looksLikeContent(enc('q 1 0 0 rg 10 10 100 100 re f Q'))).toBe(true);
    const r = prng(18);
    const binary = Array.from({ length: 3000 }, () => String.fromCharCode(r.int(0, 255))).join('');
    expect(looksLikeContent(enc(`q 100 0 0 100 0 0 cm BI /W 40 /H 25 /CS /RGB /BPC 8 ID ${binary} EI Q`))).toBe(true);
    let accepted = 0;
    for (let k = 0; k < 2000; k++) accepted += Number(looksLikeContent(new Uint8Array(Array.from({ length: 600 }, () => r.int(0, 255)))));
    expect(accepted).toBe(0);
  });
});
