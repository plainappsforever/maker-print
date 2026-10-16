// Optional content (PDF layers) and annotations of imported PDF pages (P3.5 review findings 4 and 5, L26). Pure apart
// from pdf-lib object access. Hidden layers are left out of the print the way Acrobat/pdf.js/PDFium render them:
// painting inside a hidden optional-content section is suppressed while every graphics-state change still applies
// (paths end with `n`, text is shown in render mode 3 = invisible so the text position still advances, XObjects,
// shadings and inline images are dropped). Annotations are not part of the page content: they are counted and
// reported (`annotationsNotPrinted`), never silently lost.
import { decodePDFRawStream, PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream, PDFRef, type PDFDocument, type PDFObject, type PDFPage } from '@cantoo/pdf-lib';

const N = (s: string) => PDFName.of(s);
const key = (o: PDFObject | undefined) => (o instanceof PDFRef ? o.toString() : null);

/** OCGs hidden when printing: the default configuration /D (BaseState, ON, OFF) refined by its /AS print usage. */
export function hiddenLayers(doc: PDFDocument): Set<string> | null {
  const oc = doc.catalog.lookupMaybe(N('OCProperties'), PDFDict);
  if (!oc) return null;
  const all = oc.lookupMaybe(N('OCGs'), PDFArray);
  const d = oc.lookupMaybe(N('D'), PDFDict);
  const refs = (a: PDFArray | undefined) => new Set((a?.asArray() ?? []).map(key).filter((k): k is string => !!k));
  const on = refs(d?.lookupMaybe(N('ON'), PDFArray));
  const off = refs(d?.lookupMaybe(N('OFF'), PDFArray));
  const baseOff = d?.lookupMaybe(N('BaseState'), PDFName)?.asString() === '/OFF';
  const visible = new Map<string, boolean>();
  for (const o of all?.asArray() ?? []) {
    const k = key(o);
    if (k) visible.set(k, baseOff ? on.has(k) : !off.has(k));
  }
  // automatic state for the Print event (PDF 32000 8.11.4.4): the OCG's /Usage /Print /PrintState wins
  for (const as of d?.lookupMaybe(N('AS'), PDFArray)?.asArray() ?? []) {
    const e = doc.context.lookup(as);
    if (!(e instanceof PDFDict) || e.lookupMaybe(N('Event'), PDFName)?.asString() !== '/Print') continue;
    for (const o of e.lookupMaybe(N('OCGs'), PDFArray)?.asArray() ?? []) {
      const g = doc.context.lookup(o);
      const state = g instanceof PDFDict ? g.lookupMaybe(N('Usage'), PDFDict)?.lookupMaybe(N('Print'), PDFDict)?.lookupMaybe(N('PrintState'), PDFName)?.asString() : undefined;
      const k = key(o);
      if (k && state) visible.set(k, state === '/ON');
    }
  }
  const hidden = new Set([...visible].filter(([, v]) => !v).map(([k]) => k));
  return hidden;
}

/** An /OC value (OCG or OCMD, by reference or direct) → hidden? Unknown objects count as visible. */
function ocHidden(doc: PDFDocument, value: PDFObject | undefined, hidden: Set<string>): boolean {
  if (!value) return false;
  const k = key(value);
  const obj = doc.context.lookup(value);
  if (!(obj instanceof PDFDict)) return false;
  if (obj.lookupMaybe(N('Type'), PDFName)?.asString() !== '/OCMD') return k ? hidden.has(k) : false;
  const raw = obj.get(N('OCGs'));
  const list = raw instanceof PDFArray ? raw.asArray() : raw ? [raw] : [];
  const vis = list.map((g) => !hidden.has(key(g) ?? ''));
  if (!vis.length) return false;
  const p = obj.lookupMaybe(N('P'), PDFName)?.asString() ?? '/AnyOn';
  const shown = p === '/AllOn' ? vis.every(Boolean) : p === '/AnyOff' ? vis.some((v) => !v) : p === '/AllOff' ? vis.every((v) => !v) : vis.some(Boolean);
  return !shown;
}

// ------------------------------------------------------------------------------------------------ content filter
const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]);
const PAINT = new Set(['S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*']);
const SHOW = new Set(['Tj', 'TJ', "'", '"']);

function latin1(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, Array.from(b.subarray(i, i + 8192)));
  return s;
}
function bytesOf(s: string): Uint8Array {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
}

type Tok = { s: number; e: number; t: string; op: boolean };
/** PDF content-stream tokens (strings, hex strings, dicts, arrays, names, numbers, operators); comments skipped. */
function* tokens(src: string): Generator<Tok> {
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src.charCodeAt(i);
    if (WS.has(c)) {
      i++;
      continue;
    }
    const s = i;
    if (c === 37) {
      while (i < n && src.charCodeAt(i) !== 10 && src.charCodeAt(i) !== 13) i++;
      continue;
    }
    if (c === 40) {
      let depth = 0;
      for (; i < n; i++) {
        const d = src.charCodeAt(i);
        if (d === 92) i++;
        else if (d === 40) depth++;
        else if (d === 41 && --depth === 0) break;
      }
      i++;
      yield { s, e: i, t: '()', op: false };
      continue;
    }
    if (c === 60 && src.charCodeAt(i + 1) === 60) {
      i += 2;
      yield { s, e: i, t: '<<', op: false };
      continue;
    }
    if (c === 62 && src.charCodeAt(i + 1) === 62) {
      i += 2;
      yield { s, e: i, t: '>>', op: false };
      continue;
    }
    if (c === 60) {
      i = src.indexOf('>', i);
      i = i < 0 ? n : i + 1;
      yield { s, e: i, t: '<>', op: false };
      continue;
    }
    if (c === 91 || c === 93 || c === 123 || c === 125 || c === 41 || c === 62) {
      i++;
      yield { s, e: i, t: src[s], op: false };
      continue;
    }
    i++;
    while (i < n && !WS.has(src.charCodeAt(i)) && !DELIM.has(src.charCodeAt(i))) i++;
    const t = src.slice(s, i);
    if (t === 'ID') {
      // inline image data: binary up to "EI" between white-space (or the end); yielded as one EI operator
      let k = i + 1;
      while (k < n - 1 && !(src[k] === 'E' && src[k + 1] === 'I' && WS.has(src.charCodeAt(k - 1)) && (k + 2 >= n || WS.has(src.charCodeAt(k + 2))))) k++;
      i = Math.min(n, k + 2);
      yield { s, e: i, t: 'EI', op: true };
      continue;
    }
    const isOp = c !== 47 && !/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t) && t !== 'true' && t !== 'false' && t !== 'null';
    yield { s, e: i, t, op: isOp };
  }
}

export type FilterResult = { text: string; hiddenPaint: number; forms: PDFRef[] };

/**
 * Suppresses painting inside hidden optional content. `propHidden(name)` resolves a BDC property name, `xobject(name)`
 * says whether a Do target is hidden by its own /OC (or is a form to visit). Returns the new content and the count of
 * painting operators suppressed.
 */
export function filterContent(src: string, propHidden: (name: string) => boolean, xobject: (name: string) => { hidden: boolean; form: PDFRef | null }): FilterResult {
  const out: string[] = [];
  const mc: boolean[] = [];
  let hiddenDepth = 0;
  let tr = '0';
  const trStack: string[] = [];
  let segStart = 0;
  let operands: Tok[] = [];
  let hiddenPaint = 0;
  const forms: PDFRef[] = [];
  const it = tokens(src);
  for (let r = it.next(); !r.done; r = it.next()) {
    const tok = r.value;
    if (!tok.op || tok.t === 'BI') {
      operands.push(tok);
      continue;
    }
    const op = tok.t;
    const whole = src.slice(segStart, tok.e);
    const hidden = hiddenDepth > 0;
    let emit = whole;
    if (op === 'BDC') {
      const isHidden = operands.length >= 2 && operands[0].t === '/OC' && operands[1].t.startsWith('/') && propHidden(operands[1].t.slice(1));
      mc.push(isHidden);
      if (isHidden) hiddenDepth++;
    } else if (op === 'BMC') mc.push(false);
    else if (op === 'EMC') {
      if (mc.pop()) hiddenDepth--;
    } else if (op === 'q') trStack.push(tr);
    else if (op === 'Q') tr = trStack.pop() ?? '0';
    else if (op === 'Tr' && operands.length) tr = operands[operands.length - 1].t;
    else if (op === 'Do') {
      const name = operands.length ? operands[operands.length - 1].t.slice(1) : '';
      const x = xobject(name);
      if (hidden || x.hidden) {
        emit = src.slice(segStart, operands.length ? operands[0].s : tok.s);
        hiddenPaint++;
      } else if (x.form) forms.push(x.form);
    } else if (op === 'EI') {
      // the whole inline image (BI <dict> ID <data> EI) is one painting unit
      if (hidden) {
        emit = '';
        hiddenPaint++;
      }
    } else if (hidden && PAINT.has(op)) {
      emit = src.slice(segStart, tok.s) + 'n';
      hiddenPaint++;
    } else if (hidden && op === 'sh') {
      emit = src.slice(segStart, operands.length ? operands[0].s : tok.s);
      hiddenPaint++;
    } else if (hidden && SHOW.has(op)) {
      const pre = src.slice(segStart, operands.length ? operands[0].s : tok.s);
      emit = `${pre} 3 Tr ${src.slice(operands.length ? operands[0].s : tok.s, tok.e)} ${tr} Tr`;
      hiddenPaint++;
    }
    out.push(emit);
    segStart = tok.e;
    operands = [];
  }
  out.push(src.slice(segStart));
  return { text: out.join(''), hiddenPaint, forms };
}

// ------------------------------------------------------------------------------------------------ pages and forms
function decoded(doc: PDFDocument, o: PDFObject | undefined): Uint8Array | null {
  const s = doc.context.lookup(o);
  if (!(s instanceof PDFRawStream)) return null;
  try {
    return decodePDFRawStream(s).decode();
  } catch {
    return null;
  }
}

function resolver(doc: PDFDocument, resources: PDFDict | undefined, hidden: Set<string>) {
  const props = resources?.lookupMaybe(N('Properties'), PDFDict);
  const xobjects = resources?.lookupMaybe(N('XObject'), PDFDict);
  return {
    propHidden: (name: string) => ocHidden(doc, props?.get(N(name)), hidden),
    xobject: (name: string): { hidden: boolean; form: PDFRef | null } => {
      const ref = xobjects?.get(N(name));
      const x = doc.context.lookup(ref);
      const dict = x instanceof PDFRawStream ? x.dict : null;
      if (!dict) return { hidden: false, form: null };
      const isForm = dict.lookupMaybe(N('Subtype'), PDFName)?.asString() === '/Form';
      return { hidden: ocHidden(doc, dict.get(N('OC')), hidden), form: isForm && ref instanceof PDFRef ? ref : null };
    },
  };
}

/**
 * Suppresses hidden-layer painting on `page` and in every form XObject it draws (iteratively, each form once per
 * `done` set). `write` false = count only (import report); true = rewrite the streams in `doc` (the painter's private
 * copy, before `embedPage`). Returns the number of painting operations suppressed.
 */
export function suppressHiddenLayers(doc: PDFDocument, page: PDFPage, hidden: Set<string>, write: boolean, done: Set<string> = new Set()): number {
  if (!hidden.size) return 0;
  let count = 0;
  const raw = page.node.get(N('Contents'));
  const list = doc.context.lookup(raw) instanceof PDFArray ? (doc.context.lookup(raw) as PDFArray).asArray() : raw ? [raw] : [];
  const parts = list.map((o) => decoded(doc, o));
  const queue: { ref: PDFRef; parent: PDFDict | undefined }[] = [];
  const resources = page.node.Resources();
  if (parts.length && parts.every((p) => p !== null)) {
    const r = resolver(doc, resources, hidden);
    const f = filterContent(parts.map((p) => latin1(p as Uint8Array)).join('\n'), r.propHidden, r.xobject);
    count += f.hiddenPaint;
    if (write && f.hiddenPaint) page.node.set(N('Contents'), doc.context.register(doc.context.flateStream(bytesOf(f.text))));
    for (const form of f.forms) queue.push({ ref: form, parent: resources });
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const { ref, parent } = queue[qi];
    if (done.has(ref.toString())) continue;
    done.add(ref.toString());
    const stream = doc.context.lookup(ref);
    if (!(stream instanceof PDFRawStream)) continue;
    const bytes = decoded(doc, ref);
    if (!bytes) continue;
    const res = stream.dict.lookupMaybe(N('Resources'), PDFDict) ?? parent;
    const r = resolver(doc, res, hidden);
    const f = filterContent(latin1(bytes), r.propHidden, r.xobject);
    count += f.hiddenPaint;
    if (write && f.hiddenPaint) {
      const next = doc.context.flateStream(bytesOf(f.text));
      for (const [k, v] of stream.dict.entries()) if (!['/Length', '/Filter', '/DecodeParms'].includes(k.asString())) next.dict.set(k, v);
      doc.context.assign(ref, next);
    }
    for (const form of f.forms) queue.push({ ref: form, parent: res });
  }
  return count;
}

/** Annotations that Acrobat/Preview print (Print flag, not Hidden, with a normal appearance) — not drawn by us (finding 5). */
export function printedAnnotations(doc: PDFDocument, page: PDFPage, hidden: Set<string> | null): number {
  const annots = page.node.lookupMaybe(N('Annots'), PDFArray);
  let n = 0;
  for (const a of annots?.asArray() ?? []) {
    const d = doc.context.lookup(a);
    if (!(d instanceof PDFDict)) continue;
    const flags = d.lookupMaybe(N('F'), PDFNumber)?.asNumber() ?? 0;
    const sub = d.lookupMaybe(N('Subtype'), PDFName)?.asString();
    const ap = d.lookupMaybe(N('AP'), PDFDict);
    if (!(flags & 4) || flags & 2 || sub === '/Popup' || !ap?.get(N('N'))) continue;
    if (hidden && ocHidden(doc, d.get(N('OC')), hidden)) continue;
    n++;
  }
  return n;
}
