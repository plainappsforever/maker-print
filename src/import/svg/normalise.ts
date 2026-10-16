// SVG normaliser (D24, D49): parses an SVG file with @xmldom/xmldom and resolves everything that exporters write
// differently — <style> rules, the CSS cascade and inheritance, <use>/<symbol>, nested viewports, clip paths, shapes,
// units — into a flat list of absolute paths with explicit paint, in the root viewBox's user space (y down). The PDF
// painter draws exactly this list; whatever cannot be drawn is counted in the report, never dropped silently.
// Pure (no React/Expo); runs in Node (Jest, referee) and on Hermes.
import { DOMParser } from '@xmldom/xmldom';

import { apply, compose, IDENTITY, type Affine } from '@/engine/geometry';
import type { Rgb, Seg } from '@/engine/path';
import { MM_PER_IN } from '@/engine/units';

import { parsePathData, segsToD } from './path-data';
import { ReportBuilder, type SvgReport } from './report';
import { matches, parseColor, parseCss, parseDeclarations, parsePaint, parseTransform, type CssRule, type Declarations, type MatchElement, type Paint } from './style';
import { CSS_PX_PER_IN, parsePreserveAspectRatio, parseRootLength, parseViewBox, userLength, viewportMatrix, type PreserveAspectRatio, type ViewBox } from './units';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

export type SvgFill = { rgb: Rgb; alpha: number; evenOdd: boolean };
export type SvgStroke = { rgb: Rgb; alpha: number; width: number; cap: 'butt' | 'round' | 'square'; join: 'miter' | 'round' | 'bevel'; miter: number; dash: number[] | null; dashOffset: number };
/** A clip region: path in its own user space, mapped to the root by `matrix`. */
export type SvgClip = { segs: Seg[]; matrix: Affine; evenOdd: boolean };
/** One drawable path: `segs` in its user space, `matrix` = that space → root user space. Fill first, then stroke. */
export type SvgItem = { segs: Seg[]; matrix: Affine; clips: SvgClip[]; fill: SvgFill | null; stroke: SvgStroke | null };
export type SvgDrawing = {
  /** Root user space shown in the viewport (synthesised from width/height when the file has none) */
  viewBox: ViewBox;
  par: PreserveAspectRatio;
  items: SvgItem[];
  /** Root attributes for the physical size (SPEC §8.9) */
  root: { width: string | null; height: string | null; viewBox: string | null };
};
export type SvgReadError = 'invalidXml' | 'notSvg' | 'noSize' | 'badLength' | 'badViewBox' | 'empty' | 'tooComplex';

/**
 * Resource budget (P3.5 finding 3): a 2 KB file of 29 nested doubling <use> levels expanded to 2^29 elements (Node OOM
 * at 4.4 GB) and 20 000 nested <g> overflowed the stack. Above any of these the file is refused (`tooComplex`, EN/DE
 * message) — fast and with a clear reason, never a crash or a silently partial drawing. Element visits count every
 * instantiation (each <use> copy again). Node numbers; Hermes is measured in P4 (L11).
 */
export const SVG_BUDGET = { depth: 200, visits: 500_000, uses: 50_000, items: 200_000, segments: 2_000_000 } as const;
class TooComplex extends Error {}
export type SvgRead = { ok: true; drawing: SvgDrawing; report: SvgReport } | { ok: false; error: SvgReadError; report?: SvgReport };

// ------------------------------------------------------------------------------------------------ properties
type Computed = {
  fill: Paint;
  fillOpacity: number;
  fillRule: 'nonzero' | 'evenodd';
  stroke: Paint;
  strokeWidth: number;
  strokeOpacity: number;
  cap: SvgStroke['cap'];
  join: SvgStroke['join'];
  miter: number;
  dash: number[] | null;
  dashOffset: number;
  visibility: boolean;
  color: Rgb;
  clipRule: 'nonzero' | 'evenodd';
  /** product of the ancestors' and own `opacity` (group opacity approximated per path, reported) */
  opacity: number;
};
const INITIAL: Computed = {
  fill: { kind: 'color', rgb: [0, 0, 0], alpha: 1 },
  fillOpacity: 1,
  fillRule: 'nonzero',
  stroke: { kind: 'none' },
  strokeWidth: 1,
  strokeOpacity: 1,
  cap: 'butt',
  join: 'miter',
  miter: 4,
  dash: null,
  dashOffset: 0,
  visibility: true,
  color: [0, 0, 0],
  clipRule: 'nonzero',
  opacity: 1,
};
const PROPS = [
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin',
  'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'display', 'visibility', 'color', 'clip-path',
  'clip-rule', 'mask', 'filter', 'marker', 'marker-start', 'marker-mid', 'marker-end', 'paint-order', 'vector-effect',
  'mix-blend-mode', 'stop-color', 'stop-opacity',
];
const NON_RENDERING = new Set(['title', 'desc', 'metadata', 'defs', 'style', 'script', 'symbol', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'filter', 'marker', 'pattern', 'view', 'cursor', 'font', 'font-face', 'glyph', 'missing-glyph', 'hkern', 'vkern', 'color-profile', 'mpath', 'desc']);
const ANIMATION = new Set(['animate', 'animateMotion', 'animateTransform', 'animateColor', 'set', 'discard']);
const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);

type El = Element;
const isSvgEl = (n: Node): n is El => n.nodeType === 1 && ((n as El).namespaceURI === SVG_NS || (n as El).namespaceURI === null);
const children = (e: El): El[] => {
  const out: El[] = [];
  for (let n = e.firstChild; n; n = n.nextSibling) if (isSvgEl(n)) out.push(n);
  return out;
};
const nameOf = (e: El) => e.localName ?? e.nodeName;
const attr = (e: El, name: string): string | null => (e.hasAttribute(name) ? e.getAttribute(name) : null);
const hrefOf = (e: El): string | null => attr(e, 'href') ?? (e.hasAttributeNS(XLINK_NS, 'href') ? e.getAttributeNS(XLINK_NS, 'href') : attr(e, 'xlink:href'));

/** Expands internal-subset entities (old Illustrator: xmlns="&ns_svg;") that xmldom leaves unresolved. */
function expandEntities(text: string): string {
  const subset = /<!DOCTYPE[^[>]*\[([\s\S]*?)\]\s*>/.exec(text);
  if (!subset) return text;
  const ents = new Map<string, string>();
  for (const m of subset[1].matchAll(/<!ENTITY\s+([\w.-]+)\s+(["'])([\s\S]*?)\2\s*>/g)) ents.set(m[1], m[3]);
  if (!ents.size) return text;
  const body = text.slice(subset.index + subset[0].length);
  return text.slice(0, subset.index) + body.replace(/&([\w.-]+);/g, (m, n: string) => ents.get(n) ?? m);
}

type Viewport = { w: number; h: number };
type Ctx = { ctm: Affine; clips: SvgClip[]; vp: Viewport; useStack: El[] };

class Normaliser {
  report = new ReportBuilder();
  /** User languages for `systemLanguage` (P3.5 finding 10); P5 passes the app language */
  languages: readonly string[] = ['en'];
  items: SvgItem[] = [];
  private visits = 0;
  private uses = 0;
  private segCount = 0;
  private depth = 0;
  rules: CssRule[] = [];
  ids = new Map<string, El>();
  private matchCache = new Map<El, MatchElement>();

  private root: El;
  constructor(root: El) {
    this.root = root;
  }

  // ---------------------------------------------------------------------------------------------- setup
  collect() {
    const styles: string[] = [];
    // iterative, document order, with a depth check before any recursive pass (finding 3)
    const stack: [El, number][] = [[this.root, 1]];
    while (stack.length) {
      const [e, d] = stack.pop()!;
      if (d > SVG_BUDGET.depth) throw new TooComplex(`nesting deeper than ${SVG_BUDGET.depth}`);
      const id = attr(e, 'id');
      if (id && !this.ids.has(id)) this.ids.set(id, e);
      if (nameOf(e) === 'style') styles.push(e.textContent ?? '');
      const kids = children(e);
      for (let i = kids.length - 1; i >= 0; i--) stack.push([kids[i], d + 1]);
    }
    let order = 0;
    for (const s of styles) {
      const css = parseCss(s, order);
      order += css.rules.length;
      for (const r of css.rules) this.rules.push(r);
      for (const sel of css.unsupportedSelectors) this.report.add('cssSelector', sel);
      for (const at of css.atRules) if (at !== 'font-face' && at !== 'charset' && at !== 'namespace') this.report.add('cssAtRule', '@' + at);
    }
    this.rules.sort((a, b) => a.selector.specificity - b.selector.specificity || a.order - b.order);
    this.checkExpansion();
  }

  /**
   * Static size of the drawing with every <use> expanded (finding 3, "depth × count"): size(e) = 1 + Σ size(children),
   * a <use> adds the size of its target. Iterative post-order with memo; a reference back into the current chain
   * counts 1 (the walk reports it as useRecursive). Refuses the doubling bomb in milliseconds, before any walk.
   */
  private checkExpansion() {
    const size = new Map<El, number>();
    const onPath = new Set<El>();
    const target = (e: El): El | undefined => {
      if (nameOf(e) !== 'use') return undefined;
      const href = hrefOf(e);
      return href?.startsWith('#') ? this.ids.get(href.slice(1)) : undefined;
    };
    const deps = (e: El): El[] => {
      const t = target(e);
      return t ? [...children(e), t] : children(e);
    };
    const stack: { e: El; kids: El[]; i: number; sum: number }[] = [{ e: this.root, kids: deps(this.root), i: 0, sum: 1 }];
    onPath.add(this.root);
    while (stack.length) {
      const top = stack[stack.length - 1];
      if (top.i < top.kids.length) {
        const k = top.kids[top.i++];
        const known = size.get(k);
        if (known !== undefined) top.sum += known;
        else if (onPath.has(k) || stack.length >= SVG_BUDGET.depth) top.sum += 1;
        else {
          onPath.add(k);
          stack.push({ e: k, kids: deps(k), i: 0, sum: 1 });
        }
        if (top.sum > SVG_BUDGET.visits) throw new TooComplex(`more than ${SVG_BUDGET.visits} elements once <use> is expanded`);
        continue;
      }
      stack.pop();
      onPath.delete(top.e);
      size.set(top.e, top.sum);
      if (stack.length) stack[stack.length - 1].sum += top.sum;
      if (stack.length && stack[stack.length - 1].sum > SVG_BUDGET.visits) throw new TooComplex(`more than ${SVG_BUDGET.visits} elements once <use> is expanded`);
    }
  }

  private matchView(e: El): MatchElement {
    const hit = this.matchCache.get(e);
    if (hit) return hit;
    const p = e.parentNode && e.parentNode.nodeType === 1 ? (e.parentNode as El) : null;
    const view: MatchElement = { tag: nameOf(e), id: attr(e, 'id'), classes: (attr(e, 'class') ?? '').split(/\s+/).filter(Boolean), parent: p ? this.matchView(p) : null };
    this.matchCache.set(e, view);
    return view;
  }

  /** Cascade: presentation attributes < CSS rules < style attribute < !important rules < !important style. */
  specified(e: El): Map<string, string> {
    const out = new Map<string, string>();
    for (const p of PROPS) {
      const v = attr(e, p);
      if (v !== null && v.trim() !== '') out.set(p, v.trim());
    }
    const style: Declarations = parseDeclarations(attr(e, 'style') ?? '');
    const matched = this.rules.length ? this.rules.filter((r) => matches(r.selector, this.matchView(e))) : [];
    for (const r of matched) for (const [k, v] of r.decls) if (!v.important) out.set(k, v.value);
    for (const [k, v] of style) if (!v.important) out.set(k, v.value);
    for (const r of matched) for (const [k, v] of r.decls) if (v.important) out.set(k, v.value);
    for (const [k, v] of style) if (v.important) out.set(k, v.value);
    return out;
  }

  private num(v: string | undefined, fallback: number, ref: number, what: string): number {
    if (v === undefined) return fallback;
    const l = userLength(v, ref);
    if (l.ok) return l.value;
    if (l.reason === 'relativeUnit') {
      this.report.add('relativeUnit', `${what}=${v}`);
      return l.value;
    }
    this.report.add('invalidLength', `${what}=${v}`);
    return fallback;
  }

  computed(e: El, parent: Computed, vp: Viewport): { c: Computed; spec: Map<string, string> } {
    const s = this.specified(e);
    if (s.has('transform')) this.report.add('cssTransform', `<${nameOf(e)}> ${s.get('transform')}`);
    const c: Computed = { ...parent, opacity: parent.opacity };
    const diag = Math.sqrt((vp.w * vp.w + vp.h * vp.h) / 2);
    const get = (k: string) => {
      const v = s.get(k);
      return v === 'inherit' ? undefined : v;
    };
    const paint = (k: 'fill' | 'stroke') => {
      const v = get(k);
      if (v === undefined) return;
      const p = parsePaint(v);
      if (p.kind === 'invalid') this.report.add('invalidPaint', `${k}=${v}`);
      else c[k] = p;
    };
    paint('fill');
    paint('stroke');
    const opacityOf = (v: string | undefined, fallback: number) => {
      if (v === undefined) return fallback;
      const n = parseFloat(v);
      if (!Number.isFinite(n)) return fallback;
      return Math.min(1, Math.max(0, v.trim().endsWith('%') ? n / 100 : n));
    };
    c.fillOpacity = opacityOf(get('fill-opacity'), parent.fillOpacity);
    c.strokeOpacity = opacityOf(get('stroke-opacity'), parent.strokeOpacity);
    const fr = get('fill-rule');
    if (fr === 'evenodd' || fr === 'nonzero') c.fillRule = fr;
    const cr = get('clip-rule');
    if (cr === 'evenodd' || cr === 'nonzero') c.clipRule = cr;
    const sw = get('stroke-width');
    if (sw !== undefined) {
      const w = this.num(sw, parent.strokeWidth, diag, 'stroke-width');
      c.strokeWidth = w >= 0 ? w : parent.strokeWidth;
    }
    const cap = get('stroke-linecap');
    if (cap === 'butt' || cap === 'round' || cap === 'square') c.cap = cap;
    const join = get('stroke-linejoin');
    if (join === 'miter' || join === 'round' || join === 'bevel') c.join = join;
    else if (join === 'miter-clip' || join === 'arcs') c.join = 'miter';
    const ml = get('stroke-miterlimit');
    if (ml !== undefined && Number(ml) >= 1) c.miter = Number(ml);
    const da = get('stroke-dasharray');
    if (da !== undefined) {
      if (da === 'none') c.dash = null;
      else {
        const parts = da.split(/[\s,]+/).filter(Boolean).map((p) => this.num(p, NaN, diag, 'stroke-dasharray'));
        const ok = parts.length > 0 && parts.every((p) => Number.isFinite(p) && p >= 0) && parts.some((p) => p > 0);
        c.dash = ok ? (parts.length % 2 ? [...parts, ...parts] : parts) : null;
      }
    }
    const doff = get('stroke-dashoffset');
    if (doff !== undefined) c.dashOffset = this.num(doff, 0, diag, 'stroke-dashoffset');
    const vis = get('visibility');
    if (vis !== undefined) c.visibility = vis === 'visible';
    const col = get('color');
    if (col !== undefined) {
      const p = parseColor(col);
      if (p) c.color = p.rgb;
    }
    c.opacity = parent.opacity * opacityOf(s.get('opacity'), 1); // not inherited: multiplied down (approximation)
    return { c, spec: s };
  }

  // ---------------------------------------------------------------------------------------------- paint servers
  private resolvePaint(p: Paint, c: Computed, el: El, prop: 'fill' | 'stroke'): { rgb: Rgb; alpha: number } | null {
    if (p.kind === 'none' || p.kind === 'invalid') return null;
    if (p.kind === 'color') return { rgb: p.rgb, alpha: p.alpha };
    if (p.kind === 'current') return { rgb: c.color, alpha: 1 };
    const target = this.ids.get(p.id);
    const tname = target ? nameOf(target) : '';
    if (tname === 'linearGradient' || tname === 'radialGradient') {
      const stops = this.gradientStops(target as El);
      this.report.add('gradient', `#${p.id}`);
      if (!stops.length) return null;
      const n = stops.length;
      const rgb: Rgb = [0, 1, 2].map((i) => stops.reduce((s, x) => s + x.rgb[i], 0) / n) as unknown as Rgb;
      return { rgb, alpha: stops.reduce((s, x) => s + x.alpha, 0) / n };
    }
    if (tname === 'pattern') this.report.add('pattern', `#${p.id}`);
    else this.report.add('invalidPaint', `${prop}=url(${/[:/]/.test(p.id) ? p.id : '#' + p.id}) on <${nameOf(el)}>`);
    return p.fallback ? this.resolvePaint(p.fallback, c, el, prop) : null;
  }

  private gradientStops(first: El): { rgb: Rgb; alpha: number }[] {
    const seen = new Set<El>();
    // follows href chains iteratively (a long chain must not overflow the stack)
    for (let g: El | undefined = first; g && !seen.has(g); ) {
      seen.add(g);
      const own = children(g).filter((s) => nameOf(s) === 'stop');
      if (own.length) {
        return own.map((s) => {
          const spec = this.specified(s);
          const col = parseColor(spec.get('stop-color') ?? 'black') ?? { rgb: [0, 0, 0] as Rgb, alpha: 1 };
          const op = parseFloat(spec.get('stop-opacity') ?? '1');
          return { rgb: col.rgb, alpha: col.alpha * (Number.isFinite(op) ? op : 1) };
        });
      }
      const href = hrefOf(g);
      g = href?.startsWith('#') ? this.ids.get(href.slice(1)) : undefined;
    }
    return [];
  }

  // ---------------------------------------------------------------------------------------------- geometry
  /** A basic shape or path → segments in its own user space (null = nothing to draw). */
  shapeSegs(e: El, vp: Viewport): Seg[] | null {
    const n = nameOf(e);
    const diag = Math.sqrt((vp.w * vp.w + vp.h * vp.h) / 2);
    const L = (name: string, ref: number, fallback = 0) => this.num(attr(e, name) ?? undefined, fallback, ref, name);
    const fromD = (d: string) => {
      const p = parsePathData(d);
      if (p.error) this.report.add('pathError', `<${n}${attr(e, 'id') ? ' id=' + attr(e, 'id') : ''}>`);
      return p.segs;
    };
    switch (n) {
      case 'path':
        return fromD(attr(e, 'd') ?? '');
      case 'rect': {
        const x = L('x', vp.w);
        const y = L('y', vp.h);
        const w = L('width', vp.w);
        const h = L('height', vp.h);
        if (!(w > 0 && h > 0)) return null;
        const rxA = attr(e, 'rx');
        const ryA = attr(e, 'ry');
        let rx = rxA !== null && rxA !== 'auto' ? L('rx', vp.w) : NaN;
        let ry = ryA !== null && ryA !== 'auto' ? L('ry', vp.h) : NaN;
        if (!Number.isFinite(rx) && Number.isFinite(ry)) rx = ry;
        if (!Number.isFinite(ry) && Number.isFinite(rx)) ry = rx;
        rx = Math.min(Math.max(rx || 0, 0), w / 2);
        ry = Math.min(Math.max(ry || 0, 0), h / 2);
        if (rx === 0 || ry === 0) return fromD(`M${x} ${y}H${x + w}V${y + h}H${x}Z`);
        return fromD(
          `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}` +
            `H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`
        );
      }
      case 'circle':
      case 'ellipse': {
        const cx = L('cx', vp.w);
        const cy = L('cy', vp.h);
        let rx: number;
        let ry: number;
        if (n === 'circle') rx = ry = L('r', diag);
        else {
          const rxA = attr(e, 'rx');
          const ryA = attr(e, 'ry');
          rx = rxA !== null && rxA !== 'auto' ? L('rx', vp.w) : NaN;
          ry = ryA !== null && ryA !== 'auto' ? L('ry', vp.h) : NaN;
          if (!Number.isFinite(rx)) rx = ry;
          if (!Number.isFinite(ry)) ry = rx;
        }
        if (!(rx > 0 && ry > 0)) return null;
        return fromD(`M${cx + rx} ${cy}A${rx} ${ry} 0 0 1 ${cx} ${cy + ry}A${rx} ${ry} 0 0 1 ${cx - rx} ${cy}A${rx} ${ry} 0 0 1 ${cx} ${cy - ry}A${rx} ${ry} 0 0 1 ${cx + rx} ${cy}Z`);
      }
      case 'line':
        return fromD(`M${L('x1', vp.w)} ${L('y1', vp.h)}L${L('x2', vp.w)} ${L('y2', vp.h)}`);
      case 'polyline':
      case 'polygon': {
        const nums = (attr(e, 'points') ?? '').match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g)?.map(Number) ?? [];
        if (nums.length % 2) this.report.add('pathError', `<${n}> odd number of coordinates`);
        if (nums.length < 4) return null;
        let d = `M${nums[0]} ${nums[1]}`;
        for (let i = 2; i + 1 < nums.length; i += 2) d += `L${nums[i]} ${nums[i + 1]}`;
        return fromD(n === 'polygon' ? d + 'Z' : d);
      }
    }
    return null;
  }

  private ownTransform(e: El): Affine | null {
    const t = parseTransform(attr(e, 'transform'));
    if (!t) this.report.add('invalidTransform', `<${nameOf(e)}> ${attr(e, 'transform')}`);
    return t;
  }

  /** clip-path="url(#id)" → a clip in the referencing element's user space (`ctm` includes its transform). */
  private clipFor(spec: Map<string, string>, ctm: Affine, vp: Viewport, e: El): SvgClip | null | 'skip' {
    const v = spec.get('clip-path');
    if (!v || v === 'none') return null;
    const m = /^url\(\s*['"]?#([^'")\s]+)['"]?\s*\)$/.exec(v);
    const cp = m ? this.ids.get(m[1]) : undefined;
    if (!cp || nameOf(cp) !== 'clipPath') {
      this.report.add('clipPath', `${v} on <${nameOf(e)}>`);
      return null;
    }
    let cpT = this.ownTransform(cp) ?? IDENTITY;
    if (attr(cp, 'clipPathUnits') === 'objectBoundingBox') {
      // finding 11: units are fractions of the referencing shape's bounding box (fill geometry, no stroke)
      const own = SHAPES.has(nameOf(e)) ? this.shapeSegs(e, vp) : null;
      const b = own ? segBounds(own) : null;
      if (!b || !(b.w > 0 && b.h > 0)) {
        this.report.add('clipPath', `#${m![1]} objectBoundingBox`);
        return null;
      }
      cpT = compose([b.w, 0, 0, b.h, b.x, b.y], cpT);
    }
    const segs: Seg[] = [];
    let evenOdd: boolean | null = null;
    const add = (el: El, T: Affine, depthGuard: number) => {
      const name = nameOf(el);
      if (name === 'use' && depthGuard < 4) {
        const href = hrefOf(el);
        const target = href?.startsWith('#') ? this.ids.get(href.slice(1)) : undefined;
        if (!target) {
          this.report.add('clipPath', `#${m![1]} <use>`);
          return;
        }
        const ut = this.ownTransform(el) ?? IDENTITY;
        const x = this.num(attr(el, 'x') ?? undefined, 0, vp.w, 'x');
        const y = this.num(attr(el, 'y') ?? undefined, 0, vp.h, 'y');
        add(target, compose(compose(T, ut), [1, 0, 0, 1, x, y]), depthGuard + 1);
        return;
      }
      if (!SHAPES.has(name)) {
        if (name === 'text') this.report.add('clipPath', `#${m![1]} text`);
        return;
      }
      const s = this.shapeSegs(el, vp);
      if (!s) return;
      const t = compose(T, this.ownTransform(el) ?? IDENTITY);
      const rule = this.specified(el).get('clip-rule') === 'evenodd';
      if (evenOdd !== null && evenOdd !== rule) this.report.add('clipPath', `#${m![1]} mixed clip-rule`);
      evenOdd = rule;
      this.countSegs(s.length);
      for (const sg of s) segs.push(mapSeg(sg, t));
    };
    for (const ch of children(cp)) add(ch, cpT, 0);
    if (!segs.length) return 'skip'; // an empty clip path clips everything away (SVG)
    return { segs, matrix: ctm, evenOdd: evenOdd ?? false };
  }

  // ---------------------------------------------------------------------------------------------- traversal
  private countSegs(n: number) {
    this.segCount += n;
    if (this.segCount > SVG_BUDGET.segments) throw new TooComplex(`more than ${SVG_BUDGET.segments} path segments`);
  }

  walk(e: El, parent: Computed, ctx: Ctx) {
    if (++this.visits > SVG_BUDGET.visits) throw new TooComplex(`more than ${SVG_BUDGET.visits} elements (with <use> copies)`);
    if (this.depth >= SVG_BUDGET.depth) throw new TooComplex(`nesting deeper than ${SVG_BUDGET.depth} (with <use>)`);
    this.depth++;
    try {
      this.visit(e, parent, ctx);
    } finally {
      this.depth--;
    }
  }

  /**
   * SVG conditional processing (finding 10): `requiredExtensions` names extensions we do not support (false, also when
   * empty), `systemLanguage` must match a user language by primary tag, `requiredFeatures` is ignored (SVG 2: true).
   */
  conditionsPass(e: El): boolean {
    if (e.hasAttribute('requiredExtensions')) return false;
    const sl = attr(e, 'systemLanguage');
    if (sl === null) return true;
    const want = this.languages.map((l) => l.toLowerCase().split('-')[0]);
    return sl.split(',').map((t) => t.trim().toLowerCase()).some((t) => t !== '' && want.includes(t.split('-')[0]));
  }

  private visit(e: El, parent: Computed, ctx: Ctx) {
    const name = nameOf(e);
    if (!this.conditionsPass(e)) return;
    if (ANIMATION.has(name)) {
      this.report.add('animation', `<${name}>`);
      return;
    }
    if (NON_RENDERING.has(name) && name !== 'symbol') return;
    if (name === 'symbol') return; // only through <use>
    const { c, spec } = this.computed(e, parent, ctx.vp);
    if (spec.get('display') === 'none') return;
    for (const p of ['mask', 'filter'] as const) {
      const v = spec.get(p);
      if (v && v !== 'none') this.report.add(p, `<${name}${attr(e, 'id') ? ' #' + attr(e, 'id') : ''}>`);
    }
    const blend = spec.get('mix-blend-mode');
    if (blend && blend !== 'normal') this.report.add('blendMode', blend);
    const own = this.ownTransform(e);
    if (!own) return;
    let ctm = compose(ctx.ctm, own);
    const clip = this.clipFor(spec, ctm, ctx.vp, e);
    if (clip === 'skip') return;
    const clips = clip ? [...ctx.clips, clip] : ctx.clips;

    switch (name) {
      case 'svg': {
        // nested viewport (the root is set up by readSvg)
        const x = this.num(attr(e, 'x') ?? undefined, 0, ctx.vp.w, 'x');
        const y = this.num(attr(e, 'y') ?? undefined, 0, ctx.vp.h, 'y');
        const w = this.num(attr(e, 'width') ?? undefined, ctx.vp.w, ctx.vp.w, 'width');
        const h = this.num(attr(e, 'height') ?? undefined, ctx.vp.h, ctx.vp.h, 'height');
        this.viewport(e, c, { ...ctx, ctm, clips }, x, y, w, h, attr(e, 'viewBox'));
        return;
      }
      case 'g':
      case 'a': {
        const kids = children(e);
        if (c.opacity < 1 && c.opacity < parent.opacity && kids.length > 1) this.report.add('groupOpacity', attr(e, 'id') ? `#${attr(e, 'id')}` : `<${name}>`);
        for (const k of kids) this.walk(k, c, { ...ctx, ctm, clips });
        return;
      }
      case 'switch': {
        const pick = children(e).find((k) => this.conditionsPass(k) && !ANIMATION.has(nameOf(k)));
        if (pick) this.walk(pick, c, { ...ctx, ctm, clips });
        return;
      }
      case 'use': {
        const href = hrefOf(e);
        if (!href || !href.startsWith('#')) {
          this.report.add('useExternal', href ?? '(no href)');
          return;
        }
        const target = this.ids.get(href.slice(1));
        if (!target) {
          this.report.add('useMissing', href);
          return;
        }
        // a <use> inside its own target (finding 13) is recursive too: browsers draw nothing for it
        let inside = false;
        for (let a: Node | null = e.parentNode; a && !inside; a = a.parentNode) inside = a === target;
        if (inside || ctx.useStack.includes(target) || ctx.useStack.length > 32) {
          this.report.add('useRecursive', href);
          return;
        }
        if (++this.uses > SVG_BUDGET.uses) throw new TooComplex(`more than ${SVG_BUDGET.uses} <use> copies`);
        const x = this.num(attr(e, 'x') ?? undefined, 0, ctx.vp.w, 'x');
        const y = this.num(attr(e, 'y') ?? undefined, 0, ctx.vp.h, 'y');
        ctm = compose(ctm, [1, 0, 0, 1, x, y]);
        const next: Ctx = { ...ctx, ctm, clips, useStack: [...ctx.useStack, target] };
        if (nameOf(target) === 'symbol' || nameOf(target) === 'svg') {
          const w = this.num(attr(e, 'width') ?? attr(target, 'width') ?? undefined, ctx.vp.w, ctx.vp.w, 'width');
          const h = this.num(attr(e, 'height') ?? attr(target, 'height') ?? undefined, ctx.vp.h, ctx.vp.h, 'height');
          const { c: tc } = this.computed(target, c, ctx.vp);
          if (nameOf(target) === 'svg') {
            this.viewport(target, tc, next, 0, 0, w, h, attr(target, 'viewBox'));
          } else {
            const tt = this.ownTransform(target) ?? IDENTITY;
            this.viewport(target, tc, { ...next, ctm: compose(next.ctm, tt) }, 0, 0, w, h, attr(target, 'viewBox'));
          }
          return;
        }
        this.walk(target, c, next);
        return;
      }
      case 'text':
      case 'image':
      case 'foreignObject':
        this.report.add(name, attr(e, 'id') ? `#${attr(e, 'id')}` : `<${name}>`);
        return;
    }
    if (!SHAPES.has(name)) {
      this.report.add('unknownElement', `<${name}>`);
      return;
    }
    if (!c.visibility) return;
    for (const mk of ['marker', 'marker-start', 'marker-mid', 'marker-end']) {
      const v = spec.get(mk);
      if (v && v !== 'none') this.report.add('marker', `${mk} on <${name}>`);
    }
    if (spec.get('vector-effect') === 'non-scaling-stroke') this.report.add('nonScalingStroke', `<${name}>`);
    const po = spec.get('paint-order');
    if (po && po !== 'normal' && /^\s*(stroke|markers)/.test(po)) this.report.add('paintOrder', po);
    const segs = this.shapeSegs(e, ctx.vp);
    if (!segs || !segs.some((s) => s.c !== 'M' && s.c !== 'Z')) return;
    const fillPaint = name === 'line' ? null : this.resolvePaint(c.fill, c, e, 'fill');
    const strokePaint = c.strokeWidth > 0 ? this.resolvePaint(c.stroke, c, e, 'stroke') : null;
    const fillAlpha = fillPaint ? fillPaint.alpha * c.fillOpacity * c.opacity : 0;
    const strokeAlpha = strokePaint ? strokePaint.alpha * c.strokeOpacity * c.opacity : 0;
    const fill: SvgFill | null = fillPaint && fillAlpha > 0 ? { rgb: fillPaint.rgb, alpha: fillAlpha, evenOdd: c.fillRule === 'evenodd' } : null;
    const stroke: SvgStroke | null =
      strokePaint && strokeAlpha > 0
        ? { rgb: strokePaint.rgb, alpha: strokeAlpha, width: c.strokeWidth, cap: c.cap, join: c.join, miter: c.miter, dash: c.dash, dashOffset: c.dashOffset }
        : null;
    if (!fill && !stroke) return;
    if (this.items.length >= SVG_BUDGET.items) throw new TooComplex(`more than ${SVG_BUDGET.items} shapes`);
    this.countSegs(segs.length);
    this.items.push({ segs, matrix: ctm, clips, fill, stroke });
  }

  /** Children of an <svg>/<symbol> viewport at (x, y, w, h) in the current user space, clipped (overflow hidden). */
  viewport(e: El, c: Computed, ctx: Ctx, x: number, y: number, w: number, h: number, viewBoxAttr: string | null) {
    if (!(w > 0 && h > 0)) return;
    const vb = parseViewBox(viewBoxAttr);
    const par = parsePreserveAspectRatio(attr(e, 'preserveAspectRatio'));
    const map: Affine = vb && vb !== 'bad' ? viewportMatrix(vb, w, h, par) : IDENTITY;
    const overflow = this.specified(e).get('overflow');
    const clipRect: SvgClip = { segs: rectSegs(x, y, w, h), matrix: ctx.ctm, evenOdd: false };
    const clips = overflow === 'visible' || overflow === 'auto' ? ctx.clips : [...ctx.clips, clipRect];
    const ctm = compose(compose(ctx.ctm, [1, 0, 0, 1, x, y]), map);
    const vp = vb && vb !== 'bad' ? { w: vb.w, h: vb.h } : { w, h };
    for (const k of children(e)) this.walk(k, c, { ...ctx, ctm, clips, vp });
  }
}

/** Bounds of the end and control points (a superset of the curve; exact for the axis-aligned shapes clip boxes use). */
function segBounds(segs: Seg[]): { x: number; y: number; w: number; h: number } | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const s of segs) {
    if (s.c === 'Z') continue;
    for (const p of s.c === 'C' ? [s.p1, s.p2, s.p] : [s.p]) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
  }
  return x1 >= x0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

function rectSegs(x: number, y: number, w: number, h: number): Seg[] {
  return [
    { c: 'M', p: { x, y } },
    { c: 'L', p: { x: x + w, y } },
    { c: 'L', p: { x: x + w, y: y + h } },
    { c: 'L', p: { x, y: y + h } },
    { c: 'Z' },
  ];
}

export function mapSeg(s: Seg, m: Affine): Seg {
  if (s.c === 'Z') return s;
  if (s.c === 'C') return { c: 'C', p1: apply(m, s.p1), p2: apply(m, s.p2), p: apply(m, s.p) };
  return { c: s.c, p: apply(m, s.p) };
}

/** Parses and normalises an SVG document (text). Size in mm needs the ppi answer: see `svgNaturalSize`. */
export function readSvg(text: string, options: { languages?: readonly string[] } = {}): SvgRead {
  // cheap pre-check before the DOM is built (a 45 MB file of 650 000 rects took 7 s and 1.1 GB just to parse in Node)
  let tags = 0;
  for (let i = text.indexOf('<'); i !== -1; i = text.indexOf('<', i + 1)) {
    const c = text.charCodeAt(i + 1);
    if (((c | 32) >= 97 && (c | 32) <= 122) && ++tags > SVG_BUDGET.visits) return { ok: false, error: 'tooComplex' };
  }
  let doc: Document;
  try {
    doc = new DOMParser({ onError: () => undefined }).parseFromString(expandEntities(text.replace(/^﻿/, '')), 'image/svg+xml') as unknown as Document;
  } catch {
    return { ok: false, error: 'invalidXml' };
  }
  const root = doc?.documentElement as El | null;
  if (!root || nameOf(root) !== 'svg' || !isSvgEl(root)) return { ok: false, error: root ? 'notSvg' : 'invalidXml' };
  const width = attr(root, 'width');
  const height = attr(root, 'height');
  const vbAttr = attr(root, 'viewBox');
  let vb = parseViewBox(vbAttr);
  const lw = parseRootLength(width);
  const lh = parseRootLength(height);
  if (lw.kind === 'bad' || lh.kind === 'bad') return { ok: false, error: 'badLength' };
  if (vb === 'bad') {
    if (lw.kind === 'rel' || lh.kind === 'rel') return { ok: false, error: 'badViewBox' };
    vb = null;
  }
  if (!vb) {
    // no viewBox: the user space is CSS px (absolute units at 96/in, px values as written)
    if (lw.kind === 'rel' || lh.kind === 'rel') return { ok: false, error: 'noSize' };
    const px = (l: typeof lw) => (l.kind === 'abs' ? (l.mm * CSS_PX_PER_IN) / MM_PER_IN : l.kind === 'px' ? l.px : NaN);
    vb = { x: 0, y: 0, w: px(lw), h: px(lh) };
  }
  const n = new Normaliser(root);
  if (options.languages?.length) n.languages = options.languages;
  const par = parsePreserveAspectRatio(attr(root, 'preserveAspectRatio'));
  try {
    n.collect();
    const { c } = n.computed(root, INITIAL, { w: vb.w, h: vb.h });
    const ctx: Ctx = { ctm: IDENTITY, clips: [], vp: { w: vb.w, h: vb.h }, useStack: [] };
    const own = parseTransform(attr(root, 'transform'));
    if (own && own !== IDENTITY) ctx.ctm = own;
    for (const k of children(root)) n.walk(k, c, ctx);
  } catch (e) {
    // the budget, or a runtime limit the budget did not foresee (stack, array length): refuse, never throw
    if (e instanceof TooComplex || e instanceof RangeError) return { ok: false, error: 'tooComplex' };
    throw e;
  }
  const report = n.report.build(n.items.length);
  if (!n.items.length) return { ok: false, error: 'empty', report };
  return { ok: true, drawing: { viewBox: vb, par, items: n.items, root: { width, height, viewBox: vbAttr } }, report };
}

// ------------------------------------------------------------------------------------------------ serialisation
const hex2 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
const hexRgb = (c: Rgb) => `#${hex2(c[0])}${hex2(c[1])}${hex2(c[2])}`;
const mStr = (m: Affine) => `matrix(${m.map((v) => String(v === 0 ? 0 : v)).join(' ')})`;

/**
 * The normalised drawing as a plain SVG (paths with explicit paint and matrices, clip paths, no CSS, no <use>) —
 * what on-screen previews (react-native-svg, P5) draw, so the screen shows what the PDF prints.
 */
export function drawingToSvg(d: SvgDrawing, widthMm?: number, heightMm?: number): string {
  const defs: string[] = [];
  const body: string[] = [];
  const clipIds = new Map<SvgClip, string>();
  const clipId = (c: SvgClip) => {
    let id = clipIds.get(c);
    if (!id) {
      id = `c${clipIds.size}`;
      clipIds.set(c, id);
      defs.push(`<clipPath id="${id}" clipPathUnits="userSpaceOnUse"><path d="${segsToD(c.segs)}" transform="${mStr(c.matrix)}" clip-rule="${c.evenOdd ? 'evenodd' : 'nonzero'}"/></clipPath>`);
    }
    return id;
  };
  for (const it of d.items) {
    const a: string[] = [`d="${segsToD(it.segs)}"`, `transform="${mStr(it.matrix)}"`];
    if (it.fill) {
      a.push(`fill="${hexRgb(it.fill.rgb)}"`);
      if (it.fill.alpha < 1) a.push(`fill-opacity="${it.fill.alpha}"`);
      if (it.fill.evenOdd) a.push('fill-rule="evenodd"');
    } else a.push('fill="none"');
    if (it.stroke) {
      const s = it.stroke;
      a.push(`stroke="${hexRgb(s.rgb)}"`, `stroke-width="${s.width}"`);
      if (s.alpha < 1) a.push(`stroke-opacity="${s.alpha}"`);
      if (s.cap !== 'butt') a.push(`stroke-linecap="${s.cap}"`);
      if (s.join !== 'miter') a.push(`stroke-linejoin="${s.join}"`);
      if (s.miter !== 4) a.push(`stroke-miterlimit="${s.miter}"`);
      if (s.dash) a.push(`stroke-dasharray="${s.dash.join(' ')}"`, `stroke-dashoffset="${s.dashOffset}"`);
    }
    let el = `<path ${a.join(' ')}/>`;
    for (let i = it.clips.length - 1; i >= 0; i--) el = `<g clip-path="url(#${clipId(it.clips[i])})">${el}</g>`;
    body.push(el);
  }
  const vb = d.viewBox;
  const size = widthMm && heightMm ? ` width="${widthMm}mm" height="${heightMm}mm"` : '';
  const par = d.par.align !== 'xMidYMid' || d.par.slice ? ` preserveAspectRatio="${d.par.align}${d.par.slice ? ' slice' : ''}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}"${size}${par}>${defs.length ? `<defs>${defs.join('')}</defs>` : ''}${body.join('')}</svg>`;
}

