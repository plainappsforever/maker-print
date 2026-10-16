#!/usr/bin/env python3
"""Blind image fixtures (P3.5 review): EXIF orientation 3/5/6/8 (II and MM), JFIF vs EXIF density disagreement,
PNG pHYs in px/m and unit 0, Photoshop APP13 ResolutionInfo only, IFD1 thumbnail orientation, anisotropic dpi,
16-bit and palette PNGs, a CMYK JPEG. Truth: displayed px size, orientation, density (ImageIO-style) and where the
red quadrant must appear once displayed (fractions of the displayed image)."""
import json, os, struct, subprocess, zlib
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'img')
W, H = 300, 200  # raw (stored) size; red quadrant = raw x < 150, y < 100 (top-left), blue = raw x >= 225, y >= 150

def png(path, w, h, pix, bitdepth=8, ctype=2, extra=b'', palette=None, trns=None):
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    raw = b''
    for y in range(h):
        raw += b'\x00'
        for x in range(w):
            raw += pix(x, y)
    out = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, bitdepth, ctype, 0, 0, 0)) + extra
    if palette: out += chunk(b'PLTE', palette)
    if trns: out += chunk(b'tRNS', trns)
    out += chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    open(path, 'wb').write(out)

def rgb(x, y):
    if x < 150 and y < 100: return b'\xff\x00\x00'
    if x >= 225 and y >= 150: return b'\x00\x00\xff'
    return b'\xff\xff\xff'
def phys(ppux, ppuy, unit):
    d = struct.pack('>IIB', ppux, ppuy, unit)
    return struct.pack('>I', 9) + b'pHYs' + d + struct.pack('>I', zlib.crc32(b'pHYs' + d) & 0xffffffff)

base_png = os.path.join(D, '_base.png')
png(base_png, W, H, rgb)
base_jpg = os.path.join(D, '_base.jpg')
subprocess.run(['sips', '-s', 'format', 'jpeg', '-s', 'formatOptions', '100', base_png, '--out', base_jpg], check=True, capture_output=True)
J = open(base_jpg, 'rb').read()
assert J[:2] == b'\xff\xd8'

def strip_app(j):
    """remove APP0..APP15 segments after SOI; return SOI + rest"""
    i = 2; out = b'\xff\xd8'
    while j[i] == 0xFF and 0xE0 <= j[i + 1] <= 0xEF:
        L = struct.unpack('>H', j[i + 2:i + 4])[0]; i += 2 + L
    return out, j[i:]

def jfif(units, x, y): return b'\xff\xe0' + struct.pack('>H', 16) + b'JFIF\x00\x01\x01' + struct.pack('>BHHBB', units, x, y, 0, 0)

def exif(endian='<', orientation=None, xres=None, yres=None, unit=None, ifd1_orientation=None):
    E = endian
    tags = []
    if orientation is not None: tags.append((274, 3, 1, orientation))
    if xres is not None: tags.append((282, 5, 1, xres))
    if yres is not None: tags.append((283, 5, 1, yres))
    if unit is not None: tags.append((296, 3, 1, unit))
    tags.sort()
    n = len(tags)
    ifd0_off = 8
    data_off = ifd0_off + 2 + 12 * n + 4
    ifd1 = b''
    body = b''; datas = b''
    for tag, typ, cnt, val in tags:
        if typ == 3: v = struct.pack(E + 'HH', val, 0)
        else:
            v = struct.pack(E + 'I', data_off + len(datas)); datas += struct.pack(E + 'II', val[0], val[1])
        body += struct.pack(E + 'HHI', tag, typ, cnt) + v
    next_ifd = 0
    if ifd1_orientation is not None:
        next_ifd = data_off + len(datas)
        ifd1 = struct.pack(E + 'H', 1) + struct.pack(E + 'HHI', 274, 3, 1) + struct.pack(E + 'HH', ifd1_orientation, 0) + struct.pack(E + 'I', 0)
    tiff = (b'II' if E == '<' else b'MM') + struct.pack(E + 'HI', 42, ifd0_off) + struct.pack(E + 'H', n) + body + struct.pack(E + 'I', next_ifd) + datas + ifd1
    payload = b'Exif\x00\x00' + tiff
    return b'\xff\xe1' + struct.pack('>H', len(payload) + 2) + payload

def app13_res(dpi):
    # Photoshop 3.0 IRB: 8BIM 0x03ED ResolutionInfo: hRes 16.16 fixed, hResUnit=1 (ppi), widthUnit, vRes, vResUnit, heightUnit
    ri = struct.pack('>IHHIHH', dpi << 16, 1, 1, dpi << 16, 1, 1)
    irb = b'8BIM' + struct.pack('>H', 0x03ED) + b'\x00\x00' + struct.pack('>I', len(ri)) + ri
    payload = b'Photoshop 3.0\x00' + irb
    return b'\xff\xed' + struct.pack('>H', len(payload) + 2) + payload

soi, rest = strip_app(J)
exp = {}
def jpg(name, segs, orientation, density, note=''):
    open(os.path.join(D, name), 'wb').write(soi + b''.join(segs) + rest)
    exp[name] = {'raw': [W, H], 'orientation': orientation, 'density': density, 'note': note}
jpg('i01-exif-orient6-II.jpg', [jfif(0, 1, 1), exif('<', 6)], 6, None)
jpg('i02-exif-orient8-MM.jpg', [exif('>', 8)], 8, None)
jpg('i03-exif-orient3.jpg', [exif('<', 3)], 3, None)
jpg('i04-exif-orient5.jpg', [exif('>', 5)], 5, None)
jpg('i05-jfif300-exif72.jpg', [jfif(1, 300, 300), exif('<', 1, (72, 1), (72, 1), 2)], 1, 'disagree', 'JFIF says 300 dpi, EXIF says 72 dpi')
jpg('i06-jfif72-exif300cm.jpg', [jfif(1, 72, 72), exif('<', 1, (11811, 100), (11811, 100), 3)], 1, [299.9994, 299.9994], 'EXIF 118.11 px/cm = 299.9994 dpi')
jpg('i07-app13-only-300.jpg', [jfif(0, 1, 1), app13_res(300)], 1, [300, 300], 'only Photoshop ResolutionInfo carries the density')
jpg('i08-ifd1-orientation.jpg', [exif('<', 1, ifd1_orientation=6)], 1, None, 'IFD1 (thumbnail) orientation 6 must be ignored')
jpg('i09-aniso-dpi.jpg', [exif('<', 1, (300, 1), (150, 1), 2)], 1, [300, 150], 'non-square pixels')
jpg('i10-orient6-dpi300-150.jpg', [exif('<', 6, (300, 1), (150, 1), 2)], 6, [150, 300], 'densities follow the displayed axes after rotation')
jpg('i11-exif-before-jfif.jpg', [exif('<', 6, (200, 1), (200, 1), 2), jfif(1, 72, 72)], 6, [200, 200], 'APP1 before APP0 (some cameras)')
png(os.path.join(D, 'i20-png-phys-dpm.png'), W, H, rgb, extra=phys(11811, 11811, 1))
exp['i20-png-phys-dpm.png'] = {'raw': [W, H], 'orientation': 1, 'density': [299.9994, 299.9994], 'note': '11811 px/m'}
png(os.path.join(D, 'i21-png-phys-unit0.png'), W, H, rgb, extra=phys(2, 1, 0))
exp['i21-png-phys-unit0.png'] = {'raw': [W, H], 'orientation': 1, 'density': None, 'note': 'aspect only'}
png(os.path.join(D, 'i22-png-16bit.png'), W, H, lambda x, y: b''.join(bytes([c, c]) for c in rgb(x, y)), bitdepth=16)
exp['i22-png-16bit.png'] = {'raw': [W, H], 'orientation': 1, 'density': None}
pal = b'\xff\x00\x00\x00\x00\xff\xff\xff\xff'
png(os.path.join(D, 'i23-png-palette-trns.png'), W, H, lambda x, y: bytes([0 if (x < 150 and y < 100) else 1 if (x >= 225 and y >= 150) else 2]), ctype=3, palette=pal, trns=b'\xff\xff\x00')
exp['i23-png-palette-trns.png'] = {'raw': [W, H], 'orientation': 1, 'density': None, 'note': 'white entry fully transparent'}
cmyk = os.path.join(D, 'i30-cmyk.jpg')
r = subprocess.run(['sips', '-m', '/System/Library/ColorSync/Profiles/Generic CMYK Profile.icc', '-s', 'format', 'jpeg', base_png, '--out', cmyk], capture_output=True, text=True)
if os.path.exists(cmyk): exp['i30-cmyk.jpg'] = {'raw': [W, H], 'orientation': 1, 'density': None, 'note': 'CMYK JPEG (Adobe APP14) - colours must not invert'}
json.dump(exp, open(os.path.join(D, 'expected.json'), 'w'), indent=1)
print(len(exp), 'images', r.returncode, r.stderr[:200])
