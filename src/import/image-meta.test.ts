/**
 * @jest-environment node
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { detectFormat, readImageMeta } from './image-meta';
import { LIMITS } from './limits';

const img = (name: string) => new Uint8Array(readFileSync(path.join(__dirname, '../../test/fixtures/images', name)));

describe('readImageMeta (fixtures from scripts/fixtures/make-fixtures.mjs; cross-checked with ImageIO by the referee)', () => {
  it('PNG with pHYs 300 dpi → physical size suggested', () => {
    const r = readImageMeta(img('red-square-300dpi.png'));
    expect(r.ok && r.meta).toMatchObject({ format: 'png', rawW: 200, rawH: 200, pxW: 200, pxH: 200, orientation: 1, density: { source: 'png' } });
    if (!r.ok) return;
    expect(r.meta.density!.dpiX).toBeCloseTo(299.9994, 4); // 11811 px/m
    expect(r.meta.sizeMm!.w).toBeCloseTo((200 * 25.4) / (11811 * 0.0254), 10);
  });

  it('JPEG with EXIF orientation 6: raw 300×200 → displayed 200×300; 72 dpi is a placeholder (no size)', () => {
    const r = readImageMeta(img('orient6.jpg'));
    expect(r.ok && r.meta).toMatchObject({ format: 'jpeg', rawW: 300, rawH: 200, orientation: 6, pxW: 200, pxH: 300, sizeMm: null, density: { dpiX: 72, dpiY: 72, source: 'exif' } });
  });

  it('EXIF 300 dpi wins over the JFIF header; JFIF-only density is read (254 dpi = 10 px/mm); JFIF units 0 = no size', () => {
    const e = readImageMeta(img('exif-300dpi.jpg'));
    expect(e.ok && e.meta.sizeMm).toEqual({ w: 12.7, h: (100 * 25.4) / 300 });
    const j = readImageMeta(img('jfif-254dpi.jpg'));
    expect(j.ok && j.meta.density).toEqual({ dpiX: 254, dpiY: 254, source: 'jfif' });
    expect(j.ok && j.meta.sizeMm).toEqual({ w: 10, h: 5 });
    expect(readImageMeta(img('jfif-units0.jpg'))).toMatchObject({ ok: true, meta: { density: null, sizeMm: null } });
  });

  it('72 dpi PNG (2835 px/m) → placeholder, no size; RGBA PNG reads', () => {
    expect(readImageMeta(img('phone-72dpi.png'))).toMatchObject({ ok: true, meta: { sizeMm: null, pxW: 40, pxH: 30 } });
    expect(readImageMeta(img('blue-alpha.png'))).toMatchObject({ ok: true, meta: { pxW: 100, pxH: 100, density: null, sizeMm: null } });
  });

  it('refusals: empty, truncated, HEIC (convert first), unknown bytes, too many pixels', () => {
    expect(readImageMeta(img('empty.png'))).toEqual({ ok: false, error: 'emptyFile' });
    expect(readImageMeta(img('truncated.jpg'))).toEqual({ ok: false, error: 'corrupt', format: 'jpeg' });
    expect(readImageMeta(img('photo.heic'))).toEqual({ ok: false, error: 'needsConversion', format: 'heic' });
    expect(readImageMeta(new Uint8Array([1, 2, 3, 4]))).toEqual({ ok: false, error: 'corrupt', format: undefined });
    expect(readImageMeta(new Uint8Array(Buffer.from('GIF89a......')))).toMatchObject({ ok: false, error: 'unsupportedFormat', format: 'gif' });
    // a PNG header claiming 6000 × 6000 px
    const big = img('phone-72dpi.png').slice();
    new DataView(big.buffer).setUint32(16, 6000);
    new DataView(big.buffer).setUint32(20, 6000);
    expect(readImageMeta(big)).toMatchObject({ ok: false, error: 'tooManyPixels' });
    expect(6000 * 6000).toBeGreaterThan(LIMITS.imagePixels);
  });

  it('format sniffing', () => {
    expect(detectFormat(new Uint8Array(Buffer.from('RIFF0000WEBPVP8 ')))).toBe('webp');
    expect(detectFormat(new Uint8Array([0x49, 0x49, 42, 0]))).toBe('tiff');
    expect(detectFormat(new Uint8Array([0x42, 0x4d, 0, 0]))).toBe('bmp');
  });
});
