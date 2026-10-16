import { FakeDetector, FakeWarper, MemoryFiles, pinholeScene } from '../../../test/fakes/capture';
import { type Raster } from '../../../test/fakes/png';
import { FULL_FRAME_DIAGONAL_MM, type Quad } from '@/engine/homography';
import { defaultQuad } from '@/engine/scan';

import { finishScan, startScan } from './scan-flow';

/** A photo of a W × H mm checkerboard (10 mm squares, black/white) taken by a pinhole camera; grey 128 background. */
function photographBoard(o: { imgW: number; imgH: number; W: number; H: number; ax: number; ay: number; az: number }) {
  const diag = Math.hypot(o.imgW, o.imgH);
  const f = 0.8 * diag;
  const scene = pinholeScene({ ...o, f, dist: (f * Math.max(o.W, o.H)) / (0.75 * o.imgH) });
  const data = new Uint8Array(o.imgW * o.imgH);
  // 3 × 3 supersampling so edges are anti-aliased like a camera's
  for (let y = 0; y < o.imgH; y++) {
    for (let x = 0; x < o.imgW; x++) {
      let sum = 0;
      for (let sy = 0; sy < 3; sy++) {
        for (let sx = 0; sx < 3; sx++) {
          const p = scene.unproject(x + (sx + 0.5) / 3, y + (sy + 0.5) / 3);
          if (!p || p.u < 0 || p.v < 0 || p.u > o.W || p.v > o.H) sum += 128;
          else sum += (Math.floor(p.u / 10) + Math.floor(p.v / 10)) % 2 === 0 ? 0 : 255;
        }
      }
      data[y * o.imgW + x] = Math.round(sum / 9);
    }
  }
  return { scene, raster: { w: o.imgW, h: o.imgH, channels: 1 as const, data }, focal35: (f / diag) * FULL_FRAME_DIAGONAL_MM };
}

/** A tiny JPEG header (SOI, APP1 Exif with FocalLengthIn35mmFilm as SHORT, SOF0 4 × 3), little-endian. */
function jpegWithFocal(f: number): Uint8Array {
  const u16 = (v: number) => [v & 0xff, v >> 8];
  const u32 = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24];
  const tiff = [0x49, 0x49, ...u16(42), ...u32(8), ...u16(1), ...u16(0x8769), ...u16(4), ...u32(1), ...u32(26), ...u32(0), ...u16(1), ...u16(0xa405), ...u16(3), ...u32(1), ...u16(f), 0, 0, ...u32(0)];
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const sof = [0xff, 0xc0, 0, 11, 8, 0, 3, 0, 4, 1, 1, 0x11, 0];
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, (app1.length + 2) >> 8, (app1.length + 2) & 0xff, ...app1, ...sof, 0xff, 0xd9]);
}

describe('scan flow with Node fakes (A1; the native warp/detector/camera are phase A2)', () => {
  const W = 120;
  const H = 80;
  const shot = photographBoard({ imgW: 640, imgH: 480, W, H, ax: 0.45, ay: -0.3, az: 0.1 });

  it('review S7: the picker’s focal length passes through when the file has none (HEIC converted to JPEG); the file’s own wins', async () => {
    const files = new MemoryFiles();
    const uri = files.putRaster(shot.raster); // a PNG: no EXIF, like a converted HEIC
    const viaPicker = await startScan({ readBytes: files.readBytes }, { uri, name: 'IMG_1.jpg', focal35mm: 26 });
    expect(viaPicker.ok && viaPicker.start.focal35mm).toBe(26);
    const none = await startScan({ readBytes: files.readBytes }, { uri, name: 'IMG_1.jpg' });
    expect(none.ok && none.start.focal35mm).toBeNull();
    // a JPEG whose bytes carry FocalLengthIn35mmFilm 52: the bytes win over the picker's value
    const jpeg = jpegWithFocal(52);
    const ju = files.put(jpeg);
    const own = await startScan({ readBytes: files.readBytes }, { uri: ju, name: 'a.jpg', focal35mm: 26 });
    expect(own.ok && own.start.focal35mm).toBe(52);
  });

  it('start: detector corners are used when sane; a failing or absurd detector falls back to 10 % corners', async () => {
    const files = new MemoryFiles();
    const uri = files.putRaster(shot.raster);
    const good = await startScan({ readBytes: files.readBytes, detector: new FakeDetector(shot.scene.corners) }, { uri, name: 'IMG_1.png' });
    expect(good.ok && good.start).toMatchObject({ sourcePx: { w: 640, h: 480 }, detected: true, quad: shot.scene.corners });
    const tiny: Quad = [
      { x: 1, y: 1 },
      { x: 5, y: 1 },
      { x: 5, y: 5 },
      { x: 1, y: 5 },
    ];
    for (const d of [new FakeDetector(null), new FakeDetector('throw'), new FakeDetector(tiny), null]) {
      const r = await startScan({ readBytes: files.readBytes, detector: d }, { uri, name: 'IMG_1.png' });
      expect(r.ok && r.start).toMatchObject({ detected: false, quad: defaultQuad({ w: 640, h: 480 }) });
    }
    const bad = await startScan({ readBytes: files.readBytes }, { uri: files.put(new Uint8Array([1, 2, 3])), name: 'x' });
    expect(bad).toEqual({ ok: false, error: 'corrupt' });
  });

  it('finish: the straightened board matches the real board pixel for pixel away from square edges, at the typed size', async () => {
    const files = new MemoryFiles();
    const uri = files.putRaster(shot.raster);
    const warper = new FakeWarper(files);
    const r = await finishScan(
      { readBytes: files.readBytes, warper },
      { source: { uri, name: 'IMG_1.png' }, sourcePx: { w: 640, h: 480 }, corners: shot.scene.corners, known: { kind: 'rect', wMm: W, hMm: H }, ppiTarget: 300, outName: 'Scan 1.jpg' }
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { image } = r;
    expect(image.name).toBe('Scan 1.jpg');
    // the size in mm is the typed one, not the PNG's (absent) density
    const rep = image.inspected.report;
    expect(rep.kind === 'image' && rep.sizeMm).toEqual({ w: W, h: H });
    expect(rep.kind === 'image' && rep.scan).toMatchObject({ v: 1, known: { kind: 'rect', wMm: W, hMm: H }, warnings: ['lowDetail'] }); // a 640 px photo of 120 mm: soft, and said
    expect(warper.calls[0]).toMatchObject({ sourceUri: uri, outW: image.plan.outPx.w, outH: image.plan.outPx.h, quality: 0.92 });
    // compare with the ideal board at the output resolution (skip pixels within 1.5 px of a square edge)
    const out: Raster = warper.last();
    const mmPerPx = W / out.w;
    let compared = 0;
    let wrong = 0;
    for (let j = 0; j < out.h; j++) {
      for (let i = 0; i < out.w; i++) {
        const u = (i + 0.5) * mmPerPx;
        const v = (j + 0.5) * (H / out.h);
        const du = Math.min(u % 10, 10 - (u % 10)) / mmPerPx;
        const dv = Math.min(v % 10, 10 - (v % 10)) / (H / out.h);
        if (du < 1.5 || dv < 1.5) continue;
        compared++;
        const ideal = (Math.floor(u / 10) + Math.floor(v / 10)) % 2 === 0 ? 0 : 255;
        if (Math.abs(out.data[j * out.w + i] - ideal) > 100) wrong++;
      }
    }
    expect(compared).toBeGreaterThan(out.w * out.h * 0.2);
    expect(wrong).toBe(0);
  });

  it('one side typed: the other is estimated from the photo (EXIF lens) and said', async () => {
    const files = new MemoryFiles();
    const uri = files.putRaster(shot.raster);
    const r = await finishScan(
      { readBytes: files.readBytes, warper: new FakeWarper(files) },
      { source: { uri, name: 'a' }, sourcePx: { w: 640, h: 480 }, corners: shot.scene.corners, known: { kind: 'width', mm: W }, ppiTarget: 300, focal35mm: shot.focal35, outName: 's.jpg' }
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const rep = r.image.inspected.report;
    expect(rep.kind === 'image' && rep.sizeMm!.h).toBeCloseTo(H, 6);
    expect(rep.kind === 'image' && rep.scan!.warnings).toContain('aspectEstimated');
  });

  it('native failures are said, never imported: warp throws, wrong output size, unreadable output', async () => {
    const files = new MemoryFiles();
    const uri = files.putRaster(shot.raster);
    const input = { source: { uri, name: 'a' }, sourcePx: { w: 640, h: 480 }, corners: shot.scene.corners, known: { kind: 'rect' as const, wMm: W, hMm: H }, ppiTarget: 300, outName: 's.jpg' };
    const throwing = new FakeWarper(files);
    throwing.fail = true;
    expect(await finishScan({ readBytes: files.readBytes, warper: throwing }, input)).toEqual({ ok: false, error: 'warpFailed' });
    const swapped = new FakeWarper(files);
    swapped.sizeDelta = { w: 30, h: -20 };
    expect(await finishScan({ readBytes: files.readBytes, warper: swapped }, input)).toEqual({ ok: false, error: 'warpFailed' });
    const liar = { warp: async () => ({ uri: files.put(new Uint8Array([0, 1, 2, 3])), widthPx: 1, heightPx: 1 }) };
    expect(await finishScan({ readBytes: files.readBytes, warper: liar }, input)).toEqual({ ok: false, error: 'warpFailed' });
    const unreadable = { warp: async (q: { outW: number; outH: number }) => ({ uri: files.put(new Uint8Array([0, 1, 2, 3])), widthPx: q.outW, heightPx: q.outH }) };
    expect(await finishScan({ readBytes: files.readBytes, warper: unreadable }, input)).toEqual({ ok: false, error: 'corrupt' });
    // planner refusals come through unchanged
    expect(await finishScan({ readBytes: files.readBytes, warper: new FakeWarper(files) }, { ...input, known: { kind: 'rect', wMm: 0, hMm: 1 } })).toEqual({ ok: false, error: 'badLength' });
  });
});
