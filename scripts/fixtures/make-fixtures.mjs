#!/usr/bin/env node
// Regenerates the binary import fixtures (P3): PNG/JPEG images with known pixels, densities and EXIF orientation, and
// PDFs with known boxes (UserUnit, Rotate, CropBox, encryption, blank and corrupt files). The SVG fixtures are
// hand-written in test/fixtures/svg/ (exporter styles). Run: node scripts/fixtures/make-fixtures.mjs
// JPEGs are encoded by macOS `sips` (Apple ImageIO) from our PNGs, then our EXIF block is spliced in.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const require = createRequire(import.meta.url);
const { PDFDocument, PDFName, PDFNumber, rgb, degrees } = require('@cantoo/pdf-lib');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const IMG = path.join(ROOT, 'test/fixtures/images');
const PDF = path.join(ROOT, 'test/fixtures/pdf');
mkdirSync(IMG, { recursive: true });
mkdirSync(PDF, { recursive: true });

// ------------------------------------------------------------------------------------------------ PNG
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}
/** px(x, y) → [r, g, b] or [r, g, b, a]; `ppm` = pHYs pixels per metre (unit 1) */
function png(w, h, px, { alpha = false, ppm = null } = {}) {
  const ch = alpha ? 4 : 3;
  const raw = Buffer.alloc((w * ch + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * ch + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const c = px(x, y);
      for (let i = 0; i < ch; i++) raw[y * (w * ch + 1) + 1 + x * ch + i] = c[i] ?? 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = alpha ? 6 : 2;
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr)];
  if (ppm) {
    const p = Buffer.alloc(9);
    p.writeUInt32BE(ppm[0], 0);
    p.writeUInt32BE(ppm[1], 4);
    p[8] = 1;
    parts.push(chunk('pHYs', p));
  }
  parts.push(chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}
const RED = [255, 0, 0];
const GREEN = [0, 255, 0];
const BLUE = [0, 0, 255];
const WHITE = [255, 255, 255];
const inside = (x, y, x0, y0, x1, y1) => x >= x0 && x < x1 && y >= y0 && y < y1;

// 200 × 200, red square px [50,150)², 300 dpi declared (11811 px/m)
writeFileSync(path.join(IMG, 'red-square-300dpi.png'), png(200, 200, (x, y) => (inside(x, y, 50, 50, 150, 150) ? RED : WHITE), { ppm: [11811, 11811] }));
// 100 × 100 RGBA: opaque blue square [25,75)², elsewhere transparent BLACK (ignoring alpha would print black)
writeFileSync(path.join(IMG, 'blue-alpha.png'), png(100, 100, (x, y) => (inside(x, y, 25, 25, 75, 75) ? [...BLUE, 255] : [0, 0, 0, 0]), { alpha: true }));
// placeholder density 72 dpi (2835 px/m) → no physical size suggested
writeFileSync(path.join(IMG, 'phone-72dpi.png'), png(40, 30, () => WHITE, { ppm: [2835, 2835] }));

// ------------------------------------------------------------------------------------------------ JPEG (sips) + EXIF
function exifBlock({ orientation, xres, unit = 2 }) {
  // little-endian TIFF: IFD0 with Orientation, XResolution, YResolution, ResolutionUnit (sorted by tag)
  const entries = [];
  if (orientation) entries.push([0x0112, 3, 1, orientation]);
  if (xres) entries.push([0x011a, 5, 1, 'X'], [0x011b, 5, 1, 'Y']);
  if (unit) entries.push([0x0128, 3, 1, unit]);
  entries.sort((a, b) => a[0] - b[0]);
  const ifdStart = 8;
  const dataStart = ifdStart + 2 + entries.length * 12 + 4;
  const tiff = Buffer.alloc(dataStart + 16);
  tiff.write('II', 0, 'latin1');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(ifdStart, 4);
  tiff.writeUInt16LE(entries.length, ifdStart);
  let rat = dataStart;
  entries.forEach(([tag, type, count, value], i) => {
    const e = ifdStart + 2 + i * 12;
    tiff.writeUInt16LE(tag, e);
    tiff.writeUInt16LE(type, e + 2);
    tiff.writeUInt32LE(count, e + 4);
    if (type === 3) tiff.writeUInt16LE(value, e + 8);
    else {
      tiff.writeUInt32LE(rat, e + 8);
      tiff.writeUInt32LE(xres[0], rat);
      tiff.writeUInt32LE(xres[1], rat + 4);
      rat += 8;
    }
  });
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const head = Buffer.from([0xff, 0xe1, 0, 0]);
  head.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([head, body]);
}
/** Replaces any APP1 (EXIF/XMP) and APP13 (Photoshop: sips writes a 72 dpi ResolutionInfo there) by our EXIF block. */
function spliceExif(jpeg, exif) {
  const out = [jpeg.subarray(0, 2)];
  let o = 2;
  let inserted = false;
  while (o < jpeg.length) {
    const marker = jpeg[o + 1];
    if (marker === 0xda) {
      if (!inserted) out.push(exif);
      out.push(jpeg.subarray(o));
      break;
    }
    const len = jpeg.readUInt16BE(o + 2);
    const seg = jpeg.subarray(o, o + 2 + len);
    if (marker !== 0xe1 && marker !== 0xed) out.push(seg);
    if (marker === 0xe0 && !inserted) {
      out.push(exif);
      inserted = true;
    }
    o += 2 + len;
  }
  return Buffer.concat(out);
}
function sipsJpeg(pngBytes, name, extra = []) {
  // intermediate files live in the system temp folder, never in the repo
  const dir = mkdtempSync(path.join(os.tmpdir(), 'makerprint-fixtures-'));
  const tmp = path.join(dir, `${name}.png`);
  const outFile = path.join(dir, name);
  writeFileSync(tmp, pngBytes);
  execFileSync('/usr/bin/sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '100', ...extra, tmp, '--out', outFile], { stdio: 'ignore' });
  return readFileSync(outFile);
}
// Raw 300 × 200: red block raw [0,100)×[0,50) (top-left), green block raw [200,300)×[150,200) (bottom-right).
// EXIF orientation 6 (rotate 90° clockwise to display): displayed 200 × 300 with red top-right, green bottom-left.
const orientPng = png(300, 200, (x, y) => (inside(x, y, 0, 0, 100, 50) ? RED : inside(x, y, 200, 150, 300, 200) ? GREEN : WHITE));
const o6 = sipsJpeg(orientPng, 'orient6.jpg');
writeFileSync(path.join(IMG, 'orient6.jpg'), spliceExif(o6, exifBlock({ orientation: 6, xres: [72, 1] })));
// 300 dpi via EXIF (inch) on a 150 × 100 image → 12.7 × 8.4667 mm
const d300 = sipsJpeg(png(150, 100, (x, y) => (inside(x, y, 50, 25, 100, 75) ? BLUE : WHITE)), 'exif-300dpi.jpg');
writeFileSync(path.join(IMG, 'exif-300dpi.jpg'), spliceExif(d300, exifBlock({ orientation: 1, xres: [300, 1] })));
// JFIF-only density from sips (dpi 254 → 10 px per mm), no EXIF
const jf = sipsJpeg(png(100, 50, () => WHITE), 'jfif-254dpi.jpg', ['-s', 'dpiWidth', '254', '-s', 'dpiHeight', '254']);
const jfOut = spliceExif(jf, Buffer.alloc(0));
jfOut[13] = 1; // sips writes JFIF units 0 ("aspect ratio only"); declare dots per inch so the 254 dpi counts
writeFileSync(path.join(IMG, 'jfif-254dpi.jpg'), jfOut);
// the same with units 0 as sips wrote it: density present but meaningless → no size
const jf0 = spliceExif(jf, Buffer.alloc(0));
jf0[13] = 0;
writeFileSync(path.join(IMG, 'jfif-units0.jpg'), jf0);
// broken files
writeFileSync(path.join(IMG, 'truncated.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]));
writeFileSync(path.join(IMG, 'empty.png'), Buffer.alloc(0));
writeFileSync(path.join(IMG, 'photo.heic'), Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic', 'latin1'), Buffer.alloc(16)]));

// ------------------------------------------------------------------------------------------------ PDF
const K = 72 / 25.4; // pt per mm
const mm = (v) => v * K;
async function save(doc, name, opts = {}) {
  writeFileSync(path.join(PDF, name), await doc.save({ useObjectStreams: false, ...opts }));
}
async function newDoc() {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setProducer('Maker Print fixtures');
  return doc;
}
/** rectangle given in page mm from the TOP-LEFT of an unrotated page of height H mm */
const rectTL = (page, H, x, y, w, h, color) => page.drawRectangle({ x: mm(x), y: mm(H - y - h), width: mm(w), height: mm(h), color });

// 100 × 60 mm, red rect (10, 10) 30 × 20 mm
{
  const doc = await newDoc();
  const p = doc.addPage([mm(100), mm(60)]);
  rectTL(p, 60, 10, 10, 30, 20, rgb(1, 0, 0));
  await save(doc, 'red-100x60.pdf');
}
// UserUnit 2: MediaBox 50 × 30 "mm" of user units → 100 × 60 mm; blue rect user (5, 5) 10 × 10 → natural (10, 10) 20 × 20
{
  const doc = await newDoc();
  const p = doc.addPage([mm(50), mm(30)]);
  p.node.set(PDFName.of('UserUnit'), PDFNumber.of(2));
  rectTL(p, 30, 5, 5, 10, 10, rgb(0, 0, 1));
  await save(doc, 'userunit2.pdf');
}
// Rotate 90: unrotated 60 × 100 mm, green rect unrotated (10, 5) 20 × 10 → displayed 100 × 60, green at X 85..95, Y 10..30
{
  const doc = await newDoc();
  const p = doc.addPage([mm(60), mm(100)]);
  rectTL(p, 100, 10, 5, 20, 10, rgb(0, 1, 0));
  p.setRotation(degrees(90));
  await save(doc, 'rotate90.pdf');
}
// CropBox: MediaBox 100 × 100 mm, CropBox (25,25)-(75,75) mm; magenta inside → natural (5, 35) 20 × 10; red outside crop
{
  const doc = await newDoc();
  const p = doc.addPage([mm(100), mm(100)]);
  p.drawRectangle({ x: mm(30), y: mm(30), width: mm(20), height: mm(10), color: rgb(1, 0, 1) });
  p.drawRectangle({ x: mm(80), y: mm(80), width: mm(15), height: mm(15), color: rgb(1, 0, 0) });
  p.setCropBox(mm(25), mm(25), mm(50), mm(50));
  await save(doc, 'cropbox.pdf');
}
// W9 A2 box, three pages A4/Letter/A5 for page lists, a page without content
{
  const doc = await newDoc();
  doc.addPage([1190.55, 1683.78]).drawRectangle({ x: 10, y: 10, width: 10, height: 10 });
  doc.addPage([612, 792]).drawRectangle({ x: 10, y: 10, width: 10, height: 10 });
  doc.addPage([mm(148), mm(210)]);
  await save(doc, 'three-pages.pdf');
}
// encrypted: empty user password (restrictions only) and a real user password
for (const [name, userPassword] of [['encrypted-restricted.pdf', ''], ['encrypted-password.pdf', 'secret']]) {
  const doc = await newDoc();
  rectTL(doc.addPage([mm(100), mm(60)]), 60, 10, 10, 30, 20, rgb(1, 0, 0));
  doc.encrypt({ userPassword, ownerPassword: 'owner-fixture', permissions: { printing: 'highResolution' } });
  await save(doc, name);
}
// corrupt: a header and garbage
writeFileSync(path.join(PDF, 'corrupt.pdf'), Buffer.concat([Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog', 'latin1'), Buffer.alloc(64, 0x41)]));
console.log('fixtures written to test/fixtures/images and test/fixtures/pdf');
