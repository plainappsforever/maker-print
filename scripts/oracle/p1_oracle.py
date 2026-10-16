#!/usr/bin/env python3
"""Independent exact oracle for Maker Print engine maths (L20/L27).

Written from docs/SPEC.md §8 (and the P1 decisions D31-D35 in docs/DECISIONS.md) with Python `fractions`, BEFORE the
TypeScript engine existed. It never imports or reads src/. Writes JSON vectors that Jest compares against the engine:

  test/fixtures/engine/oracle-p1.json          units, parse, format, paper, rotation, object mapping (P1 engine)
  test/fixtures/engine/oracle-p2-pending.json  tiling counts, fill-sheet counts, calibration (consumed by P2)

CAVEAT (L27 rule 4): written by the same agent that wrote the P1 engine. P3.5's reviewer writes its own oracle.
Run: python3 scripts/oracle/p1_oracle.py
"""
import json
import math
import random
from fractions import Fraction as F
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
rng = random.Random(20261001)

IN = F(254, 10)            # 25.4 mm, exact by definition
PT = IN / 72               # 1 pt = 25.4/72 mm
UNIT_MM = {'mm': F(1), 'cm': F(10), 'm': F(1000), 'in': IN, 'pt': PT}

# ---------------------------------------------------------------- paper catalogue (RESEARCH §4.5, ISO 216 / ANSI)
PAPERS = {
    'a0': (841, 1189), 'a1': (594, 841), 'a2': (420, 594), 'a3': (297, 420), 'a4': (210, 297), 'a5': (148, 210),
    'a6': (105, 148), 'b4': (250, 353), 'b5': (176, 250),
    'letter': (F(85, 10) * IN, 11 * IN), 'legal': (F(85, 10) * IN, 14 * IN), 'tabloid': (11 * IN, 17 * IN),
    'photo-4x6': (4 * IN, 6 * IN), 'photo-5x7': (5 * IN, 7 * IN), 'photo-8x10': (8 * IN, 10 * IN),
    'photo-10x15': (100, 150), 'photo-13x18': (130, 180),
}
PAPERS = {k: (F(w), F(h)) for k, (w, h) in PAPERS.items()}


def f(x):
    return float(x)


def dec_str(x: F, places: int, sep: str) -> str:
    """Exact decimal with `places` digits (x must be representable), trailing zeros kept."""
    q = x * 10 ** places
    assert q.denominator == 1
    n = q.numerator
    s = str(abs(n)).rjust(places + 1, '0')
    out = s[:-places] + sep + s[-places:] if places else s
    return ('-' if n < 0 else '') + out


def round_half_up(x: F, step: F) -> F:
    n = x / step
    return F(math.floor(n + F(1, 2))) * step


def trimmed(x: F, places: int, sep: str) -> str:
    """Round half-up to `places` decimals, drop trailing zeros (and the separator if nothing is left)."""
    r = round_half_up(abs(x), F(1, 10 ** places))
    s = dec_str(r, places, '.') if places else str(r.numerator)
    if '.' in s:
        s = s.rstrip('0').rstrip('.')
    s = s.replace('.', sep)
    return ('-' + s) if x < 0 and r != 0 else s


# ---------------------------------------------------------------- parse vectors (SPEC §8.1, D31)
def rand_decimal(maxint, places):
    return F(rng.randint(0, maxint * 10 ** places), 10 ** places)


parse_ok = []
parse_err = []
UNIT_SPELLINGS = {
    'mm': ['mm', ' mm', 'MM', ' Mm'], 'cm': ['cm', ' cm', ' CM'], 'm': [' m', 'm'],
    'in': [' in', 'in', '"', ' "', '”', '″', ' inch', ' inches', ' Zoll', "''"], 'pt': [' pt', 'pt', ' PT'],
}
for i in range(700):
    locale = rng.choice(['en', 'de'])
    display = rng.choice(['mm', 'cm', 'in'])
    form = rng.choice(['dec', 'dec', 'int', 'mixed', 'mixed-hyphen', 'frac'])
    unit = rng.choice(['mm', 'cm', 'm', 'in', 'pt', None])
    u = unit or display
    if form in ('mixed', 'mixed-hyphen', 'frac'):
        den = rng.choice([2, 4, 8, 16, 32, 64, 3, 10])
        num = rng.randint(1, den - 1)
        whole = rng.randint(0, 40)
        if form == 'frac':
            value = F(num, den)
            text = f'{num}/{den}'
        else:
            if whole == 0:
                whole = 1
            value = whole + F(num, den)
            text = f'{whole} {num}/{den}' if form == 'mixed' else rng.choice([f'{whole}-{num}/{den}', f'{whole} - {num}/{den}'])
    elif form == 'int':
        value = F(rng.randint(0, 400))
        text = str(value.numerator)
    else:
        places = rng.choice([1, 2, 4])
        value = rand_decimal(300, places)
        # the locale's own separator, or (unambiguous cases) the other one — D31
        sep = ',' if locale == 'de' else '.'
        if rng.random() < 0.3 and places != 3:
            sep = '.' if sep == ',' else ','
        text = dec_str(value, places, sep)
    mm = value * UNIT_MM[u]
    if mm > 10000:
        continue
    if unit:
        text += rng.choice(UNIT_SPELLINGS[unit])
    if rng.random() < 0.2:
        text = '  ' + text + ' '
    parse_ok.append({'text': text, 'locale': locale, 'display': display, 'mm': f(mm), 'exact': f'{mm.numerator}/{mm.denominator}'})

for text, locale, display, code in [
    ('', 'en', 'mm', 'empty'), ('   ', 'de', 'mm', 'empty'), ('-5', 'en', 'mm', 'negative'), ('-3 1/2 in', 'en', 'in', 'negative'),
    ('abc', 'en', 'mm', 'invalid'), ('12 kg', 'en', 'mm', 'invalid'), ('1/0 in', 'en', 'in', 'invalid'),
    ('3 17/16 in', 'en', 'in', 'invalid'), ('1.2.3', 'de', 'mm', 'invalid'), ('1,2,3', 'en', 'mm', 'invalid'),
    ('NaN', 'en', 'mm', 'invalid'), ('Infinity', 'en', 'mm', 'invalid'), ('1e3', 'en', 'mm', 'invalid'),
    ('10000.001 mm', 'en', 'mm', 'tooLarge'), ('394 in', 'en', 'mm', 'tooLarge'), ('1001 cm', 'de', 'mm', 'tooLarge'),
    ('11 m', 'en', 'mm', 'tooLarge'), ('1,000', 'en', 'mm', 'ambiguous'), ('1.000', 'de', 'mm', 'ambiguous'),
    ('12.500 mm', 'de', 'mm', 'ambiguous'), ('+5', 'en', 'mm', 'invalid'), ('5 mm mm', 'en', 'mm', 'invalid'),
    ('mm', 'en', 'mm', 'invalid'), ('3 1/2', 'en', 'mm', None), ('0', 'en', 'mm', None),
]:
    if code is None:
        continue
    parse_err.append({'text': text, 'locale': locale, 'display': display, 'code': code})
# edge successes
for text, locale, display, mm in [
    ('10000 mm', 'en', 'mm', F(10000)), ('1000 cm', 'en', 'mm', F(10000)), ('10 m', 'de', 'mm', F(10000)),
    ('0', 'en', 'mm', F(0)), ('0,125', 'en', 'in', F(125, 1000) * IN), ('1,000', 'de', 'mm', F(1)), ('1.000', 'en', 'cm', F(10)),
    ('.5 in', 'en', 'mm', F(1, 2) * IN), (',5', 'de', 'cm', F(5)), ('≈ 3 1/16 in', 'en', 'mm', (3 + F(1, 16)) * IN),
    ('~2 mm', 'en', 'in', F(2)), ('3 1/2', 'en', 'mm', F(7, 2)), ('5/4"', 'en', 'mm', F(5, 4) * IN),
]:
    parse_ok.append({'text': text, 'locale': locale, 'display': display, 'mm': f(mm), 'exact': f'{mm.numerator}/{mm.denominator}'})

# ---------------------------------------------------------------- format vectors (D32)
def fmt(mm: F, unit: str, style: str, locale: str) -> tuple[str, F]:
    sep = ',' if locale == 'de' else '.'
    neg = mm < 0
    a = abs(mm)
    if unit == 'mm':
        r = round_half_up(a, F(1, 100))
        return trimmed(mm, 2, sep) + ' mm', (-r if neg else r)
    if unit == 'cm':
        r = round_half_up(a / 10, F(1, 1000))
        return trimmed(mm / 10, 3, sep) + ' cm', (-r if neg else r) * 10
    inches = a / IN
    if style == 'decimal':
        r = round_half_up(inches, F(1, 10000))
        return trimmed(mm / IN, 4, sep) + ' in', (-r if neg else r) * IN
    den = 16 if style == 'fraction16' else 32
    r = round_half_up(inches, F(1, den))
    whole = math.floor(r)
    frac = r - whole
    if frac == 0:
        body = str(whole)
    elif whole == 0:
        body = f'{frac.numerator}/{frac.denominator}'
    else:
        body = f'{whole} {frac.numerator}/{frac.denominator}'
    approx = '≈ ' if r != inches else ''
    sign = '-' if neg and r != 0 else ''
    return f'{approx}{sign}{body} in', (-r if neg else r) * IN


format_vectors = []
for i in range(700):
    kind = rng.choice(['dec', 'inch', 'paper'])
    if kind == 'dec':
        mm = rand_decimal(3000, rng.choice([0, 1, 2, 3, 4]))
    elif kind == 'inch':
        mm = F(rng.randint(0, 64 * 120), 64) * IN
    else:
        mm = rng.choice([w for p in PAPERS.values() for w in p])
    if rng.random() < 0.1:
        mm = -mm
    unit = rng.choice(['mm', 'cm', 'in'])
    style = rng.choice(['decimal', 'fraction16', 'fraction32']) if unit == 'in' else 'decimal'
    locale = rng.choice(['en', 'de'])
    text, shown = fmt(mm, unit, style, locale)
    format_vectors.append({'mm': f(mm), 'unit': unit, 'style': style, 'locale': locale, 'text': text, 'shownMm': f(shown)})
# ties: exact half steps must round up (away from zero for the magnitude)
for mm, unit, style in [(F(1005, 1000), 'mm', 'decimal'), (F(2.5) * IN / 100, 'in', 'decimal'), (F(1, 32) * IN, 'in', 'fraction16'),
                        (F(3, 64) * IN, 'in', 'fraction32'), (F(12345, 10000) * 10, 'cm', 'decimal'), (F(100), 'in', 'fraction16')]:
    for locale in ('en', 'de'):
        text, shown = fmt(mm, unit, style, locale)
        format_vectors.append({'mm': f(mm), 'unit': unit, 'style': style, 'locale': locale, 'text': text, 'shownMm': f(shown)})

# ---------------------------------------------------------------- units (SPEC §8.1)
unit_vectors = []
for i in range(300):
    mm = rand_decimal(10000, rng.choice([0, 2, 4]))
    ppi = rng.choice([96, 72, 90, 150, 300])
    px = F(rng.randint(0, 20000), rng.choice([1, 2, 4]))
    unit_vectors.append({'mm': f(mm), 'pt': f(mm / PT), 'in': f(mm / IN), 'px': f(px), 'ppi': ppi, 'pxMm': f(px * IN / ppi)})

paper_vectors = [{'key': k, 'widthMm': f(w), 'heightMm': f(h), 'widthPt': f(w / PT), 'heightPt': f(h / PT)} for k, (w, h) in PAPERS.items()]

# ---------------------------------------------------------------- rotation and object mapping (SPEC §8.2, §8.3, D33/D34)
EXACT_TRIG = {0: (F(1), F(0)), 90: (F(0), F(1)), 180: (F(-1), F(0)), 270: (F(0), F(-1))}


def trig(deg):
    """cos/sin; exact for multiples of 90 (the editor's 90° buttons), libm otherwise."""
    d = deg % 360
    if d in EXACT_TRIG:
        return EXACT_TRIG[d]
    r = math.radians(float(deg))
    return math.cos(r), math.sin(r)


def rotate_about(cx, cy, px, py, deg):
    """Clockwise on the page (y down) by `deg`, written in polar form to differ from a matrix implementation."""
    dx, dy = px - cx, py - cy
    if deg % 90 == 0:
        c, s = trig(deg)
        return cx + dx * c - dy * s, cy + dx * s + dy * c
    r = math.hypot(dx, dy)
    phi = math.atan2(dy, dx) + math.radians(float(deg))
    return float(cx) + r * math.cos(phi), float(cy) + r * math.sin(phi)


def object_point(box, deg, mx, my, u, v):
    """Object-local point (u, v) in [0,w]x[0,h] -> sheet: mirror within the box, then rotate about the box centre."""
    x, y, w, h = box
    if mx:
        u = w - u
    if my:
        v = h - v
    return rotate_about(x + w / 2, y + h / 2, x + u, y + v, deg)


def rand_len(lo, hi, places=2):
    return F(rng.randint(lo * 10 ** places, hi * 10 ** places), 10 ** places)


rotation_vectors = []
for i in range(500):
    box = (rand_len(-200, 800), rand_len(-200, 800), rand_len(1, 600), rand_len(1, 600))
    deg = rng.choice([0, 90, 180, 270, -90, 450, -270, 720]) if rng.random() < 0.4 else rand_len(-720, 720, 1)
    mx, my = rng.random() < 0.3, rng.random() < 0.3
    corners = [object_point(box, deg, mx, my, u, v) for (u, v) in [(0, 0), (box[2], 0), (box[2], box[3]), (0, box[3])]]
    xs = [c[0] for c in corners]
    ys = [c[1] for c in corners]
    rotation_vectors.append({
        'box': [f(b) for b in box], 'deg': f(deg), 'mirrorX': mx, 'mirrorY': my,
        'corners': [[f(a), f(b)] for a, b in corners],
        'bounds': [f(min(xs)), f(min(ys)), f(max(xs) - min(xs)), f(max(ys) - min(ys))],
        'exact': deg % 90 == 0,
    })

mapping_vectors = []
for i in range(400):
    nw, nh = rand_len(1, 500), rand_len(1, 500)
    if rng.random() < 0.5:
        crop = (F(0), F(0), F(0), F(0))
    else:
        l, r = F(rng.randint(0, 45), 100), F(rng.randint(0, 45), 100)
        t, b = F(rng.randint(0, 45), 100), F(rng.randint(0, 45), 100)
        crop = (l, t, r, b)
    vw, vh = nw * (1 - crop[0] - crop[2]), nh * (1 - crop[1] - crop[3])
    mode = rng.choice(['fill', 'fit'])
    if rng.random() < 0.3:
        k = rand_len(0, 4, 3) + F(1, 1000)
        w, h = vw * k, vh * k          # aspect locked
    elif rng.random() < 0.2:
        w, h = vw, vh                  # 100 %
    else:
        w, h = rand_len(1, 600), rand_len(1, 600)
    box = (rand_len(-100, 500), rand_len(-100, 500), w, h)
    deg = rng.choice([0, 90, 180, 270, 33.5, -12])
    mx = rng.random() < 0.25
    if mode == 'fill':
        sx, sy = w / vw, h / vh
        ox = oy = F(0)
    else:
        s = min(w / vw, h / vh)
        sx = sy = s
        ox, oy = (w - vw * s) / 2, (h - vh * s) / 2
    # natural point -> local -> sheet
    pts = []
    for _ in range(3):
        px = crop[0] * nw + F(rng.randint(0, 1000), 1000) * vw
        py = crop[1] * nh + F(rng.randint(0, 1000), 1000) * vh
        u = ox + (px - crop[0] * nw) * sx
        v = oy + (py - crop[1] * nh) * sy
        sxp, syp = object_point(box, F(deg) if isinstance(deg, int) else deg, mx, False, u, v)
        pts.append({'natural': [f(px), f(py)], 'local': [f(u), f(v)], 'sheet': [f(sxp), f(syp)]})
    designed = abs(sx - 1) <= F(1, 10000) and abs(sy - 1) <= F(1, 10000)
    mapping_vectors.append({
        'natural': [f(nw), f(nh)], 'crop': [f(c) for c in crop], 'box': [f(b) for b in box], 'deg': deg, 'mirrorX': mx,
        'mode': mode, 'visible': [f(vw), f(vh)], 'scale': [f(sx), f(sy)], 'offset': [f(ox), f(oy)],
        'atDesignedSize': designed, 'points': pts,
    })

# ---------------------------------------------------------------- W1 (SPEC worked example)
w1 = {
    'a4Pt': [f(PAPERS['a4'][0] / PT), f(PAPERS['a4'][1] / PT)], 'letterPt': [f(PAPERS['letter'][0] / PT), f(PAPERS['letter'][1] / PT)],
    'mm100Pt': f(100 / PT), 'threeSixteenthIn': f((3 + F(1, 16)) * IN), 'sevenFiveCm': 75.0, 'twelvePt': f(12 * PT),
}
# SPEC rounds to 4 decimals; check the spec's printed figures against the exact values here
assert round(w1['a4Pt'][0], 4) == 595.2756 and round(w1['a4Pt'][1], 4) == 841.8898
assert w1['letterPt'] == [612.0, 792.0] and round(w1['mm100Pt'], 4) == 283.4646
assert w1['threeSixteenthIn'] == 77.7875 and round(w1['twelvePt'], 4) == 4.2333

out = {
    'generator': 'scripts/oracle/p1_oracle.py (Python fractions; same agent as the P1 engine — see header)',
    'seed': 20261001, 'w1': w1, 'units': unit_vectors, 'papers': paper_vectors, 'parseOk': parse_ok,
    'parseErr': parse_err, 'format': format_vectors, 'rotation': rotation_vectors, 'mapping': mapping_vectors,
}
(ROOT / 'test/fixtures/engine/oracle-p1.json').write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')))

# ================================================================ P2 pending (SPEC §8.5–8.7, W3–W7) — data only
def tiles_1d(length, content, overlap):
    """Smallest n >= 1 whose tiles (step content-overlap) cover `length` — by iteration, not the closed formula."""
    if length <= content:
        return 1
    n, covered = 1, content
    while covered < length:
        n += 1
        covered += content - overlap
    return n


def tile_plan(W, H, paper, margins, o):
    pw, ph = PAPERS[paper]
    l, t, r, b = margins
    res = {}
    for orient, (qw, qh) in (('portrait', (pw, ph)), ('landscape', (ph, pw))):
        # D53 (P3.5 F1/F7): margins are the portrait paper's; the landscape frame's l, t, r, b are the paper's b, l, t, r
        fl, ft, fr, fb = (b, l, t, r) if orient == 'landscape' else (l, t, r, b)
        tw, th = qw - fl - fr, qh - ft - fb
        res[orient] = [tiles_1d(W, tw, o), tiles_1d(H, th, o)]
    pp, lp = res['portrait'][0] * res['portrait'][1], res['landscape'][0] * res['landscape'][1]
    res['auto'] = 'landscape' if lp < pp else 'portrait'
    return res


tile_vectors = []
for i in range(1200):
    paper = rng.choice(['a4', 'letter', 'a3', 'legal', 'a5'])
    m = [rand_len(0, 20) for _ in range(4)] if rng.random() < 0.5 else [F(635, 100)] * 4
    pw, ph = PAPERS[paper]
    tw, th = min(pw, ph) - m[0] - m[2], min(pw, ph) - m[1] - m[3]
    omax = min(tw, th, max(pw, ph) - m[1] - m[3]) / 3
    o = rng.choice([F(0), F(10), rand_len(0, 30)])
    o = min(o, math.floor(omax))
    W, H = rand_len(int(pw) + 1, 3000), rand_len(int(ph) + 1, 3000)
    if rng.random() < 0.15:   # exact boundary: W - o is an exact multiple of the step
        step = pw - m[0] - m[2] - o
        W = o + rng.randint(2, 8) * step
    tile_vectors.append({'sheet': [f(W), f(H)], 'paper': paper, 'margins': [f(x) for x in m], 'overlap': f(o),
                         **tile_plan(W, H, paper, m, o)})
named_tiles = {
    'W3-a4': tile_plan(F(600), F(900), 'a4', [F(635, 100)] * 4, F(10)),
    'W3-letter': tile_plan(F(600), F(900), 'letter', [F(635, 100)] * 4, F(10)),
    'W4-a4': tile_plan(F(1000), F(30), 'a4', [F(635, 100)] * 4, F(10)),
    'W5-a2-on-a4': tile_plan(F(420), F(594), 'a4', [F(635, 100)] * 4, F(10)),
    'W5-a0-on-a4': tile_plan(F(841), F(1189), 'a4', [F(635, 100)] * 4, F(10)),
}
assert named_tiles['W3-a4']['portrait'] == [4, 4] and named_tiles['W3-a4']['landscape'] == [3, 5]
assert named_tiles['W3-letter']['portrait'][0] * named_tiles['W3-letter']['portrait'][1] == 16
assert named_tiles['W3-letter']['landscape'][0] * named_tiles['W3-letter']['landscape'][1] == 15
assert named_tiles['W4-a4']['portrait'] == [6, 1] and named_tiles['W4-a4']['landscape'] == [4, 1]
assert named_tiles['W5-a2-on-a4']['portrait'] == [3, 3] and named_tiles['W5-a2-on-a4']['landscape'] == [2, 4]
assert named_tiles['W5-a0-on-a4']['portrait'] == [5, 5]
lw = named_tiles['W5-a0-on-a4']['landscape']
assert lw[0] * lw[1] == 28


def fill_counts(saw, sah, w, h, gx, gy):
    cols = 0
    while (cols + 1) * w + cols * gx <= saw:
        cols += 1
    rows = 0
    while (rows + 1) * h + rows * gy <= sah:
        rows += 1
    return cols, rows


assert fill_counts(F(1973, 10), F(2843, 10), 50, 30, 2, 2) == (3, 8)          # W6 A4
assert fill_counts(F(2032, 10), F(2667, 10), 50, 30, 2, 2) == (3, 8)          # W6 Letter
fill_vectors = []
for i in range(300):
    saw, sah = rand_len(20, 400), rand_len(20, 400)
    w, h = rand_len(1, 200), rand_len(1, 200)
    gx, gy = rng.choice([F(0), F(2), rand_len(0, 20)]), rng.choice([F(0), F(2), rand_len(0, 20)])
    if rng.random() < 0.15:   # exact fit boundary
        k = rng.randint(1, 6)
        saw = k * w + (k - 1) * gx
    c, r = fill_counts(saw, sah, w, h, gx, gy)
    fill_vectors.append({'safe': [f(saw), f(sah)], 'item': [f(w), f(h)], 'gap': [f(gx), f(gy)], 'cols': c, 'rows': r})

MISMATCH = [F(9407, 10000), F(9727, 10000), F(10281, 10000), F(10630, 10000)]


def verdict(M, N):
    s = F(M) / F(N)
    d = abs(s - 1)
    if d <= F(2, 1000):
        v = 'exact'
    elif d <= F(2, 100):
        v = 'slight'
    elif d <= F(15, 100):
        v = 'explain'
    else:
        v = 'refused'
    causes = []
    if v == 'explain':
        if F(93, 100) <= s <= F(985, 1000):
            causes.append('fitToPage')
        if any(abs(s - q) <= F(3, 1000) for q in MISMATCH):
            causes.append('paperMismatch')
    return s, v, causes


cal_vectors = []
for N in (F(100), F(150), F(200)):
    for i in range(120):
        M = N * (1 + F(rng.randint(-200, 200), 1000)) if rng.random() < 0.7 else N * rng.choice(MISMATCH + [F(1)]) + F(rng.randint(-20, 20), 100)
        M = round_half_up(M, F(1, 100))
        if M <= 0:
            continue
        s, v, causes = verdict(M, N)
        if v == 'refused':
            cal_vectors.append({'nominal': f(N), 'measured': f(M), 'scale': f(s), 'verdict': v, 'causes': causes})
            continue
        c = 1 / s
        page = rng.choice(['a4', 'letter'])
        pw, ph = PAPERS[page]
        p = (rand_len(0, int(pw)), rand_len(0, int(ph)))
        C = (pw / 2, ph / 2)
        q = (C[0] + c * (p[0] - C[0]), C[1] + c * (p[1] - C[1]))
        # a centred fit-to-page by s applied after our correction returns the original point (SPEC §8.7)
        back = (C[0] + s * (q[0] - C[0]), C[1] + s * (q[1] - C[1]))
        assert back == p
        cal_vectors.append({'nominal': f(N), 'measured': f(M), 'scale': f(s), 'correction': f(c), 'verdict': v,
                            'causes': causes, 'paper': page, 'point': [f(x) for x in p], 'corrected': [f(x) for x in q]})
w7 = {
    'a': {'measured': 96.5, 'scale': f(F(965, 1000)), 'correction': f(1 / F(965, 1000)), 'x20OnA4': f(105 + (1 / F(965, 1000)) * (20 - 105))},
    'b': {'measured': 100.4, 'correction': f(1 / F(1004, 1000))},
    'c': {'measured': 97.27, 'verdict': verdict(F(9727, 100), 100)[1], 'causes': verdict(F(9727, 100), 100)[2]},
}
assert round(w7['a']['correction'], 5) == 1.03627 and round(w7['a']['x20OnA4'], 4) == 16.9171
assert round(w7['b']['correction'], 5) == 0.99602 and 'paperMismatch' in w7['c']['causes']
assert verdict(F(965, 10), 100)[2] == ['fitToPage'] and verdict(F(1004, 10), 100)[1] == 'slight'

pending = {
    'generator': 'scripts/oracle/p1_oracle.py — written in P1 before any tiling/calibration engine existed; for P2',
    'tiles': tile_vectors, 'namedTiles': named_tiles, 'fill': fill_vectors, 'calibration': cal_vectors, 'w7': w7,
}
(ROOT / 'test/fixtures/engine/oracle-p2-pending.json').write_text(json.dumps(pending, ensure_ascii=False, separators=(',', ':')))
print(f'oracle-p1: parseOk {len(parse_ok)} parseErr {len(parse_err)} format {len(format_vectors)} units {len(unit_vectors)} '
      f'papers {len(paper_vectors)} rotation {len(rotation_vectors)} mapping {len(mapping_vectors)}')
print(f'oracle-p2-pending: tiles {len(tile_vectors)} fill {len(fill_vectors)} calibration {len(cal_vectors)}; W1/W3-W7 asserts OK')
