#!/usr/bin/env python3
"""Maker Print V1.5 A1 — BLIND scan oracle (separate agent, written from docs/SPEC.md §11,
docs/V15_PLAN.md A1 and docs/DECISIONS.md D91/D94 only; src/engine and scripts/oracle were NOT read).

Generates cases.json:
  * photo cases: a rectangle of known size (mm) photographed by a pinhole camera (known focal length,
    pose, principal point at the image centre), corners with uniform noise of 0/1/2/3/5 px, EXIF
    FocalLengthIn35mmFilm present (as real JPEG/Exif bytes, both byte orders, integer SHORT as cameras
    write it) or absent. Expected per mode:
      a  both sides typed            -> size exactly as typed; aspectMismatch per D91 thresholds
      aw both sides typed, one wrong -> aspectMismatch expected
      b  one side typed + EXIF lens  -> other side from the true-aspect estimate (Zhang & He)
      c  one side typed, no EXIF     -> quad focal if the 2 px gate passes, else 26 mm + aspectWeak
      d  paper preset                -> paper size turned to the photo's orientation
      e  nothing typed               -> straighten only, no size
  * verdict cases: quads with known rule violations (inside +-0.5 px, distinct corners, angles 5-175 deg,
    no crossing, clockwise, convex, area >= 10 %), incl. collinear / near-degenerate / NaN.
  * homography cases: quad -> output rectangle, exact rational solution, interior test points.
  * exif cases: focal tag reading (35 mm tag vs actual focal, zero, missing, LE/BE, SHORT/LONG).
Ground truth is the camera; the "replica" values are this oracle's own reading of D91 from the noisy corners.
Ambiguous spec readings are carried as null (not asserted) and listed in AMBIGUITIES.
Deterministic: random.Random(20261016).
"""
import json, math, random, struct, sys
from fractions import Fraction

RNG = random.Random(20261016)
DIAG35 = math.hypot(36.0, 24.0)          # 43.2666 mm: 35 mm-equivalent via the diagonal (crop factor)
ASSUMED_F35 = 26.0                       # D91 assumed phone lens
CAP_SI = 16_000_000                      # 16 MP (SI)
CAP_BIN = 16 * 1024 * 1024               # 16 MiP — if the engine uses this, recorded as a finding
PAPERS = {"A4": (210.0, 297.0), "A5": (148.0, 210.0), "A3": (297.0, 420.0),
          "Letter": (215.9, 279.4), "Legal": (215.9, 355.6)}
PHOTOS = [(4032, 3024), (3024, 4032), (4000, 3000), (3000, 4000), (4624, 3472), (1600, 1200),
          (1200, 1600), (4080, 3060), (8064, 6048), (6048, 8064), (2048, 1536), (3264, 2448)]
LENSES = [24.0, 26.0, 26.0, 28.0, 35.0, 48.0, 52.0, 77.0]
NOISE = [0, 1, 2, 3, 5]

AMBIGUITIES = [
    "35 mm-equivalent focal -> pixels via the DIAGONAL (f_px = f35 * diag_px / 43.27); a width-based convention would be wrong for phones.",
    "EXIF FocalLengthIn35mmFilm is an integer SHORT; truth uses the unrounded lens, so mode b carries up to 0.5 mm rounding.",
    "2 px gate: replica = max over 16 single-corner +-2 px x/y moves of |ratio'/ratio - 1| with the focal re-estimated; asserted only < 0.25 % (pass) or > 1.0 % (fail).",
    "aspectMismatch: rel = |typed aspect / estimated aspect - 1|; asserted only below 0.6 T or above 1.4 T (T = 5 % measured, 15 % assumed).",
    "lowDetail: far-edge density = min over the four edges of px length / mm length * 25.4 (truth size); asserted outside 150 +-10 %.",
    "Output density = max over the four edges of px length / mm length (engine's own size and corners), capped at 16 MP; compared within 1 %.",
    "Paper orientation: landscape when the estimated true aspect (width/height) > 1; only papers with aspect >= 1.29 are used.",
    "aspectWeak not asserted for near-fronto photos (|pitch| and |yaw| < 4 deg): the ratio does not depend on the focal there.",
    "Verdicts: inside means -0.5 <= x <= W + 0.5 (photo extent [0, W]); an angle outside 5-175 deg may be reported as degenerate or concave; any non-ok code is accepted where several rules are violated.",
]

# ---------------------------------------------------------------- vector helpers
def sub(a, b): return (a[0] - b[0], a[1] - b[1])
def cross2(a, b): return a[0] * b[1] - a[1] * b[0]
def dist(a, b): return math.hypot(a[0] - b[0], a[1] - b[1])
def cross3(a, b): return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
def dot3(a, b): return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

def shoelace(q):
    s = 0.0
    for i in range(4):
        x1, y1 = q[i]; x2, y2 = q[(i + 1) % 4]
        s += x1 * y2 - x2 * y1
    return s / 2.0   # > 0 = clockwise on screen (y down)

def matmul3(A, B): return [[sum(A[i][k] * B[k][j] for k in range(3)) for j in range(3)] for i in range(3)]
def matvec3(A, v): return [sum(A[i][k] * v[k] for k in range(3)) for i in range(3)]
def rx(a): c, s = math.cos(a), math.sin(a); return [[1, 0, 0], [0, c, -s], [0, s, c]]
def ry(a): c, s = math.cos(a), math.sin(a); return [[c, 0, s], [0, 1, 0], [-s, 0, c]]
def rz(a): c, s = math.cos(a), math.sin(a); return [[c, -s, 0], [s, c, 0], [0, 0, 1]]

# ---------------------------------------------------------------- true aspect (Zhang & He 2007), centred principal point
def zhang_parts(q, W, H):
    """q = TL, TR, BR, BL in pixels. Returns (f2, n2, n3) with corners centred on (W/2, H/2)."""
    c = (W / 2.0, H / 2.0)
    m1 = (q[0][0] - c[0], q[0][1] - c[1], 1.0)   # TL  (0, 0)
    m2 = (q[1][0] - c[0], q[1][1] - c[1], 1.0)   # TR  (w, 0)
    m3 = (q[3][0] - c[0], q[3][1] - c[1], 1.0)   # BL  (0, h)
    m4 = (q[2][0] - c[0], q[2][1] - c[1], 1.0)   # BR  (w, h)
    d2 = dot3(cross3(m2, m4), m3)
    d3 = dot3(cross3(m3, m4), m2)
    if d2 == 0 or d3 == 0: return None
    k2 = dot3(cross3(m1, m4), m3) / d2
    k3 = dot3(cross3(m1, m4), m2) / d3
    n2 = tuple(k2 * m2[i] - m1[i] for i in range(3))
    n3 = tuple(k3 * m3[i] - m1[i] for i in range(3))
    den = n2[2] * n3[2]
    f2 = None if abs(den) < 1e-12 else -(n2[0] * n3[0] + n2[1] * n3[1]) / den
    return f2, n2, n3

def ratio_with_f(q, W, H, f):
    p = zhang_parts(q, W, H)
    if p is None: return None
    _, n2, n3 = p
    a = (n2[0] ** 2 + n2[1] ** 2) / (f * f) + n2[2] ** 2
    b = (n3[0] ** 2 + n3[1] ** 2) / (f * f) + n3[2] ** 2
    if b <= 0: return None
    return math.sqrt(a / b)   # width / height (TL-TR over TL-BL)

def quad_focal(q, W, H):
    p = zhang_parts(q, W, H)
    if p is None or p[0] is None or not (p[0] > 0): return None
    return math.sqrt(p[0])

def f_px_from_35(f35, W, H): return f35 * math.hypot(W, H) / DIAG35

def gate_sensitivity(q, W, H):
    f = quad_focal(q, W, H)
    if f is None: return math.inf, None
    r0 = ratio_with_f(q, W, H, f)
    worst = 0.0
    for i in range(4):
        for ax in (0, 1):
            for s in (-2.0, 2.0):
                qq = [list(p) for p in q]; qq[i][ax] += s
                ff = quad_focal(qq, W, H)
                if ff is None: return math.inf, f
                rr = ratio_with_f(qq, W, H, ff)
                if rr is None: return math.inf, f
                worst = max(worst, abs(rr / r0 - 1))
    return worst, f

# ---------------------------------------------------------------- EXIF bytes (minimal JPEG)
def exif_jpeg(W, H, f35, actual_focal_mm, byteorder="II", f35_type="SHORT", orientation=1, include35=True):
    """Minimal JPEG: SOI, APP1 Exif (IFD0 Orientation + ExifIFD pointer; Exif IFD FocalLength RATIONAL and
    FocalLengthIn35mmFilm), SOF0 with stored dimensions, EOI. Stored dims = displayed dims rotated back for orientation 6/8."""
    e = "<" if byteorder == "II" else ">"
    entries_ifd0 = 2
    ifd0_off = 8
    ifd0_size = 2 + entries_ifd0 * 12 + 4
    exif_off = ifd0_off + ifd0_size
    ex_entries = [(0x920A, 5, 1, None)]           # FocalLength RATIONAL -> data area
    if include35:
        ex_entries.append((0xA405, 3 if f35_type == "SHORT" else 4, 1, int(f35)))
    ex_size = 2 + len(ex_entries) * 12 + 4
    data_off = exif_off + ex_size
    t = bytearray()
    t += (b"II" if byteorder == "II" else b"MM") + struct.pack(e + "H", 42) + struct.pack(e + "I", 8)
    t += struct.pack(e + "H", entries_ifd0)
    t += struct.pack(e + "HHI", 0x0112, 3, 1) + struct.pack(e + "H", orientation) + b"\0\0"
    t += struct.pack(e + "HHII", 0x8769, 4, 1, exif_off)
    t += struct.pack(e + "I", 0)
    t += struct.pack(e + "H", len(ex_entries))
    for tag, typ, cnt, val in ex_entries:
        if tag == 0x920A:
            t += struct.pack(e + "HHII", tag, typ, cnt, data_off)
        elif typ == 3:
            t += struct.pack(e + "HHI", tag, typ, cnt) + struct.pack(e + "H", val) + b"\0\0"
        else:
            t += struct.pack(e + "HHII", tag, typ, cnt, val)
    t += struct.pack(e + "I", 0)
    num = int(round(actual_focal_mm * 100))
    t += struct.pack(e + "II", num, 100)
    app1 = b"Exif\0\0" + bytes(t)
    sw, sh = (H, W) if orientation in (5, 6, 7, 8) else (W, H)
    out = bytearray(b"\xFF\xD8")
    out += b"\xFF\xE1" + struct.pack(">H", len(app1) + 2) + app1
    sof = bytes([8]) + struct.pack(">HH", sh, sw) + bytes([3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1])
    out += b"\xFF\xC0" + struct.pack(">H", len(sof) + 2) + sof
    out += b"\xFF\xD9"
    return out.hex()

# ---------------------------------------------------------------- photo generator
def project(R, t, f, W, H, X):
    Xc = [sum(R[i][k] * X[k] for k in range(3)) + t[i] for i in range(3)]
    if Xc[2] <= 1: return None
    return (f * Xc[0] / Xc[2] + W / 2.0, f * Xc[1] / Xc[2] + H / 2.0)

def make_photo(kind):
    for _ in range(10000):
        W, H = RNG.choice(PHOTOS)
        f35 = RNG.choice(LENSES) * RNG.uniform(0.985, 1.015)
        f = f_px_from_35(f35, W, H)
        if kind == "paper":
            pname = RNG.choice(list(PAPERS))
            pw, ph = PAPERS[pname]
            if RNG.random() < 0.5: w, h = ph, pw     # landscape sheet on the table
            else: w, h = pw, ph
        else:
            pname = None
            w = RNG.uniform(60, 400); h = w / RNG.uniform(0.4, 2.5)
            if not (40 <= h <= 450): continue
        pose = RNG.random()
        if pose < 0.08: pitch, yaw = 0.0, 0.0                                   # straight on
        elif pose < 0.16: pitch, yaw = RNG.uniform(-35, 35), 0.0                # one-axis tilt
        elif pose < 0.22: pitch, yaw = RNG.uniform(-1.5, 1.5), RNG.uniform(-1.5, 1.5)  # near fronto
        else: pitch, yaw = RNG.uniform(-38, 38), RNG.uniform(-38, 38)
        roll = RNG.uniform(-12, 12)
        R = matmul3(rz(math.radians(roll)), matmul3(rx(math.radians(pitch)), ry(math.radians(yaw))))
        fill = RNG.uniform(0.35, 0.92)
        D = f * max(w, h) / (fill * min(W, H)) * RNG.uniform(0.9, 1.4)
        t = [RNG.uniform(-0.12, 0.12) * D * min(W, H) / f, RNG.uniform(-0.12, 0.12) * D * min(W, H) / f, D]
        obj = [(-w / 2, -h / 2, 0.0), (w / 2, -h / 2, 0.0), (w / 2, h / 2, 0.0), (-w / 2, h / 2, 0.0)]
        q = [project(R, t, f, W, H, X) for X in obj]
        if any(p is None for p in q): continue
        if any(not (8 <= p[0] <= W - 8 and 8 <= p[1] <= H - 8) for p in q): continue
        if shoelace(q) <= 0 or abs(shoelace(q)) < 0.13 * W * H: continue
        # screen-order sanity: the physical TL must be the screen TL for any sensible sorter
        sums = [p[0] + p[1] for p in q]
        if sums.index(min(sums)) != 0: continue
        angs = corner_angles(q)
        if min(angs) < 25 or max(angs) > 155: continue
        return dict(W=W, H=H, f35=f35, fpx=f, w=w, h=h, paper=pname, pitch=pitch, yaw=yaw, roll=roll, q=q)
    raise RuntimeError("no photo")

def corner_angles(q):
    out = []
    for i in range(4):
        a = sub(q[i - 1], q[i]); b = sub(q[(i + 1) % 4], q[i])
        na, nb = math.hypot(*a), math.hypot(*b)
        if na == 0 or nb == 0: out.append(0.0); continue
        c = max(-1.0, min(1.0, (a[0] * b[0] + a[1] * b[1]) / (na * nb)))
        out.append(math.degrees(math.acos(c)))
    return out

def edge_px(q):  # top, right, bottom, left
    return [dist(q[0], q[1]), dist(q[1], q[2]), dist(q[2], q[3]), dist(q[3], q[0])]

def far_edge_ppi(q, wmm, hmm):
    t, r, b, l = edge_px(q)
    return min(t / wmm, b / wmm, r / hmm, l / hmm) * 25.4

def out_pixels(q, wmm, hmm, cap=CAP_SI):
    t, r, b, l = edge_px(q)
    d = max(t / wmm, b / wmm, r / hmm, l / hmm)
    ow, oh = wmm * d, hmm * d
    capped = False
    if ow * oh > cap:
        s = math.sqrt(cap / (ow * oh)); ow *= s; oh *= s; capped = True
    return ow, oh, capped

def tri(v, lo, hi):
    """True / False / None (ambiguous band)."""
    if v < lo: return False
    if v > hi: return True
    return None

def photo_case(i, kind):
    P = make_photo(kind)
    W, H, q = P["W"], P["H"], P["q"]
    a = NOISE[i % len(NOISE)]
    qn = [(x + RNG.uniform(-a, a), y + RNG.uniform(-a, a)) for x, y in q]
    exif_present = RNG.random() < 0.5
    f35_tag = int(round(P["f35"]))
    order = list(range(4))
    shuffled = RNG.random() < 0.5
    if shuffled: RNG.shuffle(order)
    given = [qn[k] for k in order]
    bo = RNG.choice(["II", "MM"])
    actual_focal = P["f35"] / RNG.choice([7.0, 6.1, 4.8, 3.9])   # actual lens focal in mm (crop factor) — a distractor
    exif_hex = exif_jpeg(W, H, f35_tag, actual_focal, byteorder=bo)
    noexif_hex = exif_jpeg(W, H, f35_tag, actual_focal, byteorder=bo, include35=False)

    true_ratio = P["w"] / P["h"]
    fronto = abs(P["pitch"]) < 4 and abs(P["yaw"]) < 4
    # replica estimates
    f_exif = f_px_from_35(f35_tag, W, H)
    r_exif = ratio_with_f(qn, W, H, f_exif)
    sens, fq = gate_sensitivity(qn, W, H)
    gate = tri(sens, 0.0025, 0.010)   # True = fails the gate (too sensitive)
    f_ass = f_px_from_35(ASSUMED_F35, W, H)
    r_ass = ratio_with_f(qn, W, H, f_ass)
    r_quad = ratio_with_f(qn, W, H, fq) if fq else None
    if gate is False: r_noexif, src_noexif = r_quad, "quad"
    elif gate is True: r_noexif, src_noexif = r_ass, "assumed"
    else: r_noexif, src_noexif = None, "either"

    c = dict(id=f"p{i:03d}", group=kind, W=W, H=H, noise=a, shuffled=shuffled, order=order,
             corners=[list(p) for p in given], cornersOrdered=[list(p) for p in qn],
             truth=dict(wMm=P["w"], hMm=P["h"], f35=P["f35"], fPx=P["fpx"], pitch=P["pitch"], yaw=P["yaw"],
                        roll=P["roll"], cornersExact=[list(p) for p in q]),
             exif=dict(present=exif_present, f35Tag=f35_tag, byteOrder=bo, jpegHex=exif_hex, jpegNo35Hex=noexif_hex,
                       actualFocalMm=round(actual_focal, 2)),
             replica=dict(ratioExif=r_exif, ratioQuad=r_quad, ratioAssumed=r_ass, gateSensitivity=sens if sens != math.inf else None,
                          gateFails=gate, quadFocalPx=fq, noExifSource=src_noexif, ratioNoExif=r_noexif,
                          farEdgePpiTruth=far_edge_ppi(qn, P["w"], P["h"])),
             fronto=fronto, modes={})
    m = c["modes"]
    weak_expect = None if fronto else (gate if gate is not None else None)
    low = tri(-far_edge_ppi(qn, P["w"], P["h"]), -165.0, -135.0)   # True when ppi < 135, False when > 165

    # a: both typed, correct
    def mismatch_expect(typed_ratio, exif):
        cands = []
        if exif: cands.append((r_exif, 0.05))
        else:
            if gate in (False, None) and r_quad: cands.append((r_quad, 0.05))
            if gate in (True, None): cands.append((r_ass, 0.15))
        vals = set()
        for r, T in cands:
            if r is None: vals.add(None); continue
            rel = abs(typed_ratio / r - 1)
            vals.add(tri(rel, 0.6 * T, 1.4 * T))
        if fronto and not exif: vals.discard(None) if len(vals) > 1 else None
        return vals.pop() if len(vals) == 1 else None
    m["a"] = dict(typed=dict(wMm=P["w"], hMm=P["h"]), useExif=exif_present,
                  expect=dict(wMm=P["w"], hMm=P["h"], aspectEstimated=False,
                              aspectMismatch=mismatch_expect(true_ratio, exif_present), lowDetail=low))
    # aw: both typed, height wrong by 30 % (or 25 % short)
    k = RNG.choice([1.3, 0.75])
    m["aw"] = dict(typed=dict(wMm=P["w"], hMm=P["h"] * k), useExif=exif_present,
                   expect=dict(wMm=P["w"], hMm=P["h"] * k, aspectEstimated=False,
                               aspectMismatch=mismatch_expect(P["w"] / (P["h"] * k), exif_present)))
    side = RNG.choice(["w", "h"])
    def one_side(r):
        if r is None: return None
        return (P["w"], P["w"] / r) if side == "w" else (P["h"] * r, P["h"])
    # b: one side + EXIF lens
    eb = one_side(r_exif)
    m["b"] = dict(typed=({"wMm": P["w"]} if side == "w" else {"hMm": P["h"]}), useExif=True,
                  expect=dict(truthWMm=P["w"], truthHMm=P["h"], replicaWMm=eb[0] if eb else None, replicaHMm=eb[1] if eb else None,
                              aspectEstimated=True, aspectWeak=False, lowDetail=low))
    # c: one side, no EXIF
    ec = one_side(r_noexif)
    m["c"] = dict(typed=({"wMm": P["w"]} if side == "w" else {"hMm": P["h"]}), useExif=False,
                  expect=dict(truthWMm=P["w"], truthHMm=P["h"], replicaWMm=ec[0] if ec else None, replicaHMm=ec[1] if ec else None,
                              replicaQuad=one_side(r_quad), replicaAssumed=one_side(r_ass),
                              aspectEstimated=True, aspectWeak=weak_expect, lowDetail=low))
    # d: paper preset
    if P["paper"]:
        pw, ph = PAPERS[P["paper"]]
        land = P["w"] > P["h"]
        m["d"] = dict(paper=P["paper"], paperPortraitMm=[pw, ph], useExif=exif_present,
                      expect=dict(wMm=ph if land else pw, hMm=pw if land else ph, aspectEstimated=False, lowDetail=low))
    # e: nothing typed
    m["e"] = dict(useExif=exif_present, expect=dict(sizeKnown=False))
    return c

# ---------------------------------------------------------------- verdict cases
RULES = ("outside", "degenerate", "angle", "selfIntersecting", "mirrored", "concave", "tooSmall")

def seg_cross(p1, p2, p3, p4):
    d1 = cross2(sub(p4, p3), sub(p1, p3)); d2 = cross2(sub(p4, p3), sub(p2, p3))
    d3 = cross2(sub(p2, p1), sub(p3, p1)); d4 = cross2(sub(p2, p1), sub(p4, p1))
    return (d1 * d2 < 0) and (d3 * d4 < 0)

def violations(q, W, H):
    v = set()
    if any(not all(math.isfinite(c) for c in p) for p in q): return {"nonFinite"}
    if any(p[0] < -0.5 or p[0] > W + 0.5 or p[1] < -0.5 or p[1] > H + 0.5 for p in q): v.add("outside")
    if any(dist(q[i], q[j]) < 1.0 for i in range(4) for j in range(i + 1, 4)): v.add("degenerate")
    angs = corner_angles(q)
    if any(a < 5 or a > 175 for a in angs): v.add("angle")
    if seg_cross(q[0], q[1], q[2], q[3]) or seg_cross(q[1], q[2], q[3], q[0]): v.add("selfIntersecting")
    else:
        signs = [cross2(sub(q[(i + 1) % 4], q[i]), sub(q[(i + 2) % 4], q[(i + 1) % 4])) for i in range(4)]
        if shoelace(q) < 0: v.add("mirrored")
        pos = sum(1 for s in signs if s > 0); neg = sum(1 for s in signs if s < 0)
        if pos and neg: v.add("concave")
        if abs(shoelace(q)) < 0.10 * W * H: v.add("tooSmall")
    return v

def rand_convex(W, H, lo=0.25, hi=0.8):
    for _ in range(10000):
        cx, cy = RNG.uniform(0.3, 0.7) * W, RNG.uniform(0.3, 0.7) * H
        rw, rh = RNG.uniform(0.25, 0.48) * W, RNG.uniform(0.25, 0.48) * H
        q = [(cx - rw + RNG.uniform(-0.1, 0.1) * W, cy - rh + RNG.uniform(-0.1, 0.1) * H),
             (cx + rw + RNG.uniform(-0.1, 0.1) * W, cy - rh + RNG.uniform(-0.1, 0.1) * H),
             (cx + rw + RNG.uniform(-0.1, 0.1) * W, cy + rh + RNG.uniform(-0.1, 0.1) * H),
             (cx - rw + RNG.uniform(-0.1, 0.1) * W, cy + rh + RNG.uniform(-0.1, 0.1) * H)]
        if not violations(q, W, H) and lo * W * H <= shoelace(q) <= hi * W * H and min(corner_angles(q)) > 20:
            return q
    raise RuntimeError

def scale_about(q, s):
    cx = sum(p[0] for p in q) / 4; cy = sum(p[1] for p in q) / 4
    return [(cx + (p[0] - cx) * s, cy + (p[1] - cy) * s) for p in q]

def verdict_cases():
    out = []
    def add(group, q, W, H, note="", boundary=False):
        v = violations(q, W, H)
        out.append(dict(id=f"v{len(out):03d}", group=group, W=W, H=H, corners=[list(p) for p in q],
                        violated=sorted(v), expectOk=(len(v) == 0), boundary=boundary, note=note))
    for _ in range(25):
        W, H = RNG.choice(PHOTOS); add("ok", rand_convex(W, H), W, H)
    for _ in range(14):   # outside, clear
        W, H = RNG.choice(PHOTOS); q = rand_convex(W, H); i = RNG.randrange(4)
        side = RNG.choice(["l", "r", "t", "b"]); d = RNG.uniform(1.5, 80)
        p = list(q[i])
        if side == "l": p[0] = -d
        elif side == "r": p[0] = W + d
        elif side == "t": p[1] = -d
        else: p[1] = H + d
        q[i] = tuple(p); add("outside", q, W, H, f"corner {i} {side} by {d:.2f}px")
    for s, d in [("l", -0.3), ("r", 0.3), ("t", -0.45), ("b", 0.49), ("l", 0.0), ("r", 0.0), ("l", -0.7), ("b", 0.8)]:
        W, H = 4032, 3024
        q = [(400, 300), (3600, 300), (3600, 2700), (400, 2700)]
        if s == "l": q[0] = (d, 300); q[3] = (max(d, 0) if d >= 0 else d, 2700)
        if s == "r": q[1] = (W + d, 300)
        if s == "t": q[1] = (3600, d)
        if s == "b": q[2] = (3600, H + d)
        add("insideMargin", q, W, H, f"{s} edge offset {d}", boundary=True)
    for _ in range(14):   # concave dart
        W, H = RNG.choice(PHOTOS); q = rand_convex(W, H, 0.3, 0.8); i = RNG.randrange(4)
        a, c = q[i - 1], q[(i + 1) % 4]
        mid = ((a[0] + c[0]) / 2, (a[1] + c[1]) / 2); o = q[(i + 2) % 4]
        t = RNG.uniform(0.15, 0.6)
        q[i] = (mid[0] + (o[0] - mid[0]) * t, mid[1] + (o[1] - mid[1]) * t)
        add("concave", q, W, H)
    for k in range(12):   # area around 10 %
        W, H = RNG.choice(PHOTOS)
        q = [(0.2 * W, 0.2 * H), (0.8 * W, 0.2 * H), (0.8 * W, 0.8 * H), (0.2 * W, 0.8 * H)]
        target = [0.03, 0.06, 0.09, 0.095, 0.099, 0.101, 0.105, 0.12, 0.15, 0.08, 0.11, 0.0985][k]
        q = scale_about(q, math.sqrt(target / 0.36))
        add("area", q, W, H, f"area {target:.4f}", boundary=0.098 < target < 0.102)
    for _ in range(10):   # two corners within 1 px
        W, H = RNG.choice(PHOTOS); q = rand_convex(W, H); i = RNG.randrange(4)
        j = (i + 1) % 4; d = RNG.uniform(0.0, 0.9); ang = RNG.uniform(0, 2 * math.pi)
        q[j] = (q[i][0] + d * math.cos(ang), q[i][1] + d * math.sin(ang))
        add("degenerate", q, W, H, f"corners {i},{j} {d:.2f}px apart")
    for _ in range(10):   # three collinear corners (triangle)
        W, H = RNG.choice(PHOTOS); q = rand_convex(W, H); i = RNG.randrange(4)
        a, c = q[i - 1], q[(i + 1) % 4]; t = RNG.uniform(0.2, 0.8)
        q[i] = (a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t)
        add("collinear", q, W, H)
    for ang in [1.0, 3.0, 4.5, 6.0, 8.0, 172.0, 176.0, 178.0, 179.5, 170.0]:   # one corner angle
        W, H = 4032, 3024
        if ang < 90:
            # long thin kite: apex at TL with the given opening angle
            L = 3000.0; a = math.radians(ang)
            p0 = (500.0, 1500.0)
            p1 = (p0[0] + L * math.cos(-a / 2), p0[1] + L * math.sin(-a / 2))
            p3 = (p0[0] + L * math.cos(a / 2), p0[1] + L * math.sin(a / 2))
            p2 = (p0[0] + L * 1.05, p0[1])
            q = [p0, p1, p2, p3]
            if shoelace(q) < 0: q = [p0, p3, p2, p1]
        else:
            # TR almost on the line TL-BR... use a top edge bent by (180 - ang)
            b = math.radians(180 - ang)
            q = [(300.0, 300.0), (2000.0, 300.0 - 1700.0 * math.tan(b) * 0.0), (3700.0, 300.0), (3700.0, 2700.0), (300.0, 2700.0)]
            tl, mid, tr = q[0], (2000.0, 300.0 + 1700.0 * math.tan(b / 2)), q[2]
            q = [tl, mid, (3700.0, 2700.0), (300.0, 2700.0)]   # TL, "TR"=mid, BR, BL: angle at mid ~ ang
        add("angle", q, W, H, f"corner angle ~{ang} deg", boundary=ang in (4.5, 6.0, 176.0, 172.0))
    for _ in range(8):    # bow-tie order (direct call); sorted call must accept
        W, H = RNG.choice(PHOTOS); q = rand_convex(W, H); q = [q[0], q[2], q[1], q[3]]
        add("bowtie", q, W, H)
    for _ in range(8):    # counter-clockwise order
        W, H = RNG.choice(PHOTOS); q = rand_convex(W, H); q = [q[0], q[3], q[2], q[1]]
        add("ccw", q, W, H)
    W, H = 4032, 3024
    for bad in [(math.nan, 300.0), (math.inf, 300.0), (-math.inf, 1.0), (1e12, 1e12)]:
        q = [bad, (3600.0, 300.0), (3600.0, 2700.0), (400.0, 2700.0)]
        add("hostile", q, W, H, "non-finite or huge")
    # tiny photo
    add("tiny", [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)], 1, 1, "1x1 photo, full quad (corners exactly 1 px apart)", boundary=True)
    add("tiny", [(0.0, 0.0), (2.0, 0.0), (2.0, 2.0), (0.0, 2.0)], 2, 2, "2x2 photo, full quad")
    return out

# ---------------------------------------------------------------- homography (exact rationals)
def solve_exact(A, b):
    n = len(A); M = [row[:] + [bb] for row, bb in zip(A, b)]
    for c in range(n):
        p = next(r for r in range(c, n) if M[r][c] != 0)
        M[c], M[p] = M[p], M[c]
        for r in range(n):
            if r != c and M[r][c] != 0:
                k = M[r][c] / M[c][c]
                M[r] = [x - k * y for x, y in zip(M[r], M[c])]
    return [M[i][n] / M[i][i] for i in range(n)]

def homography_exact(src, dst):
    A, b = [], []
    for (x, y), (u, v) in zip(src, dst):
        x, y, u, v = Fraction(x), Fraction(y), Fraction(u), Fraction(v)
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.append(u)
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y]); b.append(v)
    h = solve_exact(A, b)
    return [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], Fraction(1)]]

def apply_exact(Hm, p):
    x, y = Fraction(p[0]), Fraction(p[1])
    w = Hm[2][0] * x + Hm[2][1] * y + Hm[2][2]
    return (float((Hm[0][0] * x + Hm[0][1] * y + Hm[0][2]) / w), float((Hm[1][0] * x + Hm[1][1] * y + Hm[1][2]) / w))

def homography_cases(n):
    out = []
    for i in range(n):
        W, H = RNG.choice(PHOTOS)
        if i < n * 0.8:
            q = rand_convex(W, H, 0.12, 0.85)
        else:   # harder: sliver-ish but legal quads (angles 6-20 deg region, area >= 10 %)
            for _ in range(10000):
                q = rand_convex(W, H, 0.10, 0.9)
                k = RNG.randrange(4)
                q[k] = (q[k][0] + RNG.uniform(-0.25, 0.25) * W, q[k][1] + RNG.uniform(-0.25, 0.25) * H)
                if not violations(q, W, H) and min(corner_angles(q)) < 25: break
            else: q = rand_convex(W, H, 0.12, 0.85)
        ow, oh = RNG.randint(200, 4000), RNG.randint(200, 4000)
        rect = [(0, 0), (ow, 0), (ow, oh), (0, oh)]
        q = [(round(x, 3), round(y, 3)) for x, y in q]
        Hm = homography_exact(q, rect)
        pts = []
        for _ in range(5):
            s, t = RNG.random(), RNG.random()
            # interior point of the quad by bilinear mix (inside a convex quad)
            a = (q[0][0] + (q[1][0] - q[0][0]) * s, q[0][1] + (q[1][1] - q[0][1]) * s)
            b = (q[3][0] + (q[2][0] - q[3][0]) * s, q[3][1] + (q[2][1] - q[3][1]) * s)
            p = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
            pts.append(dict(photo=list(p), out=list(apply_exact(Hm, p))))
        out.append(dict(id=f"h{i:03d}", W=W, H=H, corners=[list(p) for p in q], outW=ow, outH=oh,
                        hard=i >= n * 0.8, points=pts, matrix=[[float(v) for v in row] for row in Hm]))
    return out

# ---------------------------------------------------------------- EXIF reading cases
def exif_cases():
    out = []
    specs = [
        ("II", "SHORT", 26, 6.86, True, 1, 26), ("MM", "SHORT", 26, 6.86, True, 1, 26),
        ("II", "SHORT", 77, 9.0, True, 6, 77), ("MM", "SHORT", 13, 2.22, True, 8, 13),
        ("II", "LONG", 28, 5.1, True, 1, 28), ("MM", "LONG", 52, 9.0, True, 1, 52),
        ("II", "SHORT", 0, 6.86, True, 1, None),      # 0 = unknown per EXIF
        ("MM", "SHORT", 0, 6.86, True, 1, None),
        ("II", "SHORT", 26, 6.86, False, 1, None),    # actual FocalLength only: must NOT be read as 35 mm
        ("MM", "SHORT", 26, 4.25, False, 1, None),
        ("II", "SHORT", 65535, 6.86, True, 1, "implausible"),
        ("MM", "SHORT", 1, 6.86, True, 1, "implausible"),
    ]
    for k, (bo, typ, v, act, inc, orient, exp) in enumerate(specs):
        out.append(dict(id=f"x{k:02d}", byteOrder=bo, type=typ, value=v, actualFocalMm=act, has35=inc,
                        orientation=orient, expect=exp,
                        jpegHex=exif_jpeg(4032, 3024, v, act, byteorder=bo, f35_type=typ, orientation=orient, include35=inc)))
    return out

# ---------------------------------------------------------------- 16 MP cap cases
def cap_cases():
    """Big photos where the full-frame straightened output exceeds 16 MP; expected output dims under the cap."""
    out = []
    for i in range(30):
        W, H = RNG.choice([(8064, 6048), (6048, 8064), (8000, 6000), (5712, 4284), (4032, 3024)])
        mx, my = RNG.uniform(0.0, 0.08) * W, RNG.uniform(0.0, 0.08) * H
        q = [(mx + RNG.uniform(0, 0.05) * W, my + RNG.uniform(0, 0.05) * H),
             (W - mx - RNG.uniform(0, 0.05) * W, my + RNG.uniform(0, 0.05) * H),
             (W - mx - RNG.uniform(0, 0.05) * W, H - my - RNG.uniform(0, 0.05) * H),
             (mx + RNG.uniform(0, 0.05) * W, H - my - RNG.uniform(0, 0.05) * H)]
        wmm = RNG.choice([210.0, 297.0, 150.0, 400.0, 123.4]); hmm = wmm * RNG.uniform(0.5, 1.6)
        if (H > W) != (hmm > wmm): wmm, hmm = hmm, wmm
        ow, oh, capped = out_pixels(q, wmm, hmm)
        uw, uh, _ = out_pixels(q, wmm, hmm, cap=math.inf)
        out.append(dict(id=f"m{i:02d}", W=W, H=H, corners=[list(p) for p in q], typed=dict(wMm=wmm, hMm=hmm),
                        expect=dict(outW=ow, outH=oh, capped=capped, uncappedMP=uw * uh / 1e6, capSI=CAP_SI)))
    return out

def main(path):
    photos = [photo_case(i, "paper" if i % 5 in (1, 3) else "rect") for i in range(360)]
    data = dict(meta=dict(author="blind agent (V15 A1 oracle), 2026-10-16", seed=20261016,
                          sources=["docs/SPEC.md §11", "docs/V15_PLAN.md A1", "docs/DECISIONS.md D90-D94", "docs/V15_LOG.md"],
                          notRead=["src/engine/*", "scripts/oracle/*"], ambiguities=AMBIGUITIES,
                          papers=PAPERS, assumedF35=ASSUMED_F35, diag35=DIAG35),
                photos=photos, verdicts=verdict_cases(), homographies=homography_cases(300),
                exif=exif_cases(), caps=cap_cases())
    with open(path, "w") as fh: json.dump(data, fh, allow_nan=True)
    print(f"photos {len(photos)}  verdicts {len(data['verdicts'])}  homographies {len(data['homographies'])}  "
          f"exif {len(data['exif'])}  caps {len(data['caps'])}")

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "cases.json")
