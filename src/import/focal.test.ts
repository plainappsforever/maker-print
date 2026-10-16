import { focalFromPickerExif, readFocal35mm, readImageMeta } from './image-meta';

/** A JPEG header: SOI, APP1 Exif (IFD0 → Exif sub-IFD with FocalLengthIn35mmFilm), SOF0 4 × 3. */
function jpegWithFocal(f: number | null, le: boolean, type = 3): Uint8Array {
  const tiff: number[] = [];
  const u16 = (v: number) => (le ? [v & 0xff, v >> 8] : [v >> 8, v & 0xff]);
  const u32 = (v: number) => (le ? [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24] : [v >>> 24, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]);
  tiff.push(...(le ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8));
  // IFD0 at 8: one entry, ExifIFD pointer → 26
  tiff.push(...u16(1), ...u16(0x8769), ...u16(4), ...u32(1), ...u32(26), ...u32(0));
  // Exif IFD at 26: FocalLength (ignored) then FocalLengthIn35mmFilm
  const entries = f === null ? [] : [[0xa405, type, f]];
  tiff.push(...u16(entries.length + 1), ...u16(0x920a), ...u16(5), ...u32(1), ...u32(0), ...entries.flatMap(([tag, t, v]) => [...u16(tag), ...u16(t), ...u32(1), ...(t === 3 ? [...u16(v), 0, 0] : u32(v))]), ...u32(0));
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const sof = [0xff, 0xc0, 0, 11, 8, 0, 3, 0, 4, 1, 1, 0x11, 0];
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, (app1.length + 2) >> 8, (app1.length + 2) & 0xff, ...app1, ...sof, 0xff, 0xd9]);
}

describe('readFocal35mm (EXIF 0xA405)', () => {
  it('little- and big-endian, SHORT and LONG; the image itself still reads', () => {
    expect(readFocal35mm(jpegWithFocal(26, true))).toBe(26);
    expect(readFocal35mm(jpegWithFocal(52, false))).toBe(52);
    expect(readFocal35mm(jpegWithFocal(77, true, 4))).toBe(77);
    const meta = readImageMeta(jpegWithFocal(26, true));
    expect(meta.ok && [meta.meta.pxW, meta.meta.pxH]).toEqual([4, 3]);
  });

  it('absent, zero, other types, PNG and garbage → null', () => {
    expect(readFocal35mm(jpegWithFocal(null, true))).toBeNull();
    expect(readFocal35mm(jpegWithFocal(0, true))).toBeNull();
    expect(readFocal35mm(jpegWithFocal(26, true, 5))).toBeNull();
    expect(readFocal35mm(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBeNull();
    expect(readFocal35mm(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 1, 2]))).toBeNull();
    const cut = jpegWithFocal(26, true).subarray(0, 40);
    expect(readFocal35mm(cut)).toBeNull();
  });
});

describe('focalFromPickerExif (expo-image-picker asset.exif, review S7)', () => {
  it('iOS ImageIO key, Android ExifInterface key, nested {Exif}; numbers or numeric strings', () => {
    expect(focalFromPickerExif({ FocalLenIn35mmFilm: 26, FocalLength: 6.86, GPSLatitude: 52.5 })).toBe(26);
    expect(focalFromPickerExif({ FocalLengthIn35mmFilm: 77, FocalLength: 15.66 })).toBe(77);
    expect(focalFromPickerExif({ '{Exif}': { FocalLenIn35mmFilm: 13 } })).toBe(13);
    expect(focalFromPickerExif({ FocalLengthIn35mmFilm: '52' })).toBe(52);
  });

  it('missing, 0 (Android: tag present but unknown), negative, garbage, no EXIF → null; the real focal length is never taken', () => {
    for (const e of [null, undefined, 'x', 26, {}, { FocalLength: 6.86 }, { FocalLengthIn35mmFilm: 0 }, { FocalLenIn35mmFilm: -3 }, { FocalLenIn35mmFilm: 'abc' }, { FocalLenIn35mmFilm: '' }, { FocalLenIn35mmFilm: NaN }])
      expect(focalFromPickerExif(e)).toBeNull();
  });
});
