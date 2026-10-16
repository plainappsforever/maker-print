#!/usr/bin/env node
// Files the P5 Maestro flows import through the real pickers (test/fixtures/e2e/), plus the uncommitted big files for
// the device checks (artifacts/e2e-big/). Run: node scripts/fixtures/make-e2e-fixtures.mjs [--big]
//   pattern-a2.pdf      U1: one A2 page (420 × 594 mm) — a sewing-pattern stand-in with a 100 mm test square
//   photo-2400.jpg      U2: 2400 × 1800 px photo (no declared density)
//   bracket-ruler.jpg   U6: 2000 × 1000 px; a ruler whose 0 mark is at x = 400 px and its 100 mark at x = 1600 px
//   drawing-ai72.svg    U7: unit-less 400 × 300 (Illustrator 72 ppi → 141.11 × 105.83 mm) with one <text> element
//   --big: photo-12mp.jpg (4032 × 3024, A13 drag), drawing-45mb.svg (45 MB, refusal + memory), poster-600x900.svg
// JPEGs are encoded by macOS `sips` from our PNGs (no image library needed).
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, createWriteStream } from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const require = createRequire(import.meta.url);
const { PDFDocument, rgb, StandardFonts } = require('@cantoo/pdf-lib');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'test/fixtures/e2e');
const BIG = path.join(ROOT, 'artifacts/e2e-big');
mkdirSync(OUT, { recursive: true });
const mm = (v) => (v * 72) / 25.4;

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}
/** RGB PNG from a pixel function (x, y) → [r, g, b]. */
function png(w, h, px) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    for (let x = 0; x < w; x++) {
      const [r, g, b] = px(x, y);
      raw[row + 1 + x * 3] = r;
      raw[row + 2 + x * 3] = g;
      raw[row + 3 + x * 3] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}
function jpeg(name, w, h, px, dir = OUT) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'mp-'));
  const p = path.join(tmp, 'a.png');
  writeFileSync(p, png(w, h, px));
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '90', p, '--out', path.join(dir, name)], { stdio: 'ignore' });
}

const photo = (w, h) => (x, y) => {
  const cx = x - w / 2;
  const cy = y - h / 2;
  const ring = Math.floor(Math.hypot(cx, cy) / (w / 24)) % 2;
  return ring ? [40 + (x * 200) / w, 120, 200 - (y * 150) / h] : [230, 180 - (x * 100) / w, 60 + (y * 120) / h];
};

// U1 — A2 pattern page
{
  const doc = await PDFDocument.create();
  const page = doc.addPage([mm(420), mm(594)]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawRectangle({ x: mm(20), y: mm(20), width: mm(380), height: mm(554), borderColor: rgb(0, 0, 0), borderWidth: mm(0.5) });
  page.drawEllipse({ x: mm(210), y: mm(330), xScale: mm(150), yScale: mm(220), borderColor: rgb(0.8, 0, 0), borderWidth: mm(0.8) });
  page.drawRectangle({ x: mm(40), y: mm(40), width: mm(100), height: mm(100), borderColor: rgb(0, 0, 0), borderWidth: mm(0.3) });
  page.drawText('Test square 100 x 100 mm', { x: mm(45), y: mm(85), size: 14, font });
  page.drawText('Maker Print pattern fixture - A2', { x: mm(150), y: mm(560), size: 28, font });
  writeFileSync(path.join(OUT, 'pattern-a2.pdf'), await doc.save());
}

// U2 — a photo with no declared density
jpeg('photo-2400.jpg', 2400, 1800, photo(2400, 1800));

// U6 — "bracket" photo with a ruler: 12 px per mm, 0 at x = 400, 100 at x = 1600, ticks every mm
jpeg('bracket-ruler.jpg', 2000, 1000, (x, y) => {
  if (y > 600 && y < 760) {
    // ruler body
    const k = x - 400;
    if (k >= 0 && k <= 1200 && k % 12 < 3) {
      const len = (k / 12) % 10 === 0 ? 120 : (k / 12) % 5 === 0 ? 70 : 40;
      if (y < 600 + len) return [0, 0, 0];
    }
    return [245, 225, 120];
  }
  if (x > 500 && x < 1500 && y > 150 && y < 450) return [120, 120, 130]; // the bracket
  return [210, 215, 220];
});

// U7 — Illustrator-style unit-less SVG with one text element
writeFileSync(
  path.join(OUT, 'drawing-ai72.svg'),
  `<?xml version="1.0" encoding="UTF-8"?>
<!-- Generator: Adobe Illustrator 27.0.0, SVG Export Plug-In (stand-in fixture) -->
<svg version="1.1" xmlns="http://www.w3.org/2000/svg" x="0px" y="0px" width="400" height="300" viewBox="0 0 400 300">
<style type="text/css">.st0{fill:none;stroke:#000000;stroke-width:1;}</style>
<rect class="st0" x="20" y="20" width="360" height="260"/>
<circle class="st0" cx="200" cy="150" r="80"/>
<path class="st0" d="M60,240 L340,60"/>
<text x="40" y="60" font-family="Helvetica" font-size="24">Cut here</text>
</svg>
`
);

if (process.argv.includes('--big')) {
  mkdirSync(BIG, { recursive: true });
  jpeg('photo-12mp.jpg', 4032, 3024, photo(4032, 3024), BIG);
  // 45 MB of rects: refused by the complexity budget (D54)
  const ws = createWriteStream(path.join(BIG, 'drawing-45mb.svg'));
  ws.write('<svg xmlns="http://www.w3.org/2000/svg" width="600mm" height="900mm" viewBox="0 0 600 900">\n');
  const line = '<rect x="1" y="1" width="2" height="2" fill="#000000" stroke="none"/>\n';
  const n = Math.ceil((45 * 1024 * 1024) / line.length);
  let chunkS = '';
  for (let i = 0; i < n; i++) {
    chunkS += line;
    if (chunkS.length > 1 << 20) {
      ws.write(chunkS);
      chunkS = '';
    }
  }
  ws.write(chunkS + '</svg>\n');
  ws.end();
  // 600 × 900 mm poster (W3: 15/16 tiles) for the memory check
  let d = '';
  for (let i = 0; i < 400; i++) d += `<circle cx="${(i * 37) % 600}" cy="${(i * 53) % 900}" r="${5 + (i % 40)}" fill="none" stroke="#c62828" stroke-width="0.8"/>\n`;
  writeFileSync(path.join(BIG, 'poster-600x900.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="600mm" height="900mm" viewBox="0 0 600 900">\n<rect x="0" y="0" width="600" height="900" fill="none" stroke="#000" stroke-width="2"/>\n${d}</svg>\n`);
}
console.log('ok');
