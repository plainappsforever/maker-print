#!/usr/bin/env python3
"""Builder's own oracle for the V15 phase A1 scan maths (homography, corner sanity, true aspect). L20/L27.

Written from docs/V15_PLAN.md A1 and the cited maths, without importing src/: the homography is composed from
Heckbert's closed-form square-to-quad maps (Heckbert 1989, "Fundamentals of Texture Mapping", §2.2.3), not the
engine's direct linear transform; the true aspect cases are photographs of known rectangles made by a pinhole camera
(ground truth by construction, not by the Zhang & He formula the engine uses); the corner classes follow the rules
written in src/engine/homography.ts's doc comment (convex, clockwise on screen, >= 10 % of the photo, corners at
least 5 degrees from straight, no two corners within 1 px).

CAVEAT (L27 rule 4): the same agent wrote this oracle and the A1 engine. It is NOT the independent oracle the plan
asks for ("written by a separate agent in Python"); that one is still owed and must be written blind.
Run: python3 scripts/oracle/a1_oracle.py  ->  test/fixtures/engine/oracle-a1.json (compared in src/engine/oracle-a1.test.ts)
"""
import json
import math
import os
import random

R = random.Random(20261016)
IMG = (4032.0, 3024.0)


def square_to_quad(q):
    (x0, y0), (x1, y1), (x2, y2), (x3, y3) = q
    sx = x0 - x1 + x2 - x3
    sy = y0 - y1 + y2 - y3
    if abs(sx) < 1e-12 and abs(sy) < 1e-12:
        return [[x1 - x0, x2 - x1, x0], [y1 - y0, y2 - y1, y0], [0.0, 0.0, 1.0]]
    dx1, dx2, dy1, dy2 = x1 - x2, x3 - x2, y1 - y2, y3 - y2
    den = dx1 * dy2 - dx2 * dy1
    g = (sx * dy2 - dx2 * sy) / den
    h = (dx1 * sy - sx * dy1) / den
    return [[x1 - x0 + g * x1, x3 - x0 + h * x3, x0], [y1 - y0 + g * y1, y3 - y0 + h * y3, y0], [g, h, 1.0]]


def inv3(m):
    a, b, c = m[0]
    d, e, f = m[1]
    g, h, i = m[2]
    A, B, C = e * i - f * h, -(d * i - f * g), d * h - e * g
    det = a * A + b * B + c * C
    adj = [[A, -(b * i - c * h), b * f - c * e], [B, a * i - c * g, -(a * f - c * d)], [C, -(a * h - b * g), a * e - b * d]]
    return [[v / det for v in row] for row in adj]


def mul3(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]


def apply(m, p):
    x, y = p
    w = m[2][0] * x + m[2][1] * y + m[2][2]
    return ((m[0][0] * x + m[0][1] * y + m[0][2]) / w, (m[1][0] * x + m[1][1] * y + m[1][2]) / w)


def cross(o, a, b):
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])


def classify(q, img=IMG):
    """The engine's documented rules, re-implemented from the comment (order of checks as documented)."""
    w, h = img
    if any(p[0] < -0.5 or p[1] < -0.5 or p[0] > w + 0.5 or p[1] > h + 0.5 for p in q):
        return 'outside'
    for i in range(4):
        for j in range(i + 1, 4):
            if math.dist(q[i], q[j]) < 1:
                return 'degenerate'

    def seg_cross(a, b, c, d):
        d1, d2, d3, d4 = cross(c, d, a), cross(c, d, b), cross(a, b, c), cross(a, b, d)
        return ((d1 > 0 > d2) or (d1 < 0 < d2)) and ((d3 > 0 > d4) or (d3 < 0 < d4))

    if seg_cross(q[0], q[1], q[2], q[3]) or seg_cross(q[1], q[2], q[3], q[0]):
        return 'selfIntersecting'
    turns = [cross(q[i], q[(i + 1) % 4], q[(i + 2) % 4]) for i in range(4)]

    def angle(i):
        p, c, n = q[(i + 3) % 4], q[i], q[(i + 1) % 4]
        a = math.atan2(p[1] - c[1], p[0] - c[0]) - math.atan2(n[1] - c[1], n[0] - c[0])
        d = abs(math.degrees(a)) % 360
        return 360 - d if d > 180 else d

    if any(angle(i) < 5 or angle(i) > 175 for i in range(4)):
        scale = max(max(abs(p[0]), abs(p[1])) for p in q)
        straight = any(abs(t) <= 1e-9 * scale * scale for t in turns)
        if not straight and not (all(t > 0 for t in turns) or all(t < 0 for t in turns)):
            return 'concave'
        return 'degenerate'
    if all(t < 0 for t in turns):
        return 'mirrored'
    if not all(t > 0 for t in turns):
        return 'concave'
    area = sum(q[i][0] * q[(i + 1) % 4][1] - q[(i + 1) % 4][0] * q[i][1] for i in range(4)) / 2
    if area < 0.1 * w * h:
        return 'tooSmall'
    return None


def random_quad():
    while True:
        j = lambda: R.uniform(-0.15, 0.15)
        q = [((0.2 + j()) * IMG[0], (0.2 + j()) * IMG[1]), ((0.8 + j()) * IMG[0], (0.2 + j()) * IMG[1]),
             ((0.8 + j()) * IMG[0], (0.8 + j()) * IMG[1]), ((0.2 + j()) * IMG[0], (0.8 + j()) * IMG[1])]
        if classify(q) is None:
            return q


def rnd(v):
    return round(v, 6)


# ------------------------------------------------------------------------------------------------ homographies
homs = []
for n in range(1000):
    src = random_quad()
    if n % 5 == 4:
        dst = random_quad()  # general quad -> quad
    else:
        W, H = R.randint(100, 5000), R.randint(100, 5000)
        dst = [(0.0, 0.0), (float(W), 0.0), (float(W), float(H)), (0.0, float(H))]
    M = mul3(square_to_quad(dst), inv3(square_to_quad(src)))  # src -> unit square -> dst
    samples = []
    for _ in range(8):
        u, v = R.random(), R.random()
        p = apply(square_to_quad(src), (u, v))
        samples.append({'src': [rnd(p[0]), rnd(p[1])], 'dst': [rnd(c) for c in apply(M, p)]})
    homs.append({'src': [[rnd(c) for c in p] for p in src], 'dst': [[rnd(c) for c in p] for p in dst], 'samples': samples})

# ------------------------------------------------------------------------------------------------ corner classes
quads = []
base = [(400.0, 300.0), (3600.0, 350.0), (3500.0, 2700.0), (450.0, 2650.0)]
for n in range(400):
    kind = n % 8
    q = [list(p) for p in random_quad()]
    if kind == 1:  # concave: pull one corner far inside past the diagonal
        i = R.randrange(4)
        a, c = q[(i + 3) % 4], q[(i + 1) % 4]
        mid = ((a[0] + c[0]) / 2, (a[1] + c[1]) / 2)
        cen = (sum(p[0] for p in q) / 4, sum(p[1] for p in q) / 4)
        t = R.uniform(0.3, 0.9)
        q[i] = [mid[0] + (cen[0] - mid[0]) * t * 2, mid[1] + (cen[1] - mid[1]) * t * 2]
    elif kind == 2:  # bow-tie
        q[1], q[2] = q[2], q[1]
    elif kind == 3:  # mirrored
        q = [q[1], q[0], q[3], q[2]]
    elif kind == 4:  # too small: shrink about the centre
        cen = (sum(p[0] for p in q) / 4, sum(p[1] for p in q) / 4)
        s = R.uniform(0.05, 0.4)
        q = [[cen[0] + (p[0] - cen[0]) * s, cen[1] + (p[1] - cen[1]) * s] for p in q]
    elif kind == 5:  # collinear corner
        i = R.randrange(4)
        a, c = q[(i + 3) % 4], q[(i + 1) % 4]
        t = R.uniform(0.3, 0.7)
        q[i] = [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t]
    elif kind == 6:  # outside
        i = R.randrange(4)
        q[i] = [q[i][0] - IMG[0] * (1 if R.random() < 0.5 else -1), q[i][1]]
    elif kind == 7:  # coincident
        q[1] = [q[0][0] + R.uniform(-0.6, 0.6), q[0][1] + R.uniform(-0.6, 0.6)]
    quads.append({'q': [[rnd(c) for c in p] for p in q], 'issue': classify([tuple(p) for p in q])})


# ------------------------------------------------------------------------------------------------ true aspect
def rot(ax, ay, az):
    cx, sx, cy, sy, cz, sz = math.cos(ax), math.sin(ax), math.cos(ay), math.sin(ay), math.cos(az), math.sin(az)
    Rx = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]]
    Ry = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]]
    Rz = [[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]]
    return mul3(Rz, mul3(Ry, Rx))


def project(Rm, t, f, W, H, u, v):
    p = [Rm[i][0] * (u - W / 2) + Rm[i][1] * (v - H / 2) + t[i] for i in range(3)]
    return (f * p[0] / p[2] + IMG[0] / 2, f * p[1] / p[2] + IMG[1] / 2)


aspects = []
diag = math.hypot(*IMG)
while len(aspects) < 300:
    W, H = R.uniform(40, 500), R.uniform(40, 500)
    f = R.uniform(0.45, 1.6) * diag
    Rm = rot(R.uniform(-0.6, 0.6), R.uniform(-0.6, 0.6), R.uniform(-0.3, 0.3))
    t = [R.uniform(-15, 15), R.uniform(-15, 15), f * max(W, H) / (0.62 * IMG[1])]
    q = [project(Rm, t, f, W, H, u, v) for u, v in ((0, 0), (W, 0), (W, H), (0, H))]
    if classify(q) is not None:
        continue
    aspects.append({'q': [[rnd(c) for c in p] for p in q], 'ratio': W / H, 'focalPx': f, 'focal35mm': f / diag * math.hypot(36, 24)})

out = {'img': IMG, 'homographies': homs, 'quads': quads, 'aspects': aspects}
path = os.path.join(os.path.dirname(__file__), '..', '..', 'test', 'fixtures', 'engine', 'oracle-a1.json')
with open(path, 'w') as fh:
    json.dump(out, fh, separators=(',', ':'))
counts = {}
for c in quads:
    counts[c['issue']] = counts.get(c['issue'], 0) + 1
print('homographies', len(homs), 'quads', counts, 'aspects', len(aspects))
