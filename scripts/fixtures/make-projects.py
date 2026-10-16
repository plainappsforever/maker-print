# Writer of the referee projects test/fixtures/projects/*.json (run: python3 scripts/fixtures/make-projects.py). Every expected number is derived here from the SPEC/D-rules by hand
# arithmetic (comments), never from engine output. The JSON files are the committed artefacts.
import json, math
from pathlib import Path
OUT = Path(__file__).resolve().parents[2] / 'test/fixtures/projects'
A4 = [210, 297]; A4L = [297, 210]; LETTER = [215.9, 279.4]
def obj(i, kind, x, y, w, h, **kw):
    o = {'id': i, 'sheetId': kw.pop('sheetId', 1), 'kind': kind, 'x': x, 'y': y, 'w': w, 'h': h}
    o.update(kw); return o
def feat(fid, page, colour, rect, expect, **kw):
    f = {'id': fid, 'page': page, 'colour': colour, 'rect': [round(v, 4) for v in rect], 'expect': {k: (round(v, 6) if isinstance(v, float) else v) for k, v in expect.items()}}
    f.update(kw); return f
def box(l, t, r, b, pad=1.5):
    return [l - pad, t - pad, r - l + 2 * pad, b - t + 2 * pad]
def write(name, about, data):
    data = {'name': name, 'about': about, **data}
    (OUT / f'{name}.json').write_text(json.dumps(data, indent=1, ensure_ascii=False) + '\n')

single = lambda: [{'id': 1, 'widthMm': 210, 'heightMm': 297}]

# D53 (P3.5 finding 1): every page is the PORTRAIT paper; a landscape frame (Wf wide = the paper's height) is turned a
# quarter turn counter-clockwise onto it: page X = frame y, page Y = Wf − frame x. The expectations below are written in
# frame terms (as derived from the SPEC) and turned here, so a missing or wrong turn fails the referee.
def turned(f, Wf):
    f = dict(f); x, y, w, h = f['rect']
    f['rect'] = [round(v, 4) for v in (y, Wf - x - w, h, w)]
    e = f['expect']; n = {}
    for k, v in e.items():
        if k == 'l': n['t'] = round(Wf - e['r'], 6) if 'r' in e else None
        elif k == 'r': n['b'] = round(Wf - e['l'], 6) if 'l' in e else None
        elif k == 't': n['l'] = v
        elif k == 'b': n['r'] = v
        elif k == 'cx': n['cy'] = round(Wf - v, 6)
        elif k == 'cy': n['cx'] = v
        elif k in ('first', 'last') and f.get('axis', 'x') == 'x': n['last' if k == 'first' else 'first'] = round(Wf - v, 6)
        elif k == 'positions' and f.get('axis', 'x') == 'x': n[k] = sorted(round(Wf - p, 6) for p in v)
        else: n[k] = v
    f['expect'] = {k: v for k, v in n.items() if v is not None}
    if f.get('mode') == 'ticks': f['axis'] = 'y' if f.get('axis', 'x') == 'x' else 'x'
    return f
def turned_same(sm):  # frame (dx, dy) → page (dy, −dx)
    return {'a': sm['a'], 'b': sm['b'], 'dx': sm['dy'], 'dy': None if sm['dx'] is None else -sm['dx']}

# ------------------------------------------------------------------ 01 vector shapes (rect, ellipse, line, text, test square)
H_L, H_R = 79 / 1000, 643 / 1000   # Helvetica AFM: H bbox 79..643, cap 718, advance 722
s = 36 * 25.4 / 72                  # 36 pt in mm
base = 100 + 0.718 * s              # first baseline at the ascender (D45 / shapes.ts doc)
write('01-vector-shapes', 'rect (fill), ellipse (fill), line (1 mm stroke), stroked rect (2 mm, centred on the outline), text (AFM bbox of "HHH"), test square outline. A4 sheet = A4 paper → single page, sheet = page coordinates.', {
 'sheets': single(),
 'objects': [obj(1, 'rect', 20, 20, 50, 30, props={'fill': '#ff0000', 'stroke': None}),
             obj(2, 'ellipse', 100, 20, 60, 30, props={'fill': '#0000ff', 'stroke': None}),
             obj(3, 'line', 20, 70, 100, 10, props={'stroke': '#00ff00', 'strokeMm': 1}),
             obj(4, 'rect', 140, 70, 40, 20, props={'stroke': '#ff00ff', 'strokeMm': 2, 'fill': None}),
             obj(5, 'text', 20, 100, 150, 20, props={'text': 'HHH', 'fontSizePt': 36, 'colour': '#ff0000'}),
             obj(6, 'test_square', 120, 150, 50, 50, props={'colour': '#0000ff'})],
 'output': {'paperKey': 'a4'},
 'expect': {'pageCount': 1, 'pageSizeMm': A4, 'features': [
   feat('rect fill', 0, 'red', box(20, 20, 70, 50), {'l': 20, 't': 20, 'r': 70, 'b': 50, 'area': 1500.0, 'cx': 45, 'cy': 35}),
   feat('ellipse fill', 0, 'blue', box(100, 20, 160, 50), {'l': 100, 't': 20, 'r': 160, 'b': 50, 'area': math.pi * 30 * 15, 'cx': 130, 'cy': 35}),
   feat('line 1 mm', 0, 'green', box(20, 74.5, 120, 75.5), {'l': 20, 't': 74.5, 'r': 120, 'b': 75.5, 'area': 100.0, 'cy': 75}),
   feat('stroked rect', 0, 'magenta', box(139, 69, 181, 91), {'l': 139, 't': 69, 'r': 181, 'b': 91, 'area': 42 * 22 - 38 * 18, 'cx': 160, 'cy': 80}),
   feat('text HHH (AFM bbox; macOS Helvetica outlines)', 0, 'red', box(20 + H_L * s, base - 0.718 * s, 20 + (2 * 0.722 + H_R) * s, base, 2),
        {'l': 20 + H_L * s, 't': base - 0.718 * s, 'r': 20 + (2 * 0.722 + H_R) * s, 'b': base}, tol=0.15),
   feat('test square outline 50 mm', 0, 'blue', box(119.9, 149.9, 170.1, 200.1), {'l': 119.9, 't': 149.9, 'r': 170.1, 'b': 200.1})]}})

# ------------------------------------------------------------------ 02 generators
write('02-generators', 'ruler (1 mm ticks from the box top, D45), graph paper 10 mm, circle template Ø30 (0.2 mm stroke), dot grid 5 mm, lined paper 8 mm (default grey).', {
 'sheets': single(),
 'objects': [obj(1, 'ruler', 20, 20, 150, 15, props={'colour': '#ff0000', 'unit': 'mm'}),
             obj(2, 'grid', 20, 50, 100, 60, props={'colour': '#0000ff', 'spacingMm': 10}),
             obj(3, 'circles', 130, 50, 60, 40, props={'colour': '#00ff00', 'diametersMm': [30], 'labels': False, 'cross': False}),
             obj(4, 'dots', 20, 180, 50, 20, props={'colour': '#ff00ff', 'spacingMm': 5}),
             obj(5, 'lines', 100, 180, 80, 40, props={'spacingMm': 8})],
 'output': {'paperKey': 'a4'},
 'expect': {'pageCount': 1, 'pageSizeMm': A4, 'allow': [{'page': 0, 'colour': 'red', 'rect': [18, 18, 155, 20]}, {'page': 0, 'colour': 'blue', 'rect': [18, 48, 104, 64]}, {'page': 0, 'colour': 'magenta', 'rect': [18, 178, 54, 24]}],
  'features': [
   feat('ruler ticks 0..150 mm', 0, 'red', [19.5, 20.3, 151, 1.9], {'ticks': 151, 'first': 20, 'last': 170, 'span': 150, 'maxStepError': 0.05}, mode='ticks', axis='x', minTickMm=1.2, step=1),
   feat('grid verticals', 0, 'blue', [18, 51, 104, 8], {'ticks': 11, 'first': 20, 'last': 120, 'maxStepError': 0.05}, mode='ticks', axis='x', minTickMm=5, step=10),
   feat('grid horizontals', 0, 'blue', [21, 48, 8, 64], {'ticks': 7, 'first': 50, 'last': 110, 'maxStepError': 0.05}, mode='ticks', axis='y', minTickMm=5, step=10),
   # circle template (D45): first circle centre at (d/2, d/2) of the box → (145, 65), stroke 0.2 centred on r = 15
   feat('circle Ø30', 0, 'green', box(129.9, 49.9, 160.1, 80.1), {'l': 129.9, 't': 49.9, 'r': 160.1, 'b': 80.1, 'cx': 145, 'cy': 65, 'area': math.pi * (15.1 ** 2 - 14.9 ** 2)}, areaTol=0.03),
   feat('dot row y=180', 0, 'magenta', [19, 179.5, 52, 1.0], {'ticks': 11, 'first': 20, 'last': 70, 'maxStepError': 0.05}, mode='ticks', axis='x', minTickMm=0.25, step=5),
   feat('lined paper', 0, 'ink', [110, 181, 10, 42], {'ticks': 5, 'first': 188, 'last': 220, 'maxStepError': 0.05}, mode='ticks', axis='y', minTickMm=0.5, step=8)]}})

# ------------------------------------------------------------------ 03 images
# red-square-300dpi.png: 200×200 px, red px [50,150)² → fractions 0.25..0.75 of the box.
# rotated copy: box (100,30) 60×40, fill mode stretches (0.3 × 0.2 mm/px): red local x 15..45, y 10..30; rotation 90°
# clockwise about the centre (130,50): (dx,dy) → (−dy, dx) → page x 120..140, y 35..65.
# blue-alpha.png: 100×100, blue [25,75)², transparent elsewhere (RGB black) → box (20,90) 50×50 → blue 32.5..57.5 × 102.5..127.5.
# orient6.jpg: raw 300×200, EXIF 6 → displayed 200×300; red raw [0,100)×[0,50) → displayed X 150..200, Y 0..100;
# green raw [200,300)×[150,200) → displayed X 0..50, Y 200..300. Box (100,90) 40×60 → 0.2 mm/px.
write('03-images', 'PNG with pHYs, rotated + stretched copy, RGBA transparency (transparent pixels are black: ignoring alpha would print black), JPEG with EXIF orientation 6 (CoreGraphics draws the raw pixels; the painter must rotate).', {
 'sheets': single(),
 'assets': [{'id': 1, 'kind': 'image', 'file': 'images/red-square-300dpi.png'}, {'id': 2, 'kind': 'image', 'file': 'images/blue-alpha.png'}, {'id': 3, 'kind': 'image', 'file': 'images/orient6.jpg'}],
 'objects': [obj(1, 'image', 20, 30, 40, 40, assetId=1), obj(2, 'image', 100, 30, 60, 40, assetId=1, rotationDeg=90),
             obj(3, 'image', 20, 90, 50, 50, assetId=2), obj(4, 'image', 100, 90, 40, 60, assetId=3)],
 'output': {'paperKey': 'a4'},
 'expect': {'pageCount': 1, 'pageSizeMm': A4, 'features': [
   feat('png red square', 0, 'red', box(30, 40, 50, 60, 3), {'cx': 40, 'cy': 50, 'area': 400.0}, areaTol=0.02),
   feat('png rotated 90 + stretched', 0, 'red', box(120, 35, 140, 65, 3), {'cx': 130, 'cy': 50, 'area': 600.0}, areaTol=0.02),
   feat('png alpha: blue square', 0, 'blue', box(32.5, 102.5, 57.5, 127.5, 3), {'cx': 45, 'cy': 115, 'area': 625.0}, areaTol=0.02),
   feat('png alpha: no black from transparent pixels (ink = blue only)', 0, 'ink', [15, 85, 60, 60], {'area': 625.0 * (2 / 3)}, areaTol=0.03),
   feat('jpeg EXIF 6: red block top-right', 0, 'red', box(130, 90, 140, 110, 2), {'cx': 135, 'cy': 100, 'area': 200.0}, areaTol=0.04),
   feat('jpeg EXIF 6: green block bottom-left', 0, 'green', box(100, 130, 110, 150, 2), {'cx': 105, 'cy': 140, 'area': 200.0}, areaTol=0.04)]}})

# ------------------------------------------------------------------ 04 PDF pages (SPEC §8.10, W9)
write('04-pdf-pages', 'Embedded PDF pages at 100 %: plain page, /UserUnit 2, /Rotate 90, CropBox (content outside the crop must not print).', {
 'sheets': single(),
 'assets': [{'id': 1, 'kind': 'pdf', 'file': 'pdf/red-100x60.pdf'}, {'id': 2, 'kind': 'pdf', 'file': 'pdf/userunit2.pdf'}, {'id': 3, 'kind': 'pdf', 'file': 'pdf/rotate90.pdf'}, {'id': 4, 'kind': 'pdf', 'file': 'pdf/cropbox.pdf'}],
 'objects': [obj(1, 'pdf_page', 15, 15, 100, 60, assetId=1), obj(2, 'pdf_page', 15, 85, 100, 60, assetId=2),
             obj(3, 'pdf_page', 15, 155, 100, 60, assetId=3), obj(4, 'pdf_page', 130, 15, 50, 50, assetId=4)],
 'output': {'paperKey': 'a4'},
 'expect': {'pageCount': 1, 'pageSizeMm': A4, 'features': [
   # red rect at (10,10) 30×20 of the page → (25..55, 25..45)
   feat('plain page', 0, 'red', box(25, 25, 55, 45), {'l': 25, 't': 25, 'r': 55, 'b': 45, 'area': 600.0}),
   # UserUnit 2: user (5,5) 10×10 → natural (10,10) 20×20 → (25..45, 95..115)
   feat('UserUnit 2', 0, 'blue', box(25, 95, 45, 115), {'l': 25, 't': 95, 'r': 45, 'b': 115, 'area': 400.0}),
   # Rotate 90: unrotated (10,5) 20×10 → displayed X = 100 − v ∈ 85..95, Y = u ∈ 10..30 → (100..110, 165..185)
   feat('Rotate 90', 0, 'green', box(100, 165, 110, 185), {'l': 100, 't': 165, 'r': 110, 'b': 185, 'area': 200.0}),
   # CropBox (25,25)-(75,75): magenta user x 30..50, y↑ 30..40 → natural X 5..25, Y 75−40..75−30 = 35..45 → (135..155, 50..60)
   feat('CropBox', 0, 'magenta', box(135, 50, 155, 60), {'l': 135, 't': 50, 'r': 155, 'b': 60, 'area': 200.0})]}})

# ------------------------------------------------------------------ 05 SVG set (A5/D24) — natural sizes per SPEC §8.9
px96 = 25.4 / 96
svg_objs = [obj(1, 'svg', 15, 15, 100, 50, assetId=1), obj(2, 'svg', 15, 70, 101.6, 50.8, assetId=2), obj(3, 'svg', 15, 125, 101.6, 50.8, assetId=3),
            obj(4, 'svg', 120, 15, 80, 40, assetId=4), obj(5, 'svg', 120, 60, 60, 60, assetId=5), obj(6, 'svg', 120, 125, 100 * px96, 60 * px96, assetId=6),
            obj(7, 'svg', 15, 180, 101.6, 50.8, assetId=7), obj(8, 'svg', 20, 20, 400 * px96, 200 * px96, assetId=8, sheetId=2)]
sw = 2 * 25.4 / 72 / 2  # Illustrator polyline: 2 px at 72 ppi, half width
write('05-svg-set', 'SVG exporter styles at 100 %: Inkscape mm (layer transform), Inkscape px (96), Illustrator 72 ppi (<style> classes, polyline, miter join), <use>/<symbol>, nested transforms + arcs, Figma clip-path (96), Cricut inches, Affinity 100 % width (96, sheet 2).', {
 'sheets': [{'id': 1, 'widthMm': 210, 'heightMm': 297}, {'id': 2, 'widthMm': 210, 'heightMm': 297}],
 'assets': [{'id': 1, 'kind': 'svg', 'file': 'svg/inkscape-mm.svg'}, {'id': 2, 'kind': 'svg', 'file': 'svg/inkscape-px96.svg', 'svgPxPerIn': 96},
            {'id': 3, 'kind': 'svg', 'file': 'svg/illustrator-72.svg', 'svgPxPerIn': 72}, {'id': 4, 'kind': 'svg', 'file': 'svg/use-symbol.svg'},
            {'id': 5, 'kind': 'svg', 'file': 'svg/transforms-arcs.svg'}, {'id': 6, 'kind': 'svg', 'file': 'svg/figma-clip.svg', 'svgPxPerIn': 96},
            {'id': 7, 'kind': 'svg', 'file': 'svg/cricut-in.svg'}, {'id': 8, 'kind': 'svg', 'file': 'svg/affinity-percent.svg', 'svgPxPerIn': 96}],
 'objects': svg_objs,
 'output': {'paperKey': 'a4'},
 'expect': {'pageCount': 2, 'pageSizeMm': A4, 'features': [
   feat('Inkscape mm: rect', 0, 'red', box(25, 25, 55, 45), {'l': 25, 't': 25, 'r': 55, 'b': 45, 'area': 600.0}),
   feat('Inkscape mm: circle r15', 0, 'blue', box(70, 25, 100, 55), {'l': 70, 't': 25, 'r': 100, 'b': 55, 'cx': 85, 'cy': 40, 'area': math.pi * 225}),
   feat('Inkscape px @96', 0, 'green', box(27.7, 82.7, 53.1, 95.4), {'l': 27.7, 't': 82.7, 'r': 53.1, 'b': 95.4, 'area': 25.4 * 12.7}),
   feat('Illustrator @72: .st0 rect', 0, 'red', box(27.7, 137.7, 53.1, 150.4), {'l': 27.7, 't': 137.7, 'r': 53.1, 'b': 150.4, 'area': 25.4 * 12.7}),
   feat('Illustrator @72: .st1 polyline (2 px stroke, miter)', 0, 'blue', box(65.8, 137.7 - sw, 91.2 + sw, 163.1), {'l': 65.8, 't': 137.7 - sw, 'r': 91.2 + sw, 'b': 163.1}),
   feat('<use> of <symbol> (viewBox 10 → 20 mm)', 0, 'green', box(130, 25, 150, 45), {'l': 130, 't': 25, 'r': 150, 'b': 45, 'cx': 140, 'cy': 35, 'area': math.pi * 100}),
   feat('<use> of rect at x=50', 0, 'magenta', box(170, 25, 180, 35), {'l': 170, 't': 25, 'r': 180, 'b': 35, 'area': 100.0}),
   feat('translate + rotate(90) rect', 0, 'red', box(135, 70, 165, 80), {'l': 135, 't': 70, 'r': 165, 'b': 80, 'cx': 150, 'cy': 75, 'area': 300.0}),
   feat('two-arc disc', 0, 'blue', box(140, 90, 160, 110), {'l': 140, 't': 90, 'r': 160, 'b': 110, 'cx': 150, 'cy': 100, 'area': math.pi * 100}),
   feat('Figma clip-path', 0, 'magenta', box(120, 125 + 10 * px96, 120 + 50 * px96, 125 + 30 * px96), {'l': 120, 't': 125 + 10 * px96, 'r': 120 + 50 * px96, 'b': 125 + 30 * px96, 'area': 50 * px96 * 20 * px96}),
   feat('Cricut 4 in', 0, 'green', box(27.7, 192.7, 53.1, 205.4), {'l': 27.7, 't': 192.7, 'r': 53.1, 'b': 205.4, 'area': 25.4 * 12.7}),
   feat('Affinity 100 % @96 (sheet 2)', 1, 'blue', box(20 + 50 * px96, 20 + 50 * px96, 20 + 150 * px96, 20 + 100 * px96), {'l': 20 + 50 * px96, 't': 20 + 50 * px96, 'r': 20 + 150 * px96, 'b': 20 + 100 * px96, 'area': 100 * px96 * 50 * px96})]}})

# ------------------------------------------------------------------ 06 repeat + trim marks (SPEC §8.5, D41)
write('06-repeat-trim', 'Rect 20×10 repeated 3×2 with 5 mm gaps and trim marks (1 mm gap, 5 mm long, at every copy edge).', {
 'sheets': single(),
 'objects': [obj(1, 'rect', 30, 30, 20, 10, props={'fill': '#ff0000', 'stroke': None}, repeat={'cols': 3, 'rows': 2, 'gap_x_mm': 5, 'gap_y_mm': 5, 'trim_marks': True})],
 'output': {'paperKey': 'a4'},
 'expect': {'pageCount': 1, 'pageSizeMm': A4, 'features': [
   feat('6 copies', 0, 'red', [28, 28, 74, 29], {'l': 30, 't': 30, 'r': 100, 'b': 55, 'area': 1200.0}),
   feat('trim marks above (x)', 0, 'ink', [28, 24.3, 74, 4.4], {'positions': [30, 50, 55, 75, 80, 100]}, mode='ticks', axis='x', minTickMm=3),
   feat('trim marks left (y)', 0, 'ink', [24.3, 28, 4.4, 29], {'positions': [30, 40, 45, 55]}, mode='ticks', axis='y', minTickMm=3)]}})

# ------------------------------------------------------------------ 07 W3 tiling (A3)
# 600×900 on A4, margins 6.35, overlap 10 → landscape: content 284.3 × 197.3, step 274.3 × 187.3, 3 × 5 = 15 + map.
# Page order: map, A1, A2, A3, B1, … Tile (r,c) page = sheet − (c·274.3, r·187.3) + (6.35, 6.35).
# Red rect sheet (240..270, 160..230): A1 → (246.35..276.35, 166.35..203.65 [content edge]); B1 → y 6.35..49.05.
# Registration marks (D40): A1|A2 at sheet x 274.3 + 5 = 279.3, y ¼·197.3 = 49.325 → A1 (285.65, 55.675), A2 (11.35, 55.675)
# A1|B1 at sheet y 187.3 + 5 = 192.3, x ¼·284.3 = 71.075 → A1 (77.425, 198.65), B1 (77.425, 11.35)
write('07-tiling-w3', 'SPEC W3: 600×900 mm on A4 → landscape 3×5 = 15 tiles + assembly map, every page portrait A4 with the landscape frame turned onto it (D53); tile content alignment and registration marks of neighbours coincide after the sheet offset (A3).', {
 'sheets': [{'id': 1, 'widthMm': 600, 'heightMm': 900}],
 'objects': [obj(1, 'rect', 240, 160, 30, 70, props={'fill': '#ff0000', 'stroke': None})],
 'output': {'paperKey': 'a4', 'skipBlank': False},
 'expect': {'pageCount': 16, 'pageSizeMm': A4, 'paperMm': A4, 'allow': [{'page': 0, 'colour': 'red'}], 'features': [turned(x, 297) for x in [
   feat('A1 red (clipped at content edge)', 1, 'red', box(246.35, 166.35, 276.35, 203.65), {'l': 246.35, 't': 166.35, 'r': 276.35, 'b': 203.65}),
   feat('B1 red', 4, 'red', box(246.35, 6.35, 276.35, 49.05), {'l': 246.35, 't': 6.35, 'r': 276.35, 'b': 49.05}),
   feat('A1 mark → A2', 1, 'ink', [280.85, 50.875, 9.6, 9.6], {'cx': 285.65, 'cy': 55.675}),
   feat('A2 mark ← A1', 2, 'ink', [7.0, 50.875, 8.7, 9.6], {'cx': 11.35, 'cy': 55.675}),
   feat('A1 mark ↓ B1', 1, 'ink', [72.625, 193.85, 9.6, 9.6], {'cx': 77.425, 'cy': 198.65}),
   feat('B1 mark ↑ A1', 4, 'ink', [72.625, 7.0, 9.6, 8.7], {'cx': 77.425, 'cy': 11.35})]],
  'same': [turned_same(x) for x in [{'a': 'A1 mark → A2', 'b': 'A2 mark ← A1', 'dx': -274.3, 'dy': 0}, {'a': 'A1 mark ↓ B1', 'b': 'B1 mark ↑ A1', 'dx': 0, 'dy': -187.3}]]}})

# ------------------------------------------------------------------ 08 W4 1 m ruler (red ticks every mm across 4 tiles)
# landscape 4 × 1 + map; tile c page x = k − c·274.3 + 6.35; windows keep ≥ 0.1 mm from tick ink at their edges and
# stay in y 6.6..7.6, above the tile label box (content corner + 1.5 mm, D40).
write('08-ruler-w4', 'SPEC W4: 1 000 × 30 mm ruler on A4 → 4 landscape tiles + map, turned onto portrait A4 (D53); every 1 mm tick of each tile measured, and the 280 mm tick printed on both A1 and A2 coincides after the 274.3 mm sheet offset.', {
 'sheets': [{'id': 1, 'widthMm': 1000, 'heightMm': 30}],
 'objects': [obj(1, 'ruler', 0, 0, 1000, 30, props={'colour': '#ff0000', 'unit': 'mm'})],
 'output': {'paperKey': 'a4'},
 'expect': {'pageCount': 5, 'pageSizeMm': A4, 'paperMm': A4, 'allow': [{'page': '*', 'colour': 'red'}], 'features': [turned(x, 297) for x in [
   feat('A1 ticks 1..283', 1, 'red', [6.8, 6.6, 283.4, 1.0], {'ticks': 283, 'first': 7.35, 'last': 289.35, 'maxStepError': 0.05}, mode='ticks', axis='x', minTickMm=0.6, step=1),
   feat('A2 ticks 275..558', 2, 'red', [6.8, 6.6, 283.6, 1.0], {'ticks': 284, 'first': 7.05, 'last': 290.05, 'maxStepError': 0.05}, mode='ticks', axis='x', minTickMm=0.6, step=1),
   feat('A3 ticks 550..832', 3, 'red', [6.95, 6.6, 283.45, 1.0], {'ticks': 283, 'first': 7.75, 'last': 289.75, 'maxStepError': 0.05}, mode='ticks', axis='x', minTickMm=0.6, step=1),
   feat('A4 ticks 824..999', 4, 'red', [6.8, 6.6, 176.2, 1.0], {'ticks': 176, 'first': 7.45, 'last': 182.45, 'maxStepError': 0.05}, mode='ticks', axis='x', minTickMm=0.6, step=1),
   feat('tick 280 on A1', 1, 'red', [285.85, 6.6, 1.0, 1.0], {'cx': 286.35}),
   feat('tick 280 on A2', 2, 'red', [11.55, 6.6, 1.0, 1.0], {'cx': 12.05})]],
  'same': [turned_same(x) for x in [{'a': 'tick 280 on A1', 'b': 'tick 280 on A2', 'dx': -274.3, 'dy': None}]]}})

# ------------------------------------------------------------------ 09/10 calibration sheets (D18): bar A 150, bar B 200
# Window positions follow the D18 layout (bar A centred in the safe area 14 mm below its top; bar B 12 mm inside the
# left edge, centred vertically); the measured LENGTHS are the spec values. Only the end ticks reach above bar A's
# line / left of bar B's line, so the windows contain exactly two ticks each.
for name, paper, size, xA, yB in [('09-calibration-a4', 'a4', A4, 30, 48.5), ('10-calibration-letter', 'letter', LETTER, 32.95, 39.7)]:
    write(name, f'Calibration sheet {paper}: bar A = 150 mm, bar B = 200 mm between the end ticks (A2, D18).', {
     'kind': 'calibration', 'calibration': {'paperKey': paper, 'pages': 1},
     'output': {'paperKey': paper},
     'expect': {'pageCount': 1, 'pageSizeMm': size, 'features': [
       feat('bar A ends', 0, 'ink', [xA - 10, 16.85, 170, 3.0], {'positions': [xA, xA + 150], 'span': 150}, mode='ticks', axis='x', minTickMm=2),
       feat('bar B ends', 0, 'ink', [14.85, yB - 8, 3.0, 216], {'positions': [yB, yB + 200], 'span': 200}, mode='ticks', axis='y', minTickMm=2)]}})

# ------------------------------------------------------------------ 11/13 corrected output (SPEC §8.7, W7, A4)
for name, measured, margin_check in [('11-corrected-w7', 96.5, False), ('13-corrected-enlarging', 102.0, True)]:
    c = 100 / measured
    C = (105, 148.5)
    f = lambda v, k: C[k] + c * (v - C[k])
    write(name, f'Single page A4 with the stored correction c = 100/{measured} = {c:.6f} (W7) about the page centre: a 50×40 rect at (20, 30) and the check bar (100 mm → 100·c in the PDF, A4).' + ('' if margin_check else ' c > 1 moves the bar into the printer margin by design (owner question 1, D44): margin check off here.'), {
     'sheets': single(),
     'objects': [obj(1, 'rect', 20, 30, 50, 40, props={'fill': '#ff0000', 'stroke': None})],
     'output': {'paperKey': 'a4', 'checkBar': True},
     'corrections': [{'paperKey': 'a4', 'jobKind': 'single', 'fx': c, 'fy': c}], 'applyCorrection': True,
     'expect': {'pageCount': 1, 'pageSizeMm': A4, 'marginCheck': margin_check, 'features': [
       feat('corrected rect', 0, 'red', box(f(20, 0), f(30, 1), f(70, 0), f(70, 1)), {'l': f(20, 0), 't': f(30, 1), 'r': f(70, 0), 'b': f(70, 1)}),
       feat('check bar 0..100 (×c)', 0, 'ink', [0, 240, 210, 57], {'ticks': 11, 'span': 100 * c, 'maxStepError': 0.05}, mode='ticks', axis='x', minTickMm=1.8, step=10 * c)]}})

# ------------------------------------------------------------------ 12 placed A6 on A4 (SPEC §8.6, D42) + check bar
# offset ((210−105)/2, (297−148)/2) = (52.5, 74.5); crop marks 1 mm outside the sheet corners, 5 mm long.
write('12-placed-a6', 'A6 sheet centred on A4 with crop marks and the uncorrected check bar (100 mm).', {
 'sheets': [{'id': 1, 'widthMm': 105, 'heightMm': 148}],
 'objects': [obj(1, 'rect', 10, 10, 20, 20, props={'fill': '#ff0000', 'stroke': None})],
 'output': {'paperKey': 'a4', 'checkBar': True},
 'expect': {'pageCount': 1, 'pageSizeMm': A4, 'features': [
   feat('rect on placed sheet', 0, 'red', box(62.5, 84.5, 82.5, 104.5), {'l': 62.5, 't': 84.5, 'r': 82.5, 'b': 104.5}),
   feat('crop marks top (x)', 0, 'ink', [45, 68.8, 120, 4.4], {'positions': [52.5, 157.5]}, mode='ticks', axis='x', minTickMm=3),
   feat('crop marks left (y)', 0, 'ink', [46.8, 70, 4.4, 157], {'positions': [74.5, 222.5]}, mode='ticks', axis='y', minTickMm=3),
   feat('check bar 0..100', 0, 'ink', [6.35, 240, 197.3, 50.65], {'ticks': 11, 'span': 100.0, 'maxStepError': 0.05}, mode='ticks', axis='x', minTickMm=1.8, step=10)]}})
# ------------------------------------------------------------------ 14 Letter, landscape frame turned (D53): assets, marks, bar
# Letter 215.9 × 279.4, margins 6.35, overlap 10. Sheet 500 × 380: portrait 3 × 2 = 6, landscape frame 279.4 × 215.9 →
# content 266.7 × 203.2, step 256.7 × 193.2 → 2 × 2 = 4 (auto = landscape) + map (skip blank off). Pages: map, A1, A2, B1, B2.
# Tile (r,c) frame = sheet − (c·256.7, r·193.2) + 6.35; then turned with Wf = 279.4.
# Image red-square-300dpi.png at (230, 70) 60×60 → red sheet 245..275 × 85..115: A1 x 251.35..273.05 (content edge),
#   A2 x 6.35..24.65 (sheet 256.7..275), y 91.35..121.35 on both.
# PDF red-100x60.pdf at (20, 120) 100×60 → red sheet (30..60, 130..150) → A1 frame (36.35..66.35, 136.35..156.35).
# SVG inkscape-mm.svg at (300, 250) 100×50 → rect local (10..40, 10..30), circle r15 at local (70, 25) → B2 frame
#   rect (59.65..89.65, 73.15..93.15), circle centre (119.65, 88.15).
# Registration A1|A2 at sheet x = 256.7 + 5 = 261.7, y = ¼ · 203.2 = 50.8 → A1 frame (268.05, 57.15), A2 (11.35, 57.15).
# Check bar (D43): maps first; the map keeps the bottom band free → bar at frame x = 6.35 + 0.5 = 6.85,
#   y = 6.35 + 203.2 − 10 + 3.5 = 203.05; ends at frame x 6.85 and 106.85 → turned: vertical, Y 172.55 … 272.55.
LW = 279.4
write('14-letter-turned-assets', 'Letter, 500×380 sheet → landscape frame 2×2 + map turned onto portrait Letter (D53): image across the A1|A2 seam, PDF page, SVG, registration marks and the check bar on the turned map all measure exactly.', {
 'sheets': [{'id': 1, 'widthMm': 500, 'heightMm': 380}],
 'assets': [{'id': 1, 'kind': 'image', 'file': 'images/red-square-300dpi.png'}, {'id': 2, 'kind': 'pdf', 'file': 'pdf/red-100x60.pdf'}, {'id': 3, 'kind': 'svg', 'file': 'svg/inkscape-mm.svg'}],
 'objects': [obj(1, 'image', 230, 70, 60, 60, assetId=1), obj(2, 'pdf_page', 20, 120, 100, 60, assetId=2), obj(3, 'svg', 300, 250, 100, 50, assetId=3)],
 'output': {'paperKey': 'letter', 'skipBlank': False, 'checkBar': True},
 'expect': {'pageCount': 5, 'pageSizeMm': LETTER, 'paperMm': LETTER, 'allow': [{'page': 0, 'colour': 'red'}, {'page': 0, 'colour': 'blue'}], 'features': [turned(x, LW) for x in [
   # image pixel edges are smoothed by the rasteriser (≈ 0.08 mm at 0.3 mm/px, as in 03): measure the clip edge, the
   # centre across the seam and the area; the seam edge is the exact content clip
   feat('A1 image red (clipped at content edge)', 1, 'red', box(251.35, 91.35, 273.05, 121.35, 3), {'r': 273.05, 'cy': 106.35, 'area': 21.7 * 30}, areaTol=0.02),
   feat('A2 image red', 2, 'red', box(6.35, 91.35, 24.65, 121.35, 3), {'l': 6.35, 'cy': 106.35, 'area': 18.3 * 30}, areaTol=0.02),
   feat('A1 PDF page red', 1, 'red', box(36.35, 136.35, 66.35, 156.35), {'l': 36.35, 't': 136.35, 'r': 66.35, 'b': 156.35, 'area': 600.0}),
   feat('B2 SVG rect', 4, 'red', box(59.65, 73.15, 89.65, 93.15), {'l': 59.65, 't': 73.15, 'r': 89.65, 'b': 93.15, 'area': 600.0}),
   feat('B2 SVG circle', 4, 'blue', box(104.65, 73.15, 134.65, 103.15), {'cx': 119.65, 'cy': 88.15, 'area': math.pi * 225}),
   feat('A1 mark → A2', 1, 'ink', [263.25, 52.35, 9.6, 9.6], {'cx': 268.05, 'cy': 57.15}),
   feat('A2 mark ← A1', 2, 'ink', [6.8, 52.35, 8.95, 9.6], {'cx': 11.35, 'cy': 57.15}),
   feat('check bar on the turned map', 0, 'ink', [6.0, 199.0, 102.0, 11.0], {'ticks': 11, 'span': 100.0, 'first': 6.85, 'last': 106.85, 'maxStepError': 0.05}, mode='ticks', axis='x', minTickMm=1.8, step=10)]],
  'same': [turned_same({'a': 'A1 mark → A2', 'b': 'A2 mark ← A1', 'dx': -256.7, 'dy': 0})]}})

# ------------------------------------------------------------------ 15 A4 landscape sheet = one turned page, anisotropic correction
# Sheet 297 × 210 = A4 landscape → 'single' in the landscape frame, turned onto portrait A4 (D53). Stored single-page
# correction fx = 100/101.5 (paper x), fy = 100/102 (paper y) about the PORTRAIT page centre (105, 148.5) — no swap any more:
# p' = C + c(p − C) in page terms after the turn. Frame → page: X = y, Y = 297 − x.
# Blue rect frame (80..130, 120..160) → page X 120..160, Y 167..217. PDF red rect frame (160..190, 30..50) → X 30..50, Y 107..137.
# Check bar (D43): bottom band of the frame safe area (y 193.65..203.65) is free → bar at frame (6.85, 197.15), ends x 6.85 / 106.85
# → page Y 190.15 … 290.15 (vertical on the paper, so it measures 100 · fy after the correction).
fx, fy = 100 / 101.5, 100 / 102
cX = lambda v: 105 + fx * (v - 105)
cY = lambda v: 148.5 + fy * (v - 148.5)
write('15-a4-landscape-single-corrected', 'A 297×210 sheet on A4: one landscape frame turned onto portrait A4 (D53) with an anisotropic single-page correction applied in paper terms (fx along the paper width, fy along its length — no swap); PDF page, rect and the turned check bar (100·fy).', {
 'sheets': [{'id': 1, 'widthMm': 297, 'heightMm': 210}],
 'assets': [{'id': 1, 'kind': 'pdf', 'file': 'pdf/red-100x60.pdf'}],
 'objects': [obj(1, 'rect', 80, 120, 50, 40, props={'fill': '#0000ff', 'stroke': None}), obj(2, 'pdf_page', 150, 20, 100, 60, assetId=1)],
 'output': {'paperKey': 'a4', 'checkBar': True},
 'corrections': [{'paperKey': 'a4', 'jobKind': 'single', 'fx': fx, 'fy': fy}], 'applyCorrection': True,
 'expect': {'pageCount': 1, 'pageSizeMm': A4, 'features': [
   feat('blue rect (turned, corrected)', 0, 'blue', box(cX(120), cY(167), cX(160), cY(217)), {'l': cX(120), 't': cY(167), 'r': cX(160), 'b': cY(217)}),
   feat('PDF red (turned, corrected)', 0, 'red', box(cX(30), cY(107), cX(50), cY(137)), {'l': cX(30), 't': cY(107), 'r': cX(50), 'b': cY(137)}),
   feat('check bar ×fy along the paper length', 0, 'ink', [cX(193.5), cY(186), cX(204) - cX(193.5), cY(294) - cY(186)], {'ticks': 11, 'span': 100 * fy, 'first': cY(190.15), 'last': cY(290.15), 'maxStepError': 0.05}, mode='ticks', axis='y', minTickMm=1.8 * fx, step=10 * fy)]}})
# ------------------------------------------------------------------ 16 Android single page, enlarging correction (v1.1, REVIEW_V1 finding 1, D83)
# A4 lined paper filling the template safe area at the printer's 6.35 mm margins (box 6.35, 6.35, 197.3 × 284.3; red lines
# 0.15 mm at y = 6.35 + 8k, k ≥ 1). Stored single-page correction c = 1.02 (measured 98.039 → 100/98.039). The print
# screen widens the margins so the CORRECTED ink stays inside the printer's 6.35 mm: per side m' = C − (C − m)/c, rounded
# UP to 0.01 mm (C = 105 across, 148.5 along). Check bar switched off, but forced on (Android + enlarging correction); the
# lines give way to it: their clip ends 11 mm (bar footprint 10 + clearance 1) above the bottom of the safe area and the
# bar sits in that band, left-aligned: origin (L + 0.5, (297 − B) − 10 + 3.5).
c = 1.02
m = 6.35
Lw = math.ceil((105 - (105 - m) / c) * 100) / 100      # 8.29
Tw = math.ceil((148.5 - (148.5 - m) / c) * 100) / 100  # 9.14
cx = lambda v: 105 + c * (v - 105)
cy = lambda v: 148.5 + c * (v - 148.5)
clip_bottom = 297 - Tw - 11
ks = [k for k in range(1, 40) if Tw + 0.075 <= m + 8 * k <= clip_bottom - 0.075]
bar_x, bar_y = Lw + 0.5, 297 - Tw - 10 + 3.5
write('16-android-enlarging-lines', 'Android single-page job (marginRule fit) with an ENLARGING single-page correction ×1.02 on A4 lined paper that fills the safe area (v1.1, REVIEW_V1 finding 1, D83): margins widened so the corrected ink stays inside the printer\'s 6.35 mm strips (checked on the PDF), the check bar forced on (switched off) and placed where the lines give way; it measures 100·c in the PDF.', {
 'sheets': single(),
 'objects': [obj(1, 'lines', m, m, 210 - 2 * m, 297 - 2 * m, props={'spacingMm': 8, 'marginMm': 0, 'colour': '#ff0000'})],
 'output': {'paperKey': 'a4', 'checkBar': False, 'margins': {'l': Lw, 't': Tw, 'r': Lw, 'b': Tw}},
 'printerMargins': {'l': m, 't': m, 'r': m, 'b': m}, 'marginRule': 'fit',
 'corrections': [{'paperKey': 'a4', 'jobKind': 'single', 'fx': c, 'fy': c}], 'applyCorrection': True,
 'expect': {'pageCount': 1, 'pageSizeMm': A4, 'marginStripsMm': [m, m, m, m],
   'forbiddenWarnings': ['notDesignedSize', 'assetSizeUnknown', 'objectOffSheet', 'correctionIntoMargin', 'correctionOffPage', 'checkBarOmitted'],
   'requiredWarnings': ['correctionEnlarges', 'checkBarForced', 'checkBarRoomMade', 'objectInMargin'],
   'allow': [{'page': 0, 'colour': 'red'}],
   'features': [
     feat('lines ×c (step 8·c)', 0, 'red', [150, 0, 10, 297], {'ticks': len(ks), 'first': cy(m + 8 * ks[0]), 'last': cy(m + 8 * ks[-1]), 'maxStepError': 0.05}, mode='ticks', axis='y', minTickMm=2, step=8 * c),
     feat('line ends inside the printer margins', 0, 'red', [0, cy(m + 8 * 18) - 3, 210, 6], {'l': cx(Lw), 'r': cx(210 - Lw)}),
     feat('check bar 0..100 (×c), forced on', 0, 'ink', [0, cy(bar_y) - 0.2, 120, 6 * c + 0.6], {'ticks': 11, 'span': 100 * c, 'first': cx(bar_x), 'maxStepError': 0.05}, mode='ticks', axis='x', minTickMm=1.8, step=10 * c)]}})
print('written', sorted(p.name for p in OUT.glob('*.json')))
