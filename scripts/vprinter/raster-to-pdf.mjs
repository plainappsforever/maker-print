// Wraps a raster print job the virtual printer received (PWG Raster "RaS2" or Apple URF "UNIRAST") into a PDF whose
// MediaBox is the job's page size and whose content is the decoded bitmap at its own resolution, so the same
// CoreGraphics measurers (scripts/vprinter/measure-job.mjs) can measure raster jobs too (V1_PLAN P4 step 4).
// Decoding follows PWG 5102.4 (header + PackBits-style line compression; URF uses the same line coding).
// Usage: node scripts/vprinter/raster-to-pdf.mjs <job.pwg|job.urf> <out.pdf>   → prints pages, size, dpi
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const [input, output] = process.argv.slice(2);
const b = readFileSync(input);
const pages = [];

function decodeLines(at, width, height, bpp, white) {
  const bytesPerLine = width * bpp;
  const out = Buffer.alloc(bytesPerLine * height, white);
  let y = 0;
  while (y < height) {
    const repeat = b[at++] + 1;
    const line = Buffer.alloc(bytesPerLine, white);
    let x = 0;
    while (x < width) {
      const c = b[at++];
      if (c === 128) break; // rest of the line is blank
      if (c < 128) {
        const px = b.subarray(at, at + bpp);
        at += bpp;
        for (let k = 0; k <= c && x < width; k++, x++) px.copy(line, x * bpp);
      } else {
        const n = 257 - c;
        b.copy(line, x * bpp, at, at + n * bpp);
        at += n * bpp;
        x += n;
      }
    }
    for (let r = 0; r < repeat && y < height; r++, y++) line.copy(out, y * bytesPerLine);
  }
  return { data: out, at };
}

const magic = b.subarray(0, 8).toString('latin1');
if (magic.startsWith('RaS2')) {
  let at = 4;
  while (at < b.length) {
    const h = b.subarray(at, at + 1796);
    at += 1796;
    const dpiX = h.readUInt32BE(276), dpiY = h.readUInt32BE(280);
    const width = h.readUInt32BE(372), height = h.readUInt32BE(376);
    const bitsPerPixel = h.readUInt32BE(388), colorSpace = h.readUInt32BE(400);
    const bpp = bitsPerPixel / 8;
    // sGray (18) / sRGB (19) / DeviceGray (0) / RGB (1): white = 255; black (3) / CMYK (6): white = 0
    const white = [3, 6].includes(colorSpace) ? 0 : 255;
    const r = decodeLines(at, width, height, bpp, white);
    at = r.at;
    pages.push({ width, height, dpiX, dpiY, bpp, gray: bpp === 1, invert: white === 0, data: r.data });
  }
} else if (magic === 'UNIRAST\0') {
  const count = b.readUInt32BE(8);
  let at = 12;
  for (let p = 0; p < count; p++) {
    const bitsPerPixel = b[at], colorSpace = b[at + 1];
    const width = b.readUInt32BE(at + 12), height = b.readUInt32BE(at + 16), dpi = b.readUInt32BE(at + 20);
    at += 32;
    const bpp = bitsPerPixel / 8;
    const r = decodeLines(at, width, height, bpp, 255);
    at = r.at;
    pages.push({ width, height, dpiX: dpi, dpiY: dpi, bpp, gray: bpp === 1, invert: false, colorSpace, data: r.data });
  }
} else {
  console.error(`${input}: not PWG raster or URF (${JSON.stringify(magic)})`);
  process.exit(1);
}

// minimal PDF: one page per raster page, image drawn over the whole MediaBox
const objs = [];
const add = (body) => objs.push(body) && objs.length;
const pageIds = [];
const pagesId = pages.length * 3 + 1; // image, content and page object per page, then the page tree
for (const p of pages) {
  const data = p.bpp === 3 || p.bpp === 1 ? p.data : (() => {
    const rgb = Buffer.alloc(p.width * p.height * 3); // drop extra channels (e.g. 32-bit) by taking the first three
    for (let i = 0, j = 0; i < p.data.length; i += p.bpp, j += 3) p.data.copy(rgb, j, i, i + 3);
    return rgb;
  })();
  const z = deflateSync(p.invert ? Buffer.from(data.map((v) => 255 - v)) : data);
  const wPt = (p.width / p.dpiX) * 72, hPt = (p.height / p.dpiY) * 72;
  const img = add(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /${p.gray ? 'DeviceGray' : 'DeviceRGB'} /BitsPerComponent 8 /Filter /FlateDecode /Length ${z.length} >>\nstream\n`), z, Buffer.from('\nendstream')]));
  const content = `q ${wPt.toFixed(4)} 0 0 ${hPt.toFixed(4)} 0 0 cm /Im0 Do Q`;
  const c = add(Buffer.from(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
  pageIds.push(add(Buffer.from(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${wPt.toFixed(4)} ${hPt.toFixed(4)}] /Resources << /XObject << /Im0 ${img} 0 R >> >> /Contents ${c} 0 R >>`)));
  console.log(`page ${pageIds.length}: ${p.width} × ${p.height} px at ${p.dpiX} × ${p.dpiY} dpi = ${((p.width / p.dpiX) * 25.4).toFixed(2)} × ${((p.height / p.dpiY) * 25.4).toFixed(2)} mm, ${p.bpp * 8} bit`);
}
const pid = add(Buffer.from(`<< /Type /Pages /Kids [${pageIds.map((k) => `${k} 0 R`).join(' ')}] /Count ${pageIds.length} >>`));
if (pid !== pagesId) throw new Error(`page tree id ${pid} ≠ ${pagesId}`);
const cat = add(Buffer.from(`<< /Type /Catalog /Pages ${pid} 0 R >>`));
const chunks = [Buffer.from('%PDF-1.4\n')];
let len = chunks[0].length;
const offs = [];
objs.forEach((o, i) => {
  offs.push(len);
  const piece = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), o, Buffer.from('\nendobj\n')]);
  chunks.push(piece);
  len += piece.length;
});
const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root ${cat} 0 R >>\nstartxref\n${len}\n%%EOF\n`;
chunks.push(Buffer.from(xref));
writeFileSync(output, Buffer.concat(chunks));
