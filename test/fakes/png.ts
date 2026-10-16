// Minimal PNG encoder/decoder for Node tests (8-bit grey or RGBA, filter 0 only). Test-only.
import zlib from 'node:zlib';

export type Raster = { w: number; h: number; channels: 1 | 4; data: Uint8Array };

function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

export function encodePng(r: Raster): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(r.w, 0);
  ihdr.writeUInt32BE(r.h, 4);
  ihdr[8] = 8;
  ihdr[9] = r.channels === 1 ? 0 : 6;
  const stride = r.w * r.channels;
  const raw = Buffer.alloc((stride + 1) * r.h);
  for (let y = 0; y < r.h; y++) raw.set(r.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return new Uint8Array(Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', new Uint8Array(0))]));
}

/** Decodes what `encodePng` writes (filter type 0 rows only). */
export function decodePng(b: Uint8Array): Raster {
  const buf = Buffer.from(b);
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  const channels = buf[25] === 0 ? 1 : 4;
  const idat: Buffer[] = [];
  let o = 8;
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString('ascii', o + 4, o + 8);
    if (type === 'IDAT') idat.push(buf.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const data = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    if (raw[y * (stride + 1)] !== 0) throw new Error('decodePng: only filter 0');
    data.set(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), y * stride);
  }
  return { w, h, channels: channels as 1 | 4, data };
}
