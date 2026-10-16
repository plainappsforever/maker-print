// SVG path data (SVG 1.1 §8.3, Appendix F.6) → absolute M/L/C/Z segments. Pure.
// Quadratics become cubics exactly; elliptical arcs become ≤ 90° cubic pieces (radial error ≤ 2.7e-4 × r per piece —
// the standard 4/3·tan(δ/4) construction, end points exact). A syntax error ends the path there (SVG error rule).
import type { Point } from '@/engine/geometry';
import type { Seg } from '@/engine/path';

export type ParsedPath = { segs: Seg[]; error: boolean };

const ARGS: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
const NUM_RE = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;

class Scanner {
  i = 0;
  private s: string;
  constructor(s: string) {
    this.s = s;
  }
  skip() {
    while (this.i < this.s.length && /[\s,]/.test(this.s[this.i])) this.i++;
  }
  /** Separators: whitespace and at most one comma. */
  skipSep() {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
    if (this.s[this.i] === ',') this.i++;
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
  }
  done() {
    return this.i >= this.s.length;
  }
  peek() {
    return this.s[this.i];
  }
  command(): string | null {
    const c = this.s[this.i];
    if (c && /[MmLlHhVvCcSsQqTtAaZz]/.test(c)) {
      this.i++;
      return c;
    }
    return null;
  }
  number(): number | null {
    NUM_RE.lastIndex = this.i;
    const m = NUM_RE.exec(this.s);
    if (!m) return null;
    this.i += m[0].length;
    return Number(m[0]);
  }
  flag(): number | null {
    const c = this.s[this.i];
    if (c === '0' || c === '1') {
      this.i++;
      return c === '1' ? 1 : 0;
    }
    return null;
  }
  startsNumber() {
    const c = this.s[this.i];
    return c !== undefined && /[0-9+\-.]/.test(c);
  }
}

export type ArcCentre = { cx: number; cy: number; rx: number; ry: number; phiDeg: number; t1: number; dt: number };

/** F.6.5/F.6.6 endpoint → centre parameterisation; null = omit (same end points), 'line' = a zero radius. */
export function arcCentre(x1: number, y1: number, rxIn: number, ryIn: number, phiDeg: number, fa: number, fs: number, x2: number, y2: number): ArcCentre | null | 'line' {
  if (x1 === x2 && y1 === y2) return null;
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) return 'line';
  const phiN = ((phiDeg % 360) + 360) % 360;
  const phi = (phiN * Math.PI) / 180;
  const cp = Math.cos(phi);
  const sp = Math.sin(phi);
  const dx2 = (x1 - x2) / 2;
  const dy2 = (y1 - y2) / 2;
  const x1p = cp * dx2 + sp * dy2;
  const y1p = -sp * dx2 + cp * dy2;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let co = Math.sqrt(Math.max(0, num / den));
  if (fa === fs) co = -co;
  const cxp = (co * rx * y1p) / ry;
  const cyp = (-co * ry * x1p) / rx;
  const cx = cp * cxp - sp * cyp + (x1 + x2) / 2;
  const cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!fs && dt > 0) dt -= 2 * Math.PI;
  else if (fs && dt < 0) dt += 2 * Math.PI;
  return { cx, cy, rx, ry, phiDeg: phiN, t1, dt };
}

/** Cubic pieces (≤ 90° each) of an arc; the last end point is exactly `end`. */
export function arcToCubics(a: ArcCentre, end: Point): Seg[] {
  const phi = (a.phiDeg * Math.PI) / 180;
  const cp = Math.cos(phi);
  const sp = Math.sin(phi);
  const n = Math.max(1, Math.ceil(Math.abs(a.dt) / (Math.PI / 2) - 1e-9));
  const d = a.dt / n;
  const k = (4 / 3) * Math.tan(d / 4);
  const at = (t: number) => ({ x: a.cx + a.rx * cp * Math.cos(t) - a.ry * sp * Math.sin(t), y: a.cy + a.rx * sp * Math.cos(t) + a.ry * cp * Math.sin(t) });
  const tangent = (t: number) => ({ x: -a.rx * cp * Math.sin(t) - a.ry * sp * Math.cos(t), y: -a.rx * sp * Math.sin(t) + a.ry * cp * Math.cos(t) });
  const segs: Seg[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = a.t1 + i * d;
    const t1 = t0 + d;
    const p0 = at(t0);
    const p3 = i === n - 1 ? end : at(t1);
    const d0 = tangent(t0);
    const d1 = tangent(t1);
    segs.push({ c: 'C', p1: { x: p0.x + k * d0.x, y: p0.y + k * d0.y }, p2: { x: p3.x - k * d1.x, y: p3.y - k * d1.y }, p: p3 });
  }
  return segs;
}

export function parsePathData(d: string): ParsedPath {
  const s = new Scanner(d);
  const segs: Seg[] = [];
  let cur = { x: 0, y: 0 };
  let start = { x: 0, y: 0 };
  let lastC: Point | null = null; // second control point of the previous C/S (for S)
  let lastQ: Point | null = null; // control point of the previous Q/T (for T)
  let cmd: string | null = null;
  let hasMove = false;
  s.skip();
  while (!s.done()) {
    const c = s.command();
    if (c) cmd = c;
    else if (!cmd || !s.startsNumber() || cmd === 'Z' || cmd === 'z') return { segs, error: true };
    if (!cmd) return { segs, error: true };
    const up: string = cmd.toUpperCase();
    const rel: boolean = cmd !== up;
    if (!hasMove && up !== 'M') return { segs, error: true };
    if (up === 'Z') {
      segs.push({ c: 'Z' });
      cur = { ...start };
      lastC = lastQ = null;
      s.skip();
      continue;
    }
    s.skip();
    const args: number[] = [];
    for (let k = 0; k < ARGS[up]; k++) {
      if (k > 0) s.skipSep();
      const v = up === 'A' && (k === 3 || k === 4) ? s.flag() : s.number();
      if (v === null) return { segs, error: true };
      args.push(v);
    }
    const ox = rel ? cur.x : 0;
    const oy = rel ? cur.y : 0;
    let nextC: Point | null = null;
    let nextQ: Point | null = null;
    switch (up) {
      case 'M':
        cur = { x: ox + args[0], y: oy + args[1] };
        start = { ...cur };
        segs.push({ c: 'M', p: { ...cur } });
        hasMove = true;
        cmd = rel ? 'l' : 'L'; // further pairs are implicit line-tos
        break;
      case 'L':
        cur = { x: ox + args[0], y: oy + args[1] };
        segs.push({ c: 'L', p: { ...cur } });
        break;
      case 'H':
        cur = { x: ox + args[0], y: cur.y };
        segs.push({ c: 'L', p: { ...cur } });
        break;
      case 'V':
        cur = { x: cur.x, y: (rel ? cur.y : 0) + args[0] };
        segs.push({ c: 'L', p: { ...cur } });
        break;
      case 'C': {
        const p1 = { x: ox + args[0], y: oy + args[1] };
        const p2 = { x: ox + args[2], y: oy + args[3] };
        cur = { x: ox + args[4], y: oy + args[5] };
        segs.push({ c: 'C', p1, p2, p: { ...cur } });
        nextC = p2;
        break;
      }
      case 'S': {
        const p1 = lastC ? { x: 2 * cur.x - lastC.x, y: 2 * cur.y - lastC.y } : { ...cur };
        const p2 = { x: ox + args[0], y: oy + args[1] };
        cur = { x: ox + args[2], y: oy + args[3] };
        segs.push({ c: 'C', p1, p2, p: { ...cur } });
        nextC = p2;
        break;
      }
      case 'Q':
      case 'T': {
        const q: Point = up === 'Q' ? { x: ox + args[0], y: oy + args[1] } : lastQ ? { x: 2 * cur.x - lastQ.x, y: 2 * cur.y - lastQ.y } : { ...cur };
        const p: Point = up === 'Q' ? { x: ox + args[2], y: oy + args[3] } : { x: ox + args[0], y: oy + args[1] };
        segs.push({ c: 'C', p1: { x: cur.x + (2 / 3) * (q.x - cur.x), y: cur.y + (2 / 3) * (q.y - cur.y) }, p2: { x: p.x + (2 / 3) * (q.x - p.x), y: p.y + (2 / 3) * (q.y - p.y) }, p });
        cur = { ...p };
        nextQ = q;
        break;
      }
      case 'A': {
        const end = { x: ox + args[5], y: oy + args[6] };
        const a = arcCentre(cur.x, cur.y, args[0], args[1], args[2], args[3], args[4], end.x, end.y);
        if (a === 'line') segs.push({ c: 'L', p: end });
        else if (a) segs.push(...arcToCubics(a, end));
        cur = { ...end };
        break;
      }
    }
    lastC = nextC;
    lastQ = nextQ;
    s.skip();
  }
  return { segs, error: false };
}

/** Absolute M/L/C/Z segments → a `d` string with full double precision. */
export function segsToD(segs: readonly Seg[]): string {
  const n = (v: number) => String(v === 0 ? 0 : v);
  return segs
    .map((s) => (s.c === 'Z' ? 'Z' : s.c === 'C' ? `C${n(s.p1.x)} ${n(s.p1.y)} ${n(s.p2.x)} ${n(s.p2.y)} ${n(s.p.x)} ${n(s.p.y)}` : `${s.c}${n(s.p.x)} ${n(s.p.y)}`))
    .join('');
}
