// Node fakes for the V15 phase A native interfaces (src/lib/capture/api.ts). Test-only. The fake warper is a reference
// implementation with its own square → quad mapping (Heckbert's closed form), independent of src/engine/homography.ts,
// so phase A2 can compare the native output against it; the pinhole scene makes photos with a known true shape.
import type { Pt, Quad } from '@/engine/homography';
import type { CameraCapture, CameraResult, CornerDetector, DisplayNameResolver, PerspectiveWarper, WarpRequest, WarpResult } from '@/lib/capture/api';

import { decodePng, encodePng, type Raster } from './png';

/** Files by URI: encoded bytes (what `readBytes` returns) and, for pictures made in tests, the raster. */
export class MemoryFiles {
  files = new Map<string, { bytes: Uint8Array; raster?: Raster }>();
  private n = 0;
  put(bytes: Uint8Array, raster?: Raster, uri = `mem://file/${++this.n}`): string {
    this.files.set(uri, { bytes, raster });
    return uri;
  }
  putRaster(r: Raster, uri?: string): string {
    return this.put(encodePng(r), r, uri);
  }
  readBytes = async (uri: string): Promise<Uint8Array> => {
    const f = this.files.get(uri);
    if (!f) throw new Error(`no file ${uri}`);
    return f.bytes;
  };
}

/** Square → quad (Heckbert 1989, closed form): maps (0,0),(1,0),(1,1),(0,1) to q[0..3]. Independent of src/engine. */
export function squareToQuad(q: readonly Pt[]): number[] {
  const [p0, p1, p2, p3] = q;
  const sx = p0.x - p1.x + p2.x - p3.x;
  const sy = p0.y - p1.y + p2.y - p3.y;
  if (Math.abs(sx) < 1e-12 && Math.abs(sy) < 1e-12) return [p1.x - p0.x, p2.x - p1.x, p0.x, p1.y - p0.y, p2.y - p1.y, p0.y, 0, 0, 1];
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / den;
  const h = (dx1 * sy - sx * dy1) / den;
  return [p1.x - p0.x + g * p1.x, p3.x - p0.x + h * p3.x, p0.x, p1.y - p0.y + g * p1.y, p3.y - p0.y + h * p3.y, p0.y, g, h, 1];
}

/** Reference warp: for each output pixel centre, the source point by square → quad, bilinear sample, grey output. */
export function referenceWarp(src: Raster, quad: Quad, outW: number, outH: number): Raster {
  const m = squareToQuad(quad);
  const out = new Uint8Array(outW * outH);
  const at = (x: number, y: number) => {
    const xi = Math.min(src.w - 1, Math.max(0, x));
    const yi = Math.min(src.h - 1, Math.max(0, y));
    return src.data[(yi * src.w + xi) * src.channels];
  };
  for (let j = 0; j < outH; j++) {
    for (let i = 0; i < outW; i++) {
      const u = (i + 0.5) / outW;
      const v = (j + 0.5) / outH;
      const w = m[6] * u + m[7] * v + m[8];
      const x = (m[0] * u + m[1] * v + m[2]) / w - 0.5;
      const y = (m[3] * u + m[4] * v + m[5]) / w - 0.5;
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const fx = x - x0;
      const fy = y - y0;
      const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
      const bot = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
      out[j * outW + i] = Math.round(top * (1 - fy) + bot * fy);
    }
  }
  return { w: outW, h: outH, channels: 1, data: out };
}

export class FakeWarper implements PerspectiveWarper {
  calls: WarpRequest[] = [];
  /** Test hooks: throw, or answer with another size (a buggy native side) */
  fail = false;
  sizeDelta = { w: 0, h: 0 };
  private files: MemoryFiles;
  constructor(files: MemoryFiles) {
    this.files = files;
  }
  async warp(req: WarpRequest): Promise<WarpResult> {
    this.calls.push(req);
    if (this.fail) throw new Error('native warp failed');
    const src = this.files.files.get(req.sourceUri)?.raster;
    const w = req.outW + this.sizeDelta.w;
    const h = req.outH + this.sizeDelta.h;
    const r = src ? referenceWarp(src, req.quad, w, h) : { w, h, channels: 1 as const, data: new Uint8Array(w * h).fill(200) };
    const uri = this.files.putRaster(r);
    return { uri, widthPx: w, heightPx: h };
  }
  /** The output raster of the last call. */
  last(): Raster {
    const f = [...this.files.files.values()].pop();
    return f?.raster ?? decodePng(f?.bytes ?? new Uint8Array());
  }
}

export class FakeDetector implements CornerDetector {
  private answer: Quad | null | 'throw';
  constructor(answer: Quad | null | 'throw') {
    this.answer = answer;
  }
  async detect(): Promise<Quad | null> {
    if (this.answer === 'throw') throw new Error('vision failed');
    return this.answer;
  }
}

export class FakeCamera implements CameraCapture {
  private result: CameraResult;
  constructor(result: CameraResult) {
    this.result = result;
  }
  async takePhoto(): Promise<CameraResult> {
    return this.result;
  }
}

export class FakeNames implements DisplayNameResolver {
  private names: Record<string, string>;
  constructor(names: Record<string, string>) {
    this.names = names;
  }
  async displayName(uri: string): Promise<string | null> {
    return this.names[uri] ?? null;
  }
}

// ------------------------------------------------------------------------------------------------ pinhole camera
type V3 = [number, number, number];
type M3 = [V3, V3, V3];
const rot = (ax: number, ay: number, az: number): M3 => {
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(ax), Math.sin(ax), Math.cos(ay), Math.sin(ay), Math.cos(az), Math.sin(az)];
  const Rx: M3 = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]];
  const Ry: M3 = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]];
  const Rz: M3 = [[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]];
  const mul = (a: M3, b: M3): M3 => a.map((r) => [0, 1, 2].map((j) => r[0] * b[0][j] + r[1] * b[1][j] + r[2] * b[2][j])) as M3;
  return mul(Rz, mul(Ry, Rx));
};
const mv = (m: M3, v: V3): V3 => [m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2], m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2], m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]];

/**
 * A W × H rectangle (plane coords u right, v down, centred) photographed by a pinhole camera: focal f px, principal
 * point at the image centre, the rectangle turned by (ax, ay, az) radians at distance `dist`, shifted by (tx, ty).
 */
export function pinholeScene(o: { imgW: number; imgH: number; f: number; W: number; H: number; ax: number; ay: number; az: number; dist: number; tx?: number; ty?: number }) {
  const R = rot(o.ax, o.ay, o.az);
  const t: V3 = [o.tx ?? 0, o.ty ?? 0, o.dist];
  const cx = o.imgW / 2;
  const cy = o.imgH / 2;
  const project = (u: number, v: number): Pt => {
    const p = mv(R, [u - o.W / 2, v - o.H / 2, 0]);
    const c: V3 = [p[0] + t[0], p[1] + t[1], p[2] + t[2]];
    return { x: (o.f * c[0]) / c[2] + cx, y: (o.f * c[1]) / c[2] + cy };
  };
  const n = mv(R, [0, 0, 1]);
  const Rt: M3 = [0, 1, 2].map((i) => [R[0][i], R[1][i], R[2][i]]) as M3;
  /** Image pixel → plane (u, v), by intersecting the pixel's ray with the plane (no homography involved). */
  const unproject = (x: number, y: number): { u: number; v: number } | null => {
    const d: V3 = [(x - cx) / o.f, (y - cy) / o.f, 1];
    const den = n[0] * d[0] + n[1] * d[1] + n[2] * d[2];
    if (Math.abs(den) < 1e-12) return null;
    const s = (n[0] * t[0] + n[1] * t[1] + n[2] * t[2]) / den;
    if (!(s > 0)) return null;
    const q = mv(Rt, [s * d[0] - t[0], s * d[1] - t[1], s * d[2] - t[2]]);
    return { u: q[0] + o.W / 2, v: q[1] + o.H / 2 };
  };
  const corners: Quad = [project(0, 0), project(o.W, 0), project(o.W, o.H), project(0, o.H)];
  return { corners, project, unproject };
}
