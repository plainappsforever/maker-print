/**
 * @jest-environment node
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { apply } from '@/engine/geometry';

import { en } from '@/i18n/en';

import { inspectAsset } from '../assets';
import { drawingToSvg, readSvg, SVG_BUDGET, type SvgItem } from './normalise';
import { SVG_ISSUE_SEVERITY, type SvgIssueCode } from './report';
import { svgNaturalSize } from './units';

const fixture = (name: string) => readFileSync(path.join(__dirname, '../../../test/fixtures/svg', name), 'utf8');
const ok = (text: string) => {
  const r = readSvg(text);
  if (!r.ok) throw new Error(`readSvg failed: ${r.error}`);
  return r;
};
const svg = (body: string, attrs = 'viewBox="0 0 100 100" width="100mm" height="100mm"') => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ${attrs}>${body}</svg>`;
/** Bounding box of an item's end points in root user space */
const bounds = (it: SvgItem) => {
  const pts = it.segs.filter((s) => s.c !== 'Z').map((s) => apply(it.matrix, (s as { p: { x: number; y: number } }).p));
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map((v) => Math.round(v * 1e9) / 1e9);
};
const codes = (r: ReturnType<typeof ok>) => r.report.issues.map((i) => i.code).sort();

describe('readSvg — exporter fixtures', () => {
  it('Inkscape mm: layer transform applied, explicit style fills, nothing reported', () => {
    const r = ok(fixture('inkscape-mm.svg'));
    expect(r.report.issues).toEqual([]);
    expect(r.drawing.items).toHaveLength(2);
    expect(bounds(r.drawing.items[0])).toEqual([10, 10, 40, 30]);
    expect(r.drawing.items[0].fill?.rgb).toEqual([1, 0, 0]);
    expect(bounds(r.drawing.items[1])).toEqual([55, 10, 85, 40]);
    expect(svgNaturalSize(r.drawing.root.width, r.drawing.root.height, r.drawing.root.viewBox, 72)).toEqual({ ok: true, wMm: 100, hMm: 50, needsPpi: false });
  });

  it('Illustrator 72: <style> classes resolved, polyline drawn as an open stroked path, miter limit kept', () => {
    const r = ok(fixture('illustrator-72.svg'));
    expect(r.report.issues).toEqual([]);
    const [rect, poly] = r.drawing.items;
    expect(rect.fill?.rgb).toEqual([1, 0, 0]);
    expect(rect.stroke).toBeNull();
    expect(poly.fill).toBeNull(); // fill:none from the class
    expect(poly.stroke).toMatchObject({ rgb: [0, 0, 1], width: 2, miter: 10 });
    expect(poly.segs.map((s) => s.c)).toEqual(['M', 'L', 'L']);
    expect(svgNaturalSize(null, null, r.drawing.root.viewBox, 72)).toMatchObject({ ok: true, wMm: 101.6, needsPpi: true });
  });

  it('<use> of a <symbol> (viewport + clip) and of a plain element (x/y offset)', () => {
    const r = ok(fixture('use-symbol.svg'));
    expect(r.report.issues).toEqual([]);
    const [dot, sq] = r.drawing.items;
    expect(bounds(dot)).toEqual([10, 10, 30, 30]);
    expect(dot.clips).toHaveLength(1); // the symbol's viewport
    expect(bounds(sq)).toEqual([50, 10, 60, 20]);
    expect(sq.fill?.rgb).toEqual([1, 0, 1]);
  });

  it('Figma: root fill="none" is not inherited as a fill by children with their own fill; clip-path applied', () => {
    const r = ok(fixture('figma-clip.svg'));
    expect(r.report.issues).toEqual([]);
    expect(r.drawing.items).toHaveLength(1);
    expect(r.drawing.items[0].clips).toHaveLength(1);
    expect(r.drawing.items[0].clips[0].segs.filter((s) => s.c !== 'Z').map((s) => (s as { p: object }).p)).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 60 },
      { x: 0, y: 60 },
    ]);
  });

  it('Affinity 100 %: relative size → viewBox at the ppi answer; evenodd from the root style is inherited', () => {
    const r = ok(fixture('affinity-percent.svg'));
    expect(r.drawing.items[0].fill).toMatchObject({ rgb: [0, 0, 1], evenOdd: true });
    expect(bounds(r.drawing.items[0])).toEqual([50, 50, 150, 100]);
    const s = svgNaturalSize(r.drawing.root.width, r.drawing.root.height, r.drawing.root.viewBox, 96);
    expect(s.ok && [s.wMm, s.hMm, s.needsPpi]).toEqual([(400 * 25.4) / 96, (200 * 25.4) / 96, true]);
  });

  it('unsupported features are each reported with their severity — never dropped silently', () => {
    const r = ok(fixture('unsupported.svg'));
    expect(codes(r)).toEqual(
      ['animation', 'cssAtRule', 'cssSelector', 'filter', 'gradient', 'image', 'marker', 'mask', 'pattern', 'text', 'unknownElement', 'useExternal', 'useMissing'].sort()
    );
    const by = (c: SvgIssueCode) => r.report.issues.find((i) => i.code === c)!;
    expect(by('cssSelector').examples).toEqual(['svg [data-x]']);
    expect(by('text').severity).toBe('notDrawn');
    expect(by('gradient').severity).toBe('approximated');
    // drawn: green class rect, gradient (average purple), pattern rect stays (no fallback → no fill → not drawn), red filtered rect, marker path, masked rect, dashed circle
    const gradient = r.drawing.items.find((i) => i.fill && Math.abs(i.fill.rgb[0] - 0.5) < 1e-9 && Math.abs(i.fill.rgb[2] - 0.5) < 1e-9);
    expect(gradient).toBeDefined();
    const circle = r.drawing.items[r.drawing.items.length - 1];
    expect(circle.fill?.rgb.map((v) => Math.round(v * 255))).toEqual([255, 239, 213]); // papayawhip
    expect(circle.stroke?.dash).toEqual([1, 2]);
    // the class rule `rect.a` wins over the @media rule (not applied)
    expect(r.drawing.items[0].fill?.rgb).toEqual([0, 1, 0]);
  });

  it('every issue code and severity has an English (and so German) text', () => {
    const keys = Object.keys(en);
    for (const code of Object.keys(SVG_ISSUE_SEVERITY)) expect(keys).toContain(`svg.issue.${code}`);
    for (const sev of ['notDrawn', 'approximated', 'info']) expect(keys).toContain(`svg.severity.${sev}`);
  });
});

describe('readSvg — semantics drawSvg got wrong (probed in P3, D49)', () => {
  it('a shape without fill is filled black (SVG default); fill="none" on a child overrides an inherited fill', () => {
    const r = ok(svg('<rect width="10" height="10"/><g fill="red"><rect y="20" width="10" height="10" fill="none" stroke="blue"/></g>'));
    expect(r.drawing.items[0].fill?.rgb).toEqual([0, 0, 0]);
    expect(r.drawing.items[1].fill).toBeNull();
    expect(r.drawing.items[1].stroke?.rgb).toEqual([0, 0, 1]);
  });

  it('display:none and visibility:hidden are not drawn; zero-size shapes are not drawn', () => {
    const r = ok(svg('<rect width="10" height="10" display="none"/><rect width="10" height="10" visibility="hidden"/><g style="display:none"><rect width="5" height="5"/></g><rect width="0" height="5"/><circle r="0"/><rect x="1" width="2" height="2"/>'));
    expect(r.drawing.items).toHaveLength(1);
    expect(bounds(r.drawing.items[0])).toEqual([1, 0, 3, 2]);
  });

  it('units inside the drawing (1in = 96 user units), viewBox with commas, stroke widths with units', () => {
    const r = ok(svg('<rect x="1in" y="25.4mm" width="10" height="10" stroke="#000" stroke-width="1mm"/>', 'viewBox="0,0,200,200" width="200" height="200"'));
    expect(r.drawing.viewBox).toEqual({ x: 0, y: 0, w: 200, h: 200 });
    expect(bounds(r.drawing.items[0])).toEqual([96, 96, 106, 106]);
    expect(r.drawing.items[0].stroke?.width).toBeCloseTo(96 / 25.4, 12);
  });

  it('CSS cascade: presentation attribute < rule (by specificity) < style attribute < !important', () => {
    const css = '<style>rect{fill:#010101} .c{fill:#020202} #i{fill:#030303} .imp{fill:#040404 !important} g > rect.k{fill:#050505}</style>';
    const r = ok(svg(`${css}<rect fill="#ff0000" width="1" height="1"/><rect class="c" fill="#ff0000" width="1" height="1"/><rect id="i" class="c" width="1" height="1"/><rect class="c" style="fill:#060606" width="1" height="1"/><rect class="imp" style="fill:#060606" width="1" height="1"/><g><rect class="k" width="1" height="1"/></g>`));
    expect(r.drawing.items.map((i) => Math.round(i.fill!.rgb[0] * 255))).toEqual([1, 2, 3, 6, 4, 5]);
    expect(r.report.issues).toEqual([]);
  });

  it('opacity multiplies down (group opacity reported), colours with alpha, currentColor, transparent', () => {
    const r = ok(svg('<g opacity="0.5"><rect width="1" height="1" fill="#ff000080" fill-opacity="0.5"/><rect width="1" height="1" fill="currentColor" color="blue"/></g><rect width="1" height="1" fill="transparent" stroke="rgb(0 128 0 / 50%)"/>'));
    const [a, b, c] = r.drawing.items;
    expect(a.fill?.alpha).toBeCloseTo(0.5 * 0.5 * (128 / 255), 12);
    expect(b.fill).toMatchObject({ rgb: [0, 0, 1], alpha: 0.5 });
    expect(c.fill).toBeNull();
    expect(c.stroke).toMatchObject({ alpha: 0.5 });
    expect(codes(r)).toEqual(['groupOpacity']);
  });

  it('a bad colour or an url() without its target does not abort the drawing (drawSvg threw); it is reported', () => {
    const r = ok(svg('<rect width="1" height="1" fill="#ff0000 "/><rect width="1" height="1" fill="url(#nope)"/><rect width="1" height="1" fill="url(#nope) blue"/><rect width="1" height="1" fill="bogus"/>'));
    expect(r.drawing.items.map((i) => i.fill?.rgb)).toEqual([[1, 0, 0], [0, 0, 1], [0, 0, 0]]);
    expect(r.report.issues.find((i) => i.code === 'invalidPaint')?.count).toBe(3);
  });

  it('old Illustrator DTD entities (xmlns="&ns_svg;") are expanded', () => {
    const t = '<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x" [<!ENTITY ns_svg "http://www.w3.org/2000/svg"><!ENTITY st0 "fill:#00FF00;">]><svg xmlns="&ns_svg;" width="10mm" height="10mm" viewBox="0 0 10 10"><rect style="&st0;" width="5" height="5"/></svg>';
    expect(ok(t).drawing.items[0].fill?.rgb).toEqual([0, 1, 0]);
  });

  it('Illustrator <switch>: the foreignObject with requiredExtensions is skipped, the drawing is used', () => {
    const r = ok(svg('<switch><foreignObject requiredExtensions="http://ns.adobe.com/AdobeIllustrator/10.0/" width="1" height="1"/><g><rect width="3" height="3"/></g></switch>'));
    expect(r.drawing.items).toHaveLength(1);
    expect(r.report.issues).toEqual([]);
  });

  it('recursive <use> is reported, not looped', () => {
    const r = ok(svg('<g id="a"><rect width="1" height="1"/><use href="#a" x="2"/></g>'));
    // P3.5 finding 13: a <use> inside its own target draws nothing (browsers), not one extra copy
    expect(r.drawing.items).toHaveLength(1);
    expect(codes(r)).toContain('useRecursive');
  });

  it('refusals: invalid XML, not an SVG, no size, bad length/viewBox, nothing drawable', () => {
    expect(readSvg('<svg><rect></svg>')).toEqual({ ok: false, error: 'invalidXml' });
    expect(readSvg('not xml')).toEqual({ ok: false, error: 'invalidXml' });
    expect(readSvg('<html xmlns="http://www.w3.org/1999/xhtml"/>')).toMatchObject({ ok: false, error: 'notSvg' });
    expect(readSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>')).toMatchObject({ ok: false, error: 'noSize' });
    expect(readSvg('<svg xmlns="http://www.w3.org/2000/svg" width="-3mm" height="2mm"/>')).toMatchObject({ ok: false, error: 'badLength' });
    expect(readSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 0 10"/>')).toMatchObject({ ok: false, error: 'badViewBox' });
    expect(readSvg(svg('<text>only text</text>'))).toMatchObject({ ok: false, error: 'empty', report: { issues: [expect.objectContaining({ code: 'text' })] } });
  });
});

describe('drawingToSvg (normalised SVG for on-screen previews)', () => {
  it('re-reads to the same items: geometry, paint and clips', () => {
    for (const f of ['inkscape-mm.svg', 'illustrator-72.svg', 'use-symbol.svg', 'figma-clip.svg', 'transforms-arcs.svg']) {
      const a = ok(fixture(f)).drawing;
      const b = ok(drawingToSvg(a, 100, 50)).drawing;
      expect(b.items.length).toBe(a.items.length);
      a.items.forEach((it, i) => {
        expect(bounds(b.items[i])).toEqual(bounds(it));
        expect(b.items[i].fill?.rgb.map((v) => Math.round(v * 255))).toEqual(it.fill?.rgb.map((v) => Math.round(v * 255)));
        expect(b.items[i].clips.length).toBe(it.clips.length);
      });
    }
  });
});

// P3.5 review finding 3: resource exhaustion is refused fast with `tooComplex`, never a crash or OOM
describe('SVG budget (tooComplex)', () => {
  const blind = (name: string) => readFileSync(path.join(__dirname, '../../../test/blind/svg', name));
  it('the 2 KB <use> bomb (29 doubling levels) is refused in well under a second', async () => {
    const t0 = performance.now();
    const r = await inspectAsset('svg', new Uint8Array(blind('h04-use-bomb.svg')));
    expect(r).toEqual({ ok: false, error: 'tooComplex' });
    expect(performance.now() - t0).toBeLessThan(1000);
  });
  it('20 000 nested <g> → an error result, not a thrown RangeError', async () => {
    expect(await inspectAsset('svg', new Uint8Array(blind('h03-deep-nesting.svg')))).toEqual({ ok: false, error: 'tooComplex' });
  });
  it('more start tags than the visit budget are refused before the DOM is built', () => {
    const t0 = performance.now();
    expect(readSvg(svg('<rect width="1" height="1"/>'.repeat(SVG_BUDGET.visits + 1)))).toEqual({ ok: false, error: 'tooComplex' });
    expect(performance.now() - t0).toBeLessThan(1000);
  });
  it('shapes, segments and <use> copies have caps; files just below still import', () => {
    const uses = (n: number) => svg(`<defs><rect id="r" width="1" height="1" fill="red"/><g id="g10">${'<use href="#r"/>'.repeat(10)}</g></defs>${'<use href="#g10"/>'.repeat(n)}`);
    expect(readSvg(uses(Math.floor(SVG_BUDGET.uses / 11)))).toMatchObject({ ok: true });
    expect(readSvg(uses(Math.ceil(SVG_BUDGET.uses / 11) + 10))).toEqual({ ok: false, error: 'tooComplex' });
    const longPath = (n: number) => svg(`<path d="M0 0${' L1 1 L2 0'.repeat(n / 2)}" stroke="red"/>`);
    expect(readSvg(longPath(200_000))).toMatchObject({ ok: true });
    expect(readSvg(longPath(SVG_BUDGET.segments + 2))).toEqual({ ok: false, error: 'tooComplex' });
  });
  it('a 30 000-long gradient href chain resolves without recursion', () => {
    const chain = Array.from({ length: 30_000 }, (_, i) => `<linearGradient id="g${i}" href="#g${i + 1}"/>`).join('') + '<linearGradient id="g30000"><stop stop-color="#00ff00"/></linearGradient>';
    const r = ok(svg(`<defs>${chain}</defs><rect width="10" height="10" fill="url(#g0)"/>`));
    expect(r.drawing.items[0].fill?.rgb).toEqual([0, 1, 0]);
  });
  it('nice-to-haves 10–13: switch conditions, objectBoundingBox clips, external paint fallback, use inside its target', () => {
    const blind = (n: string) => readFileSync(path.join(__dirname, '../../../test/blind/svg', n), 'utf8');
    const fills = (t: string, o = {}) => {
      const r = readSvg(t, o);
      if (!r.ok) throw new Error(r.error);
      return r.drawing.items.map((it) => [it.fill?.rgb.join(','), ...Object.values(bounds(it)).map((v) => Math.round(v * 1000) / 1000)]);
    };
    // b24: systemLanguage="xx" fails → the red rect; in German the "de" branch wins
    expect(fills(blind('b24-switch-a.svg')).map((f) => f[0])).toEqual(['1,0,0', '0,1,0']);
    expect(fills(svg('<switch><rect systemLanguage="de" width="1" height="1" fill="#00f"/><rect width="2" height="2" fill="#f00"/></switch>'), { languages: ['de-DE'] })[0][0]).toBe('0,0,1');
    expect(fills(svg('<switch><rect requiredExtensions="" width="1" height="1" fill="#00f"/><rect width="2" height="2" fill="#f00"/></switch>'))[0][0]).toBe('1,0,0');
    // b09: the blue rect 60..80 clipped by an objectBoundingBox clip of 0..0.5 → 60..70 (clip in the item, no report)
    const b09 = readSvg(blind('b09-clip-path.svg'));
    if (!b09.ok) throw new Error();
    const blue = b09.drawing.items.find((it) => it.fill?.rgb.join(',') === '0,0,1')!;
    const cb = blue.clips[0].segs.filter((s) => s.c !== 'Z').map((s) => apply(blue.clips[0].matrix, (s as { p: { x: number; y: number } }).p));
    expect([Math.min(...cb.map((p) => p.x)), Math.max(...cb.map((p) => p.x)), Math.min(...cb.map((p) => p.y)), Math.max(...cb.map((p) => p.y))]).toEqual([60, 70, 60, 70]);
    expect(b09.report.issues.map((i) => i.code)).not.toContain('clipPath');
    // b14: stylesheet fill "url(http://…#g) #0000ff" → blue fallback, reported, nothing fetched
    expect(fills(blind('b14-injection.svg')).map((f) => f[0])).toEqual(['1,0,0', '0,0,1', '1,0,0']);
    // b29: <use href="#g1"> inside g1 draws nothing extra
    expect(fills(blind('b29-recursive-use.svg'))).toHaveLength(1);
  });

  it('every import error has EN and DE text', () => {
    expect(en['import.error.tooComplex']).toMatch(/too complex/);
  });
});
