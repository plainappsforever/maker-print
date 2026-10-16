// .svgz fixtures for src/import/svgz.test.ts (V15 X03): node scripts/fixtures/make-svgz.mjs
// valid (Inkscape mm drawing), two gzip members, svg.gz name, truncated, damaged deflate data, CRC damaged,
// and a "bomb": 128 KB that unpacks to 64 MiB (more than the 50 MB cap).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const root = path.resolve(import.meta.dirname, '../..');
const out = path.join(root, 'test/fixtures/svgz');
fs.mkdirSync(out, { recursive: true });
const svg = fs.readFileSync(path.join(root, 'test/fixtures/svg/inkscape-mm.svg'));
const gz = (b) => zlib.gzipSync(b, { level: 9, mtime: 0 });
const write = (name, b) => fs.writeFileSync(path.join(out, name), b);

const valid = gz(svg);
write('inkscape-mm.svgz', valid);
const half = Math.floor(svg.length / 2);
write('two-members.svgz', Buffer.concat([gz(svg.subarray(0, half)), gz(svg.subarray(half))]));
write('inkscape-mm.svg.gz', valid);
write('truncated.svgz', valid.subarray(0, Math.floor(valid.length * 0.6)));
const damaged = Buffer.from(valid);
for (let i = 12; i < 40; i++) damaged[i] ^= 0xa5;
write('damaged.svgz', damaged);
// a lying ISIZE footer (claims 10 bytes): the cap must hold while unpacking, not trust the footer
const head = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm"><!--');
const tail = Buffer.from('--></svg>');
const bomb = Buffer.from(gz(Buffer.concat([head, Buffer.alloc(64 * 1024 * 1024, 0x20), tail])));
bomb.writeUInt32LE(10, bomb.length - 4);
write('bomb-64mib.svgz', bomb);
console.log(fs.readdirSync(out).map((f) => `${f} ${fs.statSync(path.join(out, f)).size}`).join('\n'));
