#!/usr/bin/env python3
"""Spec-first oracle for the Maker Print importers and asset placement maths (P3; L20/L27).

Written from docs/SPEC.md §8.9-§8.10, W8-W9, D15/D24 and the SVG/PDF/EXIF/PNG specifications cited below, BEFORE the
TypeScript importers and the asset painter existed. It never imports or reads src/. Exact `fractions` where the maths
is rational; trig (rotate/skew/arcs) in floats with the tolerance stated in the test. Writes
test/fixtures/engine/oracle-p3.json, compared in src/import/oracle-p3.test.ts.

CAVEAT (L27 rule 4): the same agent wrote this oracle and the P3 code (oracle first). P3.5's reviewer writes its own.
Run: python3 scripts/oracle/p3_oracle.py

Interpretations fixed here (D47-D50 in docs/DECISIONS.md explain them):
- SVG length (SPEC §8.9): CSS number + optional unit, units ASCII case-insensitive. Absolute: mm, cm, in, pt (1/72 in),
  pc (12 pt), q (1/4 mm). px or no unit = px at the chosen ppi (96/72/90/custom) -> needs the ppi question.
  %, em, ex, missing -> "relative": derived from the viewBox. A value <= 0 or unparsable -> error badLength.
- SVG natural size: both absolute -> done. Otherwise each relative side comes from the viewBox: if the other side is
  known, side = other * (vb side ratio); if both are relative, side = vb side px at ppi. viewBox = 4 numbers split by
  whitespace and/or one comma; vw or vh <= 0 -> error badViewBox. Relative side without a usable viewBox -> noSize.
  needsPpi = any side (or the side it was derived from) is in px.
- SVG root mapping (SVG 2 §8.2 "equivalent transform"): viewBox (vx,vy,vw,vh) onto [0,W]x[0,H] mm, y down,
  preserveAspectRatio <align> [meet|slice], default xMidYMid meet; none = independent scales.
- CSS absolute units inside the drawing: 1in = 96 user units (CSS px), so 1mm = 96/25.4.
- Transform lists (SVG 1.1 §7.6): matrix, translate(tx [ty=0]), scale(sx [sy=sx]), rotate(a [cx cy]),
  skewX(a), skewY(a); applied left to right (the list's matrix = M1 * M2 * ...). Degrees, positive = clockwise on
  the y-down page.
- Path arcs (SVG 1.1 Appendix F.6.5/F.6.6): endpoint -> centre parameterisation, radii scaled up when too small,
  zero radius -> straight line, identical endpoints -> omitted.
- PDF page (SPEC §8.10): box = CropBox n MediaBox (rectangles normalised; empty intersection or missing CropBox ->
  MediaBox) x UserUnit (default 1); /Rotate normalised mod 360 (non-multiples of 90 -> 0, noted); natural size =
  box in mm, w/h swapped for 90/270. Natural coordinates = the page as displayed (rotated clockwise by /Rotate),
  origin top-left, y down, mm. The oracle derives them by rotating each point about the box's lower-left corner in
  y-up space, re-anchoring the rotated box at the origin and flipping y — not with per-case formulas.
- Images: PNG pHYs unit 1 = pixels per metre (dpi = ppm * 0.0254), unit 0 = aspect only (no size). JFIF APP0 units
  1 = dpi, 2 = dots per cm, 0 = aspect only. EXIF IFD0 XResolution/YResolution (RATIONAL) with ResolutionUnit 2 = inch
  (default), 3 = cm, 1 = none. EXIF wins over JFIF when both declare a density. A density within 0.5 of 72 or 96 dpi
  (either axis; PNG stores 72 dpi as 2835 px/m = 72.009 dpi) is a placeholder written by cameras/phones/editors -> no physical size suggested (D48).
- EXIF orientation 1-8 (CIPA DC-008 / TIFF 6.0 tag 274): raw pixel (x, y) -> displayed pixel:
  1 (x,y) 2 (w-x,y) 3 (w-x,h-y) 4 (x,h-y) 5 (y,x) 6 (h-y,x) 7 (h-y,w-x) 8 (y,w-x); 5-8 swap the displayed size.
  The oracle derives them from "0th row / 0th column" descriptions as compositions of flips and quarter turns.
"""
import json
import math
import random
import re
from fractions import Fraction as F
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
rng = random.Random(20261001 + 3)
MM_PER_IN = F(254, 10)
CSS_PX_PER_IN = 96

# ---------------------------------------------------------------------------------------------- SVG lengths and size
UNIT_MM = {'mm': F(1), 'cm': F(10), 'in': MM_PER_IN, 'pt': MM_PER_IN / 72, 'pc': MM_PER_IN / 6, 'q': F(1, 4)}
NUM = r'[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?'


def parse_length(s):
    """-> ('abs', mm) | ('px', px) | ('rel', None) | ('bad', None)"""
    if s is None:
        return ('rel', None)
    t = s.strip()
    m = re.fullmatch(r'(' + NUM + r')\s*([A-Za-z%]*)', t)
    if not m:
        return ('bad', None)
    v = F(m.group(1))
    u = m.group(2).lower()
    if u in ('%', 'em', 'ex'):
        return ('rel', None)
    if v <= 0:
        return ('bad', None)
    if u in ('', 'px'):
        return ('px', v)
    if u in UNIT_MM:
        return ('abs', v * UNIT_MM[u])
    return ('bad', None)


def parse_viewbox(s):
    if s is None:
        return None
    parts = [p for p in re.split(r'\s*,\s*|\s+', s.strip()) if p != '']
    if len(parts) != 4 or not all(re.fullmatch(NUM, p) for p in parts):
        return 'bad'
    x, y, w, h = (F(p) for p in parts)
    if w <= 0 or h <= 0:
        return 'bad'
    return (x, y, w, h)


def svg_size(width, height, viewbox, ppi):
    px = MM_PER_IN / F(ppi)
    lw, lh = parse_length(width), parse_length(height)
    if lw[0] == 'bad' or lh[0] == 'bad':
        return {'ok': False, 'error': 'badLength'}
    vb = parse_viewbox(viewbox)
    if vb == 'bad':
        if lw[0] == 'rel' or lh[0] == 'rel':
            return {'ok': False, 'error': 'badViewBox'}
        vb = None

    def mm(l):
        return l[1] if l[0] == 'abs' else l[1] * px

    needs = lw[0] == 'px' or lh[0] == 'px'
    if lw[0] != 'rel' and lh[0] != 'rel':
        w, h = mm(lw), mm(lh)
    elif vb is None:
        return {'ok': False, 'error': 'noSize'}
    elif lw[0] != 'rel':
        w = mm(lw)
        h = w * vb[3] / vb[2]
    elif lh[0] != 'rel':
        h = mm(lh)
        w = h * vb[2] / vb[3]
    else:
        w, h = vb[2] * px, vb[3] * px
        needs = True
    return {'ok': True, 'w': float(w), 'h': float(h), 'needsPpi': needs}


def rand_len():
    r = rng.random()
    if r < 0.08:
        return None
    v = rng.choice([rng.randint(1, 2000), round(rng.uniform(0.01, 1500), rng.randint(0, 4))])
    num = rng.choice([str(v), f'{v:e}' if rng.random() < 0.1 else str(v)])
    unit = rng.choice(['', '', 'px', 'mm', 'cm', 'in', 'pt', 'pc', 'q', 'MM', '%', 'em', 'xx'])
    if rng.random() < 0.04:
        num = '-' + num
    if rng.random() < 0.03:
        num = '0'
    sp = ' ' if rng.random() < 0.1 else ''
    return sp + num + unit + sp


def rand_vb():
    r = rng.random()
    if r < 0.15:
        return None
    nums = [rng.choice([0, rng.randint(-50, 50), round(rng.uniform(-10, 10), 3)]), rng.choice([0, rng.randint(-50, 50)]),
            rng.choice([rng.randint(1, 3000), round(rng.uniform(0.1, 900), 3)]), rng.choice([rng.randint(1, 3000), round(rng.uniform(0.1, 900), 3)])]
    if r < 0.2:
        nums[2] = 0
    sep = rng.choice([' ', ',', ', ', '  ', ' ,'])
    return sep.join(str(n) for n in nums)


svg_sizes = []
# W8 named cases first
for w, h, vb in [('400', '300', None), ('400', '300', '0 0 400 300'), ('50mm', '30mm', '0 0 999 1'), ('50mm', None, '0 0 100 60')]:
    for ppi in (96, 72, 90):
        svg_sizes.append({'width': w, 'height': h, 'viewBox': vb, 'ppi': ppi, **svg_size(w, h, vb, ppi)})
for _ in range(1200):
    w, h, vb = rand_len(), rand_len(), rand_vb()
    ppi = rng.choice([96, 72, 90, 300, 254, 100.5])
    svg_sizes.append({'width': w, 'height': h, 'viewBox': vb, 'ppi': ppi, **svg_size(w, h, vb, ppi)})
w8 = {r['ppi']: (r['w'], r['h']) for r in svg_sizes[:3]}
assert abs(w8[96][0] - 105.8333333) < 1e-6 and abs(w8[96][1] - 79.375) < 1e-12, w8
assert abs(w8[72][0] - 141.1111111) < 1e-6 and abs(w8[72][1] - 105.8333333) < 1e-6
assert abs(w8[90][0] - 112.8888889) < 1e-6 and abs(w8[90][1] - 84.6666667) < 1e-6
assert svg_sizes[6]['w'] == 50 and svg_sizes[6]['h'] == 30 and not svg_sizes[6]['needsPpi']

# ---------------------------------------------------------------------------------------------- root viewport map
ALIGNS = ['none', 'xMinYMin', 'xMidYMin', 'xMaxYMin', 'xMinYMid', 'xMidYMid', 'xMaxYMid', 'xMinYMax', 'xMidYMax', 'xMaxYMax']


def viewport_map(vb, W, H, par):
    vx, vy, vw, vh = vb
    parts = (par or 'xMidYMid meet').split()
    align = parts[0]
    slice_ = len(parts) > 1 and parts[1] == 'slice'
    sx, sy = W / vw, H / vh
    if align != 'none':
        s = max(sx, sy) if slice_ else min(sx, sy)
        sx = sy = s
    tx, ty = -vx * sx, -vy * sy
    if align != 'none':
        if 'xMid' in align:
            tx += (W - vw * sx) / 2
        if 'xMax' in align:
            tx += W - vw * sx
        if 'YMid' in align:
            ty += (H - vh * sy) / 2
        if 'YMax' in align:
            ty += H - vh * sy
    return [sx, 0, 0, sy, tx, ty]


def fr(x):
    return F(x).limit_denominator(10 ** 6) if isinstance(x, float) else F(x)


viewports = []
for _ in range(400):
    vb = (fr(rng.choice([0, rng.randint(-100, 100)])), fr(rng.choice([0, rng.randint(-100, 100)])), F(rng.randint(1, 2000)), F(rng.randint(1, 2000)))
    W, H = F(rng.randint(1, 4000), 10), F(rng.randint(1, 4000), 10)
    par = rng.choice([None, 'none'] + [a + rng.choice(['', ' meet', ' slice']) for a in ALIGNS[1:]])
    m = viewport_map(vb, W, H, par)
    pts = [(F(rng.randint(-200, 2200)), F(rng.randint(-200, 2200))) for _ in range(3)]
    viewports.append({'viewBox': [float(v) for v in vb], 'size': [float(W), float(H)], 'par': par, 'matrix': [float(v) for v in m],
                      'points': [[float(x), float(y), float(m[0] * x + m[4]), float(m[3] * y + m[5])] for x, y in pts]})

# ---------------------------------------------------------------------------------------------- CSS units in drawing
css_units = []
UNIT_USER = {'': F(1), 'px': F(1), 'mm': F(96) / MM_PER_IN, 'cm': F(960) / MM_PER_IN, 'in': F(96), 'pt': F(96, 72), 'pc': F(16), 'q': F(24) / MM_PER_IN}
for _ in range(200):
    u = rng.choice(list(UNIT_USER))
    v = F(rng.randint(-5000, 5000), rng.choice([1, 10, 100, 1000]))
    css_units.append({'text': f'{float(v)}{u}', 'user': float(v * UNIT_USER[u])})

# ---------------------------------------------------------------------------------------------- transform lists


def mul(m, n):
    a, b, c, d, e, f = m
    A, B, C, D, E, Fv = n
    return [a * A + c * B, b * A + d * B, a * C + c * D, b * C + d * D, a * E + c * Fv + e, b * E + d * Fv + f]


def rot(deg):
    r = math.radians(deg)
    return [math.cos(r), math.sin(r), -math.sin(r), math.cos(r), 0, 0]


def tr_item(kind):
    if kind == 'matrix':
        args = [round(rng.uniform(-3, 3), 3) for _ in range(4)] + [rng.randint(-100, 100), rng.randint(-100, 100)]
        return f'matrix({args[0]} {args[1]},{args[2]} {args[3]} {args[4]} {args[5]})', [float(a) for a in args]
    if kind == 'translate':
        if rng.random() < 0.3:
            tx = rng.randint(-100, 100)
            return f'translate({tx})', [1, 0, 0, 1, tx, 0]
        tx, ty = round(rng.uniform(-100, 100), 2), round(rng.uniform(-100, 100), 2)
        return f'translate({tx}{rng.choice([",", " ", ", "])}{ty})', [1, 0, 0, 1, tx, ty]
    if kind == 'scale':
        if rng.random() < 0.4:
            s = round(rng.uniform(-3, 3), 3) or 1
            return f'scale({s})', [s, 0, 0, s, 0, 0]
        sx, sy = round(rng.uniform(0.1, 3), 3), round(rng.uniform(-3, -0.1), 3)
        return f'scale({sx} {sy})', [sx, 0, 0, sy, 0, 0]
    if kind == 'rotate':
        a = rng.choice([90, -90, 180, 45, 30, round(rng.uniform(-360, 360), 2)])
        if rng.random() < 0.5:
            cx, cy = rng.randint(-50, 50), rng.randint(-50, 50)
            m = mul(mul([1, 0, 0, 1, cx, cy], rot(a)), [1, 0, 0, 1, -cx, -cy])
            return f'rotate({a} {cx} {cy})', m
        return f'rotate({a})', rot(a)
    if kind == 'skewX':
        a = round(rng.uniform(-60, 60), 1)
        return f'skewX({a})', [1, 0, math.tan(math.radians(a)), 1, 0, 0]
    a = round(rng.uniform(-60, 60), 1)
    return f'skewY({a})', [1, math.tan(math.radians(a)), 0, 1, 0, 0]


transforms = []
for _ in range(400):
    n = rng.randint(1, 4)
    parts, m = [], [1, 0, 0, 1, 0, 0]
    for _ in range(n):
        s, mm_ = tr_item(rng.choice(['matrix', 'translate', 'scale', 'rotate', 'skewX', 'skewY']))
        parts.append(s)
        m = mul(m, mm_)
    sep = rng.choice([' ', ',', '  ', '\n'])
    transforms.append({'text': sep.join(parts), 'matrix': m})

# ---------------------------------------------------------------------------------------------- path arcs (F.6.5)


def arc_centre(x1, y1, rx, ry, phi_deg, fa, fs, x2, y2):
    if x1 == x2 and y1 == y2:
        return None
    rx, ry = abs(rx), abs(ry)
    if rx == 0 or ry == 0:
        return {'line': True}
    phi = math.radians(phi_deg % 360)
    cp, sp = math.cos(phi), math.sin(phi)
    dx2, dy2 = (x1 - x2) / 2, (y1 - y2) / 2
    x1p = cp * dx2 + sp * dy2
    y1p = -sp * dx2 + cp * dy2
    lam = x1p ** 2 / rx ** 2 + y1p ** 2 / ry ** 2
    if lam > 1:
        s = math.sqrt(lam)
        rx, ry = rx * s, ry * s
    num = rx ** 2 * ry ** 2 - rx ** 2 * y1p ** 2 - ry ** 2 * x1p ** 2
    den = rx ** 2 * y1p ** 2 + ry ** 2 * x1p ** 2
    co = math.sqrt(max(0.0, num / den))
    if fa == fs:
        co = -co
    cxp, cyp = co * rx * y1p / ry, -co * ry * x1p / rx
    cx = cp * cxp - sp * cyp + (x1 + x2) / 2
    cy = sp * cxp + cp * cyp + (y1 + y2) / 2

    def ang(ux, uy, vx, vy):
        a = math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
        return a

    t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
    dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
    if not fs and dt > 0:
        dt -= 2 * math.pi
    elif fs and dt < 0:
        dt += 2 * math.pi
    return {'cx': cx, 'cy': cy, 'rx': rx, 'ry': ry, 'phi': phi_deg % 360, 't1': t1, 'dt': dt}


arcs = []
for _ in range(400):
    x1, y1 = rng.randint(-100, 100), rng.randint(-100, 100)
    if rng.random() < 0.05:
        x2, y2 = x1, y1
    else:
        x2, y2 = rng.randint(-100, 100), rng.randint(-100, 100)
    rx = 0 if rng.random() < 0.08 else rng.choice([rng.randint(1, 150), round(rng.uniform(0.5, 30), 2)])
    ry = rng.choice([rng.randint(1, 150), round(rng.uniform(0.5, 30), 2), -rng.randint(1, 50)])
    phi = rng.choice([0, 0, 30, -45, 90, round(rng.uniform(-400, 400), 1)])
    fa, fs = rng.randint(0, 1), rng.randint(0, 1)
    rel = rng.random() < 0.4
    end = (x2 - x1, y2 - y1) if rel else (x2, y2)
    d = f'M{x1} {y1} {"a" if rel else "A"}{rx} {ry} {phi} {fa} {fs} {end[0]} {end[1]}'
    if rng.random() < 0.3:
        d = f'M{x1},{y1}{"a" if rel else "A"}{rx},{ry},{phi},{fa}{fs}{end[0]},{end[1]}'.replace(',-', '-')
    arcs.append({'d': d, 'start': [x1, y1], 'end': [x2, y2], 'arc': arc_centre(x1, y1, rx, ry, phi, fa, fs, x2, y2)})
# sanity: a semicircle
sc = arc_centre(0, 0, 10, 10, 0, 0, 1, 20, 0)
assert abs(sc['cx'] - 10) < 1e-12 and abs(sc['cy']) < 1e-12 and abs(abs(sc['dt']) - math.pi) < 1e-12

# ---------------------------------------------------------------------------------------------- PDF boxes (SPEC §8.10)
K_MM = MM_PER_IN / 72


def norm_rect(r):
    x0, y0, x1, y1 = r
    return (min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))


def pdf_page(media, crop, user_unit, rotate):
    m = norm_rect(media)
    box = m
    if crop is not None:
        c = norm_rect(crop)
        i = (max(m[0], c[0]), max(m[1], c[1]), min(m[2], c[2]), min(m[3], c[3]))
        if i[2] > i[0] and i[3] > i[1]:
            box = i
    r = rotate % 360
    note = None
    if r % 90 != 0:
        r, note = 0, 'rotateInvalid'
    u = F(user_unit) if user_unit is not None else F(1)
    k = K_MM * u
    bw, bh = box[2] - box[0], box[3] - box[1]
    w, h = (bh, bw) if r in (90, 270) else (bw, bh)

    def to_natural(x, y):
        # rotate clockwise by r about the box's lower-left corner (y up), re-anchor at the origin, flip y, scale
        px, py = x - box[0], y - box[1]
        for _ in range(r // 90):
            px, py = py, -px  # one clockwise quarter turn in y-up space
        corners = [(0, 0), (bw, 0), (0, bh), (bw, bh)]
        for _ in range(r // 90):
            corners = [(cy_, -cx_) for cx_, cy_ in corners]
        minx = min(c[0] for c in corners)
        maxy = max(c[1] for c in corners)
        return ((px - minx) * k, (maxy - py) * k)

    pts = [(box[0] + bw * F(rng.randint(0, 8), 8), box[1] + bh * F(rng.randint(0, 8), 8)) for _ in range(3)] + [(box[0], box[1]), (box[2], box[3])]
    return {'box': [float(v) for v in box], 'rotate': r, 'userUnit': float(u), 'w': float(w * k), 'h': float(h * k), 'note': note,
            'points': [[float(x), float(y), *[float(v) for v in to_natural(x, y)]] for x, y in pts]}


pdf_pages = []
# W9 named cases
for media, crop, uu, rot_ in [((0, 0, F('1190.55'), F('1683.78')), None, None, 0), ((0, 0, F('595.28'), F('841.89')), None, 2, 0),
                              ((0, 0, F('1190.55'), F('1683.78')), None, None, 90)]:
    pdf_pages.append({'media': [float(v) for v in media], 'crop': crop, 'userUnitIn': uu, 'rotateIn': rot_, **pdf_page(media, crop, uu, rot_)})
assert round(pdf_pages[0]['w'], 1) == 420.0 and round(pdf_pages[0]['h'], 1) == 594.0
assert round(pdf_pages[1]['w'], 1) == 420.0 and round(pdf_pages[1]['h'], 1) == 594.0
assert round(pdf_pages[2]['w'], 1) == 594.0 and round(pdf_pages[2]['h'], 1) == 420.0
for _ in range(500):
    x0, y0 = rng.choice([0, 0, rng.randint(-300, 300)]), rng.choice([0, 0, rng.randint(-300, 300)])
    w, h = F(rng.randint(10, 300000), 100), F(rng.randint(10, 300000), 100)
    media = (x0, y0, x0 + w, y0 + h)
    if rng.random() < 0.15:
        media = (x0 + w, y0 + h, x0, y0)  # reversed corners
    crop = None
    r = rng.random()
    if r < 0.35:
        cx0, cy0 = x0 + w * F(rng.randint(-2, 8), 10), y0 + h * F(rng.randint(-2, 8), 10)
        crop = (cx0, cy0, cx0 + w * F(rng.randint(1, 12), 10), cy0 + h * F(rng.randint(1, 12), 10))
    elif r < 0.4:
        crop = (x0 + 2 * w, y0, x0 + 3 * w, y0 + h)  # disjoint -> MediaBox
    uu = rng.choice([None, None, None, 1, 2, F(1, 2), 75000 // 1000])
    rotate = rng.choice([0, 0, 90, 180, 270, -90, 450, 360, -270, 45])
    pdf_pages.append({'media': [float(v) for v in media], 'crop': [float(v) for v in crop] if crop else None,
                      'userUnitIn': float(uu) if uu is not None else None, 'rotateIn': rotate, **pdf_page(media, crop, uu, rotate)})

# ---------------------------------------------------------------------------------------------- images


def density(kind, x, y, unit, w_px, h_px):
    """-> {'dpiX','dpiY','mmW','mmH','placeholder'} | None"""
    if kind == 'phys':
        if unit != 1 or x == 0 or y == 0:
            return None
        dx, dy = F(x) * F(254, 10000), F(y) * F(254, 10000)
    elif kind == 'jfif':
        if unit not in (1, 2) or x == 0 or y == 0:
            return None
        dx, dy = (F(x), F(y)) if unit == 1 else (F(x) * F(254, 100), F(y) * F(254, 100))
    else:  # exif: x, y are (num, den); unit 2 inch, 3 cm, 1 none
        if unit == 1 or x[1] == 0 or y[1] == 0 or x[0] == 0 or y[0] == 0:
            return None
        dx, dy = F(x[0], x[1]), F(y[0], y[1])
        if unit == 3:
            dx, dy = dx * F(254, 100), dy * F(254, 100)
    placeholder = any(abs(d - t) < F(1, 2) for d in (dx, dy) for t in (72, 96))
    return {'dpiX': float(dx), 'dpiY': float(dy), 'mmW': float(w_px * MM_PER_IN / dx), 'mmH': float(h_px * MM_PER_IN / dy), 'placeholder': placeholder}


densities = []
for _ in range(300):
    kind = rng.choice(['phys', 'jfif', 'exif'])
    wpx, hpx = rng.randint(1, 8000), rng.randint(1, 8000)
    if kind == 'phys':
        v = rng.choice([2835, 3780, 11811, 0, rng.randint(1, 40000)])
        x, y, unit = v, rng.choice([v, rng.randint(1, 40000)]), rng.choice([1, 1, 1, 0])
    elif kind == 'jfif':
        v = rng.choice([72, 96, 300, 118, 0, rng.randint(1, 2400)])
        x, y, unit = v, rng.choice([v, v, rng.randint(1, 2400)]), rng.choice([1, 1, 2, 0])
    else:
        v = rng.choice([(72, 1), (300, 1), (3000000, 10000), (118, 1), (0, 1), (rng.randint(1, 30000), rng.randint(1, 100))])
        x, y, unit = v, rng.choice([v, v, (rng.randint(1, 3000), 1)]), rng.choice([2, 2, 3, 1])
    densities.append({'kind': kind, 'x': x, 'y': y, 'unit': unit, 'px': [wpx, hpx], 'result': density(kind, x, y, unit, wpx, hpx)})

# EXIF orientation from the TIFF 6.0 descriptions, built from quarter turns and flips (not the per-case table)
DESCR = {1: ('top', 'left'), 2: ('top', 'right'), 3: ('bottom', 'right'), 4: ('bottom', 'left'),
         5: ('left', 'top'), 6: ('right', 'top'), 7: ('right', 'bottom'), 8: ('left', 'bottom')}


def orient_point(o, x, y, w, h):
    """Raw (x, y) in a w x h image -> displayed (X, Y), from 'the 0th row is the visual <row>, the 0th column is the
    visual <col>': place the raw row 0 / column 0 on those display sides."""
    row, col = DESCR[o]
    if row in ('top', 'bottom'):
        X = x if col == 'left' else w - x
        Y = y if row == 'top' else h - y
    else:  # raw rows run vertically on screen: transpose first
        X = y if row == 'left' else h - y
        Y = x if col == 'top' else w - x
    return X, Y


orientations = []
for o in range(1, 9):
    w, h = rng.randint(2, 5000), rng.randint(2, 5000)
    pts = [(0, 0), (w, 0), (0, h), (w, h), (rng.randint(0, w), rng.randint(0, h))]
    dw, dh = (h, w) if o >= 5 else (w, h)
    orientations.append({'orientation': o, 'raw': [w, h], 'display': [dw, dh], 'points': [[x, y, *orient_point(o, x, y, w, h)] for x, y in pts]})
# the oracle's derivation must reproduce the TIFF table quoted in the header
TABLE = {1: lambda x, y, w, h: (x, y), 2: lambda x, y, w, h: (w - x, y), 3: lambda x, y, w, h: (w - x, h - y), 4: lambda x, y, w, h: (x, h - y),
         5: lambda x, y, w, h: (y, x), 6: lambda x, y, w, h: (h - y, x), 7: lambda x, y, w, h: (h - y, w - x), 8: lambda x, y, w, h: (y, w - x)}
for v in orientations:
    for x, y, X, Y in v['points']:
        assert TABLE[v['orientation']](x, y, *v['raw']) == (X, Y), (v['orientation'], x, y)

out = {'svgSizes': svg_sizes, 'viewports': viewports, 'cssUnits': css_units, 'transforms': transforms, 'arcs': arcs,
       'pdfPages': pdf_pages, 'densities': densities, 'orientations': orientations}
(ROOT / 'test/fixtures/engine/oracle-p3.json').write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':'), default=lambda o: float(o)))
print('oracle-p3:', {k: len(v) for k, v in out.items()}, 'total', sum(len(v) for v in out.values()))
