#!/usr/bin/env python3
"""P3.5 independent review oracle (written from docs/SPEC.md §6-§8, W1-W10 and the D-rules only; never reads src/).
Exact arithmetic with fractions.Fraction. Writes cases.json (inputs + expected); compare.py checks the engine output."""
import json, random, math
from fractions import Fraction as F

R = random.Random(35)
out = {}

def dec(x, nd=6):  # random decimal as exact Fraction and its float literal
    return F(str(round(x, nd)))

# ---------------------------------------------------------------- (a) units
MM_IN = F(254, 10)
def mm2pt(mm): return mm * 72 / MM_IN
def pt2mm(pt): return pt * MM_IN / 72

units = []
for i in range(3000):
    nd = R.choice([0, 1, 2, 3, 4, 6])
    v = round(R.uniform(0, 3000), nd)
    s = repr(float(F(str(v))))
    units.append({'mm': float(F(str(v))), 'pt': float(mm2pt(F(str(v))))})
out['mmToPt'] = units
# W1
w1 = {'a4pt': [float(mm2pt(F(210))), float(mm2pt(F(297)))], 'letterpt': [612.0, 792.0], 'pt100': float(mm2pt(F(100))),
      'parse': [["3 1/16 in", 'en', 'mm', float(F(3) * MM_IN + MM_IN / 16)], ["7,5 cm", 'de', 'mm', 75.0], ["12 pt", 'en', 'mm', float(pt2mm(F(12)))],
                ["78", 'en', 'mm', 78.0], ["78 mm", 'en', 'mm', 78.0], ["7,8 cm", 'de', 'mm', 78.0], ["3.0625 in", 'en', 'mm', float(F('3.0625') * MM_IN)],
                ['3 1/16"', 'en', 'mm', float(F(3) * MM_IN + MM_IN / 16)], ["3-1/16 in", 'en', 'mm', float(F(3) * MM_IN + MM_IN / 16)],
                ['1/2"', 'en', 'mm', 12.7], ["2", 'en', 'in', 50.8], ["2", 'en', 'cm', 20.0], ["10000", 'en', 'mm', 10000.0],
                ["0,5", 'de', 'in', 12.7], ["1000 cm", 'en', 'mm', 10000.0]],
      'parseErr': [["-5", 'en', 'mm'], ["", 'en', 'mm'], ["NaN", 'en', 'mm'], ["10000.01", 'en', 'mm'], ["10001 mm", 'en', 'mm'],
                   ["394 in", 'en', 'mm'], ["abc", 'en', 'mm'], ["1e3", 'en', 'mm'], ["   ", 'en', 'mm'], ["Infinity", 'en', 'mm'],
                   ["5 parsecs", 'en', 'mm'], ["1/0 in", 'en', 'mm'], ["--5", 'en', 'mm']]}
out['w1'] = w1

# ---------------------------------------------------------------- papers (ISO 216 / ANSI / photo)
PAPERS = {'a0': (841, 1189), 'a1': (594, 841), 'a2': (420, 594), 'a3': (297, 420), 'a4': (210, 297), 'a5': (148, 210),
          'a6': (105, 148), 'b4': (250, 353), 'b5': (176, 250),
          'letter': (F('8.5') * MM_IN, 11 * MM_IN), 'legal': (F('8.5') * MM_IN, 14 * MM_IN), 'tabloid': (11 * MM_IN, 17 * MM_IN),
          'photo-4x6': (4 * MM_IN, 6 * MM_IN), 'photo-5x7': (5 * MM_IN, 7 * MM_IN), 'photo-8x10': (8 * MM_IN, 10 * MM_IN),
          'photo-10x15': (100, 150), 'photo-13x18': (130, 180)}
PAPERS = {k: (F(w), F(h)) for k, (w, h) in PAPERS.items()}
def margin_default(k): return F(3) if k.startswith('photo') else F('6.35')
out['papers'] = {k: {'w': float(w), 'h': float(h), 'wpt': float(mm2pt(w)), 'hpt': float(mm2pt(h)), 'margin': float(margin_default(k)),
                     'safe': [float(margin_default(k)), float(margin_default(k)), float(w - 2 * margin_default(k)), float(h - 2 * margin_default(k))]}
                 for k, (w, h) in PAPERS.items()}

# ---------------------------------------------------------------- (b) tiling, SPEC §8.6 + D27/D40
def ceil_div(a, b):  # ceil for Fractions
    return -((-a) // b)

def layout(W, H, key, orient, m, o):
    pw, ph = PAPERS[key]
    if orient == 'landscape': pw, ph = ph, pw
    l, t, r, b = m
    # D53 (P3.5 F1/F7): margins are the PORTRAIT paper's; a landscape layout is turned a quarter turn counter-clockwise
    # onto the portrait page (frame top = paper left), so its l, t, r, b are the paper's b, l, t, r.
    if orient == 'landscape': l, t, r, b = b, l, t, r
    # mode
    if (abs(W - pw) <= F('0.01') and abs(H - ph) <= F('0.01')):
        mode = 'single'
    elif W <= pw and H <= ph:
        mode = 'placed'
    else:
        mode = 'tiled'
    tw, th = pw - l - r, ph - t - b
    if mode != 'tiled':
        return dict(mode=mode, cols=1, rows=1, pages=1, tw=tw, th=th, sx=tw - o, sy=th - o, pw=pw, ph=ph)
    sx, sy = tw - o, th - o
    cols = 1 if W <= tw else int(ceil_div(W - o, sx))
    rows = 1 if H <= th else int(ceil_div(H - o, sy))
    return dict(mode=mode, cols=cols, rows=rows, pages=cols * rows, tw=tw, th=th, sx=sx, sy=sy, pw=pw, ph=ph)

def letters(n):
    s = ''
    n += 1
    while n > 0:
        n, rem = divmod(n - 1, 26)
        s = chr(65 + rem) + s
    return s

def choose(W, H, key, choice, m, o):
    if choice != 'auto':
        return choice, layout(W, H, key, choice, m, o)
    p = layout(W, H, key, 'portrait', m, o)
    q = layout(W, H, key, 'landscape', m, o)
    return ('landscape', q) if q['pages'] < p['pages'] else ('portrait', p)

def tiles_expected(W, H, L, o):
    res = []
    for r in range(L['rows']):
        for c in range(L['cols']):
            x0, y0 = c * L['sx'], r * L['sy']
            reg = [x0, y0, L['tw'], L['th']]
            vis = [x0, y0, min(x0 + L['tw'], W) - x0, min(y0 + L['th'], H) - y0]
            res.append({'label': letters(r) + str(c + 1), 'region': [float(v) for v in reg], 'visible': [float(v) for v in vis]})
    return res

def reg_marks(W, H, L, o):
    """Per neighbouring tile pair: vertical strip between col c and c+1 in row r spans y in [r*sy, r*sy+th] ∩ [0,H];
    marks at 1/4 and 3/4 of that extent, x at the strip centre. Same for horizontal strips. Deduplicated."""
    pts = set()
    sx, sy, tw, th = L['sx'], L['sy'], L['tw'], L['th']
    for r in range(L['rows']):
        y0, y1 = r * sy, min(r * sy + th, H)
        for c in range(L['cols'] - 1):
            x = (c + 1) * sx + o / 2
            for f in (F(1, 4), F(3, 4)):
                pts.add((x, y0 + f * (y1 - y0)))
    for c in range(L['cols']):
        x0, x1 = c * sx, min(c * sx + tw, W)
        for r in range(L['rows'] - 1):
            y = (r + 1) * sy + o / 2
            for f in (F(1, 4), F(3, 4)):
                pts.add((x0 + f * (x1 - x0), y))
    return sorted(pts)

tiling = []
keys = list(PAPERS)
for i in range(2500):
    key = R.choice(keys if i % 3 else ['a4', 'letter'])
    pw, ph = PAPERS[key]
    if i % 4 == 0: m = (dec(R.uniform(0, 15), 2),) * 4
    else: m = tuple(dec(R.uniform(0, 15), 2) for _ in range(4))
    tw = min(pw, ph) - max(m[0] + m[2], m[1] + m[3])
    lim = min(pw - m[0] - m[2], ph - m[1] - m[3], ph - m[0] - m[2], pw - m[1] - m[3]) / 3
    o = dec(R.uniform(0, float(lim) * 0.999), 1) if i % 7 else F(0)
    kind = R.random()
    if kind < 0.15: W, H = pw, ph
    elif kind < 0.3: W, H = dec(R.uniform(10, float(pw)), 1), dec(R.uniform(10, float(ph)), 1)
    elif kind < 0.4:  # exact step boundaries
        L0 = layout(F(5000), F(5000), key, 'portrait', m, o)
        n = R.randint(1, 6)
        W = L0['tw'] + (n - 1) * L0['sx'] + R.choice([F(0), F(1, 100), F(-1, 100)])
        H = dec(R.uniform(50, 1200), 1)
    else: W, H = dec(R.uniform(20, 2000), 1), dec(R.uniform(20, 2000), 1)
    if W <= 0 or H <= 0: continue
    choice = R.choice(['auto', 'auto', 'portrait', 'landscape'])
    orient, L = choose(W, H, key, choice, m, o)
    case = {'W': float(W), 'H': float(H), 'key': key, 'choice': choice, 'm': [float(v) for v in m], 'o': float(o),
            'orientation': orient, 'mode': L['mode'], 'cols': L['cols'], 'rows': L['rows'], 'pages': L['pages']}
    if L['mode'] == 'tiled' and L['pages'] <= 400:
        case['tiles'] = tiles_expected(W, H, L, o)
        case['reg'] = [[float(x), float(y)] for x, y in reg_marks(W, H, L, o)]
    tiling.append(case)
out['tiling'] = tiling
# named
named = []
def nm(W, H, key, m=F('6.35'), o=F(10)):
    mm = (m,) * 4
    p = layout(F(W), F(H), key, 'portrait', mm, o); q = layout(F(W), F(H), key, 'landscape', mm, o)
    return {'W': W, 'H': H, 'key': key, 'portrait': [p['cols'], p['rows']], 'landscape': [q['cols'], q['rows']]}
for args in [(600, 900, 'a4'), (600, 900, 'letter'), (1000, 30, 'a4'), (420, 594, 'a4'), (841, 1189, 'a4')]:
    named.append(nm(*args))
out['named'] = named
assert named[0]['portrait'] == [4, 4] and named[0]['landscape'] == [3, 5]
assert named[1]['portrait'] == [4, 4] and named[1]['landscape'] == [3, 5], named[1]
assert named[2]['portrait'] == [6, 1] and named[2]['landscape'] == [4, 1]
assert named[3]['portrait'] == [3, 3] and named[3]['landscape'] == [2, 4]
assert named[4]['portrait'] == [5, 5] and named[4]['landscape'][0] * named[4]['landscape'][1] == 28
out['letters'] = [letters(i) for i in range(0, 800)]

# ---------------------------------------------------------------- (c) calibration §8.7 + W7
RATIOS = [F('0.9407'), F('0.9727'), F('1.0281'), F('1.0630')]
def verdict(N, M):
    s = F(M) / F(N)
    d = abs(s - 1)
    if d <= F('0.002'): v = 'exact'
    elif d <= F('0.02'): v = 'slight'
    elif d <= F('0.15'): v = 'explain'
    else: v = 'refused'
    causes = []
    if v == 'explain':
        if F('0.93') <= s <= F('0.985'): causes.append('fitToPage')
        if any(abs(s - r) <= F('0.003') for r in RATIOS): causes.append('paperMismatch')
    return s, 1 / s, v, causes
cal = []
for i in range(1500):
    N = R.choice([100, 150, 200, 50])
    M = dec(N * R.uniform(0.82, 1.18), R.choice([1, 2]))
    if i < 60:  # boundaries
        N = 100; M = F(R.choice(['99.8', '100.2', '98', '102', '85', '115', '84.99', '115.01', '93', '98.5', '94.07', '97.27', '102.81', '106.3', '96.97', '97.57', '94.37', '93.77']))
    s, c, v, causes = verdict(N, M)
    cal.append({'N': N, 'M': float(M), 's': float(s), 'c': float(c), 'verdict': v, 'causes': causes})
out['calibration'] = cal
s, c, v, causes = verdict(100, F('96.5'))
assert v == 'explain' and 'fitToPage' in causes and abs(c - F('1.03627')) < F('0.000005')
px = 105 + c * (20 - 105)
assert abs(px - F('16.9171')) < F('0.00005')
out['w7'] = {'c': float(c), 'x20': float(px), 'bar': float(100 * c)}
# correction mapping p' = C + c(p - C)
corr = []
for i in range(500):
    key = R.choice(keys); pw, ph = PAPERS[key]
    fx = 1 / F(str(round(R.uniform(0.86, 1.14), 4))); fy = 1 / F(str(round(R.uniform(0.86, 1.14), 4)))
    p = (dec(R.uniform(0, float(pw)), 3), dec(R.uniform(0, float(ph)), 3))
    q = (pw / 2 + fx * (p[0] - pw / 2), ph / 2 + fy * (p[1] - ph / 2))
    corr.append({'key': key, 'fx': float(fx), 'fy': float(fy), 'p': [float(p[0]), float(p[1])], 'q': [float(q[0]), float(q[1])]})
out['correction'] = corr

# ---------------------------------------------------------------- (d) fill sheet + trim marks (§8.5 + D41)
def rot_size(w, h, deg):
    if deg % 90 == 0:
        k = (deg // 90) % 2
        return (h, w) if k else (w, h)
    th = math.radians(deg)
    return (abs(float(w) * math.cos(th)) + abs(float(h) * math.sin(th)), abs(float(w) * math.sin(th)) + abs(float(h) * math.cos(th)))
fills = []
for i in range(1200):
    key = R.choice(keys); pw, ph = PAPERS[key]
    mg = margin_default(key)
    safe = (mg, mg, pw - 2 * mg, ph - 2 * mg)
    w, h = dec(R.uniform(3, 150), 2), dec(R.uniform(3, 150), 2)
    deg = R.choice([0, 0, 90, 180, 270, 30, 45])
    gx, gy = dec(R.uniform(0, 8), 1), dec(R.uniform(0, 8), 1)
    if i < 4:
        key = ['a4', 'letter', 'a4', 'letter'][i]; pw, ph = PAPERS[key]; mg = F('6.35'); safe = (mg, mg, pw - 2 * mg, ph - 2 * mg)
        w, h, deg, gx, gy = F(50), F(30), 0, F(2), F(2)
    bw, bh = rot_size(w, h, deg)
    exactish = deg % 90 == 0
    if exactish:
        cols = int((safe[2] + gx) // (bw + gx)); rows = int((safe[3] + gy) // (bh + gy))
    else:
        cols = math.floor((float(safe[2] + gx)) / (bw + float(gx)) + 1e-9); rows = math.floor(float(safe[3] + gy) / (bh + float(gy)) + 1e-9)
    case = {'key': key, 'safe': [float(v) for v in safe], 'w': float(w), 'h': float(h), 'deg': deg, 'gx': float(gx), 'gy': float(gy), 'cols': cols, 'rows': rows}
    if cols >= 1 and rows >= 1:
        if exactish:
            gw = cols * bw + (cols - 1) * gx; gh = rows * bh + (rows - 1) * gy
            ox = safe[0] + (safe[2] - gw) / 2; oy = safe[1] + (safe[3] - gh) / 2
            case['grid'] = [float(ox), float(oy), float(gw), float(gh)]
            case['x'] = float(ox + (bw - w) / 2); case['y'] = float(oy + (bh - h) / 2)
        else:
            gw = cols * bw + (cols - 1) * float(gx); gh = rows * bh + (rows - 1) * float(gy)
            ox = float(safe[0]) + (float(safe[2]) - gw) / 2; oy = float(safe[1]) + (float(safe[3]) - gh) / 2
            case['grid'] = [ox, oy, gw, gh]; case['x'] = ox + (bw - float(w)) / 2; case['y'] = oy + (bh - float(h)) / 2
            case['approx'] = True
    fills.append(case)
assert fills[0]['cols'] * fills[0]['rows'] == 24 and fills[1]['cols'] * fills[1]['rows'] == 24
out['fill'] = fills

# trim marks for a grid (exact cases only), D41: 1 mm gap, length min(5, room - 1 - stroke/2), side omitted if < 2
STROKE = F(1, 5)
trims = []
for i in range(600):
    key = R.choice(keys); pw, ph = PAPERS[key]; mg = margin_default(key)
    safe = (mg, mg, pw - 2 * mg, ph - 2 * mg)
    w, h = dec(R.uniform(5, 80), 1), dec(R.uniform(5, 80), 1)
    cols, rows = R.randint(1, 4), R.randint(1, 4)
    gx, gy = dec(R.uniform(0, 6), 1), dec(R.uniform(0, 6), 1)
    gw = cols * w + (cols - 1) * gx; gh = rows * h + (rows - 1) * gy
    if gw > safe[2] or gh > safe[3]: continue
    x = safe[0] + dec(R.uniform(0, float(safe[2] - gw)), 1); y = safe[1] + dec(R.uniform(0, float(safe[3] - gh)), 1)
    xs = sorted(set([x + i * (w + gx) for i in range(cols)] + [x + i * (w + gx) + w for i in range(cols)]))
    ys = sorted(set([y + j * (h + gy) for j in range(rows)] + [y + j * (h + gy) + h for j in range(rows)]))
    gx0, gy0, gx1, gy1 = x, y, x + gw, y + gh
    rooms = {'top': gy0 - safe[1], 'bottom': safe[1] + safe[3] - gy1, 'left': gx0 - safe[0], 'right': safe[0] + safe[2] - gx1}
    lens = {k: min(F(5), v - 1 - STROKE / 2) for k, v in rooms.items()}
    sides = {}
    for k, L_ in lens.items():
        if L_ < 2: sides[k] = None; continue
        if k == 'top': sides[k] = [[float(xx), float(gy0 - 1 - L_), float(xx), float(gy0 - 1)] for xx in xs]
        if k == 'bottom': sides[k] = [[float(xx), float(gy1 + 1), float(xx), float(gy1 + 1 + L_)] for xx in xs]
        if k == 'left': sides[k] = [[float(gx0 - 1 - L_), float(yy), float(gx0 - 1), float(yy)] for yy in ys]
        if k == 'right': sides[k] = [[float(gx1 + 1), float(yy), float(gx1 + 1 + L_), float(yy)] for yy in ys]
    trims.append({'safe': [float(v) for v in safe], 'x': float(x), 'y': float(y), 'w': float(w), 'h': float(h), 'cols': cols, 'rows': rows,
                  'gx': float(gx), 'gy': float(gy), 'sides': sides, 'rooms': {k: float(v) for k, v in rooms.items()}})
out['trim'] = trims

# ---------------------------------------------------------------- PPI (§8.4, W2) and known length (§8.8, W10)
ppi = []
for i in range(600):
    pxw, pxh = R.randint(50, 8000), R.randint(50, 8000)
    w = dec(R.uniform(5, 600), 2); h = w * pxh / pxw if i % 2 else dec(R.uniform(5, 600), 2)
    crop = [R.choice([0, 0, 0.1, 0.25]), R.choice([0, 0.05]), R.choice([0, 0.2]), R.choice([0, 0.1])]
    cl, ct, cr, cb = [F(str(v)) for v in crop]
    px_ = pxw * (1 - cl - cr) / (w / MM_IN); py_ = pxh * (1 - ct - cb) / (h / MM_IN)
    e = min(px_, py_)
    band = 'sharp' if e >= 300 else 'fine' if e >= 150 else 'soft' if e >= 72 else 'blocky'
    ppi.append({'px': [pxw, pxh], 'box': [float(w), float(h)], 'crop': crop, 'ppi': float(e), 'band': band})
out['ppi'] = ppi
out['w2'] = [float(F(4032) / (F(40) / MM_IN)), float(F(4032) / (F(300) / MM_IN)), float(F(800) / (F(100) / MM_IN))]
assert round(out['w2'][0], 1) == 2560.3 and round(out['w2'][1], 1) == 341.4 and round(out['w2'][2], 1) == 203.2
k = F(50) / (F(812) * F(200) / 4000)
out['w10'] = {'k': float(k), 'w': float(200 * k)}
assert abs(k - F('1.231527')) < F('0.0000005') and abs(200 * k - F('246.3054')) < F('0.00005')

# ---------------------------------------------------------------- SVG size (§8.9 + D47)
UNIT_MM = {'mm': F(1), 'cm': F(10), 'in': MM_IN, 'pt': MM_IN / 72, 'pc': MM_IN / 6, 'q': F(1, 4)}
svg = []
for i in range(2000):
    ppi_ = R.choice([96, 72, 90, 150, 300])
    vb = None if R.random() < 0.2 else [dec(R.uniform(-50, 50), 2), dec(R.uniform(-50, 50), 2), dec(R.uniform(1, 2000), 2), dec(R.uniform(1, 2000), 2)]
    def mk():
        k = R.choice(['mm', 'cm', 'in', 'pt', 'pc', 'px', '', '%', None, 'Q', 'MM'])
        if k is None: return None, ('rel',)
        v = dec(R.uniform(0.5, 1500), R.choice([0, 1, 3]))
        vs = format(float(v), 'g') if v == int(v) else repr(float(v))
        if k == '%': return f'{vs}%', ('rel',)
        if k in ('', 'px'): return f'{vs}{k}', ('px', v)
        return f'{vs}{k}', ('abs', v * UNIT_MM[k.lower()])
    (ws, wl), (hs, hl) = mk(), mk()
    sep = R.choice([' ', ',', ', '])
    vbs = None if vb is None else sep.join(str(float(v)) if v != int(v) else str(int(v)) for v in vb)
    pxmm = MM_IN / ppi_
    exp = None
    def side(l, vbv):
        if l[0] == 'abs': return l[1], False
        if l[0] == 'px': return l[1] * pxmm, True
        return None, None
    a, an = side(wl, None); b, bn = side(hl, None)
    if a is not None and b is not None: exp = (a, b, an or bn)
    elif vb is None: exp = 'noSize'
    elif a is None and b is None: exp = (vb[2] * pxmm, vb[3] * pxmm, True)
    elif a is None: exp = (b * vb[2] / vb[3], b, bn)
    else: exp = (a, a * vb[3] / vb[2], an)
    c = {'w': ws, 'h': hs, 'vb': vbs, 'ppi': ppi_}
    if exp == 'noSize': c['err'] = 'noSize'
    else: c.update(wMm=float(exp[0]), hMm=float(exp[1]), needsPpi=bool(exp[2]))
    svg.append(c)
out['svg'] = svg
out['w8'] = [[None, '400', '300', None, 96, 105.8333333333, 79.375], ]

# ---------------------------------------------------------------- PDF boxes (§8.10)
pdf = []
for i in range(1500):
    x0, y0 = dec(R.uniform(-200, 200), 2), dec(R.uniform(-200, 200), 2)
    mw, mh = dec(R.uniform(10, 3000), 2), dec(R.uniform(10, 3000), 2)
    media = [x0, y0, x0 + mw, y0 + mh]
    if R.random() < 0.3: media = [media[2], media[3], media[0], media[1]]
    crop = None
    if R.random() < 0.6:
        cx0 = x0 + dec(R.uniform(-50, float(mw)), 2); cy0 = y0 + dec(R.uniform(-50, float(mh)), 2)
        crop = [cx0, cy0, cx0 + dec(R.uniform(1, float(mw)), 2), cy0 + dec(R.uniform(1, float(mh)), 2)]
    uu = R.choice([None, None, F(1), F(2), F('0.5'), F(75)])
    rot = R.choice([None, 0, 90, 180, 270, -90, 450, 360])
    mx0, mx1 = sorted([media[0], media[2]]); my0, my1 = sorted([media[1], media[3]])
    bx0, by0, bx1, by1 = mx0, my0, mx1, my1
    if crop is not None:
        cx0_, cx1_ = sorted([crop[0], crop[2]]); cy0_, cy1_ = sorted([crop[1], crop[3]])
        ix0, iy0, ix1, iy1 = max(mx0, cx0_), max(my0, cy0_), min(mx1, cx1_), min(my1, cy1_)
        if ix1 > ix0 and iy1 > iy0: bx0, by0, bx1, by1 = ix0, iy0, ix1, iy1
    u = uu if uu is not None else F(1)
    wmm = (bx1 - bx0) * u * MM_IN / 72; hmm = (by1 - by0) * u * MM_IN / 72
    r = (rot or 0) % 360
    if r in (90, 270): wmm, hmm = hmm, wmm
    pdf.append({'media': [float(v) for v in media], 'crop': None if crop is None else [float(v) for v in crop],
                'uu': None if uu is None else float(uu), 'rot': rot, 'wMm': float(wmm), 'hMm': float(hmm), 'rotate': r})
out['pdf'] = pdf

json.dump(out, open('cases.json', 'w'))
print({k: (len(v) if isinstance(v, (list, dict)) else 1) for k, v in out.items()})
