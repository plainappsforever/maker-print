// What a picked file is (SPEC §11): by its first bytes, then by its name/MIME type. Pure.
import type { AssetKind } from '@/import/assets';

export type FileKind = { kind: AssetKind; convert: boolean } | null;

/** `head` = the first ≥ 16 bytes. HEIC/HEIF/WebP/GIF/BMP/TIFF images are converted to JPEG/PNG by the platform first. */
export function fileKind(head: Uint8Array, name: string, mime?: string | null): FileKind {
  const b = head;
  const ascii = (from: number, n: number) => String.fromCharCode(...Array.from(b.subarray(from, from + n)));
  if (ascii(0, 5) === '%PDF-') return { kind: 'pdf', convert: false };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: 'image', convert: false };
  if (b[0] === 0x89 && ascii(1, 3) === 'PNG') return { kind: 'image', convert: false };
  // review N7: only HEIF/AVIF brands are pictures; other ISO-BMFF files (MP4, MOV, 3GP) are videos
  if ((ascii(4, 4) === 'ftyp' && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1|avif)$/.test(ascii(8, 4))) || (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') || ascii(0, 3) === 'GIF' || ascii(0, 2) === 'BM' || ascii(0, 4) === 'II*\0' || ascii(0, 4) === 'MM\0*') {
    return { kind: 'image', convert: true };
  }
  const n = name.toLowerCase();
  const m = (mime ?? '').toLowerCase();
  if (n.endsWith('.svg') || n.endsWith('.svgz') || m === 'image/svg+xml') return { kind: 'svg', convert: false };
  if (n.endsWith('.pdf') || m === 'application/pdf') return { kind: 'pdf', convert: false };
  // text that starts like XML (BOM, "<", UTF-16) or gzip (.svgz): the SVG reader decides and explains
  if (b[0] === 0x3c || (b[0] === 0xef && b[1] === 0xbb) || b[0] === 0xff || b[0] === 0xfe || (b[0] === 0x1f && b[1] === 0x8b)) return { kind: 'svg', convert: false };
  if (/\.(jpe?g|png|heic|heif|webp|gif|bmp|tiff?)$/.test(n) || m.startsWith('image/')) return { kind: 'image', convert: true };
  return null;
}

/** Bytes above which the importer shows "this can take a while" (D64: 10 MB SVGs take 16–40 s on the JS thread). */
export const SLOW_IMPORT_BYTES = 2 * 1024 * 1024;
