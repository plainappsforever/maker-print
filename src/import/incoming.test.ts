import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import zlib from 'node:zlib';

import {
  cleanName,
  decideIncoming,
  displayName,
  isMeaninglessName,
  looksLikeDxf,
  nameFromUri,
  nativeIntentRedirect,
  parseIncomingUrl,
  queueIncoming,
  routeFile,
  sniffIncoming,
  stampForName,
  takeIncoming,
} from './incoming';

const bytes = (s: string | number[]) => (typeof s === 'string' ? new Uint8Array(Buffer.from(s, 'latin1')) : new Uint8Array(s));
const SCHEMES = ['makerprint-dev'];

describe('parseIncomingUrl (router table)', () => {
  it.each([
    ['makerprint-dev://debug/seed?set=scan', { type: 'deeplink', path: '/debug/seed?set=scan' }],
    ['MAKERPRINT-DEV:///project/3', { type: 'deeplink', path: '/project/3' }],
    ['/project/3/print', { type: 'deeplink', path: '/project/3/print' }],
    ['file:///private/var/mobile/Containers/Data/Application/X/Documents/Inbox/Pattern%20A2.pdf', { type: 'file', uri: 'file:///private/var/mobile/Containers/Data/Application/X/Documents/Inbox/Pattern%20A2.pdf', nameHint: 'Pattern A2.pdf' }],
    ['content://com.android.providers.downloads.documents/document/msf%3A1000000034', { type: 'file', uri: 'content://com.android.providers.downloads.documents/document/msf%3A1000000034', nameHint: '1000000034' }],
    ['content://com.google.android.apps.photos.contentprovider/0/1/content%3A%2F%2Fmedia%2Fexternal%2Fimages%2Fmedia%2F34/ORIGINAL/NONE/image%2Fjpeg/1', { type: 'file', uri: 'content://com.google.android.apps.photos.contentprovider/0/1/content%3A%2F%2Fmedia%2Fexternal%2Fimages%2Fmedia%2F34/ORIGINAL/NONE/image%2Fjpeg/1', nameHint: '1' }],
    ['https://example.com/a.pdf', { type: 'unsupported' }],
    ['makerprint://project/1', { type: 'unsupported' }], // another variant's scheme
    ['mailto:x@y', { type: 'unsupported' }],
    ['', { type: 'unsupported' }],
  ])('%s', (url, expected) => {
    expect(parseIncomingUrl(url, SCHEMES)).toEqual(expected);
  });

  it('native intent: app links pass through, files go to the projects list and wait in the queue once', () => {
    expect(nativeIntentRedirect('makerprint-dev://calibrate', SCHEMES)).toEqual({ path: '/calibrate', incoming: null });
    const f = nativeIntentRedirect('file:///tmp/Inbox/a.svgz', SCHEMES);
    expect(f.path).toBe('/');
    queueIncoming(f.incoming!);
    queueIncoming(f.incoming!);
    queueIncoming({ type: 'unsupported' });
    expect(takeIncoming()).toEqual([{ type: 'file', uri: 'file:///tmp/Inbox/a.svgz', nameHint: 'a.svgz' }]);
    expect(takeIncoming()).toEqual([]);
  });
});

describe('sniffIncoming → decideIncoming', () => {
  const gz = new Uint8Array(zlib.gzipSync(Buffer.from('<svg/>')));
  it.each([
    ['PDF by bytes', bytes('%PDF-1.7\n'), 'x.bin', null, { kind: 'pdf', convert: false }],
    ['JPEG', bytes([0xff, 0xd8, 0xff, 0xe0, 0, 16]), 'IMG_1.JPG', 'image/jpeg', { kind: 'image', convert: false }],
    ['PNG', bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'a.png', null, { kind: 'image', convert: false }],
    ['HEIC (needs conversion)', bytes('\0\0\0\x18ftypheic\0\0\0\0'), 'IMG_2.HEIC', 'image/heic', { kind: 'image', convert: true }],
    ['SVG', bytes('<?xml version="1.0"?><svg'), 'a.svg', 'image/svg+xml', { kind: 'svg', convert: false }],
    ['SVGZ by bytes', gz, 'a.svgz', null, { kind: 'svg', convert: false }],
    ['ASCII DXF', bytes('  0\r\nSECTION\r\n  2\r\nHEADER\r\n'), 'part.dxf', null, { kind: 'dxf', convert: false }],
    ['ASCII DXF with 999 comment, any name', bytes('999\ndxfrw 0.6.3\n  0\nSECTION\n  2\nHEADER\n'), 'download', null, { kind: 'dxf', convert: false }],
    ['binary DXF', bytes('AutoCAD Binary DXF\r\n\x1a\0'), 'b.dxf', null, { kind: 'dxf', convert: false }],
    ['DXF by name only (odd first bytes)', bytes('$ACADVER\nAC1015'), 'odd.DXF', null, { kind: 'dxf', convert: false }],
    ['DXF by MIME only', bytes('xx'), 'file', 'image/vnd.dxf', { kind: 'dxf', convert: false }],
    ['project archive', bytes('PK\x03\x04\x14\0'), 'Bracket.makerprint', null, { kind: 'archive', convert: false }],
    ['other ZIP', bytes('PK\x03\x04\x14\0'), 'fonts.zip', 'application/zip', null],
    ['unknown text', bytes('hello'), 'notes.txt', 'text/plain', null],
  ])('%s', (_n, head, name, mime, expected) => {
    expect(sniffIncoming(head, name, mime)).toEqual(expected);
  });

  it('decisions: pictures/PDF/SVG import; DXF and archives are said, not ignored; unknown is refused', () => {
    expect(decideIncoming({ kind: 'pdf', convert: false })).toEqual({ action: 'import', kind: 'pdf', convert: false });
    expect(decideIncoming({ kind: 'image', convert: true })).toEqual({ action: 'import', kind: 'image', convert: true });
    expect(decideIncoming({ kind: 'dxf', convert: false })).toEqual({ action: 'refuse', error: 'dxfNotYet' });
    expect(decideIncoming({ kind: 'archive', convert: false })).toEqual({ action: 'refuse', error: 'archiveNotYet' });
    expect(decideIncoming(null)).toEqual({ action: 'refuse', error: 'unsupportedType' });
    expect(looksLikeDxf(bytes('<svg'))).toBe(false);
  });
});

describe('display names (X08)', () => {
  it('nameFromUri', () => {
    expect(nameFromUri('file:///a/b/Pattern%20A2.pdf?x=1#y')).toBe('Pattern A2.pdf');
    expect(nameFromUri('content://media/external/images/media/34')).toBe('34');
    expect(nameFromUri('content://com.android.externalstorage.documents/document/primary%3ADownload%2Fbracket.svg')).toBe('bracket.svg');
    expect(nameFromUri('content://x/document/image%3A34')).toBe('34');
    expect(nameFromUri('file:///')).toBeNull();
    expect(nameFromUri('file:///a/%E0%A4%A')).toBe('%E0%A4%A');
  });

  it.each([
    ['34.jpg', true],
    ['1000000034', true],
    ['F3A1B2C4-1111-2222-3333-444455556666.jpg', true],
    ['image:34', true],
    ['msf:12', true],
    ['', true],
    ['IMG_1234.HEIC', false],
    ['Schnittmuster Größe 38.pdf', false],
    ['2026 bracket.svg', false],
  ])('meaningless %s → %s', (name, expected) => {
    expect(isMeaninglessName(name)).toBe(expected);
  });

  const stem = 'Photo 2026-10-16 11.58';
  it.each([
    ['native name wins', { resolved: 'Bracket.jpg', picked: '34.jpg', uri: 'content://m/34', kind: 'jpeg' as const }, 'Bracket.jpg'],
    ['Android photo with only an id → stamp', { resolved: null, picked: '34.jpg', uri: 'content://media/external/images/media/34', kind: 'jpeg' as const }, 'Photo 2026-10-16 11.58.jpg'],
    ['iOS camera UUID → stamp', { picked: 'F3A1B2C4-1111-2222-3333-444455556666.jpg', kind: 'jpeg' as const }, 'Photo 2026-10-16 11.58.jpg'],
    ['HEIC converted to JPEG keeps the stem', { picked: 'IMG_1234.HEIC', kind: 'jpeg' as const }, 'IMG_1234.jpg'],
    ['.jpeg is a JPEG', { picked: 'scan.jpeg', kind: 'jpeg' as const }, 'scan.jpeg'],
    ['misnamed picture gets its real extension', { picked: 'logo.jpg', kind: 'png' as const }, 'logo.png'],
    ['svgz stored as svg', { picked: 'Bracket.svgz', kind: 'svg' as const }, 'Bracket.svg'],
    ['svg.gz stored as svg', { picked: 'Bracket.svg.gz', kind: 'svg' as const }, 'Bracket.svg'],
    ['PDF without extension', { uri: 'file:///Inbox/Schnittmuster', kind: 'pdf' as const }, 'Schnittmuster.pdf'],
    ['unknown kind keeps the name', { picked: 'a.weird', kind: null }, 'a.weird'],
    ['folders and reserved characters', { picked: 'a/b\\c:d*e?.pdf', kind: 'pdf' as const }, 'c d e .pdf'],
  ])('%s', (_n, c, expected) => {
    expect(displayName({ ...c, fallbackStem: stem })).toBe(expected);
  });

  it('long names are cut to 120 characters keeping the extension; stamps have no colon', () => {
    const n = cleanName(`${'x'.repeat(200)}.pdf`);
    expect(n.length).toBe(120);
    expect(n.endsWith('.pdf')).toBe(true);
    expect(stampForName(new Date(2026, 9, 6, 9, 5))).toBe('2026-10-06 09.05');
  });
});

describe('review S6: the picker path routes files like open-in', () => {
  const dxf = bytes('  0\r\nSECTION\r\n  2\r\nHEADER\r\n  9\r\n$ACADVER\r\n');
  it.each([
    ['DXF from Files (octet-stream)', dxf, 'bracket.dxf', 'application/octet-stream', { action: 'refuse', error: 'dxfNotYet' }],
    ['DXF named .svg', dxf, 'bracket.svg', 'image/svg+xml', { action: 'refuse', error: 'dxfNotYet' }],
    ['DXF named .png', dxf, 'x.png', 'image/png', { action: 'refuse', error: 'dxfNotYet' }],
    ['.makerprint ZIP', bytes('PK\x03\x04\x14\0'), 'Bracket.makerprint', 'application/octet-stream', { action: 'refuse', error: 'archiveNotYet' }],
    ['other ZIP', bytes('PK\x03\x04\x14\0'), 'fonts.zip', 'application/zip', { action: 'refuse', error: 'unsupportedType' }],
    ['unknown bytes, unknown name', bytes('\x00\x01\x02 nothing'), 'notes.bin', 'application/octet-stream', { action: 'refuse', error: 'unsupportedType' }],
    ['PDF named .dxf', bytes('%PDF-1.7\n'), 'part.dxf', null, { action: 'import', kind: 'pdf', convert: false }],
    ['JPEG', bytes([0xff, 0xd8, 0xff, 0xe0]), 'a.jpg', 'image/jpeg', { action: 'import', kind: 'image', convert: false }],
    ['HEIC', bytes('\0\0\0\x18ftypheic\0\0\0\0'), 'IMG_1.HEIC', 'image/heic', { action: 'import', kind: 'image', convert: true }],
    ['gzip named .svgz', bytes([0x1f, 0x8b, 8, 0]), 'logo.svgz', null, { action: 'import', kind: 'svg', convert: false }],
  ])('%s', (_label, head, name, mime, want) => {
    expect(routeFile(head as Uint8Array, name as string, mime as string | null)).toEqual(want);
  });

  it('a DXF header after a long 999 comment is still seen (the whole head is sniffed, not 32 bytes)', () => {
    const long = bytes(`999\n${'x'.repeat(200)}\n  0\nSECTION\n  2\nHEADER\n`);
    expect(routeFile(long, 'download', null)).toEqual({ action: 'refuse', error: 'dxfNotYet' });
  });

  it('src/lib/import.ts prepares picked files through routeFile, never fileKind alone', () => {
    const src = readFileSync(join(__dirname, '../lib/import.ts'), 'utf8');
    expect(src).toMatch(/routeFile\(bytes, picked\.name, picked\.mimeType\)/);
    expect(src).not.toMatch(/\bfileKind\(/);
  });
});

describe('review NICE one-liners', () => {
  it('N6: bidirectional controls are stripped; "." / ".." are meaningless names', () => {
    expect(cleanName('a\u202Egpj.exe')).toBe('a gpj.exe');
    expect(cleanName('\u2066Plan\u2069.pdf')).toBe('Plan .pdf');
    expect(isMeaninglessName('..')).toBe(true);
    expect(isMeaninglessName('.')).toBe(true);
    expect(displayName({ picked: '..', kind: 'pdf', fallbackStem: 'File 2026-10-16 11.58' })).toBe('File 2026-10-16 11.58.pdf');
  });

  it('N7: MP4/MOV/3GP (ISO-BMFF video brands) are not pictures; HEIC/AVIF still are', () => {
    const ftyp = (brand: string) => bytes(`\0\0\0\x18ftyp${brand}\0\0\0\0`);
    for (const b of ['isom', 'mp42', 'qt  ', '3gp4', 'M4V ']) {
      expect(sniffIncoming(ftyp(b), 'clip.mp4', 'video/mp4')).toBeNull();
      expect(routeFile(ftyp(b), 'clip.mov', null)).toEqual({ action: 'refuse', error: 'unsupportedType' });
    }
    for (const b of ['heic', 'mif1', 'avif']) expect(sniffIncoming(ftyp(b), 'x', null)).toEqual({ kind: 'image', convert: true });
  });
});
