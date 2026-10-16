import { readFileSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

import { inspectAsset } from './assets';
import { gunzipCapped, isGzip, plainSvgName, unwrapSvgz } from './svgz';

const fx = (n: string) => new Uint8Array(readFileSync(path.join(__dirname, '../../test/fixtures/svgz', n)));
const plain = new Uint8Array(readFileSync(path.join(__dirname, '../../test/fixtures/svg/inkscape-mm.svg')));

describe('svgz (V15 X03)', () => {
  it('unpacks a valid .svgz to the exact plain SVG, renamed .svg; the SVG reader then accepts it', async () => {
    const r = unwrapSvgz(fx('inkscape-mm.svgz'), 'Bracket.svgz');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Buffer.from(r.bytes).equals(Buffer.from(plain))).toBe(true);
    expect(r.name).toBe('Bracket.svg');
    const asPlain = await inspectAsset('svg', plain);
    expect(await inspectAsset('svg', r.bytes)).toEqual(asPlain);
    expect(asPlain.ok).toBe(true);
  });

  it('two gzip members (concatenated streams) and the .svg.gz name', () => {
    const r = unwrapSvgz(fx('two-members.svgz'), 'x.svgz');
    expect(r.ok && Buffer.from(r.bytes).equals(Buffer.from(plain))).toBe(true);
    const g = unwrapSvgz(fx('inkscape-mm.svg.gz'), 'drawing.svg.gz');
    expect(g.ok && g.name).toBe('drawing.svg');
  });

  it('the P3.5 reviewer’s blind .svgz (once refused) now imports', async () => {
    const b = new Uint8Array(readFileSync(path.join(__dirname, '../../test/blind/svg/e04-svgz.svgz')));
    expect(await inspectAsset('svg', b)).toEqual({ ok: false, error: 'compressedSvg' }); // the reader alone still refuses gzip
    const r = unwrapSvgz(b, 'e04-svgz.svgz');
    expect(r.ok).toBe(true);
    if (r.ok) expect((await inspectAsset('svg', r.bytes)).ok).toBe(true);
  });

  it.each([
    ['truncated', 'truncated.svgz', 'compressedCorrupt'],
    ['damaged deflate data', 'damaged.svgz', 'compressedCorrupt'],
    ['bomb (64 MiB inside, footer lies)', 'bomb-64mib.svgz', 'compressedTooLarge'],
  ])('%s → %s', (_n, file, error) => {
    expect(unwrapSvgz(fx(file), file)).toEqual({ ok: false, error });
  });

  it('the cap holds while unpacking (no footer trusted); header-only data is corrupt', () => {
    const big = zlib.gzipSync(Buffer.alloc(60 * 1024 * 1024, 0x20));
    expect(gunzipCapped(new Uint8Array(big))).toEqual({ ok: false, error: 'compressedTooLarge' });
    expect(gunzipCapped(new Uint8Array([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 3]))).toEqual({ ok: false, error: 'compressedCorrupt' });
    // exactly at the cap passes, one byte over does not
    const at = new Uint8Array(zlib.gzipSync(Buffer.alloc(1000, 0x41)));
    expect(gunzipCapped(at, 1000).ok).toBe(true);
    expect(gunzipCapped(at, 999)).toEqual({ ok: false, error: 'compressedTooLarge' });
  });

  it('plain files pass through untouched; names', () => {
    const r = unwrapSvgz(plain, 'a.svg');
    expect(r.ok && r.bytes).toBe(plain);
    expect(isGzip(plain)).toBe(false);
    expect(plainSvgName('A.SVGZ')).toBe('A.svg');
    expect(plainSvgName('a.gz')).toBe('a.svg');
    expect(plainSvgName('noext')).toBe('noext.svg');
    expect(plainSvgName('.svgz')).toBe('drawing.svg');
  });
});
