// SVG transforms, colours and CSS <style> rules for the normaliser (D24, D49). Pure.
import { compose, IDENTITY, type Affine } from '@/engine/geometry';
import type { Rgb } from '@/engine/path';

// ------------------------------------------------------------------------------------------------ transforms
const TR_RE = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/y;
const NUM_G = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** SVG 1.1 §7.6 transform list → one matrix (left to right: the first item is applied last). null = invalid. */
export function parseTransform(text: string | null | undefined): Affine | null {
  if (!text || !text.trim()) return IDENTITY;
  let m: Affine = IDENTITY;
  let i = 0;
  const s = text;
  const sep = () => {
    while (i < s.length && /[\s,]/.test(s[i])) i++;
  };
  sep();
  while (i < s.length) {
    TR_RE.lastIndex = i;
    const t = TR_RE.exec(s);
    if (!t) return null;
    i = TR_RE.lastIndex;
    const a = (t[2].match(NUM_G) ?? []).map(Number);
    let item: Affine;
    switch (t[1]) {
      case 'matrix':
        if (a.length !== 6) return null;
        item = [a[0], a[1], a[2], a[3], a[4], a[5]];
        break;
      case 'translate':
        if (a.length !== 1 && a.length !== 2) return null;
        item = [1, 0, 0, 1, a[0], a[1] ?? 0];
        break;
      case 'scale':
        if (a.length !== 1 && a.length !== 2) return null;
        item = [a[0], 0, 0, a[1] ?? a[0], 0, 0];
        break;
      case 'rotate': {
        if (a.length !== 1 && a.length !== 3) return null;
        const c = Math.cos(rad(a[0]));
        const sn = Math.sin(rad(a[0]));
        const r: Affine = [c, sn, -sn, c, 0, 0];
        item = a.length === 3 ? compose(compose([1, 0, 0, 1, a[1], a[2]], r), [1, 0, 0, 1, -a[1], -a[2]]) : r;
        break;
      }
      case 'skewX':
        if (a.length !== 1) return null;
        item = [1, 0, Math.tan(rad(a[0])), 1, 0, 0];
        break;
      default:
        if (a.length !== 1) return null;
        item = [1, Math.tan(rad(a[0])), 0, 1, 0, 0];
    }
    m = compose(m, item);
    sep();
  }
  return m;
}

// ------------------------------------------------------------------------------------------------ colours
// CSS Color 4 named colours (the 147 SVG keywords + rebeccapurple)
const NAMED_SRC =
  'aliceblue:f0f8ff antiquewhite:faebd7 aqua:00ffff aquamarine:7fffd4 azure:f0ffff beige:f5f5dc bisque:ffe4c4 black:000000 ' +
  'blanchedalmond:ffebcd blue:0000ff blueviolet:8a2be2 brown:a52a2a burlywood:deb887 cadetblue:5f9ea0 chartreuse:7fff00 ' +
  'chocolate:d2691e coral:ff7f50 cornflowerblue:6495ed cornsilk:fff8dc crimson:dc143c cyan:00ffff darkblue:00008b ' +
  'darkcyan:008b8b darkgoldenrod:b8860b darkgray:a9a9a9 darkgreen:006400 darkgrey:a9a9a9 darkkhaki:bdb76b darkmagenta:8b008b ' +
  'darkolivegreen:556b2f darkorange:ff8c00 darkorchid:9932cc darkred:8b0000 darksalmon:e9967a darkseagreen:8fbc8f ' +
  'darkslateblue:483d8b darkslategray:2f4f4f darkslategrey:2f4f4f darkturquoise:00ced1 darkviolet:9400d3 deeppink:ff1493 ' +
  'deepskyblue:00bfff dimgray:696969 dimgrey:696969 dodgerblue:1e90ff firebrick:b22222 floralwhite:fffaf0 forestgreen:228b22 ' +
  'fuchsia:ff00ff gainsboro:dcdcdc ghostwhite:f8f8ff gold:ffd700 goldenrod:daa520 gray:808080 grey:808080 green:008000 ' +
  'greenyellow:adff2f honeydew:f0fff0 hotpink:ff69b4 indianred:cd5c5c indigo:4b0082 ivory:fffff0 khaki:f0e68c lavender:e6e6fa ' +
  'lavenderblush:fff0f5 lawngreen:7cfc00 lemonchiffon:fffacd lightblue:add8e6 lightcoral:f08080 lightcyan:e0ffff ' +
  'lightgoldenrodyellow:fafad2 lightgray:d3d3d3 lightgreen:90ee90 lightgrey:d3d3d3 lightpink:ffb6c1 lightsalmon:ffa07a ' +
  'lightseagreen:20b2aa lightskyblue:87cefa lightslategray:778899 lightslategrey:778899 lightsteelblue:b0c4de lightyellow:ffffe0 ' +
  'lime:00ff00 limegreen:32cd32 linen:faf0e6 magenta:ff00ff maroon:800000 mediumaquamarine:66cdaa mediumblue:0000cd ' +
  'mediumorchid:ba55d3 mediumpurple:9370db mediumseagreen:3cb371 mediumslateblue:7b68ee mediumspringgreen:00fa9a ' +
  'mediumturquoise:48d1cc mediumvioletred:c71585 midnightblue:191970 mintcream:f5fffa mistyrose:ffe4e1 moccasin:ffe4b5 ' +
  'navajowhite:ffdead navy:000080 oldlace:fdf5e6 olive:808000 olivedrab:6b8e23 orange:ffa500 orangered:ff4500 orchid:da70d6 ' +
  'palegoldenrod:eee8aa palegreen:98fb98 paleturquoise:afeeee palevioletred:db7093 papayawhip:ffefd5 peachpuff:ffdab9 ' +
  'peru:cd853f pink:ffc0cb plum:dda0dd powderblue:b0e0e6 purple:800080 rebeccapurple:663399 red:ff0000 rosybrown:bc8f8f ' +
  'royalblue:4169e1 saddlebrown:8b4513 salmon:fa8072 sandybrown:f4a460 seagreen:2e8b57 seashell:fff5ee sienna:a0522d ' +
  'silver:c0c0c0 skyblue:87ceeb slateblue:6a5acd slategray:708090 slategrey:708090 snow:fffafa springgreen:00ff7f ' +
  'steelblue:4682b4 tan:d2b48c teal:008080 thistle:d8bfd8 tomato:ff6347 turquoise:40e0d0 violet:ee82ee wheat:f5deb3 ' +
  'white:ffffff whitesmoke:f5f5f5 yellow:ffff00 yellowgreen:9acd32';
const NAMED = new Map(NAMED_SRC.split(' ').map((e) => e.split(':') as [string, string]));

export type Paint = { kind: 'none' } | { kind: 'color'; rgb: Rgb; alpha: number } | { kind: 'current' } | { kind: 'url'; id: string; fallback: Paint | null } | { kind: 'invalid'; text: string };

const hex = (h: string): Rgb => [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function channel(t: string): number {
  const v = parseFloat(t);
  return clamp01(t.trim().endsWith('%') ? v / 100 : v / 255);
}
function alphaOf(t: string | undefined): number {
  if (t === undefined) return 1;
  const v = parseFloat(t);
  return clamp01(t.trim().endsWith('%') ? v / 100 : v);
}
function hslToRgb(h: number, s: number, l: number): Rgb {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

/** A colour value (CSS Color 4 subset: names, #rgb[a], #rrggbb[aa], rgb[a](), hsl[a]()). null = not a colour. */
export function parseColor(text: string): { rgb: Rgb; alpha: number } | null {
  const t = text.trim().toLowerCase();
  const named = NAMED.get(t);
  if (named) return { rgb: hex(named), alpha: 1 };
  if (t === 'transparent') return { rgb: [0, 0, 0], alpha: 0 };
  let m = /^#([0-9a-f]{3,8})$/.exec(t);
  if (m) {
    const h = m[1];
    if (h.length === 3 || h.length === 4) {
      const full = h
        .split('')
        .map((c) => c + c)
        .join('');
      return { rgb: hex(full), alpha: h.length === 4 ? parseInt(full.slice(6, 8), 16) / 255 : 1 };
    }
    if (h.length === 6 || h.length === 8) return { rgb: hex(h), alpha: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
    return null;
  }
  m = /^rgba?\(\s*([^)]*)\)$/.exec(t);
  if (m) {
    const p = m[1].split(/\s*[,/]\s*|\s+/).filter(Boolean);
    if (p.length < 3 || p.length > 4 || p.some((x) => !/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?%?$/.test(x))) return null;
    return { rgb: [channel(p[0]), channel(p[1]), channel(p[2])], alpha: alphaOf(p[3]) };
  }
  m = /^hsla?\(\s*([^)]*)\)$/.exec(t);
  if (m) {
    const p = m[1].split(/\s*[,/]\s*|\s+/).filter(Boolean);
    if (p.length < 3 || p.length > 4) return null;
    const h = (((parseFloat(p[0]) % 360) + 360) % 360) as number;
    const s = clamp01(parseFloat(p[1]) / 100);
    const l = clamp01(parseFloat(p[2]) / 100);
    if (![h, s, l].every(Number.isFinite)) return null;
    return { rgb: hslToRgb(h, s, l), alpha: alphaOf(p[3]) };
  }
  return null;
}

/** A `fill`/`stroke` value. */
export function parsePaint(text: string): Paint {
  const t = text.trim();
  if (t === 'none') return { kind: 'none' };
  if (t === 'currentColor' || t.toLowerCase() === 'currentcolor') return { kind: 'current' };
  // url(#id) or an external url(…) — never fetched: an unresolvable reference falls back like a missing local one
  // (P3.5 finding 12: "url(http://…#g) #0000ff" used to drop the fallback colour)
  const u = /^url\(\s*['"]?([^'")\s]+)['"]?\s*\)\s*(.*)$/.exec(t);
  if (u) return { kind: 'url', id: u[1].startsWith('#') ? u[1].slice(1) : u[1], fallback: u[2] ? parsePaint(u[2]) : null };
  const c = parseColor(t);
  if (c) return c.alpha === 0 ? { kind: 'none' } : { kind: 'color', rgb: c.rgb, alpha: c.alpha };
  return { kind: 'invalid', text: t };
}

// ------------------------------------------------------------------------------------------------ CSS
export type Declarations = Map<string, { value: string; important: boolean }>;
export type Selector = { parts: { combinator: ' ' | '>' | null; tag: string | null; id: string | null; classes: string[] }[]; specificity: number };
export type CssRule = { selector: Selector; decls: Declarations; order: number };
export type CssParse = { rules: CssRule[]; unsupportedSelectors: string[]; atRules: string[] };

/** `a: b; c: d !important` → declarations (property names lower-cased, values trimmed). */
export function parseDeclarations(text: string): Declarations {
  const out: Declarations = new Map();
  for (const part of text.split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const prop = part.slice(0, i).trim().toLowerCase();
    let value = part.slice(i + 1).trim();
    if (!prop || !value) continue;
    const important = /!\s*important$/i.test(value);
    if (important) value = value.replace(/!\s*important$/i, '').trim();
    out.set(prop, { value, important });
  }
  return out;
}

const COMPOUND_RE = /^(\*|[A-Za-z][\w-]*(?::[\w-]+)?)?((?:[.#][\w-]+)*)$/;

function parseSelector(text: string): Selector | null {
  const tokens = text.trim().replace(/\s*>\s*/g, ' > ').split(/\s+/);
  const parts: Selector['parts'] = [];
  let combinator: ' ' | '>' | null = null;
  let ids = 0;
  let classes = 0;
  let tags = 0;
  for (const tok of tokens) {
    if (tok === '>') {
      if (!parts.length || combinator === '>') return null;
      combinator = '>';
      continue;
    }
    const m = COMPOUND_RE.exec(tok);
    if (!m || (!m[1] && !m[2])) return null;
    const tag = m[1] && m[1] !== '*' ? m[1] : null;
    const simple = m[2].match(/[.#][\w-]+/g) ?? [];
    const id = simple.filter((s) => s[0] === '#');
    if (id.length > 1) return null;
    const cls = simple.filter((s) => s[0] === '.').map((s) => s.slice(1));
    ids += id.length;
    classes += cls.length;
    if (tag) tags++;
    parts.push({ combinator: parts.length ? (combinator ?? ' ') : null, tag, id: id[0]?.slice(1) ?? null, classes: cls });
    combinator = null;
  }
  if (!parts.length || combinator) return null;
  return { parts, specificity: ids * 10000 + classes * 100 + tags };
}

/**
 * The text of all <style> elements → rules. Supported: type, .class, #id, * compounds with descendant and child
 * combinators. Anything else (attribute selectors, pseudo-classes, +/~) is listed as unsupported, never guessed.
 */
export function parseCss(text: string, orderStart = 0): CssParse {
  const rules: CssRule[] = [];
  const unsupportedSelectors: string[] = [];
  const atRules: string[] = [];
  let src = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!\[CDATA\[|\]\]>/g, '');
  // @-rules: blocks are dropped (reported), statements removed
  src = src.replace(/@([\w-]+)[^{;]*;/g, (_m, name: string) => {
    atRules.push(name);
    return '';
  });
  let order = orderStart;
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open < 0) break;
    const head = src.slice(i, open).trim();
    // find the matching close brace (nested blocks for @media)
    let depth = 1;
    let j = open + 1;
    while (j < src.length && depth > 0) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') depth--;
      j++;
    }
    const body = src.slice(open + 1, j - 1);
    i = j;
    if (head.startsWith('@')) {
      atRules.push(head.slice(1).split(/\s/)[0]);
      continue;
    }
    const decls = parseDeclarations(body);
    for (const selText of head.split(',')) {
      const sel = parseSelector(selText);
      if (!sel) {
        if (selText.trim()) unsupportedSelectors.push(selText.trim());
        continue;
      }
      rules.push({ selector: sel, decls, order: order++ });
    }
  }
  return { rules, unsupportedSelectors, atRules };
}

/** Minimal element view for selector matching. */
export type MatchElement = { tag: string; id: string | null; classes: string[]; parent: MatchElement | null };

function matchCompound(p: Selector['parts'][number], e: MatchElement): boolean {
  if (p.tag && p.tag !== e.tag) return false;
  if (p.id && p.id !== e.id) return false;
  return p.classes.every((c) => e.classes.includes(c));
}

export function matches(sel: Selector, e: MatchElement): boolean {
  const parts = sel.parts;
  const go = (pi: number, el: MatchElement | null): boolean => {
    if (!el) return false;
    if (!matchCompound(parts[pi], el)) return false;
    if (pi === 0) return true;
    const comb = parts[pi].combinator;
    if (comb === '>') return go(pi - 1, el.parent);
    for (let a = el.parent; a; a = a.parent) if (go(pi - 1, a)) return true;
    return false;
  };
  return go(parts.length - 1, e);
}
