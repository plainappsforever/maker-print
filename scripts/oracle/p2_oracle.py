#!/usr/bin/env python3
"""Exact oracle for the Maker Print print-plan engine (P2; L20/L27).

Written from docs/SPEC.md §8.4-§8.8, W2, W6, W7, W10 and D18/D27, plus the P2 interpretations recorded as D39-D45 in
docs/DECISIONS.md, with Python `fractions`, BEFORE the TypeScript plan engine existed. It never imports or reads src/.
Writes test/fixtures/engine/oracle-p2.json, compared in src/engine/oracle-p2.test.ts. The P1 pending vectors
(oracle-p2-pending.json: tiling counts, fill counts, calibration, W3-W7) are consumed by the same test unchanged.

CAVEAT (L27 rule 4): the same agent wrote this oracle and the P2 engine (oracle first). P3.5 writes its own oracle.
Run: python3 scripts/oracle/p2_oracle.py

Interpretations fixed here (all from the SPEC text; the D-number is where docs/DECISIONS.md explains them):
- Output mode per orientation (§8.6, D39): sheet = paper (+-0.01 mm) -> single; W <= pw and H <= ph -> placed
  (centred); otherwise tiled. Page count: single/placed 1, tiled cols*rows. Auto = fewer pages, tie -> portrait.
- Tiles (§8.6): tw = pw-l-r, th = ph-t-b, step tw-o / th-o; cols = 1 if W <= tw else ceil((W-o)/sx); region of
  (r, c) = [c*sx, c*sx+tw] x [r*sy, r*sy+th]; visible = region n sheet. Labels: row letters (A..Z, AA..) + column.
- Registration marks (§8.6, D40): for each pair of horizontal neighbours (r,c)|(r,c+1): x = (c+1)*sx + o/2, along
  the strip's extent [r*sy, r*sy+th] n [0,H] at 1/4 and 3/4. Vertical neighbours likewise with y = (r+1)*sy + o/2.
- Skip blank (§8.6, D40): a tile is blank when its visible region does not overlap (positive area) any visible
  object's rotated rectangle (the rectangle itself, not its bounding box), repeat copies included.
- Fill sheet (§8.5, D41): cols/rows as SPEC; the grid of rotated bounds is centred in the safe area; the object box
  (unrotated) sits so that copy (0,0)'s rotated bounds start at the grid origin.
- Trim marks (§8.5, D41): grid G = union of copies' rotated bounds; boundaries = every copy's left/right (top/bottom)
  bound edge, deduplicated; per side room = distance from G to the safe-area edge - 1 mm gap - stroke/2 (0.1 mm);
  length = min(5, room); the side's marks are omitted when length < 2; a mark is omitted when its boundary line is
  not inside the safe area (+- stroke/2).
- Crop marks of a placed sheet (§8.6, D42): same rule with G = the sheet rectangle on the page, boundaries = the
  sheet's two edges per axis, safe area = the page's.
- PPI (§8.4): ppi = px * 25.4 / content size (fill = box size); bands >= target sharp, >= 150 fine, >= 72 soft.
- Known length (§8.8, D44): d = |(sx*dx, sy*dy)|, k = L/d, new box w*k x h*k about the old centre.
- Calibration (§8.7): per axis s = M/N, c = 1/s; correction p' = C + c(p - C) per axis about the page centre.
  Calibration sheet bars (D18): largest of 200/150/100/50 with L <= safe side - 24 mm.
- Generators (D45): ruler ticks at k*step (mm: 1 mm, in: 1/16 in), k = 0..floor(L/step); levels by divisibility;
  grid lines at k*s (0 <= k*s <= side), bold when k % N == 0; dots at (i*s, j*s); lined paper y = k*s, k >= 1;
  circle template rows: left to right, gap g, wrap when x > 0 and x + d > w; row height = max(d) + label height.
"""
import json
import math
import random
from fractions import Fraction as F
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
rng = random.Random(20261002)

IN = F(254, 10)
PAPERS = {
    'a0': (841, 1189), 'a1': (594, 841), 'a2': (420, 594), 'a3': (297, 420), 'a4': (210, 297), 'a5': (148, 210),
    'a6': (105, 148), 'b4': (250, 353), 'b5': (176, 250),
    'letter': (F(85, 10) * IN, 11 * IN), 'legal': (F(85, 10) * IN, 14 * IN), 'tabloid': (11 * IN, 17 * IN),
    'photo-4x6': (4 * IN, 6 * IN), 'photo-5x7': (5 * IN, 7 * IN), 'photo-8x10': (8 * IN, 10 * IN),
    'photo-10x15': (100, 150), 'photo-13x18': (130, 180),
}
PAPERS = {k: (F(w), F(h)) for k, (w, h) in PAPERS.items()}
PHOTO = {k for k in PAPERS if k.startswith('photo')}
MATCH = F(1, 100)
STROKE = F(1, 5)       # mark stroke width (D41/D42)
GAP = F(1)             # 1 mm gap between grid and its marks (§8.5)


def f(x):
    return float(x)


def rand_len(lo, hi, places=2):
    scale = 10 ** places
    return F(rng.randint(int(lo * scale), int(hi * scale)), scale)


def ceil_div(a, b):
    return -((-a) // b)


# ---------------------------------------------------------------- tiling (§8.6)
def mode_for(W, H, pw, ph):
    if abs(W - pw) <= MATCH and abs(H - ph) <= MATCH:
        return 'single'
    if W <= pw and H <= ph:
        return 'placed'
    return 'tiled'


def counts(W, H, tw, th, o):
    sx, sy = tw - o, th - o
    cols = 1 if W <= tw else ceil_div(W - o, sx)
    rows = 1 if H <= th else ceil_div(H - o, sy)
    return int(cols), int(rows)


def row_letters(r):
    s, n = '', r + 1
    while n > 0:
        n, rem = divmod(n - 1, 26)
        s = chr(65 + rem) + s
    return s


def layout(W, H, paper, margins, o, orientation):
    pw, ph = PAPERS[paper]
    if orientation == 'landscape':
        pw, ph = ph, pw
    l, t, r, b = margins
    # D53 (P3.5 F1/F7): margins are the PORTRAIT paper's; a landscape layout is turned a quarter turn counter-clockwise
    # onto the portrait page (frame top = paper left), so its l, t, r, b are the paper's b, l, t, r.
    if orientation == 'landscape':
        l, t, r, b = b, l, t, r
    tw, th = pw - l - r, ph - t - b
    mode = mode_for(W, H, pw, ph)
    if mode != 'tiled':
        return {'mode': mode, 'pages': 1, 'pw': pw, 'ph': ph, 'tw': tw, 'th': th}
    cols, rows = counts(W, H, tw, th, o)
    return {'mode': 'tiled', 'pages': cols * rows, 'cols': cols, 'rows': rows, 'pw': pw, 'ph': ph, 'tw': tw, 'th': th}


def choose(W, H, paper, margins, o, orientation):
    if orientation != 'auto':
        return orientation
    p = layout(W, H, paper, margins, o, 'portrait')['pages']
    q = layout(W, H, paper, margins, o, 'landscape')['pages']
    return 'landscape' if q < p else 'portrait'


def tile_details(W, H, lay, o):
    tw, th = lay['tw'], lay['th']
    sx, sy = tw - o, th - o
    tiles = []
    for r in range(lay['rows']):
        for c in range(lay['cols']):
            reg = (c * sx, r * sy, c * sx + tw, r * sy + th)
            vis = (reg[0], reg[1], min(reg[2], W), min(reg[3], H))
            tiles.append({'label': f'{row_letters(r)}{c + 1}', 'row': r, 'col': c, 'region': [f(v) for v in reg],
                          'visible': [f(v) for v in vis]})
    marks = []
    for r in range(lay['rows']):
        for c in range(lay['cols'] - 1):
            x = (c + 1) * sx + o / 2
            y0, y1 = r * sy, min(r * sy + th, H)
            marks += [(x, y0 + (y1 - y0) / 4), (x, y0 + 3 * (y1 - y0) / 4)]
    for r in range(lay['rows'] - 1):
        for c in range(lay['cols']):
            y = (r + 1) * sy + o / 2
            x0, x1 = c * sx, min(c * sx + tw, W)
            marks += [(x0 + (x1 - x0) / 4, y), (x0 + 3 * (x1 - x0) / 4, y)]
    marks.sort()
    return tiles, [[f(x), f(y)] for x, y in marks]


plan_vectors = []
papers_pool = ['a4', 'letter', 'a3', 'legal', 'a5', 'tabloid', 'photo-4x6']
for i in range(400):
    paper = rng.choice(papers_pool)
    pw, ph = PAPERS[paper]
    base = F(3) if paper in PHOTO else F(635, 100)
    m = [rand_len(0, 15) for _ in range(4)] if rng.random() < 0.4 else [base] * 4
    tmin = min(pw, ph) - max(m[0] + m[2], m[1] + m[3])
    if tmin < 20:
        continue
    o = rng.choice([F(0), F(10), rand_len(0, 25)])
    o = min(o, F(math.floor(tmin / 3)))
    kind = rng.random()
    if kind < 0.15:     # exactly the paper, either orientation
        W, H = (pw, ph) if rng.random() < 0.5 else (ph, pw)
        if rng.random() < 0.5:
            W += F(rng.randint(-1, 1), 200)    # within the 0.01 mm match
    elif kind < 0.35:   # smaller than the paper
        W, H = rand_len(10, int(pw)), rand_len(10, int(ph))
    else:
        W, H = rand_len(30, 1500), rand_len(30, 1500)
    orient_in = rng.choice(['auto', 'auto', 'portrait', 'landscape'])
    orient = choose(W, H, paper, m, o, orient_in)
    lay = layout(W, H, paper, m, o, orient)
    if lay['pages'] > 60:
        continue
    v = {'sheet': [f(W), f(H)], 'paper': paper, 'margins': [f(x) for x in m], 'overlap': f(o), 'orientationIn': orient_in,
         'orientation': orient, 'mode': lay['mode'], 'pages': lay['pages']}
    if lay['mode'] == 'placed':
        v['offset'] = [f((lay['pw'] - W) / 2), f((lay['ph'] - H) / 2)]
    if lay['mode'] == 'tiled':
        v['cols'], v['rows'] = lay['cols'], lay['rows']
        v['tiles'], v['registration'] = tile_details(W, H, lay, o)
    plan_vectors.append(v)


# ---------------------------------------------------------------- skip blank (§8.6, D40): rectangle vs rectangle (SAT)
def trig(deg):
    d = deg % 360
    exact = {0: (1, 0), 90: (0, 1), 180: (-1, 0), 270: (0, -1)}
    if d in exact:
        c, s = exact[d]
        return F(c), F(s)
    r = math.radians(d)
    return F(math.cos(r)), F(math.sin(r))


def corners(x, y, w, h, deg):
    c, s = trig(deg)
    cx, cy = x + w / 2, y + h / 2
    out = []
    for u, v in ((-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)):
        out.append((cx + c * u - s * v, cy + s * u + c * v))    # clockwise on a y-down page (D33)
    return out


def overlap_margin(poly, rect):
    """Smallest separation over SAT axes: > 0 overlap depth, <= 0 separated or touching."""
    x0, y0, x1, y1 = rect
    rp = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    axes = [(F(1), F(0)), (F(0), F(1))]
    for i in range(2):
        (ax, ay), (bx, by) = poly[i], poly[i + 1]
        axes.append((by - ay, -(bx - ax)))
    best = None
    for nx, ny in axes:
        n = math.hypot(f(nx), f(ny))
        if n == 0:
            continue
        p1 = [nx * px + ny * py for px, py in poly]
        p2 = [nx * px + ny * py for px, py in rp]
        depth = (min(max(p1), max(p2)) - max(min(p1), min(p2))) / F(n)
        best = depth if best is None else min(best, depth)
    return best


blank_vectors = []
for i in range(250):
    paper = rng.choice(['a4', 'letter'])
    m = [F(635, 100)] * 4
    o = F(10)
    W, H = rand_len(300, 1200), rand_len(300, 1200)
    orient = choose(W, H, paper, m, o, 'auto')
    lay = layout(W, H, paper, m, o, orient)
    if lay['mode'] != 'tiled' or lay['pages'] > 60:
        continue
    tiles, _ = tile_details(W, H, lay, o)
    objs = []
    for k in range(rng.randint(1, 4)):
        w, h = rand_len(5, 200), rand_len(5, 200)
        x, y = rand_len(-50, int(W)), rand_len(-50, int(H))
        deg = rng.choice([0, 0, 90, 180, 270, 30, 45, 135, 300])
        rep = None
        if rng.random() < 0.3:
            rep = {'cols': rng.randint(1, 3), 'rows': rng.randint(1, 3), 'gx': rand_len(0, 20), 'gy': rand_len(0, 20)}
        objs.append({'x': x, 'y': y, 'w': w, 'h': h, 'deg': deg, 'rep': rep})
    nonblank, ambiguous = [], False
    for t in tiles:
        vis = tuple(F(v) for v in t['visible'])
        hit = False
        for ob in objs:
            c, s = trig(ob['deg'])
            bw, bh = abs(ob['w'] * c) + abs(ob['h'] * s), abs(ob['w'] * s) + abs(ob['h'] * c)
            rep = ob['rep'] or {'cols': 1, 'rows': 1, 'gx': 0, 'gy': 0}
            for j in range(rep['rows']):
                for ii in range(rep['cols']):
                    dx, dy = ii * (bw + rep['gx']), j * (bh + rep['gy'])
                    poly = corners(ob['x'] + dx, ob['y'] + dy, ob['w'], ob['h'], ob['deg'])
                    d = overlap_margin(poly, vis)
                    if abs(d) < F(1, 10 ** 6):
                        ambiguous = True
                    if d > 0:
                        hit = True
        if hit:
            nonblank.append(t['label'])
    if ambiguous:
        continue
    blank_vectors.append({'sheet': [f(W), f(H)], 'paper': paper, 'orientation': orient, 'cols': lay['cols'], 'rows': lay['rows'],
                          'objects': [{'x': f(o_['x']), 'y': f(o_['y']), 'w': f(o_['w']), 'h': f(o_['h']), 'deg': o_['deg'],
                                       'repeat': None if o_['rep'] is None else {k: (f(v) if isinstance(v, F) else v) for k, v in o_['rep'].items()}}
                                      for o_ in objs],
                          'nonBlank': nonblank})


# ---------------------------------------------------------------- fill sheet + trim marks (§8.5, D41)
def fill(saw, sah, w, h, gx, gy):
    cols = int((saw + gx) // (w + gx))
    rows = int((sah + gy) // (h + gy))
    return cols, rows


assert fill(F(1973, 10), F(2843, 10), 50, 30, 2, 2) == (3, 8)
assert fill(F(2032, 10), F(2667, 10), 50, 30, 2, 2) == (3, 8)


def side_marks(lo_room, boundaries, inside_lo, inside_hi, edge, direction, span):
    """Marks on one side: length min(5, room); returns (segments, omitted).
    Amended in P2 after the engine's property test found it: a side is also omitted when its marks' span would not lie
    inside the safe area (grid beyond the far edge). This changed 1 of 200 repeat vectors (no. 152: bottom now omitted)."""
    room = lo_room - GAP - STROKE / 2
    length = min(F(5), room)
    if length < 2:
        return [], True
    a0 = edge - direction * GAP
    a1 = a0 - direction * length
    if min(a0, a1) < span[0] + STROKE / 2 or max(a0, a1) > span[1] - STROKE / 2:
        return [], True
    segs = []
    for b in boundaries:
        if b < inside_lo + STROKE / 2 or b > inside_hi - STROKE / 2:
            continue
        a0 = edge - direction * GAP
        a1 = a0 - direction * length
        segs.append((b, min(a0, a1), max(a0, a1)))
    return segs, False


def grid_marks(G, xb, yb, SA):
    gx0, gy0, gx1, gy1 = G
    sx0, sy0, sx1, sy1 = SA
    out, omitted = {}, []
    # top/bottom: vertical segments at x boundaries; left/right: horizontal segments at y boundaries
    for side, room, bounds, lo, hi, edge, d in (
        ('top', gy0 - sy0, xb, sx0, sx1, gy0, 1), ('bottom', sy1 - gy1, xb, sx0, sx1, gy1, -1),
        ('left', gx0 - sx0, yb, sy0, sy1, gx0, 1), ('right', sx1 - gx1, yb, sy0, sy1, gx1, -1)):
        segs, om = side_marks(room, bounds, lo, hi, edge, d, (sy0, sy1) if side in ('top', 'bottom') else (sx0, sx1))
        if om:
            omitted.append(side)
        out[side] = [[f(a), f(b), f(c)] for a, b, c in segs]
    return out, omitted


fill_vectors = []
for i in range(250):
    sa = (rand_len(0, 20), rand_len(0, 20))
    saw, sah = rand_len(40, 400), rand_len(40, 400)
    w, h = rand_len(5, 120), rand_len(5, 120)
    gx, gy = rng.choice([F(0), F(2), rand_len(0, 15)]), rng.choice([F(0), F(3), rand_len(0, 15)])
    deg = rng.choice([0, 0, 90, 180, 270])
    c_, s_ = trig(deg)
    bw, bh = abs(w * c_) + abs(h * s_), abs(w * s_) + abs(h * c_)
    if rng.random() < 0.15:
        k = rng.randint(1, 5)
        saw = k * bw + (k - 1) * gx
    cols, rows = fill(saw, sah, bw, bh, gx, gy)
    v = {'safe': [f(sa[0]), f(sa[1]), f(saw), f(sah)], 'item': [f(w), f(h)], 'deg': deg, 'gap': [f(gx), f(gy)], 'cols': cols, 'rows': rows}
    if cols >= 1 and rows >= 1:
        gw, gh = cols * bw + (cols - 1) * gx, rows * bh + (rows - 1) * gy
        ox, oy = sa[0] + (saw - gw) / 2, sa[1] + (sah - gh) / 2
        v['box'] = [f(ox + (bw - w) / 2), f(oy + (bh - h) / 2)]
        xb = sorted({ox + i_ * (bw + gx) for i_ in range(cols)} | {ox + i_ * (bw + gx) + bw for i_ in range(cols)})
        yb = sorted({oy + j * (bh + gy) for j in range(rows)} | {oy + j * (bh + gy) + bh for j in range(rows)})
        marks, omitted = grid_marks((ox, oy, ox + gw, oy + gh), xb, yb, (sa[0], sa[1], sa[0] + saw, sa[1] + sah))
        v['marks'], v['omitted'] = marks, omitted
    fill_vectors.append(v)

# repeat grids placed by hand (not centred), possibly partly outside the safe area
repeat_vectors = []
for i in range(200):
    SA = (F(635, 100), F(635, 100), F(635, 100) + F(1973, 10), F(635, 100) + F(2843, 10))
    w, h = rand_len(5, 60), rand_len(5, 60)
    deg = rng.choice([0, 90, 180, 270])
    c_, s_ = trig(deg)
    bw, bh = abs(w * c_) + abs(h * s_), abs(w * s_) + abs(h * c_)
    cols, rows = rng.randint(1, 4), rng.randint(1, 5)
    gx, gy = rng.choice([F(0), F(2), rand_len(0, 10)]), rng.choice([F(0), F(2), rand_len(0, 10)])
    x, y = rand_len(-10, 150), rand_len(-10, 220)
    ox, oy = x + (w - bw) / 2, y + (h - bh) / 2
    gw, gh = cols * bw + (cols - 1) * gx, rows * bh + (rows - 1) * gy
    xb = sorted({ox + i_ * (bw + gx) for i_ in range(cols)} | {ox + i_ * (bw + gx) + bw for i_ in range(cols)})
    yb = sorted({oy + j * (bh + gy) for j in range(rows)} | {oy + j * (bh + gy) + bh for j in range(rows)})
    marks, omitted = grid_marks((ox, oy, ox + gw, oy + gh), xb, yb, SA)
    copies = [[f(x + i_ * (bw + gx)), f(y + j * (bh + gy))] for j in range(rows) for i_ in range(cols)]
    repeat_vectors.append({'box': [f(x), f(y), f(w), f(h)], 'deg': deg, 'cols': cols, 'rows': rows, 'gap': [f(gx), f(gy)],
                           'copies': copies, 'marks': marks, 'omitted': omitted})

# crop marks of placed sheets (D42)
crop_vectors = []
for i in range(200):
    paper = rng.choice(['a4', 'letter', 'a5', 'photo-4x6'])
    pw, ph = PAPERS[paper]
    if rng.random() < 0.5:
        pw, ph = ph, pw
    mm = F(3) if paper in PHOTO else F(635, 100)
    W, H = rand_len(10, int(pw)), rand_len(10, int(ph))
    if mode_for(W, H, pw, ph) != 'placed':
        continue
    X0, Y0 = (pw - W) / 2, (ph - H) / 2
    marks, omitted = grid_marks((X0, Y0, X0 + W, Y0 + H), [X0, X0 + W], [Y0, Y0 + H], (mm, mm, pw - mm, ph - mm))
    crop_vectors.append({'paper': [f(pw), f(ph)], 'margin': f(mm), 'sheet': [f(W), f(H)], 'offset': [f(X0), f(Y0)],
                         'marks': marks, 'omitted': omitted})


# ---------------------------------------------------------------- PPI (§8.4, W2)
def band(ppi, target):
    if ppi >= target:
        return 'sharp'
    if ppi >= 150:
        return 'fine'
    if ppi >= 72:
        return 'soft'
    return 'blocky'


def ppi_of(pxw, pxh, crop, w, h, fit):
    l, t, r, b = crop
    vw, vh = pxw * (1 - l - r), pxh * (1 - t - b)
    sx, sy = w / vw, h / vh                  # mm per px
    if fit == 'fit':
        sx = sy = min(sx, sy)
    px, py = IN / sx, IN / sy
    return px, py, min(px, py)


w2 = []
for pxw, pxh, w, h in ((4032, 3024, 40, 30), (4032, 3024, 300, 225), (800, 600, 100, 75)):
    px, py, e = ppi_of(F(pxw), F(pxh), (0, 0, 0, 0), F(w), F(h), 'fill')
    w2.append({'px': [pxw, pxh], 'box': [w, h], 'ppi': f(e), 'band': band(e, 300)})
assert round(w2[0]['ppi'], 1) == 2560.3 and w2[0]['band'] == 'sharp'
assert round(w2[1]['ppi'], 1) == 341.4 and round(w2[2]['ppi'], 1) == 203.2 and w2[2]['band'] == 'fine'
ppi_vectors = []
for i in range(300):
    pxw, pxh = rng.randint(50, 8000), rng.randint(50, 8000)
    crop = (F(rng.randint(0, 30), 100), F(rng.randint(0, 30), 100), F(rng.randint(0, 30), 100), F(rng.randint(0, 30), 100))
    w, h = rand_len(5, 600), rand_len(5, 600)
    fit = rng.choice(['fill', 'fit'])
    target = rng.choice([150, 300, 600])
    px, py, e = ppi_of(F(pxw), F(pxh), crop, w, h, fit)
    ppi_vectors.append({'px': [pxw, pxh], 'crop': [f(c) for c in crop], 'box': [f(w), f(h)], 'fit': fit, 'target': target,
                        'ppiX': f(px), 'ppiY': f(py), 'ppi': f(e), 'band': band(e, target)})


# ---------------------------------------------------------------- known length (§8.8, W10)
def known(box, natural, crop, fit, p1, p2, L):
    x, y, w, h = box
    nw, nh = natural
    l, t, r, b = crop
    sx, sy = w / (nw * (1 - l - r)), h / (nh * (1 - t - b))
    if fit == 'fit':
        sx = sy = min(sx, sy)
    dx, dy = (p2[0] - p1[0]) * sx, (p2[1] - p1[1]) * sy
    if dy == 0:
        k = L / abs(dx)
    elif dx == 0:
        k = L / abs(dy)
    else:
        k = L / F(math.sqrt(f(dx * dx + dy * dy)))
    cx, cy = x + w / 2, y + h / 2
    return k, (cx - w * k / 2, cy - h * k / 2, w * k, h * k)


k, nb = known((F(0), F(0), F(200), F(150)), (F(4000), F(3000)), (0, 0, 0, 0), 'fill', (F(100), F(500)), (F(912), F(500)), F(50))
w10 = {'factor': f(k), 'width': f(nb[2])}
assert round(w10['factor'], 6) == 1.231527 and round(w10['width'], 4) == 246.3054
known_vectors = []
for i in range(200):
    nw, nh = F(rng.randint(100, 6000)), F(rng.randint(100, 6000))
    w = rand_len(10, 400)
    h = w * nh / nw
    x, y = rand_len(-20, 200), rand_len(-20, 200)
    p1 = (F(rng.randint(0, int(nw))), F(rng.randint(0, int(nh))))
    p2 = (F(rng.randint(0, int(nw))), p1[1]) if rng.random() < 0.3 else (F(rng.randint(0, int(nw))), F(rng.randint(0, int(nh))))
    if p1 == p2:
        continue
    L = rand_len(5, 500)
    k, nb = known((x, y, w, h), (nw, nh), (0, 0, 0, 0), 'fill', p1, p2, L)
    known_vectors.append({'box': [f(x), f(y), f(w), f(h)], 'natural': [f(nw), f(nh)], 'p1': [f(v) for v in p1], 'p2': [f(v) for v in p2],
                          'length': f(L), 'factor': f(k), 'newBox': [f(v) for v in nb]})


# ---------------------------------------------------------------- calibration: two axes + sheet bars (§8.7, D18)
corr_vectors = []
for i in range(200):
    paper = rng.choice(list(PAPERS))
    pw, ph = PAPERS[paper]
    if rng.random() < 0.5:
        pw, ph = ph, pw
    fx, fy = 1 / (1 + F(rng.randint(-150, 150), 1000)), 1 / (1 + F(rng.randint(-150, 150), 1000))
    p = (rand_len(0, int(pw)), rand_len(0, int(ph)))
    C = (pw / 2, ph / 2)
    q = (C[0] + fx * (p[0] - C[0]), C[1] + fy * (p[1] - C[1]))
    corr_vectors.append({'page': [f(pw), f(ph)], 'f': [f(fx), f(fy)], 'point': [f(v) for v in p], 'corrected': [f(v) for v in q]})

cal_sheets = {}
for key, (pw, ph) in PAPERS.items():
    mm = F(3) if key in PHOTO else F(635, 100)
    saw, sah = pw - 2 * mm, ph - 2 * mm
    pick = lambda side: next((L for L in (200, 150, 100, 50) if L <= side - 24), None)
    cal_sheets[key] = {'x': pick(saw), 'y': pick(sah)}
assert cal_sheets['a4'] == {'x': 150, 'y': 200} and cal_sheets['letter'] == {'x': 150, 'y': 200}


# ---------------------------------------------------------------- generators (D45)
def ticks(length, step):
    n = int(length // step)
    return [k * step for k in range(n + 1)]


def ruler_vec(unit, L):
    if unit == 'in':
        step = IN / 16
        levels = lambda k: 'major' if k % 16 == 0 else 'half' if k % 8 == 0 else 'quarter' if k % 4 == 0 else 'eighth' if k % 2 == 0 else 'minor'
    else:
        step = F(1)
        levels = lambda k: 'major' if k % 10 == 0 else 'half' if k % 5 == 0 else 'minor'
    pos = ticks(L, step)
    lv = [levels(k) for k in range(len(pos))]
    labels = [k // (16 if unit == 'in' else 10) for k in range(len(pos)) if lv[k] == 'major']
    if unit == 'mm':
        labels = [v * 10 for v in labels]
    return {'unit': unit, 'length': f(L), 'count': len(pos), 'last': f(pos[-1]), 'sum': f(sum(pos)),
            'levelCounts': {k: lv.count(k) for k in sorted(set(lv))}, 'labels': labels[:40]}


ruler_vectors = [ruler_vec(u, F(L)) for u, L in (('mm', 1000), ('cm', 300), ('in', 6 * IN), ('in', 1000), ('mm', F(1499, 10)))]
for i in range(120):
    ruler_vectors.append(ruler_vec(rng.choice(['mm', 'cm', 'in']), rand_len(10, 3000)))
assert ruler_vectors[0]['count'] == 1001 and ruler_vectors[0]['levelCounts']['major'] == 101
assert ruler_vectors[2]['count'] == 97 and ruler_vectors[2]['labels'] == [0, 1, 2, 3, 4, 5, 6]

grid_vectors = []
for i in range(150):
    w, h = rand_len(10, 400), rand_len(10, 400)
    s = rng.choice([F(1), F(2), F(5), F(10), IN / 4, IN / 8, rand_len(1, 20)])
    if rng.random() < 0.15:
        w = s * rng.randint(2, 40)
    N = rng.choice([0, 2, 5, 10])
    xs, ys = ticks(w, s), ticks(h, s)
    bold = lambda k: N > 1 and k % N == 0
    dots_n = len(xs) * len(ys)
    lines = [k * s for k in range(1, int(h // s) + 1)]
    grid_vectors.append({'size': [f(w), f(h)], 'spacing': f(s), 'boldEvery': N, 'vertical': len(xs), 'horizontal': len(ys),
                         'boldVertical': sum(1 for k in range(len(xs)) if bold(k)), 'boldHorizontal': sum(1 for k in range(len(ys)) if bold(k)),
                         'lastX': f(xs[-1]), 'lastY': f(ys[-1]), 'dots': dots_n, 'lined': len(lines),
                         'linedLast': f(lines[-1]) if lines else None})

circle_vectors = []
for i in range(120):
    w = rand_len(30, 300)
    ds = [rng.choice([F(3), F(5), F(6), F(8), F(10), F(12), F(20), F(25), F(35), F(50), rand_len(2, 120)]) for _ in range(rng.randint(1, 12))]
    ds = [d for d in ds if d <= w]
    if not ds:
        continue
    g = rng.choice([F(5), F(3), rand_len(2, 10)])
    lab = rng.choice([F(0), F(5)])
    x, y, row_h, centres = F(0), F(0), F(0), []
    for d in ds:
        if x > 0 and x + d > w:
            y += row_h + g
            x, row_h = F(0), F(0)
        centres.append((x + d / 2, y + d / 2))
        x += d + g
        row_h = max(row_h, d + lab)
    circle_vectors.append({'width': f(w), 'diameters': [f(d) for d in ds], 'gap': f(g), 'labelHeight': f(lab),
                           'centres': [[f(a), f(b)] for a, b in centres], 'height': f(y + row_h)})

out = {
    'generator': 'scripts/oracle/p2_oracle.py — written in P2 before the plan engine; same agent as the engine (L27 caveat)',
    'plans': plan_vectors, 'blank': blank_vectors, 'fill': fill_vectors, 'repeat': repeat_vectors, 'crop': crop_vectors,
    'w2': w2, 'ppi': ppi_vectors, 'w10': w10, 'known': known_vectors, 'correction': corr_vectors,
    'calibrationSheets': cal_sheets, 'rulers': ruler_vectors, 'grids': grid_vectors, 'circles': circle_vectors,
    'constants': {'stroke': f(STROKE), 'gap': f(GAP)},
}
(ROOT / 'test/fixtures/engine/oracle-p2.json').write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')))
print('oracle-p2: ' + ' '.join(f'{k} {len(v)}' for k, v in out.items() if isinstance(v, (list, dict)) and k != 'constants'))
